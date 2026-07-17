const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const fs = require("fs");

class Database {
  constructor() {
    // Ensure data directory exists
    if (!fs.existsSync("data")) {
      fs.mkdirSync("data", { recursive: true });
    }

    this.dbPath = path.join("data", "signals.db");
    this.db = null;
  }

  /**
   * Initialize database and create tables
   */
  initialize() {
    return new Promise((resolve, reject) => {
      this.db = new sqlite3.Database(this.dbPath, (err) => {
        if (err) {
          reject(err);
          return;
        }

        // Create signals table
        this.db.run(
          `
          CREATE TABLE IF NOT EXISTS signals (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            index_name TEXT NOT NULL,
            direction TEXT NOT NULL,
            score REAL NOT NULL,
            confidence REAL NOT NULL,
            sentiment_score REAL,
            momentum_score REAL,
            news_count INTEGER,
            positive_news INTEGER,
            negative_news INTEGER,
            reasoning TEXT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            actual_result TEXT,
            accuracy_verified BOOLEAN DEFAULT 0
          )
        `,
          (err) => {
            if (err) {
              reject(err);
              return;
            }

            // Create index for faster queries
            this.db.run(
              `
            CREATE INDEX IF NOT EXISTS idx_timestamp ON signals(timestamp)
          `,
              (err) => {
                if (err) {
                  reject(err);
                  return;
                }

                // Create BTST composite-candidate table
                this.db.run(
                  `
                CREATE TABLE IF NOT EXISTS btst_candidates (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  symbol TEXT NOT NULL,
                  direction TEXT NOT NULL,
                  composite_score REAL NOT NULL,
                  confidence REAL NOT NULL,
                  agreeing_count INTEGER NOT NULL,
                  macro_multiplier REAL,
                  market_cap_tier TEXT,
                  components_json TEXT,
                  macro_json TEXT,
                  option_type TEXT,
                  strike_price REAL,
                  expiry_date TEXT,
                  premium REAL,
                  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                  actual_result TEXT,
                  accuracy_verified BOOLEAN DEFAULT 0
                )
              `,
                  (err) => {
                    if (err) {
                      reject(err);
                      return;
                    }

                    // CREATE TABLE IF NOT EXISTS only applies on first creation - it
                    // does NOT retroactively add columns to a table that already
                    // exists from before a schema change (e.g. market_cap_tier was
                    // added after btst_candidates already existed on disk). Without
                    // this, every future schema addition would silently break the
                    // scheduled workflow the first time it runs against an existing
                    // committed data/signals.db.
                    this.migrateBtstCandidatesTable((err) => {
                      if (err) {
                        reject(err);
                        return;
                      }

                      this.db.run(
                        `CREATE INDEX IF NOT EXISTS idx_btst_timestamp ON btst_candidates(timestamp)`,
                        (err) => {
                          if (err) {
                            reject(err);
                            return;
                          }
                          resolve();
                        },
                      );
                    });
                  },
                );
              },
            );
          },
        );
      });
    });
  }

