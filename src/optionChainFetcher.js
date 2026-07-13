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

/**
 * Fetch the full option chain for an individual STOCK (not index).
 * IMPORTANT: the equity option chain response shape is DIFFERENT from the
 * index one - it's a flat array where each item already represents one
 * specific strike+optionType combination, rather than nested CE/PE objects
 * per strike. strikePrice also comes back as a STRING, not a number.
 * @param {string} symbol - e.g. 'RELIANCE'
 * @returns {Promise<{expiryDates: string[], underlyingValue: number, data: object[]}>}
 *          normalized to a similar shape as getFullOptionChain for convenience
 */
async function getFullEquityOptionChain(symbol) {
  const chain = await nseIndia.getEquityOptionChain(symbol);

  if (!chain || !Array.isArray(chain.data) || chain.data.length === 0) {
    throw new Error(`NSE returned no usable equity option chain for ${symbol} (may not be F&O-eligible)`);
  }

  // Normalize: parse strikePrice to number, and derive expiryDates + underlyingValue
  const normalizedData = chain.data.map((item) => ({
    ...item,
    strikePrice: parseFloat(item.strikePrice),
  }));

  const expiryDates = [...new Set(normalizedData.map((item) => item.expiryDate))];
  const underlyingValue = normalizedData[0]?.underlyingValue ?? null;

  return {
    expiryDates,
    underlyingValue,
    data: normalizedData,
  };
}

/**
 * Find the real premium for a specific stock strike, matching the FLAT
 * equity chain shape (optionType is a field on each row, not a nested key).
 * @param {object[]} normalizedData - from getFullEquityOptionChain().data
 * @param {number} strikePrice
 * @param {'CE'|'PE'} optionType
 * @param {string} expiryDate - must match one of the real expiryDates exactly
 */
function findEquityOptionMatch(normalizedData, strikePrice, optionType, expiryDate) {
  // NSE equity chains may label option type as 'CE'/'PE' OR 'Call'/'Put' -
  // match defensively on the first letter, case-insensitive.
  const wantsCall = optionType.toUpperCase().startsWith('C');

  return normalizedData.find((item) => {
    const itemIsCall = String(item.optionType).toUpperCase().startsWith('C');
    return (
      item.strikePrice === strikePrice &&
      item.expiryDate === expiryDate &&
      itemIsCall === wantsCall
    );
  });
}

module.exports = { getRealOptionPremium, getFullOptionChain, getFullEquityOptionChain, findEquityOptionMatch };