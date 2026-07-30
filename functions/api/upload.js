import { json, handleOptions, checkAdmin } from '../../lib/auth.js';
import { putImageFile, requireGithub } from '../../lib/github-store.js';

export async function onRequestOptions() {
 return handleOptions();
}

/**
 * Admin image upload → GitHub images/live/{id}.jpg
 * Body: { dataUrl: "data:image/jpeg;base64,..." }
 */
export async function onRequestPost(context) {
 const auth = checkAdmin(context.request, context.env);
 if (!auth.ok) return json({ error: auth.error }, auth.status);
 const gh = requireGithub(context.env);
 if (!gh.ok) return json({ error: gh.error }, gh.status);

 try {
 const body = await context.request.json();
 const dataUrl = body.dataUrl || body.data;
 if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
 return json({ error: 'Expected dataUrl (data:image/...;base64,...)' }, 400);
 }

 const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
 if (!match) return json({ error: 'Invalid data URL' }, 400);

 const contentType = match[1] || 'image/jpeg';
 const b64 = match[2];
 if (b64.length > 4_500_000) {
 return json({ error: 'Image too large (max ~3MB). Compress more or use a smaller photo.' }, 413);
 }

 const binary = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
 const id = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
 const result = await putImageFile(context.env, id, binary, contentType);

 return json({
 ok: true,
 id: result.id,
 url: result.url,
 path: result.path,
 contentType,
 bytes: binary.byteLength,
 storage: 'github',
 });
 } catch (e) {
 return json({ error: String(e.message || e) }, 500);
 }
}
