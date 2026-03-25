const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const config = require("./config");
const { initClient, onChannelMessage } = require("./telegram");
const { parseCallMessage } = require("./parser");
const { executeBuy: jupiterBuy } = require("./jupiter");
const { getWallet, getBalance } = require("./wallet");
const { registerCall, getTrackedTokens, MIN_CALLERS } = require("./tracker");
const {
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
} = require("./positions");
const notifier = require("./notifier");
const storage = require("./storage");
const { checkMarketCap, MAX_MCAP } = require("./marketcap");
const { getPortfolio } = require("./portfolio");

// Express + Socket.IO setup
const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
});

// Share socket.io with positions module
setSocketIO(io);

// Load saved data
const trades = storage.loadTrades();
const calls = storage.loadCalls();

console.log(`[Storage] Loaded ${trades.length} trades, ${calls.length} calls`);

// ──────────── API Routes ────────────

app.get("/api/status", async (req, res) => {
  try {
    const wallet = getWallet();
    const balance = await getBalance();
    res.json({
      connected: true,
      wallet: wallet.publicKey.toString(),
      balance,
      autoBuy: config.trading.autoBuy,
      buyAmount: config.trading.buyAmountSol,
      slippage: config.trading.slippageBps,
      channel: config.telegram.channel,
      minCallers: MIN_CALLERS,
      takeProfit: TAKE_PROFIT_MULTIPLIER,
      sellPercentage: SELL_PERCENTAGE,
    });
  } catch (err) {
    res.json({ connected: false, error: err.message });
  }
});

app.get("/api/trades", (req, res) => {
  res.json(trades);
});

app.get("/api/calls", (req, res) => {
  res.json(calls);
});

app.get("/api/tokens", (req, res) => {
  res.json(getTrackedTokens());
});

app.get("/api/positions", (req, res) => {
  res.json(getPositions());
});

app.post("/api/settings", (req, res) => {
  const { autoBuy, buyAmount, slippage } = req.body;
  if (typeof autoBuy === "boolean") config.trading.autoBuy = autoBuy;
  if (typeof buyAmount === "number" && buyAmount > 0) config.trading.buyAmountSol = buyAmount;
  if (typeof slippage === "number" && slippage > 0) config.trading.slippageBps = slippage;

  io.emit("settings", {
    autoBuy: config.trading.autoBuy,
    buyAmount: config.trading.buyAmountSol,
    slippage: config.trading.slippageBps,
  });

  res.json({ ok: true });
});

