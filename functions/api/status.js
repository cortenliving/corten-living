import { json, handleOptions } from '../../lib/auth.js';

export async function onRequestOptions() {
  return handleOptions();
}

/** Public: is cloud storage available? */
export async function onRequestGet(context) {
  const { env } = context;
  const hasKV = !!env.CATALOGUE;
  const hasAdmin = !!env.ADMIN_PASSWORD;
  let productCount = null;
  if (hasKV) {
    try {
      const data = await env.CATALOGUE.get('products', { type: 'json' });
      productCount = Array.isArray(data) ? data.length : (data?.products?.length ?? 0);
    } catch {
      productCount = null;
    }
  }
  return json({
    ok: true,
    cloud: hasKV && hasAdmin,
    hasKV,
    hasAdminPassword: hasAdmin,
    productCount,
  }, 200, {
    'Cache-Control': 'no-store',
  });
}
