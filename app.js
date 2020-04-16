// This the cma slack bot prototype
// Require the Bolt package (github.com/slackapi/bolt)
const { App } = require("@slack/bolt");
var XMLHttpRequest = require("xmlhttprequest").XMLHttpRequest;
const fetch = require("node-fetch");
const axios = require("axios");
const dotenv = require("dotenv");
const logts = require("log-timestamp");
const util = require("./utilities.js");

// block templates
var exhibit_header_template = require("./exhibit_header_template.json");
var exhibit_footer_template = require("./exhibit_footer_template.json");
var exhibit_template = require("./exhibit_template.json");
var home_template = require("./app_home_template.json");
// var prompt_invoke_template = require("./prompt_invoke_template.json");
var prompt_invoke_template = require("./prompt_invoke_template_multi.json");
var prompt_selection_template = require("./prompt_selection_template.json");
var confirm_image_template = require("./confirm_image_template.json");

// content
var prompts = require("./prompts.json");

dotenv.config();

const authorizeFn = async ({teamId}) => {
  return {
    botToken: process.env['SLACK_BOT_TOKEN_'+teamId],
    botId: process.env['SLACK_BOT_ID_'+teamId],
    botUserId: process.env['SLACK_BOT_USER_ID_'+teamId]
  };
}

const app = new App({authorize: authorizeFn, signingSecret: process.env.SLACK_SIGNING_SECRET});

// scheduling varaibles
const secondsInADay = 86400;
const intervalOfScheduledExhibit = secondsInADay; //in seconds
var exhibitScheduled = false;
var scheduledPromptLocalDate; // TODO: needs to be updated in the intervals
var scheduledExhibitLocalDate; // TODO: needs to be updated in the intervals
var scheduledExhibitInterval; // setInterval
var scheduledPromptInterval; // setInterval
var scheduledExhibitTimeout; // setTimeout
var scheduledPromptTimeout; // setTimrout

var lastArtIndex = 0;
var postChannelId = "";
var promptIndex = 1;
//var chatChannelId = ""; // QUESTION: put in user data?


var userData = {};
function getUserData(
  userId,
  chatChannelId,
  awaitingTextResponse,
  awaitingArtworkSelection,
  keyword,
  lastImgUrl,
  lastImgCreator,
  lastImgTitle,
  artworkUrl,
  textResponse,
  lastUser
) {
  // Does user's record exist in userData yet?
  if (!(userId in userData)) {
    userData[userId] = {
      // awaitingTextResponse: false,
      // awaitingArtworkSelection: true,
      // // lastImgUrl: "",
      // lastImgCreator: "",
      // lastImgTitle: "",
      // // artworkUrl: "",
      // textResponse: ""
    };
    console.log("adding new user");
  }
  // replace/update user data, check if undefined.
  userData[userId].chatChannelId =
    chatChannelId || userData[userId].chatChannelId;
  userData[userId].awaitingTextResponse =
    awaitingTextResponse !== undefined
      ? awaitingTextResponse
      : userData[userId].awaitingTextResponse;
  userData[userId].awaitingArtworkSelection =
    awaitingArtworkSelection !== undefined
      ? awaitingArtworkSelection
      : userData[userId].awaitingArtworkSelection;
  userData[userId].keyword = keyword || userData[userId].keyword;
  userData[userId].lastImgUrl = lastImgUrl || userData[userId].lastImgUrl;
  userData[userId].lastImgCreator =
    lastImgCreator || userData[userId].lastImgCreator;
  userData[userId].lastImgTitle = lastImgTitle || userData[userId].lastImgTitle;
  userData[userId].artworkUrl = artworkUrl || userData[userId].artworkUrl;
  userData[userId].textResponse = textResponse || userData[userId].textResponse;
  userData[userId].lastUser = lastUser || userData[userId].lastUser;

  return userData[userId];
}

// get json result
// use xmlhttp only to get result at the very beginning (good for the random function). use axios for async
var xmlhttp = new XMLHttpRequest();
const testUrl =
  "https://openaccess-api.clevelandart.org/api/artworks/?has_image=1&limit=100";

const gameUrl = "https://openaccess-api.clevelandart.org/api/slackbot/";
const openaccessUrl = "https://openaccess-api.clevelandart.org/api/artworks/";

xmlhttp.onreadystatechange = function() {
  if (this.readyState == 4 && this.status == 200) {
    var myArr = JSON.parse(this.responseText);
    getTestData(myArr);
  }
};
xmlhttp.open("GET", testUrl, true);
xmlhttp.send();

const writeToAPI = async (slackbotId, data) => {
  var req = {
    slackbot_id: slackbotId,
    data: data
  };

  try {
    var resp = await axios.post(gameUrl, req);

    console.log("POST data to API");
    console.log(req);
  } catch (error) {
    console.log(error);
  }
};

const getPrompts = () => {
  return prompts[promptIndex];
};

const getArts = async keyword => {
  var limit = 50;
  var prompt = getPrompts();
  
  var parsedKeyword = keyword.replace(/:/g, "");
  
  if (prompt.substitutions && prompt.substitutions[parsedKeyword]) {
    parsedKeyword = prompt.substitutions[parsedKeyword];
  }
  
  var query = prompt.queryPattern.replace(/__keyword__/g, parsedKeyword);

  console.log(query);
  
  var artworks = [];

  try {
    var url = `${openaccessUrl}?q=${query}&has_image=1&limit=${limit}`;
    console.log("getting from: " + url);
    var results = await axios.get(url);

    if (results.data.info.total == 0) {
      query = parsedKeyword;

      url = `${openaccessUrl}?q=${query}&has_image=1&limit=${limit}`;
      console.log("NO RESULTS, using keyword only, getting from: " + url);
      results = await axios.get(url);
    }

    if (results.data.info.total == 0) {
      query = prompt.defaultQuery;

      url = `${openaccessUrl}?q=${query}&has_image=1&limit=${limit}`;
      console.log(
        "STILL NO RESULTS, using default query, getting from: " + url
      );
      results = await axios.get(url);
    }

    artworks = results.data.data;
    
    console.log(artworks.length + " RESULTS");
  } catch (error) {
    console.log(error);
  }

  return artworks;
};

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

