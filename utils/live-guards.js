/* ── Live-mode guards ──────────────────────────────────────────
   Live requests are signed with the REAL merchant keys, so the backend —
   not the browser — enforces what a live call may do. Two layers:

   1. liveGate(req, env): live is OFF unless PAYBRIDGE_LIVE_TOKEN is set on
      the server, and every live request (POST and GET) must present it in
      the X-PayBridge-Live-Token header. Sandbox requests are never gated.

   2. liveGuardError(endpoint, body): applied to the CLEANED body (env /
      profile / idempotency_key already stripped) of live POSTs only:
        · raw card data (PAN/CVV) is refused outright — this Vercel function
          is not PCI-scoped, so live only takes card_*** tokens or the toolkit;
        · top-level fields must be in the endpoint's allowlist below;
        · amount must be > 0 and <= LIVE_MAX_AMOUNT (default 1) on payments,
          checkout sessions and refunds (a live refund must state its amount).
   ───────────────────────────────────────────────────────────── */

import crypto from 'crypto';

/* Top-level field allowlists, built from the frontend's body builders
   (paybridge/js/flows/own-fields.js displayBody, toolkit.js displayBody +
   expressBody, back-office.js mitBody + buildBody, customers.js
   enrichedCustomerBody via customer-beat.js). Deliberately NOT listed:
     · ewallet — the frontend omits it in live (profileEwallet() is
       sandbox-only); the live collection wallet is injected server-side
       from RAPYD_LIVE_EWALLETS, so a caller can't pick one;
     · complete/error_payment_url, metadata, … — never sent by the app.
   Add a field here only when the app starts sending it in live. */
export const LIVE_ALLOWED_FIELDS = {
  'create-direct-payment': [
    'amount', 'currency', 'requested_currency', 'fixed_side', 'expiration',
    'capture', 'customer', 'merchant_reference_id', 'statement_descriptor',
    'description', 'payment_method', 'initiation_type', 'payment_method_options',
    'address', 'client_details', 'save_payment_method',
  ],
  'create-checkout-session': [
    'amount', 'capture', 'currency', 'country', 'customer', 'require_card_cvv',
    'recurrence_type', 'save_payment_method', 'description', 'statement_descriptor',
    'merchant_reference_id', 'complete_checkout_url', 'cancel_checkout_url',
    'custom_elements', 'payment_method_type_categories', 'payment_method_options',
    'requested_currency', 'fixed_side', 'expiration',
  ],
  'create-refund': ['payment', 'merchant_reference_id', 'amount', 'currency', 'reason'],
  'create-customer': [
    'name', 'email', 'date_of_birth', 'birth_country', 'nationality', 'occupation', 'addresses',
  ],
};

const AMOUNT_CAPPED = new Set(['create-direct-payment', 'create-checkout-session', 'create-refund']);

/** LIVE_MAX_AMOUNT as a positive number; anything unset/invalid → 1. */
export function liveMaxAmount() {
  const n = Number(process.env.LIVE_MAX_AMOUNT);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/** Constant-time string compare. Hashing first gives equal-length buffers,
    so timingSafeEqual never throws and the token's length doesn't leak. */
export function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// A short token is guessable; refuse to run live on one rather than pretend.
const MIN_TOKEN_LENGTH = 16;

/**
 * Live gate. Returns null when the request may proceed, otherwise
 * { status, error, message } (403 LIVE_DISABLED / 401 LIVE_AUTH_REQUIRED).
 */
export function liveGate(req, env) {
  if (env !== 'live') return null;
  const expected = (process.env.PAYBRIDGE_LIVE_TOKEN || '').trim();
  if (expected.length < MIN_TOKEN_LENGTH) {
    return {
      status: 403,
      error: 'LIVE_DISABLED',
      message: 'Live mode is disabled on this backend (PAYBRIDGE_LIVE_TOKEN is not configured).',
    };
  }
  const provided = req?.headers?.['x-paybridge-live-token'];
  if (typeof provided !== 'string' || !provided || !safeEqual(provided, expected)) {
    return {
      status: 401,
      error: 'LIVE_AUTH_REQUIRED',
      message: 'Live mode requires a valid X-PayBridge-Live-Token header.',
    };
  }
  return null;
}

const present = (v) => v !== undefined && v !== null && v !== '';
const MAX_DEPTH = 8; // Rapyd's card paths sit 2–3 levels deep; nothing legit nests this far

/** True when the value carries card-shaped data anywhere: an object with
    both `number` and `cvv`, or any `fields` object with a `number`
    (payment_method.fields.number — incl. the CVV-less NRID/vault shape). */
export function hasRawCard(node, depth = 0) {
  if (!node || typeof node !== 'object' || depth > MAX_DEPTH) return false;
  if (Array.isArray(node)) return node.some((n) => hasRawCard(n, depth + 1));
  if (present(node.number) && present(node.cvv)) return true;
  const f = node.fields;
  if (f && typeof f === 'object' && present(f.number)) return true;
  return Object.values(node).some((v) => hasRawCard(v, depth + 1));
}

/** Parses an amount the way Rapyd would read it; NaN when it isn't one. */
function amountOf(v) {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() !== '') return Number(v);
  return NaN;
}

/**
 * Body guard for a live POST. `body` must already be cleaned (cleanBody).
 * Returns null when allowed, otherwise { status: 400, error, message, fields? }.
 * An endpoint with no allowlist is denied outright (fail closed).
 */
export function liveGuardError(endpoint, body) {
  const allowed = LIVE_ALLOWED_FIELDS[endpoint];
  if (!allowed) {
    return { status: 400, error: 'LIVE_FIELD_NOT_ALLOWED', message: 'This endpoint has no live allowlist.', fields: [] };
  }
  const b = body && typeof body === 'object' ? body : {};

  if (hasRawCard(b)) {
    return {
      status: 400,
      error: 'LIVE_RAW_CARD_FORBIDDEN',
      message: 'Raw card data (PAN/CVV) is never accepted in live mode — this backend is not PCI-scoped. Use a saved card_*** token or the hosted toolkit.',
    };
  }

  const extra = Object.keys(b).filter((k) => !allowed.includes(k));
  if (extra.length) {
    const fields = extra.slice(0, 10).map((k) => k.slice(0, 64));
    return {
      status: 400,
      error: 'LIVE_FIELD_NOT_ALLOWED',
      message: `Field(s) not allowed in live mode: ${fields.join(', ')}`,
      fields,
    };
  }

  if (AMOUNT_CAPPED.has(endpoint)) {
    const cap = liveMaxAmount();
    const n = amountOf(b.amount);
    if (!Number.isFinite(n) || n <= 0 || n > cap) {
      return {
        status: 400,
        error: 'LIVE_LIMIT',
        message: `Live amounts must be greater than 0 and at most ${cap}`
          + (endpoint === 'create-refund' ? ' — a live refund must state an explicit amount.' : '.'),
      };
    }
  }
  return null;
}
