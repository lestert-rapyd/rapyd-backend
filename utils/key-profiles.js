// Sandbox key-profile registry. Three sandbox MIDs (SC1/SC2/SC3) with
// different feature sets — which 3DS provider the MID uses, whether it returns
// network_reference_id, and which collection wallet(s) it owns. Live has a
// single key pair. Secrets live in env vars ONLY (see .env.example):
//
//   RAPYD_SC1_ACCESS_KEY / RAPYD_SC1_SECRET_KEY / RAPYD_SC1_EWALLETS   (comma-list)
//   RAPYD_SC2_*  RAPYD_SC3_*  — same scheme
//   RAPYD_LIVE_ACCESS_KEY / RAPYD_LIVE_SECRET_KEY / RAPYD_LIVE_EWALLETS
//
// Back-compat: the pre-profile RAPYD_SANDBOX_ACCESS_KEY/SECRET_KEY pair keeps
// working as the SC1 fallback so existing deployments don't break mid-rollout.

export const PROFILES = {
  SC1: { tds: 'rapyd',    nrid: false, aft: true },
  SC2: { tds: 'external', nrid: true,  aft: true },
  SC3: { tds: 'rapyd',    nrid: true,  aft: true },
};

/** 'SC1' when no profile was supplied, the id when it's a known profile, and
    null for anything else — an explicit typo must not silently sign with SC1.
    Object.hasOwn so 'constructor'/'__proto__' aren't mistaken for profiles. */
export function normalizeProfile(profile) {
  if (profile === undefined || profile === null || profile === '') return 'SC1';
  return typeof profile === 'string' && Object.hasOwn(PROFILES, profile) ? profile : null;
}

/**
 * Keys + collection wallet(s) for an env/profile pair. Live ignores `profile`
 * (one key pair). Throws an Error with code 'UNKNOWN_PROFILE' for an explicit
 * unknown sandbox profile; handlers reject that earlier with a 400.
 */
export function resolveKeys({ env, profile } = {}) {
  const isLive = env === 'live';
  let id = 'LIVE';
  if (!isLive) {
    id = normalizeProfile(profile);
    if (!id) {
      const err = new Error(`Unknown sandbox profile: ${String(profile).slice(0, 32)}`);
      err.code = 'UNKNOWN_PROFILE';
      throw err;
    }
  }
  let access = process.env[`RAPYD_${id}_ACCESS_KEY`];
  let secret = process.env[`RAPYD_${id}_SECRET_KEY`];
  let fallback = false;
  if (!access && id === 'SC1') {
    access = process.env.RAPYD_SANDBOX_ACCESS_KEY;
    secret = process.env.RAPYD_SANDBOX_SECRET_KEY;
    fallback = true; // legacy MID — the frontend's profile ewallet ids won't belong to it
  }
  const ewallets = (process.env[`RAPYD_${id}_EWALLETS`] || '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  return {
    access,
    secret,
    ewallet: ewallets[0] || null,
    ewallets,
    profile: id,
    fallback,
    features: isLive ? null : PROFILES[id],
  };
}

/** Configured sandbox key pairs (SC1–SC3, then the legacy flat pair). */
export function sandboxKeyPairs() {
  const e = process.env;
  return [
    [e.RAPYD_SC1_ACCESS_KEY, e.RAPYD_SC1_SECRET_KEY],
    [e.RAPYD_SC2_ACCESS_KEY, e.RAPYD_SC2_SECRET_KEY],
    [e.RAPYD_SC3_ACCESS_KEY, e.RAPYD_SC3_SECRET_KEY],
    [e.RAPYD_SANDBOX_ACCESS_KEY, e.RAPYD_SANDBOX_SECRET_KEY],
  ].filter(([a, s]) => a && s);
}

/** The live key pair, when configured ([] otherwise). */
export function liveKeyPairs() {
  const e = process.env;
  return [[e.RAPYD_LIVE_ACCESS_KEY, e.RAPYD_LIVE_SECRET_KEY]].filter(([a, s]) => a && s);
}

/** Every configured key pair (sandbox profiles, legacy flat pair, live) — a
    webhook may be delivered by any of these MIDs. */
export function allKeyPairs() {
  return [...sandboxKeyPairs(), ...liveKeyPairs()];
}

/** Real client IP for client_details injection — the browser can't see its own
    public IP, so payment handlers set it server-side whenever the frontend
    sent a client_details object without one. */
export function clientIp(req) {
  const fwd = req.headers?.['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0].trim();
  return req.socket?.remoteAddress || undefined;
}
