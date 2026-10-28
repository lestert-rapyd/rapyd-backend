// POST /api/create-refund → Rapyd POST /v1/refunds
// Back office refunds. Refunds must be signed by the SAME MID that took the
// payment, so the frontend passes the profile recorded on the ledger entry.
// Live: gated, allowlisted, and the refund must carry an amount <= LIVE_MAX_AMOUNT.

import {
  applyCors, methodNotAllowed, readJsonBody, resolveEnv, cleanBody, assertLive,
  idempotencyKey, rapydRequest, sendError,
} from '../utils/http.js';

const METHODS = ['POST'];

export default async function handler(req, res) {
  if (applyCors(req, res, METHODS)) return;
  if (req.method !== 'POST') return methodNotAllowed(res, METHODS);

  try {
    const input = readJsonBody(req);
    const { env, profile } = resolveEnv(input);
    const body = cleanBody(input);
    assertLive(req, env, 'create-refund', body);

    const data = await rapydRequest({
      method: 'post', path: '/v1/refunds', body, env, profile, idempotencyKey: idempotencyKey(req),
    });
    return res.status(200).json(data);
  } catch (err) {
    return sendError(res, err, 'create-refund');
  }
}
