/* ── Payout helpers ────────────────────────────────────────────
   Shared by the four payout proxies (create-payout, retrieve-payout,
   payout-required-fields, payout-method-types). Pure apart from reading
   LIVE_PAYOUTS_ENABLED, so tests/payouts.test.js exercises them directly.

   Rapyd references (field names confirmed on these pages):
     Create Payout                 https://docs.rapyd.net/en/create-payout.html
     Retrieve Payout               https://docs.rapyd.net/en/retrieve-payout.html
     Get Payout Required Fields    https://docs.rapyd.net/en/get-payout-required-fields.html
     List Payout Method Types      https://docs.rapyd.net/en/list-payout-method-types.html
     Card payouts (guide)          https://docs.rapyd.net/en/card-payout.html
   ───────────────────────────────────────────────────────────── */

import { HttpError } from './http.js';
import { livePayoutsEnabled } from './live-guards.js';

export const COUNTRY = /^[A-Z]{2}$/;
export const CURRENCY = /^[A-Z]{3,4}$/;          // 4-letter codes exist for stablecoin payouts
export const ENTITY_TYPES = ['individual', 'company'];
// <country>_<method> — e.g. us_visa_card, us_debit_visa_card, at_sepa_bank.
export const PAYOUT_METHOD_TYPE = /^[a-z]{2}_[a-z0-9_]{2,60}$/;
export const PAYOUT_ID = /^payout_[a-f0-9]+$/i;
export const PAYOUT_CATEGORIES = ['bank', 'card', 'cash', 'ewallet', 'rapyd_ewallet'];
// Create Payout: merchant_reference_id is limited to 45 characters (stricter
// than payments) — the frontend's wd_… references are ~33.
export const MAX_PAYOUT_REF = 45;
export const MAX_STATEMENT_DESCRIPTOR = 35;

/**
 * Live payouts move real money out of the merchant's wallet — refused
 * outright (before the live gate even looks at the token) unless
 * LIVE_PAYOUTS_ENABLED=true. Sandbox is never affected.
 */
export function assertPayoutsAllowed(env) {
  if (env === 'live' && !livePayoutsEnabled()) {
    throw new HttpError(403, {
      error: 'LIVE_PAYOUTS_DISABLED',
      message: 'Live payouts are disabled on this backend (set LIVE_PAYOUTS_ENABLED=true to allow them).',
    });
  }
}

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const isDecimal = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0)
  || (typeof v === 'string' && /^(\d+\.?\d*|\.\d+)$/.test(v.trim()) && Number(v) > 0);

/**
 * Shape check for a Create Payout body (already cleaned of env/profile).
 * Rapyd validates the rest; this only refuses what would otherwise reach
 * Rapyd malformed or dodge the live cap. null = OK, else { error, message }.
 */
export function payoutBodyProblem(b = {}) {
  if (!isPlainObject(b)) return { error: 'INVALID_BODY', message: 'Request body must be a JSON object.' };
  const hasPayout = b.payout_amount !== undefined;
  const hasSender = b.sender_amount !== undefined;
  // Create Payout: payout_amount is required unless sender_amount is used.
  if (!hasPayout && !hasSender) return { error: 'INVALID_AMOUNT', message: 'payout_amount (or sender_amount) is required.' };
  if (hasPayout && !isDecimal(b.payout_amount)) return { error: 'INVALID_AMOUNT', message: 'payout_amount must be a positive decimal.' };
  if (hasSender && !isDecimal(b.sender_amount)) return { error: 'INVALID_AMOUNT', message: 'sender_amount must be a positive decimal.' };
  if (typeof b.payout_method_type !== 'string' || !PAYOUT_METHOD_TYPE.test(b.payout_method_type)) {
    return { error: 'INVALID_PAYOUT_METHOD_TYPE', message: 'payout_method_type must look like us_visa_card.' };
  }
  for (const k of ['payout_currency', 'sender_currency']) {
    if (typeof b[k] !== 'string' || !CURRENCY.test(b[k])) return { error: 'INVALID_CURRENCY', message: `${k} must be an ISO 4217 code.` };
  }
  for (const k of ['beneficiary_country', 'sender_country']) {
    if (typeof b[k] !== 'string' || !COUNTRY.test(b[k])) return { error: 'INVALID_COUNTRY', message: `${k} must be an ISO 3166-1 alpha-2 code.` };
  }
  // The method type's two-letter prefix must match the beneficiary country (Create Payout).
  if (b.payout_method_type.slice(0, 2) !== b.beneficiary_country.toLowerCase()) {
    return { error: 'INVALID_PAYOUT_METHOD_TYPE', message: 'payout_method_type prefix must match beneficiary_country.' };
  }
  for (const k of ['beneficiary_entity_type', 'sender_entity_type']) {
    if (!ENTITY_TYPES.includes(b[k])) return { error: 'INVALID_ENTITY_TYPE', message: `${k} must be individual or company.` };
  }
  for (const k of ['beneficiary', 'sender']) {
    const v = b[k];
    const ok = isPlainObject(v) || (typeof v === 'string' && new RegExp(`^${k}_[A-Za-z0-9]+$`).test(v));
    if (!ok) return { error: 'INVALID_PARTY', message: `${k} must be an object or a ${k}_*** id.` };
  }
  if (b.merchant_reference_id !== undefined
    && (typeof b.merchant_reference_id !== 'string' || !b.merchant_reference_id || b.merchant_reference_id.length > MAX_PAYOUT_REF)) {
    return { error: 'INVALID_REF', message: `merchant_reference_id must be 1–${MAX_PAYOUT_REF} characters.` };
  }
  if (b.statement_descriptor !== undefined
    && (typeof b.statement_descriptor !== 'string' || b.statement_descriptor.length > MAX_STATEMENT_DESCRIPTOR)) {
    return { error: 'INVALID_DESCRIPTOR', message: `statement_descriptor must be at most ${MAX_STATEMENT_DESCRIPTOR} characters.` };
  }
  if (b.confirm_automatically !== undefined && typeof b.confirm_automatically !== 'boolean') {
    return { error: 'INVALID_BODY', message: 'confirm_automatically must be a boolean.' };
  }
  return null;
}

