/**
 * Check token market cap via DexScreener API.
 */

const MAX_MCAP = parseInt(process.env.MAX_MARKETCAP) || 200000;

async function getMarketCap(tokenMint) {
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${tokenMint}`);
    if (!res.ok) return null;

    const data = await res.json();
    if (!data.pairs || data.pairs.length === 0) return null;

    // Get the pair with highest liquidity
    const pair = data.pairs.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];

    return {
      marketCap: pair.marketCap || pair.fdv || null,
      priceUsd: parseFloat(pair.priceUsd) || null,
      liquidity: pair.liquidity?.usd || null,
      pairAddress: pair.pairAddress,
      dexId: pair.dexId,
    };
  } catch (err) {
    console.error(`[MarketCap] Error fetching ${tokenMint}: ${err.message}`);
    return null;
  }
}

async function checkMarketCap(tokenMint) {
  const data = await getMarketCap(tokenMint);

  if (!data || data.marketCap === null) {
    console.log(`[MarketCap] ${tokenMint.slice(0, 8)}... could not fetch mcap, allowing buy`);
    return { allowed: true, marketCap: null, reason: "mcap unknown" };
  }

  const mcapK = (data.marketCap / 1000).toFixed(0);

  if (data.marketCap > MAX_MCAP) {
    console.log(`[MarketCap] ${tokenMint.slice(0, 8)}... mcap $${mcapK}K > $${MAX_MCAP / 1000}K — SKIP`);
    return { allowed: false, marketCap: data.marketCap, reason: `mcap $${mcapK}K too high` };
  }

  console.log(`[MarketCap] ${tokenMint.slice(0, 8)}... mcap $${mcapK}K — OK`);
  return { allowed: true, marketCap: data.marketCap, reason: `mcap $${mcapK}K` };
}

module.exports = { getMarketCap, checkMarketCap, MAX_MCAP };
