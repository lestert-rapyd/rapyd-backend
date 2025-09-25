import axios from 'axios';
import { generateRapydSignature } from './generate-signature.js';  // adjust path as needed

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.body;

    if (!process.env.RAPYD_ACCESS_KEY || !process.env.RAPYD_SECRET_KEY) {
      console.error('Missing RAPYD_ACCESS_KEY or RAPYD_SECRET_KEY environment variables');
      return res.status(500).json({ error: 'Server configuration error: Missing API keys' });
    }

    const { salt, timestamp, signature } = generateRapydSignature('post', '/v1/checkout', body);

    const rapydRes = await axios.post('https://sandboxapi.rapyd.net/v1/checkout', body, {
      headers: {
        'Content-Type': 'application/json',
        access_key: process.env.RAPYD_ACCESS_KEY,
        salt,
        timestamp,
        signature,
        idempotency: timestamp + salt,  // recommended for POST requests
      },
      timeout: 10000,
    });

    res.setHeader('Access-Control-Allow-Origin', '*');

    console.log('Rapyd response data:', rapydRes.data);

    return res.status(200).json(rapydRes.data);

  } catch (err) {
    console.error('Error calling Rapyd /v1/checkout:', err);

    if (err.response) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      return res.status(err.response.status || 500).json({
        error: err.response.data || 'Unknown error',
      });
    } else {
      res.setHeader('Access-Control-Allow-Origin', '*');
      return res.status(500).json({ error: err.message });
    }
  }
}
