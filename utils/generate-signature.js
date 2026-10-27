import crypto from 'crypto';

/**
 * Generate Rapyd REST API request signature.
 *
 *   signature = base64url( hex( HMAC-SHA256(secret,
 *                 method + urlPath + salt + timestamp + access_key + secret_key + body) ) )
 *
 * @param {string} method              - HTTP method, lowercase ('get' | 'post')
 * @param {string} urlPath             - path starting with /v1/..., query string included
 * @param {Object|string|null} body    - payload object, or the EXACT JSON string that will be
 *                                       sent (preferred — the signature must cover the bytes on
 *                                       the wire), or null/'' for GET
 * @param {string} accessKey
 * @param {string} secretKey
 * @returns {{ salt: string, timestamp: string, signature: string }}
 */
export function generateRapydSignature(method, urlPath, body = null, accessKey, secretKey) {
  // No env-var fallback: every caller resolves keys through key-profiles.js,
  // so a missing pair here is a bug, not a config to paper over.
  if (!accessKey || !secretKey) {
    throw new Error('generateRapydSignature: accessKey and secretKey are required');
  }

  // Salt - 12 unique alphanumeric chars
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let salt = '';
  while (salt.length < 12) {
    const idx = crypto.randomInt(0, chars.length);
    if (!salt.includes(chars[idx])) salt += chars[idx];
  }

  // Unix timestamp in seconds
  const timestamp = Math.floor(Date.now() / 1000).toString();

  // A pre-serialized string is signed verbatim; an object is compacted with
  // JSON.stringify (no spaces) — the same serializer rapydRequest sends with.
  const bodyString = typeof body === 'string' ? body : (body ? JSON.stringify(body) : '');

  // If urlPath is full URL, trim to /v1/...
  if (urlPath.startsWith('http')) {
    urlPath = urlPath.substring(urlPath.indexOf('/v1'));
  }

  const toSign = method + urlPath + salt + timestamp + accessKey + secretKey + bodyString;
  const signatureHex = crypto.createHmac('sha256', secretKey).update(toSign).digest('hex');

  // Base64 URL-safe encode the hex digest string
  const signature = Buffer.from(signatureHex)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  return { salt, timestamp, signature };
}
