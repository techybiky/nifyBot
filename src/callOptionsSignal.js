// callOptionsSignal.js
// Generates call AND put option trading signals

class CallOptionsSignal {
  /**
   * Get weekly expiry date (next Thursday)
   * @returns {string} Date in DDMMMYY format (e.g., 18JUL26)
   */
  /**
   * Get weekly expiry date for a given index.
   * IMPORTANT: Since 1 September 2025, SEBI mandated exchange-specific expiry
   * days as part of weekly-derivatives rationalization:
   *   - NIFTY 50 (NSE) weekly options expire on TUESDAY (previously Thursday)
   *   - SENSEX (BSE) weekly options expire on THURSDAY
   * If the computed day is an exchange holiday, expiry shifts to the previous
   * working day — that holiday-shift logic is NOT implemented here yet, since
   * it requires an exchange holiday calendar; keep that in mind near holidays.
   * @param {string} indexName - 'NIFTY' or 'SENSEX'
   * @returns {string} Date in DDMMMYY format (e.g., 14JUL26)
   */
  static getWeeklyExpiry(indexName = "NIFTY") {
    const targetDay = indexName.toUpperCase() === "SENSEX" ? 4 : 2; // Thu=4, Tue=2
    const today = new Date();
    const dayOfWeek = today.getDay();

    let daysUntilTarget = targetDay - dayOfWeek;
    if (daysUntilTarget <= 0) {
      daysUntilTarget += 7;
    }

    const expiryDate = new Date(today);
    expiryDate.setDate(expiryDate.getDate() + daysUntilTarget);

    const day = String(expiryDate.getDate()).padStart(2, "0");
    const months = [
      "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
      "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
    ];
    const month = months[expiryDate.getMonth()];
    const year = String(expiryDate.getFullYear()).slice(-2);

    return `${day}${month}${year}`;
  }

  /**
   * Get nearest OTM strike for a CALL (strike above current price)
   */
  static getNearestOTMCallStrike(currentPrice, strikeInterval = 50) {
    const baseStrike = Math.ceil(currentPrice / strikeInterval) * strikeInterval;
    return baseStrike + strikeInterval;
  }

  /**
   * Get nearest OTM strike for a PUT (strike below current price)
   */
  static getNearestOTMPutStrike(currentPrice, strikeInterval = 50) {
    const baseStrike = Math.floor(currentPrice / strikeInterval) * strikeInterval;
    return baseStrike - strikeInterval;
  }

  /**
   * Backwards-compatible alias (existing code may still call this name for calls)
   */
  static getNearestOTMStrike(currentPrice, strikeInterval = 50) {
    return this.getNearestOTMCallStrike(currentPrice, strikeInterval);
  }

  /**
   * Get ATM (At The Money) strike
   */
  static getATMStrike(currentPrice, strikeInterval = 50) {
    return Math.round(currentPrice / strikeInterval) * strikeInterval;
  }

  /**
   * Generate an option trading symbol
   * Example: NIFTY23JUL20000CE or NIFTY23JUL20000PE
   * @param {string} indexName
   * @param {number} strikePrice
   * @param {string} expiryDate - DDMMMYY format
   * @param {string} optionType - 'CE' or 'PE'
   */
  static generateOptionSymbol(indexName = "NIFTY", strikePrice, expiryDate = null, optionType = "CE") {
    const expiry = expiryDate || this.getWeeklyExpiry();
    const strikeStr = String(strikePrice).padStart(5, "0");
    return `${indexName}${expiry}${strikeStr}${optionType}`;
  }

  /**
   * Backwards-compatible alias for call symbol generation
   */
  static generateCallSymbol(indexName = "NIFTY", strikePrice, expiryDate = null) {
    return this.generateOptionSymbol(indexName, strikePrice, expiryDate, "CE");
  }

  /**
   * THE DECISION FUNCTION: decides CALL, PUT, or NO_ACTION based on
   * agreement between the technical signal and sentiment direction.
   *
   * - BUY_CALL  when technical signal is BUY  AND sentiment score > +0.3 (bullish agreement)
   * - BUY_PUT   when technical signal is SELL AND sentiment score < -0.3 (bearish agreement)
   * - NO_ACTION otherwise (includes HOLD, or technical/sentiment disagreeing with each other —
   *   e.g. technical says SELL but sentiment is bullish; we deliberately don't trade on conflicts)
   *
   * @param {object} technicalAnalysis - From technicalIndicators
   * @param {object} sentimentAnalysis - From sentiment analysis
   * @param {number} currentPrice - Current index price
   * @returns {object} Option signal (call, put, or no-action)
   */
  static generateOptionSignal(technicalAnalysis, sentimentAnalysis, currentPrice, underlyingSymbol = "NIFTY") {
    const bullishAgreement =
      technicalAnalysis.signal === "BUY" && sentimentAnalysis.score > 0.3;
    const bearishAgreement =
      technicalAnalysis.signal === "SELL" && sentimentAnalysis.score < -0.3;

    if (bullishAgreement) {
      return this.generateCallOptionSignal(technicalAnalysis, sentimentAnalysis, currentPrice, underlyingSymbol);
    }

    if (bearishAgreement) {
      return this.generatePutOptionSignal(technicalAnalysis, sentimentAnalysis, currentPrice, underlyingSymbol);
    }

    return {
      action: "NO_ACTION",
      reason: "Technical and sentiment signals don't agree strongly enough on a direction",
    };
  }

