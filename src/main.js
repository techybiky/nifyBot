#!/usr/bin/env node

const NewsProcessor = require("./newsProcessor");
const SignalGenerator = require("./signalGenerator");
const Database = require("./database");
const TelegramAlert = require("./telegramAlert");
const TechnicalIndicators = require("./technicalIndicators");
const CallOptionsSignal = require("./callOptionsSignal");
const RiskManager = require("./riskManager");
const GrowwTrader = require("./growwTrader");
const fs = require("fs");
const path = require("path");
const { getHistoricalCloses } = require("./priceDataFetcher");

require("dotenv").config();

const LOG_FILE = "logs/bot.log";

function log(message) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}`;
  console.log(logMessage);

  // Ensure logs directory exists
  if (!fs.existsSync("logs")) {
    fs.mkdirSync("logs", { recursive: true });
  }

  fs.appendFileSync(LOG_FILE, logMessage + "\n");
}

async function main() {
  try {
    log("=".repeat(70));
    log("🚀 ENHANCED NIFTY/SENSEX PREDICTION BOT WITH CALL OPTIONS");
    log("=".repeat(70));

    // ==========================================
    // INITIALIZE MODULES
    // ==========================================
    const db = new Database();
    const newsProcessor = new NewsProcessor();
    const signalGenerator = new SignalGenerator();
    const telegramAlert = new TelegramAlert();
    const riskManager = new RiskManager({
      maxPositionSize: parseInt(process.env.MAX_POSITION_SIZE || "5000"),
      maxDailyLoss: parseInt(process.env.MAX_DAILY_LOSS || "500"),
      stopLossPercent: parseInt(process.env.STOP_LOSS_PERCENT || "10"),
      takeProfitPercent: parseInt(process.env.TAKE_PROFIT_PERCENT || "15"),
    });
    const growwTrader = new GrowwTrader();

    // ==========================================
    // PHASE 1: Initialize Database
    // ==========================================
    log("\n📊 PHASE 1: Initializing database...");
    await db.initialize();
    log("✅ Database initialized");

    // ==========================================
    // PHASE 2: Fetch News
    // ==========================================
    log("\n📰 PHASE 2: Fetching latest news...");
    const newsData = await newsProcessor.fetchNews();

    if (!newsData || newsData.length === 0) {
      log("⚠️ No news data found");
      return;
    }
    log(`✅ Fetched ${newsData.length} news articles`);

    // ==========================================
    // PHASE 3: Analyze Sentiment
    // ==========================================
    log("\n🔍 PHASE 3: Analyzing sentiment...");
    const analyzedNews = newsProcessor.analyzeNews(newsData);
    log(`✅ Analyzed ${analyzedNews.length} articles`);

    // // Calculate sentiment summary
    // const sentimentScores = analyzedNews.map((n) => n.sentiment);
    // const avgSentiment =
    //   sentimentScores.reduce((a, b) => a + b, 0) / sentimentScores.length;

    const positive = analyzedNews.filter(
      (a) => a.sentiment === "positive",
    ).length;
    const negative = analyzedNews.filter(
      (a) => a.sentiment === "negative",
    ).length;
    const neutral = analyzedNews.filter(
      (a) => a.sentiment === "neutral",
    ).length;
    const sentimentSummary = {
      score:
        analyzedNews.length > 0
          ? (positive - negative) / analyzedNews.length
          : 0,
      confidence:
        analyzedNews.length > 0
          ? (Math.abs(positive - negative) / analyzedNews.length) * 100
          : 0,
      positive,
      negative,
      neutral,
      reasoning: `${positive} bullish news vs ${negative} bearish news`,
    };
    log(`\n  Positive: ${positive} articles`);
    log(`  Negative: ${negative} articles`);
    log(`  Neutral: ${neutral} articles`);
    log(`  Average Score: ${sentimentSummary.score.toFixed(2)}`);

    // ==========================================
    // PHASE 4: Generate Base Signals (Sentiment)
    // ==========================================
    log("\n📊 PHASE 4: Generating trading signals...");
    const niftySignal = signalGenerator.generateSignal(analyzedNews, "NIFTY");
    const sensexSignal = signalGenerator.generateSignal(analyzedNews, "SENSEX");

    log(`\n📊 NIFTY Signal:`);
    log(`  Direction: ${niftySignal.direction}`);
    log(`  Confidence: ${(niftySignal.confidence * 100).toFixed(2)}%`);
    log(`  Score: ${niftySignal.score.toFixed(2)}`);
    log(`  Reasoning: ${niftySignal.reasoning}`);

    log(`\n📊 SENSEX Signal:`);
    log(`  Direction: ${sensexSignal.direction}`);
    log(`  Confidence: ${(sensexSignal.confidence * 100).toFixed(2)}%`);
    log(`  Score: ${sensexSignal.score.toFixed(2)}`);
    log(`  Reasoning: ${sensexSignal.reasoning}`);
    log(`  Sentiment: ${sentimentSummary.score > 0 ? "BULLISH" : "BEARISH"}`);

    // ==========================================
    // PHASE 5: Technical Analysis
    // ==========================================
    log("\n📈 PHASE 5: Technical Analysis...");

    // Mock price data for demo (in production, fetch from API)
    let mockPrices;
    try {
      mockPrices = await getHistoricalCloses("NIFTY 50", 90);
      log(`✅ Fetched ${mockPrices.length} real NIFTY closing prices`);
    } catch (error) {
      log(
        `⚠️ Real price fetch failed (${error.message}), falling back to insufficient-data state`,
      );
      mockPrices = [];
    }

    const technicalAnalysis = TechnicalIndicators.analyzeTechnicals(mockPrices);

    if (technicalAnalysis.status === "INSUFFICIENT_DATA") {
      log("⚠️ Insufficient price data for technical analysis");
    } else {
      log(`\n  RSI: ${technicalAnalysis.rsi}`);
      log(`  MACD: ${technicalAnalysis.macd.macd.toFixed(4)}`);
      log(`  Signal: ${technicalAnalysis.macd.signal.toFixed(4)}`);
      log(`  Bollinger Bands:`);
      log(`    Upper: ₹${technicalAnalysis.bollingerBands.upper}`);
      log(`    Middle: ₹${technicalAnalysis.bollingerBands.middle}`);
      log(`    Lower: ₹${technicalAnalysis.bollingerBands.lower}`);
      log(`  Current Price: ₹${technicalAnalysis.currentPrice}`);
      log(`  Technical Signal: ${technicalAnalysis.signal}`);
      log(`  Technical Confidence: ${technicalAnalysis.confidence}%`);

      technicalAnalysis.reasons.forEach((reason) => {
        log(`  ✓ ${reason}`);
      });
    }

    // ==========================================
    // PHASE 6: Call Options Signal
    // ==========================================
    log("\n📞 PHASE 6: Call Option Signal Generation...");

    const currentNiftyPrice = mockPrices[mockPrices.length - 1];

    const callSignal = CallOptionsSignal.generateOptionSignal(
      technicalAnalysis,
      sentimentSummary,
      currentNiftyPrice,
    );

    if (callSignal.action === "BUY_CALL") {
      log("\n✅ CALL OPTION BUY SIGNAL:");
      log(`  Symbol: ${callSignal.symbol}`);
      log(`  Strike: ₹${callSignal.strikePrice}`);
      log(`  Expiry: ${callSignal.expiryDate}`);
      log(`  Premium: ₹${callSignal.estimatedPremium}`);
      log(`  Target: ₹${callSignal.targetPrice}`);
      log(`  Stop Loss: ₹${callSignal.stopLoss}`);
      log(`  Confidence: ${callSignal.confidence}%`);
      log(`\n  Reasons:`);
      callSignal.reasons.forEach((r) => {
        log(`    • ${r}`);
      });
    } else {
      log(`\n⏸️ No call option signal: ${callSignal.reason}`);
    }

    // ==========================================
    // PHASE 7: Risk Management
    // ==========================================
    log("\n⚠️ PHASE 7: Risk Management Validation...");
    log("\n" + riskManager.formatRiskParameters());

    let tradeApproved = false;

    if (callSignal.action === "BUY_CALL") {
      const validation = riskManager.validateTrade(
        {
          symbol: callSignal.symbol,
          quantity: 1,
          price: callSignal.estimatedPremium,
        },
        100000, // Assume ₹1L account
      );

      log("\n🔍 Trade Validation:");
      if (validation.approved) {
        log(`  ✅ ${validation.message}`);
        log(`  Position Size: ₹${validation.positionSize}`);
        log(`  Risk-Reward Ratio: 1:${validation.riskReward.riskRewardRatio}`);
        log(`  Max Loss Per Trade: ₹${validation.riskReward.riskAmount}`);
        log(`  Remaining Daily Loss: ₹${validation.remainingDailyLoss}`);
        tradeApproved = true;
      } else {
        log(`  ❌ ${validation.message}`);
      }
    }

    // ==========================================
    // PHASE 8: Groww Trading
    // ==========================================
    log("\n💳 PHASE 8: Groww Trading Integration...");

    let orderResult = null;

    if (tradeApproved) {
      // Authenticate
      const authSuccess = await growwTrader.authenticate();
      if (!authSuccess) {
        log("⚠️ Groww API not available (using simulation)");
      }

      log("\n📤 Placing order on Groww...");
      orderResult = await growwTrader.placeBuyCallOrder(callSignal, 1);

      if (orderResult.success) {
        log(`✅ ORDER PLACED`);
        log(`  Order ID: ${orderResult.orderId}`);
        log(`  Symbol: ${orderResult.symbol}`);
        log(`  Quantity: ${orderResult.quantity}`);
        log(`  Price: ₹${orderResult.price}`);

        // Record trade
        riskManager.recordTrade({
          symbol: callSignal.symbol,
          quantity: 1,
          entryPrice: callSignal.estimatedPremium,
        });
      } else {
        log(`❌ Order failed: ${orderResult.error || orderResult.message}`);
      }
    } else {
      log("⏸️ No trade placed (validation failed)");
    }

    // ==========================================
    // PHASE 9: Save to Database
    // ==========================================
    log("\n💾 PHASE 9: Saving signals to database...");
    db.saveSignal("NIFTY", niftySignal);
    db.saveSignal("SENSEX", sensexSignal);

    if (callSignal.action === "BUY_CALL" && orderResult?.success) {
      db.saveSignal("CALL_OPTION", {
        direction: "BUY",
        confidence: callSignal.confidence / 100,
        score: callSignal.confidence / 100,
        reasoning: `${callSignal.symbol} | Premium: ₹${callSignal.estimatedPremium} | Order ID: ${orderResult.orderId}`,
      });
    }

    log("✅ Signals saved");

    // ==========================================
    // PHASE 10: Send Telegram Alerts
    // ==========================================
    if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
      log("\n📱 PHASE 10: Sending Telegram alerts...");

      // NIFTY Alert
      await telegramAlert.sendAlert(niftySignal, "NIFTY");
      log("✅ NIFTY alert sent");

      // SENSEX Alert
      await telegramAlert.sendAlert(sensexSignal, "SENSEX");
      log("✅ SENSEX alert sent");

      // Call Option Alert
      if (callSignal.action === "BUY_CALL") {
        const callAlert = CallOptionsSignal.formatCallOptionMessage(callSignal);
        await telegramAlert.sendAlert(callAlert);
        log("✅ Call option alert sent");
      }

      log("✅ Alerts sent");
    } else {
      log(
        "\n⚠️ Telegram not configured (set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID)",
      );
    }

    // ==========================================
    // FINAL SUMMARY
    // ==========================================
    log("\n" + "=".repeat(70));
    log("✅ PIPELINE COMPLETED SUCCESSFULLY");
    log("=".repeat(70));

    log("\n📊 EXECUTION SUMMARY:");
    log(`  News Articles: ${analyzedNews.length}`);
    log(`  Sentiment: ${sentimentSummary.score > 0 ? "BULLISH" : "BEARISH"}`);
    log(`  Technical Signal: ${technicalAnalysis.signal || "NEUTRAL"}`);
    log(
      `  Call Option Signal: ${callSignal.action === "BUY_CALL" ? "✅ BUY" : "⏸️ NO ACTION"}`,
    );
    log(
      `  Order Status: ${orderResult?.success ? "✅ PLACED" : "⏸️ NOT PLACED"}`,
    );
    log(`  Daily Loss: ₹${riskManager.todayLoss}/${riskManager.maxDailyLoss}`);
    log(`  Telegram Alerts: Sent`);

    // Show statistics
    log("\n📈 DATABASE STATISTICS:");
    const stats = await db.getStatistics();
    log(`  Total NIFTY signals: ${stats.nifty.total}`);
    log(`  NIFTY BUY signals: ${stats.nifty.buy}`);
    log(`  NIFTY SELL signals: ${stats.nifty.sell}`);
    log(`  NIFTY accuracy: ${(stats.nifty.accuracy * 100).toFixed(2)}%`);
    log(`\n  Total SENSEX signals: ${stats.sensex.total}`);
    log(`  SENSEX BUY signals: ${stats.sensex.buy}`);
    log(`  SENSEX SELL signals: ${stats.sensex.sell}`);
    log(`  SENSEX accuracy: ${(stats.sensex.accuracy * 100).toFixed(2)}%`);

    log("\n" + "=".repeat(70));
    log("🎉 Bot execution complete at " + new Date().toISOString());
    log("=".repeat(70));

    process.exit(0);
  } catch (error) {
    log(`\n❌ ERROR: ${error.message}`);
    log(error.stack);

    // Send error alert if Telegram is configured
    if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
      try {
        const telegramAlert = new TelegramAlert();
        await telegramAlert.sendAlert(
          `❌ BOT ERROR\n\nError: ${error.message}\nTime: ${new Date().toISOString()}`,
        );
      } catch (alertError) {
        log("Failed to send error alert: " + alertError.message);
      }
    }

    process.exit(1);
  }
}

// Run bot
if (require.main === module) {
  main();
}

module.exports = { log };
