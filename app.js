// This the cma slack bot prototype
// Require the Bolt package (github.com/slackapi/bolt)
const { App, ExpressReceiver } = require("@slack/bolt");
const bodyParser= require('body-parser');
const axios = require("axios");
const dotenv = require("dotenv");
const logts = require("log-timestamp");
const retry = require("async-retry");

// block templates
var exhibit_header_template = require("./exhibit_header_template.json");
var exhibit_footer_template = require("./exhibit_footer_template.json");
var exhibit_template = require("./exhibit_template.json");
var home_template = require("./app_home_template.json");
var prompt_invoke_template = require("./prompt_invoke_template_multi.json");
var prompt_selection_template = require("./prompt_selection_template.json");
var confirm_image_template = require("./confirm_image_template.json");

dotenv.config();

const RETRY_OPTIONS = {
  retries: 5,
  minTimeout: 10000, // 10 sec 
  maxTimeout: 30000 // 30 sec
};

const slackBotApiUrl = process.env['SLACK_BOT_API_URL'];
const openaccessUrl = process.env['OPENACCESS_URL'];
const promptsUrl = process.env["PROMPT_URL"];

// authenticate
axios.defaults.headers.common['Authentication'] = process.env['SLACK_BOT_API_TOKEN'];

const getTokenData = async (teamId) => {
  const tokenUrl = `${slackBotApiUrl}tokens/${teamId}`;
  
  const results = await axios.get(tokenUrl);
  
  return {
    "botToken": results.data.data.access_token,
    "botId": results.data.data.bot_id,
    "botUserId": results.data.data.bot_user_id
  }  
}

const authorizeFn = async ({teamId}) => {
  const results = await getTokenData(teamId);
  
  return {
    botToken: results.botToken,
    botId: results.botId,
    botUserId: results.botUserId
  };   
}

const receiver = new ExpressReceiver({ signingSecret: process.env.SLACK_SIGNING_SECRET, endpoints: '/slack/events' });
receiver.app.use(bodyParser.json());

// command endpoints
receiver.app.get('/test', (req, res) => {  
  if (req.headers.authentication == process.env['SLACK_BOT_API_TOKEN']) {
    testFn(); 
    
    res.json({"fn":"test"}); 
  } else {
    res.sendStatus(401);
  }
});

receiver.app.get('/trigger-prompt', async (req, res) => { 
  if (req.headers.authentication == process.env['SLACK_BOT_API_TOKEN']) {  
    promptData = await initializePromptData(); 
    
    // TODO: this is a little bit of a hack
    setTimeout(() => { 
      if (req.query.team_ids) {
        triggerPrompt(req.query.team_ids.split(',')); 
      } else {      
        triggerPrompt();
      }
    }, 5000);
    
    res.json({"fn":"trigger-prompt"}); 
  } else {
    res.sendStatus(401);
  }                                                  
});

receiver.app.get('/trigger-exhibition', (req, res) => { 
  if (req.headers.authentication == process.env['SLACK_BOT_API_TOKEN']) {    
    if (req.query.team_ids) {
      triggerExhibition(req.query.team_ids.split(',')); 
    } else {
      triggerExhibition();
    }
    
    res.json({"fn":"trigger-exhibition"}); 
  } else {
    res.sendStatus(401);
  }     
});

receiver.app.get('/notify-installs-without-channel', (req, res) => { 
  if (req.headers.authentication == process.env['SLACK_BOT_API_TOKEN']) {    
    notifyInstallsWithoutChannel();
    
    res.json({"fn":"notify-installs-without-channel"}); 
  } else {
    res.sendStatus(401);
  }     
});

receiver.app.post('/notify-users', (req, res) => { 
  if (req.headers.authentication == process.env['SLACK_BOT_API_TOKEN']) {    
    sendNotification(req.body.msg_type, 
                     req.body.msg, 
                     req.body.closing, 
                     req.body.notification);
    
    res.json({"fn":"notify-users"}); 
  } else {
    res.sendStatus(401);
  }     
});
 
const app = new App({authorize: authorizeFn, signingSecret: process.env.SLACK_SIGNING_SECRET, receiver: receiver});

/*
 * FUNCTIONS
 */

// PROMPT FUNCTIONS
var promptIndex = 0;
var promptData = {
};

// Populate prompts content
// var prompts = [];
// async function getAllPrompts() {
//   var result = await axios.get(promptsUrl);
//   prompts = result.data;
// }
// getAllPrompts();

