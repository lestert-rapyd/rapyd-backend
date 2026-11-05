// POST /api/add-customer-payment-method → Rapyd POST /v1/customers/{customer}/payment_methods
// "Add a card" with external 3DS on the merchant's own card fields: the
// merchant's 3DS provider has already authenticated the cardholder, so the
// card goes onto the customer with the outcome in payment_method_options
// (3d_version / cavv / eci / ds_trans_id). Raw card data — sandbox only: there
// is no live allowlist for this endpoint, so assertLive() refuses it in live
// (fail closed), on top of hasRawCard().
// Body: { customer: 'cus_…', env, profile, type, fields, payment_method_options }

import {
  applyCors, methodNotAllowed, readJsonBody, resolveEnv, cleanBody, assertLive,
  idempotencyKey, rapydRequest, sendError,
} from '../../utils/http.js';

const METHODS = ['POST'];
const CUSTOMER_ID = /^cus_[a-f0-9]+$/i;

export default async function handler(req, res) {
  if (applyCors(req, res, METHODS)) return;
  if (req.method !== 'POST') return methodNotAllowed(res, METHODS);

  try {
    const input = readJsonBody(req);
    const { env, profile } = resolveEnv(input);
    const { customer, ...body } = cleanBody(input);
    if (typeof customer !== 'string' || !CUSTOMER_ID.test(customer)) {
      return res.status(400).json({ error: 'INVALID_ID', message: 'Missing or invalid customer id' });
    }
    assertLive(req, env, 'add-customer-payment-method', body);

    const data = await rapydRequest({
      method: 'post', path: `/v1/customers/${customer}/payment_methods`, body, env, profile,
      idempotencyKey: idempotencyKey(req),
    });
    return res.status(200).json(data);
  } catch (err) {
    return sendError(res, err, 'add-customer-payment-method');
  }
}
