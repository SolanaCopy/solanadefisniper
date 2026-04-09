const { PublicKey, VersionedTransaction } = require("@solana/web3.js");
const config = require("./config");
const { getConnection, getWallet } = require("./wallet");

const WSOL_MINT = "So11111111111111111111111111111111111111112";
const JUPITER_QUOTE_API = "https://lite-api.jup.ag/swap/v1/quote";
const JUPITER_SWAP_API = "https://lite-api.jup.ag/swap/v1/swap";

/**
 * Get a swap quote from Jupiter (buy: SOL -> token, sell: token -> SOL)
 */
async function getQuote(inputMint, outputMint, amount) {
  const params = new URLSearchParams({
    inputMint,
    outputMint,
    amount: amount.toString(),
    slippageBps: config.trading.slippageBps.toString(),
  });

  const response = await fetch(`${JUPITER_QUOTE_API}?${params}`);
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Jupiter quote failed: ${error}`);
  }

  return response.json();
}

/**
 * Send a Jupiter swap transaction
 */
async function sendSwapTransaction(quote) {
  const wallet = getWallet();
  const connection = getConnection();

  const swapResponse = await fetch(JUPITER_SWAP_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey: wallet.publicKey.toString(),
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: "auto",
    }),
  });

  if (!swapResponse.ok) {
    const error = await swapResponse.text();
    throw new Error(`Jupiter swap failed: ${error}`);
  }

  const { swapTransaction } = await swapResponse.json();

  const txBuf = Buffer.from(swapTransaction, "base64");
  const transaction = VersionedTransaction.deserialize(txBuf);
  transaction.sign([wallet]);

  const txId = await connection.sendRawTransaction(transaction.serialize(), {
    skipPreflight: false,
    maxRetries: 5,
  });

  console.log(`[Jupiter] Transaction sent: ${txId}`);

  // Wait for confirmation with timeout
  const startTime = Date.now();
  const TIMEOUT = 60000; // 60 seconds

  while (Date.now() - startTime < TIMEOUT) {
    const status = await connection.getSignatureStatuses([txId]);
    const result = status.value[0];

    if (result) {
      if (result.err) {
        throw new Error(`Transaction failed on-chain: ${JSON.stringify(result.err)}`);
      }
      if (result.confirmationStatus === "confirmed" || result.confirmationStatus === "finalized") {
        console.log(`[Jupiter] Transaction confirmed: ${result.confirmationStatus}`);
        return txId;
      }
    }

    await new Promise((r) => setTimeout(r, 2000));
  }

  throw new Error(`Transaction not confirmed after ${TIMEOUT / 1000}s — likely dropped: ${txId}`);
}

/**
 * Buy: SOL -> Token
 */
async function executeBuy(tokenMint) {
  const amountLamports = Math.floor(config.trading.buyAmountSol * 1e9);

  console.log(`[Jupiter] Buying: ${config.trading.buyAmountSol} SOL -> ${tokenMint}`);

  const quote = await getQuote(WSOL_MINT, tokenMint, amountLamports);

  console.log(
    `[Jupiter] Quote: ${quote.outAmount} tokens, Price impact: ${quote.priceImpactPct}%`
  );

  const txId = await sendSwapTransaction(quote);
  console.log(`[Jupiter] Buy confirmed! TX: ${txId}`);

  return {
    txId,
    inputAmount: config.trading.buyAmountSol,
    outputAmount: quote.outAmount,
    priceImpact: quote.priceImpactPct,
    tokenMint,
  };
}

/**
 * Sell: Token -> SOL
 * @param tokenMint - token to sell
 * @param amount - amount of tokens to sell (raw, with decimals)
 */
async function executeSell(tokenMint, amount) {
  console.log(`[Jupiter] Selling: ${amount} tokens of ${tokenMint} -> SOL`);

  const quote = await getQuote(tokenMint, WSOL_MINT, amount);

  const solOut = parseInt(quote.outAmount) / 1e9;
  console.log(
    `[Jupiter] Quote: ${solOut.toFixed(4)} SOL back, Price impact: ${quote.priceImpactPct}%`
  );

  const txId = await sendSwapTransaction(quote);
  console.log(`[Jupiter] Sell confirmed! TX: ${txId}`);

  return {
    txId,
    tokensSold: amount,
    solReceived: solOut,
    priceImpact: quote.priceImpactPct,
    tokenMint,
  };
}

/**
 * Get current value of a token position in SOL
 */
async function getTokenValueInSol(tokenMint, tokenAmount) {
  try {
    const quote = await getQuote(tokenMint, WSOL_MINT, tokenAmount);
    return parseInt(quote.outAmount) / 1e9;
  } catch {
    return null;
  }
}

module.exports = { getQuote, executeBuy, executeSell, getTokenValueInSol };
