// optionChainFetcher.js
// Fetches REAL live NIFTY option chain data (premium, OI, IV) from NSE's free
// public API via stock-nse-india — no Groww subscription needed for this.

const { NseIndia } = require('stock-nse-india');

const nseIndia = new NseIndia();

/**
 * Fetch the real live premium (lastPrice) and open interest for a specific
 * strike + option type, for the nearest expiry (or a specified one).
 * @param {string} indexSymbol - e.g. 'NIFTY'
 * @param {number} strikePrice - e.g. 24200
 * @param {'CE'|'PE'} optionType
 * @param {string} [expiry] - Optional, format 'DD-MMM-YYYY' e.g. '14-Jul-2026'.
 *                            If omitted, uses the nearest upcoming expiry NSE returns.
 * @returns {Promise<{lastPrice: number, openInterest: number, impliedVolatility: number, underlyingValue: number} | null>}
 *          null if that exact strike/expiry combination isn't found in the chain
 */
async function getRealOptionPremium(indexSymbol, strikePrice, optionType, expiry) {
  const chain = await nseIndia.getIndexOptionChain(indexSymbol, expiry);

  if (!chain || !chain.records || !Array.isArray(chain.records.data)) {
    throw new Error(`NSE returned no usable option chain for ${indexSymbol}`);
  }

  const match = chain.records.data.find(
    (d) => d.strikePrice === strikePrice && d[optionType]
  );

  if (!match || !match[optionType]) {
    return null; // that strike/expiry combo doesn't exist in the real chain
  }

  const details = match[optionType];
  return {
    lastPrice: details.lastPrice,
    openInterest: details.openInterest,
    impliedVolatility: details.impliedVolatility,
    underlyingValue: chain.records.underlyingValue,
  };
}

/**
 * Fetch the full option chain (all strikes) for PCR / OI-based strategies later.
 * @param {string} indexSymbol - e.g. 'NIFTY'
 * @param {string} [expiry]
 */
async function getFullOptionChain(indexSymbol, expiry) {
  const chain = await nseIndia.getIndexOptionChain(indexSymbol, expiry);

  if (!chain || !chain.records || !Array.isArray(chain.records.data)) {
    throw new Error(`NSE returned no usable option chain for ${indexSymbol}`);
  }

  return chain.records; // { expiryDates, data, timestamp, underlyingValue, strikePrices }
}

module.exports = { getRealOptionPremium, getFullOptionChain };