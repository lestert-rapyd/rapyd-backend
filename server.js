// Local runner: mounts the same api/*.js handlers Vercel serves, so
// `npm start` behaves like the deployment. No global CORS middleware — each
// handler owns CORS (utils/http.js applyCors); a cors() layer would answer
// preflights itself with '*' and bypass ALLOWED_ORIGINS.
import express from 'express';
import dotenv from 'dotenv';

import createCheckoutSession from './api/create-checkout-session.js';
import createCustomer from './api/create-customer.js';
import createDirectPayment from './api/create-direct-payment.js';
import createPayout from './handlers/payouts/create-payout.js';
import createRefund from './api/create-refund.js';
import getFxRate from './api/get-fx-rate.js';
import listCustomerPaymentMethods from './api/list-customer-payment-methods.js';
import payoutMethodTypes from './handlers/payouts/payout-method-types.js';
import payoutRequiredFields from './handlers/payouts/payout-required-fields.js';
import retrieveCustomer from './api/retrieve-customer.js';
import retrievePayment from './api/retrieve-payment.js';
import retrievePayout from './handlers/payouts/retrieve-payout.js';
import webhook, { MAX_WEBHOOK_BYTES } from './api/webhook.js';
import webhooks from './api/webhooks.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
app.disable('x-powered-by');

// Keep the raw body for the webhook route so signature verification works
// locally: express.raw consumes the stream, so the handler reads
// req.rawBodyString instead of waiting on a stream that already ended.
app.use('/api/webhook', express.raw({ type: '*/*', limit: MAX_WEBHOOK_BYTES }), (req, res, next) => {
  if (Buffer.isBuffer(req.body)) req.rawBodyString = req.body.toString('utf8');
  next();
});
app.use(express.json());

app.use('/api/create-checkout-session', createCheckoutSession);
app.use('/api/create-customer', createCustomer);
app.use('/api/create-direct-payment', createDirectPayment);
app.use('/api/create-payout', createPayout);
app.use('/api/create-refund', createRefund);
app.use('/api/get-fx-rate', getFxRate);
app.use('/api/list-customer-payment-methods', listCustomerPaymentMethods);
app.use('/api/payout-method-types', payoutMethodTypes);
app.use('/api/payout-required-fields', payoutRequiredFields);
app.use('/api/retrieve-customer', retrieveCustomer);
app.use('/api/retrieve-payment', retrievePayment);
app.use('/api/retrieve-payout', retrievePayout);
app.use('/api/webhook', webhook);
app.use('/api/webhooks', webhooks);

app.get('/', (req, res) => {
  res.send('Rapyd backend is running.');
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
