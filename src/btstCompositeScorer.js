// btstCompositeScorer.js
// Multi-indicator BTST candidate scorer. Replaces the old approach of
// trusting a single OI-buildup signal in isolation (see oiSpurtsAnalyzer.js)
// with a confluence-scored composite across independent NSE data sources,
// plus macro filters that can dampen confidence when the broader market
// context disagrees with an individual stock's setup.
//
// Design:
//   1. OI buildup (stock-level, direction-corrected via price %change) is
//      the REQUIRED base signal - it's what "fresh derivatives conviction"
//      actually means for a BTST setup.
//   2. At least one of {bulk/block deals, most-active ranking, 52-week band
//      hit} must independently agree with that direction for a stock to
//      qualify as a candidate at all. A lone OI spike with no confirmation
//      is discarded, not alerted - this directly fixes the old
//      single-indicator flaw.
//   3. Macro context (breadth, FII/DII, VIX) doesn't gate candidates, but
//      scales confidence up or down and is always surfaced in the output so
//      a conflict (e.g. bullish stock pick on a broadly bearish-breadth day)
//      is visible rather than hidden.

const { getMacroContext } = require('./marketContext');
const {
  getOiBuildupByStock,
  getBulkBlockDealsByStock,
  getMostActiveByStock,
  get52WeekBandHittersByStock,
} = require('./stockSignalSources');
const { getLongBuildupContracts } = require('./oiSpurtsAnalyzer');
const { getFullEquityOptionChain } = require('./optionChainFetcher');

const MIN_CONFLUENCE_SOURCES = 2; // OI buildup + at least 1 confirming source
const TOP_N_PER_SIDE = 5;
const VIX_ELEVATED_THRESHOLD = 20; // India VIX above this = risk-off, dampen confidence
const CONTRACT_ATTACH_LIMIT = 10; // cap extra per-symbol option-chain calls (top N per side)

// The "most active by value/volume" ranking structurally favors large caps -
// they trade higher notional value most days regardless of whether today is
// genuinely eventful for them. Cracking that same ranking is comparatively
// rarer and more informative for a mid/small cap, so its contribution is
// scaled accordingly rather than trusted at face value across all tiers.
const MOST_ACTIVE_TIER_MULTIPLIER = { Large: 0.6, Mid: 1.0, Small: 1.25 };

/**
 * Normalize a magnitude (e.g. |avgInOI|, a rank, |pchange|) into 0..1 using
 * a soft cap so one extreme outlier doesn't dominate the score.
 */
function normalize(value, cap) {
  if (value === undefined || value === null || Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(Math.abs(value) / cap, 1));
}

/**
 * Score one stock's confluence across the independent signal sources.
 * Returns null if it doesn't meet the minimum confluence bar.
 * @param {'Large'|'Mid'|'Small'|undefined} capTier - from marketContext.js's capTierBySymbol
 */
