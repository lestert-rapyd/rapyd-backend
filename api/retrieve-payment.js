// GET /api/retrieve-payment?id=payment_xxx&env=sandbox|live
// Signed proxy to Rapyd's Retrieve Payment. Used as the polling fallback when
// a webhook is delayed or not yet configured.

import axios from 'axios';
import { generateRapydSignature } from '../utils/generate-signature.js';
import { mapRapydError } from '../utils/map-rapyd-error.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const paymentId = req.query?.id;
    if (!paymentId || !/^payment_[a-f0-9]+$/i.test(paymentId)) {
      return res.status(400).json({ error: 'Missing or invalid payment id' });
    }

    const env = req.query?.env === 'live' ? 'live' : 'sandbox';
    const accessKey = env === 'live' ? process.env.RAPYD_LIVE_ACCESS_KEY : process.env.RAPYD_SANDBOX_ACCESS_KEY;
    const secretKey = env === 'live' ? process.env.RAPYD_LIVE_SECRET_KEY : process.env.RAPYD_SANDBOX_SECRET_KEY;
    if (!accessKey || !secretKey) {
      return res.status(500).json({ error: `Missing API keys for ${env} environment` });
    }

    const urlPath = `/v1/payments/${paymentId}`;
    const { salt, timestamp, signature } = generateRapydSignature('get', urlPath, null, accessKey, secretKey);
    const baseURL = env === 'live' ? 'https://api.rapyd.net' : 'https://sandboxapi.rapyd.net';

    const rapydRes = await axios.get(`${baseURL}${urlPath}`, {
      headers: { 'Content-Type': 'application/json', access_key: accessKey, salt, timestamp, signature },
      timeout: 10000,
    });

    return res.status(200).json(rapydRes.data);
  } catch (err) {
    const rapydStatus = err.response?.data?.status || {};
    const mappedError = mapRapydError(rapydStatus.error_code);
    console.error('Rapyd retrieve error:', JSON.stringify(rapydStatus, null, 2));
    return res.status(400).json({ error: mappedError.code, message: mappedError.message, raw: rapydStatus });
  }
}
