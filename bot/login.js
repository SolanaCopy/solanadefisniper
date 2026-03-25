/**
 * One-time login script to generate a Telegram session string.
 * Run with: npm run bot:login
 * Then copy the session string to your .env file as TELEGRAM_SESSION
 */

const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const input = require("input");
require("dotenv").config();

const apiId = parseInt(process.env.TELEGRAM_API_ID);
const apiHash = process.env.TELEGRAM_API_HASH;

if (!apiId || !apiHash) {
  console.error("Error: Set TELEGRAM_API_ID and TELEGRAM_API_HASH in your .env file first.");
  console.error("Get these from: https://my.telegram.org/apps");
  process.exit(1);
}

(async () => {
  console.log("Telegram Login - Session Generator");
  console.log("===================================\n");

  const session = new StringSession("");
  const client = new TelegramClient(session, apiId, apiHash, {
    connectionRetries: 5,
  });

  await client.start({
    phoneNumber: async () => await input.text("Enter your phone number (with country code): "),
    password: async () => await input.text("Enter your 2FA password (if enabled): "),
    phoneCode: async () => await input.text("Enter the code you received: "),
    onError: (err) => console.error("Error:", err),
  });

  const sessionString = client.session.save();

  console.log("\n===================================");
  console.log("Login successful!");
  console.log("\nYour session string (add this to .env as TELEGRAM_SESSION):\n");
  console.log(sessionString);
  console.log("\n===================================");

  await client.disconnect();
  process.exit(0);
})();