const initializePromptData = async () => {
  axios.get(promptsUrl)
    .then((res) => {
      promptData = {
        prompt: {},
        artworks: {}
      }
      promptData.prompt = res.data[promptIndex];
      
      var query = promptData.prompt.defaultQueryPattern;
      var thisQuery = "";  
    
      for (const choice of promptData.prompt.choices) {
        if (choice.query) {
          // not stricly necessary to do replacement since you know what __keyword__
          // is on the CMS side, but prevents user error
          thisQuery = choice.query.replace("__keyword__", choice.text);
        } else {
          thisQuery = query.replace("__keyword__", choice.text);
        }
        
        const limitDeptTo = parseInt(process.env['LIMIT_DEPT_TO']);
        
        // make sure query only returns artwork with images and doesn't strip special chars so that
        // lucene-style syntax works
        axios.get(`${openaccessUrl}?q=${thisQuery}&no_strip=1&has_image=1&limit=500&limit_depts_to=${limitDeptTo}`)
          .then((res) => {
            promptData.artworks[choice.text] = res.data.data;
          });
	      
      } 
    })
    .catch(error => {
      console.log("!!! error initializing prompt: ", error);
    });
}

// END PROMPT FUNCTIONS

// STATE API FUNCTIONS

const stateGetTeamIds = async () => {
  const url = `${slackBotApiUrl}team_ids`;
  
  const results = await axios.get(url);
  
  if (results.status == 200) {
    return results.data.data;
  } else {
    return null;
  }
}

const stateGetTeamData = async (teamId) => {    
  const url = `${slackBotApiUrl}team/${teamId}`;
  
  const results = await axios.get(url);
  
  var team = results.data.data;
  
  return team;
};

const hasExhibitParticipants = async (teamId) => {
  const team = await stateGetTeamData(teamId);
  
  if (team.users) {
    for (const user of team.users) {
      if (user.current_state.lastImgUrl && user.current_state.lastImgUrl.length > 0) {
        return true;
      }
    }
  }
  
  return false
};

const stateGetUserData = async (userId) => {
  const url = `${slackBotApiUrl}user/${userId}`;
  
  const results = await axios.get(url)
    .catch(error => {
      console.log("user not found ", userId);
    });
    
  if (results) {
    return results.data.data.current_state; 
  } else {
    return null;
  }
};

const stateSetUserData = async (userId, currentState, teamId) => {
  const url = `${slackBotApiUrl}user/${userId}`;
  
  var req = {
    team_id: teamId,
    current_state: currentState
  };
  
  const results = await axios.post(url, req)
  
  return results.data; 
}

const stateDeleteUserData = async (userId) => {
  const url = `${slackBotApiUrl}user/${userId}`;
  
  const results = await axios.delete(url)
    .catch(error => {
      console.log("user not found ", userId);
  });
  
  if (results) {
    return results.data; 
  } else {
    return null;
  }
};

const stateClearUserData = async (teamId) => {
  const team = await stateGetTeamData(teamId);
  
  for (var user of team.users) {
    stateDeleteUserData(user.user_id);
  }
}

// END STATE API FUNCTIONS

const writeExhibitionToAPI = async (slackbotId, data) => {
  var req = {
    slackbot_id: slackbotId,
    data: data
  };

  try {
    var resp = await axios.post(`${slackBotApiUrl}slackbot-data`, req);

    console.log("writeExhibitionToAPI");
  } catch (error) {
    console.log(error);
  }
};

const getPrompts = () => {
  return promptData.prompt;
};

const getArts = (keyword) => {
  return promptData.artworks[keyword];
}

const formatCreators = creators => {
  var s = "";

  if (creators.length > 0) {
    if (creators.length > 1) {
      creators.forEach(function(item, index) {
        if (index == 0) {
          s = item.description;
        } else {
          s = s + ", " + item.description;
        }
      });
    } else {
      s = creators[0].description;
    }
  }

  return s;
};

function getRndInteger(min, max) {
  return Math.floor(Math.random() * (max - min)) + min;
}

async function getBotChannels(botToken, botUserId) {
  try {
    const result =  await app.client.users.conversations({
      token: botToken,
      user: botUserId
    }); 
    
    const channels = result.channels.map((item) => { 
      return {
        id: item.id,
        name: item.name
      }
    });  

    return channels;
  } catch (error) {
    console.log("Couldn't get channel for bot user ", botUserId);
    console.error(error);
    return [];
  }
}

async function getAllUsersInTeamChannel(team) {
  const channels = await getBotChannels(team.bot_token, team.bot_user_id);
  var users = [];
  
  if (channels.length > 0) {  
    const channel = channels[0];

    const result = await app.client.conversations.members({
      token: team.bot_token,
      channel: channel.id
    });
    users = result.members; 
  } 
  
  return users;
}


async function triggerExhibition(teamIds) {
  if (!teamIds) {
    teamIds = await stateGetTeamIds();
  }

  console.log("sending exhibition for ", teamIds);
  
  teamIds.forEach(async (teamId, i) => {
    setTimeout(async () => {
      try {
        const hasParticipants = await hasExhibitParticipants(teamId);
        
        if (hasParticipants) {
          await exhibitionMessage(teamId);
        } else {
          console.log("No exhibit participants for team ", teamId);
        }
      } catch (ex) {
        console.log("!! COULDN'T TRIGGER EXHIBITION FOR TEAM ", teamId);
        console.error(ex);
      }
    }, 5000*i); // 5 second delay between teams
  });
}


