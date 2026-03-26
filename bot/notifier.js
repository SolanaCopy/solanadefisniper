/**
 * Pro trading bot notifications for Telegram group.
 */

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

// Debug: log config at startup
console.log(`[Notifier] BOT_TOKEN: ${BOT_TOKEN ? BOT_TOKEN.slice(0, 8) + "..." : "NOT SET"}`);
console.log(`[Notifier] CHAT_ID: ${CHAT_ID || "NOT SET"}`);

// Cache token names
const tokenNameCache = new Map();

async function getTokenName(mint) {
  if (tokenNameCache.has(mint)) return tokenNameCache.get(mint);
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`);
    if (res.ok) {
      const data = await res.json();
      if (data.pairs && data.pairs.length > 0) {
        const name = data.pairs[0].baseToken?.symbol || mint.slice(0, 8) + "...";
        tokenNameCache.set(mint, name);
        return name;
      }
    }
  } catch {}
  return mint.slice(0, 8) + "...";
}

function isEnabled() {
  return BOT_TOKEN && CHAT_ID;
}

async function sendMessage(text) {
  if (!isEnabled()) {
    console.warn("[Notifier] Skipping — not enabled (missing BOT_TOKEN or CHAT_ID)");
    return;
  }

  try {
    const res = await fetch(`${TELEGRAM_API}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });

    const data = await res.json();
    if (!data.ok) {
      console.error(`[Notifier] Telegram API error: ${data.error_code} — ${data.description}`);
    }
  } catch (err) {
    console.error(`[Notifier] Failed to send: ${err.message}`);
  }
}

// ──────────── Pro Notification Templates ────────────

async function notifyNewCall(call) {
  const progress = "█".repeat(call.callerCount) + "░".repeat(Math.max(0, call.minCallers - call.callerCount));

  await sendMessage(
    `━━━━━━━━━━━━━━━━━━━━━\n` +
    `🔎 <b>SIGNAL DETECTED</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `📡 Scanning SpyDeFi...\n` +
    `├ Caller: <b>@${call.callerName}</b>\n` +
    `├ Token: <code>${call.tokenAddress}</code>\n` +
    `${call.multiplier ? `├ Performance: <b>x${call.multiplier}</b>\n` : ""}` +
    `└ Consensus: [${progress}] ${call.callerCount}/${call.minCallers}\n\n` +
    `${call.callerCount >= call.minCallers ? "⚡ <b>THRESHOLD REACHED — EXECUTING</b>" : call.callerCount === call.minCallers - 1 ? "🔥 <b>1 MORE CALLER TO GO — GET READY</b>" : "⏳ <i>Awaiting more callers...</i>"}\n\n` +
    `<a href="https://dexscreener.com/solana/${call.tokenAddress}">📊 Chart</a> · <a href="https://solscan.io/token/${call.tokenAddress}">🔗 Solscan</a>`
  );
}

async function notifyThresholdReached(tokenAddress, callers) {
  await sendMessage(
    `━━━━━━━━━━━━━━━━━━━━━\n` +
    `🎯 <b>MULTI-CALLER CONFIRMED</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `🔥 <b>${callers.length} callers</b> confirmed on this token\n\n` +
    callers.map((c, i) => `  ${i + 1}. @${c}`).join("\n") + `\n\n` +
    `Token: <code>${tokenAddress}</code>\n\n` +
    `⚡ <b>Initiating buy sequence...</b>\n\n` +
    `<a href="https://dexscreener.com/solana/${tokenAddress}">📊 Chart</a> · <a href="https://solscan.io/token/${tokenAddress}">🔗 Solscan</a>`
  );
}

async function notifyBuy(trade) {
  const name = await getTokenName(trade.tokenAddress);
  if (trade.status === "success") {
    await sendMessage(
      `━━━━━━━━━━━━━━━━━━━━━\n` +
      `✅ <b>BUY EXECUTED</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `📍 Entry Position Opened\n\n` +
      `├ Token: <b>${name}</b>\n` +
      `├ CA: <code>${trade.tokenAddress}</code>\n` +
      `├ Amount: <b>${trade.amount} SOL</b>\n` +
      `├ Trigger: ${trade.trigger}\n` +
      `├ Price Impact: ${trade.priceImpact}%\n` +
      `└ Status: <b>FILLED</b> ✓\n\n` +
      `🔒 Take Profit: x2 (sell 100%)\n` +
      `📡 Monitoring position...\n\n` +
      `<a href="https://solscan.io/tx/${trade.txId}">📝 View TX</a> · <a href="https://dexscreener.com/solana/${trade.tokenAddress}">📊 Chart</a>`
    );
  } else {
    await sendMessage(
      `━━━━━━━━━━━━━━━━━━━━━\n` +
      `❌ <b>BUY FAILED</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `├ Token: <b>${name}</b>\n` +
      `├ CA: <code>${trade.tokenAddress}</code>\n` +
      `├ Amount: ${trade.amount} SOL\n` +
      `└ Error: <i>${trade.error}</i>\n\n` +
      `⚠️ Position not opened`
    );
  }
}

