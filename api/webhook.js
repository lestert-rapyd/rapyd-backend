// POST /api/webhook
// Rapyd webhook receiver. Verifies the signature against every configured
// MID, files the event in KV under its merchant_reference_id (and its cus_***
// for CUSTOMER_* / card-on-file events), and returns 200 so Rapyd marks it
// delivered. The demo frontend reads these via GET /api/webhooks.
//
// `verified` is computed HERE only — the frontend must treat anything but
// 'verified' as untrusted (it re-confirms via Retrieve Payment). With
// WEBHOOK_REQUIRE_SIGNATURE=true unverified events aren't stored at all.
// `verified_env` says WHICH environment's key pair signed it ('sandbox' |
// 'live' | null): anyone can make the sandbox MIDs sign an event for a ref of
// their choosing, so the frontend only trusts a verified event whose env
// matches the payment it is watching.
//
// Unverified events are stored REDUCED (no full raw body, clipped strings),
// with a short TTL, in a separate list (whu:<ref> / whu:cus:<id>) — so a
// flood of forged POSTs can neither fill KV with 64 KB bodies nor evict the
// verified events from wh:<ref> (LTRIM). GET /api/webhooks merges both.

import crypto from 'crypto';
import { kv, kvConfigured } from '../utils/kv.js';
import { sandboxKeyPairs, liveKeyPairs } from '../utils/key-profiles.js';
import { applyCors, methodNotAllowed } from '../utils/http.js';
import { safeEqual } from '../utils/live-guards.js';

// Ask the platform not to pre-parse the body so we can verify the raw bytes.
export const config = { api: { bodyParser: false } };

const METHODS = ['POST'];
// Rapyd payment/customer webhooks are a few KB; 64 KB leaves ample headroom.
export const MAX_WEBHOOK_BYTES = 64 * 1024;
const READ_TIMEOUT_MS = 10000;
const MAX_REF_LENGTH = 128;
const LIST_MAX = 50;          // per-ref / per-customer list cap (LTRIM 0 49)
const LIST_TTL_SECONDS = 3600;
const UNVERIFIED_LIST_MAX = 20;
const UNVERIFIED_TTL_SECONDS = 600;
const UNVERIFIED_STR_MAX = 128; // clip every string kept from an unverified body
const CUS_ID = /^cus_[A-Za-z0-9]+$/;

class TooLarge extends Error {}

/**
 * The raw request body as a utf8 string, wherever the platform left it:
 *   1. req.rawBodyString — server.js's express.raw hook (local runs);
 *   2. the unread stream — Vercel with bodyParser off. req.body is NOT
 *      touched first: on Vercel that getter may consume the stream;
 *   3. an already-consumed stream → whatever parsed body is left
 *      (Buffer/string verbatim, object re-serialized — Rapyd sends compact
 *      JSON, so this usually reproduces the signed bytes).
 * Rejects with TooLarge past MAX_WEBHOOK_BYTES. Never hangs: a stream that
 * already ended is never awaited, and a stalled one resolves after 10s.
 */
export function readRawBody(req) {
  if (typeof req.rawBodyString === 'string') {
    if (Buffer.byteLength(req.rawBodyString) > MAX_WEBHOOK_BYTES) return Promise.reject(new TooLarge());
    return Promise.resolve(req.rawBodyString);
  }
  if (Number(req.headers?.['content-length']) > MAX_WEBHOOK_BYTES) return Promise.reject(new TooLarge());

  const streamOpen = typeof req.on === 'function' && !req.readableEnded && req.readable !== false;
  if (!streamOpen) return Promise.resolve(parsedBodyString(req));

  // An empty stream may mean the runtime buffered the body elsewhere — only
  // now (stream finished) is it safe to look at req.body.
  return readStream(req).then((s) => s || parsedBodyString(req));
}

function readStream(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let done = false;
    const finish = (fn, v) => { if (done) return; done = true; clearTimeout(timer); fn(v); };
    const timer = setTimeout(() => finish(resolve, Buffer.concat(chunks).toString('utf8')), READ_TIMEOUT_MS);
    req.on('data', (chunk) => {
      if (done) return;
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buf.length;
      if (size > MAX_WEBHOOK_BYTES) { finish(reject, new TooLarge()); return; }
      chunks.push(buf);
    });
    req.on('end', () => finish(resolve, Buffer.concat(chunks).toString('utf8')));
    req.on('error', () => finish(resolve, Buffer.concat(chunks).toString('utf8')));
  });
}

