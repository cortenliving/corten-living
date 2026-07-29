import { json, handleOptions, checkAdmin, requireKV } from '../../lib/auth.js';

export async function onRequestOptions() {
  return handleOptions();
}

/**
 * Admin image upload.
 * Body JSON: { dataUrl: "data:image/jpeg;base64,...", filename?: "x.jpg" }
 * Stores binary in KV under img:{id}, returns { url: "/api/media/{id}" }
 */
export async function onRequestPost(context) {
  const auth = checkAdmin(context.request, context.env);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  const kv = requireKV(context.env);
  if (!kv.ok) return json({ error: kv.error }, kv.status);

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
    // Size guard ~4.5MB raw base64 ≈ 3.3MB binary (KV free tier friendly)
    if (b64.length > 4_500_000) {
      return json({ error: 'Image too large after compress (max ~3MB). Try a smaller photo.' }, 413);
    }

    const binary = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const id = crypto.randomUUID().replace(/-/g, '').slice(0, 16);

    await context.env.CATALOGUE.put(`img:${id}`, binary.buffer, {
      metadata: { contentType, filename: body.filename || '' },
    });

    return json({
      ok: true,
      id,
      url: `/api/media/${id}`,
      contentType,
      bytes: binary.byteLength,
    });
  } catch (e) {
    return json({ error: String(e.message || e) }, 500);
  }
}
