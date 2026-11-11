import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/config.js';
import { adminGate } from '../utils/admin-guard.js';
import { validateSlots, validateMeta, LIMITS } from '../utils/tag-config.js';
import { KEY, HISTORY_KEY, LOCK_KEY } from '../handlers/config/tags.js';
import { useCleanEnv, fakeReq, fakeRes } from './_helpers.js';

const ADMIN = 'test-admin-token-0123456789';

/* An in-memory stand-in for the Upstash REST endpoint — only the commands
   handlers/config/tags.js sends. */
function fakeKv() {
  const db = new Map();
  const calls = [];
  const fetch = async (_url, init) => {
    const [cmd, key, ...args] = JSON.parse(init.body);
    calls.push(cmd);
    let result = null;
    switch (cmd) {
      case 'GET': result = db.has(key) ? db.get(key) : null; break;
      case 'SET': {
        if (args.includes('NX') && db.has(key)) { result = null; break; }
        db.set(key, args[0]); result = 'OK'; break;
      }
      case 'DEL': result = db.delete(key) ? 1 : 0; break;
      case 'LPUSH': { const l = db.get(key) || []; l.unshift(args[0]); db.set(key, l); result = l.length; break; }
      case 'LTRIM': { const l = db.get(key) || []; db.set(key, l.slice(Number(args[0]), Number(args[1]) + 1)); result = 'OK'; break; }
      case 'LRANGE': { const l = db.get(key) || []; result = l.slice(Number(args[0]), Number(args[1]) + 1); break; }
      default: throw new Error(`fakeKv: unexpected ${cmd}`);
    }
    return { ok: true, json: async () => ({ result }) };
  };
  return { db, calls, fetch };
}

const call = async (op, { method = 'GET', token, body, headers = {} } = {}) => {
  const res = fakeRes();
  await handler(fakeReq({
    method, query: { op }, body,
    headers: { ...headers, ...(token ? { 'x-paybridge-admin-token': token } : {}) },
  }), res);
  return res;
};

const RULES = {
  'payment.result': { rules: [{
    id: 'paid', label: 'Captured · {data.status}', tone: 'info',
    when: { all: [{ field: 'data.status', op: 'eq', value: 'CLO' }, { field: 'data.paid', op: 'eq', value: true }] },
  }], fallback: { slot: 'http.status' } },
};

describe('adminGate', () => {
  useCleanEnv();
  test('env unset → 403 ADMIN_DISABLED', () => {
    assert.equal(adminGate(fakeReq({ headers: { 'x-paybridge-admin-token': ADMIN } })).status, 403);
  });
  test('short env token is refused like an unset one', () => {
    process.env.PAYBRIDGE_ADMIN_TOKEN = 'short';
    assert.equal(adminGate(fakeReq({ headers: { 'x-paybridge-admin-token': 'short' } })).error, 'ADMIN_DISABLED');
  });
  test('missing / wrong → 401; right → null', () => {
    process.env.PAYBRIDGE_ADMIN_TOKEN = ADMIN;
    assert.equal(adminGate(fakeReq()).status, 401);
    assert.equal(adminGate(fakeReq({ headers: { 'x-paybridge-admin-token': `${ADMIN}x` } })).error, 'ADMIN_AUTH_REQUIRED');
    assert.equal(adminGate(fakeReq({ headers: { 'x-paybridge-admin-token': ADMIN } })), null);
  });
  test('the live token is not an admin token', () => {
    process.env.PAYBRIDGE_ADMIN_TOKEN = ADMIN;
    process.env.PAYBRIDGE_LIVE_TOKEN = 'test-live-token-0123456789';
    assert.equal(adminGate(fakeReq({ headers: { 'x-paybridge-live-token': 'test-live-token-0123456789' } })).status, 401);
  });
});

