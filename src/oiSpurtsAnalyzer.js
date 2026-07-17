// oiSpurtsAnalyzer.js
// Fetches real NSE OI Spurts data and extracts BTST candidates using classic,
// well-known OI-based trading concepts:
//   - "Rise-in-OI-Rise"  = Long Buildup  -> bullish continuation (CALL candidates)
//   - "Slide-in-OI-Rise" = Short Buildup -> bearish continuation (PUT candidates)
// These are chosen specifically over "Slide-in-OI-Slide" (Long Unwinding) and
// "Rise-in-OI-Slide" (Short Covering), which are weaker/less reliable signals -
// unwinding and covering reflect closing positions, not fresh conviction.
//
// Everything needed (strike, expiry, option type, real premium via `ltp`,
// OI change strength) comes directly from this ONE endpoint - no separate
// option-chain lookup required.

const { NseIndia } = require('stock-nse-india');
const nseIndia = new NseIndia();

const MIN_OI_CHANGE_PERCENT = 15; // minimum |pChangeInOI| to be considered a meaningful buildup
const MIN_VOLUME = 1000; // basic liquidity filter - avoid thinly-traded contracts

/**
 * Fetch and categorize OI spurts contracts into genuine BUY candidates.
 *
 * IMPORTANT CORRECTION: only "Rise-in-OI-Rise" (Long Buildup - price up + OI up)
 * represents fresh BUYING activity, whether on a Call or a Put:
 *   - Long Buildup on a CALL = fresh call-buying = bullish -> buy this CALL
 *   - Long Buildup on a PUT  = fresh put-buying  = bearish -> buy this PUT
 * "Slide-in-OI-Rise" (Short Buildup) represents fresh WRITING/SELLING activity
 * (price falling + OI rising = people selling options, betting they expire
 * worthless) - a fundamentally different, margin-heavy strategy than simply
 * buying an option, and was incorrectly used as a "bearish buy" source before.
 *
 * @returns {Promise<{bullish: object[], bearish: object[]}>}
 */
async function getBtstCandidates() {
  const raw = await nseIndia.getDataByEndpoint('/api/live-analysis-oi-spurts-contracts');

  if (!raw || !Array.isArray(raw.data)) {
    throw new Error('NSE returned no usable OI spurts data');
  }

  const findCategory = (name) => {
    const entry = raw.data.find((e) => Object.keys(e)[0] === name);
    return entry ? entry[name] : [];
  };

  // Only Long Buildup - genuine fresh buying, split by option type below
  const longBuildup = findCategory('Rise-in-OI-Rise');

  const filterAndDedupe = (contracts, optionType) => {
    const filtered = contracts.filter(
      (c) =>
        Math.abs(c.pChangeInOI) >= MIN_OI_CHANGE_PERCENT &&
        c.volume >= MIN_VOLUME &&
        c.optionType === optionType &&
        c.strikePrice > 0
    );

    // A symbol can appear across multiple strikes - keep only the contract
    // with the highest volume per symbol (the most liquid/representative one)
    const bySymbol = new Map();
    for (const c of filtered) {
      const existing = bySymbol.get(c.symbol);
      if (!existing || c.volume > existing.volume) {
        bySymbol.set(c.symbol, c);
      }
    }

    return Array.from(bySymbol.values()).sort(
      (a, b) => Math.abs(b.pChangeInOI) - Math.abs(a.pChangeInOI)
    );
  };

  return {
    bullish: filterAndDedupe(longBuildup, 'Call'),  // fresh call-buying -> BUY CALL
    bearish: filterAndDedupe(longBuildup, 'Put'),   // fresh put-buying -> BUY PUT
    timestamp: raw.timestamp,
  };
}

module.exports = { getBtstCandidates };