import { json, handleOptions, checkAdmin } from '../../lib/auth.js';
import { hasGithub } from '../../lib/github-store.js';

export async function onRequestOptions() {
  return handleOptions();
}

/** Verify admin password */
export async function onRequestPost(context) {
  const auth = checkAdmin(context.request, context.env);
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
  return json({
    ok: true,
    cloud: hasGithub(context.env),
    storage: hasGithub(context.env) ? 'github' : 'none',
  });
}
