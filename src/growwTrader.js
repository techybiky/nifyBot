// growwTrader.js
// Direct integration with Groww's REST API (bypasses the broken `growwapi` npm package).
//
// AUTH MODES — Groww supports two, and they use DIFFERENT secrets:
//   "totp"     — API Key + a base32 TOTP secret (from an authenticator-style setup on
//                Groww Cloud). Runs fully unattended — this is what an automated bot needs.
//   "approval" — API Key + plain Secret + SHA256 checksum. Requires manually clicking
//                "approve" on the Groww Cloud dashboard once a day — NOT suitable for
//                an unattended daily bot, but useful as a fallback while you locate the
//                correct TOTP secret.
//
// Set GROWW_AUTH_MODE=totp or GROWW_AUTH_MODE=approval in .env (defaults to totp).
//
// IMPORTANT: TOTP mode uses a DIFFERENT pair of credentials than approval mode —
// generate these separately via "Generate TOTP Token" on the Groww Cloud API Keys page:
//   GROWW_TOTP_TOKEN  — the TOTP Token (used as the bearer key in the auth request)
//   GROWW_TOTP_SECRET — the base32 TOTP secret (used to generate the rolling 6-digit code)
// These are NOT the same as GROWW_API_KEY / GROWW_API_SECRET, which are only used for
// approval mode (checksum-based, requires daily manual approval on the dashboard).

const axios = require('axios');
const crypto = require('crypto');
const OTPAuth = require('otpauth');
require('dotenv').config();

const BASE_URL = process.env.GROWW_API_BASE_URL || 'https://api.groww.in/';
const VERSION = process.env.GROWW_API_VERSION || 'v1';
const API_URL = `${BASE_URL}${VERSION}`;
const AUTH_URL = `${API_URL}/token/api/access`;

class GrowwTrader {
  constructor() {
    // Approval-mode credentials
    this.apiKey = process.env.GROWW_API_KEY;
    this.apiSecret = process.env.GROWW_API_SECRET;
    // TOTP-mode credentials (separate pair — see header comment)
    this.totpToken = process.env.GROWW_TOTP_TOKEN;
    this.totpSecret = process.env.GROWW_TOTP_SECRET;
    this.authMode = (process.env.GROWW_AUTH_MODE || 'totp').toLowerCase();
    this.accessToken = null;
    this.tokenExpiry = null;
    this.authenticated = false;
  }

  /**
   * Generate a live 6-digit TOTP code from the GROWW_API_SECRET (must be base32).
   */
  generateTOTP() {
    let secret;
    try {
      secret = OTPAuth.Secret.fromBase32(this.totpSecret || '');
    } catch (e) {
      throw new Error(
        'GROWW_TOTP_SECRET is not a valid base32 TOTP secret. ' +
        'Generate one via "Generate TOTP Token" on the Groww Cloud API Keys page — ' +
        'this is separate from your regular GROWW_API_KEY/GROWW_API_SECRET pair. ' +
        'Or set GROWW_AUTH_MODE=approval in .env to use your existing approval credentials instead.'
      );
    }
    return new OTPAuth.TOTP({
      secret: secret,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
    }).generate();
  }

  /**
   * Generate the SHA256 checksum required for "approval" mode:
   * checksum = SHA256(apiSecret + timestamp)
   */
  generateApprovalChecksum(timestamp) {
    return crypto
      .createHash('sha256')
      .update(this.apiSecret + timestamp)
      .digest('hex');
  }

  /**
   * Exchange TOTP Token (as bearer) + live TOTP code for a short-lived access token.
   */
  async getAccessToken() {
    if (this.accessToken && this.tokenExpiry && new Date() < new Date(this.tokenExpiry)) {
      return this.accessToken;
    }

    let body;
    if (this.authMode === 'approval') {
      body = {
        key_type: 'approval',
        secret: this.apiSecret,
      };
    } else {
      body = {
        key_type: 'totp',
        totp: this.generateTOTP(),
      };
    }

    const bearerKey = this.authMode === 'approval' ? this.apiKey : this.totpToken;

    const response = await axios.post(AUTH_URL, body, {
      headers: {
        Authorization: `Bearer ${bearerKey}`,
        'Content-Type': 'application/json',
      },
    });

    // Groww wraps responses in a `payload` field on success
    const payload = response.data.payload || response.data;
    this.accessToken = payload.token;
    this.tokenExpiry = payload.expiry;
    return this.accessToken;
  }

  /**
   * Authenticate with Groww API (fetches an access token and confirms it works).
   */
  async authenticate() {
    try {
      if (this.authMode === 'approval') {
        if (!this.apiKey || !this.apiSecret) {
          throw new Error('GROWW_API_KEY / GROWW_API_SECRET not found in .env (required for approval mode)');
        }
      } else {
        if (!this.totpToken || !this.totpSecret) {
          throw new Error('GROWW_TOTP_TOKEN / GROWW_TOTP_SECRET not found in .env (required for totp mode)');
        }
      }

      console.log(`[GROWW] Authenticating with Groww API (mode: ${this.authMode})...`);

      await this.getAccessToken();

      // Sanity check with a cheap read-only call
      const check = await this.makeRequest('/holdings/user', 'GET');
      if (!check.success) {
        throw new Error(check.error);
      }

      this.authenticated = true;
      console.log('[GROWW] ✅ Authentication successful');
      return true;
    } catch (error) {
      const errorMsg = error.response?.data?.error?.message || error.response?.data?.message || error.message;
      console.error('[GROWW] Authentication failed:', errorMsg);
      this.authenticated = false;
      return false;
    }
  }

