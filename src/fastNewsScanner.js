// fastNewsScanner.js
// Lightweight, frequent breaking-news check - separate from the main pipeline.
// Designed to run every 5 minutes (GitHub Actions' practical minimum) and
// fire an IMMEDIATE Telegram alert the moment a strongly bearish/bullish
// headline appears, without waiting for the next full 30-min analysis run.
//
// HONEST LIMITATION: this reacts faster than our main pipeline and faster
// than manually checking news, but it does NOT react "before the market" -
// institutional trading systems with direct data feeds have already priced
// in most news by the time it's published to a public RSS feed. Treat this
// as "fastest realistic reaction for a retail setup", not "ahead of the market".
//
// Uses free, CONFIRMED-WORKING RSS feeds (verified directly, not guessed):
// Economic Times (x2), Business Line, LiveMint Markets.
// (Financial Express and Moneycontrol feeds were tested and are dead - 410 Gone.)

const Parser = require('rss-parser');
const fs = require('fs');
const path = require('path');
const Sentiment = require('sentiment');
const { scoreFinanceTerms } = require('./financeSentimentScorer');

const parser = new Parser({ timeout: 8000 });
const sentiment = new Sentiment();

const FEEDS = [
  { name: 'Economic Times', url: 'https://economictimes.indiatimes.com/rssfeedsdefault.cms' },
  { name: 'Economic Times Markets', url: 'https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms' },
  { name: 'Business Line', url: 'https://www.thehindubusinessline.com/feeder/default.rss' },
  { name: 'LiveMint Markets', url: 'https://www.livemint.com/rss/markets' },
];

const SEEN_HEADLINES_PATH = path.join('data', 'seen-headlines.json');
const ALERT_THRESHOLD = 4; // combined score magnitude needed to trigger an immediate alert
const MARKET_KEYWORDS = ['nifty', 'sensex', 'bse', 'nse', 'india market', 'stock market', 'rbi', 'rupee', 'fii', 'sebi'];

/**
 * Load the set of previously-seen article links, pruning entries older than
 * 3 days so this file doesn't grow forever.
 */
function loadSeenHeadlines() {
  try {
    if (!fs.existsSync(SEEN_HEADLINES_PATH)) return {};
    const data = JSON.parse(fs.readFileSync(SEEN_HEADLINES_PATH, 'utf8'));
    const threeDaysAgo = Date.now() - 3 * 24 * 60 * 60 * 1000;
    const pruned = {};
    for (const [link, seenAt] of Object.entries(data)) {
      if (seenAt > threeDaysAgo) pruned[link] = seenAt;
    }
    return pruned;
  } catch (error) {
    return {};
  }
}

function saveSeenHeadlines(seenMap) {
  const dir = path.dirname(SEEN_HEADLINES_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(SEEN_HEADLINES_PATH, JSON.stringify(seenMap, null, 2));
}

/**
 * Fetch all feeds, find NEW headlines matching market keywords, score them,
 * and return any that cross the strong-alert threshold.
 * @returns {Promise<object[]>} newly-detected strong signals, each with
 *          { title, link, source, score, direction }
 */
async function scanForBreakingNews() {
  const seenHeadlines = loadSeenHeadlines();
  const isFirstRun = Object.keys(seenHeadlines).length === 0;
  const strongSignals = [];
  const newlySeen = { ...seenHeadlines };

  for (const feed of FEEDS) {
    try {
      const parsed = await parser.parseURL(feed.url);

      for (const item of parsed.items || []) {
        const link = item.link || item.guid || item.title;
        if (!link || seenHeadlines[link]) continue; // already processed before

        newlySeen[link] = Date.now();

        const title = (item.title || '').trim();

        // Filter out junk/non-article entries (nav items, search links, etc.)
        // - require a reasonably real-looking headline: at least 4 words
        const wordCount = title.split(/\s+/).filter(Boolean).length;
        if (wordCount < 4) continue;

        const fullText = `${title} ${item.contentSnippet || item.content || ''}`;
        const lowerText = fullText.toLowerCase();

        const isMarketRelevant = MARKET_KEYWORDS.some((kw) => lowerText.includes(kw));
        if (!isMarketRelevant) continue;

        const afinnResult = sentiment.analyze(fullText);
        const financeScore = scoreFinanceTerms(fullText);
        const combinedScore = afinnResult.score + financeScore;

        if (Math.abs(combinedScore) >= ALERT_THRESHOLD) {
          strongSignals.push({
            title: item.title,
            link: item.link,
            source: feed.name,
            score: combinedScore,
            direction: combinedScore > 0 ? 'BULLISH' : 'BEARISH',
            publishedAt: item.pubDate,
          });
        }
      }
    } catch (error) {
      console.log(`⚠️ Failed to fetch ${feed.name}: ${error.message}`);
    }
  }

  saveSeenHeadlines(newlySeen);

  // First run: just seed the seen-list, don't flood with everything currently
  // in the feeds - only alert on genuinely NEW headlines from the next run on.
  if (isFirstRun) {
    console.log(`First run: seeded ${Object.keys(newlySeen).length} headlines as seen, no alerts sent this run.`);
    return [];
  }

  return strongSignals;
}

module.exports = { scanForBreakingNews };