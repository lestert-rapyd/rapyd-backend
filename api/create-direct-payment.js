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
    card
  } = req.body;

  // Basic validation (you can extend this)
  if (!amount || !currency || !card || !card.number || !card.expiration_month || !card.expiration_year || !card.cvv || !card.name) {
    return res.status(400).json({ error: 'Missing required payment or card fields' });
  }

  const paymentBody = {
    amount,
    currency,
    description,
    capture,
    payment_method: {
      type: 'card',
      fields: {
        name: card.name,
        number: card.number,
        expiration_month: card.expiration_month,
        expiration_year: card.expiration_year,
        cvv: card.cvv
      }
    }
  };

  const { salt, timestamp, signature } = generateRapydSignature(
    'post',
    '/v1/payments',
    paymentBody
  );

  try {
    const response = await axios.post(
      'https://sandboxapi.rapyd.net/v1/payments',
      paymentBody,
      {
        headers: {
          'Content-Type': 'application/json',
          access_key: process.env.RAPYD_ACCESS_KEY,
          salt,
          timestamp,
          signature
        }
      }
    );

    // Return full data to frontend for better handling
    res.status(200).json(response.data);
  } catch (err) {
    console.error('Rapyd error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Payment failed', details: err.response?.data || err.message });
  }
});

export default router;
