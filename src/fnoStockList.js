// fnoStockList.js
// A starter universe of major, liquid F&O-eligible NSE stocks.
//
// NOTE: NSE's actual F&O-eligible list has ~180-200 stocks and changes
// periodically (SEBI/exchange review adds/removes names based on liquidity
// criteria a few times a year). This list covers most of the large, liquid
// names that are very unlikely to be removed, but is NOT a complete or
// guaranteed-current list. Verify/expand against NSE's official list
// (published on their website) before relying on this for full coverage.

const FNO_STOCKS = [
  { symbol: 'RELIANCE', companyName: 'Reliance Industries' },
  { symbol: 'TCS', companyName: 'Tata Consultancy Services' },
  { symbol: 'INFY', companyName: 'Infosys' },
  { symbol: 'HDFCBANK', companyName: 'HDFC Bank' },
  { symbol: 'ICICIBANK', companyName: 'ICICI Bank' },
  { symbol: 'SBIN', companyName: 'State Bank of India' },
  { symbol: 'AXISBANK', companyName: 'Axis Bank' },
  { symbol: 'KOTAKBANK', companyName: 'Kotak Mahindra Bank' },
  { symbol: 'BAJFINANCE', companyName: 'Bajaj Finance' },
  { symbol: 'BHARTIARTL', companyName: 'Bharti Airtel' },
  { symbol: 'ITC', companyName: 'ITC' },
  { symbol: 'HINDUNILVR', companyName: 'Hindustan Unilever' },
  { symbol: 'LT', companyName: 'Larsen & Toubro' },
  { symbol: 'MARUTI', companyName: 'Maruti Suzuki' },
  { symbol: 'TATASTEEL', companyName: 'Tata Steel' },
  { symbol: 'TATAMOTORS', companyName: 'Tata Motors' },
  { symbol: 'WIPRO', companyName: 'Wipro' },
  { symbol: 'HCLTECH', companyName: 'HCL Technologies' },
  { symbol: 'SUNPHARMA', companyName: 'Sun Pharmaceutical' },
  { symbol: 'ONGC', companyName: 'Oil and Natural Gas Corporation' },
  { symbol: 'NTPC', companyName: 'NTPC' },
  { symbol: 'POWERGRID', companyName: 'Power Grid Corporation' },
  { symbol: 'ULTRACEMCO', companyName: 'UltraTech Cement' },
  { symbol: 'ASIANPAINT', companyName: 'Asian Paints' },
  { symbol: 'TITAN', companyName: 'Titan Company' },
  { symbol: 'BAJAJFINSV', companyName: 'Bajaj Finserv' },
  { symbol: 'ADANIENT', companyName: 'Adani Enterprises' },
  { symbol: 'ADANIPORTS', companyName: 'Adani Ports' },
  { symbol: 'COALINDIA', companyName: 'Coal India' },
  { symbol: 'DRREDDY', companyName: "Dr. Reddy's Laboratories" },
  { symbol: 'EICHERMOT', companyName: 'Eicher Motors' },
  { symbol: 'GRASIM', companyName: 'Grasim Industries' },
  { symbol: 'HEROMOTOCO', companyName: 'Hero MotoCorp' },
  { symbol: 'HINDALCO', companyName: 'Hindalco Industries' },
  { symbol: 'INDUSINDBK', companyName: 'IndusInd Bank' },
  { symbol: 'JSWSTEEL', companyName: 'JSW Steel' },
  { symbol: 'NESTLEIND', companyName: 'Nestle India' },
  { symbol: 'SBILIFE', companyName: 'SBI Life Insurance' },
  { symbol: 'TATACONSUM', companyName: 'Tata Consumer Products' },
  { symbol: 'TECHM', companyName: 'Tech Mahindra' },
  { symbol: 'UPL', companyName: 'UPL Limited' },
  { symbol: 'BPCL', companyName: 'Bharat Petroleum' },
  { symbol: 'DIVISLAB', companyName: 'Divis Laboratories' },
  { symbol: 'BRITANNIA', companyName: 'Britannia Industries' },
  { symbol: 'CIPLA', companyName: 'Cipla' },
  { symbol: 'APOLLOHOSP', companyName: 'Apollo Hospitals' },
];

/**
 * Get a slice of the F&O universe for a single run - avoids trying to
 * process all ~45+ stocks (or the real ~180-200) in one run, which risks
 * NSE rate-limiting and GitHub Actions timeouts.
 * @param {number} batchSize - how many stocks to return this run
 * @param {number} batchIndex - which batch (0-indexed) - rotate this each run
 *                              (e.g. via hour-of-day) to cycle through the full list
 * @returns {object[]} slice of FNO_STOCKS
 */
function getStockBatch(batchSize = 10, batchIndex = 0) {
  const start = (batchIndex * batchSize) % FNO_STOCKS.length;
  const end = start + batchSize;
  if (end <= FNO_STOCKS.length) {
    return FNO_STOCKS.slice(start, end);
  }
  // wrap around
  return [...FNO_STOCKS.slice(start), ...FNO_STOCKS.slice(0, end - FNO_STOCKS.length)];
}

module.exports = { FNO_STOCKS, getStockBatch };
