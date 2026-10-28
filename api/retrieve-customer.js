// GET /api/retrieve-customer?id=cus_xxx&env=sandbox|live&profile=SC1|SC2|SC3
// Signed proxy to Rapyd's Retrieve Customer. Powers the back office's customer
// view, so the cus_*** created by beat 1 can be read back from Rapyd (live
// payment_methods, created_at) instead of being narrated from session state.

import { applyCors, methodNotAllowed, resolveEnv, assertLive, rapydRequest, sendError } from '../utils/http.js';

const METHODS = ['GET'];

export default async function handler(req, res) {
  if (applyCors(req, res, METHODS)) return;
  if (req.method !== 'GET') return methodNotAllowed(res, METHODS);

  try {
    const q = req.query || {};
    const customerId = q.id;
    if (typeof customerId !== 'string' || !/^cus_[a-f0-9]+$/i.test(customerId)) {
      return res.status(400).json({ error: 'INVALID_ID', message: 'Missing or invalid customer id' });
    }

    // A customer belongs to the MID that created it — the frontend passes the
    // profile the cus_*** was minted under (same rule as retrieve-payment).
    const { env, profile } = resolveEnv(q);
    assertLive(req, env);

    const data = await rapydRequest({ method: 'get', path: `/v1/customers/${customerId}`, env, profile });
    return res.status(200).json(data);
  } catch (err) {
    return sendError(res, err, 'retrieve-customer');
  }
}
