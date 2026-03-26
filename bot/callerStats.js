/**
 * Caller winrate tracking.
 * Tracks per caller: total calls that led to a buy, wins, losses, total PnL.
 * Persists to data/caller_stats.json.
 */

const fs = require("fs");
const path = require("path");

const STATS_FILE = path.join(__dirname, "..", "data", "caller_stats.json");

// Min trades before we judge a caller
const MIN_TRADES_FOR_FILTER = parseInt(process.env.CALLER_MIN_TRADES) || 5;
// Min winrate to keep trusting a caller (0.0 - 1.0)
const MIN_WINRATE = parseFloat(process.env.CALLER_MIN_WINRATE) || 0.2;

/**
 * Load caller stats from disk.
 * Returns: { [callerName]: { wins, losses, totalPnl, trades: [{ token, pnl, multiplier, timestamp }] } }
 */
function loadStats() {
  try {
    if (fs.existsSync(STATS_FILE)) {
      return JSON.parse(fs.readFileSync(STATS_FILE, "utf8"));
    }
  } catch (err) {
    console.error(`[CallerStats] Failed to load: ${err.message}`);
  }
  return {};
}

function saveStats(stats) {
  try {
    fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2));
  } catch (err) {
    console.error(`[CallerStats] Failed to save: ${err.message}`);
  }
}

/**
 * Record the result of a trade for all callers involved.
 * Called when a position is closed (take_profit, stop_loss, or manual).
 */
function recordTradeResult(callers, tokenAddress, pnl, multiplier, symbol) {
  const stats = loadStats();
  const timestamp = Date.now();

  for (const caller of callers) {
    const name = caller.toLowerCase().trim();
    if (!stats[name]) {
      stats[name] = { wins: 0, losses: 0, totalPnl: 0, trades: [] };
    }

    const isWin = pnl > 0;
    if (isWin) {
      stats[name].wins++;
    } else {
      stats[name].losses++;
    }
    stats[name].totalPnl = +(stats[name].totalPnl + pnl).toFixed(6);
    stats[name].trades.push({
      token: tokenAddress,
      symbol: symbol || null,
      pnl: +pnl.toFixed(6),
      multiplier: multiplier ? +multiplier.toFixed(2) : null,
      timestamp,
    });
  }

  saveStats(stats);
  console.log(`[CallerStats] Recorded result for ${callers.join(", ")}: ${pnl >= 0 ? "+" : ""}${pnl.toFixed(4)} SOL (${multiplier?.toFixed(2)}x)`);
}

/**
 * Check if a caller should be trusted based on their history.
 * Returns { trusted, reason, winrate, totalTrades }
 */
function isCallerTrusted(callerName) {
  const stats = loadStats();
  const name = callerName.toLowerCase().trim();
  const s = stats[name];

  if (!s) {
    return { trusted: true, reason: "new caller", winrate: null, totalTrades: 0 };
  }

  const totalTrades = s.wins + s.losses;

  if (totalTrades < MIN_TRADES_FOR_FILTER) {
    return { trusted: true, reason: `only ${totalTrades}/${MIN_TRADES_FOR_FILTER} trades`, winrate: totalTrades > 0 ? s.wins / totalTrades : null, totalTrades };
  }

  const winrate = s.wins / totalTrades;

  if (winrate < MIN_WINRATE) {
    return { trusted: false, reason: `winrate ${(winrate * 100).toFixed(0)}% < ${(MIN_WINRATE * 100).toFixed(0)}%`, winrate, totalTrades };
  }

  return { trusted: true, reason: `winrate ${(winrate * 100).toFixed(0)}%`, winrate, totalTrades };
}

/**
 * Check if a group of callers passes the filter.
 * Returns true if at least one caller is trusted (or new).
 * Also returns details per caller.
 */
function checkCallers(callers) {
  const results = callers.map((c) => ({ caller: c, ...isCallerTrusted(c) }));
  const hasTrusted = results.some((r) => r.trusted);
  const blocked = results.filter((r) => !r.trusted);

  return { allowed: hasTrusted, callerResults: results, blocked };
}

/**
 * Get formatted stats for all callers (for Telegram /callers command).
 */
function getFormattedStats() {
  const stats = loadStats();
  const entries = Object.entries(stats);

  if (entries.length === 0) return "No caller data yet.";

  // Sort by total trades descending
  entries.sort((a, b) => (b[1].wins + b[1].losses) - (a[1].wins + a[1].losses));

  let msg = "";
  for (const [name, s] of entries) {
    const total = s.wins + s.losses;
    const winrate = total > 0 ? ((s.wins / total) * 100).toFixed(0) : 0;
    const pnlSign = s.totalPnl >= 0 ? "+" : "";
    const bar = total > 0 ? "🟢".repeat(s.wins) + "🔴".repeat(s.losses) : "";
    const trusted = isCallerTrusted(name);

    msg += `<b>@${name}</b> ${trusted.trusted ? "✅" : "⛔"}\n`;
    msg += `${bar}\n`;
    msg += `${s.wins}W / ${s.losses}L (${winrate}%) | ${pnlSign}${s.totalPnl.toFixed(4)} SOL\n\n`;
  }

  return msg;
}

module.exports = {
  loadStats,
  recordTradeResult,
  isCallerTrusted,
  checkCallers,
  getFormattedStats,
  MIN_TRADES_FOR_FILTER,
  MIN_WINRATE,
};
