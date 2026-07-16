// GET /api/webhooks?ref=<merchant_reference_id>
// Returns stored webhook events for a demo session (newest first).
// Falls back to the recent global list when no ref is given.
//
// GET /api/webhooks?refs=<ref1>,<ref2>,...  (batch — back-office ledger poller)
// Returns { [ref]: events[] } for each ref, one KV round-trip per ref in
// parallel. Capped at 20 refs per call. Additive — the single-ref shape
// above is untouched, so the customer-facing singleton watcher (webhooks.js)
// is unaffected.

import { kv, kvConfigured } from '../utils/kv.js';

async function eventsFor(ref) {
  const key = ref ? `wh:${ref}` : 'wh:recent';
  const items = (await kv(['LRANGE', key, '0', '-1'])) || [];
  return items
    .map((s) => { try { return JSON.parse(s); } catch { return null; } })
    .filter(Boolean);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const refsParam = req.query?.refs;

  if (!kvConfigured()) {
    return res.status(200).json(refsParam ? { byRef: {}, configured: false } : { events: [], configured: false });
  }

  try {
    if (refsParam) {
      const refs = String(refsParam).split(',').map((s) => s.trim()).filter(Boolean).slice(0, 20);
      const results = await Promise.all(refs.map((r) => eventsFor(r)));
      const byRef = {};
      refs.forEach((r, i) => { byRef[r] = results[i]; });
      return res.status(200).json({ byRef, configured: true });
    }

    const ref = req.query?.ref;
    const events = await eventsFor(ref);
    return res.status(200).json({ events, configured: true });
  } catch (err) {
    console.error('webhooks read error:', err.message);
    return res.status(200).json(refsParam
      ? { byRef: {}, configured: true, error: 'read_failed' }
      : { events: [], configured: true, error: 'read_failed' });
  }
}
