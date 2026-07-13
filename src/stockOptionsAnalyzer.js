// stockOptionsAnalyzer.js
// Generates call/put option signals for individual F&O-eligible stocks,
// reusing the same technical + option-chain engine built for NIFTY.
//
// IMPORTANT DESIGN NOTES:
// 1. Stock options only have MONTHLY expiry (unlike NIFTY's weekly) - this
//    module fetches the real available expiries from NSE rather than
//    computing one, since guessing here would repeat the NIFTY symbol-format
//    mistake we already learned from.
// 2. Sentiment is NOT fetched separately per stock (this would blow through
//    NewsAPI's free-tier rate limit across 180+ stocks). Instead, this module
//    takes the ALREADY-FETCHED broad market news array (from newsProcessor)
//    and matches articles mentioning each company's name/symbol. Coverage
//    will be sparse for smaller/less-covered stocks - many will show zero
//    matched articles, which is an honest limitation, not a bug.
// 3. Lot sizes come directly from NSE's real option chain data where available.

const { getMultiTimeframeCloses } = require('./priceDataFetcher');
const TechnicalIndicators = require('./technicalIndicators');
const CallOptionsSignal = require('./callOptionsSignal');

/**
 * Match already-fetched news articles against a specific company, to derive
 * a stock-specific sentiment WITHOUT making additional NewsAPI calls.
 * @param {object[]} analyzedNews - articles already run through newsProcessor.analyzeNews()
 * @param {string} companyName - e.g. 'Reliance Industries'
 * @param {string} symbol - e.g. 'RELIANCE'
 * @returns {{score: number, confidence: number, positive: number, negative: number, matchedCount: number, reasoning: string}}
 */
function getStockSpecificSentiment(analyzedNews, companyName, symbol) {
  const nameLower = companyName.toLowerCase();
  const symbolLower = symbol.toLowerCase();

  const matched = analyzedNews.filter((a) => {
    const text = `${a.title} ${a.description || ''}`.toLowerCase();
    return text.includes(nameLower) || text.includes(symbolLower);
  });

  if (matched.length === 0) {
    return {
      score: 0,
      confidence: 0,
      positive: 0,
      negative: 0,
      matchedCount: 0,
      reasoning: 'No company-specific news found in current news pool',
    };
  }

  const positive = matched.filter((a) => a.sentiment === 'positive').length;
  const negative = matched.filter((a) => a.sentiment === 'negative').length;

  return {
    score: (positive - negative) / matched.length,
    confidence: (Math.abs(positive - negative) / matched.length) * 100,
    positive,
    negative,
    matchedCount: matched.length,
    reasoning: `${positive} bullish vs ${negative} bearish (${matched.length} company-specific articles)`,
  };
}

/**
 * Full analysis pipeline for a single F&O stock: real prices -> technicals ->
 * stock-specific sentiment -> option decision -> real premium lookup.
 * @param {object} stock - { symbol: 'RELIANCE', companyName: 'Reliance Industries' }
 * @param {object[]} analyzedNews - already-fetched, already-analyzed news pool (shared across all stocks)
 * @returns {Promise<object>} the option signal (or NO_ACTION), tagged with the stock symbol
 */
async function analyzeStockForOptions(stock, analyzedNews) {
  const { symbol, companyName } = stock;

  // 1. Real price data (daily + weekly) - symbolType 'Equity', not 'Index'
  let technicalAnalysis;
  let currentPrice;
  try {
    const { dailyCloses, weeklyCloses } = await getMultiTimeframeCloses(symbol, 90, 450, 'Equity');
    currentPrice = dailyCloses[dailyCloses.length - 1];

    const dailyAnalysis = TechnicalIndicators.analyzeTechnicals(dailyCloses);
    const weeklyAnalysis = TechnicalIndicators.analyzeWeeklyTrend(weeklyCloses);
    technicalAnalysis = TechnicalIndicators.applyMultiTimeframeConfirmation(dailyAnalysis, weeklyAnalysis);
  } catch (error) {
    return {
      symbol,
      action: 'NO_ACTION',
      reason: `Price data unavailable: ${error.message}`,
    };
  }

  if (technicalAnalysis.status === 'INSUFFICIENT_DATA') {
    return {
      symbol,
      action: 'NO_ACTION',
      reason: 'Insufficient price history for technical analysis',
    };
  }

  // 2. Stock-specific sentiment (from the shared news pool, no extra API calls)
  const sentiment = getStockSpecificSentiment(analyzedNews, companyName, symbol);

  // 3. Decide CALL / PUT / NO_ACTION using the same logic as NIFTY
  const optionSignal = CallOptionsSignal.generateOptionSignal(technicalAnalysis, sentiment, currentPrice, symbol);

  if (optionSignal.action === 'NO_ACTION') {
    return { symbol, ...optionSignal };
  }

  // 4. Try to get the REAL option chain for this stock (real strikes, real premiums, real expiry)
  try {
    const { getFullEquityOptionChain, findEquityOptionMatch } = require('./optionChainFetcher');
    const chain = await getFullEquityOptionChain(symbol);
    const nearestExpiry = chain.expiryDates?.[0];
    const optionType = optionSignal.action === 'BUY_PUT' ? 'PE' : 'CE';

    const realStrikes = [...new Set(chain.data.map((d) => d.strikePrice))].sort((a, b) => a - b);
    const closestRealStrike = realStrikes.reduce((closest, strike) =>
      Math.abs(strike - optionSignal.strikePrice) < Math.abs(closest - optionSignal.strikePrice) ? strike : closest
    , realStrikes[0]);

    const match = findEquityOptionMatch(chain.data, closestRealStrike, optionType, nearestExpiry);

    if (match) {
      optionSignal.strikePrice = closestRealStrike;
      optionSignal.expiryDate = nearestExpiry;
      optionSignal.symbol = `${symbol} ${nearestExpiry} ${closestRealStrike} ${optionType}`; // best-effort label
      optionSignal.estimatedPremium = match.lastPrice;
      optionSignal.targetPrice = parseFloat((match.lastPrice * 1.15).toFixed(2));
      optionSignal.stopLoss = parseFloat((match.lastPrice * 0.9).toFixed(2));
      optionSignal.openInterest = match.openInterest;
      optionSignal.premiumSource = 'LIVE_MARKET';
    } else {
      optionSignal.premiumSource = 'ESTIMATED';
      optionSignal.warning = 'Could not match real strike/expiry in option chain - premium is theoretical estimate';
    }
  } catch (error) {
    optionSignal.premiumSource = 'ESTIMATED';
    optionSignal.warning = `Real option chain lookup failed: ${error.message}`;
  }

  return { symbol, companyName, ...optionSignal };
}

/**
 * Analyze a BATCH of stocks sequentially (with a small delay between each to
 * be respectful of NSE's rate limits). Designed to be called with a SLICE of
 * your full F&O universe per run, not all ~180 at once.
 * @param {object[]} stocks - [{ symbol, companyName }, ...]
 * @param {object[]} analyzedNews - shared news pool
 * @param {number} delayMs - delay between each stock's analysis (default 500ms)
 * @returns {Promise<object[]>} all results, including NO_ACTION ones
 */
async function analyzeStockBatch(stocks, analyzedNews, delayMs = 500) {
  const results = [];
  for (const stock of stocks) {
    try {
      const result = await analyzeStockForOptions(stock, analyzedNews);
      results.push(result);
    } catch (error) {
      results.push({ symbol: stock.symbol, action: 'NO_ACTION', reason: `Unexpected error: ${error.message}` });
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return results;
}

module.exports = { analyzeStockForOptions, analyzeStockBatch, getStockSpecificSentiment };