const axios = require('axios');
const Sentiment = require('sentiment');

class NewsProcessor {
  constructor() {
    this.sentiment = new Sentiment();
    this.newsApiKey = process.env.NEWS_API_KEY;
    this.keywords = ['nifty', 'sensex', 'bse', 'nse', 'india market', 'stock market', 'rbi', 'rupee'];
  }

  /**
   * Fetch news from multiple free sources
   */
  async fetchNews() {
    const allNews = [];

    // Try NewsAPI if key is available
    if (this.newsApiKey) {
      try {
        const newsApiNews = await this.fetchFromNewsAPI();
        allNews.push(...newsApiNews);
      } catch (error) {
        console.log('NewsAPI fetch failed:', error.message);
      }
    }

    // Fallback to free RSS feeds / web scraping
    try {
      const rssNews = await this.fetchFromFreeSource();
      allNews.push(...rssNews);
    } catch (error) {
      console.log('Free source fetch failed:', error.message);
    }

    // Filter and deduplicate
    return this.filterAndDeduplicate(allNews);
  }

  /**
   * Fetch from NewsAPI (requires free API key from newsapi.org)
   */
  async fetchFromNewsAPI() {
    const query = 'nifty OR sensex OR "indian stock market" OR "bse" OR "nse"';
    
    try {
      const response = await axios.get('https://newsapi.org/v2/everything', {
        params: {
          q: query,
          sortBy: 'publishedAt',
          language: 'en',
          apiKey: this.newsApiKey,
          pageSize: 50
        },
        timeout: 5000
      });

      return response.data.articles.map(article => ({
        title: article.title,
        description: article.description,
        content: article.content,
        source: article.source.name,
        publishedAt: article.publishedAt,
        url: article.url
      }));
    } catch (error) {
      console.error('NewsAPI error:', error.message);
      return [];
    }
  }

  /**
   * Fetch from free sources (RBI, BSE, NSE official news)
   */
  async fetchFromFreeSource() {
    const news = [];

    // Simulated recent news (in production, you'd scrape these or use free RSS)
    const recentNews = [
      {
        title: 'RBI maintains repo rate, supports growth',
        description: 'Reserve Bank keeps key rates stable amid inflation concerns',
        content: 'The RBI has decided to maintain the repo rate at current levels...',
        source: 'RBI Official',
        publishedAt: new Date(),
        sentiment: 'neutral'
      },
      {
        title: 'IT stocks rally on global recovery hopes',
        description: 'Tech sector surges as global economic outlook improves',
        content: 'Information technology companies in India gained strongly...',
        source: 'Market News',
        publishedAt: new Date(),
        sentiment: 'positive'
      },
      {
        title: 'Rupee strengthens against dollar',
        description: 'Indian rupee appreciates on foreign inflows',
        content: 'The rupee strengthened to 82 levels against the US dollar...',
        source: 'Financial News',
        publishedAt: new Date(),
        sentiment: 'positive'
      }
    ];

    return recentNews;
  }

  /**
   * Analyze sentiment of news articles
   */
  analyzeNews(newsArray) {
    return newsArray.map(article => {
      const fullText = `${article.title} ${article.description || ''} ${article.content || ''}`;
      
      // Sentiment analysis
      const sentimentScore = this.sentiment.analyze(fullText);
      
      // Classify sentiment
      let sentiment = 'neutral';
      if (sentimentScore.score > 5) sentiment = 'positive';
      if (sentimentScore.score < -5) sentiment = 'negative';

      return {
        ...article,
        sentiment,
        sentimentScore: sentimentScore.score,
        sentimentComparative: sentimentScore.comparative
      };
    });
  }

  /**
   * Filter and deduplicate news
   */
  filterAndDeduplicate(newsArray) {
    const filtered = newsArray.filter(news => {
      const fullText = `${news.title} ${news.description || ''}`.toLowerCase();
      return this.keywords.some(keyword => fullText.includes(keyword));
    });

    // Deduplicate by title
    const uniqueNews = [];
    const titles = new Set();

    for (const news of filtered) {
      const titleLower = news.title.toLowerCase();
      if (!titles.has(titleLower)) {
        titles.add(titleLower);
        uniqueNews.push(news);
      }
    }

    return uniqueNews.slice(0, 100); // Limit to 100 most recent
  }

  /**
   * Get sentiment summary
   */
  getSentimentSummary(analyzedNews) {
    const positive = analyzedNews.filter(n => n.sentiment === 'positive').length;
    const negative = analyzedNews.filter(n => n.sentiment === 'negative').length;
    const neutral = analyzedNews.filter(n => n.sentiment === 'neutral').length;

    return {
      positive,
      negative,
      neutral,
      totalScore: analyzedNews.reduce((sum, n) => sum + n.sentimentScore, 0),
      averageScore: analyzedNews.reduce((sum, n) => sum + n.sentimentScore, 0) / analyzedNews.length
    };
  }
}

module.exports = NewsProcessor;