describe('validateSlots', () => {
  test('accepts the default-shaped config and drops unknown properties', () => {
    const v = validateSlots({ ...RULES, 'beat.header': { entries: { 'request.sent': { label: 'sent', tone: 'success', extra: 1 } } } });
    assert.equal(v.ok, true);
    assert.deepEqual(v.slots['beat.header'].entries['request.sent'], { label: 'sent', tone: 'success' });
  });
  const bad = {
    'unknown slot': { 'nope.slot': { rules: [] } },
    'rules not a list': { 'http.status': { rules: {} } },
    'bad tone': { 'http.status': { rules: [{ id: 'a', label: 'x', tone: 'rainbow' }] } },
    'field not allowlisted': { 'http.status': { rules: [{ id: 'a', label: 'x', tone: 'success', when: { all: [{ field: 'data.status', op: 'eq', value: 'CLO' }] } }] } },
    'unknown op': { 'payment.result': { rules: [{ id: 'a', label: 'x', tone: 'success', when: { all: [{ field: 'data.status', op: 'regex', value: '.*' }] } }] } },
    'placeholder not allowlisted': { 'payment.result': { rules: [{ id: 'a', label: '{process.env}', tone: 'success' }] } },
    'label too long': { 'http.status': { rules: [{ id: 'a', label: 'x'.repeat(LIMITS.label + 1), tone: 'success' }] } },
    'control chars': { 'http.status': { rules: [{ id: 'a', label: 'a\u0000b', tone: 'success' }] } },
    'duplicate rule id': { 'http.status': { rules: [{ id: 'a', label: 'x', tone: 'success' }, { id: 'a', label: 'y', tone: 'success' }] } },
    'between not numbers': { 'http.status': { rules: [{ id: 'a', label: 'x', tone: 'success', when: { all: [{ field: 'http.status', op: 'between', value: ['200', 399] }] } }] } },
    'self fallback': { 'http.status': { rules: [], fallback: { slot: 'http.status' } } },
    'too many rules': { 'http.status': { rules: Array.from({ length: LIMITS.rules + 1 }, (_, i) => ({ id: `r${i}`, label: 'x', tone: 'success' })) } },
    'bad dict key': { 'beat.header': { entries: { 'Bad Key!': { label: 'x', tone: 'success' } } } },
    'not an object': 'slots',
  };
  for (const [name, slots] of Object.entries(bad)) {
    test(`rejects: ${name}`, () => assert.equal(validateSlots(slots).ok, false));
  }
  test('rejects an oversized body', () => {
    const entries = {};
    for (let i = 0; i < 90; i++) entries[`k${i}`] = { label: 'x'.repeat(40), tone: 'success', pad: 'y'.repeat(400) };
    assert.equal(validateSlots({ 'beat.header': { entries } }).ok, false);
  });
  test('validateMeta trims, defaults the name, refuses control chars', () => {
    assert.deepEqual(validateMeta({ updatedBy: '  Lester  ', note: ' hi ' }), { ok: true, updatedBy: 'Lester', note: 'hi' });
    assert.equal(validateMeta({}).updatedBy, 'admin');
    assert.equal(validateMeta({ note: 'a\nb' }).ok, false);
  });
});

