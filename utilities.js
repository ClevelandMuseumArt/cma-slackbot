// storing conversations for list of channels
// You probably want to use a database to store any conversations information ;)
var conversationsStore = {};

// Fetch conversations using the conversations.list method
async function fetchConversations() {
  try {
    // Call the conversations.list method using the built-in WebClient
    const result = await app.client.conversations.list({
      // The token you used to initialize your app
      token: process.env.SLACK_BOT_TOKEN
    });

    saveConversations(result.channels);
  } catch (error) {
    console.error(error);
  }
}

// Put conversations into the JavaScript object
function saveConversations(conversationsArray) {
  let conversationId = "";
  conversationsArray.forEach(function(conversation) {
    // Key conversation info on its unique ID
    conversationId = conversation["id"];

    // Store the entire conversation object (you may not need all of the info)
    conversationsStore[conversationId] = conversation;
  });
}


 // After the app starts, fetch conversations and put them in a simple, in-memory cache
// this line should go right after app.starts
  //fetchConversations();
//----------------------------------------------------------------------------------------------------------