async function notifySell(data) {
  const name = await getTokenName(data.tokenMint);
  if (data.reason === "take_profit") {
    const profit = data.pnl.toFixed(4);
    await sendMessage(
      `💰💰💰 TAKE PROFIT 💰💰💰\n` +
      `━━━━━━━━━━━━━━━━━━━━━\n` +
      `🚀 <b>TAKE PROFIT HIT</b> 🚀\n` +
      `━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `🎉 Position closed in profit!\n\n` +
      `├ Token: <b>${name}</b>\n` +
      `├ Multiplier: <b>${data.multiplier.toFixed(2)}x</b>\n` +
      `├ SOL Out: <b>${data.solReceived.toFixed(4)} SOL</b>\n` +
      `└ P/L: <b>+${profit} SOL</b> 📈\n\n` +
      `<a href="https://solscan.io/tx/${data.txId}">📝 View TX</a>`
    );
  } else {
    await sendMessage(
      `━━━━━━━━━━━━━━━━━━━━━\n` +
      `🛑 <b>STOP LOSS TRIGGERED</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `🔻 Position closed to limit loss\n\n` +
      `├ Token: <b>${name}</b>\n` +
      `├ Multiplier: <b>${data.multiplier.toFixed(2)}x</b>\n` +
      `├ SOL Out: <b>${data.solReceived.toFixed(4)} SOL</b>\n` +
      `└ P/L: <b>${data.pnl.toFixed(4)} SOL</b> 📉\n\n` +
      `<a href="https://solscan.io/tx/${data.txId}">📝 View TX</a>`
    );
  }
}

async function notifyPositionUpdate(positions) {
  if (positions.length === 0) return;

  const open = positions.filter((p) => !p.closed);
  if (open.length === 0) return;

  let totalInvested = 0;
  let totalValue = 0;

  let text =
    `━━━━━━━━━━━━━━━━━━━━━\n` +
    `📊 <b>PORTFOLIO UPDATE</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━━\n\n`;

  for (const pos of open) {
    const emoji = pos.multiplier >= 1.5 ? "🟢" : pos.multiplier >= 1 ? "🟡" : "🔴";
    const pnlSol = (pos.currentValueSol || 0) - pos.buyAmountSol;
    const pnlPct = ((pos.multiplier - 1) * 100).toFixed(1);
    const sign = pnlSol >= 0 ? "+" : "";

    totalInvested += pos.buyAmountSol;
    totalValue += pos.currentValueSol || 0;

    text += `${emoji} <b>${pos.tokenName || pos.tokenMint.slice(0, 8) + "..."}</b>\n`;
    text += `   ├ Entry: ${pos.buyAmountSol} SOL\n`;
    text += `   ├ Value: ${pos.currentValueSol?.toFixed(4) || "?"} SOL\n`;
    text += `   ├ P/L: <b>${sign}${pnlSol.toFixed(4)} SOL (${sign}${pnlPct}%)</b>\n`;
    text += `   └ <a href="https://dexscreener.com/solana/${pos.tokenMint}">📊 Chart</a>\n\n`;
  }

  const totalPnl = totalValue - totalInvested;
  const totalSign = totalPnl >= 0 ? "+" : "";
  const totalEmoji = totalPnl >= 0 ? "📈" : "📉";

  text += `━━━━━━━━━━━━━━━━━━━━━\n`;
  text += `${totalEmoji} <b>Total: ${totalSign}${totalPnl.toFixed(4)} SOL</b>\n`;
  text += `Invested: ${totalInvested.toFixed(4)} · Value: ${totalValue.toFixed(4)}`;

  await sendMessage(text);
}

