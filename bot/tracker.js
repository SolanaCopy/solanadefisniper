/**
 * Tracks token calls from different callers.
 * Only triggers a buy when a token has been called by N unique callers.
 */

const config = require("./config");

// Map: tokenAddress -> { callers: Set<callerName>, firstSeen: timestamp, bought: boolean }
const tokenCalls = new Map();

// Default: buy after 3 unique callers
const MIN_CALLERS = parseInt(process.env.MIN_CALLERS) || 3;

// Ignore tokens older than this (ms) — don't buy stale calls
const MAX_AGE_MS = parseInt(process.env.MAX_AGE_MINUTES || "60") * 60 * 1000;

/**
 * Register a call: a caller mentioned a token.
 * Returns { shouldBuy, token, callerCount, callers }
 */
function registerCall(tokenAddress, callerName) {
  const now = Date.now();

  if (!tokenCalls.has(tokenAddress)) {
    tokenCalls.set(tokenAddress, {
      callers: new Set(),
      firstSeen: now,
      bought: false,
    });
  }

  const entry = tokenCalls.get(tokenAddress);

  // Skip if already bought
  if (entry.bought) {
    return {
      shouldBuy: false,
      tokenAddress,
      callerCount: entry.callers.size,
      callers: [...entry.callers],
      reason: "already bought",
    };
  }

  // Skip if too old
  if (now - entry.firstSeen > MAX_AGE_MS) {
    return {
      shouldBuy: false,
      tokenAddress,
      callerCount: entry.callers.size,
      callers: [...entry.callers],
      reason: "too old",
    };
  }

  // Add caller
  entry.callers.add(callerName.toLowerCase().trim());

  const callerCount = entry.callers.size;
  const shouldBuy = callerCount >= MIN_CALLERS;

  if (shouldBuy) {
    entry.bought = true;
  }

  return {
    shouldBuy,
    tokenAddress,
    callerCount,
    callers: [...entry.callers],
    reason: shouldBuy ? `reached ${MIN_CALLERS} callers` : `${callerCount}/${MIN_CALLERS} callers`,
  };
}

/**
 * Get all tracked tokens and their status
 */
function getTrackedTokens() {
  const tokens = [];
  for (const [address, entry] of tokenCalls) {
    tokens.push({
      tokenAddress: address,
      callerCount: entry.callers.size,
      callers: [...entry.callers],
      firstSeen: entry.firstSeen,
      bought: entry.bought,
    });
  }
  return tokens.sort((a, b) => b.callerCount - a.callerCount);
}

/**
 * Clean up old entries
 */
function cleanup() {
  const now = Date.now();
  for (const [address, entry] of tokenCalls) {
    if (now - entry.firstSeen > MAX_AGE_MS * 2) {
      tokenCalls.delete(address);
    }
  }
}

// Clean up every 10 minutes
setInterval(cleanup, 10 * 60 * 1000);

module.exports = { registerCall, getTrackedTokens, MIN_CALLERS };
