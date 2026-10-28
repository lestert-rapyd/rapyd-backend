import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HttpError, applyCors, cleanBody, resolveEnv, idempotencyKey, assertLive, normalizeError,
  readJsonBody, ALLOWED_HEADERS,
} from '../utils/http.js';
import { useCleanEnv, fakeReq, fakeRes, LIVE_TOKEN } from './_helpers.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('cleanBody', () => {
  test('strips env/profile/idempotency_key without mutating the input', () => {
    const input = { env: 'live', profile: 'SC2', idempotency_key: 'k', amount: 1, nested: { env: 'kept' } };
    const out = cleanBody(input);
    assert.deepEqual(out, { amount: 1, nested: { env: 'kept' } });
    assert.equal(input.env, 'live', 'input untouched');
  });
  test('non-objects become {}', () => {
    assert.deepEqual(cleanBody(null), {});
    assert.deepEqual(cleanBody(undefined), {});
    assert.deepEqual(cleanBody('x'), {});
    assert.deepEqual(cleanBody([1, 2]), {});
  });
});

describe('resolveEnv', () => {
  test('sandbox unless env is exactly "live"; profile defaults to SC1', () => {
    assert.deepEqual(resolveEnv({}), { env: 'sandbox', profile: 'SC1' });
    assert.deepEqual(resolveEnv(undefined), { env: 'sandbox', profile: 'SC1' });
    assert.deepEqual(resolveEnv({ env: 'live', profile: 'SC3' }), { env: 'live', profile: 'SC3' });
    assert.deepEqual(resolveEnv({ env: 'LIVE' }), { env: 'sandbox', profile: 'SC1' });
    assert.deepEqual(resolveEnv({ env: ['live'] }), { env: 'sandbox', profile: 'SC1' });
  });
  test('explicit unknown profile → HttpError 400 UNKNOWN_PROFILE', () => {
    assert.throws(() => resolveEnv({ profile: 'SC9' }), (e) =>
      e instanceof HttpError && e.status === 400 && e.body.error === 'UNKNOWN_PROFILE');
  });
});

describe('idempotencyKey', () => {
  test('forwards a well-formed header', () => {
    const k = 'pb-3f2a.9b:01_x';
    assert.equal(idempotencyKey(fakeReq({ headers: { 'idempotency-key': k } })), k);
  });
  test('generates a UUID when missing or malformed', () => {
    assert.match(idempotencyKey(fakeReq()), UUID);
    for (const bad of ['short', 'has space in it', 'x'.repeat(101), 'semi;colon-key', ['abcdefgh1']]) {
      assert.match(idempotencyKey(fakeReq({ headers: { 'idempotency-key': bad } })), UUID, String(bad));
    }
  });
  test('fresh per call when not supplied', () => {
    assert.notEqual(idempotencyKey(fakeReq()), idempotencyKey(fakeReq()));
  });
});

describe('readJsonBody', () => {
  test('object, JSON string, Buffer, empty', () => {
    assert.deepEqual(readJsonBody({ body: { a: 1 } }), { a: 1 });
    assert.deepEqual(readJsonBody({ body: '{"a":1}' }), { a: 1 });
    assert.deepEqual(readJsonBody({ body: Buffer.from('{"a":1}') }), { a: 1 });
    assert.deepEqual(readJsonBody({ body: undefined }), {});
    assert.deepEqual(readJsonBody({ body: '  ' }), {});
  });
  test('invalid JSON, arrays and a throwing getter → 400 INVALID_BODY', () => {
    const is400 = (e) => e instanceof HttpError && e.status === 400 && e.body.error === 'INVALID_BODY';
    assert.throws(() => readJsonBody({ body: '{nope' }), is400);
    assert.throws(() => readJsonBody({ body: [1] }), is400);
    assert.throws(() => readJsonBody({ get body() { throw new Error('bad json'); } }), is400);
  });
});

describe('assertLive', () => {
  useCleanEnv();

  test('no-op in sandbox, even with a card body', () => {
    assert.doesNotThrow(() => assertLive(fakeReq(), 'sandbox', 'create-direct-payment',
      { payment_method: { fields: { number: '4111', cvv: '1' } } }));
  });
  test('live: gate first (403 / 401), then body guards', () => {
    const req = fakeReq({ headers: { 'x-paybridge-live-token': LIVE_TOKEN } });
    assert.throws(() => assertLive(req, 'live', 'create-refund', { amount: 0.01 }),
      (e) => e.status === 403 && e.body.error === 'LIVE_DISABLED');
    process.env.PAYBRIDGE_LIVE_TOKEN = LIVE_TOKEN;
    assert.throws(() => assertLive(fakeReq(), 'live', 'create-refund', { amount: 0.01 }),
      (e) => e.status === 401 && e.body.error === 'LIVE_AUTH_REQUIRED');
    assert.throws(() => assertLive(req, 'live', 'create-refund', { payment: 'payment_1' }),
      (e) => e.status === 400 && e.body.error === 'LIVE_LIMIT' && !('status' in e.body));
    assert.doesNotThrow(() => assertLive(req, 'live', 'create-refund', { payment: 'payment_1', amount: 0.01, currency: 'USD' }));
    assert.doesNotThrow(() => assertLive(req, 'live'), 'GETs: gate only');
  });
});

