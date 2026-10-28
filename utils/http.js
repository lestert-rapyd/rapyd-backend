/* ── Shared HTTP plumbing for the Rapyd-proxy handlers ──────────
   Every api/*.js proxy runs the same pipeline, in this order:

     applyCors → method check → resolveEnv (UNKNOWN_PROFILE) → assertLive
     (live gate + live body guards) → keys → sign + send (rapydRequest)
     → pass Rapyd's JSON through, or sendError on failure.

   Keeping it here means a CORS/auth/error fix lands in one place instead
   of nine copy-pasted handlers.
   ───────────────────────────────────────────────────────────── */

import crypto from 'crypto';
import { generateRapydSignature } from './generate-signature.js';
import { findRapydError } from './map-rapyd-error.js';
import { resolveKeys, normalizeProfile } from './key-profiles.js';
import { liveGate, liveGuardError } from './live-guards.js';

export { liveGate } from './live-guards.js';

export const RAPYD_TIMEOUT_MS = 10000;
export const ALLOWED_HEADERS = 'Content-Type, X-PayBridge-Live-Token, Idempotency-Key';
const IDEMPOTENCY_RE = /^[A-Za-z0-9_.:-]{8,100}$/;
const UNKNOWN_PROFILE_MSG = 'Unknown sandbox profile. Expected one of: SC1, SC2, SC3 (or omit it for SC1).';

/** An error that already knows its HTTP status and JSON body. */
export class HttpError extends Error {
  constructor(status, body) {
    super(body?.message || body?.error || `HTTP ${status}`);
    this.status = status;
    this.body = body;
  }
}

/* ── CORS ─────────────────────────────────────────────────── */

/** ALLOWED_ORIGINS as a list (trailing slashes dropped — Origin never has one). */
export function allowedOrigins() {
  return (process.env.ALLOWED_ORIGINS || '')
    .split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean);
}

/**
 * Sets CORS headers on EVERY response path (so a Rapyd decline reaches the
 * browser with its real body instead of a CORS-blocked "Failed to fetch").
 * With ALLOWED_ORIGINS set, only a listed Origin is echoed; unset keeps '*'
 * until the frontend's origin is pinned. Returns true when it fully answered
 * an OPTIONS preflight — the caller must return immediately.
 */
export function applyCors(req, res, methods = ['GET']) {
  const list = allowedOrigins();
  if (list.length) {
    const origin = req.headers?.origin;
    if (typeof origin === 'string' && list.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    }
    res.setHeader('Vary', 'Origin'); // the answer depends on Origin — keep caches honest
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', [...methods, 'OPTIONS'].join(', '));
    res.setHeader('Access-Control-Allow-Headers', ALLOWED_HEADERS);
    res.setHeader('Access-Control-Max-Age', '600');
    res.status(204).end();
    return true;
  }
  return false;
}

export function methodNotAllowed(res, methods) {
  res.setHeader('Allow', [...methods, 'OPTIONS'].join(', '));
  return res.status(405).json({ error: 'METHOD_NOT_ALLOWED', message: `Use ${methods.join(' or ')}.` });
}

/* ── Request parsing ──────────────────────────────────────── */

const INVALID = Symbol('invalid-json');

/** req.body as a plain object. Vercel/Express hand us a parsed object for
    application/json; tolerate a string/Buffer body, reject anything else. */
export function readJsonBody(req) {
  let b;
  try { b = req.body; } catch { b = INVALID; } // Vercel's lazy parser throws on bad JSON
  if (Buffer.isBuffer(b)) b = b.toString('utf8');
  if (typeof b === 'string') {
    if (!b.trim()) return {};
    try { b = JSON.parse(b); } catch { b = INVALID; }
  }
  if (b === undefined || b === null) return {};
  if (typeof b !== 'object' || Array.isArray(b)) {
    throw new HttpError(400, { error: 'INVALID_BODY', message: 'Request body must be a JSON object.' });
  }
  return b;
}

/** env + profile from a body or query. env is 'live' only when it says so;
    an explicit unknown profile is a 400 (it used to sign with SC1 silently). */
export function resolveEnv(source = {}) {
  const env = source?.env === 'live' ? 'live' : 'sandbox';
  const profile = normalizeProfile(source?.profile);
  if (!profile) throw new HttpError(400, { error: 'UNKNOWN_PROFILE', message: UNKNOWN_PROFILE_MSG });
  return { env, profile };
}

/** Shallow copy without the routing fields — env/profile/idempotency_key
    steer THIS backend and must never reach Rapyd (or its signature). */
export function cleanBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return {};
  const { env, profile, idempotency_key, ...rest } = body;
  return rest;
}

/** The caller's Idempotency-Key header when well-formed, else a fresh one.
    A browser retry that reuses its key gets Rapyd's original result back
    instead of a second charge/refund. */
export function idempotencyKey(req) {
  const h = req.headers?.['idempotency-key'];
  return typeof h === 'string' && IDEMPOTENCY_RE.test(h) ? h : crypto.randomUUID();
}

/**
 * Live gate + (for POSTs) live body guards. No-op in sandbox. Throws an
 * HttpError the handler's catch turns into the response.
 * @param {string|null} endpoint - LIVE_ALLOWED_FIELDS key; null for GETs
 */
