// financeSentimentScorer.js
// Finance-specific keyword sentiment scoring, shared between newsProcessor.js
// (full pipeline) and fastNewsScanner.js (breaking news alerts), so both use
// the exact same bearish/bullish vocabulary rather than two lists drifting
// apart over time.

const BEARISH_TERMS = [
  'crash', 'crashes', 'crashed', 'plunge', 'plunges', 'plunged',
  'tumble', 'tumbles', 'tumbled', 'slump', 'slumps', 'slumped',
  'sell-off', 'selloff', 'sell off', 'correction', 'correct', 'corrects', 'corrected',
  'decline', 'declines', 'declined', 'fall', 'falls', 'fell', 'falling',
  'drop', 'drops', 'dropped', 'slide', 'slides', 'slid',
  'bearish', 'weak', 'weakness', 'losses', 'loss', 'red',
  'profit booking', 'panic', 'sell pressure', 'selling pressure',
  'downgrade', 'downgraded', 'recession', 'slowdown', 'contraction',
  'geopolitical', 'tension', 'tensions', 'conflict', 'war', 'attack',
  'strike', 'military', 'escalation', 'escalates', 'sanctions',
  'crude oil surge', 'oil prices surge', 'oil price spike', 'oil surge',
  'fii outflow', 'foreign investors sell', 'foreign outflows', 'capital outflow',
  'inflation surge', 'rate hike fears', 'rupee weakens', 'rupee falls',
  'crisis', 'uncertainty', 'risk-off', 'risk off',
];

const BULLISH_TERMS = [
  'rally', 'rallies', 'rallied', 'soar', 'soars', 'soared',
  'jump', 'jumps', 'jumped',
  'gain', 'gains', 'gained', 'rise', 'rises', 'risen', 'rising',
  'bullish', 'strong', 'strength', 'record high', 'all-time high',
  'upgrade', 'upgraded', 'boost', 'boosted', 'recovery', 'rebound',
  'green', 'outperform', 'beat estimates', 'buying', 'buy pressure',
  'ceasefire', 'de-escalation', 'de-escalates', 'truce', 'peace deal',
  'rate cut', 'fii inflow', 'foreign investors buy', 'capital inflow',
  'risk-on', 'risk on',
];

/**
 * Score text based on finance-specific bearish/bullish vocabulary.
 * @param {string} text
 * @returns {number} positive = bullish, negative = bearish
 */
function scoreFinanceTerms(text) {
  const lower = text.toLowerCase();
  let score = 0;
  for (const term of BEARISH_TERMS) {
    if (lower.includes(term)) score -= 2;
  }
  for (const term of BULLISH_TERMS) {
    if (lower.includes(term)) score += 2;
  }
  return score;
}

module.exports = { scoreFinanceTerms, BEARISH_TERMS, BULLISH_TERMS };
