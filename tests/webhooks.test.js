import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import handler, { parseWebhookQuery, MAX_REFS, MAX_REF_LENGTH } from '../api/webhooks.js';
import { useCleanEnv, fakeReq, fakeRes } from './_helpers.js';

describe('parseWebhookQuery', () => {
  test('ref / refs / customer modes', () => {
    assert.deepEqual(parseWebhookQuery({ ref: 'pb_ecommerce_1' }), { mode: 'ref', ref: 'pb_ecommerce_1' });
    assert.deepEqual(parseWebhookQuery({ refs: ' a , b ,,a' }), { mode: 'refs', refs: ['a', 'b'] });
    assert.deepEqual(parseWebhookQuery({ customer: 'cus_ABC123' }), { mode: 'customer', customer: 'cus_ABC123' });
  });

  test('refs takes precedence over ref', () => {
    assert.equal(parseWebhookQuery({ refs: 'a', ref: 'b' }).mode, 'refs');
  });

  test('no scope → 400 MISSING_REF (no global list any more)', () => {
    for (const q of [{}, undefined, { ref: '' }, { refs: '' }, { customer: '' }]) {
      const r = parseWebhookQuery(q);
      assert.equal(r.status, 400);
      assert.equal(r.body.error, 'MISSING_REF');
    }
  });

  test('refs: capped at 20, over-long and cus:-prefixed refs dropped', () => {
    const many = Array.from({ length: 25 }, (_, i) => `r${i}`).join(',');
    assert.equal(parseWebhookQuery({ refs: many }).refs.length, MAX_REFS);
    const long = 'x'.repeat(MAX_REF_LENGTH + 1);
    assert.deepEqual(parseWebhookQuery({ refs: `${long},ok,cus:cus_1` }).refs, ['ok']);
    assert.equal(parseWebhookQuery({ refs: long }).body.error, 'MISSING_REF');
    assert.equal(parseWebhookQuery({ refs: ['a', 'b'] }).body.error, 'INVALID_REF');
  });

  test('ref and customer validation', () => {
    assert.equal(parseWebhookQuery({ ref: 'x'.repeat(MAX_REF_LENGTH + 1) }).body.error, 'INVALID_REF');
    assert.equal(parseWebhookQuery({ ref: 'x'.repeat(MAX_REF_LENGTH) }).mode, 'ref');
    assert.equal(parseWebhookQuery({ ref: 'cus:cus_1' }).body.error, 'INVALID_REF');
    assert.equal(parseWebhookQuery({ ref: ['a'] }).body.error, 'INVALID_REF');
    for (const bad of ['cus_', 'payment_1', 'cus_ab-c', 'cus_1*', ['cus_1']]) {
      assert.equal(parseWebhookQuery({ customer: bad }).body.error, 'INVALID_CUSTOMER', String(bad));
    }
  });
});

describe('GET /api/webhooks handler (no KV configured)', () => {
  useCleanEnv();
  const call = async (query, method = 'GET') => {
    const res = fakeRes();
    await handler(fakeReq({ method, query }), res);
    return res;
  };

  test('shapes per mode, configured:false', async () => {
    assert.deepEqual((await call({ ref: 'r1' })).body, { events: [], configured: false });
    assert.deepEqual((await call({ refs: 'r1,r2' })).body, { byRef: {}, configured: false });
    assert.deepEqual((await call({ customer: 'cus_abc' })).body, { events: [], configured: false });
  });

  test('validation errors are 400 even without KV', async () => {
    const none = await call({});
    assert.equal(none.statusCode, 400);
    assert.equal(none.body.error, 'MISSING_REF');
    assert.equal((await call({ customer: 'nope' })).statusCode, 400);
  });

  test('method + preflight', async () => {
    assert.equal((await call({ ref: 'r1' }, 'POST')).statusCode, 405);
    const pre = await call(undefined, 'OPTIONS');
    assert.equal(pre.statusCode, 204);
    assert.equal(pre.headers['access-control-allow-methods'], 'GET, OPTIONS');
  });
});