async function notifyBotStarted(config) {
  await sendMessage(
    `━━━━━━━━━━━━━━━━━━━━━\n` +
    `⚡ <b>BOT ONLINE</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `🤖 SpyDeFi Scanner Active\n\n` +
    `├ Wallet: <code>${config.wallet.slice(0, 6)}...${config.wallet.slice(-4)}</code>\n` +
    `├ Balance: <b>${config.balance} SOL</b>\n` +
    `├ Buy Size: ${config.buyAmount} SOL\n` +
    `├ Min Callers: ${config.minCallers}\n` +
    `├ Take Profit: ${config.takeProfit}x\n` +
    `├ Stop Loss: ${config.stopLoss > 0 ? config.stopLoss + "x" : "OFF"}\n` +
    `└ Auto-Buy: <b>${config.autoBuy ? "✅ ON" : "❌ OFF"}</b>\n\n` +
    `📡 Scanning for multi-caller signals...`
  );
}

/**
 * Start listening for commands in the Telegram group
 * /positions — show open positions
 * /balance — show wallet balance
 * /stats — show bot stats
 */
function startCommandListener(getPositionsFn, getBalanceFn, getStatsFn, sellFn, sellAllFn, getPortfolioFn, getTradesFn) {
  if (!isEnabled()) return;

  const POLL_INTERVAL = 3000;
  let lastUpdateId = 0;

  setInterval(async () => {
    try {
      const res = await fetch(`${TELEGRAM_API}/getUpdates?offset=${lastUpdateId + 1}&timeout=0`);
      const data = await res.json();
      if (!data.ok || !data.result.length) return;

      for (const update of data.result) {
        lastUpdateId = update.update_id;
        const msg = update.message;
        if (!msg || !msg.text) continue;
        if (msg.chat.id.toString() !== CHAT_ID) continue;

        const cmd = msg.text.split("@")[0].toLowerCase();

        if (cmd === "/positions" || cmd === "/pos") {
          try {
            const portfolio = await getPortfolioFn();
            if (portfolio.tokens.length === 0) {
              await sendMessage(
                `━━━━━━━━━━━━━━━━━━━━━\n` +
                `📊 <b>POSITIONS</b>\n` +
                `━━━━━━━━━━━━━━━━━━━━━\n\n` +
                `No tokens in wallet`
              );
            } else {
              let text =
                `━━━━━━━━━━━━━━━━━━━━━\n` +
                `📊 <b>POSITIONS</b>\n` +
                `━━━━━━━━━━━━━━━━━━━━━\n\n` +
                `💰 <b>${portfolio.solBalance.toFixed(4)} SOL</b>\n\n`;

              for (const token of portfolio.tokens) {
                const mcapK = token.marketCap ? `$${(token.marketCap / 1000).toFixed(0)}K` : "?";
                text += `${token.symbol} — <b>$${token.valueUsd.toFixed(2)}</b>\n`;
                text += `   ├ Balance: ${token.balance.toLocaleString()}\n`;
                text += `   ├ MCap: ${mcapK}\n`;
                text += `   └ <a href="https://dexscreener.com/solana/${token.mint}">📊 Chart</a>\n\n`;
              }

              text += `━━━━━━━━━━━━━━━━━━━━━\n`;
              text += `💼 Total tokens: <b>$${portfolio.totalTokenValueUsd.toFixed(2)}</b>`;

              await sendMessage(text);
            }
          } catch (err) {
            await sendMessage(`❌ Error: ${err.message}`);
          }
        }

        if (cmd === "/balance" || cmd === "/bal") {
          const balance = await getBalanceFn();
          await sendMessage(
            `━━━━━━━━━━━━━━━━━━━━━\n` +
            `💰 <b>BALANCE</b>\n` +
            `━━━━━━━━━━━━━━━━━━━━━\n\n` +
            `${balance.toFixed(4)} SOL`
          );
        }

        if (cmd === "/stats") {
          const stats = getStatsFn();
          await sendMessage(
            `━━━━━━━━━━━━━━━━━━━━━\n` +
            `📈 <b>BOT STATS</b>\n` +
            `━━━━━━━━━━━━━━━━━━━━━\n\n` +
            `├ Calls detected: ${stats.totalCalls}\n` +
            `├ Tokens tracked: ${stats.tokensTracked}\n` +
            `├ Trades executed: ${stats.totalTrades}\n` +
            `├ Successful: ${stats.successTrades}\n` +
            `├ Failed: ${stats.failedTrades}\n` +
            `└ Open positions: ${stats.openPositions}`
          );
        }

        // /winrate [week|all] — win/loss stats
        if (cmd.startsWith("/winrate") || cmd.startsWith("/wr")) {
          try {
            const trades = getTradesFn();
            const positions = getPositionsFn();
            const now = new Date();
            const arg = msg.text.split(" ")[1]?.toLowerCase() || "today";

            let periodStart;
            let periodLabel;

            if (arg === "week" || arg === "w") {
              const dayOfWeek = now.getDay() || 7; // Monday = 1
              periodStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOfWeek + 1).getTime();
              periodLabel = "THIS WEEK";
            } else if (arg === "all" || arg === "a") {
              periodStart = 0;
              periodLabel = "ALL TIME";
            } else {
              periodStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
              periodLabel = "TODAY";
            }

            // Filter successful trades in period
            const periodTrades = trades.filter((t) => t.timestamp >= periodStart && t.status === "success");

            if (periodTrades.length === 0) {
              await sendMessage(
                `━━━━━━━━━━━━━━━━━━━━━\n` +
                `📊 <b>WINRATE — ${periodLabel}</b>\n` +
                `━━━━━━━━━━━━━━━━━━━━━\n\n` +
                `No trades in this period`
              );
              continue;
            }

            let wins = 0;
            let losses = 0;
            let totalPnlSol = 0;
            let details = "";

            for (const trade of periodTrades) {
              // Check if position was sold (closed)
              const pos = positions.find((p) => p.tokenMint === trade.tokenAddress);

              let pnlSol = 0;
              let status = "";

              if (pos && pos.closed && pos.solRecovered !== null) {
                // Position was sold
                pnlSol = pos.solRecovered - trade.amount;
                status = pnlSol >= 0 ? "✅ WIN" : "❌ LOSS";
              } else if (pos && pos.currentValueSol !== null) {
                // Still open — use current value
                pnlSol = pos.currentValueSol - trade.amount;
                status = pnlSol >= 0 ? "🟢 OPEN" : "🔴 OPEN";
              } else {
                // Unknown
                status = "⏳ ?";
              }

              if (pnlSol >= 0) wins++;
              else losses++;
              totalPnlSol += pnlSol;

              const name = pos?.tokenName || await getTokenName(trade.tokenAddress);
              const sign = pnlSol >= 0 ? "+" : "";
              details += `${status} <b>${name}</b> ${sign}${pnlSol.toFixed(4)} SOL\n`;
            }

            const total = wins + losses;
            const winPct = total > 0 ? ((wins / total) * 100).toFixed(0) : 0;
            const totalSign = totalPnlSol >= 0 ? "+" : "";
            const barFilled = Math.round((wins / Math.max(total, 1)) * 10);
            const bar = "🟢".repeat(barFilled) + "🔴".repeat(10 - barFilled);

            await sendMessage(
              `━━━━━━━━━━━━━━━━━━━━━\n` +
              `📊 <b>WINRATE — ${periodLabel}</b>\n` +
              `━━━━━━━━━━━━━━━━━━━━━\n\n` +
              `${bar}\n\n` +
              `├ Trades: <b>${total}</b>\n` +
              `├ Wins: <b>${wins}</b>\n` +
              `├ Losses: <b>${losses}</b>\n` +
              `├ Winrate: <b>${winPct}%</b>\n` +
              `└ P/L: <b>${totalSign}${totalPnlSol.toFixed(4)} SOL</b>\n\n` +
              details
            );
          } catch (err) {
            await sendMessage(`❌ Winrate error: ${err.message}`);
          }
        }

        // /sell <token> — sell a specific position
        if (cmd.startsWith("/sell ") && cmd !== "/sellall") {
          const tokenMint = msg.text.split(" ")[1]?.trim();
          if (!tokenMint) {
            await sendMessage("Usage: /sell <token_address>");
            continue;
          }
          await sendMessage(
            `━━━━━━━━━━━━━━━━━━━━━\n` +
            `🔄 <b>SELLING...</b>\n` +
            `━━━━━━━━━━━━━━━━━━━━━\n\n` +
            `Token: <code>${tokenMint}</code>`
          );
          const result = await sellFn(tokenMint);
          if (!result.success) {
            await sendMessage(`❌ Sell failed: ${result.error}`);
          }
        }

        // /sellall — sell all open positions
        if (cmd === "/sellall") {
          const positions = getPositionsFn().filter((p) => !p.closed);
          if (positions.length === 0) {
            await sendMessage(
              `━━━━━━━━━━━━━━━━━━━━━\n` +
              `📊 <b>SELL ALL</b>\n` +
              `━━━━━━━━━━━━━━━━━━━━━\n\n` +
              `No open positions to sell`
            );
            continue;
          }
          await sendMessage(
            `━━━━━━━━━━━━━━━━━━━━━\n` +
            `🔄 <b>SELLING ALL ${positions.length} POSITIONS...</b>\n` +
            `━━━━━━━━━━━━━━━━━━━━━`
          );
          const results = await sellAllFn();
          const success = results.filter((r) => r.success).length;
          const failed = results.filter((r) => !r.success).length;
          await sendMessage(
            `━━━━━━━━━━━━━━━━━━━━━\n` +
            `✅ <b>SELL ALL COMPLETE</b>\n` +
            `━━━━━━━━━━━━━━━━━━━━━\n\n` +
            `├ Sold: ${success}\n` +
            `└ Failed: ${failed}`
          );
        }

        // /portfolio — full wallet overview
        if (cmd === "/portfolio" || cmd === "/port") {
          await sendMessage(`⏳ Fetching portfolio...`);
          try {
            const portfolio = await getPortfolioFn();

            let text =
              `━━━━━━━━━━━━━━━━━━━━━\n` +
              `💼 <b>PORTFOLIO</b>\n` +
              `━━━━━━━━━━━━━━━━━━━━━\n\n` +
              `💰 <b>${portfolio.solBalance.toFixed(4)} SOL</b>\n\n`;

            if (portfolio.tokens.length === 0) {
              text += `No tokens found\n`;
            } else {
              for (const token of portfolio.tokens) {
                const mcapK = token.marketCap ? `$${(token.marketCap / 1000).toFixed(0)}K` : "?";
                text += `${token.symbol} — <b>$${token.valueUsd.toFixed(2)}</b>\n`;
                text += `   ├ Balance: ${token.balance.toLocaleString()}\n`;
                text += `   ├ MCap: ${mcapK}\n`;
                text += `   └ <a href="https://dexscreener.com/solana/${token.mint}">📊 Chart</a>\n\n`;
              }
              text += `━━━━━━━━━━━━━━━━━━━━━\n`;
              text += `Total tokens: <b>$${portfolio.totalTokenValueUsd.toFixed(2)}</b>`;
            }

            await sendMessage(text);
          } catch (err) {
            await sendMessage(`❌ Portfolio error: ${err.message}`);
          }
        }

        // /callers — show caller winrate stats
        if (cmd === "/callers") {
          const { getFormattedStats } = require("./callerStats");
          const stats = getFormattedStats();
          await sendMessage(
            `━━━━━━━━━━━━━━━━━━━━━\n` +
            `📊 <b>CALLER WINRATES</b>\n` +
            `━━━━━━━━━━━━━━━━━━━━━\n\n` +
            stats
          );
        }

        // /help — show available commands
        if (cmd === "/help") {
          await sendMessage(
            `━━━━━━━━━━━━━━━━━━━━━\n` +
            `🤖 <b>COMMANDS</b>\n` +
            `━━━━━━━━━━━━━━━━━━━━━\n\n` +
            `/portfolio — Full wallet overview\n` +
            `/positions — Open positions + P/L\n` +
            `/winrate — Today's stats\n` +
            `/winrate week — This week\n` +
            `/winrate all — All time\n` +
            `/balance — Wallet balance\n` +
            `/stats — Bot statistics\n` +
            `/callers — Caller winrates\n` +
            `/sell <address> — Sell 1 token\n` +
            `/sellall — Sell all positions\n` +
            `/help — This menu`
          );
        }
      }
    } catch (err) {
      // Silently ignore polling errors
    }
  }, POLL_INTERVAL);

  console.log("[Notifier] Listening for commands: /positions /balance /stats /sell /sellall /help");
}

module.exports = {
  isEnabled,
  sendMessage,
  notifyNewCall,
  notifyThresholdReached,
  notifyBuy,
  notifySell,
  notifyPositionUpdate,
  notifyBotStarted,
  startCommandListener,
};