/* ── GET query builders ─────────────────────────────────────
   Built ONCE and signed as-is (see get-fx-rate.js): the path Rapyd
   recomputes the signature over must be byte-identical. Every value is
   validated against a closed charset first, so URLSearchParams never has
   anything to percent-encode. */

const upper = (v) => (typeof v === 'string' ? v.trim().toUpperCase() : '');

/**
 * GET /v1/payout_methods/{payout_method_type}/required_fields?…
 * All seven query parameters appear in every documented example (and
 * sender_country is confirmed required), so all seven are required here.
 * @returns {{ path: string } | { error: string, message: string }}
 */
export function requiredFieldsPath(q = {}) {
  const type = typeof q.payout_method_type === 'string' ? q.payout_method_type.trim() : '';
  if (!PAYOUT_METHOD_TYPE.test(type)) return { error: 'INVALID_PARAMS', message: 'Invalid payout_method_type.' };
  const params = new URLSearchParams();
  for (const k of ['sender_country', 'beneficiary_country']) {
    const v = upper(q[k]);
    if (!COUNTRY.test(v)) return { error: 'INVALID_PARAMS', message: `Invalid ${k}.` };
    params.set(k, v);
  }
  for (const k of ['sender_currency', 'payout_currency']) {
    const v = upper(q[k]);
    if (!CURRENCY.test(v)) return { error: 'INVALID_PARAMS', message: `Invalid ${k}.` };
    params.set(k, v);
  }
  for (const k of ['sender_entity_type', 'beneficiary_entity_type']) {
    if (!ENTITY_TYPES.includes(q[k])) return { error: 'INVALID_PARAMS', message: `Invalid ${k}.` };
    params.set(k, q[k]);
  }
  if (!isDecimal(q.payout_amount)) return { error: 'INVALID_PARAMS', message: 'Invalid payout_amount.' };
  params.set('payout_amount', String(q.payout_amount).trim());
  return { path: `/v1/payout_methods/${type}/required_fields?${params.toString()}` };
}

/**
 * GET /v1/payout_method_types?… — every filter optional, but the demo
 * always narrows by category + beneficiary country + payout currency.
 * @returns {{ path: string } | { error: string, message: string }}
 */
export function methodTypesPath(q = {}) {
  const params = new URLSearchParams();
  if (q.category !== undefined && q.category !== '') {
    if (!PAYOUT_CATEGORIES.includes(q.category)) return { error: 'INVALID_PARAMS', message: 'Invalid category.' };
    params.set('category', q.category);
  }
  for (const k of ['beneficiary_country', 'sender_country']) {
    if (q[k] === undefined || q[k] === '') continue;
    const v = upper(q[k]);
    if (!COUNTRY.test(v)) return { error: 'INVALID_PARAMS', message: `Invalid ${k}.` };
    params.set(k, v);
  }
  for (const k of ['payout_currency', 'sender_currency']) {
    if (q[k] === undefined || q[k] === '') continue;
    const v = upper(q[k]);
    if (!CURRENCY.test(v)) return { error: 'INVALID_PARAMS', message: `Invalid ${k}.` };
    params.set(k, v);
  }
  for (const k of ['beneficiary_entity_type', 'sender_entity_type']) {
    if (q[k] === undefined || q[k] === '') continue;
    if (!ENTITY_TYPES.includes(q[k])) return { error: 'INVALID_PARAMS', message: `Invalid ${k}.` };
    params.set(k, q[k]);
  }
  const s = params.toString();
  return { path: `/v1/payout_method_types${s ? `?${s}` : ''}` };
}
