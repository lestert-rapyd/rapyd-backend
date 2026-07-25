// GET /api/list-customer-payment-methods?customer=cus_xxx&profile=SC1&env=sandbox|live
// Signed proxy to Rapyd's List Payment Methods of Customer. Powers the back
// office "Sync from Rapyd" action and the silent token backfill after a
// save-while-paying completes. Card objects carry id (card_***), type, last4,
// expiration_month/year and network_reference_id.

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
    const customer = req.query?.customer;
    if (!customer || !/^cus_[a-f0-9]+$/i.test(customer)) {
      return res.status(400).json({ error: 'Missing or invalid customer id' });
    }

    const env = req.query?.env === 'live' ? 'live' : 'sandbox';
    const { access: accessKey, secret: secretKey } = resolveKeys({ env, profile: req.query?.profile });
    if (!accessKey || !secretKey) {
      return res.status(500).json({ error: `Missing API keys for ${env}/${req.query?.profile || 'SC1'}` });
    }

    // Sign the identical path we request — Rapyd recomputes the signature over
    // the path it receives, query string included (same rule as get-fx-rate).
    const urlPath = `/v1/customers/${customer}/payment_methods?category=card`;
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
    console.error('Rapyd list-payment-methods error:', JSON.stringify(rapydStatus, null, 2));
    return res.status(400).json({ error: mappedError.code, message: mappedError.message, raw: rapydStatus });
  }
}
