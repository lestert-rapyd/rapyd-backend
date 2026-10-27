// GET /api/get-fx-rate?buy_currency=USD&sell_currency=GBP&amount=149&fixed_side=sell&env=sandbox|live&profile=SC1
// Signed proxy to Rapyd's Get FX Rate (GET /v1/fx_rates). Powers the checkout
// FX popover's live "customer pays / you receive" preview. action_type is
// always "payment" for this demo.

import { applyCors, methodNotAllowed, resolveEnv, assertLive, rapydRequest, sendError } from '../utils/http.js';

const METHODS = ['GET'];
const CUR = /^[A-Z]{3,4}$/; // 3-letter ISO, or 4-letter stablecoin codes in sandbox

const bad = (res, message) => res.status(400).json({ error: 'INVALID_PARAMS', message });

export default async function handler(req, res) {
  if (applyCors(req, res, METHODS)) return;
  if (req.method !== 'GET') return methodNotAllowed(res, METHODS);

  try {
    const q = req.query || {};
    const buy = String(q.buy_currency || '').toUpperCase();
    const sell = String(q.sell_currency || '').toUpperCase();
    const fixedSide = q.fixed_side;
    const amount = q.amount;

    if (!CUR.test(buy) || !CUR.test(sell)) return bad(res, 'Invalid buy_currency or sell_currency');
    if (buy === sell) return bad(res, 'buy_currency and sell_currency must differ');
    if (fixedSide && !['buy', 'sell'].includes(fixedSide)) return bad(res, 'Invalid fixed_side');
    if (amount != null && amount !== '' && !(typeof amount === 'string' && Number(amount) > 0)) {
      return bad(res, 'Invalid amount');
    }

    const { env, profile } = resolveEnv(q);
    assertLive(req, env);

    // Build the query string ONCE and sign the identical path we request —
    // Rapyd recomputes the signature over the path it receives, so the string
    // after '?' must be byte-identical between the signed path and the GET.
    const params = new URLSearchParams();
    params.set('action_type', 'payment');
    params.set('buy_currency', buy);
    params.set('sell_currency', sell);
    if (amount != null && amount !== '') params.set('amount', String(amount));
    if (fixedSide) params.set('fixed_side', fixedSide);

    const data = await rapydRequest({ method: 'get', path: `/v1/fx_rates?${params.toString()}`, env, profile });
    return res.status(200).json(data);
  } catch (err) {
    return sendError(res, err, 'get-fx-rate');
  }
}
