// POST /api/create-payout → Rapyd POST /v1/payouts
// The merchant site's Withdraw: sends the shopper's store credit back to a
// card (a card payout, payout_method_type *_card). The body is the Rapyd
// payout body plus routing fields (env, profile) that are stripped before
// signing. The SOURCE wallet (`ewallet`) is the profile's — the frontend
// sends it in sandbox; in live it is injected here from RAPYD_LIVE_EWALLETS,
// exactly like payments. Docs: https://docs.rapyd.net/en/create-payout.html
//
// Live: refused outright unless LIVE_PAYOUTS_ENABLED=true (403
// LIVE_PAYOUTS_DISABLED — default off), then the usual live gate, field
// allowlist, no raw card data (beneficiary.card_number) and
// payout_amount <= LIVE_MAX_AMOUNT (utils/live-guards.js).

import { resolveKeys } from '../../utils/key-profiles.js';
import {
  applyCors, methodNotAllowed, readJsonBody, resolveEnv, cleanBody, assertLive,
  idempotencyKey, rapydRequest, missingKeysError, sendError, HttpError,
} from '../../utils/http.js';
import { assertPayoutsAllowed, payoutBodyProblem } from '../../utils/payouts.js';

const METHODS = ['POST'];

export default async function handler(req, res) {
  if (applyCors(req, res, METHODS)) return;
  if (req.method !== 'POST') return methodNotAllowed(res, METHODS);

  try {
    const input = readJsonBody(req);
    const { env, profile } = resolveEnv(input);
    assertPayoutsAllowed(env);
    const body = cleanBody(input);
    assertLive(req, env, 'create-payout', body);

    const problem = payoutBodyProblem(body);
    if (problem) throw new HttpError(400, problem);

    const keys = resolveKeys({ env, profile });
    if (!keys.access || !keys.secret) throw missingKeysError(env, keys.profile);

    // Same transitional guard as create-direct-payment: the legacy MID owns
    // none of the frontend's profile wallets.
    if (keys.fallback && body.ewallet) delete body.ewallet;
    if (!body.ewallet && keys.ewallet) body.ewallet = keys.ewallet;
    // A payout has no MID-default wallet to fall back on — say which env var
    // is missing instead of letting Rapyd answer with a bare error code.
    if (!body.ewallet) {
      throw new HttpError(400, {
        error: 'MISSING_EWALLET',
        message: `No source wallet for ${env}/${keys.profile} — set RAPYD_${keys.profile}_EWALLETS.`,
      });
    }

    const data = await rapydRequest({
      method: 'post', path: '/v1/payouts', body, env, keys, idempotencyKey: idempotencyKey(req),
    });
    return res.status(200).json(data);
  } catch (err) {
    return sendError(res, err, 'create-payout');
  }
}
