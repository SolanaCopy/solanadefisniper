const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const TRADES_FILE = path.join(DATA_DIR, "trades.json");
const CALLS_FILE = path.join(DATA_DIR, "calls.json");
const BOUGHT_FILE = path.join(DATA_DIR, "bought.json");

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadJSON(file) {
  try {
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, "utf8"));
    }
  } catch (err) {
    console.error(`[Storage] Failed to load ${file}: ${err.message}`);
  }
  return [];
}

function saveJSON(file, data) {
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error(`[Storage] Failed to save ${file}: ${err.message}`);
  }
}

// ──────────── Trades ────────────

function loadTrades() {
  return loadJSON(TRADES_FILE);
}

function saveTrades(trades) {
  saveJSON(TRADES_FILE, trades);
}

// ──────────── Calls ────────────

function loadCalls() {
  return loadJSON(CALLS_FILE);
}

function saveCalls(calls) {
  saveJSON(CALLS_FILE, calls);
}

// ──────────── Bought tokens (duplicate protection) ────────────

function loadBoughtTokens() {
  return new Set(loadJSON(BOUGHT_FILE));
}

function saveBoughtToken(tokenAddress) {
  const bought = loadJSON(BOUGHT_FILE);
  if (!bought.includes(tokenAddress)) {
    bought.push(tokenAddress);
    saveJSON(BOUGHT_FILE, bought);
  }
}

function hasAlreadyBought(tokenAddress) {
  const bought = loadBoughtTokens();
  return bought.has(tokenAddress);
}

module.exports = {
  loadTrades,
  saveTrades,
  loadCalls,
  saveCalls,
  loadBoughtTokens,
  saveBoughtToken,
  hasAlreadyBought,
};
