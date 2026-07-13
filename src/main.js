#!/usr/bin/env node

const NewsProcessor = require("./newsProcessor");
const SignalGenerator = require("./signalGenerator");
const Database = require("./database");
const TelegramAlert = require("./telegramAlert");
const TechnicalIndicators = require("./technicalIndicators");
const CallOptionsSignal = require("./callOptionsSignal");
const RiskManager = require("./riskManager");
const GrowwTrader = require("./growwTrader");
const { getMultiTimeframeCloses } = require("./priceDataFetcher");
const { getRealOptionPremium } = require("./optionChainFetcher");
const { analyzeStockBatch } = require("./stockOptionsAnalyzer");
const { getStockBatch } = require("./fnoStockList");
const fs = require("fs");
const path = require("path");

require("dotenv").config();

const LOG_FILE = "logs/bot.log";

function log(message) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}`;
  console.log(logMessage);

  if (!fs.existsSync("logs")) {
    fs.mkdirSync("logs", { recursive: true });
  }

  fs.appendFileSync(LOG_FILE, logMessage + "\n");
}

/**
 * Convert our internal expiry format ("14JUL26") to NSE's expected format
 * ("14-Jul-2026") for option chain lookups.
 */
function toNseExpiryFormat(internalExpiry) {
  const day = internalExpiry.slice(0, 2);
  const monAbbr = internalExpiry.slice(2, 5);
  const monProper = monAbbr.charAt(0) + monAbbr.slice(1).toLowerCase();
  const year = "20" + internalExpiry.slice(5, 7);
  return `${day}-${monProper}-${year}`;
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

    const positive = analyzedNews.filter((a) => a.sentiment === "positive").length;
    const negative = analyzedNews.filter((a) => a.sentiment === "negative").length;
    const neutral = analyzedNews.filter((a) => a.sentiment === "neutral").length;

    const sentimentSummary = {
      score: analyzedNews.length > 0 ? (positive - negative) / analyzedNews.length : 0,
      confidence: analyzedNews.length > 0 ? (Math.abs(positive - negative) / analyzedNews.length) * 100 : 0,
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
    // PHASE 5: Technical Analysis (real data + multi-timeframe confirmation)
    // ==========================================
    log("\n📈 PHASE 5: Technical Analysis...");

    let mockPrices;
    let technicalAnalysis;
    try {
      const { dailyCloses, weeklyCloses } = await getMultiTimeframeCloses("NIFTY 50", 90, 450);
      mockPrices = dailyCloses;
      log(`✅ Fetched ${dailyCloses.length} daily + ${weeklyCloses.length} weekly NIFTY closes`);

      const dailyAnalysis = TechnicalIndicators.analyzeTechnicals(mockPrices);
      const weeklyAnalysis = TechnicalIndicators.analyzeWeeklyTrend(weeklyCloses);
      technicalAnalysis = TechnicalIndicators.applyMultiTimeframeConfirmation(dailyAnalysis, weeklyAnalysis);

      if (technicalAnalysis.multiTimeframe?.applied) {
        log(`  📅 Weekly trend: ${technicalAnalysis.multiTimeframe.weeklySignal} (agreement: ${technicalAnalysis.multiTimeframe.agreed})`);
      }
    } catch (error) {
      log(`⚠️ Real price fetch failed (${error.message}), falling back to insufficient-data state`);
      mockPrices = [];
      technicalAnalysis = { status: "INSUFFICIENT_DATA" };
    }

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
    // PHASE 6: Call/Put Option Signal (with real premium lookup)
    // ==========================================
    log("\n📞 PHASE 6: Option Signal Generation...");

    const currentNiftyPrice = mockPrices.length > 0 ? mockPrices[mockPrices.length - 1] : null;

    const callSignal =
      technicalAnalysis.status === "INSUFFICIENT_DATA" || currentNiftyPrice === null
        ? { action: "NO_ACTION", reason: "Insufficient technical/price data" }
        : CallOptionsSignal.generateOptionSignal(technicalAnalysis, sentimentSummary, currentNiftyPrice);

    if (callSignal.action === "BUY_CALL" || callSignal.action === "BUY_PUT") {
      // Try to replace the theoretical Black-Scholes premium with the REAL live
      // market premium from NSE's free option chain.
      try {
        const optionType = callSignal.action === "BUY_PUT" ? "PE" : "CE";
        const nseExpiryFormat = toNseExpiryFormat(callSignal.expiryDate);

        const realData = await getRealOptionPremium("NIFTY", callSignal.strikePrice, optionType, nseExpiryFormat);

        if (realData) {
          const realPremium = realData.lastPrice;
          callSignal.estimatedPremium = realPremium;
          callSignal.targetPrice = parseFloat((realPremium * 1.15).toFixed(2));
          callSignal.stopLoss = parseFloat((realPremium * 0.9).toFixed(2));
          callSignal.impliedVolatility = realData.impliedVolatility;
          callSignal.openInterest = realData.openInterest;
          callSignal.premiumSource = "LIVE_MARKET";
          log(`  💰 Using REAL market premium: ₹${realPremium}`);
        } else {
          callSignal.premiumSource = "ESTIMATED";
          log(`  ⚠️ Strike ${callSignal.strikePrice}${optionType} not found in real chain, using theoretical estimate`);
        }
      } catch (error) {
        callSignal.premiumSource = "ESTIMATED";
        log(`  ⚠️ Real premium lookup failed (${error.message}), using theoretical estimate`);
      }

      const typeLabel = callSignal.action === "BUY_PUT" ? "🔻 PUT OPTION BUY SIGNAL" : "✅ CALL OPTION BUY SIGNAL";
      log(`\n${typeLabel}:`);
      log(`  Symbol: ${callSignal.symbol}`);
      log(`  Strike: ₹${callSignal.strikePrice}`);
      log(`  Expiry: ${callSignal.expiryDate}`);
      log(`  Premium: ₹${callSignal.estimatedPremium} (${callSignal.premiumSource})`);
      log(`  Target: ₹${callSignal.targetPrice}`);
      log(`  Stop Loss: ₹${callSignal.stopLoss}`);
      log(`  Confidence: ${callSignal.confidence}%`);
      log(`\n  Reasons:`);
      callSignal.reasons.forEach((r) => {
        log(`    • ${r}`);
      });
    } else {
      log(`\n⏸️ No option signal: ${callSignal.reason}`);
    }

    // ==========================================
    // PHASE 6B: F&O Stock Options Scan
    // Rotates through the F&O stock universe in batches (based on current
    // hour) so the full list gets covered across the day's runs, rather than
    // hammering NSE with all ~45+ stocks every single run.
    // ==========================================
    log("\n📈 PHASE 6B: Scanning F&O stocks for option signals...");

    let stockSignals = [];
    try {
      const nowIST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
      const hourIST = nowIST.getHours();
      const stockBatch = getStockBatch(10, hourIST);
      log(`  Scanning batch: ${stockBatch.map((s) => s.symbol).join(', ')}`);

      const allStockResults = await analyzeStockBatch(stockBatch, analyzedNews, 500);
      stockSignals = allStockResults.filter((r) => r.action === "BUY_CALL" || r.action === "BUY_PUT");

      log(`  ✅ Scanned ${allStockResults.length} stocks, found ${stockSignals.length} actionable signal(s)`);
      stockSignals.forEach((s) => {
        log(`    ${s.action === "BUY_PUT" ? "🔻" : "📈"} ${s.symbol}: ${s.action} (strike ₹${s.strikePrice}, premium ₹${s.estimatedPremium}, ${s.premiumSource})`);
      });
    } catch (error) {
      log(`  ⚠️ Stock scan failed: ${error.message}`);
    }

    // ==========================================
    // PHASE 7: Risk Management
    // ==========================================
    log("\n⚠️ PHASE 7: Risk Management Validation...");
    log("\n" + riskManager.formatRiskParameters());


    let tradeApproved = false;
    const isActionableSignal = callSignal.action === "BUY_CALL" || callSignal.action === "BUY_PUT";

    if (isActionableSignal) {
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
    await db.saveSignal("NIFTY", niftySignal);
    await db.saveSignal("SENSEX", sensexSignal);

    if (isActionableSignal && orderResult?.success) {
      await db.saveSignal("CALL_OPTION", {
        direction: callSignal.action === "BUY_PUT" ? "SELL" : "BUY",
        confidence: callSignal.confidence / 100,
        score: callSignal.confidence / 100,
        reasoning: `${callSignal.symbol} | Premium: ₹${callSignal.estimatedPremium} | Order ID: ${orderResult.orderId}`,
      });
    }

    log("✅ Signals saved");

    // ==========================================
    // PHASE 10: Send Telegram Alerts
    // ONLY sends when there's an actual actionable CALL/PUT signal (NIFTY or
    // stock) - routine HOLD/NO_ACTION runs are logged locally but don't spam
    // the channel.
    // ==========================================
    const hasAnyActionableSignal = isActionableSignal || stockSignals.length > 0;

    if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
      if (hasAnyActionableSignal) {
        log("\n📱 PHASE 10: Sending Telegram alert(s) (actionable signal(s) found)...");

        if (isActionableSignal) {
          const callAlert = CallOptionsSignal.formatCallOptionMessage(callSignal);
          await telegramAlert.sendAlert(callAlert);
          log("✅ NIFTY option alert sent");
        }

        for (const stockSignal of stockSignals) {
          const stockAlert = CallOptionsSignal.formatCallOptionMessage(stockSignal);
          await telegramAlert.sendAlert(stockAlert);
          log(`✅ Stock option alert sent: ${stockSignal.symbol}`);
        }
      } else {
        log("\n📱 PHASE 10: No actionable signal this run - skipping Telegram (avoids channel spam)");
      }
    } else {
      log("\n⚠️ Telegram not configured (set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID)");
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
    log(`  Option Signal: ${isActionableSignal ? (callSignal.action === "BUY_PUT" ? "🔻 PUT" : "✅ CALL") : "⏸️ NO ACTION"}`);
    log(`  Stock Signals Found: ${stockSignals.length}`);
    log(`  Order Status: ${orderResult?.success ? "✅ PLACED" : "⏸️ NOT PLACED"}`);
    log(`  Daily Loss: ₹${riskManager.todayLoss}/${riskManager.maxDailyLoss}`);
    log(`  Telegram Alerts: Sent`);

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

if (require.main === module) {
  main();
}

module.exports = { log };