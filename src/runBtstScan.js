// runBtstScan.js
// Runs once daily, near market close (~3:05-3:15 PM IST), and sends BTST
// candidates from the multi-indicator composite scorer (btstCompositeScorer.js):
// stock-level OI buildup (direction-corrected via price %change) confirmed
// by at least one of {bulk/block deals, most-active ranking, 52-week band
// hit}, scaled by macro context (breadth, FII/DII, VIX). Every candidate is
// logged to the database so accuracy can be measured over time.

require('dotenv').config();
const { getCompositeBtstCandidates } = require('./btstCompositeScorer');
const Database = require('./database');
const TelegramAlert = require('./telegramAlert');

function formatMacroBanner(macro) {
  const lines = ['📐 <b>Market Context</b>'];

  if (macro.breadth) {
    const { advances, declines, unchanged } = macro.breadth;
    const breadthLabel = macro.breadth.breadthBias > 0.05 ? '🟢 Positive' : macro.breadth.breadthBias < -0.05 ? '🔴 Negative' : '🟡 Flat';
    lines.push(`Breadth: ${breadthLabel} (Adv ${advances} / Dec ${declines} / Unch ${unchanged})`);
  }
  if (macro.fiiDii) {
    const { fiiNetCr, diiNetCr } = macro.fiiDii;
    lines.push(`FII: ${fiiNetCr >= 0 ? '+' : ''}₹${fiiNetCr.toFixed(0)}cr | DII: ${diiNetCr >= 0 ? '+' : ''}₹${diiNetCr.toFixed(0)}cr`);
  }
  if (macro.vix) {
    lines.push(`India VIX: ${macro.vix.level} (${macro.vix.changePercent >= 0 ? '+' : ''}${macro.vix.changePercent}%)`);
  }
  if (macro.niftyPcr && macro.niftyPcr.pcr) {
    lines.push(`NIFTY PCR: ${macro.niftyPcr.pcr.toFixed(2)}`);
  }

  return lines.join('\n');
}

function formatComponentBadges(components) {
  const badges = [];
  if (components.oiBuildup.present) badges.push('OI✓');
  if (components.bulkBlockDeals.present) badges.push(components.bulkBlockDeals.agrees ? 'Deals✓' : 'Deals✗');
  if (components.mostActive.present) badges.push(components.mostActive.agrees ? 'Active✓' : 'Active✗');
  if (components.bandHitter.present) badges.push(components.bandHitter.agrees ? '52wk✓' : '52wk✗');
  return badges.join(' ');
}

const CAP_TIER_EMOJI = { Large: '🏢', Mid: '🏬', Small: '🏠', Unknown: '❔' };

function formatCandidate(c) {
  const tierLabel = `${CAP_TIER_EMOJI[c.marketCapTier] || ''} ${c.marketCapTier || 'Unknown'}-Cap`;
  const lines = [`<b>${c.symbol}</b> (${tierLabel}) — confidence ${(c.confidence * 100).toFixed(0)}% (${c.agreeingCount} sources agree: ${formatComponentBadges(c.components)})`];

  if (c.contract) {
    const typeCode = c.contract.optionType === 'Call' ? 'CE' : 'PE';
    lines.push(
      `  ${c.contract.strikePrice} ${typeCode} (exp ${c.contract.expiryDate}) — Premium ₹${c.contract.premium} [${c.contract.source === 'atm-fallback' ? 'ATM est.' : 'live OI match'}]`
    );
  } else {
    lines.push('  ⚠️ No tradeable option contract found (may not be F&O-eligible)');
  }

  lines.push(`  OI: ${c.components.oiBuildup.raw.avgInOI > 0 ? '+' : ''}${c.components.oiBuildup.raw.avgInOI.toFixed(1)}% | Price: ${c.components.oiBuildup.raw.pchange >= 0 ? '+' : ''}${c.components.oiBuildup.raw.pchange.toFixed(2)}%`);

  return lines.join('\n');
}

function formatTierMix(bullish, bearish) {
  const counts = { Large: 0, Mid: 0, Small: 0, Unknown: 0 };
  for (const c of [...bullish, ...bearish]) counts[c.marketCapTier] = (counts[c.marketCapTier] || 0) + 1;
  return `Tier mix: ${counts.Large} Large / ${counts.Mid} Mid / ${counts.Small} Small${counts.Unknown ? ` / ${counts.Unknown} Unknown` : ''}`;
}

function formatBtstMessage(result) {
  const { bullish, bearish, macro } = result;

  let message = `📊 <b>BTST CANDIDATES</b> (${new Date().toLocaleDateString('en-IN')})\n\n`;
  message += `Multi-indicator composite: stock-level OI buildup + confirming signal (bulk/block deals, most-active ranking, or 52-week band hit).\n\n`;
  message += formatMacroBanner(macro) + '\n';
  message += formatTierMix(bullish, bearish) + '\n\n';

  if (bullish.length > 0) {
    message += `🟢 <b>BULLISH CANDIDATES</b>\n\n`;
    message += bullish.map(formatCandidate).join('\n\n');
    message += '\n\n';
  } else {
    message += `🟢 No bullish candidates met the confluence bar today\n\n`;
  }

  if (bearish.length > 0) {
    message += `🔴 <b>BEARISH CANDIDATES</b>\n\n`;
    message += bearish.map(formatCandidate).join('\n\n');
  } else {
    message += `🔴 No bearish candidates met the confluence bar today`;
  }

  message += `\n\n<i>🕐 ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST</i>`;
  message += `\n\n━━━━━━━━━━━━━━━━━━━━`;
  message += `\n⚠️ Based on real NSE derivatives/deals/breadth data, but this is NOT investment advice. `;
  message += `Confluence across multiple indicators reduces but does not eliminate false signals. BTST carries `;
  message += `overnight gap risk. Not SEBI-registered advice - verify independently and manage risk before acting.`;

  return message.trim();
}

async function main() {
  console.log('📊 Scanning for BTST candidates (multi-indicator composite)...');

  const db = new Database();

  try {
    const result = await getCompositeBtstCandidates();

    console.log(`Found ${result.bullish.length} bullish, ${result.bearish.length} bearish candidates`);
    console.log('Macro:', JSON.stringify(result.macro));
    [...result.bullish, ...result.bearish].forEach((c) => {
      console.log(`  ${c.direction === 'bullish' ? '🟢' : '🔴'} ${c.symbol} [${c.marketCapTier}-Cap] - confidence ${(c.confidence * 100).toFixed(0)}% (${c.agreeingCount} sources)`);
    });

    await db.initialize();
    await Promise.all(
      [...result.bullish, ...result.bearish].map((c) => db.saveBtstCandidate(c, result.macro))
    );
    console.log(`✅ Logged ${result.bullish.length + result.bearish.length} candidates to database`);

    if (result.bullish.length === 0 && result.bearish.length === 0) {
      console.log('No significant BTST candidates today - skipping alert');
      return;
    }

    if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
      console.log('⚠️ Telegram not configured - candidates found but not sent');
      return;
    }

    const telegramAlert = new TelegramAlert();
    const message = formatBtstMessage(result);
    const sendResult = await telegramAlert.sendAlert(message);

    if (!sendResult || sendResult.success) {
      console.log('✅ BTST candidates alert sent to Telegram');
    } else {
      console.error(`❌ Failed to send BTST alert: ${sendResult.error}`);
      process.exitCode = 1;
    }
  } catch (error) {
    console.error('❌ BTST scan failed:', error.message);
    process.exitCode = 1;
  } finally {
    await db.close();
  }
}

main();
