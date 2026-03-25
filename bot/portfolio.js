/**
 * Fetches full wallet portfolio using Helius DAS API and DexScreener.
 */

const { getConnection, getWallet, getBalance } = require("./wallet");
const { PublicKey } = require("@solana/web3.js");
const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const TOKEN_2022_PROGRAM_ID = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

async function getPortfolio() {
  const wallet = getWallet();
  const connection = getConnection();
  const solBalance = await getBalance();

  // Get all token accounts (both standard and Token-2022)
  const [acc1, acc2] = await Promise.all([
    connection.getParsedTokenAccountsByOwner(wallet.publicKey, { programId: TOKEN_PROGRAM_ID }),
    connection.getParsedTokenAccountsByOwner(wallet.publicKey, { programId: TOKEN_2022_PROGRAM_ID }),
  ]);
  const tokenAccounts = { value: [...acc1.value, ...acc2.value] };

  const tokens = [];

  for (const account of tokenAccounts.value) {
    const info = account.account.data.parsed.info;
    const mint = info.mint;
    const amount = info.tokenAmount;

    // Skip zero balances
    if (amount.uiAmount === 0) continue;

    tokens.push({
      mint,
      balance: amount.uiAmount,
      rawAmount: amount.amount,
      decimals: amount.decimals,
    });
  }

  // Fetch prices from DexScreener for all tokens
  if (tokens.length > 0) {
    // DexScreener supports bulk lookup (comma separated, max ~30)
    const mints = tokens.map((t) => t.mint);
    const chunks = [];
    for (let i = 0; i < mints.length; i += 20) {
      chunks.push(mints.slice(i, i + 20));
    }

    for (const chunk of chunks) {
      try {
        const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${chunk.join(",")}`);
        if (!res.ok) continue;
        const data = await res.json();

        if (data.pairs) {
          // Group pairs by base token
          const pairsByMint = {};
          for (const pair of data.pairs) {
            const baseMint = pair.baseToken?.address;
            if (!baseMint) continue;
            if (!pairsByMint[baseMint] || (pair.liquidity?.usd || 0) > (pairsByMint[baseMint].liquidity?.usd || 0)) {
              pairsByMint[baseMint] = pair;
            }
          }

          for (const token of tokens) {
            const pair = pairsByMint[token.mint];
            if (pair) {
              token.priceUsd = parseFloat(pair.priceUsd) || 0;
              token.valueUsd = token.balance * token.priceUsd;
              token.marketCap = pair.marketCap || pair.fdv || 0;
              token.name = pair.baseToken?.name || "Unknown";
              token.symbol = pair.baseToken?.symbol || "???";
              token.liquidity = pair.liquidity?.usd || 0;
            }
          }
        }
      } catch (err) {
        console.error(`[Portfolio] DexScreener error: ${err.message}`);
      }
    }
  }

  // Filter tokens with value and sort by value
  const valued = tokens
    .filter((t) => t.valueUsd > 0.01)
    .sort((a, b) => b.valueUsd - a.valueUsd);

  const totalTokenValueUsd = valued.reduce((sum, t) => sum + (t.valueUsd || 0), 0);

  return {
    wallet: wallet.publicKey.toString(),
    solBalance,
    tokens: valued,
    totalTokenValueUsd,
  };
}

module.exports = { getPortfolio };
