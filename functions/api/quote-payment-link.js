import { json, handleOptions, checkAdmin } from '../../lib/auth.js';
import { getJsonFile, putJsonFile, requireGithub } from '../../lib/github-store.js';

const FILE = 'data/quotes.json';

/**
 * Create a Stripe Payment Link for an accepted fabrication quote.
 * Admin only. Secret: STRIPE_SECRET_KEY
 *
 * Body: { quoteId }  OR  { number, amountIncl, email, name, description }
 * Amount is total the customer pays (typically incl. GST).
 */
export async function onRequestOptions() {
  return handleOptions();
}

export async function onRequestPost(context) {
  const { env, request } = context;
  const auth = checkAdmin(request, env);
  if (!auth.ok) return json({ error: auth.error }, auth.status);

  const secret = env.STRIPE_SECRET_KEY;
  if (!secret) {
    return json(
      {
        error: 'Stripe is not configured. Add STRIPE_SECRET_KEY in Cloudflare Pages → Variables and secrets.',
        code: 'STRIPE_NOT_CONFIGURED',
      },
      503
    );
  }

  try {
    const body = await request.json();
    let quote = null;
    let quotes = [];
    let nextSeq = 1843;
    let dataRoot = null;

    if (body.quoteId || body.number) {
      const file = await getJsonFile(env, FILE);
      dataRoot = file?.data && typeof file.data === 'object' ? file.data : { quotes: [], nextSeq: 1843 };
      quotes = Array.isArray(dataRoot.quotes) ? dataRoot.quotes.slice() : [];
      nextSeq = Number(dataRoot.nextSeq) || 1843;
      quote = quotes.find(
        (q) =>
          (body.quoteId && q.id === body.quoteId) ||
          (body.number && q.number === body.number)
      );
      if (!quote) return json({ error: 'Quote not found — save the quote first' }, 404);
    }

    const number = String(quote?.number || body.number || '').trim() || 'CL-QUOTE';
    const email = String(quote?.customer?.email || body.email || '').trim();
    const name = String(quote?.customer?.name || body.name || '').trim();

    // Prefer total incl GST for payment
    let amount =
      quote?.totals?.priceIncl != null
        ? Number(quote.totals.priceIncl)
        : Number(body.amountIncl != null ? body.amountIncl : body.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      // Fall back to excl + gst
      const excl = Number(quote?.totals?.priceExcl || body.amountExcl || 0);
      const gst = Number(quote?.totals?.gst || 0);
      amount = excl + gst;
    }
    amount = Math.round(amount * 100) / 100;
    const cents = Math.round(amount * 100);
    if (cents < 50) {
      return json({ error: 'Amount too small for Stripe (min ~$0.50)' }, 400);
    }

    const itemCount = Array.isArray(quote?.items) ? quote.items.length : 0;
    const desc =
      String(body.description || '').trim() ||
      `Fabrication quote ${number}` +
        (itemCount ? ` · ${itemCount} part(s)` : '') +
        (name ? ` · ${name}` : '');

    const origin = env.SITE_URL || new URL(request.url).origin;

    // Stripe Payment Link (shareable; customer can open anytime)
    const params = new URLSearchParams();
    params.set('line_items[0][price_data][currency]', 'nzd');
    params.set('line_items[0][price_data][unit_amount]', String(cents));
    params.set('line_items[0][price_data][product_data][name]', `Corten Living — ${number}`.slice(0, 120));
    params.set(
      'line_items[0][price_data][product_data][description]',
      desc.slice(0, 500)
    );
    params.set('line_items[0][quantity]', '1');
    params.set('after_completion[type]', 'redirect');
    params.set(
      'after_completion[redirect][url]',
      `${origin}/order-success?quote=${encodeURIComponent(number)}`
    );
    // Allow promotion codes optional
    params.set('allow_promotion_codes', 'true');
    params.set('billing_address_collection', 'auto');
    params.set('phone_number_collection[enabled]', 'true');
    if (email) {
      // Pre-fill not always available on payment links; metadata still useful
      params.set('metadata[customer_email]', email.slice(0, 200));
    }
    params.set('metadata[quote_number]', number.slice(0, 100));
    params.set('metadata[type]', 'fabrication_quote');
    if (name) params.set('metadata[customer_name]', name.slice(0, 200));
    if (quote?.id) params.set('metadata[quote_id]', String(quote.id).slice(0, 100));

    const res = await fetch('https://api.stripe.com/v1/payment_links', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secret}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });
    const link = await res.json();
    if (!res.ok || !link.url) {
      return json(
        {
          error: link?.error?.message || 'Stripe Payment Link failed',
          stripe: link?.error || null,
        },
        502
      );
    }

    // Persist on quote if we loaded one
    if (quote && dataRoot) {
      quote.status = 'payment_link';
      quote.acceptedAt = quote.acceptedAt || new Date().toISOString();
      quote.paymentLinkUrl = link.url;
      quote.paymentLinkId = link.id || null;
      quote.paymentAmount = amount;
      quote.paymentLinkCreatedAt = new Date().toISOString();
      quote.updatedAt = new Date().toISOString();
      const idx = quotes.findIndex((q) => q.id === quote.id);
      if (idx >= 0) quotes[idx] = quote;
      const gh = requireGithub(env);
      if (gh.ok) {
        await putJsonFile(
          env,
          FILE,
          { quotes, nextSeq, updatedAt: new Date().toISOString() },
          `Admin: payment link for ${number}`
        );
      }
    }

    return json({
      ok: true,
      url: link.url,
      id: link.id,
      amount,
      quoteNumber: number,
      quoteId: quote?.id || null,
    });
  } catch (e) {
    return json({ error: String(e.message || e) }, 500);
  }
}
