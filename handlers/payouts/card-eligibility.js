// POST /api/payout-card-eligibility → Rapyd POST /v1/cards/eligibility
// The merchant site's Withdraw asks this FIRST: is the destination card able
// to receive a card payout (transaction_type 'oct'), and where/in what is it
// billed? data.issuer_country becomes the payout's beneficiary_country and
// data.billing_currency its payout_currency (paybridge js/site/wallet.js
// payoutRoute). Body: exactly one of card_id (a saved card_***) or
// card_number (sandbox only), plus transaction_type.
// Docs: https://docs.rapyd.net/en/retrieve-card-eligibility-details.html
//       https://docs.rapyd.net/en/card-eligibility-for-card-payouts.html
//
// Live: refused outright unless LIVE_PAYOUTS_ENABLED=true (403
// LIVE_PAYOUTS_DISABLED — default off, like every payout route), then the
// live gate, the field allowlist (card_id + transaction_type) and no raw
// card data (card_number → LIVE_RAW_CARD_FORBIDDEN; utils/live-guards.js).

import {
  applyCors, methodNotAllowed, readJsonBody, resolveEnv, cleanBody, assertLive,
  idempotencyKey, rapydRequest, sendError, HttpError,
} from '../../utils/http.js';
import { assertPayoutsAllowed, eligibilityBodyProblem } from '../../utils/payouts.js';

const METHODS = ['POST'];

export default async function handler(req, res) {
  if (applyCors(req, res, METHODS)) return;
  if (req.method !== 'POST') return methodNotAllowed(res, METHODS);

  try {
    const input = readJsonBody(req);
    const { env, profile } = resolveEnv(input);
    assertPayoutsAllowed(env);
    const body = cleanBody(input);
    assertLive(req, env, 'card-eligibility', body);

    const problem = eligibilityBodyProblem(body);
    if (problem) throw new HttpError(400, problem);

    const data = await rapydRequest({
      method: 'post', path: '/v1/cards/eligibility', body, env, profile, idempotencyKey: idempotencyKey(req),
    });
    return res.status(200).json(data);
  } catch (err) {
    return sendError(res, err, 'card-eligibility');
  }
}
