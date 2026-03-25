require("dotenv").config();

const config = {
  // Telegram
  telegram: {
    apiId: parseInt(process.env.TELEGRAM_API_ID),
    apiHash: process.env.TELEGRAM_API_HASH,
    session: process.env.TELEGRAM_SESSION || "",
    channel: process.env.TELEGRAM_CHANNEL,
  },

  // Solana
  solana: {
    privateKey: process.env.SOLANA_PRIVATE_KEY,
    rpcUrl: process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com",
  },

  // Trading
  trading: {
    buyAmountSol: parseFloat(process.env.BUY_AMOUNT_SOL) || 0.01,
    slippageBps: parseInt(process.env.SLIPPAGE_BPS) || 500,
    autoBuy: process.env.AUTO_BUY === "true",
  },

  // Server
  port: parseInt(process.env.PORT) || 3001,
};

module.exports = config;
