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
 * Fetch all Long Buildup ("Rise-in-OI-Rise") contracts, filtered by the
 * liquidity/strength thresholds but NOT deduped by symbol - the raw,
 * per-contract list. Used both by getBtstCandidates() below (which dedupes
 * to one contract per symbol) and by btstCompositeScorer.js, which needs to
 * look up ALL contracts for a specific symbol to find a real tradeable
 * strike for stocks that composite scoring flagged via other signals.
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
 * @returns {Promise<{call: object[], put: object[], timestamp: string}>}
 */
async function getLongBuildupContracts() {
  const raw = await nseIndia.getDataByEndpoint('/api/live-analysis-oi-spurts-contracts');

  if (!raw || !Array.isArray(raw.data)) {
    throw new Error('NSE returned no usable OI spurts data');
  }

  const findCategory = (name) => {
    const entry = raw.data.find((e) => Object.keys(e)[0] === name);
    return entry ? entry[name] : [];
  };

  const longBuildup = findCategory('Rise-in-OI-Rise');

  const filterByType = (optionType) =>
    longBuildup.filter(
      (c) =>
        Math.abs(c.pChangeInOI) >= MIN_OI_CHANGE_PERCENT &&
        c.volume >= MIN_VOLUME &&
        c.optionType === optionType &&
        c.strikePrice > 0
    );

  return {
    call: filterByType('Call'),
    put: filterByType('Put'),
    timestamp: raw.timestamp,
  };
}

/**
 * Dedupe a contract list down to one (highest-volume) contract per symbol,
 * sorted by OI-change strength.
 */
function dedupeBySymbol(contracts) {
  const bySymbol = new Map();
  for (const c of contracts) {
    const existing = bySymbol.get(c.symbol);
    if (!existing || c.volume > existing.volume) {
      bySymbol.set(c.symbol, c);
    }
  }
  return Array.from(bySymbol.values()).sort(
    (a, b) => Math.abs(b.pChangeInOI) - Math.abs(a.pChangeInOI)
  );
}

/**
 * Fetch and categorize OI spurts contracts into genuine BUY candidates.
 *
 * NOTE: this dedupes to one contract per symbol, and in practice the
 * contract-level OI-spurts endpoint is dominated by NIFTY index-option
 * volume, so this alone tends to surface only 1-2 candidates (both NIFTY)
 * on a typical day. See btstCompositeScorer.js for the multi-indicator,
 * stock-level replacement that addresses this.
 *
 * @returns {Promise<{bullish: object[], bearish: object[]}>}
 */
async function getBtstCandidates() {
  const { call, put, timestamp } = await getLongBuildupContracts();

  return {
    bullish: dedupeBySymbol(call),  // fresh call-buying -> BUY CALL
    bearish: dedupeBySymbol(put),   // fresh put-buying -> BUY PUT
    timestamp,
  };
}

module.exports = { getBtstCandidates, getLongBuildupContracts };