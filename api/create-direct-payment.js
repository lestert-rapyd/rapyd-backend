import axios from 'axios';
import { generateRapydSignature } from '../utils/generate-signature.js'; // Adjust path if needed
import { mapRapydError } from '../utils/map-rapyd-error.js';
import { resolveKeys, clientIp } from '../utils/key-profiles.js';

export default async function handler(req, res) {
  // Set CORS on every response path (incl. the catch), so a Rapyd decline/error
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

    // Pick keys + collection wallet from the env/profile registry (SC1/SC2/SC3)
    const { access: accessKey, secret: secretKey, ewallet, fallback } = resolveKeys({ env, profile: body.profile });

    // Transitional guard: when the SC1 env vars aren't deployed yet we sign
    // with the LEGACY sandbox MID — the frontend's profile ewallet id doesn't
    // belong to it and Rapyd rejects the payment with ERROR_GET_USER. Strip
    // the wallet so the MID's default is used; the real routing engages
    // automatically once RAPYD_SC1_* land in the environment.
    if (fallback && body.ewallet) delete body.ewallet;

    // Validation
    if (!accessKey || !secretKey) {
      console.error('Missing Rapyd keys for:', env, body.profile);
      res.setHeader('Access-Control-Allow-Origin', '*');
      return res.status(500).json({ error: `Missing API keys for ${env}/${body.profile || 'SC1'}` });
    }

    // Server-side enrichments — BEFORE signing, so the signature matches:
    // the browser can't see its own public IP (client_details), and the live
    // profile's wallet id is only known server-side.
    if (body.client_details && !body.client_details.ip_address) {
      const ip = clientIp(req);
      if (ip) body.client_details.ip_address = ip;
    }
    if (!body.ewallet && ewallet) body.ewallet = ewallet;

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
