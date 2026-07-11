// riskManager.js
// Manages risk: position sizing, stop-loss, daily limits

class RiskManager {
  constructor(config = {}) {
    // Risk parameters (from .env or config)
    this.maxPositionSize = config.maxPositionSize || 5000; // ₹5000
    this.maxDailyLoss = config.maxDailyLoss || 500; // ₹500
    this.stopLossPercent = config.stopLossPercent || 10; // 10%
    this.takeProfitPercent = config.takeProfitPercent || 15; // 15%

    // Tracking
    this.todayLoss = 0;
    this.positions = [];
    this.trades = [];
  }

  /**
   * Check if trading is allowed based on daily loss limit
   * @returns {object} { allowed: boolean, message: string }
   */
  checkDailyLossLimit() {
    if (this.todayLoss >= this.maxDailyLoss) {
      return {
        allowed: false,
        message: `Daily loss limit reached: ₹${this.todayLoss}/${this.maxDailyLoss}`,
        todayLoss: this.todayLoss,
      };
    }

    const remainingLoss = this.maxDailyLoss - this.todayLoss;

    return {
      allowed: true,
      message: `Daily loss limit OK. Remaining: ₹${remainingLoss}`,
      remainingLoss,
      todayLoss: this.todayLoss,
    };
  }

  /**
   * Calculate position size for a trade
   * Based on risk percentage and entry price
   * @param {number} accountBalance - Current account balance
   * @param {number} entryPrice - Entry price of option
   * @param {number} quantity - Number of contracts
   * @returns {object} { positionSize, quantity, allowed }
   */
  calculatePositionSize(accountBalance, entryPrice, quantity = 1) {
    const positionSize = entryPrice * quantity;

    // Check against max position size
    if (positionSize > this.maxPositionSize) {
      return {
        positionSize: positionSize,
        quantity: quantity,
        maxAllowed: this.maxPositionSize,
        allowed: false,
        message: `Position size ₹${positionSize} exceeds limit ₹${this.maxPositionSize}`,
        recommendation: `Reduce quantity to ${Math.floor(this.maxPositionSize / entryPrice)}`,
      };
    }

    // Check % of account
    const percentOfAccount = (positionSize / accountBalance) * 100;
    if (percentOfAccount > 10) {
      // More than 10% of account
      return {
        positionSize: positionSize,
        quantity: quantity,
        percentOfAccount: percentOfAccount.toFixed(2),
        allowed: false,
        message: `Position is ${percentOfAccount.toFixed(2)}% of account (max 10%)`,
      };
    }

    return {
      positionSize: parseFloat(positionSize.toFixed(2)),
      quantity: quantity,
      percentOfAccount: percentOfAccount.toFixed(2),
      allowed: true,
      message: `Position OK: ₹${positionSize.toFixed(2)} (${percentOfAccount.toFixed(2)}% of account)`,
    };
  }

  /**
   * Calculate stop-loss and take-profit levels
   * @param {number} entryPrice - Entry price
   * @returns {object} { stopLoss, takeProfit, riskPercentage, rewardPercentage }
   */
  calculateRiskReward(entryPrice) {
    const stopLoss = entryPrice * (1 - this.stopLossPercent / 100);
    const takeProfit = entryPrice * (1 + this.takeProfitPercent / 100);

    const riskAmount = entryPrice - stopLoss;
    const rewardAmount = takeProfit - entryPrice;
    const riskRewardRatio = rewardAmount / riskAmount;

    return {
      entryPrice: parseFloat(entryPrice.toFixed(2)),
      stopLoss: parseFloat(stopLoss.toFixed(2)),
      takeProfit: parseFloat(takeProfit.toFixed(2)),
      riskAmount: parseFloat(riskAmount.toFixed(2)),
      rewardAmount: parseFloat(rewardAmount.toFixed(2)),
      riskRewardRatio: parseFloat(riskRewardRatio.toFixed(2)),
      stopLossPercent: this.stopLossPercent,
      takeProfitPercent: this.takeProfitPercent,
    };
  }

  /**
   * Validate if a trade should be executed
   * @param {object} trade - Trade object with symbol, quantity, price
   * @returns {object} { approved: boolean, message: string, details: object }
   */
  validateTrade(trade, accountBalance) {
    const dailyLimitCheck = this.checkDailyLossLimit();
    if (!dailyLimitCheck.allowed) {
      return {
        approved: false,
        message: dailyLimitCheck.message,
        reason: "Daily loss limit exceeded",
      };
    }

    const positionSizeCheck = this.calculatePositionSize(
      accountBalance,
      trade.price,
      trade.quantity || 1
    );
    if (!positionSizeCheck.allowed) {
      return {
        approved: false,
        message: positionSizeCheck.message,
        reason: "Position size exceeds limit",
        recommendation: positionSizeCheck.recommendation,
      };
    }

    const riskReward = this.calculateRiskReward(trade.price);

    // Check risk-reward ratio (at least 1:1)
    if (riskReward.riskRewardRatio < 1) {
      return {
        approved: false,
        message: `Risk-Reward ratio (${riskReward.riskRewardRatio.toFixed(2)}:1) is not favorable`,
        reason: "Unfavorable risk-reward ratio",
        riskReward,
      };
    }

    return {
      approved: true,
      message: "Trade approved",
      positionSize: positionSizeCheck.positionSize,
      riskReward: riskReward,
      maxLossPerTrade: positionSizeCheck.positionSize * (this.stopLossPercent / 100),
      remainingDailyLoss: dailyLimitCheck.remainingLoss,
    };
  }

