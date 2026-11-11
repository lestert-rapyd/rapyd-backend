/* ── Admin gate ──────────────────────────────────────────────
   One shared admin secret (PAYBRIDGE_ADMIN_TOKEN), separate from the live
   token: being allowed to edit the Tag Studio's published tags says nothing
   about being allowed to move real money, and vice versa. Same shape as
   live-guards.js liveGate — constant-time compare, refuse a short token. */

import { safeEqual } from './live-guards.js';

const MIN_TOKEN_LENGTH = 16;
export const ADMIN_HEADER = 'x-paybridge-admin-token';

/** null when the request carries the admin token, else { status, error, message }. */
export function adminGate(req) {
  const expected = (process.env.PAYBRIDGE_ADMIN_TOKEN || '').trim();
  if (expected.length < MIN_TOKEN_LENGTH) {
    return {
      status: 403,
      error: 'ADMIN_DISABLED',
      message: 'Admin is disabled on this backend (PAYBRIDGE_ADMIN_TOKEN is not configured).',
    };
  }
  const provided = req?.headers?.[ADMIN_HEADER];
  if (typeof provided !== 'string' || !provided || !safeEqual(provided, expected)) {
    return {
      status: 401,
      error: 'ADMIN_AUTH_REQUIRED',
      message: 'This action requires a valid X-PayBridge-Admin-Token header.',
    };
  }
  return null;
}
