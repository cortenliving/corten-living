import { json, handleOptions } from '../../lib/auth.js';
import { hasGithub, getJsonFilePublic, repoConfig } from '../../lib/github-store.js';

export async function onRequestOptions() {
  return handleOptions();
}

/** Public: is cloud storage available? */
export async function onRequestGet(context) {
  const { env } = context;
  const hasAdmin = !!env.ADMIN_PASSWORD;
  const github = hasGithub(env);
  const cfg = repoConfig(env);
  let productCount = null;
  if (github) {
    try {
      const data = await getJsonFilePublic(env, 'data/catalogue.json');
      const products = Array.isArray(data) ? data : data?.products;
      productCount = Array.isArray(products) ? products.length : null;
    } catch {
      productCount = null;
    }
  }
  return json({
    ok: true,
    cloud: hasAdmin && github,
    storage: github ? 'github' : 'none',
    hasGithub: github,
    hasAdminPassword: hasAdmin,
    repo: `${cfg.owner}/${cfg.repo}`,
    productCount,
  }, 200, { 'Cache-Control': 'no-store' });
}