function scoreStock(symbol, oi, bulkBlock, mostActive, bandHitter, capTier) {
  const direction = oi.direction; // 'bullish' | 'bearish'
  const sign = direction === 'bullish' ? 1 : -1;

  const components = {
    oiBuildup: {
      present: true,
      agrees: true,
      score: sign * normalize(oi.avgInOI, 100), // 100%+ OI change = full magnitude
      raw: { changeInOI: oi.changeInOI, avgInOI: oi.avgInOI, pchange: oi.pchange },
    },
    bulkBlockDeals: { present: false, agrees: false, score: 0 },
    mostActive: { present: false, agrees: false, score: 0 },
    bandHitter: { present: false, agrees: false, score: 0 },
  };

  if (bulkBlock) {
    components.bulkBlockDeals.present = true;
    components.bulkBlockDeals.agrees = bulkBlock.direction === direction;
    if (components.bulkBlockDeals.agrees) {
      components.bulkBlockDeals.score = sign * normalize(bulkBlock.netQty, 5_000_000);
    }
    components.bulkBlockDeals.raw = bulkBlock;
  }

  if (mostActive) {
    const activeDirection = mostActive.pchange >= 0 ? 'bullish' : 'bearish';
    components.mostActive.present = true;
    components.mostActive.agrees = activeDirection === direction;
    if (components.mostActive.agrees) {
      const bestRank = Math.min(mostActive.ranks.byValue || 999, mostActive.ranks.byVolume || 999);
      const tierMultiplier = MOST_ACTIVE_TIER_MULTIPLIER[capTier] ?? 1.0;
      const tierAdjustedMagnitude = Math.min(normalize(50 - Math.min(bestRank, 50), 50) * tierMultiplier, 1);
      components.mostActive.score = sign * tierAdjustedMagnitude; // rank 1 -> full strength, tier-adjusted
    }
    components.mostActive.raw = mostActive;
  }

  if (bandHitter) {
    components.bandHitter.present = true;
    components.bandHitter.agrees = bandHitter.direction === direction;
    if (components.bandHitter.agrees) {
      components.bandHitter.score = sign * normalize(bandHitter.pchange, 20);
    }
    components.bandHitter.raw = bandHitter;
  }

  const agreeingCount =
    1 + // OI buildup itself
    [components.bulkBlockDeals, components.mostActive, components.bandHitter].filter(
      (c) => c.present && c.agrees
    ).length;

  if (agreeingCount < MIN_CONFLUENCE_SOURCES) return null; // not enough confirmation - discard

  const weights = { oiBuildup: 0.4, bulkBlockDeals: 0.25, mostActive: 0.15, bandHitter: 0.2 };
  let rawScore = 0;
  let weightUsed = 0;
  for (const [key, weight] of Object.entries(weights)) {
    if (components[key].present && components[key].agrees) {
      rawScore += components[key].score * weight;
      weightUsed += weight;
    }
  }
  // Re-normalize by weight actually used, so a 2-source confluence isn't
  // unfairly capped versus a 4-source one.
  const compositeScore = weightUsed > 0 ? rawScore / weightUsed : 0;

  return { symbol, direction, compositeScore, agreeingCount, components, marketCapTier: capTier || 'Unknown' };
}

/**
 * Compute a macro alignment multiplier for a given direction: boosts
 * slightly when breadth/FII-DII agree with the stock's direction, dampens
 * when they conflict, and applies a flat VIX risk-off dampener regardless
 * of direction.
 */
function macroMultiplier(direction, macro) {
  let multiplier = 1;
  const sign = direction === 'bullish' ? 1 : -1;

  if (macro.breadth) {
    // breadthBias is -1..+1; scale its contribution modestly (+/-15%)
    multiplier += sign * macro.breadth.breadthBias * 0.15;
  }
  if (macro.fiiDii) {
    const flowSign = macro.fiiDii.combinedNetCr >= 0 ? 1 : -1;
    if (flowSign !== sign) multiplier -= 0.1; // institutional flow disagrees -> dampen
  }
  if (macro.vix && macro.vix.level >= VIX_ELEVATED_THRESHOLD) {
    multiplier -= 0.2; // risk-off regardless of direction
  }

  return Math.max(0.3, Math.min(1.3, multiplier));
}

/**
 * Try to attach a real tradeable options contract (strike/premium/expiry)
 * to a scored candidate. First checks the contract-level Long Buildup data
 * (the same source oiSpurtsAnalyzer.js uses) for an exact match on this
 * symbol; falls back to the nearest-ATM strike from the stock's own option
 * chain if this symbol didn't independently show up in that feed.
 */
