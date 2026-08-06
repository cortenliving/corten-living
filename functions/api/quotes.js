import { json, handleOptions, checkAdmin } from '../../lib/auth.js';
import { getJsonFile, putJsonFile, requireGithub } from '../../lib/github-store.js';

const FILE = 'data/quotes.json';

function empty() {
  return { quotes: [], nextSeq: 1843, updatedAt: null };
}

export async function onRequestOptions() {
  return handleOptions();
}

export async function onRequestGet(context) {
  const auth = checkAdmin(context.request, context.env);
  if (!auth.ok) return json({ error: auth.error }, auth.status);

  try {
    const url = new URL(context.request.url);
    const id = url.searchParams.get('id');
    const file = await getJsonFile(context.env, FILE);
    const data = file?.data && typeof file.data === 'object' ? file.data : empty();
    const quotes = Array.isArray(data.quotes) ? data.quotes : [];
    if (id) {
      const q = quotes.find((x) => x.id === id);
      if (!q) return json({ error: 'Quote not found' }, 404);
      return json({ quote: q, nextSeq: data.nextSeq || 1843 });
    }
    // List without heavy geometry for index
    const list = quotes.map((q) => ({
      id: q.id,
      number: q.number,
      customerName: q.customer?.name || '',
      company: q.customer?.company || '',
      priceExcl: q.totals?.priceExcl ?? null,
      createdAt: q.createdAt,
      updatedAt: q.updatedAt,
      status: q.status || 'draft',
      itemCount: Array.isArray(q.items) ? q.items.length : 0,
      pdfUrl: q.pdfUrl || null,
      pdfPath: q.pdfPath || null,
    }));
    return json({ quotes: list, nextSeq: data.nextSeq || 1843, updatedAt: data.updatedAt });
  } catch (e) {
    return json({ quotes: [], nextSeq: 1843, error: String(e.message || e) }, 200);
  }
}

export async function onRequestPut(context) {
  const auth = checkAdmin(context.request, context.env);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  const gh = requireGithub(context.env);
  if (!gh.ok) return json({ error: gh.error }, gh.status);

  try {
    const body = await context.request.json();
    const file = await getJsonFile(context.env, FILE);
    const data = file?.data && typeof file.data === 'object' ? file.data : empty();
    let quotes = Array.isArray(data.quotes) ? data.quotes.slice() : [];
    let nextSeq = Number(data.nextSeq) || 1843;

    if (body.deleteId) {
      quotes = quotes.filter((q) => q.id !== body.deleteId);
    } else if (body.quote) {
      const q = { ...body.quote };
      if (!q.id) {
        q.id = 'q_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        q.createdAt = new Date().toISOString();
        if (!q.number) {
          const year = new Date().getFullYear();
          q.number = `CL-${year}-${nextSeq}`;
          nextSeq += 1;
        }
      }
      q.updatedAt = new Date().toISOString();
      // Strip raw DXF text if huge — keep geometry summary only
      if (Array.isArray(q.items)) {
        q.items = q.items.map((it) => {
          const copy = { ...it };
          if (copy.dxfText && String(copy.dxfText).length > 80000) {
            delete copy.dxfText;
          }
          return copy;
        });
      }
      const idx = quotes.findIndex((x) => x.id === q.id);
      if (idx >= 0) quotes[idx] = q;
      else quotes.unshift(q);
    } else {
      return json({ error: 'Provide quote or deleteId' }, 400);
    }

    // Cap stored quotes to last 200
    if (quotes.length > 200) quotes = quotes.slice(0, 200);

    const payload = {
      quotes,
      nextSeq,
      updatedAt: new Date().toISOString(),
    };
    await putJsonFile(context.env, FILE, payload, 'Admin: update quotes');
    return json({
      ok: true,
      quote: body.quote
        ? quotes.find((x) => x.id === body.quote.id) || quotes[0]
        : null,
      nextSeq,
      storage: 'github',
    });
  } catch (e) {
    return json({ error: String(e.message || e) }, 500);
  }
}
