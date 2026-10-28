import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { generateRapydSignature } from '../utils/generate-signature.js';

// The salt is random, so the signature can't be pinned — recompute Rapyd's
// documented formula from the returned salt/timestamp instead.
function expected(method, path, salt, timestamp, ak, sk, bodyString) {
  const hex = crypto.createHmac('sha256', sk)
    .update(method + path + salt + timestamp + ak + sk + bodyString)
    .digest('hex');
  return Buffer.from(hex).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
}

describe('generateRapydSignature', () => {
  test('object body: matches the Rapyd formula over compact JSON', () => {
    const body = { amount: 0.01, currency: 'USD', nested: { a: [1, 2] } };
    const { salt, timestamp, signature } = generateRapydSignature('post', '/v1/payments', body, 'ak', 'sk');
    assert.match(salt, /^[A-Za-z0-9]{12}$/);
    assert.equal(new Set(salt).size, 12, 'salt chars are unique');
    assert.match(timestamp, /^\d+$/);
    assert.ok(Math.abs(Number(timestamp) - Date.now() / 1000) < 5);
    assert.equal(signature, expected('post', '/v1/payments', salt, timestamp, 'ak', 'sk', JSON.stringify(body)));
    assert.doesNotMatch(signature, /[+/]/, 'url-safe base64');
  });

  test('string body is signed verbatim (no re-serialization)', () => {
    const raw = '{"b":2,"a":1}';
    const { salt, timestamp, signature } = generateRapydSignature('post', '/v1/refunds', raw, 'ak', 'sk');
    assert.equal(signature, expected('post', '/v1/refunds', salt, timestamp, 'ak', 'sk', raw));
  });

  test('GET: null body signs the empty string; a full URL is trimmed to /v1…', () => {
    const { salt, timestamp, signature } = generateRapydSignature(
      'get', 'https://example.invalid/v1/fx_rates?action_type=payment&buy_currency=USD', null, 'ak', 'sk');
    assert.equal(signature, expected('get', '/v1/fx_rates?action_type=payment&buy_currency=USD', salt, timestamp, 'ak', 'sk', ''));
  });

  test('fresh salt per call', () => {
    const a = generateRapydSignature('get', '/v1/x', null, 'ak', 'sk');
    const b = generateRapydSignature('get', '/v1/x', null, 'ak', 'sk');
    assert.notEqual(a.salt, b.salt);
  });

  test('throws without keys (no env fallback)', () => {
    assert.throws(() => generateRapydSignature('get', '/v1/x', null, '', 'sk'));
    assert.throws(() => generateRapydSignature('get', '/v1/x', null, 'ak', undefined));
  });
});