  /**
   * Record a trade execution
   * @param {object} tradeData - Trade details
   */
  recordTrade(tradeData) {
    const trade = {
      timestamp: new Date().toISOString(),
      symbol: tradeData.symbol,
      quantity: tradeData.quantity,
      entryPrice: tradeData.entryPrice,
      positionSize: tradeData.quantity * tradeData.entryPrice,
      stopLoss: this.calculateRiskReward(tradeData.entryPrice).stopLoss,
      takeProfit: this.calculateRiskReward(tradeData.entryPrice).takeProfit,
      status: "OPEN",
    };

    this.positions.push(trade);
    this.trades.push(trade);

    return trade;
  }

  /**
   * Update trade on exit
   * @param {string} tradeId - Trade identifier
   * @param {number} exitPrice - Exit price
   * @returns {object} Trade result
   */
  closeTrade(tradeId, exitPrice) {
    const tradeIndex = this.positions.findIndex(
      (t) => t.symbol === tradeId
    );

    if (tradeIndex === -1) {
      return { success: false, message: "Trade not found" };
    }

    const trade = this.positions[tradeIndex];
    const pnl = (exitPrice - trade.entryPrice) * trade.quantity;
    const pnlPercent =
      ((exitPrice - trade.entryPrice) / trade.entryPrice) * 100;

    // Update daily loss
    if (pnl < 0) {
      this.todayLoss += Math.abs(pnl);
    }

    // Mark as closed
    trade.exitPrice = exitPrice;
    trade.pnl = parseFloat(pnl.toFixed(2));
    trade.pnlPercent = parseFloat(pnlPercent.toFixed(2));
    trade.status = "CLOSED";
    trade.exitTime = new Date().toISOString();

    this.positions.splice(tradeIndex, 1);

    return {
      success: true,
      trade: trade,
      todayLoss: this.todayLoss,
    };
  }

  /**
   * Get current portfolio summary
   * @returns {object} Portfolio metrics
   */
  getPortfolioSummary() {
    const totalPositionSize = this.positions.reduce(
      (sum, p) => sum + p.positionSize,
      0
    );
    const totalUnrealizedPnL = this.positions.reduce((sum, p) => {
      // For illustrative purposes, assume current price = entry price
      return sum;
    }, 0);

    const closedTrades = this.trades.filter((t) => t.status === "CLOSED");
    const realizedPnL = closedTrades.reduce((sum, t) => sum + t.pnl, 0);

    return {
      openPositions: this.positions.length,
      totalPositionSize: parseFloat(totalPositionSize.toFixed(2)),
      unrealizedPnL: parseFloat(totalUnrealizedPnL.toFixed(2)),
      totalClosedTrades: closedTrades.length,
      realizedPnL: parseFloat(realizedPnL.toFixed(2)),
      todayLoss: this.todayLoss,
      dailyLossLimit: this.maxDailyLoss,
      remainingDailyLoss: this.maxDailyLoss - this.todayLoss,
      riskStatus: this.todayLoss >= this.maxDailyLoss ? "AT_LIMIT" : "OK",
    };
  }

  /**
   * Format risk parameters for display
   * @returns {string} Formatted message
   */
  formatRiskParameters() {
    return `
⚠️ RISK MANAGEMENT PARAMETERS

💰 Position Size: ₹${this.maxPositionSize} max per trade
📊 Daily Loss Limit: ₹${this.maxDailyLoss}
🛑 Stop Loss: ${this.stopLossPercent}%
🎯 Take Profit: ${this.takeProfitPercent}%

📈 Risk-Reward Ratio Required: 1:${(this.takeProfitPercent / this.stopLossPercent).toFixed(2)}

Current Status:
• Today's Loss: ₹${this.todayLoss}/${this.maxDailyLoss}
• Remaining Loss Buffer: ₹${this.maxDailyLoss - this.todayLoss}
• Open Positions: ${this.positions.length}
    `.trim();
  }

  /**
   * Reset daily loss (call at market open)
   */
  resetDailyLoss() {
    this.todayLoss = 0;
  }
}

module.exports = RiskManager;
