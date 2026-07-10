// GET /api/webhooks?ref=<merchant_reference_id>
// Returns stored webhook events for a demo session (newest first).
// Falls back to the recent global list when no ref is given.

import { kv, kvConfigured } from '../utils/kv.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  if (!kvConfigured()) {
    return res.status(200).json({ events: [], configured: false });
  }

  try {
    const ref = req.query?.ref;
    const key = ref ? `wh:${ref}` : 'wh:recent';
    const items = (await kv(['LRANGE', key, '0', '-1'])) || [];
    const events = items
      .map((s) => { try { return JSON.parse(s); } catch { return null; } })
      .filter(Boolean);
    return res.status(200).json({ events, configured: true });
  } catch (err) {
    console.error('webhooks read error:', err.message);
    return res.status(200).json({ events: [], configured: true, error: 'read_failed' });
  }
}
