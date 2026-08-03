import { json, handleOptions } from '../../lib/auth.js';
import { notifyShopCheckoutStarted } from '../../lib/paid-order-email.js';

/**
 * Create a Stripe Checkout Session for the cart.
 *
 * Secrets:
 *   STRIPE_SECRET_KEY  — sk_test_... or sk_live_...
 * Optional:
 *   SITE_URL
 */

export async function onRequestOptions() {
  return handleOptions();
}

export async function onRequestPost(context) {
  const { env, request } = context;
  const secret = env.STRIPE_SECRET_KEY;

  if (!secret) {
    return json({
      error: 'Stripe is not configured. Add STRIPE_SECRET_KEY in Cloudflare Pages → Variables and secrets.',
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
    const totalIncl = Math.round((excl + gstAmount) * 100) / 100;

    if (!email) {
      return json({ error: 'Email is required for checkout' }, 400);
    }
    if (!items.length) {
      return json({ error: 'Cart is empty' }, 400);
    }

    const origin = env.SITE_URL || new URL(request.url).origin;
    const orderId = 'CL-' + Date.now().toString(36).toUpperCase();

    // Create Stripe Customer first — improves receipt delivery
    let customerId = null;
    try {
      const custParams = new URLSearchParams();
      custParams.set('email', email);
      if (name) custParams.set('name', name);
      if (phone) custParams.set('phone', phone);
      custParams.set('metadata[order_id]', orderId);
      const custRes = await fetch('https://api.stripe.com/v1/customers', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${secret}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: custParams.toString(),
      });
      const cust = await custRes.json();
      if (custRes.ok && cust.id) customerId = cust.id;
    } catch (_) {}

    const params = new URLSearchParams();
    params.set('mode', 'payment');
    params.set('success_url', `${origin}/order-success?session_id={CHECKOUT_SESSION_ID}&order=${encodeURIComponent(orderId)}`);
    params.set('cancel_url', `${origin}/cart?cancelled=1`);
    params.set('billing_address_collection', 'auto');
    params.set('phone_number_collection[enabled]', 'true');

    if (customerId) {
      params.set('customer', customerId);
      // Update email on payment if they change it at Checkout
      params.set('customer_update[name]', 'auto');
      params.set('customer_update[address]', 'auto');
    } else {
      params.set('customer_email', email);
    }

    // Receipt email (Dashboard: Customer emails → Successful payments must be ON in same mode)
    params.set('payment_intent_data[receipt_email]', email);
    params.set('payment_intent_data[description]', `Corten Living order ${orderId}`);

    // Generate a post-purchase Invoice (Stripe can email invoice/receipt)
    params.set('invoice_creation[enabled]', 'true');
    params.set('invoice_creation[invoice_data][description]', `Corten Living order ${orderId}`);
    params.set('invoice_creation[invoice_data][metadata][order_id]', orderId);
    params.set('invoice_creation[invoice_data][footer]', 'Thank you for your order — Corten Living, Gisborne NZ.');
    if (name) {
      params.set('invoice_creation[invoice_data][custom_fields][0][name]', 'Customer');
      params.set('invoice_creation[invoice_data][custom_fields][0][value]', name.slice(0, 30));
    }

    params.set('metadata[order_id]', orderId);
    params.set('metadata[customer_name]', name.slice(0, 400));
    params.set('metadata[customer_email]', email.slice(0, 200));
    params.set('metadata[phone]', phone.slice(0, 100));
    params.set('metadata[notes]', notes.slice(0, 400));
    params.set('metadata[address]', address.slice(0, 400));
    params.set('metadata[shipping]', String(shippingAmount));
    params.set('metadata[delivery_type]', deliveryType);
    params.set('metadata[gst]', String(gstAmount));
    params.set('metadata[subtotal_excl]', String(subtotalExcl));

    const itemsSummary = items.slice(0, 20).map((it) => {
      const qty = it.qty || 1;
      return `${it.type || 'Item'}: ${it.chars || ''} · ${it.size || ''} · ${it.mount || ''} ×${qty} — $${it.price || 0}`;
    }).join('\n');
    params.set('metadata[items]', itemsSummary.slice(0, 450));
    if (weightKg != null) params.set('metadata[weight_kg]', String(weightKg));
    params.set('payment_intent_data[metadata][order_id]', orderId);
    params.set('payment_intent_data[metadata][customer_email]', email);

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
      // Retry without invoice_creation if that feature isn't available
      const msg = session?.error?.message || 'Stripe Checkout failed';
      if (String(msg).toLowerCase().includes('invoice')) {
        // strip invoice keys and retry once
        for (const key of [...params.keys()]) {
          if (key.startsWith('invoice_creation')) params.delete(key);
        }
        const retry = await fetch('https://api.stripe.com/v1/checkout/sessions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${secret}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: params.toString(),
        });
        const session2 = await retry.json();
        if (!retry.ok) {
          return json({ error: session2?.error?.message || msg, stripe: session2?.error || session?.error }, 502);
        }
        // notify shop + return
        await notifyShopCheckoutStarted(env, {
          orderId, name, email, phone, address, totalIncl,
        });
        return json({ ok: true, orderId, url: session2.url, sessionId: session2.id });
      }
      return json({ error: msg, stripe: session?.error || null }, 502);
    }

    // Notify shop immediately that someone started checkout
    await notifyShopCheckoutStarted(env, {
      orderId, name, email, phone, address, totalIncl,
    });

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
