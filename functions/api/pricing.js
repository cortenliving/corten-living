import { json, handleOptions, checkAdmin } from '../../lib/auth.js';
import { getJsonFilePublic, putJsonFile, requireGithub } from '../../lib/github-store.js';

const FILE = 'data/pricing.json';

export async function onRequestOptions() {
  return handleOptions();
}

export async function onRequestGet(context) {
  try {
    const data = await getJsonFilePublic(context.env, FILE);
    if (!data) {
      return json({ prices: null, updatedAt: null }, 200, { 'Cache-Control': 'public, max-age=30' });
    }
    return json(
      { prices: data.prices ?? data, updatedAt: data.updatedAt || null },
      200,
      { 'Cache-Control': 'public, max-age=30' }
    );
  } catch (e) {
    return json({ prices: null, error: String(e.message || e) }, 500);
  }
}

export async function onRequestPut(context) {
  const auth = checkAdmin(context.request, context.env);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  const gh = requireGithub(context.env);
  if (!gh.ok) return json({ error: gh.error }, gh.status);

  try {
    const body = await context.request.json();
    const prices = body.prices || body;
    if (!prices || typeof prices !== 'object') {
      return json({ error: 'Invalid prices object' }, 400);
    }
    const payload = { prices, updatedAt: new Date().toISOString() };
    await putJsonFile(context.env, FILE, payload, 'Admin: update house number pricing');
    return json({ ok: true, updatedAt: payload.updatedAt, storage: 'github' });
  } catch (e) {
    return json({ error: String(e.message || e) }, 500);
  }
}
