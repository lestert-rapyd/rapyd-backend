import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveKeys, normalizeProfile, allKeyPairs, PROFILES } from '../utils/key-profiles.js';
import { useCleanEnv } from './_helpers.js';

describe('normalizeProfile', () => {
  test('missing → SC1, known → itself, anything else → null', () => {
    assert.equal(normalizeProfile(undefined), 'SC1');
    assert.equal(normalizeProfile(null), 'SC1');
    assert.equal(normalizeProfile(''), 'SC1');
    assert.equal(normalizeProfile('SC2'), 'SC2');
    assert.equal(normalizeProfile('SC3'), 'SC3');
    assert.equal(normalizeProfile('sc1'), null);
    assert.equal(normalizeProfile('SC9'), null);
    assert.equal(normalizeProfile('constructor'), null);
    assert.equal(normalizeProfile('__proto__'), null);
    assert.equal(normalizeProfile(['SC1']), null);
    assert.equal(normalizeProfile(1), null);
  });
});

describe('resolveKeys', () => {
  useCleanEnv();

  test('explicit profile picks its own keys and first ewallet', () => {
    process.env.RAPYD_SC2_ACCESS_KEY = 'ak2';
    process.env.RAPYD_SC2_SECRET_KEY = 'sk2';
    process.env.RAPYD_SC2_EWALLETS = ' ewallet_a , ewallet_b ,';
    const k = resolveKeys({ env: 'sandbox', profile: 'SC2' });
    assert.equal(k.access, 'ak2');
    assert.equal(k.secret, 'sk2');
    assert.equal(k.ewallet, 'ewallet_a');
    assert.deepEqual(k.ewallets, ['ewallet_a', 'ewallet_b']);
    assert.equal(k.profile, 'SC2');
    assert.equal(k.fallback, false);
    assert.deepEqual(k.features, PROFILES.SC2);
  });

  test('missing profile defaults to SC1', () => {
    process.env.RAPYD_SC1_ACCESS_KEY = 'ak1';
    process.env.RAPYD_SC1_SECRET_KEY = 'sk1';
    const k = resolveKeys({});
    assert.equal(k.profile, 'SC1');
    assert.equal(k.access, 'ak1');
    assert.equal(k.ewallet, null);
    assert.deepEqual(k.ewallets, []);
  });

  test('legacy RAPYD_SANDBOX_* pair is the SC1 fallback', () => {
    process.env.RAPYD_SANDBOX_ACCESS_KEY = 'legacy_ak';
    process.env.RAPYD_SANDBOX_SECRET_KEY = 'legacy_sk';
    const k = resolveKeys({ env: 'sandbox', profile: 'SC1' });
    assert.equal(k.access, 'legacy_ak');
    assert.equal(k.secret, 'legacy_sk');
    assert.equal(k.fallback, true);
  });

  test('legacy pair is NOT used for SC2/SC3', () => {
    process.env.RAPYD_SANDBOX_ACCESS_KEY = 'legacy_ak';
    process.env.RAPYD_SANDBOX_SECRET_KEY = 'legacy_sk';
    const k = resolveKeys({ env: 'sandbox', profile: 'SC3' });
    assert.equal(k.access, undefined);
    assert.equal(k.fallback, false);
  });

  test('explicit unknown profile throws UNKNOWN_PROFILE (no silent SC1)', () => {
    process.env.RAPYD_SC1_ACCESS_KEY = 'ak1';
    process.env.RAPYD_SC1_SECRET_KEY = 'sk1';
    assert.throws(() => resolveKeys({ env: 'sandbox', profile: 'SC9' }), (e) => e.code === 'UNKNOWN_PROFILE');
    assert.throws(() => resolveKeys({ profile: 'constructor' }), (e) => e.code === 'UNKNOWN_PROFILE');
  });

  test('live uses the LIVE pair and ignores profile', () => {
    process.env.RAPYD_LIVE_ACCESS_KEY = 'akL';
    process.env.RAPYD_LIVE_SECRET_KEY = 'skL';
    process.env.RAPYD_LIVE_EWALLETS = 'ewallet_live';
    const k = resolveKeys({ env: 'live', profile: 'SC2' });
    assert.equal(k.access, 'akL');
    assert.equal(k.profile, 'LIVE');
    assert.equal(k.ewallet, 'ewallet_live');
    assert.equal(k.features, null);
    assert.equal(k.fallback, false);
  });

  test('allKeyPairs lists only complete pairs', () => {
    process.env.RAPYD_SC1_ACCESS_KEY = 'ak1';
    process.env.RAPYD_SC1_SECRET_KEY = 'sk1';
    process.env.RAPYD_SC2_ACCESS_KEY = 'ak2'; // no secret → skipped
    process.env.RAPYD_LIVE_ACCESS_KEY = 'akL';
    process.env.RAPYD_LIVE_SECRET_KEY = 'skL';
    assert.deepEqual(allKeyPairs(), [['ak1', 'sk1'], ['akL', 'skL']]);
  });
});