  /**
   * Generate call option buy signal
   */
  static generateCallOptionSignal(technicalAnalysis, sentimentAnalysis, currentPrice, underlyingSymbol = "NIFTY") {
    const shouldBuyCall =
      technicalAnalysis.signal === "BUY" && sentimentAnalysis.score > 0.3;

    if (!shouldBuyCall) {
      return {
        action: "NO_ACTION",
        reason: "Technical or sentiment not bullish enough",
      };
    }

    const strikePrice = this.getNearestOTMCallStrike(currentPrice);
    const callSymbol = this.generateOptionSymbol(underlyingSymbol, strikePrice, null, "CE");

    const daysToExpiry = 7;
    const volatility = technicalAnalysis.confidence / 100;
    const estimatedPremium = this.estimateCallPremium(currentPrice, strikePrice, daysToExpiry, volatility);

    const overallConfidence = (
      (technicalAnalysis.confidence + sentimentAnalysis.confidence) / 2
    ).toFixed(2);

    const targetPremium = estimatedPremium * 1.15;
    const stopLossPremium = estimatedPremium * 0.9;

    return {
      action: "BUY_CALL",
      symbol: callSymbol,
      indexName: underlyingSymbol,
      currentPrice: parseFloat(currentPrice.toFixed(2)),
      strikePrice,
      expiryDate: this.getWeeklyExpiry(),
      optionType: "CALL",
      estimatedPremium: parseFloat(estimatedPremium.toFixed(2)),
      confidence: overallConfidence,
      technicalSignal: technicalAnalysis.signal,
      technicalConfidence: technicalAnalysis.confidence,
      sentimentScore: sentimentAnalysis.score,
      sentimentConfidence: sentimentAnalysis.confidence,
      reasons: [
        ...technicalAnalysis.reasons,
        `Sentiment: ${sentimentAnalysis.reasoning}`,
      ],
      targetPrice: parseFloat(targetPremium.toFixed(2)), // exit premium for take-profit
      stopLoss: parseFloat(stopLossPremium.toFixed(2)),   // exit premium for stop-loss
    };
  }

  /**
   * Generate put option buy signal (bearish trade)
   */
  static generatePutOptionSignal(technicalAnalysis, sentimentAnalysis, currentPrice, underlyingSymbol = "NIFTY") {
    const shouldBuyPut =
      technicalAnalysis.signal === "SELL" && sentimentAnalysis.score < -0.3;

    if (!shouldBuyPut) {
      return {
        action: "NO_ACTION",
        reason: "Technical or sentiment not bearish enough",
      };
    }

    const strikePrice = this.getNearestOTMPutStrike(currentPrice);
    const putSymbol = this.generateOptionSymbol(underlyingSymbol, strikePrice, null, "PE");

    const daysToExpiry = 7;
    const volatility = technicalAnalysis.confidence / 100;
    const estimatedPremium = this.estimatePutPremium(currentPrice, strikePrice, daysToExpiry, volatility);

    const overallConfidence = (
      (technicalAnalysis.confidence + sentimentAnalysis.confidence) / 2
    ).toFixed(2);

    const targetPremium = estimatedPremium * 1.15;
    const stopLossPremium = estimatedPremium * 0.9;

    return {
      action: "BUY_PUT",
      symbol: putSymbol,
      indexName: underlyingSymbol,
      currentPrice: parseFloat(currentPrice.toFixed(2)),
      strikePrice,
      expiryDate: this.getWeeklyExpiry(),
      optionType: "PUT",
      estimatedPremium: parseFloat(estimatedPremium.toFixed(2)),
      confidence: overallConfidence,
      technicalSignal: technicalAnalysis.signal,
      technicalConfidence: technicalAnalysis.confidence,
      sentimentScore: sentimentAnalysis.score,
      sentimentConfidence: sentimentAnalysis.confidence,
      reasons: [
        ...technicalAnalysis.reasons,
        `Sentiment: ${sentimentAnalysis.reasoning}`,
      ],
      targetPrice: parseFloat(targetPremium.toFixed(2)),
      stopLoss: parseFloat(stopLossPremium.toFixed(2)),
    };
  }

  /**
   * Estimate CALL premium using simplified Black-Scholes
   */
  static estimateCallPremium(spot, strike, daysToExpiry, volatility = 0.2) {
    const T = daysToExpiry / 365;
    const r = 0.05;
    const sigma = volatility;

    const d1 =
      (Math.log(spot / strike) + (r + (sigma * sigma) / 2) * T) /
      (sigma * Math.sqrt(T));
    const d2 = d1 - sigma * Math.sqrt(T);

    const N = (x) => 0.5 * (1 + this.erf(x / Math.sqrt(2)));

    const callPrice = spot * N(d1) - strike * Math.exp(-r * T) * N(d2);
    return Math.max(callPrice, 1);
  }

