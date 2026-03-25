const { Connection, Keypair, LAMPORTS_PER_SOL } = require("@solana/web3.js");
const bs58 = require("bs58").default || require("bs58");
const config = require("./config");

let connection = null;
let wallet = null;

function getConnection() {
  if (!connection) {
    connection = new Connection(config.solana.rpcUrl, "confirmed");
  }
  return connection;
}

function getWallet() {
  if (!wallet) {
    if (!config.solana.privateKey) {
      throw new Error("SOLANA_PRIVATE_KEY is not set in .env");
    }
    const secretKey = bs58.decode(config.solana.privateKey);
    wallet = Keypair.fromSecretKey(secretKey);
  }
  return wallet;
}

async function getBalance() {
  const conn = getConnection();
  const w = getWallet();
  const balance = await conn.getBalance(w.publicKey);
  return balance / LAMPORTS_PER_SOL;
}

module.exports = { getConnection, getWallet, getBalance };
