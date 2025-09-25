import axios from 'axios';
import { generateRapydSignature } from '../utils/generate-signature.js'; // Adjust path as needed

export default async function handler(req, res) {
  // Handle CORS preflight request
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }

  // Only accept POST requests
  if (req.method !== 'POST') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.body;

    if (!process.env.RAPYD_ACCESS_KEY || !process.env.RAPYD_SECRET_KEY) {
      console.error('Missing RAPYD_ACCESS_KEY or RAPYD_SECRET_KEY environment variables');
      res.setHeader('Access-Control-Allow-Origin', '*');
      return res.status(500).json({ error: 'Server configuration error: Missing API keys' });
    }

    // Generate signature for this request body
    const { salt, timestamp, signature } = generateRapydSignature('post', '/v1/checkout', body);

    // Prepare headers
    const headers = {
      'Content-Type': 'application/json',
      access_key: process.env.RAPYD_ACCESS_KEY,
      salt,
      timestamp,
      signature,
      idempotency: timestamp + salt,  // recommended for POST requests
    };

    // Make request to Rapyd API
    const rapydRes = await axios.post('https://sandboxapi.rapyd.net/v1/checkout', body, {
      headers,
      timeout: 10000,
    });

    res.setHeader('Access-Control-Allow-Origin', '*');

    console.log('Rapyd response data:', rapydRes.data);

    return res.status(200).json(rapydRes.data);

  } catch (err) {
    console.error('Error calling Rapyd /v1/checkout:', err);

    res.setHeader('Access-Control-Allow-Origin', '*');

    if (err.response) {
      return res.status(err.response.status || 500).json({
        error: err.response.data || 'Unknown error',
      });
    } else {
      return res.status(500).json({ error: err.message });
    }
  }
}
