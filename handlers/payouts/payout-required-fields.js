// GET /api/payout-required-fields?payout_method_type=us_visa_card&sender_country=US
//     &sender_currency=USD&beneficiary_country=US&payout_currency=USD
//     &sender_entity_type=company&beneficiary_entity_type=individual
//     &payout_amount=10&env=…&profile=…
// Signed proxy to Rapyd's Get Payout Required Fields
// (GET /v1/payout_methods/{payout_method_type}/required_fields) — the
// frontend builds the payout's beneficiary/sender objects from
// beneficiary_required_fields / sender_required_fields.
// Docs: https://docs.rapyd.net/en/get-payout-required-fields.html
// Live: refused unless LIVE_PAYOUTS_ENABLED=true, then the live gate.

import { applyCors, methodNotAllowed, resolveEnv, assertLive, rapydRequest, sendError } from '../../utils/http.js';
import { assertPayoutsAllowed, requiredFieldsPath } from '../../utils/payouts.js';

const METHODS = ['GET'];

export default async function handler(req, res) {
  if (applyCors(req, res, METHODS)) return;
  if (req.method !== 'GET') return methodNotAllowed(res, METHODS);

  try {
    const q = req.query || {};
    const built = requiredFieldsPath(q);
    if (built.error) return res.status(400).json(built);

    const { env, profile } = resolveEnv(q);
    assertPayoutsAllowed(env);
    assertLive(req, env);

    const data = await rapydRequest({ method: 'get', path: built.path, env, profile });
    return res.status(200).json(data);
  } catch (err) {
    return sendError(res, err, 'payout-required-fields');
  }
}
