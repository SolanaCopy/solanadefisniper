const { PublicKey } = require("@solana/web3.js");
const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const TOKEN_2022_PROGRAM_ID = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
const { getConnection, getWallet } = require("./wallet");

async function getAllTokenAccounts() {
  const wallet = getWallet();
  const connection = getConnection();
  const [acc1, acc2] = await Promise.all([
    connection.getParsedTokenAccountsByOwner(wallet.publicKey, { programId: TOKEN_PROGRAM_ID }),
    connection.getParsedTokenAccountsByOwner(wallet.publicKey, { programId: TOKEN_2022_PROGRAM_ID }),
  ]);
  return [...acc1.value, ...acc2.value];
}
const { executeSell, getTokenValueInSol } = require("./jupiter");
const notifier = require("./notifier");

// Active positions: tokenMint -> position data
const positions = new Map();

// Take profit: sell when token goes up X from our entry
const TAKE_PROFIT_MULTIPLIER = parseFloat(process.env.TAKE_PROFIT_X) || 1.5;
const SELL_PERCENTAGE = parseFloat(process.env.SELL_PERCENTAGE) || 100;

// Stop loss: sell everything if token drops below X from our entry
const STOP_LOSS_MULTIPLIER = process.env.STOP_LOSS_X !== undefined ? parseFloat(process.env.STOP_LOSS_X) : 0.7;

// Check interval in ms
const CHECK_INTERVAL_MS = parseInt(process.env.PRICE_CHECK_INTERVAL_MS) || 15000;

let io = null;
let checkRunning = false;

function setSocketIO(socketIO) {
  io = socketIO;
}

/**
 * Add a new position after a successful buy
 */
