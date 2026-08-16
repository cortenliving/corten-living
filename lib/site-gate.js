/** Coming-soon / preview password helpers for Pages Functions */

export const PREVIEW_COOKIE = 'cl_preview';
export const FALLBACK_SITE_PASSWORD = 'CortenSoon2026';

export function acceptedPasswords(env) {
  return [...new Set(
    [env?.SITE_PASSWORD, env?.ADMIN_PASSWORD, FALLBACK_SITE_PASSWORD].filter(Boolean)
  )];
}

export async function previewToken(password) {
  const data = new TextEncoder().encode('cl-preview-v1:' + String(password || ''));
  const hash = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function parseCookies(request) {
  const header = request.headers.get('Cookie') || '';
  const out = {};
  header.split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i === -1) return;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  });
  return out;
}

export async function hasPreviewAccess(request, env) {
  const token = parseCookies(request)[PREVIEW_COOKIE];
  if (!token) return false;
  for (const pass of acceptedPasswords(env)) {
    if (token === (await previewToken(pass))) return true;
  }
  return false;
}

export async function cookieHeaderForPassword(password, { clear = false } = {}) {
  const secure = 'Path=/; HttpOnly; Secure; SameSite=Lax';
  if (clear) return `${PREVIEW_COOKIE}=; ${secure}; Max-Age=0`;
  const token = await previewToken(password);
  return `${PREVIEW_COOKIE}=${token}; ${secure}; Max-Age=2592000`;
}

export function isPublicPath(pathname) {
  const p = (pathname || '/').replace(/\/+$/, '') || '/';
  if (p === '/coming-soon' || p === '/coming-soon.html') return true;
  if (p === '/api/site-unlock') return true;
  if (p === '/api/stripe-webhook') return true;
  if (p === '/robots.txt') return true;
  if (p === '/images/logo.svg' || p === '/favicon.ico') return true;
  if (p === '/css/site.css') return true;
  return false;
}

export function wantsHtml(request) {
  const accept = request.headers.get('Accept') || '';
  return accept.includes('text/html');
}
