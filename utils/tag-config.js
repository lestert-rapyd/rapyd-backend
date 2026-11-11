/* ── Tag Studio config validator ─────────────────────────────
   The published tag config (cfg:tags:v1) is rendered by every viewer of the
   demo, so the server is strict about what it accepts. Mirror of the
   frontend's paybridge/js/tags/registry.js — keep slot ids, field
   allowlists, ops and tones in sync. The frontend still escapes every label
   and ignores anything it doesn't understand; this is the first wall, not
   the only one. */

export const TONES = ['success', 'failure', 'pending', 'info', 'neutral', 'sim'];
export const OPS = ['eq', 'neq', 'in', 'exists', 'between'];

export const RULE_SLOTS = {
  'http.status': ['http.status', 'error'],
  'payment.result': ['http.status', 'data.status', 'data.paid', 'data.next_action', 'error'],
};
export const DICT_SLOTS = {
  // Dictionary entries name their own vars in the frontend registry; the
  // server only knows the union.
  'beat.header': ['error', 'status', 'id', 'type', 'country', 'currency'],
};

export const LIMITS = {
  bytes: 32 * 1024, label: 40, rules: 30, conds: 10, inValues: 20, entries: 100, name: 40, note: 200,
};

const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const KEY_RE = /^[a-z0-9._-]{1,40}$/;
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
const PLACEHOLDER_RE = /\{([A-Za-z0-9_.]+)\}/g;
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const scalar = (v) => v === null || ['string', 'number', 'boolean'].includes(typeof v);

function checkLabel(label, allowed, where, errors) {
  if (typeof label !== 'string') { errors.push(`${where}.label must be a string`); return; }
  if (label.length > LIMITS.label) errors.push(`${where}.label is longer than ${LIMITS.label} characters`);
  if (CONTROL_RE.test(label)) errors.push(`${where}.label contains control characters`);
  for (const [, name] of label.matchAll(PLACEHOLDER_RE)) {
    if (!allowed.includes(name)) errors.push(`${where}.label uses {${name}}, not one of ${allowed.join(', ')}`);
  }
}

function checkLook(o, allowed, where, errors) {
  checkLabel(o.label, allowed, where, errors);
  if (!TONES.includes(o.tone)) errors.push(`${where}.tone must be one of ${TONES.join(', ')}`);
  if (o.hidden !== undefined && typeof o.hidden !== 'boolean') errors.push(`${where}.hidden must be a boolean`);
  return { label: o.label, tone: o.tone, ...(o.hidden ? { hidden: true } : {}) };
}

