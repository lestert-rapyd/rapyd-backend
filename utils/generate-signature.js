import crypto from 'crypto';

/**
 * Generate Rapyd REST API signature using keys from environment variables
 * @param {string} method     - HTTP method (lowercase recommended)
 * @param {string} urlPath    - URL path starting with /v1/..., including query string if any
 * @param {Object|null} body  - JSON payload object or null for GET requests
 * @returns {Object}          - { salt, timestamp, signature }
 */
export function generateRapydSignature(method, urlPath, body = null) {
  const access_key = process.env.RAPYD_ACCESS_KEY;
  const secret_key = process.env.RAPYD_SECRET_KEY;

  if (!access_key || !secret_key) {
    throw new Error('Missing RAPYD_ACCESS_KEY or RAPYD_SECRET_KEY in environment variables');
  }

  // Generate salt - 12 unique alphanumeric chars
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let salt = '';
  while (salt.length < 12) {
    const idx = crypto.randomInt(0, chars.length);
    if (!salt.includes(chars[idx])) salt += chars[idx];
  }

  // Unix timestamp in seconds
  const timestamp = Math.floor(Date.now() / 1000).toString();

  // JSON stringified body (no spaces), or empty string if no body
  const bodyString = body ? JSON.stringify(body) : '';

  // If urlPath is full URL, trim to /v1/...
  if (urlPath.startsWith('http')) {
    urlPath = urlPath.substring(urlPath.indexOf('/v1'));
  }

  // Compose string to sign in order:
  // method + urlPath + salt + timestamp + access_key + secret_key + bodyString
  const toSign = method + urlPath + salt + timestamp + access_key + secret_key + bodyString;

  // HMAC-SHA256 hex digest
  const hmac = crypto.createHmac('sha256', secret_key);
  hmac.update(toSign);
  const signatureHex = hmac.digest('hex');

  // Base64 URL-safe encode the hex digest string
  const signature = Buffer.from(signatureHex)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
    // .replace(/=+$/, '');

  return { salt, timestamp, signature };
}