async function triggerPrompt(teamIds) {  
  if (!teamIds) {
    teamIds = await stateGetTeamIds();  
  }
  
  console.log("sending prompt for ", teamIds);
    
  teamIds.forEach(async (teamId, i) => {
    setTimeout(async () => {
      try {    
        var team = await stateGetTeamData(teamId);

        // we have the option to just loop through users who participated
        var users = await getAllUsersInTeamChannel(team);

        if (users.length == 0) {
          console.log(`No channel assigned, skipping prompts for  ${teamId}`);
        }

        for (const user of users) {
          // use userid as channel id to dm
          const results = await promptInvoke(user, teamId, user);
        }
      } catch (ex) {
        console.log("!! COULDN'T TRIGGER PROMPT FOR TEAM ", teamId);
        console.error(ex);
      }        
    }, 5000*i); // 5 second delay between teams
  });
}


async function exhibitionMessage(teamId) {
  const team = await stateGetTeamData(teamId);
  const channels = await getBotChannels(team.bot_token, team.bot_user_id);
  
  if (channels.length == 0 || team.users.length == 0) {
    console.log(`No channel assigned, skipping exhibition for  ${teamId}`);
    return;
  }
  
  const channel = channels[0];

  const secondsSinceEpoch = Date.now() / 1000;

  console.log(`SEND TO CHANNEL ${channel.name}`);

  // prompt variables
  var prompts = getPrompts();

  // talking to api
  var slackbotId = `id-${teamId}-${channel.id}-${secondsSinceEpoch}`;
  var data = {
    state: team
  };

  const writeResults = await writeExhibitionToAPI(slackbotId, data);

  // update header block
  var headerBlocks = exhibit_header_template.blocks;
  
  var titleBlock = headerBlocks.find(x => x.block_id === 'header_title');
  
  if (titleBlock) {
    titleBlock.text.text = `Welcome to today's exhibition: *${prompts.title}*`;
  }
  
  var promptBlock = headerBlocks.find(x => x.block_id === 'header_prompt');
  
  if (promptBlock) {
    promptBlock.text.text = prompts.resultPrompt;
  }
  
  var creditBlock = headerBlocks.find(x => x.block_id === 'header_credits');
  
  if (creditBlock) {
    const creditString = team.users.filter(u => {return u.current_state && u.current_state.lastImgUrl})
                                 .map(u => {return `<@${u.user_id}>`})
                                  .join(', ');
    creditBlock.text.text = `Today's exhibition is curated by ${creditString} and the <https://www.clevelandart.org|Cleveland Museum of Art>.`;
  }

  var imageBlock = headerBlocks.find(x => x.block_id === 'header_image');

  if (imageBlock) {
    imageBlock.title.text = prompts.title;
    imageBlock.image_url = prompts.promptArtImageUrl.trim();
    imageBlock.alt_text = prompts.promptArtTitle;
  }

  var buttonBlock = headerBlocks.find(x => x.block_id === 'cma_button');

  if (buttonBlock) {
    // Since the we don't explicitly provide the accession number of the prompt images, we have to parse it out
    // of the possible image url formats.
    // This will work for:
    // https://openaccess-cdn.clevelandart.org/1984.223/1984.223_web.jpg
    // https://openaccess-api.clevelandart.org/api/collection/artworks/image/web/1984.223
    const acc_nbr = [...prompts.promptArtImageUrl.split('/')].pop().split('_')[0];
    const artworkUrl = `https://www.clevelandart.org/art/${acc_nbr}?utm_source=slack_exhibition&utm_medium=slack&utm_campaign=artlens_for_slack`;
    
    buttonBlock.elements[0].url = artworkUrl;
  }
  
  try {
    const result = await app.client.chat.postMessage({
      token: team.bot_token,
      channel: channel.id, 
      blocks: [],
      attachments: [{ blocks: headerBlocks }],
      text: " "
    });

    var tempAllUserBlocks = [];
    var allUserBlocks = [];
    
    for (var user of team.users) {
      
      if (user.current_state.lastImgUrl && user.current_state.lastImgTitle) {
        var name = "";

        // get user name
        try {
          // Call the users.info method using the built-in WebClient
          // TODO: can't we just <@userId> in the markdown?
          const result = await app.client.users.info({
            token: team.bot_token,
            user: user.user_id
          });

          name = result.user.name;
        } catch (error) {
          console.error(error);
        }

        var artworkImg = user.current_state.lastImgUrl;
        var artworkUrl = user.current_state.artworkUrl;
        var textResponse = user.current_state.textResponse;

        var artworkLabel =
          user.current_state.lastImgTitle +
          (user.current_state.lastImgCreator ? " by " + user.current_state.lastImgCreator : "");
        var userResponse = `"${textResponse}" - ${name}`;

        // update user block
        var userBlocks = exhibit_template.blocks;

        userBlocks[1].title.text = userResponse;
        userBlocks[1].alt_text = artworkLabel;
        userBlocks[1].image_url = artworkImg;
        userBlocks[2].elements[0].url = artworkUrl + '?utm_source=slack_exhibition&utm_medium=slack&utm_campaign=artlens_for_slack'; //cma website

        // the totally stupid way you have to pass by value in JS
        var blockValue = JSON.parse(JSON.stringify(userBlocks));
        tempAllUserBlocks = allUserBlocks.concat(blockValue);
        
        // IMPORTANT: make sure concatenated blocks don't exceed 4000 char message limit
        if (JSON.stringify(tempAllUserBlocks).length < 4000) {
          allUserBlocks = tempAllUserBlocks;         
        } else { // else send message, clear block data and start building new message
          console.log("SEND EXHIBITION MESSAGE ");
          
          try {
            const resultUserBlocks = await app.client.chat.postMessage({
              token: team.bot_token,
              text: " ",
              channel: channel.id, 
              blocks: allUserBlocks
            }).then(() => {
              tempAllUserBlocks = [];
              allUserBlocks = blockValue;                      
            });          
          } catch(ex) {
            console.log("error at block for user ", user.user_id);
            console.error(ex);
          } 
        }
      }
    }
    
    // send any leftovers...if any
    if (allUserBlocks.length > 0) {
      try {
        const resultUserBlocks = await app.client.chat.postMessage({
          token: team.bot_token,
          text: " ",
          channel: channel.id, 
          blocks: allUserBlocks
      }).then(() => {
        tempAllUserBlocks = [];
          allUserBlocks = blockValue;                      
        });          
      } catch(ex) {
        console.log("error at block for user ", user.user_id);
        console.error(ex);
      } 
    }
    
    // update footer block
    var footerBlocks = exhibit_footer_template.blocks;
    
    var footerTitleBlock = footerBlocks.find(x => x.block_id === 'footer_title');
  
    if (footerTitleBlock) {
      footerTitleBlock.text.text = prompts.resultPromptConclusion;
    }
    
    const endResult = await app.client.chat.postMessage({
      token: team.bot_token,
      channel: channel.id, 
      blocks: [],
      attachments: [{ blocks: footerBlocks }],
      text: " "
    });   
    
    //send all users exhibition concluded message
    try {
      await sendExhibitionStarted(teamId);
    } catch(ex) {
      console.log("!! COULDNT SEND MESSAGES TO TEAM ", teamId);
      console.error(ex);
    }
    
    // Only clear data on success
    // TODO: ...do we want to rethink that
    await stateClearUserData(teamId);    
  } catch (error) {
    console.error(error);
  }
}

