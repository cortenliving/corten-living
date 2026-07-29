/** Shared auth helpers for Pages Functions */

export function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, PUT, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Password, Authorization',
  };
}

export function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(),
      ...extra,
    },
  });
}

export function handleOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

/**
 * Admin password from Cloudflare env ADMIN_PASSWORD.
 * Client sends: X-Admin-Password header or Authorization: Bearer <pass>
 */
export function checkAdmin(request, env) {
  const expected = env.ADMIN_PASSWORD;
  if (!expected) {
    return { ok: false, status: 503, error: 'ADMIN_PASSWORD not configured in Cloudflare Pages' };
  }
  const header = request.headers.get('X-Admin-Password')
    || (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!header || header !== expected) {
    return { ok: false, status: 401, error: 'Unauthorized' };
  }
  return { ok: true };
}

export function requireKV(env) {
  if (!env.CATALOGUE) {
    return { ok: false, status: 503, error: 'KV binding CATALOGUE not configured' };
  }
  return { ok: true };
}
