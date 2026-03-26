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

  // Sort by total PnL descending (best earners first)
  entries.sort((a, b) => b[1].totalPnl - a[1].totalPnl);

  let msg = "";

  // Top 3 best callers
  const withTrades = entries.filter(([, s]) => s.wins + s.losses > 0);
  if (withTrades.length > 0) {
    const medals = ["🥇", "🥈", "🥉"];
    msg += `<b>TOP CALLERS (by profit)</b>\n`;
    for (let i = 0; i < Math.min(3, withTrades.length); i++) {
      const [name, s] = withTrades[i];
      if (s.totalPnl <= 0 && i > 0) break;
      const total = s.wins + s.losses;
      const winrate = ((s.wins / total) * 100).toFixed(0);
      msg += `${medals[i] || ""} <b>@${name}</b> — ${s.totalPnl >= 0 ? "+" : ""}${s.totalPnl.toFixed(4)} SOL (${winrate}% WR)\n`;
    }
    msg += `\n`;

    // Top 3 by winrate (min 2 trades)
    const byWinrate = withTrades
      .filter(([, s]) => s.wins + s.losses >= 2)
      .sort((a, b) => {
        const wrA = a[1].wins / (a[1].wins + a[1].losses);
        const wrB = b[1].wins / (b[1].wins + b[1].losses);
        return wrB - wrA;
      });

    if (byWinrate.length > 0) {
      msg += `<b>BEST WINRATE (min 2 trades)</b>\n`;
      for (let i = 0; i < Math.min(3, byWinrate.length); i++) {
        const [name, s] = byWinrate[i];
        const total = s.wins + s.losses;
        const winrate = ((s.wins / total) * 100).toFixed(0);
        if (s.wins === 0 && i > 0) break;
        msg += `${medals[i] || ""} <b>@${name}</b> — ${winrate}% (${s.wins}W/${s.losses}L)\n`;
      }
      msg += `\n`;
    }

    msg += `━━━━━━━━━━━━━━━━━━━━━\n\n`;
  }

  // Full list
  for (const [name, s] of entries) {
    const total = s.wins + s.losses;
    const winrate = total > 0 ? ((s.wins / total) * 100).toFixed(0) : 0;
    const pnlSign = s.totalPnl >= 0 ? "+" : "";
    const bar = total > 0 ? "🟢".repeat(Math.min(s.wins, 10)) + "🔴".repeat(Math.min(s.losses, 10)) : "";
    const trusted = isCallerTrusted(name);

    msg += `<b>@${name}</b> ${trusted.trusted ? "✅" : "⛔"}\n`;
    msg += `${bar}\n`;
    msg += `${s.wins}W / ${s.losses}L (${winrate}%) | ${pnlSign}${s.totalPnl.toFixed(4)} SOL\n\n`;
  }

  return msg;
}

/**
 * Get a short caller reputation line for use in buy notifications.
 * e.g. "@caller1 (60% WR, +0.3 SOL) | @caller2 (new)"
 */
function getCallerReputation(callers) {
  const stats = loadStats();
  return callers.map((c) => {
    const name = c.toLowerCase().trim();
    const s = stats[name];
    if (!s || s.wins + s.losses === 0) return `@${c} (new)`;
    const total = s.wins + s.losses;
    const winrate = ((s.wins / total) * 100).toFixed(0);
    const pnl = s.totalPnl >= 0 ? "+" : "";
    return `@${c} (${winrate}% | ${pnl}${s.totalPnl.toFixed(3)} SOL)`;
  }).join("\n");
}

module.exports = {
  loadStats,
  recordTradeResult,
  isCallerTrusted,
  checkCallers,
  getFormattedStats,
  getCallerReputation,
  MIN_TRADES_FOR_FILTER,
  MIN_WINRATE,
};
