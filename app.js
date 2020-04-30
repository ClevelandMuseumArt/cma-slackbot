// This the cma slack bot prototype
// Require the Bolt package (github.com/slackapi/bolt)
const { App, ExpressReceiver } = require("@slack/bolt");
const axios = require("axios");
const dotenv = require("dotenv");
const logts = require("log-timestamp");

// block templates
var exhibit_header_template = require("./exhibit_header_template.json");
var exhibit_footer_template = require("./exhibit_footer_template.json");
var exhibit_template = require("./exhibit_template.json");
var exhibit_template2 = require("./exhibit_template2.json");
var home_template = require("./app_home_template.json");
var prompt_invoke_template = require("./prompt_invoke_template_multi.json");
var prompt_selection_template = require("./prompt_selection_template.json");
var confirm_image_template = require("./confirm_image_template.json");

dotenv.config();

const slackBotApiUrl = process.env['SLACK_BOT_API_URL'];
const openaccessUrl = process.env['OPENACCESS_URL'];

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

// command endpoints
receiver.app.get('/test', (req, res) => {  
  if (req.headers.authentication == process.env['SLACK_BOT_API_TOKEN']) {
    testFn(); 
  
    res.json({"fn":"test"}); 
  } else {
    res.sendStatus(401);
  }
});

receiver.app.get('/trigger-prompt', (req, res) => { 
  if (req.headers.authentication == process.env['SLACK_BOT_API_TOKEN']) {  
    triggerPrompt(); 
    res.json({"fn":"trigger-prompt"}); 
  } else {
    res.sendStatus(401);
  }                                                  
});

