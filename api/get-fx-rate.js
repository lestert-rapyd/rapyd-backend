// GET /api/get-fx-rate?buy_currency=USD&sell_currency=GBP&amount=149&fixed_side=sell&env=sandbox|live
// Signed proxy to Rapyd's Get FX Rate (GET /v1/fx_rates). Powers the checkout
// FX popover's live "customer pays / you receive" preview. action_type is
// always "payment" for this demo.

import axios from 'axios';
import { generateRapydSignature } from '../utils/generate-signature.js';
import { mapRapydError } from '../utils/map-rapyd-error.js';
import { resolveKeys } from '../utils/key-profiles.js';

const CUR = /^[A-Z]{3,4}$/; // 3-letter ISO, or 4-letter stablecoin codes in sandbox

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
    const buy = String(req.query?.buy_currency || '').toUpperCase();
    const sell = String(req.query?.sell_currency || '').toUpperCase();
    const fixedSide = req.query?.fixed_side;
    const amount = req.query?.amount;

    if (!CUR.test(buy) || !CUR.test(sell)) {
      return res.status(400).json({ error: 'Invalid buy_currency or sell_currency' });
    }
    if (buy === sell) {
      return res.status(400).json({ error: 'buy_currency and sell_currency must differ' });
    }
    if (fixedSide && !['buy', 'sell'].includes(fixedSide)) {
      return res.status(400).json({ error: 'Invalid fixed_side' });
    }
    if (amount != null && amount !== '' && !(Number(amount) > 0)) {
      return res.status(400).json({ error: 'Invalid amount' });
    }

    const env = req.query?.env === 'live' ? 'live' : 'sandbox';
    const { access: accessKey, secret: secretKey } = resolveKeys({ env, profile: req.query?.profile });
    if (!accessKey || !secretKey) {
      return res.status(500).json({ error: `Missing API keys for ${env}/${req.query?.profile || 'SC1'}` });
    }

    // Build the query string ONCE and sign the identical path we request —
    // Rapyd recomputes the signature over the path it receives, so the string
    // after '?' must be byte-identical between the signed path and the GET.
    const params = new URLSearchParams();
    params.set('action_type', 'payment');
    params.set('buy_currency', buy);
    params.set('sell_currency', sell);
    if (amount != null && amount !== '') params.set('amount', String(amount));
    if (fixedSide) params.set('fixed_side', fixedSide);
    const urlPath = `/v1/fx_rates?${params.toString()}`;

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
    console.error('Rapyd fx-rate error:', JSON.stringify(rapydStatus, null, 2));
    return res.status(400).json({ error: mappedError.code, message: mappedError.message, raw: rapydStatus });
  }
}
