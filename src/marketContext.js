// marketContext.js
// Fetches market-wide (macro) context once per run: breadth, institutional
// flows, volatility, and index-level option sentiment. Used by
// btstCompositeScorer.js both as a stock-level price-direction lookup
// (breadth data doubles as a full-universe %change map) and as filters that
// can dampen/boost confidence on individual stock candidates.

const { NseIndia } = require('stock-nse-india');
const { getFullOptionChain } = require('./optionChainFetcher');

const nseIndia = new NseIndia();

// SEBI/AMFI's official market-cap classification is rank-based, re-set
// twice yearly: rank 1-100 by full market cap = Large Cap, 101-250 = Mid
// Cap, 251+ = Small Cap. NSE's "live" per-index constituent endpoint
// (getEquityStockIndices) turned out to return an empty constituent list
// outside specific windows (verified empty for NIFTY 50 itself, not just
// midcap/smallcap indices - not reliable enough to depend on). Every row in
// the breadth data already carries totalMarketCap, so we rank the whole
// merged universe ourselves instead of depending on that separate endpoint.
const LARGE_CAP_RANK_CUTOFF = 100;
const MID_CAP_RANK_CUTOFF = 250;

/**
 * Full-market breadth: advances/declines/unchanged counts, PLUS a
 * symbol -> %change lookup map covering effectively the entire NSE equity
 * universe (~3400 securities). NSE splits this across three endpoints that
 * together add up to the total; there's no single "all securities with
 * price change" endpoint, so we merge them here.
 *
 * This map is what lets stock-level OI-buildup detection tell Long Buildup
 * (price up + OI up) apart from Short Buildup (price down + OI up) - the
 * oi-spurts-underlyings endpoint has no price-direction field of its own.
 */
async function getMarketBreadth() {
  const [advance, decline, unchanged] = await Promise.all([
    nseIndia.getDataByEndpoint('/api/live-analysis-advance'),
    nseIndia.getDataByEndpoint('/api/live-analysis-decline'),
    nseIndia.getDataByEndpoint('/api/live-analysis-unchanged'),
  ]);

  const counts = advance?.advance?.count || {};
  const pchangeBySymbol = new Map();
  const marketCapBySymbol = new Map();

  const mergeRows = (rows) => {
    for (const row of rows || []) {
      pchangeBySymbol.set(row.symbol, row.pchange);
      if (row.totalMarketCap) marketCapBySymbol.set(row.symbol, row.totalMarketCap);
    }
  };
  mergeRows(advance?.advance?.data);
  mergeRows(decline?.decline?.data);
  mergeRows(unchanged?.Unchange?.data);

  // Rank the whole merged universe by market cap, then bucket per SEBI's
  // rank-based large/mid/small definition.
  const capTierBySymbol = new Map();
  const rankedByMarketCap = [...marketCapBySymbol.entries()].sort((a, b) => b[1] - a[1]);
  rankedByMarketCap.forEach(([symbol], i) => {
    const rank = i + 1;
    const tier = rank <= LARGE_CAP_RANK_CUTOFF ? 'Large' : rank <= MID_CAP_RANK_CUTOFF ? 'Mid' : 'Small';
    capTierBySymbol.set(symbol, tier);
  });

  const advances = counts.Advances || 0;
  const declines = counts.Declines || 0;
  const total = counts.Total || (advances + declines + (counts.Unchange || 0));

  // -1 (all declining) .. +1 (all advancing)
  const breadthBias = total > 0 ? (advances - declines) / total : 0;

  return {
    advances,
    declines,
    unchanged: counts.Unchange || 0,
    total,
    breadthBias,
    pchangeBySymbol, // Map<symbol, pchange%>
    capTierBySymbol, // Map<symbol, 'Large'|'Mid'|'Small'>
  };
}

/**
 * Latest FII/DII cash-market net activity (reported once daily, values in
 * ₹ crore). Positive netValue = net buying.
 */
async function getFiiDiiFlows() {
  const raw = await nseIndia.getDataByEndpoint('/api/fiidiiTradeReact');
  if (!Array.isArray(raw)) return null;

  const fii = raw.find((r) => r.category === 'FII/FPI');
  const dii = raw.find((r) => r.category === 'DII');

  const fiiNet = fii ? parseFloat(fii.netValue) : 0;
  const diiNet = dii ? parseFloat(dii.netValue) : 0;

  return {
    date: fii?.date || dii?.date || null,
    fiiNetCr: fiiNet,
    diiNetCr: diiNet,
    combinedNetCr: fiiNet + diiNet,
  };
}

/**
 * India VIX level and day-over-day change. Rising/elevated VIX = wider
 * expected overnight gap risk, independent of any individual stock's setup.
 */
async function getVix() {
  const raw = await nseIndia.getDataByEndpoint('/api/allIndices');
  const vix = raw?.data?.find((d) => d.indexSymbol === 'INDIA VIX');
  if (!vix) return null;

  return {
    level: vix.last,
    changePercent: vix.percentChange,
    yearHigh: vix.yearHigh,
    yearLow: vix.yearLow,
  };
}

/**
 * NIFTY Put-Call Ratio (by OI) across the full option chain for the nearest
 * expiry - a classic index-level sentiment gauge. PCR > ~1.3 is typically
 * read as oversold/bullish-contrarian, < ~0.7 as overbought/bearish-contrarian.
 * No dedicated NSE endpoint for this - derived from the full option chain,
 * which optionChainFetcher.js already wraps.
 */
async function getNiftyPcr() {
  const records = await getFullOptionChain('NIFTY');

  let callOI = 0;
  let putOI = 0;
  for (const row of records.data) {
    if (row.CE) callOI += row.CE.openInterest;
    if (row.PE) putOI += row.PE.openInterest;
  }

  return {
    callOI,
    putOI,
    pcr: callOI > 0 ? putOI / callOI : null,
  };
}

/**
 * Fetch all macro context in one call. Each piece is independently
 * try/caught so one flaky endpoint doesn't take down the whole scan -
 * missing pieces just aren't used as filters that run.
 */
async function getMacroContext() {
  const results = await Promise.allSettled([
    getMarketBreadth(),
    getFiiDiiFlows(),
    getVix(),
    getNiftyPcr(),
  ]);

  const [breadth, fiiDii, vix, pcr] = results.map((r) =>
    r.status === 'fulfilled' ? r.value : null
  );

  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      const names = ['breadth', 'fiiDii', 'vix', 'pcr'];
      console.warn(`⚠️ macroContext: ${names[i]} fetch failed - ${r.reason?.message}`);
    }
  });

  return { breadth, fiiDii, vix, pcr };
}

module.exports = { getMarketBreadth, getFiiDiiFlows, getVix, getNiftyPcr, getMacroContext };
