// POST /api/webhook
// Rapyd webhook receiver. Verifies the signature (best-effort), stores the
// event in KV keyed by merchant_reference_id, and always returns 200 so Rapyd
// marks it delivered. The demo frontend reads these via GET /api/webhooks.

import crypto from 'crypto';
import { kv, kvConfigured } from '../utils/kv.js';

// Ask Vercel not to pre-parse the body so we can verify the raw bytes.
export const config = { api: { bodyParser: false } };

function readRawBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => resolve(data));
    req.on('error', () => resolve(data));
  });
}

// Rapyd webhook signature: base64( hex( HMAC-SHA256( url + salt + timestamp + access_key + secret_key + body ) ) )
function verifySignature(req, rawBody) {
  const salt = req.headers['salt'];
  const timestamp = req.headers['timestamp'];
  const provided = req.headers['signature'];
  if (!provided || !rawBody) return 'skipped';

  const host = req.headers['host'];
  const path = (req.url || '').split('?')[0];
  const url = `https://${host}${path}`;

  // Any profile's MID may deliver here — try every configured key pair
  // (the three sandbox profiles, the legacy flat sandbox pair, and live).
  const keyPairs = [
    [process.env.RAPYD_SC1_ACCESS_KEY, process.env.RAPYD_SC1_SECRET_KEY],
    [process.env.RAPYD_SC2_ACCESS_KEY, process.env.RAPYD_SC2_SECRET_KEY],
    [process.env.RAPYD_SC3_ACCESS_KEY, process.env.RAPYD_SC3_SECRET_KEY],
    [process.env.RAPYD_SANDBOX_ACCESS_KEY, process.env.RAPYD_SANDBOX_SECRET_KEY],
    [process.env.RAPYD_LIVE_ACCESS_KEY, process.env.RAPYD_LIVE_SECRET_KEY],
  ];
  for (const [accessKey, secretKey] of keyPairs) {
    if (!accessKey || !secretKey) continue;
    const toSign = url + salt + timestamp + accessKey + secretKey + rawBody;
    const hex = crypto.createHmac('sha256', secretKey).update(toSign).digest('hex');
    const b64 = Buffer.from(hex).toString('base64');
    const b64url = b64.replace(/\+/g, '-').replace(/\//g, '_');
    if (provided === b64 || provided === b64url) return 'verified';
  }
  return 'unverified';
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');
    return res.status(200).end();
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const raw = await readRawBody(req);
  let event = {};
  try { event = raw ? JSON.parse(raw) : (req.body || {}); } catch { event = req.body || {}; }

  // Prefer the exact raw bytes; if Vercel already consumed them, fall back to
  // the re-serialized parsed body (Rapyd sends compact JSON, so this usually
  // reproduces what was signed).
  const bodyForSig = raw && raw.length ? raw : JSON.stringify(event);
  const verified = verifySignature(req, bodyForSig);
  const data = event.data || {};
  const ref = data.merchant_reference_id || event.merchant_reference_id || 'unknown';

  const record = {
    received_at: Date.now(),
    type: event.type || 'UNKNOWN',
    verified,
    event_id: event.id,
    payment_id: data.id,
    status: data.status,
    paid: data.paid,
    amount: data.amount,
    currency: data.currency_code || data.currency,
    merchant_reference_id: ref,
    raw: event,
  };

  try {
    if (kvConfigured()) {
      if (ref && ref !== 'unknown') {
        const key = `wh:${ref}`;
        await kv(['LPUSH', key, JSON.stringify(record)]);
        await kv(['EXPIRE', key, '3600']);
      }
      await kv(['LPUSH', 'wh:recent', JSON.stringify(record)]);
      await kv(['LTRIM', 'wh:recent', '0', '99']);
      await kv(['EXPIRE', 'wh:recent', '3600']);
    }
  } catch (err) {
    console.error('webhook store error:', err.message);
  }

  // Always 200 so Rapyd considers the webhook delivered.
  return res.status(200).json({ received: true, verified });
}