async function sendExhibitionStarted(teamId) {
  console.log("Exhibition started message");
  
  const team = await stateGetTeamData(teamId);
  const channels = await getBotChannels(team.bot_token, team.bot_user_id);
  
  const d = new Date();
  const dp = d.toDateString().split(' ');
  var dateStr = `${dp[0]}, ${dp[1]} ${Number(dp[2]).toString()}`;

  const exhibitionTitle = getPrompts().title;
  
  team.users.forEach(async (user, i) => {  
    setTimeout(async () => {
      try {
        const results = await retry(async () => {      
          const intro = await app.client.chat.postMessage({
              token: team.bot_token,
              channel: user.current_state.chatChannelId,
              blocks: [
                {
                  "block_id": "exhibition_concluded_msg",
                  "type": "section",
                  "text": {
                    "type": "mrkdwn",
                    "text": `> *The ${dateStr} exhibition, _${exhibitionTitle}_ is on view on the #${channels[0].name} channel. NO MORE SUBMISSIONS TODAY, but come back at 9am ET every weekday to participate.*`
                  }
                }        
              ],
              // Text in the notification
              text: "Today's exhibition has started"
            }); 
          console.log("SEND STARTED TO ", user.current_state.chatChannelId);
        }, RETRY_OPTIONS);
      } catch(ex) {
        console.log("!! COULDN'T SEND EXHIBITION MESSAGE TO ", user.user_id);
        console.error(ex);
      }        
    }, 500*i); // half-second delay between messages
  });  
}

