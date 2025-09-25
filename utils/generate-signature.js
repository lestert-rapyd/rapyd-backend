// generateSignature.js
import crypto from 'crypto';

export function generateRapydSignature(method, urlPath, body = '') {
  const accessKey = process.env.RAPYD_ACCESS_KEY;
  const secretKey = process.env.RAPYD_SECRET_KEY;

  const salt = crypto.randomBytes(8).toString('hex');
  const timestamp = Math.floor(Date.now() / 1000);
  const bodyString = body ? JSON.stringify(body) : '';

  const toSign = `${method.toLowerCase()}${urlPath}${salt}${timestamp}${accessKey}${bodyString}`;
  const signature = crypto
    .createHmac('sha256', secretKey)
    .update(toSign)
    .digest('hex'); // Rapyd expects hex before base64
  const encodedSignature = Buffer.from(signature).toString('base64');

  return { salt, timestamp, signature: encodedSignature };
}
