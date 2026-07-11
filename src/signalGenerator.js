class SignalGenerator {
  constructor() {
    this.weights = {
      sentiment: 0.4,      // 40% weight on sentiment
      momentum: 0.3,       // 30% weight on momentum
      volume: 0.2,         // 20% weight on volume signals
      technicals: 0.1      // 10% weight on technical indicators
    };
  }

  /**
   * Generate trading signal based on analyzed news
   */
  generateSignal(analyzedNews, index = 'NIFTY') {
    if (!analyzedNews || analyzedNews.length === 0) {
      return this.neutralSignal(index);
    }

    // Get sentiment scores
    const sentimentScore = this.calculateSentimentScore(analyzedNews);
    
    // Get momentum score (based on recent news direction)
    const momentumScore = this.calculateMomentumScore(analyzedNews);
    
    // Calculate final score
    const finalScore = (
      sentimentScore * this.weights.sentiment +
      momentumScore * this.weights.momentum
    );

    // Determine direction
    const direction = finalScore > 0.2 ? 'BUY' : finalScore < -0.2 ? 'SELL' : 'HOLD';
    const confidence = Math.min(Math.abs(finalScore), 1);

    // Generate reasoning
    const reasoning = this.generateReasoning(analyzedNews, direction, finalScore);

    return {
      index,
      direction,
      score: finalScore,
      confidence,
      reasoning,
      timestamp: new Date(),
      sentimentScore,
      momentumScore,
      newsCount: analyzedNews.length,
      positiveNews: analyzedNews.filter(n => n.sentiment === 'positive').length,
      negativeNews: analyzedNews.filter(n => n.sentiment === 'negative').length
    };
  }

  /**
   * Calculate sentiment score (-1 to 1)
   */
  calculateSentimentScore(newsArray) {
    if (newsArray.length === 0) return 0;

    const weights = {
      positive: 1,
      neutral: 0,
      negative: -1
    };

    let totalScore = 0;
    let maxScore = 0;

    for (const news of newsArray) {
      const weight = news.sentiment === 'positive' ? 1 : 
                    news.sentiment === 'negative' ? 1 : 0.5;
      
      totalScore += weights[news.sentiment] * weight;
      maxScore += weight;
    }

    return maxScore > 0 ? totalScore / maxScore : 0;
  }

  /**
   * Calculate momentum score based on recent news trends
   */
  calculateMomentumScore(newsArray) {
    if (newsArray.length === 0) return 0;

    // More recent news should have higher weight
    const recentNews = newsArray.slice(0, Math.min(10, newsArray.length));
    
    let score = 0;
    let totalWeight = 0;

    recentNews.forEach((news, index) => {
      const weight = (recentNews.length - index) / recentNews.length;
      
      if (news.sentiment === 'positive') score += weight;
      if (news.sentiment === 'negative') score -= weight;
      
      totalWeight += weight;
    });

    return totalWeight > 0 ? score / totalWeight : 0;
  }

  /**
   * Generate human-readable reasoning for the signal
   */
  generateReasoning(newsArray, direction, score) {
    const positive = newsArray.filter(n => n.sentiment === 'positive').length;
    const negative = newsArray.filter(n => n.sentiment === 'negative').length;
    const neutral = newsArray.filter(n => n.sentiment === 'neutral').length;

    let reasoning = '';

    if (direction === 'BUY') {
      reasoning = `Positive sentiment detected. ${positive} bullish news vs ${negative} bearish news. `;
      if (score > 0.7) reasoning += 'Strong buy signal.';
      else reasoning += 'Moderate buy signal.';
    } else if (direction === 'SELL') {
      reasoning = `Negative sentiment detected. ${negative} bearish news vs ${positive} bullish news. `;
      if (score < -0.7) reasoning += 'Strong sell signal.';
      else reasoning += 'Moderate sell signal.';
    } else {
      reasoning = `Mixed signals detected. ${positive} bullish vs ${negative} bearish vs ${neutral} neutral news. Market uncertain.`;
    }

    return reasoning;
  }

  /**
   * Return neutral signal
   */
  neutralSignal(index) {
    return {
      index,
      direction: 'HOLD',
      score: 0,
      confidence: 0,
      reasoning: 'Insufficient data for signal generation',
      timestamp: new Date(),
      sentimentScore: 0,
      momentumScore: 0,
      newsCount: 0,
      positiveNews: 0,
      negativeNews: 0
    };
  }

  /**
   * Calculate win rate of past signals
   */
  calculateWinRate(signals) {
    if (signals.length === 0) return 0;

    const wins = signals.filter(s => s.actualResult === s.direction).length;
    return wins / signals.length;
  }
}

module.exports = SignalGenerator;