app.post("/api/buy", async (req, res) => {
  const { tokenAddress } = req.body;
  if (!tokenAddress) return res.status(400).json({ error: "tokenAddress required" });

  try {
    const result = await executeBuy(tokenAddress, "manual");
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ──────────── Buy Logic ────────────

async function executeBuy(tokenAddress, trigger) {
  // Duplicate protection: don't buy same token twice
  if (storage.hasAlreadyBought(tokenAddress)) {
    console.log(`[Bot] Skipping ${tokenAddress} — already bought before`);
    await notifier.sendMessage(
      `━━━━━━━━━━━━━━━━━━━━━\n` +
      `⚠️ <b>DUPLICATE BLOCKED</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `Token already bought before.\n` +
      `<code>${tokenAddress}</code>`
    );
    return { status: "skipped", reason: "already bought" };
  }

  // Market cap check
  const mcapCheck = await checkMarketCap(tokenAddress);
  if (!mcapCheck.allowed) {
    console.log(`[Bot] Skipping ${tokenAddress} — ${mcapCheck.reason}`);
    await notifier.sendMessage(
      `━━━━━━━━━━━━━━━━━━━━━\n` +
      `⚠️ <b>MCAP TOO HIGH</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `Token: <code>${tokenAddress}</code>\n` +
      `Market Cap: <b>$${(mcapCheck.marketCap / 1000).toFixed(0)}K</b>\n` +
      `Max allowed: $${MAX_MCAP / 1000}K\n\n` +
      `❌ Buy skipped`
    );
    return { status: "skipped", reason: mcapCheck.reason };
  }

  console.log(`\n[Bot] Buying token: ${tokenAddress} (trigger: ${trigger} | ${mcapCheck.reason})`);

  const trade = {
    id: trades.length + 1,
    tokenAddress,
    amount: config.trading.buyAmountSol,
    trigger,
    status: "pending",
    timestamp: Date.now(),
  };

  trades.push(trade);
  io.emit("trade", trade);

  try {
    const result = await jupiterBuy(tokenAddress);
    trade.status = "success";
    trade.txId = result.txId;
    trade.outputAmount = result.outputAmount;
    trade.priceImpact = result.priceImpact;
    console.log(`[Bot] Buy successful! TX: ${result.txId}`);

    // Save to disk
    storage.saveBoughtToken(tokenAddress);
    storage.saveTrades(trades);

    // Track position for auto-sell
    addPosition(tokenAddress, config.trading.buyAmountSol, result.outputAmount);
  } catch (err) {
    trade.status = "failed";
    trade.error = err.message;
    console.error(`[Bot] Buy failed: ${err.message}`);
    storage.saveTrades(trades);
  }

  io.emit("trade", trade);
  await notifier.notifyBuy(trade);
  return trade;
}

// ──────────── Main ────────────

async function main() {
  console.log("╔══════════════════════════════════════╗");
  console.log("║       Solana Trading Bot v1.0        ║");
  console.log("║    SpyDeFi Multi-Caller Strategy     ║");
  console.log("╚══════════════════════════════════════╝\n");

  // Start API server
  server.listen(config.port, () => {
    console.log(`[Server] Dashboard API running on http://localhost:${config.port}`);
  });

  // Connect to Telegram
  console.log("[Bot] Connecting to Telegram...");
  await initClient();

  // Show wallet info & send bot started notification
  try {
    const wallet = getWallet();
    const balance = await getBalance();
    console.log(`[Bot] Wallet: ${wallet.publicKey.toString()}`);
    console.log(`[Bot] Balance: ${balance} SOL`);
    console.log(`[Bot] Buy amount: ${config.trading.buyAmountSol} SOL`);
    console.log(`[Bot] Slippage: ${config.trading.slippageBps} bps`);
    console.log(`[Bot] Auto-buy: ${config.trading.autoBuy ? "ON" : "OFF"}`);
    console.log(`[Bot] Min callers: ${MIN_CALLERS}`);
    console.log(`[Bot] Take profit: ${TAKE_PROFIT_MULTIPLIER}x (sell ${SELL_PERCENTAGE}%)`);
    console.log(`[Bot] Stop loss: ${STOP_LOSS_MULTIPLIER > 0 ? STOP_LOSS_MULTIPLIER + "x" : "OFF"}\n`);

    await notifier.notifyBotStarted({
      wallet: wallet.publicKey.toString(),
      balance: balance.toFixed(4),
      buyAmount: config.trading.buyAmountSol,
      minCallers: MIN_CALLERS,
      takeProfit: TAKE_PROFIT_MULTIPLIER,
      stopLoss: STOP_LOSS_MULTIPLIER,
      autoBuy: config.trading.autoBuy,
    });
  } catch (err) {
    console.warn(`[Bot] Wallet warning: ${err.message}`);
  }

  // Restore positions from wallet (tokens bought before restart)
  await restorePositions(storage);

  // Start position monitoring (checks prices every 15s)
  startMonitoring();

  // Start Telegram command listener (/positions, /balance, /stats)
  notifier.startCommandListener(
    getPositions,
    getBalance,
    () => ({
      totalCalls: calls.length,
      tokensTracked: getTrackedTokens().length,
      totalTrades: trades.length,
      successTrades: trades.filter((t) => t.status === "success").length,
      failedTrades: trades.filter((t) => t.status === "failed").length,
      openPositions: getPositions().filter((p) => !p.closed).length,
    }),
    manualSell,
    sellAllPositions,
    getPortfolio,
    () => trades,
  );

  // Listen for channel messages
  onChannelMessage(async (msg) => {
    console.log(`\n[Telegram] New message from ${msg.chatName}:`);
    console.log(`  ${msg.text.substring(0, 200)}${msg.text.length > 200 ? "..." : ""}`);

    // Debug: show if URLs were found in the message
    const hasSpyDefiLink = /t\.me\/spydefi_bot/.test(msg.text);
    const hasSolanaAddr = /[1-9A-HJ-NP-Za-km-z]{32,44}/.test(msg.text);
    console.log(`  [Debug] Length: ${msg.text.length} | SpyDeFi link: ${hasSpyDefiLink} | Solana addr: ${hasSolanaAddr}`);

    const parsed = parseCallMessage(msg.text);
    if (!parsed) {
      console.log("  -> No token/caller found, skipping");
      return;
    }

    console.log(`  -> Caller: @${parsed.callerName}`);
    console.log(`  -> Token: ${parsed.tokenAddress}`);
    if (parsed.multiplier) console.log(`  -> Multiplier: x${parsed.multiplier}`);

    // Skip if already bought
    if (storage.hasAlreadyBought(parsed.tokenAddress)) {
      console.log(`  -> Already bought this token, skipping`);
      return;
    }

    // Register this call in the tracker
    const result = registerCall(parsed.tokenAddress, parsed.callerName);

    const call = {
      id: calls.length + 1,
      tokenAddress: parsed.tokenAddress,
      callerName: parsed.callerName,
      multiplier: parsed.multiplier,
      callerCount: result.callerCount,
      callers: result.callers,
      message: msg.text,
      chatName: msg.chatName,
      timestamp: parsed.timestamp,
    };

    calls.push(call);
    storage.saveCalls(calls);
    io.emit("call", call);
    io.emit("tokens", getTrackedTokens());

    // Notify Telegram group
    await notifier.notifyNewCall({
      ...call,
      minCallers: MIN_CALLERS,
    });

    console.log(`  -> ${result.reason}`);

    if (result.shouldBuy) {
      await notifier.notifyThresholdReached(parsed.tokenAddress, result.callers);

      if (config.trading.autoBuy) {
        console.log(`  -> ${MIN_CALLERS} callers reached! Buying...`);
        await executeBuy(parsed.tokenAddress, `auto (${result.callers.join(", ")})`);
      } else {
        console.log(`  -> ${MIN_CALLERS} callers reached! Auto-buy is OFF, use dashboard to buy.`);
      }
    }
  });

  console.log("[Bot] Monitoring SpyDeFi for multi-caller tokens...\n");
  if (notifier.isEnabled()) {
    console.log("[Bot] Telegram notifications: ON\n");
  } else {
    console.log("[Bot] Telegram notifications: OFF (set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env)\n");
  }
}

main().catch((err) => {
  console.error("[Bot] Fatal error:", err);
  process.exit(1);
});