var arrayOfObjects;

function getTestData(arr) {
  arrayOfObjects = arr.data;
}

function getItem(id) {
  return arrayOfObjects.find(item => item.id === id).title;
}

function getRandomItem() {
  var size = arrayOfObjects.length;
  var index = getRndInteger(0, size - 1);
  
  return arrayOfObjects[index];
}

function getItemByIndex(index) {
  return arrayOfObjects[index];
}

function getRndInteger(min, max) {
  return Math.floor(Math.random() * (max - min)) + min;
}

function getNextRndInteger(src, min, max) {
  var out = Math.floor(Math.random() * (max - min)) + min;
  while (src === out) {
    out = Math.floor(Math.random() * (max - min)) + min;
  }
  return out;
}

// Just an state test
app.message("seestate", async ({ message, say }) => {
  console.info("##########STATE##########");
  console.info("channelId: " + postChannelId);
  console.info("promptIndex: " + promptIndex);
  console.info(userData);
  console.info("#########################");
});

//-----------------end-------------------------------------------
// Listens to incoming messages that contain "random"
app.message("random", ({ message, say }) => {
  var item = getRandomItem();
  say({
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "We picked a random art for you: \n" + "*" + item.title + "*"
        }
      },
      {
        type: "image",
        // title: {
        //   type: "plain_text",
        //   text: "title" + item.title, // title on top of the image
        //   emoji: true
        // },
        image_url: item.images.web.url,
        alt_text: "alt" + item.title // title when zoomed
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "Take me to that art on CMA's website! "
        },
        accessory: {
          type: "button",
          text: {
            type: "plain_text",
            text: "Visit Artwork",
            emoji: true
          },
          url: item.url,
          action_id: "visit_button"
        }
      }
    ]
  });
});

//----------------------------------------
// save current channel as default post channel
app.command(
  "/cma_default_channel",
  async ({ ack, payload, context, say, command }) => {
    // Acknowledge the command request
    ack();

    //// check if user is admin
    //     var isAdmin = await getIfAdmin(payload.user_id, context);

    //     if (!isAdmin){
    //       await say("Hi! Only admin can do this");
    //       return;
    //     }

    // list all users
    getAllUsersInChannel(context, payload.channel_id);

    // print current channel id
    console.log("current channel: " + payload.channel_id);

    // save channel id for the exhibit
    postChannelId = payload.channel_id;
  }
);

// returns list of users in a channel
async function getAllUsersInChannel(context, channelId) {
  var users;
  // get user list in channel
  try {
    // Call the conversations.members method using the built-in WebClient
    const result = await app.client.conversations.members({
      // The token you used to initialize your app is stored in the `context` object
      token: context.botToken,
      channel: channelId
    });
    users = result.members;
  } catch (error) {
    console.error(error);
  }

  console.log(`Getting users for channel: ${channelId}`, users);

  // making sure only real users are included
  for (var i = users.length - 1; i >= 0; i--) {
    // to get user info
    try {
      // Call the users.info method using the built-in WebClient
      const result = await app.client.users.info({
        // The token you used to initialize your app is stored in the `context` object
        token: context.botToken,
        // Call users.info for the user that joined the workspace
        user: users[i]
      });

      // check if user is bot, if it is, discard
      if (result.user.is_bot) {
        console.log(`discard ${users[i]}`);
        users.splice(i, 1);
      }
    } catch (error) {
      console.error(error);
    }
  }

  console.dir(users);
  return users;
}

function formatDate(date) {
  return (
    date.getFullYear() +
    "/" +
    (date.getMonth() + 1) +
    "/" +
    date.getDate() +
    " " +
    date.getHours() +
    ":" +
    date.getMinutes()
  );
}

function getUserDate(tz_offset) {
  // What is going on here? - EH

  var d = new Date();
  var withUserOffset = d.getTime() / 1000 + tz_offset;
  return new Date(withUserOffset * 1000);
}

async function scheduledPost(context) {
  // just get delayed reponse
  await exhibitScheduledMessage(context, 0); // with no additional delay
}

async function calculateScheduledDate(
  userId,
  context,
  say,
  hoursOfTheDay,
  offsetInMinutes
) {
  // var d = new Date();
  var tz_offset = 0.0;

  // to get user info so we can access their timezone offset user.tz_offset
  try {
    // Call the users.info method using the built-in WebClient
    const result = await app.client.users.info({
      // The token you used to initialize your app is stored in the `context` object
      token: context.botToken,
      // Call users.info for the user that joined the workspace
      user: userId
    });
    tz_offset = result.user.tz_offset;
    console.log(
      `timezone offset for ${result.user.name} is ${result.user.tz_offset}`
    );
  } catch (error) {
    console.error(error);
  }

  var userDate = getUserDate(tz_offset);
  var proposedDate = new Date();
  console.log(userDate); // finally we get the local time for user
  var formattedDate = formatDate(userDate);
  //await say(`Your time is ${formattedDate}`);

  // DEV time adjustment
  var proposedHourOfTheDay = hoursOfTheDay;
  proposedDate.setHours(proposedHourOfTheDay);
  proposedDate.setMinutes(offsetInMinutes);
  proposedDate.setSeconds(0);

  // WARNING: comment out this section if you want to test stuff
  //comparing the proposed date with the actual date
  //advance 24 hours if proposed time is in the past
  // if (proposedDate.getTime() / 1000 - tz_offset < Date.now() / 1000) {
  //   var epochProposed = proposedDate.getTime() / 1000.0;
  //   epochProposed += secondsInADay; //24hours in seconds
  //   proposedDate = new Date(epochProposed * 1000);
  // }

  // go back 24 hours if proposed time is way ahead - due to time zone issues
  if (
    proposedDate.getTime() / 1000 - tz_offset - secondsInADay >
    Date.now() / 1000
  ) {
    var epochProposed = proposedDate.getTime() / 1000.0;
    epochProposed -= secondsInADay; //24hours in seconds
    proposedDate = new Date(epochProposed * 1000);
  }

  // format to notify user of the choice
  var formattedLocalProposedDate = formatDate(proposedDate); // this is in user's local time

  if (say) {
    await say(`Next schedule happens on ${formattedLocalProposedDate}.`);
  }

  // save for global access
  scheduledExhibitLocalDate = formatDate(proposedDate);

  // this should be fed to the scheduled message
  var nextScheduleDate = new Date(
    (proposedDate.getTime() / 1000 - tz_offset) * 1000
  );
  console.log(`scheduled on: ${nextScheduleDate}. gmt time is: ${Date()} `);

  return nextScheduleDate;
}

