// GET /api/retrieve-payment?id=payment_xxx&env=sandbox|live&profile=SC1|SC2|SC3
// Signed proxy to Rapyd's Retrieve Payment. Used as the polling fallback when
// a webhook is delayed, unverified or not yet configured.

import { applyCors, methodNotAllowed, resolveEnv, assertLive, rapydRequest, sendError } from '../utils/http.js';

const METHODS = ['GET'];

export default async function handler(req, res) {
  if (applyCors(req, res, METHODS)) return;
  if (req.method !== 'GET') return methodNotAllowed(res, METHODS);

  try {
    const q = req.query || {};
    const paymentId = q.id;
    if (typeof paymentId !== 'string' || !/^payment_[a-f0-9]+$/i.test(paymentId)) {
      return res.status(400).json({ error: 'INVALID_ID', message: 'Missing or invalid payment id' });
    }

    // A payment is only visible to the MID that created it — the frontend
    // passes the profile recorded on the ledger entry.
    const { env, profile } = resolveEnv(q);
    assertLive(req, env);

    const data = await rapydRequest({ method: 'get', path: `/v1/payments/${paymentId}`, env, profile });
    return res.status(200).json(data);
  } catch (err) {
    return sendError(res, err, 'retrieve-payment');
  }
}
