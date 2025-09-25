// generate-signature.js
import crypto from 'crypto';

/**
 * Generate Rapyd REST API signature
 * @param {string} method  - HTTP method (e.g. 'get', 'post', lowercase)
 * @param {string} urlPath - Full URL path including /v1 and query string
 * @param {Object|null} body - JS object for JSON payload or null
 * @returns {Object} - { salt, timestamp, signature, bodyString }
 */
export function generateRapydSignature(method, urlPath, body = null) {
  const accessKey = process.env.RAPYD_ACCESS_KEY;
  const secretKey = process.env.RAPYD_SECRET_KEY;

  if (!accessKey || !secretKey) {
    throw new Error('Missing Rapyd access key or secret key');
  }

  const salt = crypto.randomBytes(8).toString('hex'); // 16 hex chars
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const methodLower = method.toLowerCase();
  const bodyString = body ? JSON.stringify(body) : '';

  // Construct string to sign exactly as per Rapyd spec:
  const toSign = methodLower + urlPath + salt + timestamp + accessKey + secretKey + bodyString;

  // HMAC SHA256 digest, hex encoded
  const hashHex = crypto.createHmac('sha256', secretKey).update(toSign).digest('hex');

  // Base64 encode the hex digest bytes (not raw HMAC bytes)
  const signature = Buffer.from(hashHex, 'hex').toString('base64');

  return { salt, timestamp, signature, bodyString };
}
