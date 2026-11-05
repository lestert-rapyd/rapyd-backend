// /api/customers?op=create|retrieve|list_payment_methods|add_payment_method|card_token_page
// ONE serverless function for every customer proxy — the Vercel Hobby plan's
// 12-function cap, same arrangement as api/payouts.js: the handlers live in
// handlers/customers/ and vercel.json rewrites the public URLs
// (/api/create-customer, /api/retrieve-customer,
// /api/list-customer-payment-methods, /api/add-customer-payment-method,
// /api/create-card-token-page) onto this file, so callers and the local
// Express server (which mounts the handlers directly) are unchanged.

import { applyCors } from '../utils/http.js';
import createCustomer from '../handlers/customers/create-customer.js';
import retrieveCustomer from '../handlers/customers/retrieve-customer.js';
import listCustomerPaymentMethods from '../handlers/customers/list-customer-payment-methods.js';
import addPaymentMethod from '../handlers/customers/add-payment-method.js';
import cardTokenPage from '../handlers/customers/card-token-page.js';

const OPS = {
  create: createCustomer,
  retrieve: retrieveCustomer,
  list_payment_methods: listCustomerPaymentMethods,
  add_payment_method: addPaymentMethod,
  card_token_page: cardTokenPage,
};

export default async function handler(req, res) {
  const op = req.query?.op;
  const route = Object.hasOwn(OPS, op) ? OPS[op] : null;
  if (!route) {
    if (applyCors(req, res, ['GET', 'POST'])) return;
    return res.status(404).json({ error: 'UNKNOWN_OPERATION', message: 'Unknown customer operation' });
  }
  return route(req, res);
}
