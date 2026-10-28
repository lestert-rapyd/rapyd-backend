// GET /api/webhooks — stored webhook events (newest first), read by scope:
//
//   ?ref=<merchant_reference_id>   → { events, configured }  one demo session
//   ?refs=<ref1>,<ref2>,...        → { byRef, configured }   back-office ledger
//                                    poller; max 20 refs per call (extra
//                                    dropped), one KV round-trip per ref
//   ?customer=cus_xxx              → { events, configured }  CUSTOMER_* and
//                                    card-on-file events filed by cus_***
//
// No scope → 400 MISSING_REF. There is deliberately no "recent events" read:
// the old global list exposed every session's raw events (PII) to anyone.
// Each event carries `verified` (+ `verified_env`, the environment whose key
// pair signed it) — consumers must treat anything but 'verified' as
// untrusted. Each read merges the verified list (wh:<scope>) with the
// reduced, short-lived unverified one (whu:<scope>; see webhook.js), newest
// first.

import { kv, kvConfigured } from '../utils/kv.js';
import { applyCors, methodNotAllowed } from '../utils/http.js';

const METHODS = ['GET'];
export const MAX_REFS = 20;
export const MAX_REF_LENGTH = 128;
const CUS_ID = /^cus_[a-z0-9]+$/i;
// 'cus:' is the customer-list namespace (wh:cus:<id>) — a ref can't alias it.
const validRef = (r) => typeof r === 'string' && r.length > 0 && r.length <= MAX_REF_LENGTH && !r.startsWith('cus:');

/**
 * Pure query validation (unit-tested without KV).
 * @returns {{ mode: 'refs', refs: string[] } | { mode: 'ref', ref: string }
 *          | { mode: 'customer', customer: string }
 *          | { status: number, body: { error: string, message: string } }}
 */
export function parseWebhookQuery(query = {}) {
  const { refs, ref, customer } = query || {};
  if (refs !== undefined && refs !== '') {
    if (typeof refs !== 'string') return invalid('INVALID_REF', 'refs must be a single comma-separated list.');
    const list = refs.split(',').map((s) => s.trim())
      .filter(validRef)
      .slice(0, MAX_REFS);
    if (!list.length) return invalid('MISSING_REF', 'refs contained no valid reference.');
    return { mode: 'refs', refs: [...new Set(list)] };
  }
  if (ref !== undefined && ref !== '') {
    if (!validRef(ref)) return invalid('INVALID_REF', `ref must be 1–${MAX_REF_LENGTH} chars and must not start with 'cus:'.`);
    return { mode: 'ref', ref };
  }
  if (customer !== undefined && customer !== '') {
    if (typeof customer !== 'string' || !CUS_ID.test(customer)) return invalid('INVALID_CUSTOMER', 'customer must be a cus_*** id.');
    return { mode: 'customer', customer };
  }
  return invalid('MISSING_REF', 'Pass ref, refs or customer.');
}

function invalid(error, message) {
  return { status: 400, body: { error, message } };
}

const parseAll = (items) => (items || [])
  .map((s) => { try { return JSON.parse(s); } catch { return null; } })
  .filter(Boolean);

/** Verified + unverified events for one scope (`ref` or `cus:<id>`), newest first. */
async function eventsAt(scope) {
  const [verified, unverified] = await Promise.all([
    kv(['LRANGE', `wh:${scope}`, '0', '-1']),
    kv(['LRANGE', `whu:${scope}`, '0', '-1']),
  ]);
  return [...parseAll(verified), ...parseAll(unverified)]
    .sort((a, b) => (Number(b.received_at) || 0) - (Number(a.received_at) || 0));
}

export default async function handler(req, res) {
  if (applyCors(req, res, METHODS)) return;
  if (req.method !== 'GET') return methodNotAllowed(res, METHODS);

  const q = parseWebhookQuery(req.query);
  if (q.status) return res.status(q.status).json(q.body);
  const batch = q.mode === 'refs';

  if (!kvConfigured()) {
    return res.status(200).json(batch ? { byRef: {}, configured: false } : { events: [], configured: false });
  }

  try {
    if (batch) {
      const results = await Promise.all(q.refs.map((r) => eventsAt(r)));
      const byRef = {};
      q.refs.forEach((r, i) => { byRef[r] = results[i]; });
      return res.status(200).json({ byRef, configured: true });
    }
    const scope = q.mode === 'customer' ? `cus:${q.customer}` : q.ref;
    return res.status(200).json({ events: await eventsAt(scope), configured: true });
  } catch (err) {
    console.error('webhooks read error:', err.message);
    return res.status(200).json(batch
      ? { byRef: {}, configured: true, error: 'read_failed' }
      : { events: [], configured: true, error: 'read_failed' });
  }
}
