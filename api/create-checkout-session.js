import axios from 'axios';
import { generateRapydSignature } from '../utils/generate-signature.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ message: 'Method not allowed' });
    return;
  }

  try {
    const body = req.body;
    const { salt, timestamp, signature } = generateRapydSignature(
      'post',
      '/v1/checkout',
      body
    );

    const response = await axios.post(
      'https://sandboxapi.rapyd.net/v1/checkout',
      body,
      {
        headers: {
          'Content-Type': 'application/json',
          access_key: process.env.RAPYD_ACCESS_KEY,
          salt,
          timestamp,
          signature,
        },
      }
    );

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(200).json(response.data.data);
  } catch (error) {
    console.error('Rapyd error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
}