async function addPosition(tokenMint, buyAmountSol, tokenAmount) {
  // Fetch token name from DexScreener
  let tokenName = null;
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${tokenMint}`);
    if (res.ok) {
      const data = await res.json();
      if (data.pairs && data.pairs.length > 0) {
        tokenName = data.pairs[0].baseToken?.symbol || null;
      }
    }
  } catch {}

  positions.set(tokenMint, {
    tokenMint,
    tokenName: tokenName || tokenMint.slice(0, 8) + "...",
    buyAmountSol,
    tokenAmount: BigInt(tokenAmount),
    buyTime: Date.now(),
    closed: false,
    closeReason: null,
    currentValueSol: null,
    multiplier: null,
    sellTxId: null,
    solRecovered: null,
  });

  console.log(
    `[Positions] Tracking ${tokenMint}: bought for ${buyAmountSol} SOL, got ${tokenAmount} tokens`
  );
}

/**
 * Execute a sell for a position
 */
async function sellPosition(tokenMint, position, currentBalance, reason) {
  const pct = reason === "stop_loss" ? 100 : SELL_PERCENTAGE;
  const sellAmount = (BigInt(currentBalance) * BigInt(pct)) / 100n;

  console.log(`[Positions] ${reason.toUpperCase()}: Selling ${pct}% of ${tokenMint.slice(0, 8)}...`);

  const result = await executeSell(tokenMint, sellAmount.toString());
  position.closed = true;
  position.closeReason = reason;
  position.sellTxId = result.txId;
  position.solRecovered = result.solReceived;

  const pnl = result.solReceived - position.buyAmountSol;
  const pnlSign = pnl >= 0 ? "+" : "";

  console.log(
    `[Positions] ${reason.toUpperCase()}: Sold ${tokenMint.slice(0, 8)}... for ${result.solReceived.toFixed(4)} SOL (${pnlSign}${pnl.toFixed(4)} SOL)`
  );

  const sellData = {
    tokenMint,
    reason,
    multiplier: position.multiplier,
    soldPercentage: pct,
    solReceived: result.solReceived,
    pnl,
    txId: result.txId,
  };

  if (io) {
    io.emit("sell", sellData);
    io.emit("positions", getPositions());
  }

  await notifier.notifySell(sellData);
}

/**
 * Check all positions for take-profit and stop-loss
 */
async function checkPositions() {
  if (checkRunning || positions.size === 0) return;
  checkRunning = true;

  try {
    const wallet = getWallet();
    const connection = getConnection();

    // Get all token accounts for our wallet
    const tokenAccounts = { value: await getAllTokenAccounts() };

    // Build a map of current token balances
    const balances = new Map();
    for (const account of tokenAccounts.value) {
      const info = account.account.data.parsed.info;
      balances.set(info.mint, info.tokenAmount.amount);
    }

    for (const [tokenMint, position] of positions) {
      if (position.closed) continue;

      // Get current balance
      const currentBalance = balances.get(tokenMint);
      if (!currentBalance || currentBalance === "0") {
        // Don't remove if position was just bought (< 60 seconds ago)
        const age = Date.now() - position.buyTime;
        if (age < 60000) {
          console.log(`[Positions] ${tokenMint.slice(0, 8)}... no balance yet, waiting (${Math.round(age / 1000)}s old)`);
          continue;
        }
        console.log(`[Positions] ${tokenMint.slice(0, 8)}... no balance found, removing`);
        positions.delete(tokenMint);
        continue;
      }

      // Get current value in SOL
      const currentValueSol = await getTokenValueInSol(tokenMint, currentBalance);
      if (currentValueSol === null) continue;

      const multiplier = currentValueSol / position.buyAmountSol;
      const prevMultiplier = position.multiplier;
      position.currentValueSol = currentValueSol;
      position.multiplier = multiplier;

      // Only log when multiplier changes by more than 2%
      if (!prevMultiplier || Math.abs(multiplier - prevMultiplier) > 0.02) {
        const pnlSol = currentValueSol - position.buyAmountSol;
        const sign = pnlSol >= 0 ? "+" : "";
        console.log(
          `[Positions] ${tokenMint.slice(0, 8)}... = ${currentValueSol.toFixed(4)} SOL (${multiplier.toFixed(2)}x | ${sign}${pnlSol.toFixed(4)} SOL)`
        );
      }

      if (io) io.emit("positions", getPositions());

      // Take profit
      if (multiplier >= TAKE_PROFIT_MULTIPLIER) {
        console.log(`[Positions] 🚀 ${tokenMint.slice(0, 8)}... HIT ${multiplier.toFixed(2)}x — SELLING!`);
        try {
          await sellPosition(tokenMint, position, currentBalance, "take_profit");
        } catch (err) {
          console.error(`[Positions] Take profit failed: ${err.message}`);
        }
      }
      // Stop loss (disabled when STOP_LOSS_X=0)
      else if (STOP_LOSS_MULTIPLIER > 0 && multiplier <= STOP_LOSS_MULTIPLIER) {
        try {
          await sellPosition(tokenMint, position, currentBalance, "stop_loss");
        } catch (err) {
          console.error(`[Positions] Stop loss failed: ${err.message}`);
        }
      }
    }
  } catch (err) {
    console.error(`[Positions] Check error: ${err.message}`);
  }

  checkRunning = false;
}

/**
 * Get all positions for the dashboard
 */
function getPositions() {
  const result = [];
  for (const [, pos] of positions) {
    result.push({
      tokenMint: pos.tokenMint,
      tokenName: pos.tokenName,
      buyAmountSol: pos.buyAmountSol,
      tokenAmount: pos.tokenAmount.toString(),
      currentValueSol: pos.currentValueSol,
      multiplier: pos.multiplier,
      closed: pos.closed,
      closeReason: pos.closeReason,
      sellTxId: pos.sellTxId,
      solRecovered: pos.solRecovered,
      buyTime: pos.buyTime,
    });
  }
  return result.sort((a, b) => b.buyTime - a.buyTime);
}

// Send position summary to Telegram every 5 minutes
const SUMMARY_INTERVAL_MS = 30 * 60 * 1000;
let lastSummaryTime = 0;

async function sendPositionSummary() {
  const open = getPositions().filter((p) => !p.closed);
  if (open.length === 0) return;

  // Only send every 5 minutes
  const now = Date.now();
  if (now - lastSummaryTime < SUMMARY_INTERVAL_MS) return;
  lastSummaryTime = now;

  await notifier.notifyPositionUpdate(open);
}

/**
 * Restore positions from wallet on startup.
 * Looks for tokens in the wallet that are in bought.json but not yet tracked.
 */
async function restorePositions(storage) {
  try {
    const wallet = getWallet();
    const connection = getConnection();

    const tokenAccounts = { value: await getAllTokenAccounts() };

    const boughtTokens = storage.loadBoughtTokens();
    let restored = 0;

    for (const account of tokenAccounts.value) {
      const info = account.account.data.parsed.info;
      const mint = info.mint;
      const amount = info.tokenAmount.amount;

      if (amount === "0") continue;
      if (positions.has(mint)) continue;
      if (!boughtTokens.has(mint)) continue;

      // Find the original trade to get buy amount
      const trades = storage.loadTrades();
      const trade = trades.find((t) => t.tokenAddress === mint && t.status === "success");
      const buyAmount = trade ? trade.amount : 0.1; // fallback

      addPosition(mint, buyAmount, amount);
      restored++;
    }

    if (restored > 0) {
      console.log(`[Positions] Restored ${restored} positions from wallet`);
    }
  } catch (err) {
    console.error(`[Positions] Restore error: ${err.message}`);
  }
}

/**
 * Start the price monitoring loop
 */
function startMonitoring() {
  console.log(
    `[Positions] Take profit: ${TAKE_PROFIT_MULTIPLIER}x (sell ${SELL_PERCENTAGE}%) | Stop loss: ${STOP_LOSS_MULTIPLIER > 0 ? STOP_LOSS_MULTIPLIER + "x" : "OFF"} | Check every ${CHECK_INTERVAL_MS / 1000}s`
  );
  setInterval(async () => {
    await checkPositions();
    await sendPositionSummary();
  }, CHECK_INTERVAL_MS);
}

/**
 * Manually sell a position (100%)
 */
async function manualSell(tokenMint) {
  const position = positions.get(tokenMint);
  if (!position || position.closed) {
    return { success: false, error: "Position not found or already closed" };
  }

  const wallet = getWallet();
  const connection = getConnection();

  const tokenAccounts = { value: await getAllTokenAccounts() };

  let currentBalance = null;
  for (const account of tokenAccounts.value) {
    const info = account.account.data.parsed.info;
    if (info.mint === tokenMint) {
      currentBalance = info.tokenAmount.amount;
      break;
    }
  }

  if (!currentBalance || currentBalance === "0") {
    positions.delete(tokenMint);
    return { success: false, error: "No token balance found" };
  }

  await sellPosition(tokenMint, position, currentBalance, "manual");
  return { success: true, solReceived: position.solRecovered };
}

/**
 * Sell all open positions
 */
async function sellAllPositions() {
  const results = [];
  for (const [tokenMint, position] of positions) {
    if (position.closed) continue;
    try {
      const result = await manualSell(tokenMint);
      results.push({ tokenMint, ...result });
    } catch (err) {
      results.push({ tokenMint, success: false, error: err.message });
    }
  }
  return results;
}

module.exports = {
  addPosition,
  getPositions,
  startMonitoring,
  restorePositions,
  setSocketIO,
  manualSell,
  sellAllPositions,
  TAKE_PROFIT_MULTIPLIER,
  SELL_PERCENTAGE,
  STOP_LOSS_MULTIPLIER,
};
