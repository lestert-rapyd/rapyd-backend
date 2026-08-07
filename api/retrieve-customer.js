// GET /api/retrieve-customer?id=cus_xxx&env=sandbox|live&profile=SC1|SC2|SC3
// Signed proxy to Rapyd's Retrieve Customer. Powers the back office's customer
// view, so the cus_*** created by beat 1 can be read back from Rapyd (live
// payment_methods, created_at) instead of being narrated from session state.

import axios from 'axios';
import { generateRapydSignature } from '../utils/generate-signature.js';
import { mapRapydError } from '../utils/map-rapyd-error.js';
import { resolveKeys } from '../utils/key-profiles.js';

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
    const customerId = req.query?.id;
    if (!customerId || !/^cus_[a-f0-9]+$/i.test(customerId)) {
      return res.status(400).json({ error: 'Missing or invalid customer id' });
    }

    const env = req.query?.env === 'live' ? 'live' : 'sandbox';
    // A customer belongs to the MID that created it — the frontend passes the
    // profile the cus_*** was minted under (same rule as retrieve-payment).
    const { access: accessKey, secret: secretKey } = resolveKeys({ env, profile: req.query?.profile });
    if (!accessKey || !secretKey) {
      return res.status(500).json({ error: `Missing API keys for ${env}/${req.query?.profile || 'SC1'}` });
    }

    const urlPath = `/v1/customers/${customerId}`;
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
    console.error('Rapyd retrieve-customer error:', JSON.stringify(rapydStatus, null, 2));
    return res.status(400).json({ error: mappedError.code, message: mappedError.message, raw: rapydStatus });
  }
}