receiver.app.get('/trigger-exhibition', (req, res) => { 
  if (req.headers.authentication == process.env['SLACK_BOT_API_TOKEN']) {    
    triggerExhibition(); 
    res.json({"fn":"trigger-exhibition"}); 
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
var prompts = [];
const promptsUrl = process.env["PROMPT_URL"];
async function getAllPrompts() {
  var result = await axios.get(promptsUrl);
  prompts = result.data;
}
getAllPrompts();

const initializePromptData = () => {
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
        
        axios.get(`${openaccessUrl}?q=${thisQuery}&has_image=1&limit=500&limit_depts_to=${limitDeptTo}`)
          .then((res) => {
            promptData.artworks[choice.text] = res.data.data;
          });
        
      } 
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
      if (user.lastImgUrl) {
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
  
  const results = await axios.delete(url);
  
  return results.data; 
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
    var resp = await axios.post(slackBotApiUrl, req);

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
      console.log("lots of creators");
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


async function triggerExhibition() {
  var teamIds = await stateGetTeamIds();
  
  for (const teamId of teamIds) {
    try {
      if (hasExhibitParticipants(teamId)) {
        await exhibitionMessage(teamId, 0); // with no additional delay
      } else {
        console.log("No exhibit participants for team ", teamId);
      }
    } catch (ex) {
      console.log("!! COULDN'T TRIGGER EXHIBITION FOR TEAM ", teamId);
      console.error(ex.message);
    }
  }
}


async function triggerPrompt() {
  var teamIds = await stateGetTeamIds();  
  
  for (const teamId of teamIds) { 
    var team = await stateGetTeamData(teamId);
    
    // we have the option to just loop through users who participated
    var users = await getAllUsersInTeamChannel(team);
    
    if (users.length == 0) {
      console.log(`No channel assigned, skipping prompts for  ${teamId}`);
    }
    
    for (const user of users) {
      // use userid as channel id to dm
      await promptInvoke(user, teamId, user);
    }
  }
}


async function exhibitionMessage(teamId, delayedMins) {
  const team = await stateGetTeamData(teamId);
  const channels = await getBotChannels(team.bot_token, team.bot_user_id);
  
  if (channels.length == 0 || team.users.length == 0) {
    console.log(`No channel assigned, skipping exhibition for  ${teamId}`);
    return;
  }
  
  const channel = channels[0];

  // just get delayed reponse
  delayedMins += 0.2; // to safe guard if delayedMins were 0;
  const secondsSinceEpoch = Date.now() / 1000;
  var scheduledTime = secondsSinceEpoch + delayedMins * 60.0; // 10 sec from now
  console.log("current time " + secondsSinceEpoch);
  console.log("delayed to time"  + scheduledTime);
  console.log(`SEND TO CHANNEL ${channel.name}`);

  // prompt variables
  var prompts = getPrompts();

  // talking to api
  var slackbotId = `id-${teamId}-${channel.id}-${scheduledTime}`;
  var data = {
    state: team
  };

  await writeExhibitionToAPI(slackbotId, data);

  // update header block
  var headerBlocks = exhibit_header_template.blocks;
  
  // replace with correct content
  for (var i = 0; i < headerBlocks.length; i++) {
    if (headerBlocks[i].block_id === "header_title") {
      headerBlocks[i].text.text = "*" + prompts.title + "*";
    }
    if (headerBlocks[i].block_id === "header_credits") {
      var creditString = "";
      
      for (var user of team.users) {
        if (user.current_state.textResponse && user.current_state.textResponse != "") {
          creditString = creditString.concat(`<@${user.user_id}>, `);
        }
      }

      // insert credits if user response exists
      if (creditString != "") {
        headerBlocks[i].text.text =
          "Today's exhibition is curated by " +
          creditString +
          "and the <https://www.clevelandart.org|Cleveland Museum of Art>. Come take a look.";
      } else {
        headerBlocks[i].text.text =
          "Today's exhibition is curated by the <https://www.clevelandart.org|Cleveland Museum of Art>. Come take a look.";
      }
    }
    if (headerBlocks[i].block_id === "header_prompt") {
      headerBlocks[i].text.text = prompts.resultPrompt;
    }
    if (headerBlocks[i].block_id === "header_image") {
      // headerBlocks[i].title.text = prompts.promptArtTitle;
      headerBlocks[i].image_url = prompts.promptArtImageUrl;
      headerBlocks[i].alt_text = prompts.promptArtTitle;
    }
    // TODO: This pushes everything below fold...figure this out
    // if (userBlocks[i].block_id === "cma_button") {
    //         userBlocks[i].elements[0].url = artworkUrl; //cma website
    //       }
  }
  
  try {
    // the delayed opening statement
    // Call the chat.scheduleMessage method with a token
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
        var userBlocks = exhibit_template2.blocks;

        userBlocks[1].title.text = userResponse;
        userBlocks[1].alt_text = artworkLabel;
        userBlocks[1].image_url = artworkImg;
        userBlocks[2].elements[0].url = artworkUrl; //cma website

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
            console.error(ex.message);
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
        console.error(ex.message);
      } 
    }
    
    // update footer block
    var footerBlocks = exhibit_footer_template.blocks;
    // replace with correct content
    for (var i = 0; i < footerBlocks.length; i++) {
      if (footerBlocks[i].block_id === "footer_title") {
        footerBlocks[i].text.text = prompts.resultPromptConclusion;
      }
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
      await sendExhibitionStarted(teamId, scheduledTime+20);
    } catch(ex) {
      console.log("!! COULDNT SEND MESSAGES TO TEAM ", teamId);
      console.error(ex.message);
    }
    
    // Only clear data on success
    // TODO: ...do we want to rethink that
    await stateClearUserData(teamId);    
  } catch (error) {
    console.error(error);
  }
}

async function sendExhibitionStarted(teamId, scheduledTime) {
  console.log("Exhibition started message");
  
  const team = await stateGetTeamData(teamId);
  const channels = await getBotChannels(team.bot_token, team.bot_user_id);
  
  for (const user of team.users) {
    try {
      const intro = await app.client.chat.scheduleMessage({
          token: team.bot_token,
          channel: user.current_state.chatChannelId,
          post_at: scheduledTime,
          blocks: [
            {
              "block_id": "exhibition_concluded_msg",
              "type": "section",
              "text": {
                "type": "mrkdwn",
                "text": `> *Today's exhibition has started on the #${channels[0].name} channel*`
              }
            }        
          ],
          // Text in the notification
          text: "Today's exhibition has started"
        }); 
      console.log("SEND STARTED TO ", user.current_state.chatChannelId);
    } catch(ex) {
      console.log("!! COULDN'T SEND EXHIBITION MESSAGE TO ", user.user_id);
      console.error(ex.message);
    }
  }  
}

// this is where the prompt message is composed
async function promptInvoke(channelId, teamId, userId) {
  var team = await stateGetTeamData(teamId);
  
  console.log(">> invoking prompt with channelId, teamId, userId ", channelId, teamId, userId);
  
  var currentState = {
      chatChannelId: channelId,
      awaitingTextResponse: false,
      awaitingArtworkSelection: true,
      awaitingQueryText: true
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
    
    // replace with correct content
    for (var i = 0; i < promptInvokeBlocks.length; i++) {
      if (promptInvokeBlocks[i].block_id === "prompt_intro") {
        promptInvokeBlocks[i].text.text = "Today's Exhibition:";
      }
      if (promptInvokeBlocks[i].block_id === "prompt_title") {
        promptInvokeBlocks[i].text.text = `*${prompts.title}*`;
      }
      if (promptInvokeBlocks[i].block_id === "prompt_image") {
        // promptInvokeBlocks[i].title.text = prompts.promptArtTitle;
        promptInvokeBlocks[i].image_url = prompts.promptArtImageUrl;
        promptInvokeBlocks[i].alt_text = prompts.promptArtTitle;
      }
      
      if (promptInvokeBlocks[i].block_id === "prompt_prompt") {
        promptInvokeBlocks[i].text.text = prompts.prompt ;
      }
      
      if (promptInvokeBlocks[i].block_id === "word_buttons") {
        promptInvokeBlocks[i].elements = btns;
      }      
    }

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

async function wordSelection(word, userId, botToken) {
  const user = await stateGetUserData(userId);

  var wordIntro = `> <https://www.clevelandart.org/art/collection/search?search=${word}|${word}>`;  
  
  const intro = await app.client.chat.postMessage({
      token: botToken,
      channel: user.chatChannelId,
      blocks: [
        {
          "block_id": "prompt_intro",
          "type": "section",
          "text": {
            "type": "mrkdwn",
            "text": wordIntro
          }
        }        
      ],
      text: " "
    });  

  const artObjects = getArts(word);
  
  var targetIndex = getRndInteger(0, artObjects.length - 1);

  var featured = artObjects[targetIndex];

  // store info and status
  console.log("getting the art index of: " + targetIndex);
  
  var creators = formatCreators(featured.creators);
  
  user.keyword = word;
  user.awaitingTextResponse = true;
  user.awaitingQueryText = false;
  user.lastImgUrl = featured.images.web.url;
  user.lastImgCreator = creators;
  user.lastImgTitle = featured.title;
  user.artworkUrl = featured.url;
  user.textResponse = "";
  
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
      promptSelectionBlocks[i].elements[0].url = user.artworkUrl;      
    }
  }

  try {
    const result = await app.client.chat.postMessage({
      token: botToken,
      channel: user.chatChannelId,
      blocks: [],
      attachments: [{ blocks: promptSelectionBlocks }],
      text: " "
    });
  } catch (error) {
    console.error(error);
  }
}

async function getIfAdmin(userId, context) {
  var isAdmin = false;
  
  return (process.env.ADMIN_USERS.split('|').includes(userId));
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
      console.log("channel users ", users);
      console.log("num participants ", team.users.length);
    } catch (ex) {
      console.log("!!! COULDN'T GET TEAM INFO FOR ", teamId);
      console.error(ex.message);
    }
  }

  
  return true;
}


