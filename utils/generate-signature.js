import crypto from 'crypto';

export function generateRapydSignature(method, urlPath, body = '') {
  const accessKey = process.env.RAPYD_ACCESS_KEY;
  const secretKey = process.env.RAPYD_SECRET_KEY;

  if (!accessKey || !secretKey) {
    throw new Error('Missing RAPYD_ACCESS_KEY or RAPYD_SECRET_KEY in environment');
  }

  const salt = crypto.randomBytes(8).toString('hex');  // 16 hex chars
  const timestamp = Math.floor(Date.now() / 1000).toString();

  const bodyString = body && typeof body === 'object' ? JSON.stringify(body) : (body || '');

  const methodLower = method.toLowerCase();

  const toSign = methodLower + urlPath + salt + timestamp + accessKey + bodyString + secretKey;

  console.log('--- Rapyd Signature Debug ---');
  console.log('String to sign:', toSign);
  console.log('Method:', methodLower);
  console.log('URL Path:', urlPath);
  console.log('Salt:', salt);
  console.log('Timestamp:', timestamp);
  console.log('Access Key:', accessKey);
  console.log('Body string:', bodyString);
  console.log('Secret Key:', secretKey);

  const hmac = crypto.createHmac('sha256', secretKey);
  hmac.update(toSign);
  const signature = hmac.digest('base64');

  console.log('Signature:', signature);
  console.log('------------------------------');

  return { salt, timestamp, signature };
}
