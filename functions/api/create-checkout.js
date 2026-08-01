import { json, handleOptions } from '../../lib/auth.js';

/**
 * Create a Stripe Checkout Session for the cart.
 *
 * Cloudflare secret required:
 *   STRIPE_SECRET_KEY  — sk_test_... or sk_live_...
 *
 * Optional:
 *   SITE_URL — e.g. https://corten-living.pages.dev (auto from request if unset)
 */

export async function onRequestOptions() {
  return handleOptions();
}

export async function onRequestPost(context) {
  const { env, request } = context;
  const secret = env.STRIPE_SECRET_KEY;

  if (!secret) {
    return json({
      error: 'Stripe is not configured. Add STRIPE_SECRET_KEY in Cloudflare Pages → Variables and secrets (Test mode key: sk_test_...).',
      code: 'STRIPE_NOT_CONFIGURED',
    }, 503);
  }

  try {
    const body = await request.json();
    const name = String(body.name || '').trim();
    const email = String(body.email || '').trim();
    const phone = String(body.phone || '').trim();
    const address = String(body.address || '').trim();
    const notes = String(body.notes || '').trim();
    const items = Array.isArray(body.items) ? body.items : [];
    const shippingAmount = Math.max(0, Number(body.shipping) || 0);
    const shippingLabel = String(body.shippingLabel || 'NZ shipping').slice(0, 100);
    const weightKg = body.weightKg != null ? Number(body.weightKg) : null;
    const deliveryType = body.deliveryType === 'rural' ? 'rural' : 'standard';
    const GST_RATE = 0.15;
    // Prefer client-calculated GST; recompute as safety
    let subtotalExcl = 0;
    for (const it of items) {
      const unit = Number(it.price) || 0;
      const qty = Math.max(1, parseInt(it.qty, 10) || 1);
      subtotalExcl += unit * qty;
    }
    subtotalExcl = Math.round(subtotalExcl * 100) / 100;
    const excl = Math.round((subtotalExcl + shippingAmount) * 100) / 100;
    let gstAmount = Number(body.gst);
    if (!Number.isFinite(gstAmount) || gstAmount < 0) {
      gstAmount = Math.round(excl * GST_RATE * 100) / 100;
    } else {
      gstAmount = Math.round(gstAmount * 100) / 100;
    }

    if (!email) {
      return json({ error: 'Email is required for checkout' }, 400);
    }
    if (!items.length) {
      return json({ error: 'Cart is empty' }, 400);
    }

    const origin = env.SITE_URL || new URL(request.url).origin;
    const orderId = 'CL-' + Date.now().toString(36).toUpperCase();

    // Build Stripe form body (application/x-www-form-urlencoded)
    const params = new URLSearchParams();
    params.set('mode', 'payment');
    params.set('success_url', `${origin}/order-success?session_id={CHECKOUT_SESSION_ID}&order=${encodeURIComponent(orderId)}`);
    params.set('cancel_url', `${origin}/cart?cancelled=1`);
    params.set('customer_email', email);
    params.set('billing_address_collection', 'auto');
    params.set('phone_number_collection[enabled]', 'true');
    params.set('metadata[order_id]', orderId);
    params.set('metadata[customer_name]', name.slice(0, 400));
    params.set('metadata[phone]', phone.slice(0, 100));
    params.set('metadata[notes]', notes.slice(0, 400));
    params.set('metadata[address]', address.slice(0, 400));
    params.set('metadata[shipping]', String(shippingAmount));
    params.set('metadata[delivery_type]', deliveryType);
    params.set('metadata[gst]', String(gstAmount));
    params.set('metadata[subtotal_excl]', String(subtotalExcl));
    if (weightKg != null) params.set('metadata[weight_kg]', String(weightKg));
    params.set('payment_intent_data[metadata][order_id]', orderId);

    let lineIndex = 0;
    for (const it of items) {
      const unit = Number(it.price);
      if (!Number.isFinite(unit) || unit < 0) {
        return json({ error: 'Invalid item price in cart' }, 400);
      }
      const cents = Math.round(unit * 100);
      if (cents <= 0) {
        return json({ error: 'Item price must be greater than zero' }, 400);
      }
      const qty = Math.max(1, parseInt(it.qty, 10) || 1);
      const label = [
        it.type || 'Corten product',
        it.chars ? String(it.chars) : '',
        it.size || '',
        it.mount || '',
      ].filter(Boolean).join(' · ').slice(0, 120);

      params.set(`line_items[${lineIndex}][price_data][currency]`, 'nzd');
      params.set(`line_items[${lineIndex}][price_data][unit_amount]`, String(cents));
      params.set(`line_items[${lineIndex}][price_data][product_data][name]`, label);
      params.set(`line_items[${lineIndex}][price_data][product_data][description]`, 'Price excl. GST. Corten Living, Gisborne NZ.');
      params.set(`line_items[${lineIndex}][quantity]`, String(qty));
      lineIndex++;
    }

    // Shipping as its own line item when > $0 (excl. GST)
    if (shippingAmount > 0) {
      const shipCents = Math.round(shippingAmount * 100);
      if (shipCents > 0) {
        const desc = [
          weightKg != null ? `Est. parcel ~${weightKg} kg` : 'Estimated shipping',
          deliveryType === 'rural' ? 'Rural delivery' : 'Standard delivery',
          'excl. GST',
        ].join(' · ');
        params.set(`line_items[${lineIndex}][price_data][currency]`, 'nzd');
        params.set(`line_items[${lineIndex}][price_data][unit_amount]`, String(shipCents));
        params.set(`line_items[${lineIndex}][price_data][product_data][name]`, shippingLabel + (deliveryType === 'rural' ? ' (rural)' : ''));
        params.set(`line_items[${lineIndex}][price_data][product_data][description]`, desc);
        params.set(`line_items[${lineIndex}][quantity]`, '1');
        lineIndex++;
      }
    }

    // GST 15% on products + shipping
    if (gstAmount > 0) {
      const gstCents = Math.round(gstAmount * 100);
      if (gstCents > 0) {
        params.set(`line_items[${lineIndex}][price_data][currency]`, 'nzd');
        params.set(`line_items[${lineIndex}][price_data][unit_amount]`, String(gstCents));
        params.set(`line_items[${lineIndex}][price_data][product_data][name]`, 'GST (15%)');
        params.set(`line_items[${lineIndex}][price_data][product_data][description]`, 'NZ GST on goods and shipping');
        params.set(`line_items[${lineIndex}][quantity]`, '1');
        lineIndex++;
      }
    }

    const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secret}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    const session = await stripeRes.json();
    if (!stripeRes.ok) {
      const msg = session?.error?.message || 'Stripe Checkout failed';
      return json({ error: msg, stripe: session?.error || null }, 502);
    }

    return json({
      ok: true,
      orderId,
      url: session.url,
      sessionId: session.id,
    });
  } catch (e) {
    return json({ error: String(e.message || e) }, 500);
  }
}
