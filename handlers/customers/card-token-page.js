// POST /api/create-card-token-page → Rapyd POST /v1/hosted/collect/card
// The Hosted Tokenisation Page: Rapyd's own page (full redirect, or framed by
// the toolkit with page_type "card_token") collects and verifies the card and
// files the card_*** under the customer — no card data at the merchant, so it
// suits non-PCI merchants and runs in live (allowlisted, no amount to cap).
// Docs: https://docs.rapyd.net/en/create-card-token.html

import {
  applyCors, methodNotAllowed, readJsonBody, resolveEnv, cleanBody, assertLive,
  idempotencyKey, rapydRequest, sendError,
} from '../../utils/http.js';

const METHODS = ['POST'];

export default async function handler(req, res) {
  if (applyCors(req, res, METHODS)) return;
  if (req.method !== 'POST') return methodNotAllowed(res, METHODS);

  try {
    const input = readJsonBody(req);
    const { env, profile } = resolveEnv(input);
    const body = cleanBody(input);
    assertLive(req, env, 'create-card-token-page', body);

    const data = await rapydRequest({
      method: 'post', path: '/v1/hosted/collect/card', body, env, profile, idempotencyKey: idempotencyKey(req),
    });
    return res.status(200).json(data);
  } catch (err) {
    return sendError(res, err, 'create-card-token-page');
  }
}
