// GET /api/webhooks — stored webhook events (newest first), read by scope:
//
//   ?ref=<merchant_reference_id>   → { events, configured }  one demo session
//   ?refs=<ref1>,<ref2>,...        → { byRef, configured }   back-office ledger
//                                    poller; max 20 refs per call (extra
//                                    dropped), one KV round-trip per ref
//   ?customer=cus_xxx              → { events, configured }  CUSTOMER_* and
//                                    payment events filed by cus_***
//                                    (data.customer / data.customer_token)
//   ?card=card_xxx                 → { events, configured }  the card's own
//                                    events (CUSTOMER_PAYMENT_METHOD_CREATED,
//                                    CARD_ADDED_SUCCESSFULLY) — no cus_*** on them
//
// No scope → 400 MISSING_REF. There is deliberately no "recent events" read:
// the old global list exposed every session's raw events (PII) to anyone.
// (wh:recent is only SEARCHED, for records about the one customer / card id
// asked for — see LEGACY_RECENT.)
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
const CARD_ID = /^card_[a-z0-9]+$/i;
// 'cus:' / 'card:' are the customer / card namespaces (wh:cus:<id>,
// wh:card:<id>) — a ref can't alias them.
const validRef = (r) => typeof r === 'string' && r.length > 0 && r.length <= MAX_REF_LENGTH && !/^(cus|card):/.test(r);

/**
 * Pure query validation (unit-tested without KV).
 * @returns {{ mode: 'refs', refs: string[] } | { mode: 'ref', ref: string }
 *          | { mode: 'customer', customer: string } | { mode: 'card', card: string }
 *          | { status: number, body: { error: string, message: string } }}
 */
export function parseWebhookQuery(query = {}) {
  const { refs, ref, customer, card } = query || {};
  if (refs !== undefined && refs !== '') {
    if (typeof refs !== 'string') return invalid('INVALID_REF', 'refs must be a single comma-separated list.');
    const list = refs.split(',').map((s) => s.trim())
      .filter(validRef)
      .slice(0, MAX_REFS);
    if (!list.length) return invalid('MISSING_REF', 'refs contained no valid reference.');
    return { mode: 'refs', refs: [...new Set(list)] };
  }
  if (ref !== undefined && ref !== '') {
    if (!validRef(ref)) return invalid('INVALID_REF', `ref must be 1–${MAX_REF_LENGTH} chars and must not start with 'cus:' or 'card:'.`);
    return { mode: 'ref', ref };
  }
  if (customer !== undefined && customer !== '') {
    if (typeof customer !== 'string' || !CUS_ID.test(customer)) return invalid('INVALID_CUSTOMER', 'customer must be a cus_*** id.');
    return { mode: 'customer', customer };
  }
  if (card !== undefined && card !== '') {
    if (typeof card !== 'string' || !CARD_ID.test(card)) return invalid('INVALID_CARD', 'card must be a card_*** id.');
    return { mode: 'card', card };
  }
  return invalid('MISSING_REF', 'Pass ref, refs, customer or card.');
}

function invalid(error, message) {
  return { status: 400, body: { error, message } };
}

const parseAll = (items) => (items || [])
  .map((s) => { try { return JSON.parse(s); } catch { return null; } })
  .filter(Boolean);

/* The older receiver (rapyd-backend `main`, which Rapyd's sandbox MIDs post to
   as of 2026-11-05) files events only under wh:<ref> plus a rolling
   wh:recent list (last 100, 1 h) in this same store. A card's own events
   (CUSTOMER_PAYMENT_METHOD_CREATED, CARD_ADDED_SUCCESSFULLY) carry no ref, and
   payments name the shopper in customer_token — so for a customer or card
   read, wh:recent is searched for records about EXACTLY that id. Nothing else
   from wh:recent is ever returned (it holds every session's events). */
const LEGACY_RECENT = 'wh:recent';

/** Does a stored record belong to this customer / card scope? (pure) */
export function matchesScope(record, q) {
  const d = record?.raw?.data;
  if (!d || typeof d !== 'object') return false;
  if (q.mode === 'card') return d.id === q.card;
  if (q.mode === 'customer') return d.customer === q.customer || d.customer_token === q.customer || d.id === q.customer;
  return false;
}

/** Newest first, one copy per event id (the same event can sit in two lists). (pure) */
export function mergeEvents(...lists) {
  const seen = new Set();
  return lists.flat()
    .sort((a, b) => (Number(b.received_at) || 0) - (Number(a.received_at) || 0))
    .filter((e) => {
      const k = e.event_id || `${e.type}|${e.received_at}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
}

/** Verified + unverified events for one scope (`ref`, `cus:<id>` or `card:<id>`),
    plus — for customer / card reads — the matching wh:recent records. */
async function eventsAt(scope, q = null) {
  const legacy = q && (q.mode === 'customer' || q.mode === 'card');
  const [verified, unverified, recent] = await Promise.all([
    kv(['LRANGE', `wh:${scope}`, '0', '-1']),
    kv(['LRANGE', `whu:${scope}`, '0', '-1']),
    legacy ? kv(['LRANGE', LEGACY_RECENT, '0', '-1']).catch(() => []) : [],
  ]);
  return mergeEvents(parseAll(verified), parseAll(unverified), parseAll(recent).filter((r) => matchesScope(r, q)));
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
    const scope = q.mode === 'customer' ? `cus:${q.customer}` : q.mode === 'card' ? `card:${q.card}` : q.ref;
    return res.status(200).json({ events: await eventsAt(scope, q), configured: true });
  } catch (err) {
    console.error('webhooks read error:', err.message);
    return res.status(200).json(batch
      ? { byRef: {}, configured: true, error: 'read_failed' }
      : { events: [], configured: true, error: 'read_failed' });
  }
}
