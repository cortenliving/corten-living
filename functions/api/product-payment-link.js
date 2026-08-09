import { json, handleOptions, checkAdmin } from '../../lib/auth.js';

/**
 * Create a Stripe Payment Link for a shop product (or size variant).
 * Used for in-store QR codes — customer scans phone → pays on Stripe.
 *
 * Admin only. Secret: STRIPE_SECRET_KEY
 *
 * Body: {
 *   productId, productName,
 *   priceExcl,           // NZD excl. GST
 *   includeGst?: true,   // default true → charge priceExcl * 1.15
 *   sizeId?, sizeLabel?, sizeDims?,
 *   description?
 * }
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
        error: 'Stripe is not configured. Add STRIPE_SECRET_KEY (live) in Cloudflare secrets.',
        code: 'STRIPE_NOT_CONFIGURED',
      },
      503
    );
  }

  try {
    const body = await request.json();
    const productId = String(body.productId || '').trim();
    const productName = String(body.productName || 'Corten product').trim();
    const sizeId = body.sizeId != null ? String(body.sizeId) : '';
    const sizeLabel = String(body.sizeLabel || '').trim();
    const sizeDims = String(body.sizeDims || body.size || '').trim();
    const includeGst = body.includeGst !== false;
    const gstRate = 0.15;

    let priceExcl = Number(body.priceExcl != null ? body.priceExcl : body.price);
    if (!Number.isFinite(priceExcl) || priceExcl <= 0) {
      return json({ error: 'priceExcl must be a number greater than 0' }, 400);
    }
    priceExcl = Math.round(priceExcl * 100) / 100;
    const amount = includeGst
      ? Math.round(priceExcl * (1 + gstRate) * 100) / 100
      : priceExcl;
    const cents = Math.round(amount * 100);
    if (cents < 50) {
      return json({ error: 'Amount too small for Stripe (min ~$0.50)' }, 400);
    }

    const variant = [sizeLabel, sizeDims].filter(Boolean).join(' · ');
    const title = (variant ? `${productName} — ${variant}` : productName).slice(0, 120);
    const desc =
      String(body.description || '').trim() ||
      (includeGst
        ? `In-store · $${priceExcl.toFixed(2)} excl. GST + GST = $${amount.toFixed(2)}`
        : `In-store · $${priceExcl.toFixed(2)} excl. GST`);

    const origin = env.SITE_URL || new URL(request.url).origin;

    const params = new URLSearchParams();
    params.set('line_items[0][price_data][currency]', 'nzd');
    params.set('line_items[0][price_data][unit_amount]', String(cents));
    params.set('line_items[0][price_data][product_data][name]', title);
    params.set('line_items[0][price_data][product_data][description]', desc.slice(0, 500));
    params.set('line_items[0][quantity]', '1');
    params.set('after_completion[type]', 'redirect');
    params.set(
      'after_completion[redirect][url]',
      `${origin}/order-success?product=${encodeURIComponent(productId || 'shop')}`
    );
    params.set('allow_promotion_codes', 'true');
    params.set('billing_address_collection', 'auto');
    params.set('phone_number_collection[enabled]', 'true');
    params.set('metadata[type]', 'product_qr');
    params.set('metadata[product_id]', productId.slice(0, 100));
    params.set('metadata[product_name]', productName.slice(0, 200));
    if (sizeId) params.set('metadata[size_id]', sizeId.slice(0, 80));
    if (sizeLabel) params.set('metadata[size_label]', sizeLabel.slice(0, 100));
    params.set('metadata[price_excl]', String(priceExcl));
    params.set('metadata[amount_charged]', String(amount));
    params.set('metadata[include_gst]', includeGst ? '1' : '0');

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

    return json({
      ok: true,
      url: link.url,
      id: link.id,
      amountIncl: amount,
      amountExcl: priceExcl,
      includeGst,
      productId,
      sizeId: sizeId || null,
      title,
    });
  } catch (e) {
    return json({ error: String(e.message || e) }, 500);
  }
}
