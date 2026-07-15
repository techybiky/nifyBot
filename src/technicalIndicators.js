// technicalIndicators.js
// Calculates technical indicators: RSI, MACD, Bollinger Bands, and multi-timeframe confirmation

class TechnicalIndicators {
  /**
   * Calculate RSI (Relative Strength Index)
   * @param {number[]} prices - Array of closing prices
   * @param {number} period - Default 14
   * @returns {number} RSI value (0-100)
   */
  static calculateRSI(prices, period = 14) {
    if (prices.length < period + 1) {
      return null;
    }

    let gains = 0;
    let losses = 0;

    for (let i = 1; i <= period; i++) {
      const diff = prices[i] - prices[i - 1];
      if (diff > 0) {
        gains += diff;
      } else {
        losses += Math.abs(diff);
      }
    }

    let avgGain = gains / period;
    let avgLoss = losses / period;

    for (let i = period + 1; i < prices.length; i++) {
      const diff = prices[i] - prices[i - 1];
      if (diff > 0) {
        avgGain = (avgGain * (period - 1) + diff) / period;
        avgLoss = (avgLoss * (period - 1)) / period;
      } else {
        avgGain = (avgGain * (period - 1)) / period;
        avgLoss = (avgLoss * (period - 1) + Math.abs(diff)) / period;
      }
    }

    const rs = avgGain / avgLoss;
    const rsi = 100 - (100 / (1 + rs));

    return parseFloat(rsi.toFixed(2));
  }

  /**
   * Calculate MACD (Moving Average Convergence Divergence)
   */
  static calculateMACD(prices) {
    if (prices.length < 26) {
      return null;
    }

    const ema12 = this.calculateEMA(prices, 12);
    const ema26 = this.calculateEMA(prices, 26);
    const macdLine = ema12 - ema26;

    const macdValues = [];
    for (let i = 0; i < prices.length; i++) {
      const e12 = this.calculateEMA(prices.slice(0, i + 1), 12);
      const e26 = this.calculateEMA(prices.slice(0, i + 1), 26);
      if (e12 && e26) {
        macdValues.push(e12 - e26);
      }
    }

    const signalLine = this.calculateEMA(macdValues, 9);
    if (signalLine === null) {
      return null;
    }

    const histogram = macdLine - signalLine;

    return {
      macd: parseFloat(macdLine.toFixed(4)),
      signal: parseFloat(signalLine.toFixed(4)),
      histogram: parseFloat(histogram.toFixed(4)),
    };
  }

  /**
   * Calculate Bollinger Bands
   */
  static calculateBollingerBands(prices, period = 20, stdDev = 2) {
    if (prices.length < period) {
      return null;
    }

    const recentPrices = prices.slice(-period);
    const sma = recentPrices.reduce((a, b) => a + b, 0) / recentPrices.length;
    const variance =
      recentPrices.reduce((sum, price) => sum + Math.pow(price - sma, 2), 0) /
      recentPrices.length;
    const standardDev = Math.sqrt(variance);

    return {
      upper: parseFloat((sma + stdDev * standardDev).toFixed(2)),
      middle: parseFloat(sma.toFixed(2)),
      lower: parseFloat((sma - stdDev * standardDev).toFixed(2)),
    };
  }

  /**
   * Calculate Simple Moving Average
   */
  static calculateSMA(prices, period) {
    if (prices.length < period) {
      return null;
    }
    const recentPrices = prices.slice(-period);
    return (
      recentPrices.reduce((a, b) => a + b, 0) / recentPrices.length
    ).toFixed(2);
  }

  /**
   * Calculate Exponential Moving Average
   */
  static calculateEMA(prices, period) {
    if (prices.length < period) {
      return null;
    }

    const multiplier = 2 / (period + 1);
    let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;

    for (let i = period; i < prices.length; i++) {
      ema = prices[i] * multiplier + ema * (1 - multiplier);
    }

    return ema;
  }

