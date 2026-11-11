// Proxy handlers, exercised only up to the point BEFORE any network call:
// useCleanEnv() strips every RAPYD_* key, so a request that clears all
// guards stops at 500 MISSING_KEYS — Rapyd is never contacted.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import createDirectPayment, { withGatewayMerchantId } from '../api/create-direct-payment.js';
import createRefund from '../api/create-refund.js';
import createCustomer from '../handlers/customers/create-customer.js';
import createCheckoutSession from '../api/create-checkout-session.js';
import retrievePayment from '../api/retrieve-payment.js';
import retrieveCustomer from '../handlers/customers/retrieve-customer.js';
import listCustomerPaymentMethods from '../handlers/customers/list-customer-payment-methods.js';
import addCustomerPaymentMethod from '../handlers/customers/add-payment-method.js';
import createCardTokenPage from '../handlers/customers/card-token-page.js';
import customersApi from '../api/customers.js';
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
  const posts = [createDirectPayment, createRefund, createCustomer, createCheckoutSession, addCustomerPaymentMethod, createCardTokenPage];

  test('preflight 204 with the contract headers; wrong method 405', async () => {
    for (const h of posts) {
      const pre = await run(h, { method: 'OPTIONS' });
      assert.equal(pre.statusCode, 204);
      assert.equal(pre.headers['access-control-allow-headers'], 'Content-Type, X-PayBridge-Live-Token, X-PayBridge-Admin-Token, Idempotency-Key');
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

  test('add-customer-payment-method: customer id required; refused in live (raw card, no allowlist)', async () => {
    const bad = await run(addCustomerPaymentMethod, { method: 'POST', body: { customer: 'nope', type: 'gb_visa_card' } });
    assert.equal(bad.statusCode, 400);
    assert.equal(bad.body.error, 'INVALID_ID');
    process.env.PAYBRIDGE_LIVE_TOKEN = LIVE_TOKEN;
    const lv = await run(addCustomerPaymentMethod, { method: 'POST', headers: live, body: {
      env: 'live', customer: 'cus_abc', type: 'gb_visa_card', fields: { number: '4111111111111111', cvv: '123' },
    } });
    assert.equal(lv.statusCode, 400);
    assert.equal(lv.body.error, 'LIVE_RAW_CARD_FORBIDDEN');
  });

  test('create-card-token-page: allowlisted in live, stops at MISSING_KEYS', async () => {
    process.env.PAYBRIDGE_LIVE_TOKEN = LIVE_TOKEN;
    const ok = await run(createCardTokenPage, { method: 'POST', headers: live, body: {
      env: 'live', customer: 'cus_abc', country: 'GB', card_fields: { recurrence_type: 'unscheduled' },
    } });
    assert.equal(ok.body.error, 'MISSING_KEYS');
    const extra = await run(createCardTokenPage, { method: 'POST', headers: live, body: { env: 'live', customer: 'cus_abc', metadata: {} } });
    assert.equal(extra.body.error, 'LIVE_FIELD_NOT_ALLOWED');
  });

  test('api/customers dispatches by op; unknown op → 404', async () => {
    assert.equal((await run(customersApi, { method: 'POST', query: { op: 'nope' } })).statusCode, 404);
    assert.equal((await run(customersApi, { query: { op: 'retrieve', id: 'nope' } })).statusCode, 400);
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

describe('withGatewayMerchantId', () => {
  const gd = (dd) => ({ amount: 1, payment_method: { type: 'gb_visa_card', digital_wallet: { type: 'google_pay', details: { decrypted_data: dd, brand_data: { cardNetwork: 'VISA' } } } } });
  test('writes the access key into a Google Pay decrypted_data, without mutating the input', () => {
    const body = gd({ gatewayMerchantId: 'RAPYD_ACCESS_KEY', messageId: 'm' });
    const out = withGatewayMerchantId(body, 'rak_123');
    assert.equal(out.payment_method.digital_wallet.details.decrypted_data.gatewayMerchantId, 'rak_123');
    assert.equal(out.payment_method.digital_wallet.details.decrypted_data.messageId, 'm');
    assert.deepEqual(out.payment_method.digital_wallet.details.brand_data, { cardNetwork: 'VISA' });
    assert.equal(body.payment_method.digital_wallet.details.decrypted_data.gatewayMerchantId, 'RAPYD_ACCESS_KEY');
  });
  test('leaves everything else alone', () => {
    const apple = { payment_method: { digital_wallet: { type: 'apple_pay', details: { decrypted_data: { applicationPrimaryAccountNumber: '4' } } } } };
    const enc = { payment_method: { digital_wallet: { type: 'google_pay', details: { token: {} } } } };
    for (const b of [apple, enc, { payment_method: 'card_abc' }, {}]) assert.equal(withGatewayMerchantId(b, 'rak_123'), b);
    const g = gd({});
    assert.equal(withGatewayMerchantId(g, ''), g, 'no key, no change');
  });
});
