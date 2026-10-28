// GET /api/retrieve-payout?id=payout_xxx&env=sandbox|live&profile=SC1|SC2|SC3
// Signed proxy to Rapyd's Retrieve Payout (GET /v1/payouts/{payout}) — how
// the merchant site confirms a withdrawal when the PAYOUT_COMPLETED /
// PAYOUT_FAILED webhook is late, unverified or not configured, mirroring
// retrieve-payment. Docs: https://docs.rapyd.net/en/retrieve-payout.html
// Live: refused unless LIVE_PAYOUTS_ENABLED=true, then the live gate.

import { applyCors, methodNotAllowed, resolveEnv, assertLive, rapydRequest, sendError } from '../../utils/http.js';
import { assertPayoutsAllowed, PAYOUT_ID } from '../../utils/payouts.js';

const METHODS = ['GET'];

export default async function handler(req, res) {
  if (applyCors(req, res, METHODS)) return;
  if (req.method !== 'GET') return methodNotAllowed(res, METHODS);

  try {
    const q = req.query || {};
    const payoutId = q.id;
    if (typeof payoutId !== 'string' || !PAYOUT_ID.test(payoutId)) {
      return res.status(400).json({ error: 'INVALID_ID', message: 'Missing or invalid payout id' });
    }

    // Only the MID that created the payout can see it — the frontend passes
    // the profile recorded on the ledger entry.
    const { env, profile } = resolveEnv(q);
    assertPayoutsAllowed(env);
    assertLive(req, env);

    const data = await rapydRequest({ method: 'get', path: `/v1/payouts/${payoutId}`, env, profile });
    return res.status(200).json(data);
  } catch (err) {
    return sendError(res, err, 'retrieve-payout');
  }
}
