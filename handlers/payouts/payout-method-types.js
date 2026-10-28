// GET /api/payout-method-types?category=card&beneficiary_country=US&payout_currency=USD&env=…&profile=…
// Signed proxy to Rapyd's List Payout Method Types (GET /v1/payout_method_types)
// — the withdraw picks the card payout type the MID actually offers for the
// beneficiary's country + currency instead of guessing it.
// Docs: https://docs.rapyd.net/en/list-payout-method-types.html
// Live: refused unless LIVE_PAYOUTS_ENABLED=true, then the live gate.

import { applyCors, methodNotAllowed, resolveEnv, assertLive, rapydRequest, sendError } from '../../utils/http.js';
import { assertPayoutsAllowed, methodTypesPath } from '../../utils/payouts.js';

const METHODS = ['GET'];

export default async function handler(req, res) {
  if (applyCors(req, res, METHODS)) return;
  if (req.method !== 'GET') return methodNotAllowed(res, METHODS);

  try {
    const q = req.query || {};
    const built = methodTypesPath(q);
    if (built.error) return res.status(400).json(built);

    const { env, profile } = resolveEnv(q);
    assertPayoutsAllowed(env);
    assertLive(req, env);

    const data = await rapydRequest({ method: 'get', path: built.path, env, profile });
    return res.status(200).json(data);
  } catch (err) {
    return sendError(res, err, 'payout-method-types');
  }
}