async function triggerFirstExhibit(context) {
  console.log("first scheduled exhibit");
  // post message
  scheduledPost(context);

  scheduledExhibitInterval = setInterval(function() {
    dailyExhibitTask(context);
  }, intervalOfScheduledExhibit * 1000); // schedule interval in milliseconds
}

async function dailyExhibitTask(context) {
  console.log("daily exhibit!");
  // post message
  scheduledPost(context);
}

async function triggerFirstPrompt(channel_id, context) {
  console.log("first scheduled prompt");

  // use all users
  var users = await getAllUsersInChannel(context, channel_id);
  console.log(`looping through users, number of users${users.length}`);

  for (var i = 0; i < users.length; i++) {
    // post message
    // use userid as channel id to dm
    await promptInvoke(users[i], users[i], context);
  }

  scheduledPromptInterval = setInterval(function() {
    dailyPromptTask(channel_id, context);
  }, intervalOfScheduledExhibit * 1000); // schedule interval in milliseconds
}

async function dailyPromptTask(channel_id, context) {
  console.log("doing this in an interval!");

  // use all users
  var users = await getAllUsersInChannel(context, channel_id);
  console.log(`looping through users, number of users ${users.length}`);

  for (var i = 0; i < users.length; i++) {
    // post message
    // use userid as channel id to dm
    await promptInvoke(users[i], users[i], context);
  }
}

// schedule the exhibit daily hour
// Listen for a slash command invocation
app.command(
  "/cma_daily_exhibit_time",
  async ({ ack, payload, context, say, command }) => {
    // Acknowledge the command request
    ack();

    clearInterval(scheduledExhibitInterval);
    clearTimeout(scheduledExhibitTimeout);

    //// check if user is admin
    //     var isAdmin = await getIfAdmin(payload.user_id, context);

    //     if (!isAdmin){
    //       await say("Hi! Only admin can do this");
    //       return;
    //     }

    var input = command.text.split(":");
    var userId = payload.user_id;
    var inputHour = parseFloat(input[0]);
    var inputMinute = parseFloat(input[1]);

    // make sure to curb the numbers
    if (inputHour < 0 || inputHour > 24) {
      await say(`Please try again with a number between 0 and 24.`);
      return;
    }

    await exhibitSchedule(context, say, userId, inputHour, inputMinute);
  }
);

// to reuse by command or app_home
async function exhibitSchedule(context, say, userId, inputHour, inputMinute) {
  clearInterval(scheduledPromptInterval);
  clearTimeout(scheduledPromptTimeout);

  console.log(
    `Set daily exhibition time at ${inputHour} hours, ${inputMinute} minutes`
  );

  console.dir(`cma daily schedule command by user: ${userId}`);

  var nextScheduleDate = await calculateScheduledDate(
    userId,
    context,
    say,
    inputHour,
    inputMinute
  );
  var current = new Date();
  var timeDifference = nextScheduleDate.getTime() - current.getTime();

  // trigger the first exhibit, then the exhibit will keep the interval running
  scheduledExhibitTimeout = setTimeout(function() {
    triggerFirstExhibit(context);
  }, timeDifference); // pass context to async function
}

// to reuse by command or app_home
async function promptSchedule(
  context,
  say,
  channelId,
  userId,
  inputHour,
  inputMinute
) {
  var imChannelId = channelId;

  clearInterval(scheduledPromptInterval);
  clearTimeout(scheduledPromptTimeout);
  // clean up user inputs
  userData = {};

  console.log(
    `Set daily prompt time at ${inputHour} hours, ${inputMinute} minutes`
  );

  console.dir(`cma daily prompt command by user: ${userId}`);

  var nextScheduleDate = await calculateScheduledDate(
    userId,
    context,
    say,
    inputHour,
    inputMinute
  );
  var current = new Date();
  var timeDifference = nextScheduleDate.getTime() - current.getTime();

  // trigger the first exhibit, then the exhibit will keep the interval running
  scheduledPromptTimeout = setTimeout(function() {
    triggerFirstPrompt(imChannelId, context);
  }, timeDifference); // pass context to async function
}