function parsedBodyString(req) {
  const b = req.body;
  if (Buffer.isBuffer(b)) return b.toString('utf8');
  if (typeof b === 'string') return b;
  if (b && typeof b === 'object') return JSON.stringify(b);
  return '';
}

/**
 * Rapyd webhook signature:
 *   base64( hex( HMAC-SHA256(secret, url + salt + timestamp + access_key + secret_key + body) ) )
 * accepted in standard or url-safe base64. Constant-time compare.
 * @returns {'verified'|'unverified'|'skipped'} skipped = nothing to check
 *   against (no signature header, empty body, or no keys configured)
 */
export function verifyWebhookSignature({ url, salt, timestamp, signature, body, keyPairs }) {
  if (!signature || !body || !keyPairs?.length) return 'skipped';
  if (!salt || !timestamp || !url) return 'unverified';
  let ok = false;
  // Any profile's MID may deliver here — try every configured key pair, and
  // don't short-circuit, so timing doesn't reveal which pair matched.
  for (const [accessKey, secretKey] of keyPairs) {
    const toSign = url + salt + timestamp + accessKey + secretKey + body;
    const hex = crypto.createHmac('sha256', secretKey).update(toSign).digest('hex');
    const b64 = Buffer.from(hex).toString('base64');
    const b64url = b64.replace(/\+/g, '-').replace(/\//g, '_');
    const std = safeEqual(signature, b64);
    const urlSafe = safeEqual(signature, b64url);
    if (std || urlSafe) ok = true;
  }
  return ok ? 'verified' : 'unverified';
}

/**
 * verifyWebhookSignature() run against the sandbox pairs and the live pair
 * separately, so the record can say which environment signed it. Both always
 * run (no short-circuit). Same 'verified'|'unverified'|'skipped' semantics as
 * checking every pair at once.
 * @returns {{ verified: 'verified'|'unverified'|'skipped', verified_env: 'sandbox'|'live'|null }}
 */
export function verifyWebhook({ url, salt, timestamp, signature, body, sandboxPairs, livePairs }) {
  const base = { url, salt, timestamp, signature, body };
  const sandbox = verifyWebhookSignature({ ...base, keyPairs: sandboxPairs });
  const live = verifyWebhookSignature({ ...base, keyPairs: livePairs });
  if (live === 'verified') return { verified: 'verified', verified_env: 'live' };
  if (sandbox === 'verified') return { verified: 'verified', verified_env: 'sandbox' };
  const skipped = sandbox === 'skipped' && live === 'skipped';
  return { verified: skipped ? 'skipped' : 'unverified', verified_env: null };
}

const clip = (v) => (typeof v === 'string' ? v.slice(0, UNVERIFIED_STR_MAX) : v);
const scalar = (v) => (v === null || ['string', 'number', 'boolean'].includes(typeof v) ? clip(v) : undefined);

/** What an UNVERIFIED event keeps of its body: enough to display it and to
    point a Retrieve Payment at the payment it claims — nothing else. */
export function reducedRaw(event = {}, data = {}) {
  const keep = {};
  for (const k of ['id', 'status', 'paid', 'amount', 'currency', 'currency_code', 'merchant_reference_id', 'customer']) {
    const v = scalar(data[k]);
    if (v !== undefined) keep[k] = v;
  }
  return { id: scalar(event.id), type: scalar(event.type), data: keep, reduced: true };
}

/** The URL Rapyd signed: WEBHOOK_PUBLIC_URL when set (custom domain / proxy),
    else https://<host><path>. originalUrl because Express strips the mount path. */
function signedUrl(req) {
  if (process.env.WEBHOOK_PUBLIC_URL) return process.env.WEBHOOK_PUBLIC_URL.trim();
  const host = req.headers?.host;
  const path = String(req.originalUrl || req.url || '').split('?')[0];
  return host ? `https://${host}${path}` : '';
}

const header = (req, name) => {
  const v = req.headers?.[name];
  return typeof v === 'string' ? v : undefined;
};

/** The cus_*** an event belongs to: data.customer (payment / card events),
    else data.id when the event IS a customer object (CUSTOMER_CREATED …). */
export function customerIdOf(data = {}) {
  if (typeof data.customer === 'string' && CUS_ID.test(data.customer)) return data.customer;
  if (typeof data.id === 'string' && CUS_ID.test(data.id)) return data.id;
  return null;
}

async function pushCapped(key, value, max = LIST_MAX, ttl = LIST_TTL_SECONDS) {
  await kv(['LPUSH', key, value]);
  await kv(['LTRIM', key, '0', String(max - 1)]);
  await kv(['EXPIRE', key, String(ttl)]);
}

export default async function handler(req, res) {
  if (applyCors(req, res, METHODS)) return;
  if (req.method !== 'POST') return methodNotAllowed(res, METHODS);

  let raw;
  try {
    raw = await readRawBody(req);
  } catch (err) {
    if (err instanceof TooLarge) {
      return res.status(413).json({ error: 'PAYLOAD_TOO_LARGE', message: `Webhook body exceeds ${MAX_WEBHOOK_BYTES} bytes.` });
    }
    raw = '';
  }

  let event = {};
  try { event = raw ? JSON.parse(raw) : {}; } catch { event = {}; }
  if (!event || typeof event !== 'object' || Array.isArray(event)) event = {};

  const { verified, verified_env } = verifyWebhook({
    url: signedUrl(req),
    salt: header(req, 'salt'),
    timestamp: header(req, 'timestamp'),
    signature: header(req, 'signature'),
    body: raw,
    sandboxPairs: sandboxKeyPairs(),
    livePairs: liveKeyPairs(),
  });
  const trusted = verified === 'verified';

  const data = event.data && typeof event.data === 'object' ? event.data : {};
  const refRaw = data.merchant_reference_id || event.merchant_reference_id;
  // 'cus:' prefixed refs would alias the wh:cus:<id> customer lists — refuse them.
  const ref = typeof refRaw === 'string' && refRaw && refRaw.length <= MAX_REF_LENGTH && !refRaw.startsWith('cus:')
    ? refRaw : 'unknown';
  const cusId = customerIdOf(data);

  // Unverified: every field is clipped and `raw` is the reduced body.
  const f = trusted ? (v) => v : scalar;
  const record = {
    received_at: Date.now(),
    type: f(event.type) || 'UNKNOWN',
    verified,
    verified_env,
    event_id: f(event.id),
    payment_id: f(data.id),
    status: f(data.status),
    paid: f(data.paid),
    amount: f(data.amount),
    currency: f(data.currency_code || data.currency),
    merchant_reference_id: ref,
    raw: trusted ? event : reducedRaw(event, data),
  };

  // Strict mode: an unsigned/forged event is acknowledged (so a real Rapyd
  // retry storm can't start) but never stored where the frontend would read it.
  const requireSig = process.env.WEBHOOK_REQUIRE_SIGNATURE === 'true';
  if (requireSig && verified !== 'verified') {
    return res.status(200).json({ received: true, verified, stored: false });
  }

  let stored = false;
  try {
    if (kvConfigured()) {
      const value = JSON.stringify(record);
      const writes = [];
      // 'whu:' can't collide with 'wh:<ref>' (3rd char differs), and a ref
      // can't start with 'cus:', so whu:<ref> never aliases whu:cus:<id>.
      const [ns, max, ttl] = trusted
        ? ['wh', LIST_MAX, LIST_TTL_SECONDS]
        : ['whu', UNVERIFIED_LIST_MAX, UNVERIFIED_TTL_SECONDS];
      if (ref !== 'unknown') writes.push(pushCapped(`${ns}:${ref}`, value, max, ttl));
      if (cusId) writes.push(pushCapped(`${ns}:cus:${cusId}`, value, max, ttl));
      await Promise.all(writes);
      stored = writes.length > 0;
      // No global wh:recent list any more — it handed every visitor the last
      // 100 events (PII) of every session. Reads are by ref or cus_*** only.
    }
  } catch (err) {
    console.error('webhook store error:', err.message);
  }

  // Always 200 so Rapyd considers the webhook delivered.
  return res.status(200).json({ received: true, verified, stored });
}
