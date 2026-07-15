// runFastNewsScan.js
// Entry point for the fast breaking-news scanner, meant to be run every 5
// minutes by its own GitHub Actions workflow, separate from the main pipeline.

require('dotenv').config();
const { scanForBreakingNews } = require('./fastNewsScanner');
const TelegramAlert = require('./telegramAlert');

function formatBreakingNewsMessage(signals) {
  const header = signals.length === 1
    ? '🚨 <b>BREAKING NEWS ALERT</b>'
    : `🚨 <b>BREAKING NEWS ALERT</b> (${signals.length} items)`;

  const items = signals.map((s) => {
    const emoji = s.direction === 'BULLISH' ? '🟢' : '🔴';
    return `${emoji} <b>${s.direction}</b> (score: ${s.score})\n${s.title}\n<i>Source: ${s.source}</i>\n${s.link}`;
  }).join('\n\n');

  return `
${header}

${items}

<i>🕐 ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST</i>

━━━━━━━━━━━━━━━━━━━━
⚠️ Automated headline detection, not investment advice. Reacts fast, but not
"before the market" - institutional systems have typically already priced
this in. Verify independently before acting. Not SEBI-registered advice.
  `.trim();
}

async function main() {
  console.log('🔍 Scanning for breaking news...');

  try {
    const signals = await scanForBreakingNews();

    if (signals.length === 0) {
      console.log('No strong new signals this scan.');
      return;
    }

    console.log(`Found ${signals.length} strong signal(s):`);
    signals.forEach((s) => console.log(`  ${s.direction} (${s.score}): ${s.title}`));

    if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
      const telegramAlert = new TelegramAlert();
      const message = formatBreakingNewsMessage(signals);
      await telegramAlert.sendAlert(message);
      console.log('✅ Breaking news alert sent to Telegram');
    } else {
      console.log('⚠️ Telegram not configured - signals detected but not sent');
    }
  } catch (error) {
    console.error('❌ Fast news scan failed:', error.message);
    process.exit(1);
  }
}

main();
