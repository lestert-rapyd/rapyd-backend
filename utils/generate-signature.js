import crypto from 'crypto';

/**
 * Generate Rapyd REST API signature
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

  const salt = crypto.randomBytes(8).toString('hex');   // 16 hex chars
  const timestamp = Math.floor(Date.now() / 1000).toString(); // unix timestamp in seconds as string

  const bodyString = body ? JSON.stringify(body) : '';

  // Construct the string to sign exactly in this order:
  // method + urlPath + salt + timestamp + access_key + bodyString + secret_key
  const toSign = method.toLowerCase() + urlPath + salt + timestamp + access_key + bodyString + secret_key;

  // Create HMAC-SHA256 hash and encode the raw bytes output as base64 (NOT hex then base64!)
  const hmac = crypto.createHmac('sha256', secret_key);
  hmac.update(toSign);
  const signature = hmac.digest('base64');

  return { salt, timestamp, signature };
}