describe('/api/config', () => {
  useCleanEnv();
  let store;
  let realFetch;
  beforeEach(() => {
    store = fakeKv();
    realFetch = globalThis.fetch;
    globalThis.fetch = store.fetch;
    process.env.KV_REST_API_URL = 'https://kv.invalid';
    process.env.KV_REST_API_TOKEN = 'kv-token';
    process.env.PAYBRIDGE_ADMIN_TOKEN = ADMIN;
  });
  afterEach(() => { globalThis.fetch = realFetch; });

  test('GET tags with nothing published → version 0, empty slots, no-store', async () => {
    const res = await call('tags');
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.version, 0);
    assert.deepEqual(res.body.slots, {});
    assert.equal(res.headers['cache-control'], 'no-store');
  });

  test('GET tags without KV → defaults, configured false', async () => {
    delete process.env.KV_REST_API_URL;
    const res = await call('tags');
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.configured, false);
  });

  test('PUT without / with a wrong token → 401, nothing written', async () => {
    assert.equal((await call('tags', { method: 'PUT', body: { baseVersion: 0, slots: RULES } })).statusCode, 401);
    assert.equal((await call('tags', { method: 'PUT', token: 'wrong-token-but-long-enough', body: { baseVersion: 0, slots: RULES } })).statusCode, 401);
    assert.equal(store.db.has(KEY), false);
  });

  test('PUT with the admin env unset → 403', async () => {
    delete process.env.PAYBRIDGE_ADMIN_TOKEN;
    const res = await call('tags', { method: 'PUT', token: ADMIN, body: { baseVersion: 0, slots: RULES } });
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error, 'ADMIN_DISABLED');
  });

  test('PUT publishes v1, then v2 pushes v1 to history; GET reads it back', async () => {
    const r1 = await call('tags', { method: 'PUT', token: ADMIN, body: { baseVersion: 0, slots: RULES, updatedBy: 'Lester', note: 'first' } });
    assert.equal(r1.statusCode, 200);
    assert.equal(r1.body.version, 1);
    assert.equal(r1.body.updatedBy, 'Lester');
    const r2 = await call('tags', { method: 'PUT', token: ADMIN, body: { baseVersion: 1, slots: {} } });
    assert.equal(r2.body.version, 2);
    assert.equal(store.db.get(HISTORY_KEY).length, 1);
    const g = await call('tags');
    assert.equal(g.body.version, 2);
    assert.equal(store.db.has(LOCK_KEY), false, 'lock released');
  });

  test('stale baseVersion → 409 VERSION_CONFLICT with the current meta', async () => {
    await call('tags', { method: 'PUT', token: ADMIN, body: { baseVersion: 0, slots: RULES } });
    const res = await call('tags', { method: 'PUT', token: ADMIN, body: { baseVersion: 0, slots: {} } });
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.error, 'VERSION_CONFLICT');
    assert.equal(res.body.current.version, 1);
    assert.equal(store.db.has(LOCK_KEY), false, 'lock released after a conflict');
  });

  test('a held lock → 409 BUSY', async () => {
    store.db.set(LOCK_KEY, 'someone-else');
    const res = await call('tags', { method: 'PUT', token: ADMIN, body: { baseVersion: 0, slots: RULES } });
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.error, 'BUSY');
    assert.equal(store.db.get(LOCK_KEY), 'someone-else', 'never releases a lock it does not own');
  });

  test('invalid slots → 400 with the error list', async () => {
    const res = await call('tags', { method: 'PUT', token: ADMIN, body: { baseVersion: 0, slots: { 'nope': {} } } });
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, 'INVALID_TAG_CONFIG');
    assert.ok(res.body.errors.length);
  });

  test('missing baseVersion → 400', async () => {
    const res = await call('tags', { method: 'PUT', token: ADMIN, body: { slots: RULES } });
    assert.equal(res.body.error, 'INVALID_BASE_VERSION');
  });

  test('history + rollback republish an old version as a new one', async () => {
    await call('tags', { method: 'PUT', token: ADMIN, body: { baseVersion: 0, slots: RULES } });
    await call('tags', { method: 'PUT', token: ADMIN, body: { baseVersion: 1, slots: {} } });
    const h = await call('tags-history', { token: ADMIN });
    assert.equal(h.statusCode, 200);
    assert.deepEqual(h.body.history.map((x) => x.version), [1]);
    assert.equal(h.body.history[0].slots, undefined, 'metadata only');
    const rb = await call('tags-rollback', { method: 'POST', token: ADMIN, body: { version: 1, baseVersion: 2 } });
    assert.equal(rb.statusCode, 200);
    assert.equal(rb.body.version, 3);
    assert.equal(rb.body.note, 'Rollback to v1');
    assert.deepEqual(rb.body.slots, (await call('tags')).body.slots);
    assert.equal(rb.body.slots['payment.result'].rules[0].label, 'Captured · {data.status}');
    assert.equal((await call('tags-rollback', { method: 'POST', token: ADMIN, body: { version: 99, baseVersion: 3 } })).statusCode, 404);
  });

  test('history and whoami need the token', async () => {
    assert.equal((await call('tags-history')).statusCode, 401);
    assert.equal((await call('whoami')).statusCode, 401);
    const ok = await call('whoami', { token: ADMIN });
    assert.equal(ok.statusCode, 204);
  });

  test('unknown op → 404; wrong method → 405; preflight allows the admin header', async () => {
    assert.equal((await call('nope')).statusCode, 404);
    assert.equal((await call('whoami', { method: 'POST', token: ADMIN })).statusCode, 405);
    const pre = await call('tags', { method: 'OPTIONS' });
    assert.equal(pre.statusCode, 204);
    assert.match(pre.headers['access-control-allow-headers'], /X-PayBridge-Admin-Token/);
    assert.match(pre.headers['access-control-allow-methods'], /PUT/);
  });
});
