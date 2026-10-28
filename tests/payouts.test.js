// Payout proxies + helpers. Same rule as handlers.test.js: useCleanEnv()
// strips every RAPYD_* key, so a request that clears all guards stops at
// 500 MISSING_KEYS — Rapyd is never contacted.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import createPayout from '../handlers/payouts/create-payout.js';
import retrievePayout from '../handlers/payouts/retrieve-payout.js';
import payoutRequiredFields from '../handlers/payouts/payout-required-fields.js';
import payoutMethodTypes from '../handlers/payouts/payout-method-types.js';
import payouts from '../api/payouts.js';
import { payoutBodyProblem, requiredFieldsPath, methodTypesPath, assertPayoutsAllowed } from '../utils/payouts.js';
import { liveGuardError, hasRawCard, livePayoutsEnabled, LIVE_ALLOWED_FIELDS } from '../utils/live-guards.js';
import { useCleanEnv, fakeReq, fakeRes, LIVE_TOKEN } from './_helpers.js';

async function run(handler, reqInit) {
  const res = fakeRes();
  await handler(fakeReq(reqInit), res);
  return res;
}
const live = { 'x-paybridge-live-token': LIVE_TOKEN };

/* A card payout to a saved card token — the shape the frontend sends
   (paybridge/js/site/wallet.js payoutBody), minus routing fields. */
const tokenBody = () => ({
  payout_amount: '0.01',
  payout_currency: 'USD',
  payout_method_type: 'us_visa_card',
  sender_currency: 'USD',
  sender_country: 'US',
  sender_entity_type: 'company',
  beneficiary_country: 'US',
  beneficiary_entity_type: 'individual',
  beneficiary: { card_id: 'card_abc', first_name: 'Jordan', last_name: 'Taylor' },
  sender: { company_name: 'rapyd.coin' },
  merchant_reference_id: 'wd_crypto_1700000000000_0123456789abcdef',
  description: 'Withdrawal',
  confirm_automatically: true,
});
const reqFieldsQuery = () => ({
  payout_method_type: 'us_visa_card', sender_country: 'US', sender_currency: 'USD',
  beneficiary_country: 'US', payout_currency: 'USD', sender_entity_type: 'company',
  beneficiary_entity_type: 'individual', payout_amount: '10',
});

describe('payoutBodyProblem', () => {
  test('a well-formed card payout passes', () => {
    assert.equal(payoutBodyProblem(tokenBody()), null);
    assert.equal(payoutBodyProblem({ ...tokenBody(), payout_amount: 12.5 }), null);
    assert.equal(payoutBodyProblem({ ...tokenBody(), beneficiary: 'beneficiary_abc', sender: 'sender_abc' }), null);
  });

  test('amount: required, positive, plain decimal', () => {
    const { payout_amount, ...noAmount } = tokenBody();
    assert.equal(payoutBodyProblem(noAmount).error, 'INVALID_AMOUNT');
    for (const bad of ['0', '-1', '1e3', '0x10', '', 'abc', 0, -5, NaN]) {
      assert.equal(payoutBodyProblem({ ...tokenBody(), payout_amount: bad })?.error, 'INVALID_AMOUNT', String(bad));
    }
    assert.equal(payoutBodyProblem({ ...noAmount, sender_amount: '5' }), null, 'sender_amount alone is allowed (sandbox)');
  });

  test('method type shape and country prefix', () => {
    assert.equal(payoutBodyProblem({ ...tokenBody(), payout_method_type: 'US_VISA' }).error, 'INVALID_PAYOUT_METHOD_TYPE');
    assert.equal(payoutBodyProblem({ ...tokenBody(), payout_method_type: 'gb_visa_card' }).error, 'INVALID_PAYOUT_METHOD_TYPE');
  });

  test('currencies, countries, entity types, parties', () => {
    assert.equal(payoutBodyProblem({ ...tokenBody(), payout_currency: 'usd' }).error, 'INVALID_CURRENCY');
    assert.equal(payoutBodyProblem({ ...tokenBody(), sender_country: 'USA' }).error, 'INVALID_COUNTRY');
    assert.equal(payoutBodyProblem({ ...tokenBody(), sender_entity_type: 'person' }).error, 'INVALID_ENTITY_TYPE');
    assert.equal(payoutBodyProblem({ ...tokenBody(), beneficiary: null }).error, 'INVALID_PARTY');
    assert.equal(payoutBodyProblem({ ...tokenBody(), sender: 'beneficiary_x' }).error, 'INVALID_PARTY');
  });

  test('merchant_reference_id ≤ 45, statement_descriptor ≤ 35, confirm_automatically boolean', () => {
    assert.equal(payoutBodyProblem({ ...tokenBody(), merchant_reference_id: 'r'.repeat(46) }).error, 'INVALID_REF');
    assert.equal(payoutBodyProblem({ ...tokenBody(), merchant_reference_id: 'r'.repeat(45) }), null);
    assert.equal(payoutBodyProblem({ ...tokenBody(), statement_descriptor: 's'.repeat(36) }).error, 'INVALID_DESCRIPTOR');
    assert.equal(payoutBodyProblem({ ...tokenBody(), confirm_automatically: 'true' }).error, 'INVALID_BODY');
  });
});

