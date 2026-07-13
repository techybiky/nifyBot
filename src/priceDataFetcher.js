// priceDataFetcher.js
// Fetches real historical closing prices for NIFTY from NSE's public (unofficial) API
// via the `stock-nse-india` npm package, which handles the session/cookie bootstrap
// NSE's website requires.
//
// IMPORTANT LIMITATION: This only covers NSE. SENSEX is a BSE index and is NOT
// available through this source. For now, NIFTY's real technical signal is used;
// SENSEX technical analysis either needs a separate BSE data source, or you can
// treat NIFTY's movement as a rough correlated proxy (NOT the same as real SENSEX data).

const { NseIndia } = require('stock-nse-india');

const nseIndia = new NseIndia();

/**
 * Fetch real historical daily closing prices for an NSE index.
 * @param {string} indexName - e.g. 'NIFTY 50'
 * @param {number} days - how many calendar days back to fetch (default 90, comfortably
 *                         covers the 35+ trading days needed for MACD/SMA50)
 * @returns {Promise<number[]>} closing prices sorted oldest to newest
 */
async function getHistoricalCloses(indexName = 'NIFTY 50', days = 90, symbolType = 'Index') {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - days);

  const response = await nseIndia.getEquityChartHistoricalData(
    indexName,
    { start, end },
    undefined,   // token - auto-fetched internally
    symbolType,     // symbolType
    'D',         // chartType - Daily
  );

  if (!response || !response.status || !Array.isArray(response.data)) {
    throw new Error('NSE returned no usable historical data for ' + indexName);
  }

  // Sort oldest -> newest by time, then extract closing prices
  const sorted = [...response.data].sort((a, b) => a.time - b.time);
  return sorted.map((item) => item.close);
}

/**
 * Same as getHistoricalCloses, but also returns the real date of the most
 * recent data point — use this to VERIFY whether the last price is today's
 * live/latest session or a stale prior close.
 * @returns {Promise<{closes: number[], lastDate: Date}>}
 */
async function getHistoricalClosesWithDate(indexName = 'NIFTY 50', days = 90, symbolType = 'Index') {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - days);

  const response = await nseIndia.getEquityChartHistoricalData(
    indexName,
    { start, end },
    undefined,
    symbolType,
    'D',
  );

  if (!response || !response.status || !Array.isArray(response.data)) {
    throw new Error('NSE returned no usable historical data for ' + indexName);
  }

  const sorted = [...response.data].sort((a, b) => a.time - b.time);
  const lastItem = sorted[sorted.length - 1];

  // NSE's `time` field is typically epoch seconds or ms - handle both
  const lastDate = new Date(lastItem.time > 1e12 ? lastItem.time : lastItem.time * 1000);

  return {
    closes: sorted.map((item) => item.close),
    lastDate,
  };
}

/**
 * Fetch daily closes AND a weekly-aggregated series from the same underlying data,
 * for multi-timeframe confirmation (daily signal checked against the weekly trend).
 * @param {string} indexName
 * @param {number} dailyDays - how many days of daily closes to return (for RSI/MACD/etc)
 * @param {number} weeklyLookbackDays - how far back to pull for building weekly bars
 *                  (needs to be much larger so there are enough weekly bars for a
 *                  meaningful weekly SMA10/SMA20 trend read)
 * @returns {Promise<{dailyCloses: number[], weeklyCloses: number[]}>}
 */
async function getMultiTimeframeCloses(indexName = 'NIFTY 50', dailyDays = 90, weeklyLookbackDays = 450, symbolType = 'Index') {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - weeklyLookbackDays);

  const response = await nseIndia.getEquityChartHistoricalData(
    indexName,
    { start, end },
    undefined,
    symbolType,
    'D',
  );

  if (!response || !response.status || !Array.isArray(response.data)) {
    throw new Error('NSE returned no usable historical data for ' + indexName);
  }

  const sorted = [...response.data].sort((a, b) => a.time - b.time);

  // Daily closes: just take the most recent `dailyDays` worth of trading days
  const dailyCloses = sorted.slice(-dailyDays).map((item) => item.close);

  // Weekly closes: group by ISO week (year + week number), take the LAST close in each week
  const weekBuckets = new Map();
  for (const item of sorted) {
    const ms = item.time > 1e12 ? item.time : item.time * 1000;
    const date = new Date(ms);
    const weekKey = getIsoWeekKey(date);
    weekBuckets.set(weekKey, item.close); // overwritten each time -> ends up as last close of that week
  }
  const weeklyCloses = Array.from(weekBuckets.values());

  return { dailyCloses, weeklyCloses };
}

/**
 * Helper: build a sortable "YYYY-Www" key for grouping dates into ISO weeks.
 */
function getIsoWeekKey(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

module.exports = { getHistoricalCloses, getHistoricalClosesWithDate, getMultiTimeframeCloses }; 