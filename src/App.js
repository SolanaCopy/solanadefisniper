import React, { useState, useEffect, useCallback } from "react";
import io from "socket.io-client";
import "./App.css";

const socket = io("http://localhost:3001");

function App() {
  const [status, setStatus] = useState(null);
  const [trades, setTrades] = useState([]);
  const [calls, setCalls] = useState([]);
  const [tokens, setTokens] = useState([]);
  const [positions, setPositions] = useState([]);
  const [settings, setSettings] = useState({
    autoBuy: false,
    buyAmount: 0.01,
    slippage: 500,
  });
  const [manualToken, setManualToken] = useState("");
  const [buying, setBuying] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("http://localhost:3001/api/status");
      const data = await res.json();
      setStatus(data);
      if (data.autoBuy !== undefined) {
        setSettings({
          autoBuy: data.autoBuy,
          buyAmount: data.buyAmount,
          slippage: data.slippage,
        });
      }
    } catch {
      setStatus({ connected: false, error: "Cannot reach bot server" });
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    fetch("http://localhost:3001/api/trades").then((r) => r.json()).then(setTrades).catch(() => {});
    fetch("http://localhost:3001/api/calls").then((r) => r.json()).then(setCalls).catch(() => {});
    fetch("http://localhost:3001/api/tokens").then((r) => r.json()).then(setTokens).catch(() => {});
    fetch("http://localhost:3001/api/positions").then((r) => r.json()).then(setPositions).catch(() => {});

    socket.on("trade", (trade) => {
      setTrades((prev) => {
        const idx = prev.findIndex((t) => t.id === trade.id);
        if (idx >= 0) {
          const updated = [...prev];
          updated[idx] = trade;
          return updated;
        }
        return [trade, ...prev];
      });
    });

    socket.on("call", (call) => {
      setCalls((prev) => [call, ...prev]);
    });

    socket.on("tokens", (t) => setTokens(t));
    socket.on("positions", (p) => setPositions(p));
    socket.on("settings", (s) => setSettings(s));

    const interval = setInterval(fetchStatus, 30000);
    return () => {
      clearInterval(interval);
      socket.off("trade");
      socket.off("call");
      socket.off("tokens");
      socket.off("positions");
      socket.off("settings");
    };
  }, [fetchStatus]);

  const updateSettings = async (newSettings) => {
    const merged = { ...settings, ...newSettings };
    setSettings(merged);
    await fetch("http://localhost:3001/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(merged),
    });
  };

  const manualBuy = async (tokenAddress) => {
    if (!tokenAddress) return;
    setBuying(true);
    try {
      await fetch("http://localhost:3001/api/buy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tokenAddress }),
      });
      setManualToken("");
    } catch (err) {
      alert("Buy failed: " + err.message);
    }
    setBuying(false);
  };

  return (
    <div className="app">
      <header className="header">
        <h1>Solana Trading Bot</h1>
        <div className="header-right">
          <span className="strategy-badge">Min {status?.minCallers || 3} callers</span>
          <div className={`status-badge ${status?.connected ? "online" : "offline"}`}>
            {status?.connected ? "Connected" : "Offline"}
          </div>
        </div>
      </header>

      <div className="grid">
        {/* Wallet Info */}
        <div className="card">
          <h2>Wallet</h2>
          {status?.connected ? (
            <>
              <p className="mono">{status.wallet}</p>
              <p className="balance">{status.balance?.toFixed(4)} SOL</p>
              <p className="sub">Channel: {status.channel}</p>
            </>
          ) : (
            <p className="error">{status?.error || "Loading..."}</p>
          )}
        </div>

        {/* Settings */}
        <div className="card">
          <h2>Settings</h2>
          <div className="setting-row">
            <label>Auto-Buy</label>
            <button
              className={`toggle ${settings.autoBuy ? "on" : "off"}`}
              onClick={() => updateSettings({ autoBuy: !settings.autoBuy })}
            >
              {settings.autoBuy ? "ON" : "OFF"}
            </button>
          </div>
          <div className="setting-row">
            <label>Buy Amount (SOL)</label>
            <input
              type="number"
              step="0.01"
              min="0.001"
              value={settings.buyAmount}
              onChange={(e) =>
                updateSettings({ buyAmount: parseFloat(e.target.value) || 0.01 })
              }
            />
          </div>
          <div className="setting-row">
            <label>Slippage (bps)</label>
            <input
              type="number"
              step="50"
              min="50"
              value={settings.slippage}
              onChange={(e) =>
                updateSettings({ slippage: parseInt(e.target.value) || 500 })
              }
            />
          </div>
        </div>

        {/* Manual Buy */}
        <div className="card">
          <h2>Manual Buy</h2>
          <div className="manual-buy">
            <input
              type="text"
              placeholder="Token mint address..."
              value={manualToken}
              onChange={(e) => setManualToken(e.target.value)}
            />
            <button
              onClick={() => manualBuy(manualToken)}
              disabled={buying || !manualToken}
            >
              {buying ? "Buying..." : "Buy"}
            </button>
          </div>
        </div>

        {/* Token Tracker — most important section */}
        <div className="card wide">
          <h2>Token Tracker (buy at {status?.minCallers || 3} callers)</h2>
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Token</th>
                  <th>Callers</th>
                  <th>Called By</th>
                  <th>First Seen</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {tokens.length === 0 ? (
                  <tr>
                    <td colSpan="6" className="empty">
                      No tokens tracked yet...
                    </td>
                  </tr>
                ) : (
                  tokens.map((token) => (
                    <tr key={token.tokenAddress} className={token.bought ? "trade-success" : ""}>
                      <td className="mono">{token.tokenAddress.slice(0, 12)}...</td>
                      <td>
                        <span className={`caller-count ${token.callerCount >= (status?.minCallers || 3) ? "ready" : ""}`}>
                          {token.callerCount}/{status?.minCallers || 3}
                        </span>
                      </td>
                      <td className="callers-cell">
                        {token.callers.map((c) => (
                          <span key={c} className="caller-tag">@{c}</span>
                        ))}
                      </td>
                      <td>{new Date(token.firstSeen).toLocaleTimeString()}</td>
                      <td>
                        {token.bought ? (
                          <span className="badge success">Bought</span>
                        ) : (
                          <span className="badge pending">Waiting</span>
                        )}
                      </td>
                      <td>
                        {!token.bought && (
                          <button
                            className="btn-small"
                            onClick={() => manualBuy(token.tokenAddress)}
                            disabled={buying}
                          >
                            Buy Now
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Open Positions */}
        <div className="card wide">
          <h2>
            Positions ({positions.length})
            <span className="sub" style={{ marginLeft: 12 }}>
              Auto-sell {status?.sellPercentage || 50}% at {status?.takeProfit || 2}x
            </span>
          </h2>
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Token</th>
                  <th>Bought For</th>
                  <th>Current Value</th>
                  <th>P/L</th>
                  <th>Status</th>
                  <th>TX</th>
                </tr>
              </thead>
              <tbody>
                {positions.length === 0 ? (
                  <tr>
                    <td colSpan="6" className="empty">
                      No open positions
                    </td>
                  </tr>
                ) : (
                  positions.map((pos) => (
                    <tr key={pos.tokenMint}>
                      <td className="mono">{pos.tokenMint.slice(0, 12)}...</td>
                      <td>{pos.buyAmountSol} SOL</td>
                      <td>
                        {pos.currentValueSol
                          ? `${pos.currentValueSol.toFixed(4)} SOL`
                          : "Checking..."}
                      </td>
                      <td>
                        {pos.multiplier ? (
                          <span
                            className={
                              pos.multiplier >= 2
                                ? "profit-up"
                                : pos.multiplier >= 1
                                ? "profit-neutral"
                                : "profit-down"
                            }
                          >
                            {pos.multiplier.toFixed(2)}x
                          </span>
                        ) : (
                          "-"
                        )}
                      </td>
                      <td>
                        {pos.closed ? (
                          <span className={`badge ${pos.closeReason === "take_profit" ? "success" : "failed"}`}>
                            {pos.closeReason === "take_profit" ? "TP" : "SL"} ({pos.solRecovered?.toFixed(4)} SOL)
                          </span>
                        ) : (
                          <span className="badge pending">Holding</span>
                        )}
                      </td>
                      <td>
                        {pos.sellTxId ? (
                          <a
                            href={`https://solscan.io/tx/${pos.sellTxId}`}
                            target="_blank"
                            rel="noreferrer"
                            className="tx-link"
                          >
                            {pos.sellTxId.slice(0, 8)}...
                          </a>
                        ) : (
                          "-"
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Recent Calls */}
        <div className="card wide">
          <h2>Recent Calls ({calls.length})</h2>
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Caller</th>
                  <th>Token</th>
                  <th>Multi</th>
                  <th>Total Callers</th>
                </tr>
              </thead>
              <tbody>
                {calls.length === 0 ? (
                  <tr>
                    <td colSpan="5" className="empty">
                      Waiting for calls from SpyDeFi...
                    </td>
                  </tr>
                ) : (
                  calls.map((call) => (
                    <tr key={call.id}>
                      <td>{new Date(call.timestamp).toLocaleTimeString()}</td>
                      <td className="caller-tag">@{call.callerName}</td>
                      <td className="mono">{call.tokenAddress.slice(0, 12)}...</td>
                      <td>{call.multiplier ? `x${call.multiplier}` : "-"}</td>
                      <td>
                        <span className={`caller-count ${call.callerCount >= (status?.minCallers || 3) ? "ready" : ""}`}>
                          {call.callerCount}/{status?.minCallers || 3}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Trade Log */}
        <div className="card wide">
          <h2>Trade Log ({trades.length})</h2>
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Token</th>
                  <th>Amount</th>
                  <th>Trigger</th>
                  <th>Status</th>
                  <th>TX</th>
                </tr>
              </thead>
              <tbody>
                {trades.length === 0 ? (
                  <tr>
                    <td colSpan="6" className="empty">
                      No trades yet
                    </td>
                  </tr>
                ) : (
                  trades.map((trade) => (
                    <tr key={trade.id} className={`trade-${trade.status}`}>
                      <td>{new Date(trade.timestamp).toLocaleTimeString()}</td>
                      <td className="mono">{trade.tokenAddress.slice(0, 12)}...</td>
                      <td>{trade.amount} SOL</td>
                      <td>{trade.trigger}</td>
                      <td>
                        <span className={`badge ${trade.status}`}>{trade.status}</span>
                      </td>
                      <td>
                        {trade.txId ? (
                          <a
                            href={`https://solscan.io/tx/${trade.txId}`}
                            target="_blank"
                            rel="noreferrer"
                            className="tx-link"
                          >
                            {trade.txId.slice(0, 8)}...
                          </a>
                        ) : (
                          trade.error || "-"
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