describe('GET path builders', () => {
  test('required fields: all seven params, fixed order, validated', () => {
    const ok = requiredFieldsPath(reqFieldsQuery());
    assert.equal(ok.path, '/v1/payout_methods/us_visa_card/required_fields?sender_country=US&beneficiary_country=US'
      + '&sender_currency=USD&payout_currency=USD&sender_entity_type=company&beneficiary_entity_type=individual&payout_amount=10');
    assert.equal(requiredFieldsPath({ ...reqFieldsQuery(), payout_method_type: '../payments' }).error, 'INVALID_PARAMS');
    assert.equal(requiredFieldsPath({ ...reqFieldsQuery(), sender_country: undefined }).error, 'INVALID_PARAMS');
    assert.equal(requiredFieldsPath({ ...reqFieldsQuery(), payout_amount: '1e9' }).error, 'INVALID_PARAMS');
    assert.equal(requiredFieldsPath({ ...reqFieldsQuery(), beneficiary_entity_type: 'x' }).error, 'INVALID_PARAMS');
  });

  test('method types: optional filters, validated', () => {
    assert.equal(methodTypesPath({}).path, '/v1/payout_method_types');
    assert.equal(methodTypesPath({ category: 'card', beneficiary_country: 'us', payout_currency: 'usd' }).path,
      '/v1/payout_method_types?category=card&beneficiary_country=US&payout_currency=USD');
    assert.equal(methodTypesPath({ category: 'crypto' }).error, 'INVALID_PARAMS');
    assert.equal(methodTypesPath({ beneficiary_country: 'U&S' }).error, 'INVALID_PARAMS');
  });
});