  /**
   * Analyze technical indicators for signal (daily timeframe)
   * @param {number[]} prices - Array of closing prices
   * @returns {object} Technical analysis result
   */
  static analyzeTechnicals(prices) {
    if (!prices || prices.length < 35) {
      return {
        status: "INSUFFICIENT_DATA",
        message: "Need at least 35 price points",
      };
    }

    const rsi = this.calculateRSI(prices);
    const macd = this.calculateMACD(prices);
    const bb = this.calculateBollingerBands(prices);
    const sma20 = this.calculateSMA(prices, 20);
    const sma50 = this.calculateSMA(prices, 50);
    const currentPrice = prices[prices.length - 1];

    let buyVotes = 0;
    let sellVotes = 0;
    const reasons = [];

    if (rsi < 30) {
      buyVotes++;
      reasons.push(`RSI oversold: ${rsi}`);
    } else if (rsi > 70) {
      sellVotes++;
      reasons.push(`RSI overbought: ${rsi}`);
    }

    if (macd && macd.histogram > 0 && macd.macd > macd.signal) {
      buyVotes++;
      reasons.push("MACD bullish crossover");
    } else if (macd && macd.histogram < 0 && macd.macd < macd.signal) {
      sellVotes++;
      reasons.push("MACD bearish crossover");
    }

    if (currentPrice < bb.lower) {
      buyVotes++;
      reasons.push("Price below lower BB band");
    } else if (currentPrice > bb.upper) {
      sellVotes++;
      reasons.push("Price above upper BB band");
    }

    if (sma20 > sma50) {
      buyVotes++;
      reasons.push("SMA20 > SMA50 (bullish trend)");
    } else if (sma20 < sma50) {
      sellVotes++;
      reasons.push("SMA20 < SMA50 (bearish trend)");
    }

    // SUDDEN MOVE DETECTOR: RSI/MACD/SMA are all slow, multi-day trend
    // indicators - a single sharp day (e.g. a geopolitical shock) barely
    // moves them. This check looks at the latest single-day % change
    // directly and votes strongly if it's a significant move, so the bot
    // can react same-day to shocks the slower indicators would miss for
    // several more days.
    const prevPrice = prices[prices.length - 2];
    const dayChangePercent = ((currentPrice - prevPrice) / prevPrice) * 100;
    const SHOCK_THRESHOLD = 1.0; // % move considered a "sudden" single-day move

    if (dayChangePercent <= -SHOCK_THRESHOLD) {
      sellVotes += 2; // weighted higher - an acute shock is a stronger signal than a slow crossover
      reasons.push(`Sudden single-day drop: ${dayChangePercent.toFixed(2)}%`);
    } else if (dayChangePercent >= SHOCK_THRESHOLD) {
      buyVotes += 2;
      reasons.push(`Sudden single-day rally: ${dayChangePercent.toFixed(2)}%`);
    }

    const totalVotes = buyVotes + sellVotes;
    let signal = "HOLD";
    if (buyVotes > sellVotes) signal = "BUY";
    else if (sellVotes > buyVotes) signal = "SELL";

    // Max possible votes is now 6 (4 standard indicators + 2 from a shock move),
    // but we keep the confidence SCALE based on 4 (matching prior behavior for
    // normal days) and simply cap at 100% when a shock pushes it higher -
    // changing the denominator to 6 would have diluted confidence on every
    // ordinary, non-shock day.
    const confidence = totalVotes > 0 ? Math.min(100, Math.round((Math.max(buyVotes, sellVotes) / 4) * 100)) : 0;

    return {
      signal,
      confidence,
      rsi,
      macd,
      bollingerBands: bb,
      sma20,
      sma50,
      currentPrice,
      reasons,
    };
  }

  /**
   * Analyze the WEEKLY timeframe trend, using a simple SMA10 vs SMA20 crossover
   * on weekly closing prices. This is intentionally simpler than the daily
   * analysis — its only job is to answer "what's the higher-timeframe bias?"
   * @param {number[]} weeklyPrices - weekly closing prices, oldest to newest
   * @returns {object} { signal: 'BUY'|'SELL'|'HOLD', status, sma10, sma20 }
   */
  static analyzeWeeklyTrend(weeklyPrices) {
    if (!weeklyPrices || weeklyPrices.length < 20) {
      return {
        status: "INSUFFICIENT_DATA",
        signal: "HOLD",
        message: "Need at least 20 weekly bars for a meaningful weekly trend read",
      };
    }

    const sma10 = parseFloat(this.calculateSMA(weeklyPrices, 10));
    const sma20 = parseFloat(this.calculateSMA(weeklyPrices, 20));

    let signal = "HOLD";
    if (sma10 > sma20) signal = "BUY";
    else if (sma10 < sma20) signal = "SELL";

    return { status: "OK", signal, sma10, sma20 };
  }

  /**
   * MULTI-TIMEFRAME CONFIRMATION: combines the daily technical signal with the
   * weekly trend bias.
   * - If both agree -> confidence is boosted (higher-timeframe confirmation)
   * - If they disagree -> the daily signal is downgraded to HOLD, since trading
   *   against the dominant weekly trend is a lower-probability setup. This is a
   *   dampener, not a hard veto: on the NEXT run, if the daily signal flips to
   *   agree with the weekly trend, it will fire normally.
   * @param {object} dailyAnalysis - result of analyzeTechnicals()
   * @param {object} weeklyAnalysis - result of analyzeWeeklyTrend()
   * @returns {object} dailyAnalysis, adjusted with multi-timeframe context
   */
  static applyMultiTimeframeConfirmation(dailyAnalysis, weeklyAnalysis) {
    if (dailyAnalysis.status === "INSUFFICIENT_DATA" || weeklyAnalysis.status === "INSUFFICIENT_DATA") {
      return {
        ...dailyAnalysis,
        multiTimeframe: {
          applied: false,
          reason: "Insufficient data for weekly confirmation",
        },
      };
    }

    const agrees = dailyAnalysis.signal === weeklyAnalysis.signal;
    const bothDirectional = dailyAnalysis.signal !== "HOLD" && weeklyAnalysis.signal !== "HOLD";

    if (bothDirectional && agrees) {
      // Higher-timeframe confirms the daily signal -> boost confidence
      const boostedConfidence = Math.min(100, dailyAnalysis.confidence + 15);
      return {
        ...dailyAnalysis,
        confidence: boostedConfidence,
        reasons: [...dailyAnalysis.reasons, `Weekly trend confirms (SMA10 ${weeklyAnalysis.signal === "BUY" ? ">" : "<"} SMA20)`],
        multiTimeframe: { applied: true, agreed: true, weeklySignal: weeklyAnalysis.signal },
      };
    }

    if (bothDirectional && !agrees) {
      // Conflict: downgrade to HOLD rather than trade against the dominant trend
      return {
        ...dailyAnalysis,
        signal: "HOLD",
        confidence: Math.round(dailyAnalysis.confidence / 2),
        reasons: [...dailyAnalysis.reasons, `Downgraded to HOLD: daily signal (${dailyAnalysis.signal}) conflicts with weekly trend (${weeklyAnalysis.signal})`],
        multiTimeframe: { applied: true, agreed: false, weeklySignal: weeklyAnalysis.signal },
      };
    }

    // Weekly trend itself is flat/HOLD - no strong higher-timeframe opinion either way
    return {
      ...dailyAnalysis,
      multiTimeframe: { applied: true, agreed: null, weeklySignal: weeklyAnalysis.signal },
    };
  }
}

module.exports = TechnicalIndicators;