  /**
   * Estimate PUT premium using simplified Black-Scholes (put version)
   */
  static estimatePutPremium(spot, strike, daysToExpiry, volatility = 0.2) {
    const T = daysToExpiry / 365;
    const r = 0.05;
    const sigma = volatility;

    const d1 =
      (Math.log(spot / strike) + (r + (sigma * sigma) / 2) * T) /
      (sigma * Math.sqrt(T));
    const d2 = d1 - sigma * Math.sqrt(T);

    const N = (x) => 0.5 * (1 + this.erf(x / Math.sqrt(2)));

    const putPrice = strike * Math.exp(-r * T) * N(-d2) - spot * N(-d1);
    return Math.max(putPrice, 1);
  }

  /**
   * Backwards-compatible alias
   */
  static estimatePremium(spot, strike, daysToExpiry, volatility = 0.2) {
    return this.estimateCallPremium(spot, strike, daysToExpiry, volatility);
  }

  /**
   * Error function approximation (for normal distribution)
   */
  static erf(x) {
    const a1 = 0.254829592;
    const a2 = -0.284496736;
    const a3 = 1.421413741;
    const a4 = -1.453152027;
    const a5 = 1.061405429;
    const p = 0.3275911;

    const sign = x < 0 ? -1 : 1;
    x = Math.abs(x);

    const t = 1.0 / (1.0 + p * x);
    const y =
      1.0 -
      (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t) *
        Math.exp(-x * x);

    return sign * y;
  }

  /**
   * Generate sell signal for an existing CALL or PUT position
   * Based on take-profit or stop-loss levels (premium-based)
   */
  static generateSellSignal(position, currentPremium, takeProfitPercent = 15, stopLossPercent = 10) {
    const entryPrice = position.entryPremium;
    const pnlPercent = ((currentPremium - entryPrice) / entryPrice) * 100;

    if (pnlPercent >= takeProfitPercent) {
      return {
        action: "SELL",
        reason: `Take profit reached: ${pnlPercent.toFixed(2)}%`,
        pnlPercent: pnlPercent.toFixed(2),
        profit: (currentPremium - entryPrice).toFixed(2),
      };
    }

    if (pnlPercent <= -stopLossPercent) {
      return {
        action: "SELL",
        reason: `Stop loss hit: ${pnlPercent.toFixed(2)}%`,
        pnlPercent: pnlPercent.toFixed(2),
        loss: (currentPremium - entryPrice).toFixed(2),
      };
    }

    return {
      action: "HOLD",
      reason: `PnL: ${pnlPercent.toFixed(2)}%`,
      pnlPercent: pnlPercent.toFixed(2),
    };
  }

  /**
   * Format an option signal (call or put) for display.
   * Includes a permanent educational-use disclaimer, since this may be
   * shared to a public Telegram channel/group.
   */
  static formatCallOptionMessage(optionSignal) {
    if (optionSignal.action === "NO_ACTION") {
      return `⏸️ <b>NO OPTION SIGNAL</b>\nReason: ${optionSignal.reason}`;
    }

    const isPut = optionSignal.action === "BUY_PUT";
    const emoji = isPut ? "🔻" : "📈";
    const label = isPut ? "PUT (Bearish)" : "CALL (Bullish)";
    const premiumTag = optionSignal.premiumSource === "LIVE_MARKET" ? "Live Market Price" : "Estimated (theoretical)";

    return `
${emoji} <b>${label} Signal — ${optionSignal.indexName}</b>

<b>Symbol:</b> <code>${optionSignal.symbol}</code>
<b>Strike:</b> ₹${optionSignal.strikePrice}  |  <b>Expiry:</b> ${optionSignal.expiryDate}
<b>Spot Price:</b> ₹${optionSignal.currentPrice}

💰 <b>Premium:</b> ₹${optionSignal.estimatedPremium} <i>(${premiumTag})</i>
🎯 <b>Target:</b> ₹${optionSignal.targetPrice}
🛑 <b>Stop Loss:</b> ₹${optionSignal.stopLoss}

📊 <b>Confidence:</b> ${optionSignal.confidence}%
   • Technical: ${optionSignal.technicalSignal} (${optionSignal.technicalConfidence}%)
   • Sentiment: ${optionSignal.sentimentScore.toFixed(2)} (${optionSignal.sentimentConfidence}%)

<b>Basis:</b>
${optionSignal.reasons.map((r) => `• ${r}`).join("\n")}

<i>🕐 ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST</i>

━━━━━━━━━━━━━━━━━━━━
⚠️ <b>Disclaimer:</b> This is an automated, algorithm-generated signal shared for educational and informational purposes only. It is NOT investment advice. The author is not a SEBI-registered Investment Adviser or Research Analyst. Trading in futures & options carries a high risk of financial loss and is not suitable for all investors. Past performance of this or any strategy does not guarantee future results. Please consult a SEBI-registered financial advisor and conduct your own due diligence before making any investment decision. Trade at your own risk.
    `.trim();
  }
}

module.exports = CallOptionsSignal;