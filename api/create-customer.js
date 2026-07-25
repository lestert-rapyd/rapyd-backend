// POST /api/create-customer → Rapyd POST /v1/customers
// Creates the demo's card-on-file customer. The body is always the ENRICHED
// shape (name/email/date_of_birth/birth_country/nationality/occupation/
// addresses) so the same cus_*** is AFT-ready — see PLAN §1.5.

import axios from 'axios';
import { generateRapydSignature } from '../utils/generate-signature.js';
import { mapRapydError } from '../utils/map-rapyd-error.js';
import { resolveKeys } from '../utils/key-profiles.js';

export default async function handler(req, res) {
  // Set CORS on every response path (incl. the catch), so a Rapyd error
  // returns its real body instead of being CORS-blocked into a "Failed to fetch".
  res.setHeader('Access-Control-Allow-Origin', '*');

  // CORS preflight support
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.body;
    const env = body.env === 'live' ? 'live' : 'sandbox'; // default to sandbox
    const { access: accessKey, secret: secretKey } = resolveKeys({ env, profile: body.profile });

    if (!accessKey || !secretKey) {
      console.error('Missing Rapyd keys for:', env, body.profile);
      return res.status(500).json({ error: `Missing API keys for ${env}/${body.profile || 'SC1'}` });
    }

    // Generate Rapyd signature
    const { salt, timestamp, signature } = generateRapydSignature(
      'post',
      '/v1/customers',
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

    const rapydRes = await axios.post(`${baseURL}/v1/customers`, body, {
      headers,
      timeout: 10000,
    });

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
      raw: rapydStatus,
    });
  }
}
