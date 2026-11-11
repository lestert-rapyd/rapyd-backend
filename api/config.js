// /api/config?op=tags|tags-history|tags-rollback|whoami
// ONE serverless function for the demo's admin-editable config (the Vercel
// Hobby plan's 12-function cap — 10 used with this one). The Tag Studio
// reads/publishes the engine-room pill config here; see
// handlers/config/tags.js. Callers use the ?op= URL directly, here and on
// the local Express server, so no vercel.json rewrite is needed.

import { applyCors, methodNotAllowed } from '../utils/http.js';
import { tags, tagsHistory, tagsRollback, whoami } from '../handlers/config/tags.js';

const OPS = {
  tags: { methods: ['GET', 'PUT'], run: tags },
  'tags-history': { methods: ['GET'], run: tagsHistory },
  'tags-rollback': { methods: ['POST'], run: tagsRollback },
  whoami: { methods: ['GET'], run: whoami },
};

export default async function handler(req, res) {
  const op = req.query?.op;
  const route = typeof op === 'string' && Object.hasOwn(OPS, op) ? OPS[op] : null;
  if (applyCors(req, res, route ? route.methods : ['GET'])) return;
  if (!route) return res.status(404).json({ error: 'UNKNOWN_OPERATION', message: 'Unknown config operation' });
  if (!route.methods.includes(req.method)) return methodNotAllowed(res, route.methods);
  return route.run(req, res);
}
