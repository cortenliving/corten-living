import { corsHeaders } from '../../../lib/auth.js';

/** Public: serve uploaded image from KV */
export async function onRequestGet(context) {
  const id = context.params?.id;
  if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) {
    return new Response('Not found', { status: 404, headers: corsHeaders() });
  }
  if (!context.env.CATALOGUE) {
    return new Response('Storage not configured', { status: 503, headers: corsHeaders() });
  }

  try {
    const result = await context.env.CATALOGUE.getWithMetadata(`img:${id}`, {
      type: 'arrayBuffer',
    });
    if (!result.value) {
      return new Response('Not found', { status: 404, headers: corsHeaders() });
    }
    const contentType = result.metadata?.contentType || 'image/jpeg';
    return new Response(result.value, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000, immutable',
        ...corsHeaders(),
      },
    });
  } catch (e) {
    return new Response(String(e.message || e), { status: 500, headers: corsHeaders() });
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}