// schedule the prompt daily hour
// Listen for a slash command invocation
app.command(
  "/cma_daily_prompt_time",
  async ({ ack, payload, context, say, command }) => {
    // Acknowledge the command request
    ack();

    //// check if user is admin
    //     var isAdmin = await getIfAdmin(payload.user_id, context);

    //     if (!isAdmin){
    //       await say("Hi! Only admin can do this");
    //       return;
    //     }

    var input = command.text.split(":");
    var imChannelId = postChannelId;
    var userId = payload.user_id;

    var inputHour = parseFloat(input[0]);
    var inputMinute = parseFloat(input[1]);
    
    // take prompt index as optional 3rd argument
    // if (input.length > 2) {
    //   promptIndex = parseInt(input[2]);
    //   console.log(`SETTING PROMPT ${promptIndex}`)
    // }

    // make sure to curb the numbers
    if (inputHour < 0 || inputHour > 24) {
      await say(`Please try again with a number between 0 and 24.`);
      return;
    }

    await promptSchedule(
      context,
      say,
      imChannelId,
      userId,
      inputHour,
      inputMinute
    );
  }
);

// schedule the exhibit daily hour
// Listen for a slash command invocation
app.command(
  "/cma_cancel_exhibits",
  async ({ ack, payload, context, say, command }) => {
    // Acknowledge the command request
    ack();

    //// check if user is admin
    //     var isAdmin = await getIfAdmin(payload.user_id, context);

    //     if (!isAdmin){
    //       await say("Hi! Only admin can do this");
    //       return;
    //     }

    try {
      await say(`Daily exhibit and prompt schedule have been canceled.`);
      // clear the interval
      clearInterval(scheduledExhibitInterval);
      clearInterval(scheduledPromptInterval);
      clearTimeout(scheduledExhibitTimeout);
      clearTimeout(scheduledPromptTimeout);
    } catch (error) {
      console.error(error);
    }
  }
);

async function exhibitScheduledMessage(context, delayedMins) {
  // just get delayed reponse
  delayedMins += 0.2; // to safe guard if delayedMins were 0;
  const secondsSinceEpoch = Date.now() / 1000;
  var scheduledTime = secondsSinceEpoch + delayedMins * 60.0; // 10 sec from now
  console.log("current time " + secondsSinceEpoch);
  console.log("delayed to time"  + scheduledTime);
  console.log(`SEND TO CHANNEL ${postChannelId}`);

  // prompt variables
  var prompts = getPrompts();

  // talking to api
  var slackbotId = "id-" + postChannelId + "-" + getRndInteger(10000, 99999);
  var data = {
    user_data: userData
  };

  await writeToAPI(slackbotId, data);

  // update header block
  var headerBlocks = exhibit_header_template.blocks;
  // replace with correct content
  for (var i = 0; i < headerBlocks.length; i++) {
    if (headerBlocks[i].block_id === "header_title") {
      headerBlocks[i].text.text = "*" + prompts.title + "*";
    }
    if (headerBlocks[i].block_id === "header_credits") {
      var creditString = "";
      for (var key in userData) {
        var thisUser = getUserData(key);
        if (thisUser.textResponse && thisUser.textResponse != "") {
          creditString = creditString.concat(`<@${key}>, `);
        }
      }

      // insert credits if user response exists
      if (creditString != "") {
        headerBlocks[i].text.text =
          ":speech_balloon: Today's exhibition is curated by " +
          creditString +
          "and the <https://www.clevelandart.org|Cleveland Museum of Art>. Come take a look.";
      } else {
        headerBlocks[i].text.text =
          ":speech_balloon: Today's exhibition is curated by the <https://www.clevelandart.org|Cleveland Museum of Art>. Come take a look.";
      }
    }
    if (headerBlocks[i].block_id === "header_prompt") {
      headerBlocks[i].text.text = prompts.resultPrompt;
    }
    if (headerBlocks[i].block_id === "header_image") {
      // headerBlocks[i].title.text = prompts.resultPromptTitle;
      headerBlocks[i].image_url = prompts.resultPromptImageUrl;
      headerBlocks[i].alt_text = prompts.resultPromptTitle;
    }
    // if (userBlocks[i].block_id === "cma_button") {
    //         userBlocks[i].elements[0].url = artworkUrl; //cma website
    //       }
  }

  try {
    // the delayed opening statement
    // Call the chat.scheduleMessage method with a token
    const result = await app.client.chat.scheduleMessage({
      // The token you used to initialize your app is stored in the `context` object
      token: context.botToken,
      channel: postChannelId, // find channel id or set current channel as post channel
      post_at: scheduledTime,
      blocks: [],
      attachments: [{ blocks: headerBlocks }],
      text: " "
    });

    for (var key in userData) {
      var thisUser = getUserData(key);

      console.dir(thisUser);

      if (thisUser.lastImgUrl && thisUser.lastImgTitle) {
        var userId = key;
        var name = "";
        // get user name
        try {
          // Call the users.info method using the built-in WebClient
          const result = await app.client.users.info({
            // The token you used to initialize your app is stored in the `context` object
            token: context.botToken,
            // Call users.info for the user that joined the workspace
            user: userId
          });

          name = result.user.name;
        } catch (error) {
          console.error(error);
        }

        var artworkImg = thisUser.lastImgUrl;
        var artworkUrl = thisUser.artworkUrl;
        var textResponse = thisUser.textResponse;

        var artworkLabel =
          thisUser.lastImgTitle +
          (thisUser.lastImgCreator ? " by " + thisUser.lastImgCreator : "");
        var userResponse = `"` + textResponse + `" - ` + name;

        // update user block
        var userBlocks = exhibit_template.blocks;
        // replace with correct content
        for (var i = 0; i < userBlocks.length; i++) {
          if (userBlocks[i].block_id === "artwork_label") {
            userBlocks[i].title.text = userResponse;
            userBlocks[i].alt_text = artworkLabel;
            userBlocks[i].image_url = artworkImg;
          }
          if (userBlocks[i].block_id === "cma_button") {
            userBlocks[i].elements[0].url = artworkUrl; //cma website
          }
        }
        const result = await app.client.chat.scheduleMessage({
          // The token you used to initialize your app is stored in the `context` object
          token: context.botToken,
          text: " ",
          channel: postChannelId, // find channel id or set current channel as post channel
          post_at: scheduledTime + 2, // delay so the prompt comes first
          blocks: [],
          attachments: [{ blocks: userBlocks }]
        });
      }
    }

    // update footer block
    var footerBlocks = exhibit_footer_template.blocks;
    // replace with correct content
    for (var i = 0; i < footerBlocks.length; i++) {
      if (footerBlocks[i].block_id === "footer_title") {
        footerBlocks[i].text.text =
          ":speech_balloon: " + prompts.resultPromptConclusion;
      }
    }

    // the delayed end statement
    // Call the chat.scheduleMessage method with a token
    const endResult = await app.client.chat.scheduleMessage({
      // The token you used to initialize your app is stored in the `context` object
      token: context.botToken,
      channel: postChannelId, // find channel id or set current channel as post channel
      post_at: scheduledTime + 5, // delayed more for the ending message
      blocks: [],
      attachments: [{ blocks: footerBlocks }],
      text: " "
    });
  } catch (error) {
    console.error(error);
  }

  // clear input no matter what
  userData = {};
}

