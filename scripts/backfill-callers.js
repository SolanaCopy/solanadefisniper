/**
 * One-time backfill: populate caller_stats.json from existing trades.
 * Run once: node scripts/backfill-callers.js
 */

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const TRADES_FILE = path.join(DATA_DIR, "trades.json");
const STATS_FILE = path.join(DATA_DIR, "caller_stats.json");

const RPC = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";

async function getDecimals(mint) {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0", id: 1,
      method: "getAccountInfo",
      params: [mint, { encoding: "jsonParsed" }],
    }),
  });
  const data = await res.json();
  if (data.result && data.result.value) {
    return data.result.value.data.parsed.info.decimals;
  }
  return 6;
}

async function getDexData(addr) {
  const res = await fetch("https://api.dexscreener.com/latest/dex/tokens/" + addr);
  const data = await res.json();
  if (data.pairs && data.pairs.length > 0) {
    const pair = data.pairs.find((p) => p.quoteToken && p.quoteToken.symbol === "SOL") || data.pairs[0];
    return {
      symbol: pair.baseToken ? pair.baseToken.symbol : "?",
      priceNative: parseFloat(pair.priceNative || 0),
    };
  }
  return null;
}

function extractCallers(trigger) {
  const match = trigger.match(/\(([^)]+)\)/);
  if (match) return match[1].split(",").map((c) => c.trim().toLowerCase());
  return [];
}

async function run() {
  if (!fs.existsSync(TRADES_FILE)) {
    console.log("No trades.json found");
    return;
  }

  // Don't overwrite if stats already exist with data
  if (fs.existsSync(STATS_FILE)) {
    const existing = JSON.parse(fs.readFileSync(STATS_FILE, "utf8"));
    if (Object.keys(existing).length > 0) {
      console.log("caller_stats.json already has data, skipping backfill");
      return;
    }
  }

  const trades = JSON.parse(fs.readFileSync(TRADES_FILE, "utf8"));
  const successTrades = trades.filter((t) => t.status === "success");
  console.log(`Backfilling ${successTrades.length} trades...`);

  const stats = {};

  for (let i = 0; i < successTrades.length; i++) {
    const trade = successTrades[i];
    const callers = extractCallers(trade.trigger);
    if (callers.length === 0) continue;

    let decimals, dex;
    try {
      decimals = await getDecimals(trade.tokenAddress);
      dex = await getDexData(trade.tokenAddress);
    } catch (e) {
      console.log(`#${trade.id} ERROR: ${e.message}`);
      continue;
    }

    if (!dex) {
      console.log(`#${trade.id} — no DEX data, skipping`);
      continue;
    }

    const output = trade.output || trade.outputAmount;
    const tokensReceived = Number(BigInt(output)) / Math.pow(10, decimals);
    const buyPricePerToken = trade.amount / tokensReceived;
    const multiplier = dex.priceNative / buyPricePerToken;
    const currentValueSol = tokensReceived * dex.priceNative;
    const pnl = currentValueSol - trade.amount;
    const isWin = pnl > 0;

    console.log(`#${trade.id} ${dex.symbol.padEnd(10)} | ${multiplier.toFixed(2)}x | ${pnl >= 0 ? "+" : ""}${pnl.toFixed(4)} SOL | ${callers.join(", ")}`);

    for (const caller of callers) {
      if (!stats[caller]) {
        stats[caller] = { wins: 0, losses: 0, totalPnl: 0, trades: [] };
      }
      if (isWin) stats[caller].wins++;
      else stats[caller].losses++;
      stats[caller].totalPnl = +(stats[caller].totalPnl + pnl).toFixed(6);
      stats[caller].trades.push({
        token: trade.tokenAddress,
        symbol: dex.symbol,
        pnl: +pnl.toFixed(6),
        multiplier: +multiplier.toFixed(2),
        timestamp: trade.timestamp,
      });
    }

    if (i % 3 === 2 && i < successTrades.length - 1) {
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2));
  console.log(`\nSaved stats for ${Object.keys(stats).length} callers`);
}

// Run directly or export for use in bot startup
if (require.main === module) {
  run().catch(console.error);
}

module.exports = run;
