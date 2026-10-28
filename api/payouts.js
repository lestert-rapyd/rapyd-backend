// /api/payouts?op=create|retrieve|method_types|required_fields
// ONE serverless function for every payout proxy. Vercel's Hobby plan caps a
// deployment at 12 functions and every file under api/ is one, so the payout
// handlers live in handlers/payouts/ and this file dispatches to them.
// vercel.json rewrites the public URLs (/api/create-payout, /api/retrieve-payout,
// /api/payout-method-types, /api/payout-required-fields) onto it, so callers and
// the local Express server (which mounts the handlers directly) are unchanged.

import { applyCors } from '../utils/http.js';
import createPayout from '../handlers/payouts/create-payout.js';
import retrievePayout from '../handlers/payouts/retrieve-payout.js';
import payoutMethodTypes from '../handlers/payouts/payout-method-types.js';
import payoutRequiredFields from '../handlers/payouts/payout-required-fields.js';

const OPS = {
  create: createPayout,
  retrieve: retrievePayout,
  method_types: payoutMethodTypes,
  required_fields: payoutRequiredFields,
};

export default async function handler(req, res) {
  const op = req.query?.op;
  const route = Object.hasOwn(OPS, op) ? OPS[op] : null;
  if (!route) {
    if (applyCors(req, res, ['GET', 'POST'])) return;
    return res.status(404).json({ error: 'UNKNOWN_OPERATION', message: 'Unknown payout operation' });
  }
  return route(req, res);
}
