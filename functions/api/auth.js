import { json, handleOptions, checkAdmin } from '../../lib/auth.js';

export async function onRequestOptions() {
  return handleOptions();
}

/** Verify admin password (does not require KV) */
export async function onRequestPost(context) {
  const auth = checkAdmin(context.request, context.env);
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
  return json({ ok: true, cloud: !!context.env.CATALOGUE });
}
