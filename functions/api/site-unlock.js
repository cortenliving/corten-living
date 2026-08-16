import { json, handleOptions } from '../../lib/auth.js';
import {
  acceptedPasswords,
  cookieHeaderForPassword,
  hasPreviewAccess,
} from '../../lib/site-gate.js';

export async function onRequestOptions() {
  return handleOptions();
}

export async function onRequestGet(context) {
  const ok = await hasPreviewAccess(context.request, context.env);
  return json({ ok, gated: true });
}

export async function onRequestPost(context) {
  let body = {};
  try {
    body = await context.request.json();
  } catch (_) {
    body = {};
  }

  if (body.logout) {
    const cookie = await cookieHeaderForPassword('', { clear: true });
    return json({ ok: true, unlocked: false }, 200, { 'Set-Cookie': cookie });
  }

  const password = String(body.password || '');
  const allowed = acceptedPasswords(context.env);
  const match = allowed.find((p) => p === password);
  if (!match) {
    return json({ ok: false, error: 'Wrong password' }, 401);
  }

  const cookie = await cookieHeaderForPassword(match);
  return json({ ok: true, unlocked: true }, 200, { 'Set-Cookie': cookie });
}
