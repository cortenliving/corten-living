import { json, handleOptions, checkAdmin, requireKV } from '../../lib/auth.js';

const KEY = 'products';

export async function onRequestOptions() {
  return handleOptions();
}

/** Public read — everyone gets the live catalogue */
export async function onRequestGet(context) {
  const kv = requireKV(context.env);
  if (!kv.ok) return json({ products: null, error: kv.error }, kv.status);

  try {
    const data = await context.env.CATALOGUE.get(KEY, { type: 'json' });
    // Stored as array or { products: [] }
    const products = Array.isArray(data) ? data : (data?.products ?? null);
    return json(
      { products, updatedAt: data?.updatedAt || null },
      200,
      { 'Cache-Control': 'public, max-age=30' }
    );
  } catch (e) {
    return json({ products: null, error: String(e.message || e) }, 500);
  }
}

/** Admin write — full catalogue replace */
export async function onRequestPut(context) {
  const auth = checkAdmin(context.request, context.env);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  const kv = requireKV(context.env);
  if (!kv.ok) return json({ error: kv.error }, kv.status);

  try {
    const body = await context.request.json();
    const products = Array.isArray(body) ? body : body.products;
    if (!Array.isArray(products)) {
      return json({ error: 'Body must be an array or { products: [] }' }, 400);
    }
    // Strip huge data URLs warning — allow but size may hit KV limits
    const payload = {
      products,
      updatedAt: new Date().toISOString(),
    };
    await context.env.CATALOGUE.put(KEY, JSON.stringify(payload));
    return json({ ok: true, count: products.length, updatedAt: payload.updatedAt });
  } catch (e) {
    return json({ error: String(e.message || e) }, 500);
  }
}
