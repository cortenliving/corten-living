import { json, handleOptions, checkAdmin, requireKV } from '../../lib/auth.js';

const KEY = 'hn-prices';

export async function onRequestOptions() {
  return handleOptions();
}

/** Public read — house number configurator prices */
export async function onRequestGet(context) {
  const kv = requireKV(context.env);
  if (!kv.ok) return json({ prices: null, error: kv.error }, kv.status);

  try {
    const data = await context.env.CATALOGUE.get(KEY, { type: 'json' });
    return json(
      { prices: data?.prices ?? data ?? null, updatedAt: data?.updatedAt || null },
      200,
      { 'Cache-Control': 'public, max-age=30' }
    );
  } catch (e) {
    return json({ prices: null, error: String(e.message || e) }, 500);
  }
}

/** Admin write */
export async function onRequestPut(context) {
  const auth = checkAdmin(context.request, context.env);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  const kv = requireKV(context.env);
  if (!kv.ok) return json({ error: kv.error }, kv.status);

  try {
    const body = await context.request.json();
    const prices = body.prices || body;
    if (!prices || typeof prices !== 'object') {
      return json({ error: 'Invalid prices object' }, 400);
    }
    const payload = { prices, updatedAt: new Date().toISOString() };
    await context.env.CATALOGUE.put(KEY, JSON.stringify(payload));
    return json({ ok: true, updatedAt: payload.updatedAt });
  } catch (e) {
    return json({ error: String(e.message || e) }, 500);
  }
}
