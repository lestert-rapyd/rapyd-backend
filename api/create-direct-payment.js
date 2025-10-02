import express from 'express';
import axios from 'axios';
import { generateRapydSignature } from '../utils/generate-signature.js';

const router = express.Router();

router.post('/', async (req, res) => {
  const {
    amount,
    currency,
    description,
    capture = true,
    card,
    env = 'sandbox' // default to sandbox
  } = req.body;

  // Validate card fields
  if (!amount || !currency || !card || !card.number || !card.expiration_month || !card.expiration_year || !card.cvv || !card.name) {
    return res.status(400).json({ error: 'Missing required payment or card fields' });
  }

  // Pick the correct credentials
  const accessKey = env === 'live'
    ? process.env.RAPYD_LIVE_ACCESS_KEY
    : process.env.RAPYD_SANDBOX_ACCESS_KEY;

  const secretKey = env === 'live'
    ? process.env.RAPYD_LIVE_SECRET_KEY
    : process.env.RAPYD_SANDBOX_SECRET_KEY;

  if (!accessKey || !secretKey) {
    return res.status(500).json({ error: `Missing API keys for ${env} environment` });
  }

  const paymentBody = {
    amount,
    currency,
    description,
    capture,
    payment_method: {
      type: 'de_visa_card',
      fields: {
        name: card.name,
        number: card.number,
        expiration_month: card.expiration_month,
        expiration_year: card.expiration_year,
        cvv: card.cvv
      }
    }
  };

  // Generate signature with dynamic credentials
  const { salt, timestamp, signature } = generateRapydSignature(
    'post',
    '/v1/payments',
    paymentBody,
    accessKey,
    secretKey
  );

  const baseURL = env === 'live'
    ? 'https://api.rapyd.net'
    : 'https://sandboxapi.rapyd.net';

  try {
    const response = await axios.post(
      `${baseURL}/v1/payments`,
      paymentBody,
      {
        headers: {
          'Content-Type': 'application/json',
          access_key: accessKey,
          salt,
          timestamp,
          signature
        }
      }
    );

    res.status(200).json(response.data);
  } catch (err) {
    console.error('Rapyd error:', err.response?.data || err.message);
    res.status(500).json({
      error: 'Payment failed',
      details: err.response?.data || err.message
    });
  }
});

export default router;