/*
 * MESSAGE HANDLERS
 */


// Record after asking for response
app.message("", async ({ message, payload, context, say }) => {
  console.log(message.text);
  
  var userId = payload.user;
  var teamId = payload.team;
  
  var user = await stateGetUserData(userId);
  
  // don't handle any input if user hasn't hit query button.
  if (!user || user.awaitingQueryText) {
    return;
  }
  
  // verbose for testing
  // TODO: don't need to escape ALL user input
  var rawUserInput = message.text;
  var escapedInput = rawUserInput.replace(
    /[\`\#\;\%\$\@\!\*\+\-\=\<\>\&\|\(\)\[\]\{\}\^\~\?\:\\/"]/g,
    ""
  );
  console.log(`escaped user input: ${escapedInput}`);

  var isAdmin = await getIfAdmin(userId, context);

  // cancel
  console.log(`user response: ${rawUserInput}, user id: ${message.user}`);

  // TODO: fix cancel
  if (escapedInput == "cancel") {
    stateDeleteUserData(userId);

    say(`Your selection have been canceled.`);
    return;
  }

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
    
    // all responses were collected, scheduling message
    const secondsSinceEpoch = Date.now() / 1000;
    var scheduledTime = secondsSinceEpoch + 15; // 10 sec from now

    return;
  } else {
    // REMOVE textResponse = "";
  }

  
  //TODO: DO WE NEED THIS?
  // for artwork selection
  if (user.awaitingArtworkSelection) {
    console.log("AM I EVEN HITTING THIS?");
    
    // key confirmation, also links to a search on cma's website
    await say(
      "> " +
        "<" +
        "https://www.clevelandart.org/art/collection/search?search=" +
        escapedInput +
        "|" +
        rawUserInput +
        ">"
    );
    // await to get results
    const artObjects = await getArts(escapedInput);

    var targetIndex = getRndInteger(0, artObjects.length - 1);

    var featured = artObjects[targetIndex];

    // store info and status
    console.log("getting the art index of: " + targetIndex);
    
    var creators = formatCreators(featured.creators);
    
    user.awaitingTextResponse = true;
    user.keyword = escapedInput;
    user.lastImgUrl = featured.images.web.url;
    user.lastImgCreator = creators;
    user.lastImgTitle = featured.title;
    user.artworkUrl = featured.url;
    user.textResponse = "";
    
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
    }

    // create a block
    try {
      const result = await app.client.chat.postMessage({
        token: context.botToken,
        // Channel to send message to
        channel: user.chatChannelId,
        // Main art selection interaction
        blocks: [],
        attachments: [{ blocks: promptSelectionBlocks }],
        // Text in the notification
        text: " "
      });
    } catch (error) {
      console.error(error);
    }
  }
});

// Cancel everything by responding the actual word
app.message("cancel", async ({ message, say }) => {
  var userId = message.user;
  
  stateDeleteUserData(userId);

  await say(`Your selection have been canceled.`);
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
      wordSelection(payload.value , userId, context.botToken);
    } 
  });
}

// Listen for a button invocation with action_id `visit_button`
app.action("visit_button", async ({ ack, body, context }) => {
  // Acknowledge the button request
  ack();

  // ack() and do nothing. this should get rid of the exclamation mark
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

  const artObjects = await getArts(user.keyword);

  var targetIndex = getRndInteger(0, artObjects.length - 1);
  
  var featured = artObjects[targetIndex];

  console.log("getting the next art index of: " + targetIndex);
  
  var creators = formatCreators(featured.creators);

  user.awaitingTextResponse = true;
  user.lastImgUrl = featured.images.web.url;
  user.lastImgCreator = creators;
  user.lastImgTitle = featured.title;
  user.artworkUrl = featured.url;
  
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
      promptSelectionBlocks[i].elements[0].url = user.artworkUrl;      
    }    
  }

  try {
    // Update the message
    const result = await app.client.chat.update({
      token: context.botToken,
      // ts of message to update
      ts: body.message.ts,
      // Channel of message
      channel: body.channel.id,
      blocks: [],
      attachments: [{ blocks: promptSelectionBlocks }],
      text: " "
    });
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

  try {
    // reaffirm status
    //adding state
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
        confirmImageBlocks[i].elements[0].url = user.artworkUrl;      
      }      
    }

    // Update the message
    const result = await app.client.chat.update({
      token: context.botToken,
      ts: body.message.ts,
      channel: body.channel.id,
      blocks: [],
      attachments: [{ blocks: confirmImageBlocks }],
      text: " "
    });
  } catch (error) {
    console.error(error);
  }
});


//onboarding
app.event("app_home_opened", async ({ context, event, say }) => {

  var welcome = {
    "welcome": {
      "text": "Please connect your calendar to Calendar App.",
      "blocks": [
        {
          "type": "section",
          "text": {
            "type": "mrkdwn",
            "text": "Hi there :wave:"
          }
        },
        {
          "type": "section",
          "text": {
            "type": "mrkdwn",
            "text": "Welcome to ArtLensSlacker :art: an app where the Cleveland Museum of Art curates daily exhibitions from you and your team. Getting started is simple, here’s what you’ll need to do:"
          }
        },
        {
          "type": "section",
          "text": {
            "type": "mrkdwn",
            "text": "• Go to the channel where you’d like to post your team’s exhibitions. We recommend using #general, #random, or any channel your whole team shares."
          }
        },
        {
          "type": "section",
          "text": {
            "type": "mrkdwn",
            "text": "• Invite ArtLensSlacker to your selected channel with the command `/invite @artlens-slacker` "
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
