import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  liveGate, liveGuardError, hasRawCard, liveMaxAmount, safeEqual, LIVE_ALLOWED_FIELDS,
} from '../utils/live-guards.js';
import { useCleanEnv, fakeReq, LIVE_TOKEN } from './_helpers.js';

const withToken = (token) => fakeReq({ headers: token === undefined ? {} : { 'x-paybridge-live-token': token } });

describe('safeEqual', () => {
  test('equal / different / different length', () => {
    assert.equal(safeEqual('abc', 'abc'), true);
    assert.equal(safeEqual('abc', 'abd'), false);
    assert.equal(safeEqual('abc', 'abcd'), false);
    assert.equal(safeEqual('', ''), true);
  });
});

describe('liveGate', () => {
  useCleanEnv();

  test('sandbox is never gated', () => {
    assert.equal(liveGate(withToken(undefined), 'sandbox'), null);
    assert.equal(liveGate(withToken(undefined), undefined), null);
  });

  test('token env unset → 403 LIVE_DISABLED', () => {
    const g = liveGate(withToken(LIVE_TOKEN), 'live');
    assert.equal(g.status, 403);
    assert.equal(g.error, 'LIVE_DISABLED');
    assert.ok(g.message);
  });

  test('token env too short → 403 LIVE_DISABLED', () => {
    process.env.PAYBRIDGE_LIVE_TOKEN = 'short';
    const g = liveGate(withToken('short'), 'live');
    assert.equal(g.status, 403);
    assert.equal(g.error, 'LIVE_DISABLED');
  });

  test('header missing → 401 LIVE_AUTH_REQUIRED', () => {
    process.env.PAYBRIDGE_LIVE_TOKEN = LIVE_TOKEN;
    const g = liveGate(withToken(undefined), 'live');
    assert.equal(g.status, 401);
    assert.equal(g.error, 'LIVE_AUTH_REQUIRED');
  });

  test('header wrong / empty / array → 401', () => {
    process.env.PAYBRIDGE_LIVE_TOKEN = LIVE_TOKEN;
    for (const bad of [LIVE_TOKEN + 'x', '', LIVE_TOKEN.slice(0, -1), [LIVE_TOKEN]]) {
      const g = liveGate(withToken(bad), 'live');
      assert.equal(g?.status, 401, `rejects ${JSON.stringify(bad)}`);
      assert.equal(g.error, 'LIVE_AUTH_REQUIRED');
    }
  });

  test('right header → null (allowed)', () => {
    process.env.PAYBRIDGE_LIVE_TOKEN = `  ${LIVE_TOKEN}  `; // env value is trimmed
    assert.equal(liveGate(withToken(LIVE_TOKEN), 'live'), null);
  });
});

describe('liveMaxAmount', () => {
  useCleanEnv();
  test('defaults to 1; honours a positive number; ignores junk', () => {
    assert.equal(liveMaxAmount(), 1);
    process.env.LIVE_MAX_AMOUNT = '5';
    assert.equal(liveMaxAmount(), 5);
    process.env.LIVE_MAX_AMOUNT = 'abc';
    assert.equal(liveMaxAmount(), 1);
    process.env.LIVE_MAX_AMOUNT = '-3';
    assert.equal(liveMaxAmount(), 1);
    process.env.LIVE_MAX_AMOUNT = '0';
    assert.equal(liveMaxAmount(), 1);
  });
});

describe('hasRawCard', () => {
  test('detects payment_method.fields.number (with or without cvv)', () => {
    assert.equal(hasRawCard({ payment_method: { type: 'us_visa_card', fields: { number: '4111111111111111', cvv: '123' } } }), true);
    assert.equal(hasRawCard({ payment_method: { type: 'us_visa_card', fields: { number: '4111111111111111', network_reference_id: 'n' } } }), true);
  });
  test('detects a number+cvv object anywhere, incl. arrays and inline customers', () => {
    assert.equal(hasRawCard({ address: [{ number: '4111', cvv: '1' }] }), true);
    assert.equal(hasRawCard({ customer: { payment_method: { fields: { number: '4111' } } } }), true);
  });
  test('tokens, addresses and client_details are not card data', () => {
    assert.equal(hasRawCard({ payment_method: 'card_abc' }), false);
    assert.equal(hasRawCard({ address: { name: 'J', line_1: '10 Downing Street', city: 'London', country: 'GB', zip: 'SW1A 2AA' } }), false);
    assert.equal(hasRawCard({ client_details: { screen_width: 1, language: 'en' } }), false);
    assert.equal(hasRawCard({ number: '1' }), false, 'number alone is not a card');
    assert.equal(hasRawCard(null), false);
    assert.equal(hasRawCard('4111111111111111'), false);
  });
});

