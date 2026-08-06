import { json, handleOptions, checkAdmin } from '../../lib/auth.js';
import { putBinaryFile, requireGithub, repoConfig } from '../../lib/github-store.js';

export async function onRequestOptions() {
  return handleOptions();
}

/**
 * POST — upload a quote PDF (base64 data URL)
 * Body: { quoteNumber: "CL-2026-1843", dataUrl: "data:application/pdf;base64,..." }
 *
 * GET — list files under data/quote-files/
 */
export async function onRequestGet(context) {
  const auth = checkAdmin(context.request, context.env);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  const ghReq = requireGithub(context.env);
  if (!ghReq.ok) return json({ error: ghReq.error, files: [] }, ghReq.status);

  try {
    const cfg = repoConfig(context.env);
    const res = await fetch(
      `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/data/quote-files?ref=${encodeURIComponent(cfg.branch)}`,
      {
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${cfg.token}`,
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'corten-living-admin',
        },
      }
    );
    if (res.status === 404) return json({ files: [] });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'List failed');
    const files = (Array.isArray(data) ? data : [])
      .filter((f) => f.type === 'file' && /\.pdf$/i.test(f.name))
      .map((f) => ({
        name: f.name,
        path: f.path,
        size: f.size,
        url: f.download_url || `https://raw.githubusercontent.com/${cfg.owner}/${cfg.repo}/${cfg.branch}/${f.path}`,
        sha: f.sha,
      }))
      .sort((a, b) => String(b.name).localeCompare(String(a.name)));
    return json({ files });
  } catch (e) {
    return json({ files: [], error: String(e.message || e) }, 200);
  }
}

export async function onRequestPost(context) {
  const auth = checkAdmin(context.request, context.env);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  const ghReq = requireGithub(context.env);
  if (!ghReq.ok) return json({ error: ghReq.error }, ghReq.status);

  try {
    const body = await context.request.json();
    const dataUrl = body.dataUrl || body.data;
    let quoteNumber = String(body.quoteNumber || body.number || 'quote').trim();
    // Safe filename
    quoteNumber = quoteNumber.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-+/g, '-');
    if (!quoteNumber) quoteNumber = 'quote-' + Date.now();

    if (!dataUrl || typeof dataUrl !== 'string') {
      return json({ error: 'Expected dataUrl (data:application/pdf;base64,...)' }, 400);
    }

    const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) return json({ error: 'Invalid data URL' }, 400);

    const b64 = match[2];
    // ~4MB base64 limit for practical GitHub content API use
    if (b64.length > 5_500_000) {
      return json({ error: 'PDF too large (max ~4MB). Try fewer preview images.' }, 413);
    }

    const binary = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const filePath = `data/quote-files/${quoteNumber}.pdf`;
    const result = await putBinaryFile(
      context.env,
      filePath,
      binary,
      `Admin: save quote PDF ${quoteNumber}`
    );

    return json({
      ok: true,
      path: result.path,
      url: result.url,
      bytes: binary.byteLength,
      storage: 'github',
    });
  } catch (e) {
    return json({ error: String(e.message || e) }, 500);
  }
}