export function assertLive(req, env, endpoint = null, body = null) {
  if (env !== 'live') return;
  const gate = liveGate(req, env);
  if (gate) throw new HttpError(gate.status, { error: gate.error, message: gate.message });
  if (endpoint) {
    const g = liveGuardError(endpoint, body);
    if (g) {
      const { status, ...out } = g;
      throw new HttpError(status, out);
    }
  }
}

/* ── Rapyd call ───────────────────────────────────────────── */

export function rapydBaseUrl(env) {
  return env === 'live' ? 'https://api.rapyd.net' : 'https://sandboxapi.rapyd.net';
}

export function missingKeysError(env, profileId) {
  return new HttpError(500, { error: 'MISSING_KEYS', message: `Missing API keys for ${env}/${profileId}` });
}

/**
 * Sign and send one Rapyd request; resolves with Rapyd's JSON.
 * The body is serialized ONCE and that exact string is both signed and sent,
 * so the signature can never drift from the bytes on the wire.
 * @param {{ method: string, path: string, body?: object|null, env: string,
 *           profile?: string, idempotencyKey?: string, keys?: object }} opts
 *   path  - /v1/... incl. query string (GETs sign the full path)
 *   keys  - pre-resolved resolveKeys() result (create-direct-payment needs
 *           them before signing to adjust the body)
 */
export async function rapydRequest({ method, path, body = null, env, profile, idempotencyKey: idem, keys }) {
  const k = keys || resolveKeys({ env, profile });
  if (!k.access || !k.secret) throw missingKeysError(env, k.profile);

  const m = String(method).toLowerCase();
  const payload = m === 'get' ? '' : JSON.stringify(body ?? {});
  const { salt, timestamp, signature } = generateRapydSignature(m, path, payload, k.access, k.secret);

  const headers = { 'Content-Type': 'application/json', access_key: k.access, salt, timestamp, signature };
  if (m !== 'get') headers.idempotency = idem || crypto.randomUUID();

  // Lazy import: keeps every pure helper in this module loadable (and unit
  // testable) without node_modules; the module cache makes it free after the first call.
  const { default: axios } = await import('axios');
  const res = await axios.request({
    method: m,
    url: `${rapydBaseUrl(env)}${path}`,
    headers,
    data: m === 'get' ? undefined : payload,
    transformRequest: [(d) => d], // send the signed string verbatim — no re-serialization
    timeout: RAPYD_TIMEOUT_MS,
  });
  return res.data;
}

/* ── Errors ───────────────────────────────────────────────── */

/**
 * Any thrown error → { status, body } with body { error, message, hint?, raw? }.
 *   HttpError            → as constructed (400 guards, 401/403 live, 500 keys)
 *   Rapyd 4xx            → same status; friendly copy if mapped, else Rapyd's own code/message
 *   Rapyd 5xx / non-4xx  → 502
 *   timeout              → 504
 *   no response          → 502
 *   anything else        → 500
 */
export function normalizeError(err) {
  if (err instanceof HttpError) return { status: err.status, body: err.body };
  if (err?.code === 'UNKNOWN_PROFILE') {
    return { status: 400, body: { error: 'UNKNOWN_PROFILE', message: UNKNOWN_PROFILE_MSG } };
  }

  const upstream = err?.response?.status;
  if (upstream) {
    const data = err.response.data;
    const rapydStatus = (data && typeof data === 'object' && data.status && typeof data.status === 'object') ? data.status : {};
    const mapped = findRapydError(rapydStatus.error_code);
    const status = upstream >= 400 && upstream < 500 ? upstream : 502;
    const body = {
      error: mapped?.code || rapydStatus.error_code || (status === 502 ? 'RAPYD_UPSTREAM_ERROR' : 'RAPYD_ERROR'),
      message: mapped?.message || rapydStatus.message || `Rapyd returned HTTP ${upstream}.`,
    };
    if (mapped?.hint) body.hint = mapped.hint;
    body.raw = Object.keys(rapydStatus).length ? rapydStatus : { http_status: upstream };
    return { status, body };
  }

  if (err?.code === 'ECONNABORTED' || err?.code === 'ETIMEDOUT') {
    return {
      status: 504,
      body: {
        error: 'UPSTREAM_TIMEOUT',
        message: `Rapyd did not answer within ${RAPYD_TIMEOUT_MS / 1000}s.`,
        hint: 'Retry with the same Idempotency-Key so Rapyd cannot process it twice.',
      },
    };
  }
  if (err?.isAxiosError || err?.request) {
    return { status: 502, body: { error: 'UPSTREAM_UNREACHABLE', message: 'Could not reach Rapyd.' } };
  }
  return { status: 500, body: { error: 'INTERNAL_ERROR', message: 'Unexpected server error.' } };
}

/** Write the normalized error. Logs Rapyd's status block only — never the
    request body (it may carry card data in sandbox). */
export function sendError(res, err, label = 'rapyd') {
  const { status, body } = normalizeError(err);
  if (status >= 500 || err?.response) {
    const detail = body.raw ? JSON.stringify(body.raw) : (err?.message || '');
    console.error(`[${label}] ${status} ${body.error}`, detail);
    if (status === 500 && !(err instanceof HttpError)) console.error(err);
  }
  return res.status(status).json(body);
}