// this is where the prompt message is composed
async function promptInvoke(channelId, teamId, userId) {
  var team = await stateGetTeamData(teamId);
  
  console.log(">> invoking prompt with channelId, teamId, userId ", channelId, teamId, userId);
  
  var currentState = {
      chatChannelId: channelId,
      awaitingTextResponse: false,
      awaitingArtworkSelection: true,
      awaitingQueryText: true, 
      artIndex: 0,
      numShuffle: 0,
      numVisits: 0
    };
  
  const user = await stateSetUserData(userId, currentState, teamId);

  // variables (to be updated dynamically)
  var prompts = getPrompts();
  
  // create a block
  try {
    // update header block
    var promptInvokeBlocks = prompt_invoke_template.blocks;
    
    // create buttons from choices, for max of 5 (only 5 button action_ids)
    var btns = [];
    var btnNum = (prompts.choices.length <= 5 ? prompts.choices.length : 5);
    // TODO: ensure all prompts.choices have results
    
    for (var i = 0; i < btnNum; i++) {
      var btn = {
					"type": "button",
					"text": {
						"type": "plain_text",
						"text": prompts.choices[i].text,
						"emoji": true
					},
					"value": prompts.choices[i].text,
          "action_id": "choice_button_" + i
				};
      
        btns.push(btn);
      }
    
    var titleBlock = promptInvokeBlocks.find(x => x.block_id === 'prompt_title');
    
    if (titleBlock) titleBlock.text.text = `Today's Exhibition: *${prompts.title}*`;
    
    var imageBlock = promptInvokeBlocks.find(x => x.block_id === 'prompt_image');
    
    if (imageBlock) {
      imageBlock.image_url = prompts.promptArtImageUrl.trim();
      imageBlock.alt_text = prompts.promptArtTitle;      
    }

    var promptBlock = promptInvokeBlocks.find(x => x.block_id === 'prompt_prompt');
    
    if (promptBlock) promptBlock.text.text = prompts.prompt;
    
    var buttonBlock = promptInvokeBlocks.find(x => x.block_id === 'word_buttons');
    
    if (buttonBlock) buttonBlock.elements = btns;
    
    const result = await app.client.chat.postMessage({
      token: team.bot_token,
      channel: channelId,
      blocks: [],
      attachments: [{ blocks: promptInvokeBlocks }],
      text: " "
    });
  } catch (error) {
    console.error(error);
  }
}

async function wordSelection(word, userId, botToken, body) {
  var prompts = getPrompts();
  
  try {
    // the only way to deepcopy in javascript, because you don't want to mess up the
    // blocks for everybody
    var promptInvokeBlocks = JSON.parse(JSON.stringify(prompt_invoke_template.blocks));

    // ugh, have to re-populate prompts in case app restarted
    var titleBlock = promptInvokeBlocks.find(x => x.block_id === 'prompt_title');
  
    if (titleBlock) titleBlock.text.text = `Today's Exhibition: *${prompts.title}*`;
    
    var imageBlock = promptInvokeBlocks.find(x => x.block_id === 'prompt_image');
    
    if (imageBlock) {
      imageBlock.image_url = prompts.promptArtImageUrl.trim();
      imageBlock.alt_text = prompts.promptArtTitle;      
    }

    var promptBlock = promptInvokeBlocks.find(x => x.block_id === 'prompt_prompt');
    
    if (promptBlock) promptBlock.text.text = prompts.prompt;
    // end re-pop

    promptInvokeBlocks.pop();
    
    const updateResult = await app.client.chat.update({
        token: botToken,
        ts: body.message.ts,
        channel: body.channel.id,
        blocks: [],
        attachments: [{ blocks: promptInvokeBlocks }],
        text: " "
      });
  } catch(ex) {
    console.log("!!!! trouble updating prompt for ", userId);
    console.error(ex);
  }

  const user = await stateGetUserData(userId);

  var wordIntro = `> <https://www.clevelandart.org/art/collection/search?search=${word}|${word}>`;  
  
  const artObjects = getArts(word);
  
  var targetIndex = getRndInteger(0, artObjects.length - 1);

  var featured = artObjects[targetIndex];

  // store info and status
  console.log("getting the art index of: " + targetIndex);
  
  var creators = formatCreators(featured.creators);
  
  user.keyword = word;
  user.awaitingTextResponse = true;
  user.awaitingQueryText = false;
  user.lastImgUrl = featured.image_assets.primary_image.web.url;
  user.lastImgCreator = creators;
  user.lastImgTitle = featured.title;
  user.artworkUrl = featured.url;
  user.textResponse = "";
  user.artIndex = targetIndex;
  
  stateSetUserData(userId, user);  
  
  // update selection block
  var promptSelectionBlocks = prompt_selection_template.blocks;
  var composedImageText = "";
  if (
    user.lastImgCreator &&
    user.lastImgCreator != ""
  ) {
    composedImageText =
      user.lastImgTitle +
      " by " +
      user.lastImgCreator;
  } else {
    composedImageText = user.lastImgTitle;
  }
  // replace with correct content
  for (var i = 0; i < promptSelectionBlocks.length; i++) {
    if (promptSelectionBlocks[i].block_id === "prompt_selection_img") {
      // promptSelectionBlocks[i].title.text = composedImageText;
      promptSelectionBlocks[i].image_url = user.lastImgUrl;
      promptSelectionBlocks[i].alt_text = composedImageText;
    }
    
    if (promptSelectionBlocks[i].block_id === "cma_button") {
      promptSelectionBlocks[i].elements[0].url = user.artworkUrl + '?utm_source=slack_prompt&utm_medium=slack&utm_campaign=artlens_for_slack';      
    }
  }

  try {
    const results = await retry(async () => {  
      const msg = await app.client.chat.postMessage({
        token: botToken,
        channel: user.chatChannelId,
        blocks: [  {
              "block_id": "prompt_intro",
              "type": "section",
              "text": {
                "type": "mrkdwn",
                "text": wordIntro
              }
            }  
        ],
        attachments: [{ blocks: promptSelectionBlocks }],
        text: " "
      });
    }, RETRY_OPTIONS);
  } catch (ex) {
    console.log("!! couldn't select word for user ", userId);
    console.error(ex);
  }
}

