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
async function getHistoricalCloses(indexName = 'NIFTY 50', days = 90) {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - days);

  const response = await nseIndia.getEquityChartHistoricalData(
    indexName,
    { start, end },
    undefined,   // token - auto-fetched internally
    'Index',     // symbolType
    'D',         // chartType - Daily
  );

  if (!response || !response.status || !Array.isArray(response.data)) {
    throw new Error('NSE returned no usable historical data for ' + indexName);
  }

  // Sort oldest -> newest by time, then extract closing prices
  const sorted = [...response.data].sort((a, b) => a.time - b.time);
  return sorted.map((item) => item.close);
}

module.exports = { getHistoricalCloses };
