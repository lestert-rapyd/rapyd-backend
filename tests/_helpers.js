// Shared test helpers (not a test file — node --test only picks up *.test.js).
import { beforeEach, afterEach } from 'node:test';

// Every env var the backend reads. Cleared before each test so a developer's
// shell/.env can't leak in — and, crucially, so no test ever holds real Rapyd
// keys: proxy handlers then stop at MISSING_KEYS and never reach the network.
const PREFIXES = ['RAPYD_', 'PAYBRIDGE_', 'LIVE_MAX_AMOUNT', 'LIVE_PAYOUTS_ENABLED', 'ALLOWED_ORIGINS', 'WEBHOOK_', 'KV_', 'UPSTASH_'];

/** Call inside a describe(): snapshot process.env before each test, strip the
    backend's vars, and restore the exact snapshot afterwards. */
export function useCleanEnv() {
  let saved;
  beforeEach(() => {
    saved = { ...process.env };
    for (const k of Object.keys(process.env)) {
      if (PREFIXES.some((p) => k.startsWith(p))) delete process.env[k];
    }
  });
  afterEach(() => {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  });
}

/** Minimal Vercel/Express-style response recorder. */
export function fakeRes() {
  return {
    headers: {},
    statusCode: 200,
    body: undefined,
    ended: false,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    getHeader(k) { return this.headers[k.toLowerCase()]; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; this.ended = true; return this; },
    end() { this.ended = true; return this; },
  };
}

/** Minimal request: lowercase header names, like Node's IncomingMessage. */
export function fakeReq({ method = 'GET', headers = {}, query, body, ...rest } = {}) {
  return { method, headers, query, body, ...rest };
}

export const LIVE_TOKEN = 'test-live-token-0123456789';
