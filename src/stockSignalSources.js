// stockSignalSources.js
// Per-stock signal sources for the BTST composite scorer. Each function
// returns a Map<symbol, {...}> so btstCompositeScorer.js can look up what
// each independent source says about a given stock and require confluence
// across sources, rather than trusting any single one.

const { NseIndia } = require('stock-nse-india');

const nseIndia = new NseIndia();

/**
 * Stock-level OI buildup, direction-classified.
 *
 * IMPORTANT: /api/live-analysis-oi-spurts-underlyings gives aggregated OI
 * change per underlying but has NO price-direction field of its own - unlike
 * the contract-level oi-spurts-contracts endpoint (oiSpurtsAnalyzer.js),
 * which splits into Rise-in-OI-Rise / Slide-in-OI-Rise categories directly.
 * Verified live: POLYCAB topped this list today with +30.7% OI change, but
 * its price was actually DOWN -3.99% - i.e. Short Buildup (bearish), not the
 * bullish signal a naive "top of the OI list = bullish" read would produce.
 * So direction here MUST come from combining this with the breadth
 * %change map (marketContext.js), not from this endpoint alone.
 *
 * @param {Map<string, number>} pchangeBySymbol - from getMarketBreadth()
 * @returns {Promise<Map<string, {changeInOI: number, avgInOI: number, volume: number, pchange: number, direction: 'bullish'|'bearish'}>>}
 */
async function getOiBuildupByStock(pchangeBySymbol) {
  const raw = await nseIndia.getDataByEndpoint('/api/live-analysis-oi-spurts-underlyings');
  if (!raw || !Array.isArray(raw.data)) throw new Error('NSE returned no usable OI-spurts-underlyings data');

  const result = new Map();
  for (const row of raw.data) {
    const pchange = pchangeBySymbol.get(row.symbol);
    if (pchange === undefined) continue; // no price-direction data for this symbol this run - skip rather than guess

    // Rising OI + rising price = Long Buildup (bullish conviction)
    // Rising OI + falling price = Short Buildup (bearish conviction)
    const direction = pchange >= 0 ? 'bullish' : 'bearish';

    result.set(row.symbol, {
      changeInOI: row.changeInOI,
      avgInOI: row.avgInOI,
      volume: row.volume,
      pchange,
      direction,
    });
  }

  return result;
}

/**
 * Bulk + block deal activity, netted per symbol for the latest reported day.
 * Short-selling reports carry no buySell field and are inherently a bearish
 * disclosure, so they're counted as a bearish-weighted entry regardless.
 */
async function getBulkBlockDealsByStock() {
  const raw = await nseIndia.getDataByEndpoint('/api/snapshot-capital-market-largedeal');
  if (!raw) throw new Error('NSE returned no usable large-deal data');

  const result = new Map();

  const addDeal = (symbol, direction, qty, watp) => {
    if (!symbol) return;
    const existing = result.get(symbol) || { netBuyQty: 0, netSellQty: 0, dealCount: 0, lastWatp: null };
    if (direction === 'BUY') existing.netBuyQty += qty;
    else existing.netSellQty += qty;
    existing.dealCount += 1;
    if (watp) existing.lastWatp = watp;
    result.set(symbol, existing);
  };

  for (const d of [...(raw.BULK_DEALS_DATA || []), ...(raw.BLOCK_DEALS_DATA || [])]) {
    const qty = parseFloat(d.qty) || 0;
    addDeal(d.symbol, d.buySell === 'SELL' ? 'SELL' : 'BUY', qty, parseFloat(d.watp) || null);
  }
  for (const d of raw.SHORT_DEALS_DATA || []) {
    const qty = parseFloat(d.qty) || 0;
    addDeal(d.symbol, 'SELL', qty, null);
  }

  // Convert net qty into a direction + rough confidence per symbol
  const directed = new Map();
  for (const [symbol, stats] of result) {
    const net = stats.netBuyQty - stats.netSellQty;
    if (net === 0) continue;
    directed.set(symbol, {
      direction: net > 0 ? 'bullish' : 'bearish',
      netQty: net,
      dealCount: stats.dealCount,
      lastWatp: stats.lastWatp,
    });
  }

  return directed;
}

/**
 * Most-active-by-value and by-volume securities, with their own %change -
 * a liquidity + genuine-interest confirmation signal (these endpoints
 * already include pChange directly, no breadth lookup needed).
 */
async function getMostActiveByStock() {
  const [byValue, byVolume] = await Promise.all([
    nseIndia.getDataByEndpoint('/api/live-analysis-most-active-securities?index=value'),
    nseIndia.getDataByEndpoint('/api/live-analysis-most-active-securities?index=volume'),
  ]);

  const result = new Map();
  const rank = (rows, key) => {
    (rows || []).forEach((row, i) => {
      const existing = result.get(row.symbol) || { pchange: row.pChange, ranks: {} };
      existing.ranks[key] = i + 1; // 1-indexed rank, lower = more active
      existing.pchange = row.pChange;
      result.set(row.symbol, existing);
    });
  };

  rank(byValue?.data, 'byValue');
  rank(byVolume?.data, 'byVolume');

  return result;
}

/**
 * Stocks currently hitting their price band near a 52-week high or low -
 * breakout/breakdown momentum confirmation.
 */
async function get52WeekBandHittersByStock() {
  const raw = await nseIndia.getDataByEndpoint('/api/live-analysis-price-band-hitter');
  if (!raw) throw new Error('NSE returned no usable price-band-hitter data');

  const result = new Map();

  const addSide = (rows, direction) => {
    for (const row of rows || []) {
      result.set(row.symbol, {
        direction,
        ltp: parseFloat(row.ltp),
        pchange: parseFloat(row.pChange),
        yearHigh: row.yearHigh,
        yearLow: row.yearLow,
      });
    }
  };

  addSide(raw.upper?.AllSec?.data, 'bullish'); // hit upper price band -> near/at 52w high
  addSide(raw.lower?.AllSec?.data, 'bearish'); // hit lower price band -> near/at 52w low

  return result;
}

module.exports = {
  getOiBuildupByStock,
  getBulkBlockDealsByStock,
  getMostActiveByStock,
  get52WeekBandHittersByStock,
};
