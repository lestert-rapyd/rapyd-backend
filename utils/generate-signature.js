import crypto from 'crypto';

/**
 * Generate Rapyd REST request signature
 * @param {string} httpMethod  – e.g. 'get', 'post', 'put', 'delete' (case-insensitive)
 * @param {string} urlPath     – including '/v1...' and query string if present
 * @param {Object|null} body   – JavaScript object for JSON payload, or null for GET/etc
 * @returns {Object}           – { salt, timestamp, signature, bodyString }
 */
export function generateRapydSignature(httpMethod, urlPath, body = null) {
  const accessKey = process.env.RAPYD_ACCESS_KEY;
  const secretKey = process.env.RAPYD_SECRET_KEY;

  if (!accessKey || !secretKey) {
    throw new Error('Missing Rapyd access key or secret key in environment variables');
  }

  // Generate a random salt: 8 bytes → 16 hex chars
  const salt = crypto.randomBytes(8).toString('hex');

  // Current Unix timestamp (seconds)
  const timestamp = Math.floor(Date.now() / 1000).toString();

  // Lowercase HTTP method
  const method = httpMethod.toLowerCase();

  // JSON stringify body without spaces if present
  const bodyString = body ? JSON.stringify(body) : '';

  // String to sign:
  // method + urlPath + salt + timestamp + accessKey + secretKey + bodyString
  const toSign = method + urlPath + salt + timestamp + accessKey + secretKey + bodyString;

  // Calculate HMAC SHA256 digest (hex)
  const hmac = crypto.createHmac('sha256', secretKey);
  hmac.update(toSign);
  const hashHex = hmac.digest('hex'); // hex string (64 chars)

  // Base64 encode the raw bytes of the hex digest (convert hex → bytes → base64)
  const signature = Buffer.from(hashHex, 'hex').toString('base64');

  return { salt, timestamp, signature, bodyString };
}
