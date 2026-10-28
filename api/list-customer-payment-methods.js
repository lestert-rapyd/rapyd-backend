// GET /api/list-customer-payment-methods?customer=cus_xxx&profile=SC1&env=sandbox|live
// Signed proxy to Rapyd's List Payment Methods of Customer. Powers the back
// office "Sync from Rapyd" action and the silent token backfill after a
// save-while-paying completes. Card objects carry id (card_***), type, last4,
// expiration_month/year and network_reference_id.

import { applyCors, methodNotAllowed, resolveEnv, assertLive, rapydRequest, sendError } from '../utils/http.js';

const METHODS = ['GET'];

export default async function handler(req, res) {
  if (applyCors(req, res, METHODS)) return;
  if (req.method !== 'GET') return methodNotAllowed(res, METHODS);

  try {
    const q = req.query || {};
    const customer = q.customer;
    if (typeof customer !== 'string' || !/^cus_[a-f0-9]+$/i.test(customer)) {
      return res.status(400).json({ error: 'INVALID_ID', message: 'Missing or invalid customer id' });
    }

    const { env, profile } = resolveEnv(q);
    assertLive(req, env);

    // Sign the identical path we request — Rapyd recomputes the signature over
    // the path it receives, query string included (same rule as get-fx-rate).
    const path = `/v1/customers/${customer}/payment_methods?category=card`;
    const data = await rapydRequest({ method: 'get', path, env, profile });
    return res.status(200).json(data);
  } catch (err) {
    return sendError(res, err, 'list-customer-payment-methods');
  }
}
