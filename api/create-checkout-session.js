import express from 'express';
import axios from 'axios';
import { generateRapydSignature } from '../utils/generate-signature.js';

const router = express.Router();

router.post('/', async (req, res) => {
  const body = req.body;

  const { salt, timestamp, signature } = generateRapydSignature(
    'post',
    '/v1/checkout',
    body
  );

  try {
    const response = await axios.post(
      'https://sandboxapi.rapyd.net/v1/checkout',
      body,
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

    res.status(200).json(response.data.data);
  } catch (err) {
    console.error('Rapyd error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

export default router;
