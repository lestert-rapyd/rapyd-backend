/* ── Tag Studio config ──────────────────────────────────────
   The engine-room pill config the Tag Studio publishes. ONE shared key in
   the Redis store staging and production already share (decision
   2026-11-11: one set for both), so a publish from either frontend shows up
   on both.

     cfg:tags:v1       { version, updatedAt, updatedBy, note, slots }
     cfg:tags:history  previous versions, newest first, capped at 20, no TTL
     cfg:tags:lock     short NX lock around read-compare-write

   GET is public (every viewer renders with it). Writes and history need the
   admin token (utils/admin-guard.js). A write carries the version it was
   edited from; a stale one is a 409, so two admins can't silently overwrite
   each other. */

import crypto from 'crypto';
import { kv, kvConfigured } from '../../utils/kv.js';
import { HttpError, readJsonBody, sendError } from '../../utils/http.js';
import { adminGate } from '../../utils/admin-guard.js';
import { validateSlots, validateMeta } from '../../utils/tag-config.js';

export const KEY = 'cfg:tags:v1';
export const HISTORY_KEY = 'cfg:tags:history';
export const LOCK_KEY = 'cfg:tags:lock';
export const HISTORY_MAX = 20;
const LOCK_MS = 5000;
const EMPTY = Object.freeze({ version: 0, updatedAt: null, updatedBy: null, note: '', slots: {} });

const parse = (s) => {
  if (typeof s !== 'string') return null;
  try { const v = JSON.parse(s); return v && typeof v === 'object' ? v : null; } catch { return null; }
};
const meta = (c) => ({ version: c.version, updatedAt: c.updatedAt, updatedBy: c.updatedBy, note: c.note || '' });

function requireAdmin(req) {
  const g = adminGate(req);
  if (g) throw new HttpError(g.status, { error: g.error, message: g.message });
}
function requireKv() {
  if (!kvConfigured()) throw new HttpError(503, { error: 'KV_NOT_CONFIGURED', message: 'No KV store is connected to this backend.' });
}

export async function readCurrent() {
  const c = parse(await kv(['GET', KEY]));
  return c && Number.isInteger(c.version) ? c : { ...EMPTY };
}

/** Publish `slots` on top of `baseVersion`. Throws 409 on a stale base or a held lock. */
export async function publish({ baseVersion, slots, updatedBy, note }) {
  const owner = crypto.randomUUID();
  const got = await kv(['SET', LOCK_KEY, owner, 'NX', 'PX', String(LOCK_MS)]);
  if (got !== 'OK') throw new HttpError(409, { error: 'BUSY', message: 'Another publish is in progress — try again.' });
  try {
    const cur = await readCurrent();
    if (cur.version !== baseVersion) {
      throw new HttpError(409, {
        error: 'VERSION_CONFLICT',
        message: `Tags were published as v${cur.version} since you started editing v${baseVersion}.`,
        current: meta(cur),
      });
    }
    const next = { version: cur.version + 1, updatedAt: new Date().toISOString(), updatedBy, note, slots };
    if (cur.version > 0) {
      await kv(['LPUSH', HISTORY_KEY, JSON.stringify(cur)]);
      await kv(['LTRIM', HISTORY_KEY, '0', String(HISTORY_MAX - 1)]);
    }
    await kv(['SET', KEY, JSON.stringify(next)]);
    return next;
  } finally {
    // Release only our own lock (it may have expired and been retaken).
    try { if ((await kv(['GET', LOCK_KEY])) === owner) await kv(['DEL', LOCK_KEY]); } catch { /* expires anyway */ }
  }
}

async function readHistory() {
  const list = await kv(['LRANGE', HISTORY_KEY, '0', String(HISTORY_MAX - 1)]);
  return (Array.isArray(list) ? list : []).map(parse).filter((c) => c && Number.isInteger(c.version));
}

function baseVersionOf(body) {
  const v = body.baseVersion;
  if (!Number.isInteger(v) || v < 0) throw new HttpError(400, { error: 'INVALID_BASE_VERSION', message: 'baseVersion must be the version you edited (0 if none was published).' });
  return v;
}

/* ── Ops (api/config.js dispatches; CORS is applied there) ── */

/** GET (public) the current config · PUT (admin) publish a new version. */
export async function tags(req, res) {
  try {
    if (req.method === 'GET') {
      res.setHeader('Cache-Control', 'no-store');
      if (!kvConfigured()) return res.status(200).json({ ...EMPTY, configured: false });
      return res.status(200).json({ ...(await readCurrent()), configured: true });
    }
    requireAdmin(req);
    requireKv();
    const body = readJsonBody(req);
    const baseVersion = baseVersionOf(body);
    const v = validateSlots(body.slots);
    if (!v.ok) throw new HttpError(400, { error: 'INVALID_TAG_CONFIG', message: v.errors[0], errors: v.errors });
    const m = validateMeta(body);
    if (!m.ok) throw new HttpError(400, { error: 'INVALID_TAG_CONFIG', message: m.errors[0], errors: m.errors });
    const next = await publish({ baseVersion, slots: v.slots, updatedBy: m.updatedBy, note: m.note });
    return res.status(200).json(next);
  } catch (err) {
    return sendError(res, err, 'config/tags');
  }
}

/** GET (admin) — who published what, newest first (metadata only). */
export async function tagsHistory(req, res) {
  try {
    requireAdmin(req);
    requireKv();
    res.setHeader('Cache-Control', 'no-store');
    const [cur, hist] = await Promise.all([readCurrent(), readHistory()]);
    return res.status(200).json({ current: meta(cur), history: hist.map(meta) });
  } catch (err) {
    return sendError(res, err, 'config/tags-history');
  }
}

/** POST (admin) { version, baseVersion, updatedBy } — republish an old version as a new one. */
export async function tagsRollback(req, res) {
  try {
    requireAdmin(req);
    requireKv();
    const body = readJsonBody(req);
    const baseVersion = baseVersionOf(body);
    const target = (await readHistory()).find((c) => c.version === body.version);
    if (!target) throw new HttpError(404, { error: 'VERSION_NOT_FOUND', message: `v${body.version} is not in the last ${HISTORY_MAX} versions.` });
    // Re-validate: an old version may predate a rule this build now refuses.
    const v = validateSlots(target.slots || {});
    if (!v.ok) throw new HttpError(422, { error: 'INVALID_TAG_CONFIG', message: v.errors[0], errors: v.errors });
    const m = validateMeta({ updatedBy: body.updatedBy, note: `Rollback to v${target.version}` });
    const next = await publish({ baseVersion, slots: v.slots, updatedBy: m.ok ? m.updatedBy : 'admin', note: `Rollback to v${target.version}` });
    return res.status(200).json(next);
  } catch (err) {
    return sendError(res, err, 'config/tags-rollback');
  }
}

/** GET (admin) — 204 when the token is good. The Studio shows itself on this. */
export async function whoami(req, res) {
  try {
    requireAdmin(req);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(204).end();
  } catch (err) {
    return sendError(res, err, 'config/whoami');
  }
}
