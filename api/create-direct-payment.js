import axios from 'axios';
import { generateRapydSignature } from '../utils/generate-signature.js'; // Adjust path if needed
import { mapRapydError } from '../utils/map-rapyd-error.js';

export default async function handler(req, res) {
  // CORS preflight support
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.body;
    const env = body.env === 'live' ? 'live' : 'sandbox'; // default to sandbox

    // Pick environment-specific keys
    const accessKey = env === 'live'
      ? process.env.RAPYD_LIVE_ACCESS_KEY
      : process.env.RAPYD_SANDBOX_ACCESS_KEY;

    const secretKey = env === 'live'
      ? process.env.RAPYD_LIVE_SECRET_KEY
      : process.env.RAPYD_SANDBOX_SECRET_KEY;

    // Validation
    if (!accessKey || !secretKey) {
      console.error('Missing Rapyd keys for environment:', env);
      res.setHeader('Access-Control-Allow-Origin', '*');
      return res.status(500).json({ error: `Missing API keys for ${env} environment` });
    }

    // Generate Rapyd signature
    const { salt, timestamp, signature } = generateRapydSignature(
      'post',
      '/v1/payments',
      body,
      accessKey,
      secretKey
    );

    const headers = {
      'Content-Type': 'application/json',
      access_key: accessKey,
      salt,
      timestamp,
      signature,
      idempotency: timestamp + salt,
    };

    const baseURL = env === 'live'
      ? 'https://api.rapyd.net'
      : 'https://sandboxapi.rapyd.net';

    const rapydRes = await axios.post(`${baseURL}/v1/payments`, body, {
      headers,
      timeout: 10000,
    });

    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(200).json(rapydRes.data);

    } catch (err) {
    const errorData = err.response?.data || {};
    const rapydStatus = errorData.status || {};
    const mappedError = mapRapydError(rapydStatus.error_code);
  
    console.error('Rapyd error:', JSON.stringify(rapydStatus, null, 2));
  
    return res.status(400).json({
      error: mappedError.code,
      message: mappedError.message,
      hint: mappedError.hint,
      raw: rapydStatus  // Optional: include this for debugging
    });
  }
}
