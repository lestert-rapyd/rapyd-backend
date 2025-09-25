import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

import createCheckoutSession from './api/create-checkout-session.js';
import createDirectPayment from './api/create-direct-payment.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.use('/api/create-checkout-session', createCheckoutSession);
app.use('/api/create-direct-payment', createDirectPayment);

app.get('/', (req, res) => {
  res.send('Rapyd backend is running.');
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