describe('live payouts — disabled by default', () => {
  useCleanEnv();

  test('LIVE_PAYOUTS_ENABLED is opt-in (exact "true")', () => {
    assert.equal(livePayoutsEnabled(), false);
    for (const v of ['1', 'yes', 'TRUE ', 'false', '']) {
      process.env.LIVE_PAYOUTS_ENABLED = v;
      assert.equal(livePayoutsEnabled(), v.trim().toLowerCase() === 'true', JSON.stringify(v));
    }
    process.env.LIVE_PAYOUTS_ENABLED = 'true';
    assert.equal(livePayoutsEnabled(), true);
  });

  test('assertPayoutsAllowed: sandbox always; live only with the flag', () => {
    assert.doesNotThrow(() => assertPayoutsAllowed('sandbox'));
    assert.throws(() => assertPayoutsAllowed('live'), (e) => e.status === 403 && e.body.error === 'LIVE_PAYOUTS_DISABLED');
    process.env.LIVE_PAYOUTS_ENABLED = 'true';
    assert.doesNotThrow(() => assertPayoutsAllowed('live'));
  });

  test('every payout endpoint refuses live without the flag — even with a valid token', async () => {
    process.env.PAYBRIDGE_LIVE_TOKEN = LIVE_TOKEN;
    const calls = [
      [createPayout, { method: 'POST', headers: live, body: { env: 'live', ...tokenBody() } }],
      [retrievePayout, { headers: live, query: { id: 'payout_abc', env: 'live' } }],
      [payoutRequiredFields, { headers: live, query: { ...reqFieldsQuery(), env: 'live' } }],
      [payoutMethodTypes, { headers: live, query: { category: 'card', env: 'live' } }],
    ];
    for (const [h, init] of calls) {
      const res = await run(h, init);
      assert.equal(res.statusCode, 403);
      assert.equal(res.body.error, 'LIVE_PAYOUTS_DISABLED');
    }
  });

  test('with the flag: still behind the live gate (403 no token configured / 401 wrong token)', async () => {
    process.env.LIVE_PAYOUTS_ENABLED = 'true';
    const r1 = await run(createPayout, { method: 'POST', headers: live, body: { env: 'live', ...tokenBody() } });
    assert.equal(r1.statusCode, 403);
    assert.equal(r1.body.error, 'LIVE_DISABLED');
    process.env.PAYBRIDGE_LIVE_TOKEN = LIVE_TOKEN;
    const r2 = await run(createPayout, { method: 'POST', headers: { 'x-paybridge-live-token': 'nope' }, body: { env: 'live', ...tokenBody() } });
    assert.equal(r2.statusCode, 401);
    const r3 = await run(retrievePayout, { query: { id: 'payout_abc', env: 'live' } });
    assert.equal(r3.statusCode, 401);
  });

  test('with flag + token: cap, allowlist and raw-card guards apply; a valid body stops at MISSING_KEYS', async () => {
    process.env.LIVE_PAYOUTS_ENABLED = 'true';
    process.env.PAYBRIDGE_LIVE_TOKEN = LIVE_TOKEN;
    const post = (body) => run(createPayout, { method: 'POST', headers: live, body: { env: 'live', ...body } });

    const big = await post({ ...tokenBody(), payout_amount: '25' });
    assert.equal(big.body.error, 'LIVE_LIMIT');
    const wallet = await post({ ...tokenBody(), ewallet: 'ewallet_attacker' });
    assert.equal(wallet.body.error, 'LIVE_FIELD_NOT_ALLOWED');
    assert.deepEqual(wallet.body.fields, ['ewallet']);
    const { payout_amount, ...rest } = tokenBody();
    const senderSide = await post({ ...rest, sender_amount: '0.01' });
    assert.equal(senderSide.body.error, 'LIVE_FIELD_NOT_ALLOWED', 'sender_amount would dodge the cap');
    const raw = await post({ ...tokenBody(), beneficiary: { card_number: '4111111111111111', card_expiration_month: '12', card_expiration_year: '30' } });
    assert.equal(raw.body.error, 'LIVE_RAW_CARD_FORBIDDEN');

    const ok = await post(tokenBody());
    assert.equal(ok.statusCode, 500);
    assert.equal(ok.body.error, 'MISSING_KEYS');
  });
});