  /**
   * Make an authenticated request against the Groww API.
   */
  async makeRequest(endpoint, method = 'GET', data = null) {
    try {
      const token = await this.getAccessToken();

      const config = {
        method,
        url: `${API_URL}${endpoint}`,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'X-API-VERSION': '1.0',
        },
      };

      if (data) {
        config.data = data;
      }

      const response = await axios(config);
      return { success: true, data: response.data.payload ?? response.data };
    } catch (error) {
      const errorMsg = error.response?.data?.error?.message || error.response?.data?.message || error.message;
      return { success: false, error: errorMsg };
    }
  }

  /**
   * Place a call option BUY order
   */
  async placeBuyCallOrder(callSignal, quantity = 1) {
    if (!this.authenticated) {
      return {
        success: false,
        message: 'Not authenticated. Call authenticate() first',
        simulationMode: true,
        simulatedOrder: this.simulateOrder('BUY', callSignal, quantity),
      };
    }

    try {
      const orderData = {
        trading_symbol: callSignal.symbol,
        quantity: quantity,
        exchange: 'NSE',
        segment: 'FNO',
        product: 'MIS',
        order_type: 'MARKET',
        transaction_type: 'BUY',
        validity: 'DAY',
        price: callSignal.estimatedPremium,
        trigger_price: 0,
        order_reference_id: this.generateOrderReferenceId(),
      };

      console.log(`[GROWW] Placing BUY order: ${callSignal.symbol} x ${quantity}`);

      const result = await this.makeRequest('/order/create', 'POST', orderData);

      if (result.success) {
        return {
          success: true,
          orderId: result.data.groww_order_id || result.data.growwOrderId,
          symbol: callSignal.symbol,
          quantity: quantity,
          price: callSignal.estimatedPremium,
          orderData: result.data,
          timestamp: new Date().toISOString(),
        };
      } else {
        return { success: false, error: result.error };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Place a call option SELL order (square off)
   */
  async placeSellCallOrder(symbol, quantity, price) {
    if (!this.authenticated) {
      return {
        success: false,
        message: 'Not authenticated',
        simulationMode: true,
        simulatedOrder: this.simulateOrder('SELL', { symbol, estimatedPremium: price }, quantity),
      };
    }

    try {
      const orderData = {
        trading_symbol: symbol,
        quantity: quantity,
        exchange: 'NSE',
        segment: 'FNO',
        product: 'MIS',
        order_type: 'MARKET',
        transaction_type: 'SELL',
        validity: 'DAY',
        price: price,
        trigger_price: 0,
        order_reference_id: this.generateOrderReferenceId(),
      };

      console.log(`[GROWW] Placing SELL order: ${symbol} x ${quantity}`);

      const result = await this.makeRequest('/order/create', 'POST', orderData);

      if (result.success) {
        return {
          success: true,
          orderId: result.data.groww_order_id || result.data.growwOrderId,
          symbol: symbol,
          quantity: quantity,
          price: price,
          timestamp: new Date().toISOString(),
        };
      } else {
        return { success: false, error: result.error };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Get current order status
   */
  async getOrderStatus(orderId) {
    try {
      const result = await this.makeRequest(`/order/status/${orderId}?segment=FNO`);

      if (result.success) {
        return {
          success: true,
          orderId: orderId,
          status: result.data.order_status || result.data.orderStatus,
          symbol: result.data.trading_symbol || result.data.tradingSymbol,
          quantity: result.data.quantity,
          price: result.data.price,
          timestamp: new Date().toISOString(),
        };
      } else {
        return { success: false, error: result.error };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Get live market data (LTP - Last Traded Price)
   */
  async getLivePrice(symbol) {
    try {
      const result = await this.makeRequest(`/live-data/ltp?exchange_symbols=${symbol}&segment=FNO`);

      if (result.success) {
        return {
          success: true,
          symbol: symbol,
          ltp: result.data,
          lastUpdate: new Date().toISOString(),
        };
      } else {
        return { success: false, error: result.error };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Get portfolio holdings
   */
  async getHoldings() {
    try {
      const result = await this.makeRequest('/holdings/user');

      if (result.success) {
        return {
          success: true,
          holdings: result.data.holdings || result.data,
        };
      } else {
        return { success: false, error: result.error };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Get open positions
   */
  async getPositions() {
    try {
      const result = await this.makeRequest('/positions/user?segment=FNO');

      if (result.success) {
        return {
          success: true,
          positions: result.data,
        };
      } else {
        return { success: false, error: result.error };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Generate a unique alphanumeric order reference ID (8-20 chars, per Groww's requirement).
   */
  generateOrderReferenceId() {
    const timestamp = Date.now().toString(36); // base36 = compact alphanumeric
    const random = Math.random().toString(36).substring(2, 8);
    return `Ord${timestamp}${random}`.substring(0, 20);
  }

  /**
   * Simulate order for testing (when not connected to real API)
   */
  simulateOrder(type, signal, quantity) {
    const orderId = `SIM-${Date.now()}`;

    return {
      orderId: orderId,
      type: type,
      symbol: signal.symbol || 'NIFTY',
      quantity: quantity,
      price: signal.estimatedPremium || signal.premium || 100,
      status: 'SIMULATED',
      message: '⚠️ SIMULATION MODE - No real order placed',
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Format order for display
   */
  formatOrderResponse(orderResult) {
    if (orderResult.success) {
      return `
✅ ORDER PLACED SUCCESSFULLY

Order ID: ${orderResult.orderId}
Symbol: ${orderResult.symbol}
Quantity: ${orderResult.quantity}
Price: ₹${orderResult.price}
Status: PENDING

Timestamp: ${orderResult.timestamp}
      `.trim();
    } else {
      return `
❌ ORDER FAILED

Error: ${orderResult.error}
Message: ${orderResult.message || 'Order placement failed'}
      `.trim();
    }
  }
}

module.exports = GrowwTrader;