/**
 * Parser for SpyDeFi Telegram channel messages.
 *
 * Example format:
 * "Achievement Unlocked: x2! ✌️
 *  @Kulture_Kall made a x2+ call on Da Pang The Lea... (https://t.me/spydefi_bot?start=AdMwJB8HT8Ad5iEg7BghnMxY99UYnKWu4zAznVD7pump).
 *  $167K ➡️ $364K"
 */

const KNOWN_ADDRESSES = new Set([
  "So11111111111111111111111111111111111111112",
  "11111111111111111111111111111111",
]);

// Solana base58 chars: 1-9, A-H, J-N, P-Z, a-k, m-z (no 0, O, I, l)
const SOLANA_ADDRESS_REGEX = /[1-9A-HJ-NP-Za-km-z]{32,44}/g;

// SpyDeFi bot link: extract token address from start= parameter
const SPYDEFI_LINK_REGEX = /t\.me\/spydefi_bot\?start=([A-Za-z0-9]+)/g;

// Caller name: @username made a x2+ call
const CALLER_REGEX = /@([A-Za-z0-9_]+)\s+made/i;

// Multiplier: x2, x5, x10 etc.
const MULTIPLIER_REGEX = /x(\d+)\+?\s*(?:call|!)/i;

// Messages that are NOT calls (filter these out)
const SKIP_PATTERNS = [
  /RECENTLY CALLED/i,
  /TRENDING/i,
  /has made \d+\+? calls/i,    // "has made 5+ calls today" — stats, not a call
  /consistency/i,               // consistency achievements
  /Locked In/i,
  /posted one of the biggest/i, // "X Printer" — daily summary, not a live call
];

/**
 * Check if a string is a valid Solana address (base58, correct chars)
 */
function isValidSolanaAddress(addr) {
  if (addr.length < 32 || addr.length > 44) return false;
  if (KNOWN_ADDRESSES.has(addr)) return false;
  // Must NOT start with 0x (Ethereum)
  if (addr.startsWith("0x")) return false;
  // Must contain at least 1 uppercase AND 1 lowercase (real Solana addresses do)
  if (!/[A-Z]/.test(addr) || !/[a-z]/.test(addr)) return false;
  // Must only contain base58 chars (no 0, O, I, l)
  if (/[0OIl]/.test(addr)) return false;
  return true;
}

function extractTokenAddresses(text) {
  if (!text) return [];

  const addresses = [];

  // First try SpyDeFi bot links — the start= param IS the token address
  const linkMatches = [...text.matchAll(SPYDEFI_LINK_REGEX)];
  for (const match of linkMatches) {
    const param = match[1];
    if (isValidSolanaAddress(param)) {
      addresses.push(param);
    }
  }

  // Also scan for raw Solana addresses in the text
  const rawMatches = text.match(SOLANA_ADDRESS_REGEX) || [];
  for (const addr of rawMatches) {
    if (isValidSolanaAddress(addr)) {
      addresses.push(addr);
    }
  }

  return [...new Set(addresses)];
}

function extractCallerName(text) {
  if (!text) return null;

  const match = text.match(CALLER_REGEX);
  if (match) return match[1];

  return null; // Only accept "@user made" pattern — no fallback
}

function extractMultiplier(text) {
  if (!text) return null;

  const match = text.match(MULTIPLIER_REGEX);
  if (match) return parseInt(match[1]);

  const achievementMatch = text.match(/x(\d+)\+?!/);
  if (achievementMatch) return parseInt(achievementMatch[1]);

  return null;
}

/**
 * Parse a SpyDeFi message to extract token, caller, and multiplier.
 * Only matches actual call messages (e.g. "@user made a x2+ call on ...").
 */
function parseCallMessage(text) {
  if (!text) return null;

  // Skip non-call messages
  for (const pattern of SKIP_PATTERNS) {
    if (pattern.test(text)) return null;
  }

  // Must contain "made a" to be an actual call
  if (!/made a/i.test(text)) return null;

  const callerName = extractCallerName(text);
  if (!callerName) return null;

  const addresses = extractTokenAddresses(text);
  if (addresses.length === 0) return null;

  const multiplier = extractMultiplier(text);

  return {
    tokenAddress: addresses[0],
    allAddresses: addresses,
    callerName,
    multiplier,
    rawMessage: text,
    timestamp: Date.now(),
  };
}

module.exports = { extractTokenAddresses, extractCallerName, extractMultiplier, parseCallMessage };
