import crypto from 'crypto';

export function generateRapydSignature(method, urlPath, body = '') {
  const accessKey = process.env.RAPYD_ACCESS_KEY;
  const secretKey = process.env.RAPYD_SECRET_KEY;

  if (!accessKey || !secretKey) {
    throw new Error('Missing RAPYD_ACCESS_KEY or RAPYD_SECRET_KEY in environment');
  }

  const salt = crypto.randomBytes(8).toString('hex'); // 16 hex chars
  const timestamp = Math.floor(Date.now() / 1000).toString();

  // Body must be stringified with no extra spaces
  const bodyString = body && typeof body === 'object' ? JSON.stringify(body) : (body || '');

  // All lower case method
  const methodLower = method.toLowerCase();

  // Concatenate in EXACT order: method + urlPath + salt + timestamp + accessKey + body + secretKey
  const toSign = methodLower + urlPath + salt + timestamp + accessKey + bodyString + secretKey;

  // HMAC-SHA256, raw digest
  const hmac = crypto.createHmac('sha256', secretKey);
  hmac.update(toSign);
  const signature = hmac.digest('base64');  // Base64 of raw HMAC digest, NOT hex!

  return { salt, timestamp, signature };
}