const notifyInstallsWithoutChannel = async () => {
  const teamIds = await stateGetTeamIds();
  
  for (const teamId of teamIds) {
    try {
      var team = await stateGetTeamData(teamId)
  
      var channels = await getBotChannels(team.bot_token, team.bot_user_id);

      if (channels.length == 0) {
        console.log("messaging this channel-less admin ", team.admin_user_id);
        
        const msg = await app.client.chat.postMessage({
          token: team.bot_token,
          channel: team.admin_user_id,
          blocks: [  {
                "type": "section",
                "text": {
                  "type": "mrkdwn",
                  "text": "Thank you for installing ArtLens for Slack. You must create a channel (we suggest *#artlens-daily-exhibition*) and invite the *@artlens* bot, as well as your team members, for this to work."
                }
              },
              {
                "type": "section",
                "text": {
                  "type": "mrkdwn",
                  "text": "For additional help, email us at ArtLensForSlack@clevelandart.org."
                }
              }                  
          ],
          text: "One more step!"
        });
      }
    } catch (ex) {
      console.log("!! error messaging this channel-less team", teamId);
      console.error(ex);
    }  
  }
}

// send generic notification to either
// * 'admin' = channel admin direct message (default)
// * 'users' = all users direct message
// * 'channel' = in channel
const sendNotification = async(msgType='admin', 
                                msg, 
                                closingMsg="We greatly appreciate all of our user’s feedback, and are continually looking for ways to improve this app. Please don’t hesitate to send comments, questions or feedback to artlensforslack@clevelandart.org.",
                                notification='Thank you for using ArtLens for Slack!') => {
  const teamIds = await stateGetTeamIds();

  console.log(`sending notification, msgType=${msgType}, msg=${msg}`);

  for (const teamId of teamIds) {
    const team = await stateGetTeamData(teamId);
    
    let channelIds;

    switch(msgType) {
      case 'users':
        channelIds = await getAllUsersInTeamChannel(team);
        break;
      case 'channel':
        const channels = await getBotChannels(team.bot_token, team.bot_user_id);
        const users = await getAllUsersInTeamChannel(team);
  
        if (channels.length == 0 || users.length == 0) {
          console.log(`No channel assigned, skipping notification for  ${teamId}`);
          channelIds = [];
        } else {
          channelIds = [channels[0].id];
        }

        break;
      default:
        channelIds = [team.admin_user_id];
    }

    if (channelIds.length > 0) {
      console.log(`sending to team ${teamId}, channels ${channelIds}`);  
    }

    for (const channelId of channelIds) {
      const message = await app.client.chat.postMessage({
        token: team.bot_token,
        channel: channelId,
        blocks: [
        {
          "type": "section",
          "text": {
            "type": "mrkdwn",
            "text": ":art: To our ArtLens for Slack users:"
          }
        },
        {
          "type": "section",
          "text": {
            "type": "mrkdwn",
            "text": msg
          }
        },
        {
          "type": "section",
          "text": {
            "type": "mrkdwn",
            "text": closingMsg
          }
        },
        {
          "type": "section",
          "text": {
            "type": "mrkdwn",
            "text": "--Cleveland Museum of Art, Digital Innovation and Tech Service Dept"
          }
        }      
      ],
      text: "Thank you for using Artlens for Slack!"
      })
      .catch((error) => {
        console.log(`Error messaging type ${msgType} for channel ${channelId}`);
        console.log(error);
      });
    }
  }
}

const testFn = async () => {
  console.log("### TESTING ###");
  const teamIds = await stateGetTeamIds();
  
  for (const teamId of teamIds) {
    try {
      var team = await stateGetTeamData(teamId)
  
      var channels = await getBotChannels(team.bot_token, team.bot_user_id);
    
      console.log(teamId, team.team_name, channels);
      
      var users = await getAllUsersInTeamChannel(team);
      var participants = team.users.filter(u => {return u.current_state && u.current_state.lastImgUrl});      
      
      console.log("channel users ", users);
      console.log("num participants ", participants.length);
    } catch (ex) {
      console.log("!!! COULDN'T GET TEAM INFO FOR ", teamId);
      console.error(ex);
    }
  }
  console.log("prompt ", getPrompts());
  for (const key in promptData.artworks) {
    console.log("num results ", key, promptData.artworks[key].length);
  }

  return true;
}