function checkCond(c, fields, where, errors) {
  if (!isObj(c)) { errors.push(`${where} must be an object`); return null; }
  if (!fields.includes(c.field)) errors.push(`${where}.field must be one of ${fields.join(', ')}`);
  if (!OPS.includes(c.op)) errors.push(`${where}.op must be one of ${OPS.join(', ')}`);
  const v = c.value;
  if ((c.op === 'eq' || c.op === 'neq') && !scalar(v)) errors.push(`${where}.value must be a string, number, boolean or null`);
  if (c.op === 'in' && !(Array.isArray(v) && v.length <= LIMITS.inValues && v.every(scalar))) {
    errors.push(`${where}.value must be a list of up to ${LIMITS.inValues} plain values`);
  }
  if (c.op === 'exists' && v !== undefined && typeof v !== 'boolean') errors.push(`${where}.value must be true/false or omitted`);
  if (c.op === 'between' && !(Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number' && Number.isFinite(n)))) {
    errors.push(`${where}.value must be [low, high] numbers`);
  }
  if (typeof v === 'string' && (v.length > 100 || CONTROL_RE.test(v))) errors.push(`${where}.value is too long or has control characters`);
  return { field: c.field, op: c.op, ...(v !== undefined ? { value: v } : {}) };
}

function checkWhen(when, fields, where, errors) {
  if (when === undefined) return undefined;
  if (!isObj(when)) { errors.push(`${where} must be an object`); return undefined; }
  const mode = Array.isArray(when.all) ? 'all' : Array.isArray(when.any) ? 'any' : null;
  if (!mode) { errors.push(`${where} needs an "all" or "any" list`); return undefined; }
  const list = when[mode];
  if (list.length > LIMITS.conds) errors.push(`${where}.${mode} has more than ${LIMITS.conds} conditions`);
  return { [mode]: list.slice(0, LIMITS.conds).map((c, i) => checkCond(c, fields, `${where}.${mode}[${i}]`, errors)) };
}

function checkRulesSlot(id, s, errors) {
  const fields = RULE_SLOTS[id];
  if (!Array.isArray(s.rules)) { errors.push(`${id}.rules must be a list`); return null; }
  if (s.rules.length > LIMITS.rules) errors.push(`${id} has more than ${LIMITS.rules} rules`);
  const seen = new Set();
  const rules = s.rules.slice(0, LIMITS.rules).map((r, i) => {
    const where = `${id}.rules[${i}]`;
    if (!isObj(r)) { errors.push(`${where} must be an object`); return null; }
    if (typeof r.id !== 'string' || !ID_RE.test(r.id)) errors.push(`${where}.id must match ${ID_RE}`);
    else if (seen.has(r.id)) errors.push(`${where}.id "${r.id}" is used twice`);
    seen.add(r.id);
    const when = checkWhen(r.when, fields, `${where}.when`, errors);
    return { id: r.id, ...(when ? { when } : {}), ...checkLook(r, fields, where, errors) };
  });
  const out = { rules };
  if (s.fallback !== undefined) {
    if (!isObj(s.fallback)) errors.push(`${id}.fallback must be an object`);
    else if (s.fallback.slot !== undefined) {
      if (!RULE_SLOTS[s.fallback.slot] || s.fallback.slot === id) errors.push(`${id}.fallback.slot must be another rules slot`);
      out.fallback = { slot: s.fallback.slot };
    } else {
      out.fallback = checkLook(s.fallback, fields, `${id}.fallback`, errors);
    }
  }
  return out;
}

function checkDictSlot(id, s, errors) {
  const vars = DICT_SLOTS[id];
  if (!isObj(s.entries)) { errors.push(`${id}.entries must be an object`); return null; }
  const keys = Object.keys(s.entries);
  if (keys.length > LIMITS.entries) errors.push(`${id} has more than ${LIMITS.entries} entries`);
  const entries = {};
  for (const k of keys.slice(0, LIMITS.entries)) {
    const where = `${id}.entries["${k}"]`;
    if (!KEY_RE.test(k)) { errors.push(`${where}: key must match ${KEY_RE}`); continue; }
    const e = s.entries[k];
    if (!isObj(e)) { errors.push(`${where} must be an object`); continue; }
    entries[k] = checkLook(e, vars, where, errors);
  }
  return { entries };
}

const cleanText = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/**
 * Validate a PUT body's `slots`. Returns { ok: true, slots } (a clean copy:
 * unknown properties dropped) or { ok: false, errors: [...] }.
 */
export function validateSlots(slots) {
  const errors = [];
  if (!isObj(slots)) return { ok: false, errors: ['slots must be an object'] };
  let size;
  try { size = JSON.stringify(slots).length; } catch { return { ok: false, errors: ['slots is not serialisable'] }; }
  if (size > LIMITS.bytes) return { ok: false, errors: [`slots is larger than ${LIMITS.bytes} bytes`] };
  const out = {};
  for (const [id, s] of Object.entries(slots)) {
    if (!isObj(s)) { errors.push(`${id} must be an object`); continue; }
    if (RULE_SLOTS[id]) out[id] = checkRulesSlot(id, s, errors);
    else if (DICT_SLOTS[id]) out[id] = checkDictSlot(id, s, errors);
    else errors.push(`unknown slot "${id}"`);
  }
  return errors.length ? { ok: false, errors: errors.slice(0, 50) } : { ok: true, slots: out };
}

/** updatedBy / note: trimmed plain text, control characters refused. */
export function validateMeta({ updatedBy, note } = {}) {
  const errors = [];
  const by = cleanText(updatedBy, LIMITS.name);
  const n = cleanText(note, LIMITS.note);
  if (CONTROL_RE.test(by)) errors.push('updatedBy contains control characters');
  if (CONTROL_RE.test(n)) errors.push('note contains control characters');
  return errors.length ? { ok: false, errors } : { ok: true, updatedBy: by || 'admin', note: n };
}