// schedule the exhibit, currently just adding delay, can expand from here
// Listen for a slash command invocation
app.command(
  "/cma_schedule_exhibit",
  async ({ ack, payload, context, say, command }) => {
    // Acknowledge the command request
    ack();

    //// check if user is admin
    //     var isAdmin = await getIfAdmin(payload.user_id, context);

    //     if (!isAdmin){
    //       await say("Hi! Only admin can do this");
    //       return;
    //     }

    // schedule for a specific date
    // var future = new Date(2010, 6, 26).getTime() / 1000
    // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date

    var delayedMins = command.text ? parseFloat(command.text) : 0.2;
    await exhibitScheduledMessage(context, delayedMins);
  }
);

// this is where the prompt message is composed
async function promptInvoke(channelId, userId, context) {
  // save channel id
  //chatChannelId = channelId; // which could happen in a private channel or group chat

  console.dir(userData);
  // Does user's record exist in userData yet?
  if (!(userId in userData)) {
    userData[userId] = {
      chatChannelId: channelId,
      awaitingTextResponse: false,
      awaitingArtworkSelection: true
    };

    // getUserData(
    //   userId,
    //   channelId,
    //   false,
    //   true,
    //   void 0,
    //   void 0,
    //   void 0,
    //   void 0,
    //   void 0,
    //   void 0,
    //   void 0
    // );
  }

  // variables (to be updated dynamically)
  var prompts = getPrompts();

  console.log(`invoking prompt on ${channelId}`);
  // create a block
  try {
    // update header block
    var promptInvokeBlocks = prompt_invoke_template.blocks;
    
    // create buttons from choiceWords, for max of 5 (only 5 button action_ids)
    var btns = [];
    var btnNum = (prompts.choiceWords.length <= 5 ? prompts.choiceWords.length : 5);
    
    for (var i = 0; i < btnNum; i++) {
      var btn = {
					"type": "button",
					"text": {
						"type": "plain_text",
						"text": prompts.choiceWords[i],
						"emoji": true
					},
					"value": prompts.choiceWords[i],
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
        promptInvokeBlocks[i].text.text =
          ":speech_balloon: " + "*" + prompts.title + "*";
      }

      if (promptInvokeBlocks[i].block_id === "prompt_image") {
        // promptInvokeBlocks[i].title.text = prompts.promptArtTitle;
        promptInvokeBlocks[i].image_url = prompts.promptArtImageUrl;
        promptInvokeBlocks[i].alt_text = prompts.promptArtTitle;
      }
      
      if (promptInvokeBlocks[i].block_id === "prompt_prompt") {
        promptInvokeBlocks[i].text.text = ":speech_balloon: " + prompts.prompt ;
      }
      
      if (promptInvokeBlocks[i].block_id === "word_buttons") {
        promptInvokeBlocks[i].elements = btns;
      }      
    }

    const result = await app.client.chat.postMessage({
      token: context.botToken,
      // Channel to send message to
      channel: channelId,
      // Main art selection interaction
      blocks: [],
      attachments: [{ blocks: promptInvokeBlocks }],
      // Text in the notification
      text: " "
    });
  } catch (error) {
    console.error(error);
  }
}

app.command("/cma_test", async ({ ack, payload, context, command }) => {
  // Acknowledge the command request
  ack();

  console.log("payload....");
  console.log(payload);

  console.log("context....");
  console.log(context);

  
  const keyz = JSON.parse(process.env.KEYZ);
  
  console.log(keyz['team2']);
});

// invoke cma prompt for demo
// Listen for invoking cma prompt
app.command("/cma_invoke", async ({ ack, payload, context, command }) => {
  // Acknowledge the command request
  ack();

  await promptInvoke(payload.channel_id, payload.user_id, context);
});

// Listen for a button invocation with action_id `visit_button`
// You must set up a Request URL under Interactive Components on your app configuration page
app.action("visit_button", async ({ ack, body, context }) => {
  // Acknowledge the button request
  ack();

  // ack() and do nothing. this should get rid of the exclamation mark
});