async function attachContract(candidate, longBuildupContracts) {
  const optionType = candidate.direction === 'bullish' ? 'Call' : 'Put';
  const pool = optionType === 'Call' ? longBuildupContracts.call : longBuildupContracts.put;
  const directMatch = pool
    .filter((c) => c.symbol === candidate.symbol)
    .sort((a, b) => b.volume - a.volume)[0];

  if (directMatch) {
    return {
      source: 'oi-spurts-contract-match',
      strikePrice: directMatch.strikePrice,
      optionType,
      expiryDate: directMatch.expiryDate,
      premium: directMatch.ltp,
      contractOiChangePercent: directMatch.pChangeInOI,
    };
  }

  try {
    const chain = await getFullEquityOptionChain(candidate.symbol);
    const nearestExpiry = chain.expiryDates[0];
    const wantsCall = optionType === 'Call';
    const rows = chain.data.filter(
      (d) =>
        d.instrumentType === 'OPTSTK' &&
        d.expiryDate === nearestExpiry &&
        d.strikePrice > 0 &&
        (d.optionType === (wantsCall ? 'CE' : 'PE'))
    );
    if (rows.length === 0) return null;

    const atm = rows.sort(
      (a, b) => Math.abs(a.strikePrice - chain.underlyingValue) - Math.abs(b.strikePrice - chain.underlyingValue)
    )[0];

    return {
      source: 'atm-fallback',
      strikePrice: atm.strikePrice,
      optionType,
      expiryDate: atm.expiryDate,
      premium: atm.lastPrice,
      contractOiChangePercent: atm.pchangeinOpenInterest,
    };
  } catch (e) {
    return null; // symbol may not be F&O-eligible, or chain fetch failed - candidate still valid, just no contract attached
  }
}

/**
 * Run the full multi-indicator BTST scan.
 * @returns {Promise<{bullish: object[], bearish: object[], macro: object, timestamp: string}>}
 */
async function getCompositeBtstCandidates() {
  const macro = await getMacroContext();
  if (!macro.breadth) {
    throw new Error('Market breadth fetch failed - cannot direction-classify OI buildup without it');
  }

  const [oiByStock, bulkBlockByStock, mostActiveByStock, bandHittersByStock, longBuildupContracts] =
    await Promise.all([
      getOiBuildupByStock(macro.breadth.pchangeBySymbol),
      getBulkBlockDealsByStock().catch((e) => {
        console.warn('⚠️ bulk/block deals fetch failed -', e.message);
        return new Map();
      }),
      getMostActiveByStock().catch((e) => {
        console.warn('⚠️ most-active fetch failed -', e.message);
        return new Map();
      }),
      get52WeekBandHittersByStock().catch((e) => {
        console.warn('⚠️ 52-week band hitters fetch failed -', e.message);
        return new Map();
      }),
      getLongBuildupContracts().catch((e) => {
        console.warn('⚠️ contract-level OI fetch failed -', e.message);
        return { call: [], put: [] };
      }),
    ]);

  const scored = [];
  for (const [symbol, oi] of oiByStock) {
    const result = scoreStock(
      symbol,
      oi,
      bulkBlockByStock.get(symbol),
      mostActiveByStock.get(symbol),
      bandHittersByStock.get(symbol),
      macro.breadth.capTierBySymbol.get(symbol)
    );
    if (!result) continue;

    const multiplier = macroMultiplier(result.direction, macro);
    result.finalScore = result.compositeScore * multiplier;
    result.macroMultiplier = multiplier;
    result.confidence = Math.max(0, Math.min(Math.abs(result.finalScore), 1));
    scored.push(result);
  }

  const bullish = scored
    .filter((s) => s.direction === 'bullish')
    .sort((a, b) => b.finalScore - a.finalScore)
    .slice(0, TOP_N_PER_SIDE);
  const bearish = scored
    .filter((s) => s.direction === 'bearish')
    .sort((a, b) => a.finalScore - b.finalScore)
    .slice(0, TOP_N_PER_SIDE);

  const topCandidates = [...bullish, ...bearish].slice(0, CONTRACT_ATTACH_LIMIT);
  await Promise.all(
    topCandidates.map(async (c) => {
      c.contract = await attachContract(c, longBuildupContracts);
    })
  );

  return {
    bullish,
    bearish,
    macro: {
      breadth: macro.breadth
        ? {
            advances: macro.breadth.advances,
            declines: macro.breadth.declines,
            unchanged: macro.breadth.unchanged,
            breadthBias: macro.breadth.breadthBias,
          }
        : null,
      fiiDii: macro.fiiDii,
      vix: macro.vix,
      niftyPcr: macro.pcr,
    },
    timestamp: new Date().toISOString(),
  };
}

module.exports = { getCompositeBtstCandidates, MIN_CONFLUENCE_SOURCES, TOP_N_PER_SIDE };