/* Representative live bodies, mirroring the frontend builders (after cleanBody). */
const tokenPayment = {
  amount: 0.01, currency: 'USD', capture: true, customer: 'cus_abc',
  merchant_reference_id: 'pb_ecommerce_1', statement_descriptor: 'PAYBRIDGE', description: 'Item',
  payment_method: 'card_abc', initiation_type: 'customer_present',
  payment_method_options: { '3d_required': true },
  address: { name: 'J', line_1: '1 St', city: 'London', country: 'GB', zip: 'X', state: '' },
  client_details: { time_zone_offset: 0, language: 'en', java_enabled: false, java_script_enabled: true,
    screen_color_depth: 24, screen_height: 1, screen_width: 1, accept_header: 'text/html' },
  requested_currency: 'EUR', fixed_side: 'sell', expiration: 1, save_payment_method: true,
};
const checkout = {
  amount: '0.01', capture: true, currency: 'USD', country: 'DE', customer: 'cus_abc',
  require_card_cvv: true, recurrence_type: 'unscheduled', save_payment_method: true,
  description: 'Item', statement_descriptor: 'PB', merchant_reference_id: 'r',
  complete_checkout_url: 'https://x/complete', cancel_checkout_url: 'https://x/cancel',
  custom_elements: { display_description: true, save_card_default: true },
  payment_method_type_categories: ['card'], payment_method_options: { '3d_required': false },
  requested_currency: 'EUR', fixed_side: 'buy', expiration: 1,
};
const customer = {
  name: 'Jordan Taylor', email: 'j@example.com', date_of_birth: '01/01/1990', birth_country: 'GB',
  nationality: 'GB', occupation: 'x', addresses: [{ line_1: '1 St', country: 'GB' }],
};

describe('liveGuardError', () => {
  useCleanEnv();

  test('the app\'s own live bodies pass', () => {
    assert.equal(liveGuardError('create-direct-payment', tokenPayment), null);
    assert.equal(liveGuardError('create-checkout-session', checkout), null);
    assert.equal(liveGuardError('create-refund', { payment: 'payment_1', merchant_reference_id: 'r_refund_1', amount: 0.01, currency: 'USD', reason: 'x' }), null);
    assert.equal(liveGuardError('create-customer', customer), null);
  });

  test('raw card → LIVE_RAW_CARD_FORBIDDEN (own-fields + vault MIT shapes)', () => {
    const ownFields = { ...tokenPayment, payment_method: { type: 'us_visa_card', fields: { number: '4111111111111111', expiration_month: '12', expiration_year: '30', cvv: '123', name: 'J' } } };
    const vaultMit = { ...tokenPayment, payment_method: { type: 'us_visa_card', fields: { number: '4111111111111111', network_reference_id: 'n' } } };
    assert.equal(liveGuardError('create-direct-payment', ownFields).error, 'LIVE_RAW_CARD_FORBIDDEN');
    assert.equal(liveGuardError('create-direct-payment', vaultMit).error, 'LIVE_RAW_CARD_FORBIDDEN');
    assert.equal(liveGuardError('create-direct-payment', vaultMit).status, 400);
  });

  test('fields outside the allowlist → LIVE_FIELD_NOT_ALLOWED with the field names', () => {
    const g = liveGuardError('create-direct-payment', { ...tokenPayment, ewallet: 'ewallet_x', metadata: {} });
    assert.equal(g.status, 400);
    assert.equal(g.error, 'LIVE_FIELD_NOT_ALLOWED');
    assert.deepEqual(g.fields, ['ewallet', 'metadata']);
  });

  test('routing fields must already be stripped (env is not allowlisted)', () => {
    assert.deepEqual(liveGuardError('create-customer', { ...customer, env: 'live' }).fields, ['env']);
  });

  test('unknown endpoint fails closed', () => {
    assert.equal(liveGuardError('nope', {}).error, 'LIVE_FIELD_NOT_ALLOWED');
  });

  test('amount cap: default 1', () => {
    const at = (amount) => liveGuardError('create-direct-payment', { ...tokenPayment, amount });
    assert.equal(at(1), null);
    assert.equal(at('0.5'), null);
    assert.equal(at(1.01).error, 'LIVE_LIMIT');
    assert.equal(at(0).error, 'LIVE_LIMIT');
    assert.equal(at(-1).error, 'LIVE_LIMIT');
    assert.equal(at('').error, 'LIVE_LIMIT');
    assert.equal(at('abc').error, 'LIVE_LIMIT');
    assert.equal(at(undefined).error, 'LIVE_LIMIT');
    assert.equal(liveGuardError('create-checkout-session', { ...checkout, amount: 149 }).error, 'LIVE_LIMIT');
  });

  test('amount cap honours LIVE_MAX_AMOUNT', () => {
    process.env.LIVE_MAX_AMOUNT = '5';
    assert.equal(liveGuardError('create-direct-payment', { ...tokenPayment, amount: 4.99 }), null);
    assert.equal(liveGuardError('create-direct-payment', { ...tokenPayment, amount: 5.01 }).error, 'LIVE_LIMIT');
  });

  test('a live refund must carry an amount', () => {
    const g = liveGuardError('create-refund', { payment: 'payment_1', currency: 'USD' });
    assert.equal(g.error, 'LIVE_LIMIT');
  });

  test('customers are not amount-capped', () => {
    assert.equal(liveGuardError('create-customer', { name: 'x' }), null);
  });

  test('every allowlist excludes routing fields and ewallet', () => {
    for (const list of Object.values(LIVE_ALLOWED_FIELDS)) {
      for (const f of ['env', 'profile', 'idempotency_key', 'ewallet']) assert.ok(!list.includes(f), f);
    }
  });
});
