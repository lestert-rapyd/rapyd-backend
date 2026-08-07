import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

import createCheckoutSession from './api/create-checkout-session.js';
import createCustomer from './api/create-customer.js';
import createDirectPayment from './api/create-direct-payment.js';
import getFxRate from './api/get-fx-rate.js';
import listCustomerPaymentMethods from './api/list-customer-payment-methods.js';
import retrieveCustomer from './api/retrieve-customer.js';
import retrievePayment from './api/retrieve-payment.js';
import webhook from './api/webhook.js';
import webhooks from './api/webhooks.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
// Keep the raw body for the webhook route so signature verification works locally.
app.use('/api/webhook', express.raw({ type: '*/*' }), (req, res, next) => {
  if (Buffer.isBuffer(req.body)) req.rawBodyString = req.body.toString('utf8');
  next();
});
app.use(express.json());

app.use('/api/create-checkout-session', createCheckoutSession);
app.use('/api/create-customer', createCustomer);
app.use('/api/create-direct-payment', createDirectPayment);
app.use('/api/get-fx-rate', getFxRate);
app.use('/api/list-customer-payment-methods', listCustomerPaymentMethods);
app.use('/api/retrieve-customer', retrieveCustomer);
app.use('/api/retrieve-payment', retrievePayment);
app.use('/api/webhook', webhook);
app.use('/api/webhooks', webhooks);

app.get('/', (req, res) => {
  res.send('Rapyd backend is running.');
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
