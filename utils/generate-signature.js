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

  // Generate random salt (8 bytes hex string)
  const salt = crypto.randomBytes(8).toString('hex');

  // Current Unix timestamp (seconds)
  const timestamp = Math.floor(Date.now() / 1000).toString();

  // Lowercase HTTP method as per Rapyd spec
  const method = httpMethod.toLowerCase();

  // JSON stringify body if present, else empty string
  const bodyString = body ? JSON.stringify(body) : '';

  // Construct string to sign
  const toSign = method + urlPath + salt + timestamp + accessKey + secretKey + bodyString;

  // Create HMAC SHA256 hash (hex digest)
  const hmac = crypto.createHmac('sha256', secretKey);
  hmac.update(toSign);
  const hashHex = hmac.digest('hex'); // hex string

  // Base64 encode the *raw bytes* represented by the hex string
  const signature = Buffer.from(hashHex, 'hex').toString('base64');

  return { salt, timestamp, signature, bodyString };
}
