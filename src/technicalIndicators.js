// technicalIndicators.js
// Calculates technical indicators: RSI, MACD, Bollinger Bands

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

    // Calculate initial gains and losses
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

    // Calculate for remaining prices
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
    const rsi = 100 - 100 / (1 + rs);

    return parseFloat(rsi.toFixed(2));
  }

  /**
   * Calculate MACD (Moving Average Convergence Divergence)
   * @param {number[]} prices - Array of closing prices
   * @returns {object} { macd, signal, histogram }
   */
  static calculateMACD(prices) {
    if (prices.length < 26) {
      return null;
    }

    // Calculate 12-day EMA
    const ema12 = this.calculateEMA(prices, 12);

    // Calculate 26-day EMA
    const ema26 = this.calculateEMA(prices, 26);

    // MACD line
    const macdLine = ema12 - ema26;

    // Signal line (9-day EMA of MACD)
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
    // Histogram
    const histogram = macdLine - signalLine;

    return {
      macd: parseFloat(macdLine.toFixed(4)),
      signal: parseFloat(signalLine.toFixed(4)),
      histogram: parseFloat(histogram.toFixed(4)),
    };
  }

  /**
   * Calculate Bollinger Bands
   * @param {number[]} prices - Array of closing prices
   * @param {number} period - Default 20
   * @param {number} stdDev - Standard deviations (default 2)
   * @returns {object} { upper, middle, lower }
   */
  static calculateBollingerBands(prices, period = 20, stdDev = 2) {
    if (prices.length < period) {
      return null;
    }

    const recentPrices = prices.slice(-period);

    // Calculate SMA (middle band)
    const sma = recentPrices.reduce((a, b) => a + b, 0) / recentPrices.length;

    // Calculate standard deviation
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
   * @param {number[]} prices - Array of closing prices
   * @param {number} period - Period for SMA
   * @returns {number} SMA value
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
   * @param {number[]} prices - Array of closing prices
   * @param {number} period - Period for EMA
   * @returns {number} EMA value
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
   * Analyze technical indicators for signal
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

    // RSI Analysis
    if (rsi < 30) {
      buyVotes++;
      reasons.push(`RSI oversold: ${rsi}`);
    } else if (rsi > 70) {
      sellVotes++;
      reasons.push(`RSI overbought: ${rsi}`);
    }

    // MACD Analysis
    if (macd && macd.histogram > 0 && macd.macd > macd.signal) {
      buyVotes++;
      reasons.push("MACD bullish crossover");
    } else if (macd && macd.histogram < 0 && macd.macd < macd.signal) {
      sellVotes++;
      reasons.push("MACD bearish crossover");
    }

    // Bollinger Bands Analysis
    if (currentPrice < bb.lower) {
      buyVotes++;
      reasons.push("Price below lower BB band");
    } else if (currentPrice > bb.upper) {
      sellVotes++;
      reasons.push("Price above upper BB band");
    }

    // Moving Average Analysis
    if (sma20 > sma50) {
      buyVotes++;
      reasons.push("SMA20 > SMA50 (bullish trend)");
    } else if (sma20 < sma50) {
      sellVotes++;
      reasons.push("SMA20 < SMA50 (bearish trend)");
    }

    const totalVotes = buyVotes + sellVotes;
    let signal = "HOLD";
    if (buyVotes > sellVotes) signal = "BUY";
    else if (sellVotes > buyVotes) signal = "SELL";

    // Confidence reflects how one-sided the votes are, out of 4 possible indicators
    const confidence =
      totalVotes > 0
        ? Math.round((Math.max(buyVotes, sellVotes) / 4) * 100)
        : 0;

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
}

module.exports = TechnicalIndicators;
