import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import handler, {
  verifyWebhookSignature, verifyWebhook, reducedRaw, customerIdOf, readRawBody, MAX_WEBHOOK_BYTES,
} from '../api/webhook.js';
import { useCleanEnv, fakeReq, fakeRes } from './_helpers.js';

function sign(url, salt, timestamp, ak, sk, body) {
  const hex = crypto.createHmac('sha256', sk).update(url + salt + timestamp + ak + sk + body).digest('hex');
  const b64 = Buffer.from(hex).toString('base64');
  return { b64, b64url: b64.replace(/\+/g, '-').replace(/\//g, '_') };
}

const URL_ = 'https://hooks.example/api/webhook';
const BODY = JSON.stringify({ id: 'wh_1', type: 'PAYMENT_COMPLETED', data: { id: 'payment_1', merchant_reference_id: 'ref_1' } });
const PAIRS = [['ak_other', 'sk_other'], ['ak1', 'sk1']];

describe('verifyWebhookSignature', () => {
  const base = { url: URL_, salt: 'salt123', timestamp: '1700000000', body: BODY, keyPairs: PAIRS };

  test('standard base64 from any configured pair → verified', () => {
    const { b64 } = sign(URL_, 'salt123', '1700000000', 'ak1', 'sk1', BODY);
    assert.equal(verifyWebhookSignature({ ...base, signature: b64 }), 'verified');
  });

  test('url-safe base64 variant → verified', () => {
    // base64 of an ASCII hex digest never yields + or / (every 6-bit group
    // of [0-9a-f] bytes stays below 62), so both encodings coincide — the
    // receiver still accepts either form defensively.
    for (const salt of ['a', 'b', 'c', 'salt123']) {
      const s = sign(URL_, salt, '1700000000', 'ak1', 'sk1', BODY);
      assert.equal(s.b64, s.b64url);
      assert.equal(verifyWebhookSignature({ ...base, salt, signature: s.b64url }), 'verified');
    }
  });

  test('wrong key / tampered body / wrong url / missing salt → unverified', () => {
    const { b64 } = sign(URL_, 'salt123', '1700000000', 'ak1', 'sk1', BODY);
    assert.equal(verifyWebhookSignature({ ...base, signature: b64, keyPairs: [['ak1', 'nope']] }), 'unverified');
    assert.equal(verifyWebhookSignature({ ...base, signature: b64, body: BODY.replace('ref_1', 'ref_2') }), 'unverified');
    assert.equal(verifyWebhookSignature({ ...base, signature: b64, url: 'https://evil.example/api/webhook' }), 'unverified');
    assert.equal(verifyWebhookSignature({ ...base, signature: b64, salt: undefined }), 'unverified');
    assert.equal(verifyWebhookSignature({ ...base, signature: 'forged' }), 'unverified');
  });

  test('nothing to check → skipped', () => {
    assert.equal(verifyWebhookSignature({ ...base, signature: undefined }), 'skipped');
    assert.equal(verifyWebhookSignature({ ...base, signature: 'x', body: '' }), 'skipped');
    assert.equal(verifyWebhookSignature({ ...base, signature: 'x', keyPairs: [] }), 'skipped');
  });
});

describe('verifyWebhook (which environment signed it)', () => {
  const base = { url: URL_, salt: 'salt123', timestamp: '1700000000', body: BODY };
  const { b64: sbSig } = sign(URL_, 'salt123', '1700000000', 'ak1', 'sk1', BODY);
  const { b64: lvSig } = sign(URL_, 'salt123', '1700000000', 'akL', 'skL', BODY);
  const pairs = { sandboxPairs: [['ak1', 'sk1']], livePairs: [['akL', 'skL']] };

  test('sandbox pair → sandbox, live pair → live', () => {
    assert.deepEqual(verifyWebhook({ ...base, ...pairs, signature: sbSig }), { verified: 'verified', verified_env: 'sandbox' });
    assert.deepEqual(verifyWebhook({ ...base, ...pairs, signature: lvSig }), { verified: 'verified', verified_env: 'live' });
  });

  test('forged → unverified; nothing to check → skipped (env null)', () => {
    assert.deepEqual(verifyWebhook({ ...base, ...pairs, signature: 'forged' }), { verified: 'unverified', verified_env: null });
    assert.deepEqual(verifyWebhook({ ...base, ...pairs, signature: undefined }), { verified: 'skipped', verified_env: null });
    assert.deepEqual(verifyWebhook({ ...base, sandboxPairs: [], livePairs: [], signature: sbSig }), { verified: 'skipped', verified_env: null });
    // live keys absent: a bad signature is still 'unverified', not 'skipped'
    assert.deepEqual(verifyWebhook({ ...base, sandboxPairs: [['ak1', 'sk1']], livePairs: [], signature: lvSig }), { verified: 'unverified', verified_env: null });
  });
});

describe('reducedRaw (unverified events)', () => {
  test('keeps only clipped scalar payment fields', () => {
    const r = reducedRaw(
      { id: 'wh_1', type: 'PAYMENT_COMPLETED', extra: 'x' },
      { id: 'payment_1', status: 'CLO', paid: true, amount: 1, merchant_reference_id: 'r'.repeat(500),
        payment_method_data: { last4: '1111' }, customer: { id: 'cus_1' } },
    );
    assert.deepEqual(Object.keys(r.data).sort(), ['amount', 'id', 'merchant_reference_id', 'paid', 'status']);
    assert.equal(r.data.merchant_reference_id.length, 128);
    assert.equal(r.reduced, true);
    assert.equal(r.extra, undefined);
  });
});

describe('customerIdOf', () => {
  test('data.customer first, then a cus_ data.id, else null', () => {
    assert.equal(customerIdOf({ customer: 'cus_abc', id: 'payment_1' }), 'cus_abc');
    assert.equal(customerIdOf({ id: 'cus_def' }), 'cus_def');
    assert.equal(customerIdOf({ id: 'payment_1' }), null);
    assert.equal(customerIdOf({ customer: 'cus_x;DEL', id: 'card_1' }), null);
    assert.equal(customerIdOf({ customer: { id: 'cus_1' } }), null);
    assert.equal(customerIdOf(), null);
  });
});

describe('readRawBody', () => {
  test('prefers req.rawBodyString (Express)', async () => {
    assert.equal(await readRawBody({ rawBodyString: BODY, headers: {} }), BODY);
  });

  test('reads an open stream exactly', async () => {
    const req = Readable.from([Buffer.from(BODY.slice(0, 10)), Buffer.from(BODY.slice(10))]);
    req.headers = {};
    assert.equal(await readRawBody(req), BODY);
  });

  test('already-consumed stream never hangs; falls back to the parsed body', async () => {
    const parsed = JSON.parse(BODY);
    assert.equal(await readRawBody({ readableEnded: true, on() {}, headers: {}, body: parsed }), BODY);
    assert.equal(await readRawBody({ readableEnded: true, on() {}, headers: {}, body: Buffer.from(BODY) }), BODY);
    assert.equal(await readRawBody({ headers: {} }), '');
  });

  test('size cap: content-length, stream and rawBodyString', async () => {
    await assert.rejects(readRawBody({ headers: { 'content-length': String(MAX_WEBHOOK_BYTES + 1) } }));
    const big = Readable.from([Buffer.alloc(MAX_WEBHOOK_BYTES), Buffer.alloc(10)]);
    big.headers = {};
    await assert.rejects(readRawBody(big));
    await assert.rejects(readRawBody({ headers: {}, rawBodyString: 'x'.repeat(MAX_WEBHOOK_BYTES + 1) }));
  });
});

describe('webhook handler (no KV configured)', () => {
  useCleanEnv();
  const post = (extra = {}) => fakeReq({ method: 'POST', headers: { host: 'hooks.example', ...extra.headers }, originalUrl: '/api/webhook', url: '/', rawBodyString: BODY, ...extra.req });

  test('unsigned event: 200, skipped, not stored', async () => {
    const res = fakeRes();
    await handler(post(), res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { received: true, verified: 'skipped', stored: false });
  });

  test('signature over https://<host><originalUrl> verifies (Express mount path)', async () => {
    process.env.RAPYD_SC1_ACCESS_KEY = 'ak1';
    process.env.RAPYD_SC1_SECRET_KEY = 'sk1';
    const { b64url } = sign(URL_, 'salt123', '1700000000', 'ak1', 'sk1', BODY);
    const res = fakeRes();
    await handler(post({ headers: { salt: 'salt123', timestamp: '1700000000', signature: b64url } }), res);
    assert.equal(res.body.verified, 'verified');
  });

  test('WEBHOOK_PUBLIC_URL overrides the signed URL', async () => {
    process.env.RAPYD_SC1_ACCESS_KEY = 'ak1';
    process.env.RAPYD_SC1_SECRET_KEY = 'sk1';
    process.env.WEBHOOK_PUBLIC_URL = 'https://public.example/hooks/rapyd';
    const { b64 } = sign('https://public.example/hooks/rapyd', 'salt123', '1700000000', 'ak1', 'sk1', BODY);
    const res = fakeRes();
    await handler(post({ headers: { salt: 'salt123', timestamp: '1700000000', signature: b64 } }), res);
    assert.equal(res.body.verified, 'verified');
  });

  test('WEBHOOK_REQUIRE_SIGNATURE=true: unverified is acknowledged but not stored', async () => {
    process.env.WEBHOOK_REQUIRE_SIGNATURE = 'true';
    process.env.RAPYD_SC1_ACCESS_KEY = 'ak1';
    process.env.RAPYD_SC1_SECRET_KEY = 'sk1';
    const res = fakeRes();
    await handler(post({ headers: { salt: 's', timestamp: '1', signature: 'forged' } }), res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { received: true, verified: 'unverified', stored: false });
  });

  test('oversized body → 413; GET → 405; OPTIONS → 204', async () => {
    const big = fakeRes();
    await handler(post({ req: { rawBodyString: 'x'.repeat(MAX_WEBHOOK_BYTES + 1) } }), big);
    assert.equal(big.statusCode, 413);
    assert.equal(big.body.error, 'PAYLOAD_TOO_LARGE');

    const get = fakeRes();
    await handler(fakeReq({ method: 'GET' }), get);
    assert.equal(get.statusCode, 405);

    const pre = fakeRes();
    await handler(fakeReq({ method: 'OPTIONS' }), pre);
    assert.equal(pre.statusCode, 204);
  });

  test('non-JSON body is acknowledged, not stored', async () => {
    const res = fakeRes();
    await handler(post({ req: { rawBodyString: 'not json' } }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.stored, false);
  });
});
