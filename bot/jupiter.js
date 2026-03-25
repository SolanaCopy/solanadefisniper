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
    skipPreflight: true,
    maxRetries: 3,
  });

  console.log(`[Jupiter] Transaction sent: ${txId}`);

  const confirmation = await connection.confirmTransaction(txId, "confirmed");
  if (confirmation.value.err) {
    throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
  }

  return txId;
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