/*
 * MESSAGE HANDLERS
 */


// Record after asking for response
app.message("", async ({ message, payload, context, say }) => {
  var userId = payload.user;
  var teamId = payload.team;
  
  var user = await stateGetUserData(userId);
  
  // don't handle any input if user hasn't hit query button.
  if (!user || user.awaitingQueryText) {
    return;
  }
  
  // verbose for testing
  var rawUserInput = message.text;

  console.log(`user response: ${rawUserInput}, user id: ${message.user}`);

  // wait for artwork comment
  if (user.awaitingTextResponse) {
    console.log("record user input from: " + message.user);
    await say(
      `> Got it, <@${message.user}>! _${user.lastImgTitle}_ and your comment will be featured in today's exhibit.`
    );
    
    user.awaitingTextResponse = false;
    user.awaitingArtworkSelection = false;
    user.textResponse = rawUserInput;

    stateSetUserData(userId, user);

    return;
  } else {
    // REMOVE textResponse = "";
  }
});

// Cancel everything by responding the actual word
app.message("cancel", async ({ message, say }) => {
  // this method looks for the word 'cancel' in a message...
  // ...make sure that's the only thing in the message
  if (message.text.toLowerCase() == "cancel") {
    var userId = message.user;
    
    const results = await stateDeleteUserData(userId);

    if (results) {
      await say(`Your selection has been canceled.`);
    }
  }
});


/*
 * ACTIONS
 */

// Listen for a button invocation with action_id `choice_button_[index]`
// You must set up a Request URL under Interactive Components on your app configuration page
var numChoices = 5;
for (var i = 0; i < numChoices; i++) {
  var actionId = "choice_button_" + i.toString();
  app.action(actionId, async ({ ack, payload, body, context }) => {
    var userId = body.user.id;
    var teamId = body.team.id;

    var user = await stateGetUserData(userId);
    
    // Acknowledge the button request
    ack();
    
    // TODO: this is how it should *all* work, does userData content exist, not
    // in "awaiting*" flags
    if (!user.keyword) {
      wordSelection(payload.value , userId, context.botToken, body);
    } 
  });
}

// Listen for a button invocation with action_id `visit_button`
app.action("visit_button", async ({ ack, body, context }) => {
  var userId = body.user.id;
	
  var user = await stateGetUserData(userId);
	
  // Acknowledge the button request
  ack();

  user.numVisits++;
	
  stateSetUserData(userId, user);
	
});

// Listen for a button invocation with action_id `shuffle_button`
app.action("shuffle_button", async ({ ack, body, context }) => {
  var userId = body.user.id;
  
  var user = await stateGetUserData(userId);
    
  // Acknowledge the button request
  ack();

  // disable button if user has answered
  if (
    user.textResponse &&
    user.textResponse.length > 0
  ) {
    return;
  }
  
  var wordIntro = `> <https://www.clevelandart.org/art/collection/search?search=${user.keyword}|${user.keyword}>`;  

  const artObjects = await getArts(user.keyword);
  
  var targetIndex = (user.artIndex < artObjects.length-1) ? ++user.artIndex : 0;
  
  var featured = artObjects[targetIndex];

  console.log("getting the next art index of: " + targetIndex);
  
  var creators = formatCreators(featured.creators);

  user.awaitingTextResponse = true;
  user.lastImgUrl = featured.image_assets.primary_image.web.url;
  user.lastImgCreator = creators;
  user.lastImgTitle = featured.title;
  user.artworkUrl = featured.url;
  user.artIndex = targetIndex;
  user.numShuffle++;
  
  stateSetUserData(userId, user);
  
  // update selection block
  var promptSelectionBlocks = prompt_selection_template.blocks;
  // replace with correct content

  var composedImageText = "";
  if (
    user.lastImgCreator &&
    user.lastImgCreator != ""
  ) {
    composedImageText =
      user.lastImgTitle +
      " by " +
      user.lastImgCreator;
  } else {
    composedImageText = user.lastImgTitle;
  }

  for (var i = 0; i < promptSelectionBlocks.length; i++) {
    if (promptSelectionBlocks[i].block_id === "prompt_selection_img") {
      // promptSelectionBlocks[i].title.text = composedImageText;
      promptSelectionBlocks[i].image_url = user.lastImgUrl;
      promptSelectionBlocks[i].alt_text = composedImageText;
    }
    
    if (promptSelectionBlocks[i].block_id === "cma_button") {
      promptSelectionBlocks[i].elements[0].url = user.artworkUrl + '?utm_source=slack_prompt&utm_medium=slack&utm_campaign=artlens_for_slack';      
    }    
  }

  try {
    const results = await retry(async () => {  
      const msg = await app.client.chat.update({
        token: context.botToken,
        ts: body.message.ts,
        channel: body.channel.id,
        blocks: [{
              "block_id": "prompt_intro",
              "type": "section",
              "text": {
                "type": "mrkdwn",
                "text": wordIntro
              }
            }  
        ],
        attachments: [{ blocks: promptSelectionBlocks }],
        text: " "
      });
    }, RETRY_OPTIONS);
  } catch (error) {
    console.error(error);
  }
});

