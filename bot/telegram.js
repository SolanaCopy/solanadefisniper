const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const { NewMessage } = require("telegram/events");
const { Api } = require("telegram/tl");
const config = require("./config");

let client = null;
let channelEntity = null;
let isConnected = false;

/**
 * Initialize the Telegram client with existing session
 */
async function initClient() {
  const session = new StringSession(config.telegram.session);

  client = new TelegramClient(session, config.telegram.apiId, config.telegram.apiHash, {
    connectionRetries: 10,
    retryDelay: 3000,
    autoReconnect: true,
  });

  await client.start({
    phoneNumber: async () => {
      throw new Error("Session expired. Run 'npm run bot:login' to re-authenticate.");
    },
    password: async () => {
      throw new Error("Session expired. Run 'npm run bot:login' to re-authenticate.");
    },
    phoneCode: async () => {
      throw new Error("Session expired. Run 'npm run bot:login' to re-authenticate.");
    },
    onError: (err) => console.error("[Telegram] Error:", err),
  });

  isConnected = true;
  console.log("[Telegram] Connected with existing session");

  // Resolve the target channel
  try {
    channelEntity = await client.getEntity(config.telegram.channel);
    console.log(`[Telegram] Resolved channel: "${channelEntity.title}" (id: ${channelEntity.id})`);
  } catch (err) {
    console.error(`[Telegram] Could not resolve channel "${config.telegram.channel}": ${err.message}`);
    console.log("[Telegram] Trying with @ prefix...");
    try {
      channelEntity = await client.getEntity("@" + config.telegram.channel);
      console.log(`[Telegram] Resolved channel: "${channelEntity.title}" (id: ${channelEntity.id})`);
    } catch (err2) {
      console.error(`[Telegram] Failed: ${err2.message}`);
    }
  }

  // Health check: verify connection every 60s and reconnect if needed
  setInterval(async () => {
    try {
      const connected = client.connected;
      if (!connected) {
        console.warn("[Telegram] Connection lost! Reconnecting...");
        isConnected = false;
        await client.connect();
        isConnected = true;
        console.log("[Telegram] Reconnected successfully");
      }
    } catch (err) {
      console.error("[Telegram] Reconnect failed:", err.message);
      isConnected = false;
      // Try full reconnect
      try {
        await client.disconnect();
        await client.connect();
        isConnected = true;
        console.log("[Telegram] Full reconnect successful");
      } catch (err2) {
        console.error("[Telegram] Full reconnect also failed:", err2.message);
      }
    }
  }, 60000);

  return client;
}

/**
 * Start listening to a specific channel for new messages.
 * Uses both event handler AND polling as fallback.
 */
function onChannelMessage(callback) {
  if (!client) throw new Error("Telegram client not initialized");

  // Method 1: Event handler for real-time messages
  client.addEventHandler(async (event) => {
    try {
      const message = event.message;
      if (!message || !message.text) return;

      const chat = await message.getChat();
      if (!chat) return;

      const chatUsername = chat.username || "";
      const chatId = chat.id?.value?.toString() || chat.id?.toString() || "";
      const chatTitle = chat.title || chatUsername || "Unknown";
      const targetChannel = config.telegram.channel;

      console.log(`[Telegram] Event from: "${chatTitle}" (username: "${chatUsername}", id: ${chatId})`);

      if (isTargetChannel(chatUsername, chatId, chatTitle, targetChannel)) {
        let fullText = message.text || "";

        if (message.replyMarkup && message.replyMarkup.rows) {
          for (const row of message.replyMarkup.rows) {
            for (const button of row.buttons) {
              if (button.url) {
                console.log(`[Telegram] Button URL: ${button.url}`);
                fullText += " " + button.url;
              }
            }
          }
        } else {
          console.log(`[Telegram] No replyMarkup on event message`);
        }

        if (message.entities) {
          for (const entity of message.entities) {
            if (entity.url) {
              console.log(`[Telegram] Entity URL: ${entity.url}`);
              fullText += " " + entity.url;
            }
          }
        }

        callback({
          text: fullText,
          date: new Date(message.date * 1000),
          chatName: chatTitle,
          messageId: message.id,
        });
      }
    } catch (err) {
      console.error("[Telegram] Event handler error:", err.message);
    }
  }, new NewMessage({}));

  // Method 2: Poll the channel every 5 seconds as fallback
  if (channelEntity) {
    let lastMessageId = 0;
    let consecutiveErrors = 0;

    // Get the latest message ID first
    client.getMessages(channelEntity, { limit: 1 }).then((msgs) => {
      if (msgs.length > 0) {
        lastMessageId = msgs[0].id;
        console.log(`[Telegram] Polling from message ID: ${lastMessageId}`);
      }
    });

    const POLL_INTERVAL = 5000;

    setInterval(async () => {
      try {
        if (!isConnected) {
          console.log("[Telegram] Poll skipped — not connected");
          return;
        }

        const messages = await client.getMessages(channelEntity, {
          limit: 5,
          minId: lastMessageId,
        });

        consecutiveErrors = 0; // Reset on success

        for (const msg of messages.reverse()) {
          if (msg.id <= lastMessageId) continue;
          if (!msg.text) continue;

          lastMessageId = msg.id;

          console.log(`[Telegram] Poll: new message #${msg.id} from ${channelEntity.title}`);

          // Extract URLs from buttons and message entities
          let fullText = msg.text || "";

          // Get URLs from inline buttons (reply markup)
          if (msg.replyMarkup && msg.replyMarkup.rows) {
            for (const row of msg.replyMarkup.rows) {
              for (const button of row.buttons) {
                if (button.url) {
                  console.log(`[Telegram] Poll button URL: ${button.url}`);
                  fullText += " " + button.url;
                }
              }
            }
          } else {
            console.log(`[Telegram] Poll: no replyMarkup on message #${msg.id}`);
          }

          // Get URLs from message entities (text links)
          if (msg.entities) {
            for (const entity of msg.entities) {
              if (entity.url) {
                console.log(`[Telegram] Poll entity URL: ${entity.url}`);
                fullText += " " + entity.url;
              }
            }
          }

          callback({
            text: fullText,
            date: new Date(msg.date * 1000),
            chatName: channelEntity.title || config.telegram.channel,
            messageId: msg.id,
          });
        }
      } catch (err) {
        consecutiveErrors++;
        console.error(`[Telegram] Poll error (${consecutiveErrors}x): ${err.message}`);

        // After 5 consecutive errors, try to reconnect
        if (consecutiveErrors >= 5) {
          console.warn("[Telegram] Too many poll errors, forcing reconnect...");
          try {
            await client.connect();
            isConnected = true;
            consecutiveErrors = 0;
            console.log("[Telegram] Reconnected after poll errors");
          } catch (reconnectErr) {
            console.error("[Telegram] Reconnect failed:", reconnectErr.message);
          }
        }
      }
    }, POLL_INTERVAL);

    console.log(`[Telegram] Polling ${channelEntity.title} every ${POLL_INTERVAL / 1000}s`);
  } else {
    console.error("[Telegram] WARNING: channelEntity is null — polling disabled! Check TELEGRAM_CHANNEL env var.");
  }

  console.log(`[Telegram] Listening for messages in: ${config.telegram.channel}`);
}

function isTargetChannel(username, id, title, target) {
  const t = target.toLowerCase().replace("@", "");
  return (
    username.toLowerCase() === t ||
    id === target ||
    title.toLowerCase().includes(t)
  );
}

function getClient() {
  return client;
}

module.exports = { initClient, onChannelMessage, getClient };
