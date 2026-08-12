/**
 * Store catalogue / pricing / images in the GitHub repo.
 * No Cloudflare KV required — only secrets:
 * ADMIN_PASSWORD, GITHUB_TOKEN
 * Optional: GITHUB_OWNER, GITHUB_REPO, GITHUB_BRANCH
 */

export function repoConfig(env) {
 return {
 owner: env.GITHUB_OWNER || 'cortenliving',
 repo: env.GITHUB_REPO || 'corten-living',
 branch: env.GITHUB_BRANCH || 'main',
 token: env.GITHUB_TOKEN || '',
 };
}

export function hasGithub(env) {
 return !!(env.GITHUB_TOKEN && (env.GITHUB_OWNER || true) && (env.GITHUB_REPO || true));
}

function apiBase(cfg) {
 return `https://api.github.com/repos/${cfg.owner}/${cfg.repo}`;
}

async function gh(cfg, path, options = {}) {
 if (!cfg.token) {
 throw new Error('GITHUB_TOKEN not configured');
 }
 const res = await fetch(`${apiBase(cfg)}${path}`, {
 ...options,
 headers: {
 Accept: 'application/vnd.github+json',
 Authorization: `Bearer ${cfg.token}`,
 'X-GitHub-Api-Version': '2022-11-28',
 'User-Agent': 'corten-living-admin',
 ...(options.body ? { 'Content-Type': 'application/json' } : {}),
 ...options.headers,
 },
 });
 const text = await res.text();
 let data = null;
 try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
 if (!res.ok) {
 const msg = data?.message || text || res.statusText;
 throw new Error(`GitHub ${res.status}: ${msg}`);
 }
 return data;
}

/** Read JSON file from repo (authenticated). Returns { data, sha } or null if missing. */
export async function getJsonFile(env, filePath) {
 const cfg = repoConfig(env);
 try {
 const file = await gh(cfg, `/contents/${filePath}?ref=${encodeURIComponent(cfg.branch)}`);
 if (!file?.content) return null;
 const decoded = atob(file.content.replace(/\n/g, ''));
 return { data: JSON.parse(decoded), sha: file.sha };
 } catch (e) {
 if (String(e.message).includes('404')) return null;
 throw e;
 }
}

/** Public raw read (no token needed for public repos). */
export async function getJsonFilePublic(env, filePath) {
 const cfg = repoConfig(env);
 const url = `https://raw.githubusercontent.com/${cfg.owner}/${cfg.repo}/${cfg.branch}/${filePath}?t=${Date.now()}`;
 const res = await fetch(url, { headers: { 'Cache-Control': 'no-cache' } });
 if (!res.ok) return null;
 try {
 return await res.json();
 } catch {
 return null;
 }
}

/** Create or update a text/JSON file on main branch. */
export async function putJsonFile(env, filePath, obj, message) {
 const cfg = repoConfig(env);
 let sha;
 try {
 const existing = await gh(cfg, `/contents/${filePath}?ref=${encodeURIComponent(cfg.branch)}`);
 sha = existing.sha;
 } catch {
 sha = undefined;
 }
 const content = btoa(unescape(encodeURIComponent(JSON.stringify(obj, null, 2))));
 const body = {
 message: message || `Update ${filePath}`,
 content,
 branch: cfg.branch,
 };
 if (sha) body.sha = sha;
 await gh(cfg, `/contents/${filePath}`, { method: 'PUT', body: JSON.stringify(body) });
 return { ok: true };
}

/**
 * Upload binary image (ArrayBuffer / Uint8Array) to images/live/{id}.ext
 * Returns site-relative URL (/images/live/…) so shop pages use Cloudflare CDN,
 * not raw.githubusercontent.com (slow cache, no image optim).
 * Note: new uploads appear after the Pages deploy for that commit (~1–2 min).
 */
export async function putImageFile(env, id, bytes, contentType = 'image/jpeg') {
 const cfg = repoConfig(env);
 const ext = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg';
 const filePath = `images/live/${id}.${ext}`;

 // bytes → base64
 const u8 = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes;
 let binary = '';
 const chunk = 0x8000;
 for (let i = 0; i < u8.length; i += chunk) {
 binary += String.fromCharCode.apply(null, u8.subarray(i, i + chunk));
 }
 const content = btoa(binary);

 let sha;
 try {
 const existing = await gh(cfg, `/contents/${filePath}?ref=${encodeURIComponent(cfg.branch)}`);
 sha = existing.sha;
 } catch {
 sha = undefined;
 }

 const body = {
 message: `Upload image ${filePath}`,
 content,
 branch: cfg.branch,
 };
 if (sha) body.sha = sha;
 await gh(cfg, `/contents/${filePath}`, { method: 'PUT', body: JSON.stringify(body) });

 // Serve via Pages CDN (same origin as the shop)
 const url = `/${filePath}`;
 return { ok: true, path: filePath, url, id };
}

/**
 * Upload binary file (PDF, etc.) to any path in the repo.
 * Returns raw.githubusercontent.com URL for public repos.
 */
export async function putBinaryFile(env, filePath, bytes, message) {
  const cfg = repoConfig(env);
  const u8 = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes;
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < u8.length; i += chunk) {
    binary += String.fromCharCode.apply(null, u8.subarray(i, i + chunk));
  }
  const content = btoa(binary);

  let sha;
  try {
    const existing = await gh(cfg, `/contents/${filePath}?ref=${encodeURIComponent(cfg.branch)}`);
    sha = existing.sha;
  } catch {
    sha = undefined;
  }

  const body = {
    message: message || `Upload ${filePath}`,
    content,
    branch: cfg.branch,
  };
  if (sha) body.sha = sha;
  await gh(cfg, `/contents/${filePath}`, { method: 'PUT', body: JSON.stringify(body) });

  const url = `https://raw.githubusercontent.com/${cfg.owner}/${cfg.repo}/${cfg.branch}/${filePath}`;
  return { ok: true, path: filePath, url };
}

export function requireGithub(env) {
 if (!env.GITHUB_TOKEN) {
 return { ok: false, status: 503, error: 'GITHUB_TOKEN not configured — add it under Pages → Settings → Variables and secrets' };
 }
 return { ok: true };
}
