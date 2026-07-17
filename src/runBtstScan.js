// runBtstScan.js
// Runs once daily, near market close (~3:05-3:15 PM IST), and sends BTST
// candidates based on real NSE OI Spurts data - specifically Long Buildup
// (fresh options BUYING), split by option type - Call = bullish, Put = bearish.

require('dotenv').config();
const { getBtstCandidates } = require('./oiSpurtsAnalyzer');
const TelegramAlert = require('./telegramAlert');

function formatContract(c) {
  return `<b>${c.symbol}</b> ${c.strikePrice} ${c.optionType} (exp ${c.expiryDate})\n` +
    `  Premium: ₹${c.ltp} | OI change: ${c.pChangeInOI > 0 ? '+' : ''}${c.pChangeInOI.toFixed(1)}% | Price change: ${c.pChange > 0 ? '+' : ''}${c.pChange}%\n` +
    `  Volume: ${c.volume.toLocaleString('en-IN')} | Spot: ₹${c.underlyingValue}`;
}

function formatBtstMessage(candidates) {
  const { bullish, bearish } = candidates;

  let message = `📊 <b>BTST CANDIDATES</b> (${new Date().toLocaleDateString('en-IN')})\n\n`;
  message += `Based on real NSE Open Interest data - fresh options buying (Long Buildup), split by Call/Put.\n\n`;

  if (bullish.length > 0) {
    message += `🟢 <b>FRESH CALL BUYING (Long Buildup)</b>\n\n`;
    message += bullish.slice(0, 8).map(formatContract).join('\n\n');
    message += '\n\n';
  } else {
    message += `🟢 No significant fresh call-buying candidates today\n\n`;
  }

  if (bearish.length > 0) {
    message += `🔴 <b>FRESH PUT BUYING (Long Buildup)</b>\n\n`;
    message += bearish.slice(0, 8).map(formatContract).join('\n\n');
  } else {
    message += `🔴 No significant fresh put-buying candidates today`;
  }

  message += `\n\n<i>🕐 ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST</i>`;
  message += `\n\n━━━━━━━━━━━━━━━━━━━━`;
  message += `\n⚠️ Based on real derivatives OI data, but this is NOT investment advice. `;
  message += `Long Buildup indicates fresh buying activity, not a guarantee of continued `;
  message += `direction. BTST carries overnight gap risk. Not SEBI-registered advice - verify `;
  message += `independently and manage risk before acting.`;

  return message.trim();
}

async function main() {
  console.log('📊 Scanning for BTST candidates (OI buildup analysis)...');

  try {
    const candidates = await getBtstCandidates();

    console.log(`Found ${candidates.bullish.length} fresh call-buying, ${candidates.bearish.length} fresh put-buying candidates`);
    candidates.bullish.forEach((c) => {
      const typeCode = c.optionType === 'Call' ? 'CE' : 'PE';
      const sign = c.pChangeInOI > 0 ? '+' : '';
      console.log(`  🟢 ${c.symbol} ${c.strikePrice} ${typeCode} - OI ${sign}${c.pChangeInOI.toFixed(1)}%`);
    });
    candidates.bearish.forEach((c) => {
      const typeCode = c.optionType === 'Call' ? 'CE' : 'PE';
      const sign = c.pChangeInOI > 0 ? '+' : '';
      console.log(`  🔴 ${c.symbol} ${c.strikePrice} ${typeCode} - OI ${sign}${c.pChangeInOI.toFixed(1)}%`);
    });

    if (candidates.bullish.length === 0 && candidates.bearish.length === 0) {
      console.log('No significant BTST candidates today - skipping alert');
      return;
    }

    if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
      console.log('⚠️ Telegram not configured - candidates found but not sent');
      return;
    }

    const telegramAlert = new TelegramAlert();
    const message = formatBtstMessage(candidates);
    const result = await telegramAlert.sendAlert(message);

    // Defensive check: older versions of telegramAlert.js don't return
    // anything (sendAlert logs success/failure internally but returns
    // undefined). Handle both cases so this doesn't crash either way.
    if (!result || result.success) {
      console.log('✅ BTST candidates alert sent to Telegram');
    } else {
      console.error(`❌ Failed to send BTST alert: ${result.error}`);
      process.exitCode = 1;
    }
  } catch (error) {
    console.error('❌ BTST scan failed:', error.message);
    process.exit(1);
  }
}

main();