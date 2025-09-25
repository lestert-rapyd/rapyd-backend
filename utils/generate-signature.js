import crypto from 'crypto';

export function generateRapydSignature(method, urlPath, body) {
  const access_key = process.env.RAPYD_ACCESS_KEY;
  const secret_key = process.env.RAPYD_SECRET_KEY;
  const salt = crypto.randomBytes(8).toString('hex');
  const timestamp = Math.floor(new Date().getTime() / 1000);
  const bodyString = body ? JSON.stringify(body) : '';

  const toSign = `${method.toLowerCase()}${urlPath}${salt}${timestamp}${access_key}${secret_key}${bodyString}`;
  const hash = crypto.createHmac('sha256', secret_key)
    .update(toSign)
    .digest('base64');

  return { salt, timestamp, signature: hash };
}
