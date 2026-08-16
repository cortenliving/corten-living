import { hasPreviewAccess, isPublicPath, wantsHtml } from '../lib/site-gate.js';

export async function onRequest(context) {
  const { request, next } = context;
  const url = new URL(request.url);
  const path = url.pathname;

  if (request.method === 'OPTIONS' || isPublicPath(path)) {
    return next();
  }

  if (await hasPreviewAccess(request, context.env)) {
    return next();
  }

  if (wantsHtml(request) || request.method === 'GET') {
    const dest = new URL('/coming-soon', url);
    if (path && path !== '/' && path !== '/coming-soon') {
      dest.searchParams.set('next', path + url.search);
    }
    return Response.redirect(dest.toString(), 302);
  }

  return new Response(JSON.stringify({ ok: false, error: 'Site is in preview. Enter the password on the coming-soon page.' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });
}
