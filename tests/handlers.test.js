// Proxy handlers, exercised only up to the point BEFORE any network call:
// useCleanEnv() strips every RAPYD_* key, so a request that clears all
// guards stops at 500 MISSING_KEYS — Rapyd is never contacted.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import createDirectPayment from '../api/create-direct-payment.js';
import createRefund from '../api/create-refund.js';
import createCustomer from '../api/create-customer.js';
import createCheckoutSession from '../api/create-checkout-session.js';
import retrievePayment from '../api/retrieve-payment.js';
import retrieveCustomer from '../api/retrieve-customer.js';
import listCustomerPaymentMethods from '../api/list-customer-payment-methods.js';
import getFxRate from '../api/get-fx-rate.js';
import { useCleanEnv, fakeReq, fakeRes, LIVE_TOKEN } from './_helpers.js';

async function run(handler, reqInit) {
  const res = fakeRes();
  await handler(fakeReq(reqInit), res);
  return res;
}
const live = { 'x-paybridge-live-token': LIVE_TOKEN };

describe('POST proxies', () => {
  useCleanEnv();
  const posts = [createDirectPayment, createRefund, createCustomer, createCheckoutSession];

  test('preflight 204 with the contract headers; wrong method 405', async () => {
    for (const h of posts) {
      const pre = await run(h, { method: 'OPTIONS' });
      assert.equal(pre.statusCode, 204);
      assert.equal(pre.headers['access-control-allow-headers'], 'Content-Type, X-PayBridge-Live-Token, Idempotency-Key');
      assert.equal((await run(h, { method: 'GET' })).statusCode, 405);
    }
  });

  test('unknown profile → 400 UNKNOWN_PROFILE', async () => {
    for (const h of posts) {
      const res = await run(h, { method: 'POST', body: { profile: 'SC9', amount: 1 } });
      assert.equal(res.statusCode, 400);
      assert.equal(res.body.error, 'UNKNOWN_PROFILE');
    }
  });

  test('live without PAYBRIDGE_LIVE_TOKEN → 403; wrong token → 401', async () => {
    for (const h of posts) {
      const res = await run(h, { method: 'POST', headers: live, body: { env: 'live', amount: 0.01 } });
      assert.equal(res.statusCode, 403);
      assert.equal(res.body.error, 'LIVE_DISABLED');
    }
    process.env.PAYBRIDGE_LIVE_TOKEN = LIVE_TOKEN;
    for (const h of posts) {
      const res = await run(h, { method: 'POST', headers: { 'x-paybridge-live-token': 'wrong' }, body: { env: 'live', amount: 0.01 } });
      assert.equal(res.statusCode, 401);
      assert.equal(res.body.error, 'LIVE_AUTH_REQUIRED');
    }
  });

  test('live guards run before keys', async () => {
    process.env.PAYBRIDGE_LIVE_TOKEN = LIVE_TOKEN;
    const card = await run(createDirectPayment, { method: 'POST', headers: live, body: {
      env: 'live', profile: 'SC1', amount: 0.01, currency: 'USD',
      payment_method: { type: 'us_visa_card', fields: { number: '4111111111111111', cvv: '123' } },
    } });
    assert.equal(card.statusCode, 400);
    assert.equal(card.body.error, 'LIVE_RAW_CARD_FORBIDDEN');

    const big = await run(createCheckoutSession, { method: 'POST', headers: live, body: { env: 'live', amount: 149, currency: 'USD' } });
    assert.equal(big.body.error, 'LIVE_LIMIT');

    const extra = await run(createRefund, { method: 'POST', headers: live, body: { env: 'live', payment: 'payment_1', amount: 0.01, metadata: {} } });
    assert.equal(extra.body.error, 'LIVE_FIELD_NOT_ALLOWED');
    assert.deepEqual(extra.body.fields, ['metadata']);
  });

  test('a valid live request clears every guard and stops at MISSING_KEYS (500)', async () => {
    process.env.PAYBRIDGE_LIVE_TOKEN = LIVE_TOKEN;
    const res = await run(createDirectPayment, { method: 'POST', headers: live, body: {
      env: 'live', profile: 'SC1', amount: 0.01, currency: 'USD', payment_method: 'card_abc', customer: 'cus_abc',
    } });
    assert.equal(res.statusCode, 500);
    assert.equal(res.body.error, 'MISSING_KEYS');
  });

  test('sandbox needs no token; missing keys → 500 MISSING_KEYS', async () => {
    const res = await run(createRefund, { method: 'POST', body: { profile: 'SC2', payment: 'payment_1' } });
    assert.equal(res.statusCode, 500);
    assert.equal(res.body.error, 'MISSING_KEYS');
    assert.equal(res.headers['access-control-allow-origin'], '*', 'CORS on error paths too');
  });

  test('non-object body → 400 INVALID_BODY', async () => {
    const res = await run(createCustomer, { method: 'POST', body: '[1,2]' });
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, 'INVALID_BODY');
  });
});

describe('GET proxies', () => {
  useCleanEnv();

  test('id validation is kept', async () => {
    assert.equal((await run(retrievePayment, { query: { id: 'payment_zz!' } })).statusCode, 400);
    assert.equal((await run(retrieveCustomer, { query: { id: 'nope' } })).statusCode, 400);
    assert.equal((await run(listCustomerPaymentMethods, { query: {} })).statusCode, 400);
    assert.equal((await run(getFxRate, { query: { buy_currency: 'USD', sell_currency: 'USD' } })).statusCode, 400);
  });

  test('live GETs are gated too', async () => {
    const r1 = await run(retrievePayment, { headers: live, query: { id: 'payment_abc', env: 'live' } });
    assert.equal(r1.statusCode, 403);
    process.env.PAYBRIDGE_LIVE_TOKEN = LIVE_TOKEN;
    const r2 = await run(getFxRate, { query: { buy_currency: 'USD', sell_currency: 'EUR', env: 'live' } });
    assert.equal(r2.statusCode, 401);
    const r3 = await run(retrieveCustomer, { headers: live, query: { id: 'cus_abc', env: 'live' } });
    assert.equal(r3.statusCode, 500, 'passes the gate, stops at MISSING_KEYS');
  });

  test('unknown profile → 400', async () => {
    const res = await run(listCustomerPaymentMethods, { query: { customer: 'cus_abc', profile: 'XX' } });
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, 'UNKNOWN_PROFILE');
  });
});