describe('payout handlers — sandbox', () => {
  useCleanEnv();

  test('preflight + method checks', async () => {
    for (const [h, wrong] of [[createPayout, 'GET'], [retrievePayout, 'POST'], [payoutRequiredFields, 'POST'], [payoutMethodTypes, 'POST']]) {
      const pre = await run(h, { method: 'OPTIONS' });
      assert.equal(pre.statusCode, 204);
      assert.equal(pre.headers['access-control-allow-headers'], 'Content-Type, X-PayBridge-Live-Token, Idempotency-Key');
      assert.equal((await run(h, { method: wrong })).statusCode, 405);
    }
  });

  test('create: unknown profile 400; malformed body 400 before keys; valid body → MISSING_KEYS', async () => {
    const unk = await run(createPayout, { method: 'POST', body: { profile: 'SC9', ...tokenBody() } });
    assert.equal(unk.body.error, 'UNKNOWN_PROFILE');
    const bad = await run(createPayout, { method: 'POST', body: { ...tokenBody(), payout_amount: '-1' } });
    assert.equal(bad.statusCode, 400);
    assert.equal(bad.body.error, 'INVALID_AMOUNT');
    const ok = await run(createPayout, { method: 'POST', body: { profile: 'SC2', ...tokenBody() } });
    assert.equal(ok.statusCode, 500);
    assert.equal(ok.body.error, 'MISSING_KEYS');
  });

  test('create: keys but no source wallet → 400 MISSING_EWALLET (never reaches Rapyd)', async () => {
    process.env.RAPYD_SC3_ACCESS_KEY = 'rak_test';
    process.env.RAPYD_SC3_SECRET_KEY = 'rsk_test';
    const res = await run(createPayout, { method: 'POST', body: { profile: 'SC3', ...tokenBody() } });
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, 'MISSING_EWALLET');
  });

  test('sandbox raw test card is accepted by the guards (live-only rule)', async () => {
    const body = { ...tokenBody(), beneficiary: { card_number: '4111111111111111', card_expiration_month: '12', card_expiration_year: '30', first_name: 'J', last_name: 'T' } };
    const res = await run(createPayout, { method: 'POST', body });
    assert.equal(res.body.error, 'MISSING_KEYS');
  });

  test('GET validation', async () => {
    assert.equal((await run(retrievePayout, { query: { id: 'payment_abc' } })).statusCode, 400);
    assert.equal((await run(retrievePayout, { query: { id: 'payout_abc' } })).body.error, 'MISSING_KEYS');
    assert.equal((await run(payoutRequiredFields, { query: { ...reqFieldsQuery(), payout_currency: 'X' } })).statusCode, 400);
    assert.equal((await run(payoutRequiredFields, { query: reqFieldsQuery() })).body.error, 'MISSING_KEYS');
    assert.equal((await run(payoutMethodTypes, { query: { category: 'card', profile: 'SC4' } })).body.error, 'UNKNOWN_PROFILE');
    assert.equal((await run(payoutMethodTypes, { query: { category: 'card' } })).body.error, 'MISSING_KEYS');
  });
});

describe('live allowlist for create-payout', () => {
  useCleanEnv();

  test('allowlist has the payout fields and never ewallet / sender_amount', () => {
    const list = LIVE_ALLOWED_FIELDS['create-payout'];
    for (const f of ['payout_amount', 'payout_method_type', 'beneficiary', 'sender', 'merchant_reference_id']) assert.ok(list.includes(f), f);
    for (const f of ['ewallet', 'sender_amount', 'metadata', 'payout_fees']) assert.ok(!list.includes(f), f);
  });

  test('cap reads payout_amount', () => {
    assert.equal(liveGuardError('create-payout', tokenBody()), null);
    assert.equal(liveGuardError('create-payout', { ...tokenBody(), payout_amount: '1.01' }).error, 'LIVE_LIMIT');
    process.env.LIVE_MAX_AMOUNT = '5';
    assert.equal(liveGuardError('create-payout', { ...tokenBody(), payout_amount: '5' }), null);
  });

  test('hasRawCard catches a payout card_number', () => {
    assert.equal(hasRawCard({ beneficiary: { card_number: '4111111111111111' } }), true);
    assert.equal(hasRawCard({ beneficiary: { card_id: 'card_abc' } }), false);
  });
});

describe('api/payouts.js dispatcher (vercel.json rewrites land here)', () => {
  useCleanEnv();
  test('unknown or missing op → 404 UNKNOWN_OPERATION, no Rapyd call', async () => {
    for (const query of [{}, { op: 'nope' }, { op: 'constructor' }]) {
      const res = await run(payouts, { method: 'GET', query });
      assert.equal(res.statusCode, 404);
      assert.equal(res.body.error, 'UNKNOWN_OPERATION');
    }
  });
  test('op routes to the matching handler (retrieve validates its id)', async () => {
    const res = await run(payouts, { method: 'GET', query: { op: 'retrieve', id: 'not-a-payout' } });
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, 'INVALID_ID');
  });
});
