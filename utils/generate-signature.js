import crypto from 'crypto';

/**
 * Generates the Rapyd signature required for secure API requests.
 * 
 * @param {string} method - HTTP method (e.g. 'get', 'post', etc.)
 * @param {string} urlPath - Full URL path (including query string if any), e.g. '/v1/user?id=123'
 * @param {Object} body - Request body as a JavaScript object (optional)
 * @returns {Object} - Object containing { salt, timestamp, signature }
 */
export function generateRapydSignature(method, urlPath, body) {
  const access_key = process.env.RAPYD_ACCESS_KEY;
  const secret_key = process.env.RAPYD_SECRET_KEY;

  if (!access_key || !secret_key) {
    throw new Error('Rapyd access key and/or secret key not set in environment variables.');
  }

  const salt = crypto.randomBytes(8).toString('hex');
  const timestamp = Math.floor(Date.now() / 1000); // UNIX time in seconds
  const bodyString = body ? JSON.stringify(body) : '';

  // Per Rapyd docs: method must be lowercase
  const toSign = `${method.toLowerCase()}${urlPath}${salt}${timestamp}${access_key}${bodyString}`;

  const signature = crypto
    .createHmac('sha256', secret_key)
    .update(toSign)
    .digest('base64');

  return { salt, timestamp, signature };
}
