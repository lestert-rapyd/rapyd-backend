import crypto from 'crypto';

export function generateRapydSignature(method, urlPath, body) {
  const access_key = process.env.RAPYD_ACCESS_KEY;
  const secret_key = process.env.RAPYD_SECRET_KEY;
  const salt = crypto.randomBytes(8).toString('hex');
  const timestamp = Math.floor(Date.now() / 1000);
  const bodyString = body ? JSON.stringify(body) : '';

  const toSign = `${method.toUpperCase()}${urlPath}${salt}${timestamp}${access_key}${bodyString}`;

  const signature = crypto
    .createHmac('sha256', secret_key)
    .update(toSign)
    .digest('base64');

  return { salt, timestamp, signature };
}
