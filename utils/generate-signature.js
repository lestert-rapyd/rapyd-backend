import crypto from 'crypto';
import axios from 'axios';

/**
 * Generate Rapyd REST request signature
 * @param {string} httpMethod  – e.g. 'get', 'post', 'put', 'delete' (lower‑case)
 * @param {string} urlPath     – including '/v1...' and query string if present
 * @param {Object|null} body   – JavaScript object for JSON payload, or null/undefined for GET/etc
 * @returns {Object}           – { salt, timestamp, signature, bodyString }
 */
function generateRapydSignature(httpMethod, urlPath, body = null) {
  const accessKey = process.env.RAPYD_ACCESS_KEY;
  const secretKey = process.env.RAPYD_SECRET_KEY;
  if (!accessKey || !secretKey) {
    throw new Error('Missing Rapyd access key or secret key in environment');
  }

  const salt = crypto.randomBytes(8).toString('hex'); // 8 bytes → hex string ~16 chars
  const timestamp = Math.floor(Date.now() / 1000).toString(); // as string

  let bodyString = '';
  if (body != null) {
    // JSON.stringify with no extra spaces
    bodyString = JSON.stringify(body, Object.keys(body).sort(), /* but key order not required by Rapyd unless your code depends on it */);
    // Remove whitespace etc. JSON.stringify by default already uses minimal separators.
  }

  // must be lower-case method
  const method = httpMethod.toLowerCase();

  const toSign = method + urlPath + salt + timestamp + accessKey + secretKey + bodyString;

  // HMAC SHA‑256
  const hmac = crypto.createHmac('sha256', secretKey);
  hmac.update(toSign);
  const hashHex = hmac.digest('hex');

  // base64 encode the hash hex string (Rapyd uses base64 of hex digest, not directly base64 of raw HMAC bytes)  
  const signature = Buffer.from(hashHex, 'utf8').toString('base64');

  return { salt, timestamp, signature, bodyString };
}

/**
 * Make a signed Rapyd API request using axios
 * @param {string} method       – HTTP method (lower‑case or any, will be converted)
 * @param {string} path         – path after host, including /v1... and query
 * @param {Object|null} body    – JSON payload or null
 * @param {string} baseUrl      – e.g. 'https://sandboxapi.rapyd.net'
 * @returns {Promise<Object>}    – parsed JSON response
 */
async function rapydRequest(method, path, body = null, baseUrl = 'https://sandboxapi.rapyd.net') {
  const { salt, timestamp, signature, bodyString } = generateRapydSignature(method, path, body);

  const headers = {
    'access_key': process.env.RAPYD_ACCESS_KEY,
    'salt': salt,
    'timestamp': timestamp,
    'signature': signature,
    'Content-Type': 'application/json',
    // idempotency is optional depending on endpoint; many examples include it:
    'idempotency': timestamp + salt
  };

  const url = baseUrl + path;

  const axiosConfig = {
    method, 
    url,
    headers,
  };

  if (body != null && !['get', 'delete'].includes(method.toLowerCase())) {
    axiosConfig.data = bodyString;
  }

  const resp = await axios(axiosConfig);
  return resp.data;
}
