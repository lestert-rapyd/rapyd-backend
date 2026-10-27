// POST /api/create-customer → Rapyd POST /v1/customers
// Creates the demo's card-on-file customer. The body is always the ENRICHED
// shape (name/email/date_of_birth/birth_country/nationality/occupation/
// addresses) so the same cus_*** is AFT-ready — see PLAN §1.5.

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
    assertLive(req, env, 'create-customer', body);

    const data = await rapydRequest({
      method: 'post', path: '/v1/customers', body, env, profile, idempotencyKey: idempotencyKey(req),
    });
    return res.status(200).json(data);
  } catch (err) {
    return sendError(res, err, 'create-customer');
  }
}
