// POST /api/create-checkout-session → Rapyd POST /v1/checkout
// Toolkit flow: creates the hosted/embedded checkout page. Routing fields
// (env, profile) are stripped before signing; live is gated and guarded
// (utils/live-guards.js).

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
    assertLive(req, env, 'create-checkout-session', body);

    const data = await rapydRequest({
      method: 'post', path: '/v1/checkout', body, env, profile, idempotencyKey: idempotencyKey(req),
    });
    return res.status(200).json(data);
  } catch (err) {
    return sendError(res, err, 'create-checkout-session');
  }
}