// Listen for a button invocation with action_id `shuffle_button`
// You must set up a Request URL under Interactive Components on your app configuration page
app.action("shuffle_button", async ({ ack, body, context }) => {
  var userId = body.user.id;

  // Acknowledge the button request
  ack();

  // // disable button if user has answered
  // if (
  //   "textResponse" in userData[userId] &&
  //   userData[userId].textResponse.length > 0
  // ) {
  //   return;
  // }

  // disable button if user has answered
  if (
    getUserData(userId).textResponse &&
    getUserData(userId).textResponse.length > 0
  ) {
    return;
  }

  // only getting 50 results, using processed string
  // await to get results
  const artObjects = await getArts(getUserData(userId).keyword);
  //console.dir(artObjects);

  var targetIndex = lastArtIndex;

  if (targetIndex < artObjects.length - 2) {
    targetIndex++;
  } else {
    targetIndex = 0;
  }

  var featured = artObjects[targetIndex];
  //drop while loop
  var tryCount = 0;
  while (featured.creators.length <= 0) {
    tryCount++;
    if (tryCount >= artObjects.length) {
      return;
    }

    if (targetIndex < artObjects.length - 2) {
      targetIndex++;
    } else {
      targetIndex = 0;
    }

    featured = artObjects[targetIndex];
  }

  console.log("getting the next art index of: " + targetIndex);
  lastArtIndex = targetIndex;

  //          userId,chatChannelId,awaitingTextResponse,awaitingArtworkSelection, keyword, lastImgUrl,lastImgCreator,lastImgTitle,artworkUrl,textResponse
  var creators = formatCreators(featured.creators);

  getUserData(
    userId, // uesr id
    void 0, // chat channel id
    true, // awaiting text response
    void 0, // waiting artwork selection
    void 0, // keyword
    featured.images.web.url, // last img url
    creators, // last img creator
    featured.title, // last imge title
    featured.url, // artwork url
    void 0 // text response
  );

  // update selection block
  var promptSelectionBlocks = prompt_selection_template.blocks;
  // replace with correct content

  var composedImageText = "";
  if (
    getUserData(userId).lastImgCreator &&
    getUserData(userId).lastImgCreator != ""
  ) {
    composedImageText =
      getUserData(userId).lastImgTitle +
      " by " +
      getUserData(userId).lastImgCreator;
  } else {
    composedImageText = getUserData(userId).lastImgTitle;
  }

  for (var i = 0; i < promptSelectionBlocks.length; i++) {
    if (promptSelectionBlocks[i].block_id === "prompt_selection_img") {
      // promptSelectionBlocks[i].title.text = composedImageText;
      promptSelectionBlocks[i].image_url = getUserData(userId).lastImgUrl;
      promptSelectionBlocks[i].alt_text = composedImageText;
    }
    
    if (promptSelectionBlocks[i].block_id === "cma_button") {
      promptSelectionBlocks[i].elements[0].url = getUserData(userId).artworkUrl;      
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

  // Acknowledge the button request
  ack();

  // disable button if user has answered
  if (
    getUserData(userId).textResponse &&
    getUserData(userId).textResponse.length > 0
  ) {
    return;
  }

  try {
    // reaffirm status
    //adding state
    getUserData(body.user.id).awaitingTextResponse = true;

    var composedImageText = "";
    if (
      getUserData(userId).lastImgCreator &&
      getUserData(userId).lastImgCreator != ""
    ) {
      composedImageText =
        getUserData(userId).lastImgTitle +
        " by " +
        getUserData(userId).lastImgCreator;
    } else {
      composedImageText = getUserData(userId).lastImgTitle;
    }

    // update selection block
    var confirmImageBlocks = confirm_image_template.blocks;
    // replace with correct content
    for (var i = 0; i < confirmImageBlocks.length; i++) {
      if (confirmImageBlocks[i].block_id === "confirm_image") {
        // confirmImageBlocks[i].title.text = composedImageText;
        confirmImageBlocks[i].image_url = getUserData(userId).lastImgUrl;
        confirmImageBlocks[i].alt_text = composedImageText;
      }
      
      if (confirmImageBlocks[i].block_id === "cma_button") {
        confirmImageBlocks[i].elements[0].url = getUserData(userId).artworkUrl;      
      }      
    }

    // Update the message
    const result = await app.client.chat.update({
      token: context.botToken,
      // ts of message to update
      ts: body.message.ts,
      // Channel of message
      channel: body.channel.id,
      blocks: [],
      attachments: [{ blocks: confirmImageBlocks }],
      text: " "
    });
  } catch (error) {
    console.error(error);
  }
});

// Listen for a button invocation with action_id `choice_button_[index]`
// You must set up a Request URL under Interactive Components on your app configuration page
var numChoices = 5;
for (var i = 0; i < numChoices; i++) {
  var actionId = "choice_button_" + i.toString();
  app.action(actionId, async ({ ack, payload, body, context }) => {
    var userId = body.user.id;

    // Acknowledge the button request
    ack();
    
    // TODO: this is how it should *all* work, does userData content exist, not
    // in "awaiting*" flags
    if (!getUserData(userId).keyword) {
      wordSelection(payload.value , userId, context.botToken);
    } 
  });
}

async function wordSelection(word, userId, botToken) {
  // await say(
  //   "Hi! :wave: This is your input :arrow_right: :     " +
  //     `${rawUserInput}` +
  //     "\n Pulling result for you..."
  // );

  // print user input in QUOTE
  // await say("> " + rawUserInput);

  // key confirmation, also links to a search on cma's website
  // var wordIntro = "> " +
  //     "<" +
  //     "https://www.clevelandart.org/art/collection/search?search=" +
  //     word + "|" + word +
  //     ">";
  var wordIntro = `> <https://www.clevelandart.org/art/collection/search?search=${word}|${word}>`;  
  
  const intro = await app.client.chat.postMessage({
      token: botToken,
      // Channel to send message to
      channel: getUserData(userId).chatChannelId,
      // Main art selection interaction
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
      // Text in the notification
      text: " "
    });  
  // await to get results
  const artObjects = await getArts(word);

  //userData[userId].keyword = escapedInput;
  getUserData(
    userId, // uesr id
    void 0, // chat channel id
    void 0, // awaiting text response
    void 0, // waiting artwork selection
    word, // keyword
    void 0, // last img url
    void 0, // last img creator
    void 0, // last imge title
    void 0, // artwork url
    void 0, // text response
    void 0 // last user
  );

  var targetIndex = getRndInteger(0, artObjects.length - 1);

  var featured = artObjects[targetIndex];

  // store info and status
  console.log("getting the art index of: " + targetIndex);
  lastArtIndex = targetIndex;

  //adding state
  // userData[userId].awaitingTextResponse = true;
  // userData[userId].lastImgUrl = featured.images.web.url;
  // userData[userId].lastImgTitle = featured.title;
  // userData[userId].lastImgCreator = formatCreators(featured.creators);
  // userData[userId].artworkUrl = featured.url;
  // userData[userId].lastUser = message.user;
  // userData[userId].textResponse = "";

  var creators = formatCreators(featured.creators);

  getUserData(
    userId, // uesr id
    void 0, // chat channel id
    true, // awaiting text response
    void 0, // waiting artwork selection
    void 0, // keyword
    featured.images.web.url, // last img url
    creators, // last img creator
    featured.title, // last imge title
    featured.url, // artwork url
    "", // text response
    userId // lastUser
  );

  // update selection block
  var promptSelectionBlocks = prompt_selection_template.blocks;
  var composedImageText = "";
  if (
    getUserData(userId).lastImgCreator &&
    getUserData(userId).lastImgCreator != ""
  ) {
    composedImageText =
      getUserData(userId).lastImgTitle +
      " by " +
      getUserData(userId).lastImgCreator;
  } else {
    composedImageText = getUserData(userId).lastImgTitle;
  }
  // replace with correct content
  for (var i = 0; i < promptSelectionBlocks.length; i++) {
    if (promptSelectionBlocks[i].block_id === "prompt_selection_img") {
      // promptSelectionBlocks[i].title.text = composedImageText;
      promptSelectionBlocks[i].image_url = getUserData(userId).lastImgUrl;
      promptSelectionBlocks[i].alt_text = composedImageText;
    }
    
    if (promptSelectionBlocks[i].block_id === "cma_button") {
      promptSelectionBlocks[i].elements[0].url = getUserData(userId).artworkUrl;      
    }
  }

  // create a block
  try {
    const result = await app.client.chat.postMessage({
      token: botToken,
      // Channel to send message to
      channel: getUserData(userId).chatChannelId,
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

// Record after asking for response
app.message("", async ({ message, payload, context, say }) => {
  // verbose for testing
  var rawUserInput = message.text;
  var escapedInput = rawUserInput.replace(
    /[\`\#\;\%\$\@\!\*\+\-\=\<\>\&\|\(\)\[\]\{\}\^\~\?\:\\/"]/g,
    ""
  );
  console.log(`escaped user input: ${escapedInput}`);

  // before anything is setup a default channel should be in place
  if (postChannelId == "") {
    await say(
      "Hi! You don't have a default channel setup yet, use `/cma_default_channel`.  "
    );
    return;
  }

  // save user id
  var userId = message.user;
  // check if user is admin
  var isAdmin = await getIfAdmin(userId, context);

  // TODO: don't know what this is for -EH
  // console.dir(payload);
  // if (!isAdmin && payload.channel == postChannelId) {
  //   await say("Hi! Only admin can do this");
  //   return;
  // }

  // cancel
  console.log(`user response: ${rawUserInput}, user id: ${message.user}`);

  // Does user's record exist in userData yet?
  // if (!(userId in userData)) {
  //   userData[userId] = {
  //     awaitingTextResponse: false,
  //     awaitingArtworkSelection: true
  //   };
  // }
  // this will create new key if needed
  getUserData(userId);

  if (escapedInput == "random") {
    return;
  }

  if (escapedInput == "seestate") {
    return;
  }

  // TODO: fix cancel
  if (escapedInput == "cancel") {
    delete userData[userId];

    say(`Your selection have been canceled.`);
    return;
  }

  // wait for artwork comment
  if (getUserData(userId).awaitingTextResponse) {
    console.log("record user input from: " + message.user);
    await say(
      `>:speech_balloon: Got it, <@${message.user}>! _${
        getUserData(userId).lastImgTitle
      }_ and your comment will be featured in today's exhibit.`
    );

    //adding state
    getUserData(
      userId, // uesr id
      void 0, // chat channel id
      false, // awaiting text response
      false, // waiting artwork selection
      void 0, // keyword
      void 0, // last img url
      void 0, // last img creator
      void 0, // last imge title
      void 0, // artwork url
      rawUserInput, // text response
      void 0 // last user
    );

    // userData[userId].awaitingTextResponse = false;
    // userData[userId].awaitingArtworkSelection = false;
    // userData[userId].textResponse = escapedInput;

    // all responses were collected, scheduling message
    const secondsSinceEpoch = Date.now() / 1000;
    var scheduledTime = secondsSinceEpoch + 15; // 10 sec from now

    return;
  } else {
    // REMOVE textResponse = "";
  }

  // for artwork selection
  if (getUserData(userId).awaitingArtworkSelection) {
    // await say(
    //   "Hi! :wave: This is your input :arrow_right: :     " +
    //     `${rawUserInput}` +
    //     "\n Pulling result for you..."
    // );

    // print user input in QUOTE
    // await say("> " + rawUserInput);

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

    //userData[userId].keyword = escapedInput;
    getUserData(
      userId, // uesr id
      void 0, // chat channel id
      void 0, // awaiting text response
      void 0, // waiting artwork selection
      escapedInput, // keyword
      void 0, // last img url
      void 0, // last img creator
      void 0, // last imge title
      void 0, // artwork url
      void 0, // text response
      void 0 // last user
    );

    var targetIndex = getRndInteger(0, artObjects.length - 1);

    var featured = artObjects[targetIndex];

    // store info and status
    console.log("getting the art index of: " + targetIndex);
    lastArtIndex = targetIndex;

    //adding state
    // userData[userId].awaitingTextResponse = true;
    // userData[userId].lastImgUrl = featured.images.web.url;
    // userData[userId].lastImgTitle = featured.title;
    // userData[userId].lastImgCreator = formatCreators(featured.creators);
    // userData[userId].artworkUrl = featured.url;
    // userData[userId].lastUser = message.user;
    // userData[userId].textResponse = "";

    var creators = formatCreators(featured.creators);

    getUserData(
      userId, // uesr id
      void 0, // chat channel id
      true, // awaiting text response
      void 0, // waiting artwork selection
      void 0, // keyword
      featured.images.web.url, // last img url
      creators, // last img creator
      featured.title, // last imge title
      featured.url, // artwork url
      "", // text response
      message.user // lastUser
    );

    // update selection block
    var promptSelectionBlocks = prompt_selection_template.blocks;
    var composedImageText = "";
    if (
      getUserData(userId).lastImgCreator &&
      getUserData(userId).lastImgCreator != ""
    ) {
      composedImageText =
        getUserData(userId).lastImgTitle +
        " by " +
        getUserData(userId).lastImgCreator;
    } else {
      composedImageText = getUserData(userId).lastImgTitle;
    }
    // replace with correct content
    for (var i = 0; i < promptSelectionBlocks.length; i++) {
      if (promptSelectionBlocks[i].block_id === "prompt_selection_img") {
        // promptSelectionBlocks[i].title.text = composedImageText;
        promptSelectionBlocks[i].image_url = getUserData(userId).lastImgUrl;
        promptSelectionBlocks[i].alt_text = composedImageText;
      }
    }

    // create a block
    try {
      const result = await app.client.chat.postMessage({
        token: context.botToken,
        // Channel to send message to
        channel: getUserData(userId).chatChannelId,
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

  delete userData[userId];

  await say(`Your selection have been canceled.`);
});

// scheduling test
// note: uses Unix Epoch time
app.message("wake me up", async ({ message, context, say }) => {
  const secondsSinceEpoch = Date.now() / 1000;
  var scheduledTime = secondsSinceEpoch + 10; // 10 sec from now
  
  if (postChannelId != "") {
    try {
      // Call the chat.scheduleMessage method with a token
      const result = await app.client.chat.scheduleMessage({
        // The token you used to initialize your app is stored in the `context` object
        token: context.botToken,
        channel: postChannelId, // find channel id or set current channel as post channel
        post_at: scheduledTime,
        text: `But the system has identified <@${message.user}> is not even asleep atm.`
      });
    } catch (error) {
      console.error(error);
    }
  } else {
    await say(
      "Hi! You don't have a default channel setup yet, use `/cma_default_channel`.  "
    );
  }
});

// function to get if admin
// requires user:read
async function getIfAdmin(userId, context) {
  var isAdmin = false;
  // check if this user is admin
  try {
    // Call the users.info method using the built-in WebClient
    const result = await app.client.users.info({
      // The token you used to initialize your app is stored in the `context` object
      token: context.botToken,
      // Call users.info for the user that joined the workspace
      user: userId
    });

    isAdmin = result.user.is_admin;
    console.log(`${userId} is admin : ${isAdmin}`);
  } catch (error) {
    console.error(error);
  }

  return isAdmin;
}

//onboarding
app.event("app_home_opened", async ({ event, context }) => {
  var isUserAdmin = await getIfAdmin(event.user, context);

  try {
    /* view.publish is the method that your app uses to push a view to the Home tab */
    const result = await app.client.views.publish({
      /* retrieves your xoxb token from context */
      token: context.botToken,

      /* the user that opened your app's app home */
      user_id: event.user,

      /* the view payload that appears in the app home*/
      view: {
        type: "home",
        callback_id: "home_view",

        /* body of the view */
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: "*Welcome to ArtLens Slacker* :art:"
            }
          }
        ]
      }
    });
  } catch (error) {
    console.error(error);
  }

  //TODO: admin view?
//   try {
//     /* view.publish is the method that your app uses to push a view to the Home tab */
//     const result = await app.client.views.publish({
//       /* retrieves your xoxb token from context */
//       token: context.botToken,

//       /* the user that opened your app's app home */
//       user_id: event.user,

//       /* the view payload that appears in the app home*/
//       view: {
//         type: "home",
//         callback_id: "home_view",

//         /* body of the view */
//         blocks: home_template.blocks
//       }
//     });
//   } catch (error) {
//     console.error(error);
//   }
});

// Listen for a button invocation with action_id `shuffle_button`
// You must set up a Request URL under Interactive Components on your app configuration page
app.action("prompt_time_selection", async ({ ack, payload, body, context }) => {
  // Acknowledge the button request
  ack();

  try {
    var inputHour = body.actions[0].selected_option.value;
    var inputMinute = 0;
    var userId = body.user.id;
    // we have no channel id to send here
    await promptSchedule(
      context,
      void 0,
      postChannelId,
      userId,
      inputHour,
      inputMinute
    );

    var homeBlocks = home_template.blocks;

    // iterate over each element in the array
    for (var i = 0; i < homeBlocks.length; i++) {
      // look for the entry with a matching `code` value
      if (homeBlocks[i].block_id === "prompt_time") {
        homeBlocks[i].text.text = scheduledExhibitLocalDate;
      }
    }

    console.dir(homeBlocks);

    try {
      /* view.publish is the method that your app uses to push a view to the Home tab */
      const result = await app.client.views.publish({
        /* retrieves your xoxb token from context */
        token: context.botToken,

        /* the user that opened your app's app home */
        user_id: userId,

        /* the view payload that appears in the app home*/
        view: {
          type: "home",
          callback_id: "home_view",

          /* body of the view */
          blocks: homeBlocks
        }
      });
    } catch (error) {
      console.error(error);
    }
  } catch (error) {
    console.error(error);
  }
});

(async () => {
  // Start your app
  await app.start(process.env.PORT || 3000);

  console.log("⚡️ Bolt app is running!");
})();