  /**
   * Save signal to database
   */
  saveSignal(indexName, signal) {
    return new Promise((resolve, reject) => {
      const sql = `
        INSERT INTO signals (
          index_name, direction, score, confidence,
          sentiment_score, momentum_score, news_count,
          positive_news, negative_news, reasoning
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      this.db.run(
        sql,
        [
          indexName,
          signal.direction,
          signal.score,
          signal.confidence,
          signal.sentimentScore,
          signal.momentumScore,
          signal.newsCount,
          signal.positiveNews,
          signal.negativeNews,
          signal.reasoning,
        ],
        (err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        },
      );
    });
  }

  /**
   * Get signals for specific index
   */
  getSignals(indexName, limit = 100) {
    return new Promise((resolve, reject) => {
      const sql = `
        SELECT * FROM signals
        WHERE index_name = ?
        ORDER BY timestamp DESC
        LIMIT ?
      `;

      this.db.all(sql, [indexName, limit], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows || []);
        }
      });
    });
  }

  /**
   * Get latest signal for index
   */
  getLatestSignal(indexName) {
    return new Promise((resolve, reject) => {
      const sql = `
        SELECT * FROM signals
        WHERE index_name = ?
        ORDER BY timestamp DESC
        LIMIT 1
      `;

      this.db.get(sql, [indexName], (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row || null);
        }
      });
    });
  }

  /**
   * Update signal with actual result
   */
  updateSignalResult(signalId, actualResult) {
    return new Promise((resolve, reject) => {
      const sql = `
        UPDATE signals
        SET actual_result = ?, accuracy_verified = 1
        WHERE id = ?
      `;

      this.db.run(sql, [actualResult, signalId], (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Get statistics for index
   */
  getStatistics() {
    return new Promise((resolve, reject) => {
      const queryFor = (indexName) => {
        return new Promise((res, rej) => {
          const sql = `
          SELECT
            COUNT(*) as total,
            SUM(CASE WHEN direction = 'BUY' THEN 1 ELSE 0 END) as buy,
            SUM(CASE WHEN direction = 'SELL' THEN 1 ELSE 0 END) as sell,
            SUM(CASE WHEN direction = 'HOLD' THEN 1 ELSE 0 END) as hold,
            AVG(confidence) as avg_confidence,
            SUM(CASE WHEN actual_result IS NOT NULL AND actual_result = direction THEN 1 ELSE 0 END) as accurate,
            SUM(CASE WHEN actual_result IS NOT NULL THEN 1 ELSE 0 END) as verified
          FROM signals
          WHERE index_name = ?
        `;
          this.db.get(sql, [indexName], (err, row) => {
            if (err) return rej(err);
            const accuracy = row.verified > 0 ? row.accurate / row.verified : 0;
            res({
              total: row.total || 0,
              buy: row.buy || 0,
              sell: row.sell || 0,
              hold: row.hold || 0,
              avgConfidence: row.avg_confidence || 0,
              accuracy: accuracy,
            });
          });
        });
      };

      Promise.all([queryFor("NIFTY"), queryFor("SENSEX")])
        .then(([nifty, sensex]) => resolve({ nifty, sensex }))
        .catch(reject);
    });
  }

  /**
   * Get signals for date range
   */
  getSignalsInRange(indexName, startDate, endDate) {
    return new Promise((resolve, reject) => {
      const sql = `
        SELECT * FROM signals
        WHERE index_name = ? AND timestamp BETWEEN ? AND ?
        ORDER BY timestamp DESC
      `;

      this.db.all(sql, [indexName, startDate, endDate], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows || []);
        }
      });
    });
  }

  /**
   * Add any columns to btst_candidates that the current schema expects but
   * an already-existing table (created before a schema change) doesn't have
   * yet. SQLite has no "ADD COLUMN IF NOT EXISTS", so this checks
   * PRAGMA table_info first and only adds what's missing.
   */
  migrateBtstCandidatesTable(callback) {
    const expectedColumns = {
      market_cap_tier: 'TEXT',
    };

    this.db.all('PRAGMA table_info(btst_candidates)', (err, rows) => {
      if (err) {
        callback(err);
        return;
      }

      const existing = new Set((rows || []).map((r) => r.name));
      const missing = Object.entries(expectedColumns).filter(([name]) => !existing.has(name));

      if (missing.length === 0) {
        callback(null);
        return;
      }

      const addNext = (i) => {
        if (i >= missing.length) {
          callback(null);
          return;
        }
        const [name, type] = missing[i];
        this.db.run(`ALTER TABLE btst_candidates ADD COLUMN ${name} ${type}`, (err) => {
          if (err) {
            callback(err);
            return;
          }
          addNext(i + 1);
        });
      };
      addNext(0);
    });
  }

  /**
   * Save a scored BTST candidate (from btstCompositeScorer.js) to the database.
   */
  saveBtstCandidate(candidate, macro) {
    return new Promise((resolve, reject) => {
      const sql = `
        INSERT INTO btst_candidates (
          symbol, direction, composite_score, confidence, agreeing_count,
          macro_multiplier, market_cap_tier, components_json, macro_json,
          option_type, strike_price, expiry_date, premium
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      this.db.run(
        sql,
        [
          candidate.symbol,
          candidate.direction,
          candidate.finalScore,
          candidate.confidence,
          candidate.agreeingCount,
          candidate.macroMultiplier,
          candidate.marketCapTier || null,
          JSON.stringify(candidate.components),
          JSON.stringify(macro || {}),
          candidate.contract?.optionType || null,
          candidate.contract?.strikePrice || null,
          candidate.contract?.expiryDate || null,
          candidate.contract?.premium || null,
        ],
        (err) => {
          if (err) reject(err);
          else resolve();
        },
      );
    });
  }

  /**
   * Get recent BTST candidates, optionally filtered by symbol.
   */
  getBtstCandidates(limit = 100) {
    return new Promise((resolve, reject) => {
      const sql = `
        SELECT * FROM btst_candidates
        ORDER BY timestamp DESC
        LIMIT ?
      `;

      this.db.all(sql, [limit], (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
  }

  /**
   * Close database
   */
  close() {
    return new Promise((resolve, reject) => {
      if (this.db) {
        this.db.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      } else {
        resolve();
      }
    });
  }
}

module.exports = Database;
