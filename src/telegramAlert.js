const axios = require('axios');

class TelegramAlert {
  constructor() {
    this.botToken = process.env.TELEGRAM_BOT_TOKEN;
    this.chatId = process.env.TELEGRAM_CHAT_ID;
    this.apiUrl = `https://api.telegram.org/bot${this.botToken}`;
  }

  /**
   * Send signal alert via Telegram.
   * Accepts either a full signal object (formatted via formatMessage) or a
   * plain pre-formatted string (sent as-is).
   */
  async sendAlert(signal, index) {
    if (!this.botToken || !this.chatId) {
      console.log('Telegram not configured');
      return;
    }

    const message = typeof signal === 'string' ? signal : this.formatMessage(signal, index);

    try {
      await axios.post(`${this.apiUrl}/sendMessage`, {
        chat_id: this.chatId,
        text: message,
        parse_mode: 'HTML'
      });

      console.log(`✅ Alert sent for ${index || 'message'}`);
    } catch (error) {
      console.error(`Failed to send Telegram alert: ${error.message}`);
    }
  }

  /**
   * Format signal as HTML message
   */
  formatMessage(signal, index) {
    const emoji = {
      'BUY': '🟢',
      'SELL': '🔴',
      'HOLD': '🟡'
    };

    const confidenceBar = this.getConfidenceBar(signal.confidence);

    return `
${emoji[signal.direction]} <b>${index} ${signal.direction}</b>

<b>Details:</b>
• Score: <code>${signal.score.toFixed(3)}</code>
• Confidence: ${confidenceBar} ${(signal.confidence * 100).toFixed(1)}%
• Sentiment: ${signal.sentimentScore.toFixed(3)}
• Momentum: ${signal.momentumScore.toFixed(3)}

<b>News Analysis:</b>
• Total articles: ${signal.newsCount}
• Positive: ${signal.positiveNews} 📈
• Negative: ${signal.negativeNews} 📉

<b>Reason:</b>
<i>${signal.reasoning}</i>

<b>Time:</b> ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST
    `.trim();
  }

  /**
   * Get visual confidence bar
   */
  getConfidenceBar(confidence) {
    const filled = Math.round(confidence * 10);
    const empty = 10 - filled;
    return '█'.repeat(filled) + '░'.repeat(empty);
  }

  /**
   * Send a single consolidated summary of the entire bot run — news, sentiment,
   * technicals, the option signal (call or put) with refined premium-based
   * target/stop-loss, and the final order status — all in one message.
   *
   * @param {object} data
   * @param {number} data.newsCount
   * @param {string} data.sentimentLabel - 'BULLISH' or 'BEARISH'
   * @param {number} data.sentimentScore
   * @param {object} data.technicalAnalysis - result from TechnicalIndicators.analyzeTechnicals
   * @param {object} data.optionSignal - result from CallOptionsSignal.generateOptionSignal
   * @param {object|null} data.orderResult - result from GrowwTrader order methods, or null
   */
  async sendFullSummary(data) {
    if (!this.botToken || !this.chatId) {
      console.log('Telegram not configured');
      return;
    }

    const {
      newsCount,
      sentimentLabel,
      sentimentScore,
      technicalAnalysis,
      optionSignal,
      orderResult,
    } = data;

    const sentimentEmoji = sentimentLabel === 'BULLISH' ? '🟢' : '🔴';

    let technicalsBlock = '⚠️ Insufficient data for technical analysis';
    if (technicalAnalysis && technicalAnalysis.status !== 'INSUFFICIENT_DATA') {
      technicalsBlock = `
• RSI: ${technicalAnalysis.rsi}
• MACD: ${technicalAnalysis.macd?.macd?.toFixed(4)} / Signal: ${technicalAnalysis.macd?.signal?.toFixed(4)}
• Bollinger Bands: ₹${technicalAnalysis.bollingerBands?.lower} — ₹${technicalAnalysis.bollingerBands?.upper}
• Current Price: ₹${technicalAnalysis.currentPrice}
• Technical Signal: <b>${technicalAnalysis.signal}</b> (${technicalAnalysis.confidence}%)`.trim();
    }

    let optionBlock = '⏸️ No option signal this run';
    if (optionSignal && optionSignal.action !== 'NO_ACTION') {
      const typeLabel = optionSignal.action === 'BUY_PUT' ? '🔻 PUT' : '📞 CALL';
      optionBlock = `
${typeLabel} — ${optionSignal.symbol}
• Strike: ₹${optionSignal.strikePrice} | Expiry: ${optionSignal.expiryDate}
• Estimated Premium: ₹${optionSignal.estimatedPremium}
• Target (premium): ₹${optionSignal.targetPrice}
• Stop Loss (premium): ₹${optionSignal.stopLoss}
• Confidence: ${optionSignal.confidence}%`.trim();
    } else if (optionSignal) {
      optionBlock = `⏸️ ${optionSignal.reason}`;
    }

    let orderBlock = '⏸️ No trade attempted';
    if (orderResult) {
      orderBlock = orderResult.success
        ? `✅ ORDER PLACED — ID: ${orderResult.orderId} | ₹${orderResult.price} x ${orderResult.quantity}`
        : `❌ Order failed — ${orderResult.error || orderResult.message}`;
    }

    const message = `
📊 <b>BOT RUN SUMMARY</b>

<b>News:</b> ${newsCount} articles analyzed
<b>Sentiment:</b> ${sentimentEmoji} ${sentimentLabel} (score: ${sentimentScore.toFixed(2)})

<b>Technical Analysis:</b>
${technicalsBlock}

<b>Option Signal:</b>
${optionBlock}

<b>Order Status:</b>
${orderBlock}

<b>Time:</b> ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST
    `.trim();

    try {
      await axios.post(`${this.apiUrl}/sendMessage`, {
        chat_id: this.chatId,
        text: message,
        parse_mode: 'HTML'
      });

      console.log('✅ Full run summary sent to Telegram');
    } catch (error) {
      console.error(`Failed to send full summary: ${error.message}`);
    }
  }

  /**
   * Send daily summary
   */
  async sendDailySummary(niftySignal, sensexSignal, stats) {
    if (!this.botToken || !this.chatId) {
      console.log('Telegram not configured');
      return;
    }

    const message = `
📊 <b>Daily Market Summary</b>

<b>NIFTY:</b> ${niftySignal.direction} (${(niftySignal.confidence * 100).toFixed(1)}%)
<b>SENSEX:</b> ${sensexSignal.direction} (${(sensexSignal.confidence * 100).toFixed(1)}%)

<b>Statistics:</b>
• NIFTY Accuracy: ${(stats.nifty.accuracy * 100).toFixed(1)}%
• SENSEX Accuracy: ${(stats.sensex.accuracy * 100).toFixed(1)}%

<b>Time:</b> ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST
    `.trim();

    try {
      await axios.post(`${this.apiUrl}/sendMessage`, {
        chat_id: this.chatId,
        text: message,
        parse_mode: 'HTML'
      });

      console.log('✅ Daily summary sent');
    } catch (error) {
      console.error(`Failed to send summary: ${error.message}`);
    }
  }
}

module.exports = TelegramAlert;