// POST /api/create-direct-payment → Rapyd POST /v1/payments
// Own-fields flow, express token charge and back-office MIT charge. The body
// is the Rapyd payment body plus routing fields (env, profile) that are
// stripped before signing. Live: gated by X-PayBridge-Live-Token, no raw
// card data, allowlisted fields, amount <= LIVE_MAX_AMOUNT (utils/live-guards.js).

import { resolveKeys, clientIp } from '../utils/key-profiles.js';
import {
  applyCors, methodNotAllowed, readJsonBody, resolveEnv, cleanBody, assertLive,
  idempotencyKey, rapydRequest, missingKeysError, sendError,
} from '../utils/http.js';

const METHODS = ['POST'];

export default async function handler(req, res) {
  if (applyCors(req, res, METHODS)) return;
  if (req.method !== 'POST') return methodNotAllowed(res, METHODS);

  try {
    const input = readJsonBody(req);
    const { env, profile } = resolveEnv(input);
    const body = cleanBody(input);
    assertLive(req, env, 'create-direct-payment', body);

    // Keys + collection wallet from the env/profile registry (SC1/SC2/SC3)
    const keys = resolveKeys({ env, profile });
    if (!keys.access || !keys.secret) throw missingKeysError(env, keys.profile);

    // Transitional guard: when the SC1 env vars aren't deployed yet we sign
    // with the LEGACY sandbox MID — the frontend's profile ewallet id doesn't
    // belong to it and Rapyd rejects the payment with ERROR_GET_USER. Strip
    // the wallet so the MID's default is used; the real routing engages
    // automatically once RAPYD_SC1_* land in the environment.
    if (keys.fallback && body.ewallet) delete body.ewallet;

    // Server-side enrichments — BEFORE signing, so the signature matches:
    // the browser can't see its own public IP (client_details), and the live
    // profile's wallet id is only known server-side.
    if (body.client_details && typeof body.client_details === 'object' && !body.client_details.ip_address) {
      const ip = clientIp(req);
      if (ip) body.client_details = { ...body.client_details, ip_address: ip };
    }
    if (!body.ewallet && keys.ewallet) body.ewallet = keys.ewallet;

    const data = await rapydRequest({
      method: 'post', path: '/v1/payments', body, env, keys, idempotencyKey: idempotencyKey(req),
    });
    return res.status(200).json(data);
  } catch (err) {
    return sendError(res, err, 'create-direct-payment');
  }
}