// Listen for a button invocation with action_id `confirm_button`
// You must set up a Request URL under Interactive Components on your app configuration page
app.action("confirm_button", async ({ ack, body, context }) => {
  var userId = body.user.id;
  
  var user = await stateGetUserData(userId);
  
  // Acknowledge the button request
  ack();

  // disable button if user has answered
  if (
    user.textResponse &&
    user.textResponse.length > 0
  ) {
    return;
  }

  var wordIntro = `> <https://www.clevelandart.org/art/collection/search?search=${user.keyword}|${user.keyword}>`;  
  
  try {
    user.awaitingTextResponse = true;

    stateSetUserData(userId, user);
    
    var composedImageText = "";
    if (
      user.lastImgCreator &&
      user.lastImgCreator != ""
    ) {
      composedImageText =
        user.lastImgTitle +
        " by " +
        user.lastImgCreator;
    } else {
      composedImageText = user.lastImgTitle;
    }

    // update selection block
    var confirmImageBlocks = confirm_image_template.blocks;
    // replace with correct content
    for (var i = 0; i < confirmImageBlocks.length; i++) {
      if (confirmImageBlocks[i].block_id === "confirm_image") {
        // confirmImageBlocks[i].title.text = composedImageText;
        confirmImageBlocks[i].image_url = user.lastImgUrl;
        confirmImageBlocks[i].alt_text = composedImageText;
      }
      
      if (confirmImageBlocks[i].block_id === "cma_button") {
        confirmImageBlocks[i].elements[0].url = user.artworkUrl + '?utm_source=slack_prompt&utm_medium=slack&utm_campaign=artlens_for_slack';      
      }      
    }

    // Update the message
    const results = await retry(async () => {  
      const result = await app.client.chat.update({
        token: context.botToken,
        ts: body.message.ts,
        channel: body.channel.id,
        blocks: [{
              "block_id": "prompt_intro",
              "type": "section",
              "text": {
                "type": "mrkdwn",
                "text": wordIntro
              }
            }  
        ],
        attachments: [{ blocks: confirmImageBlocks }],
        text: " "
      });
    }, RETRY_OPTIONS);
  } catch (ex) {
    console.log("!! error confirming artwork for ", userId);
    console.error(ex);
  }
});

//onboarding
app.event("app_home_opened", async ({ context, event, say }) => {
  var welcome = {
    "welcome": {
      "text": "Welcome to ArtLens for Slack",
      "blocks": [
        {
          "type": "section",
          "text": {
            "type": "mrkdwn",
            "text": "Welcome to ArtLens for Slack :art: an app where the Cleveland Museum of Art curates daily exhibitions from you and your team. Getting started is simple, here’s what you’ll need to do:"
          }
        },
        {
          "type": "section",
          "text": {
            "type": "mrkdwn",
            "text": "• You must create a channel (we suggest *#artlens-daily-exhibition*) and invite the *@artlens* bot, as well as your team members, for this to work."
          }
        },
        {
          "type": "section",
          "text": {
            "type": "mrkdwn",
            "text": "• Invite ArtLens to your selected channel with the command `/invite @artlens`."
          }
        },        
        {
          "type": "section",
          "text": {
            "type": "mrkdwn",
            "text": "• Stay tuned for daily prompts, Mon-Fri at 9am ET, in the form of direct messages from *@artlens*."
          }
        },        
        {
          "type": "section",
          "text": {
            "type": "mrkdwn",
            "text": "• Select an artwork based on the prompt and share your thoughts."
          }
        },        
        {
          "type": "section",
          "text": {
            "type": "mrkdwn",
            "text": "• At 5pm ET every weekday, go check out your team's artworks and comments on *#artlens-daily-exhibition* (or your selected channel)."
          }
        }     
      ]
    }
  }

  if (event.tab === "messages") {
    // check the message history if there was a prior interaction for this App DM
    let history = await app.client.conversations.history({
      token: context.botToken,
      channel: event.channel,
      count: 1 // we only need to check if >=1 messages exist
    });

    // if there was no prior interaction (= 0 messages),
    // it's save to send a welcome message
    if (!history.messages.length) {
      say(welcome.welcome);
    }
  }
});

/*
 * APP STARTUP
 */

(async () => {
  // Start your app
  await app.start(process.env.PORT || 3000);
  
  promptData = initializePromptData(); 
  
  console.log("⚡️ Bolt app is running!");
})();