describe('normalizeError', () => {
  const rapyd = (status, data) => Object.assign(new Error('axios'), { isAxiosError: true, response: { status, data } });

  test('HttpError passes through', () => {
    const { status, body } = normalizeError(new HttpError(500, { error: 'MISSING_KEYS', message: 'm' }));
    assert.equal(status, 500);
    assert.deepEqual(body, { error: 'MISSING_KEYS', message: 'm' });
  });

  test('mapped Rapyd 4xx keeps its status and friendly copy', () => {
    const st = { error_code: 'ERROR_PROCESSING_CARD - [05]', status: 'ERROR', message: 'Do not honor' };
    const { status, body } = normalizeError(rapyd(400, { status: st }));
    assert.equal(status, 400);
    assert.equal(body.error, 'DO_NOT_HONOR');
    assert.equal(body.message, 'Your card was declined by the bank.');
    assert.ok(body.hint);
    assert.deepEqual(body.raw, st);
  });

  test('unmapped Rapyd 4xx falls back to Rapyd\'s own code + message', () => {
    const st = { error_code: 'ERROR_GET_PAYMENT', message: 'The requested payment was not found.' };
    const { status, body } = normalizeError(rapyd(404, { status: st }));
    assert.equal(status, 404);
    assert.equal(body.error, 'ERROR_GET_PAYMENT');
    assert.equal(body.message, 'The requested payment was not found.');
    assert.equal(body.hint, undefined);
  });

  test('Rapyd 5xx → 502 with a non-empty raw', () => {
    const { status, body } = normalizeError(rapyd(503, '<html>down</html>'));
    assert.equal(status, 502);
    assert.equal(body.error, 'RAPYD_UPSTREAM_ERROR');
    assert.deepEqual(body.raw, { http_status: 503 });
  });

  test('timeout → 504, no response → 502, unknown → 500', () => {
    assert.equal(normalizeError(Object.assign(new Error('t'), { code: 'ECONNABORTED' })).status, 504);
    assert.equal(normalizeError(Object.assign(new Error('t'), { code: 'ETIMEDOUT' })).body.error, 'UPSTREAM_TIMEOUT');
    const net = normalizeError(Object.assign(new Error('n'), { isAxiosError: true, code: 'ENOTFOUND', request: {} }));
    assert.equal(net.status, 502);
    assert.equal(net.body.error, 'UPSTREAM_UNREACHABLE');
    const boom = normalizeError(new TypeError('x'));
    assert.equal(boom.status, 500);
    assert.equal(boom.body.error, 'INTERNAL_ERROR');
  });

  test('resolveKeys UNKNOWN_PROFILE error → 400', () => {
    const e = Object.assign(new Error('u'), { code: 'UNKNOWN_PROFILE' });
    assert.equal(normalizeError(e).status, 400);
    assert.equal(normalizeError(e).body.error, 'UNKNOWN_PROFILE');
  });
});

describe('applyCors', () => {
  useCleanEnv();

  test('no ALLOWED_ORIGINS → "*"; non-OPTIONS returns false', () => {
    const res = fakeRes();
    assert.equal(applyCors(fakeReq({ method: 'POST', headers: { origin: 'https://a.example' } }), res, ['POST']), false);
    assert.equal(res.headers['access-control-allow-origin'], '*');
    assert.equal(res.ended, false);
  });

  test('preflight answered with 204 + methods + headers', () => {
    const res = fakeRes();
    assert.equal(applyCors(fakeReq({ method: 'OPTIONS' }), res, ['POST']), true);
    assert.equal(res.statusCode, 204);
    assert.equal(res.ended, true);
    assert.equal(res.headers['access-control-allow-methods'], 'POST, OPTIONS');
    assert.equal(res.headers['access-control-allow-headers'], ALLOWED_HEADERS);
    assert.match(ALLOWED_HEADERS, /X-PayBridge-Live-Token/);
    assert.match(ALLOWED_HEADERS, /Idempotency-Key/);
  });

  test('ALLOWED_ORIGINS echoes only listed origins and sets Vary', () => {
    process.env.ALLOWED_ORIGINS = 'https://a.example, https://b.example/';
    const ok = fakeRes();
    applyCors(fakeReq({ method: 'GET', headers: { origin: 'https://b.example' } }), ok, ['GET']);
    assert.equal(ok.headers['access-control-allow-origin'], 'https://b.example');
    assert.equal(ok.headers.vary, 'Origin');

    const evil = fakeRes();
    applyCors(fakeReq({ method: 'GET', headers: { origin: 'https://evil.example' } }), evil, ['GET']);
    assert.equal(evil.headers['access-control-allow-origin'], undefined);
    assert.equal(evil.headers.vary, 'Origin');
  });
});
