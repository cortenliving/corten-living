import { json, handleOptions } from '../../lib/auth.js';

/**
 * After Stripe Checkout success, send shop + customer emails.
 * Called from order-success.html with session_id.
 *
 * Uses STRIPE_SECRET_KEY to verify the session was paid.
 * Emails via RESEND_API_KEY (preferred) or FormSubmit fallback.
 *
 * Optional: ORDER_NOTIFY_EMAIL, ORDER_FROM_EMAIL, RESEND_API_KEY
 */

export async function onRequestOptions() {
  return handleOptions();
}

export async function onRequestPost(context) {
  const { env, request } = context;
  const secret = env.STRIPE_SECRET_KEY;
  if (!secret) {
    return json({ error: 'Stripe not configured' }, 503);
  }

  try {
    const body = await request.json();
    const sessionId = String(body.sessionId || body.session_id || '').trim();
    if (!sessionId || !sessionId.startsWith('cs_')) {
      return json({ error: 'Invalid session id' }, 400);
    }

    // Retrieve Checkout Session from Stripe
    const stripeRes = await fetch(
      `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}?expand[]=payment_intent&expand[]=line_items`,
      {
        headers: { Authorization: `Bearer ${secret}` },
      }
    );
    const session = await stripeRes.json();
    if (!stripeRes.ok) {
      return json({ error: session?.error?.message || 'Could not load Stripe session' }, 502);
    }

    if (session.payment_status !== 'paid' && session.status !== 'complete') {
      return json({ error: 'Payment not complete', payment_status: session.payment_status }, 400);
    }

    const meta = session.metadata || {};
    const orderId = meta.order_id || sessionId.slice(0, 18);
    const name = meta.customer_name || 'Customer';
    const email = session.customer_details?.email || session.customer_email || meta.customer_email || '';
    const phone = meta.phone || session.customer_details?.phone || '';
    const address = meta.address || '';
    const notes = meta.notes || '';
    const shipping = meta.shipping || '0';
    const deliveryType = meta.delivery_type || 'standard';
    const gst = meta.gst || '';
    const subtotal = meta.subtotal_excl || '';
    const itemsText = meta.items || '(see Stripe dashboard)';
    const amountTotal = session.amount_total != null ? (session.amount_total / 100).toFixed(2) : '';

    if (!email) {
      return json({ ok: true, emailed: false, warning: 'No customer email on session' });
    }

    const shopEmail = env.ORDER_NOTIFY_EMAIL || 'cortenliving@gmail.com';
    const shopBody = [
      `PAID ORDER ${orderId}`,
      `Stripe session: ${sessionId}`,
      `Customer: ${name}`,
      `Email: ${email}`,
      phone ? `Phone: ${phone}` : null,
      address ? `Address: ${address}` : null,
      notes ? `Notes: ${notes}` : null,
      `Delivery: ${deliveryType === 'rural' ? 'Rural' : 'Standard'}`,
      '',
      'Items:',
      itemsText,
      '',
      subtotal ? `Subtotal (excl. GST): $${subtotal}` : null,
      shipping ? `Shipping (excl. GST): $${shipping}` : null,
      gst ? `GST: $${gst}` : null,
      amountTotal ? `Total paid (incl. GST): $${amountTotal} NZD` : null,
      '',
      'Payment confirmed by Stripe.',
    ].filter(Boolean).join('\n');

    const customerBody = [
      `Hi ${name},`,
      '',
      `Thanks for your purchase with Corten Living.`,
      '',
      `Order: ${orderId}`,
      amountTotal ? `Amount paid: $${amountTotal} NZD (incl. GST)` : null,
      address ? `Delivery address: ${address}` : null,
      `Delivery type: ${deliveryType === 'rural' ? 'Rural' : 'Standard'}`,
      '',
      'Items:',
      itemsText,
      '',
      'Stripe will also send a payment receipt if receipts are enabled on our Stripe account.',
      'We’ll be in touch about production and dispatch.',
      '',
      'Questions? 027 383 8178 · cortenliving@gmail.com',
      '',
      'Corten Living',
      'Gisborne, New Zealand',
    ].filter(Boolean).join('\n');

    let provider = 'none';

    if (env.RESEND_API_KEY) {
      const from = env.ORDER_FROM_EMAIL || 'Corten Living <onboarding@resend.dev>';
      await sendResend(env.RESEND_API_KEY, {
        from,
        to: shopEmail,
        reply_to: email,
        subject: `Paid order ${orderId} — ${name}`,
        text: shopBody,
      });
      await sendResend(env.RESEND_API_KEY, {
        from,
        to: email,
        subject: `Payment received — ${orderId} · Corten Living`,
        text: customerBody,
      });
      provider = 'resend';
    } else {
      // FormSubmit to shop
      try {
        await sendFormSubmit(shopEmail, {
          name,
          email,
          phone,
          message: shopBody,
          orderId,
          total: amountTotal,
          _subject: `Paid order ${orderId} — ${name}`,
          _replyto: email,
        });
        // Autoresponse-style customer note via FormSubmit if possible
        await sendFormSubmit(email, {
          name: 'Corten Living',
          email: shopEmail,
          message: customerBody,
          _subject: `Payment received — ${orderId} · Corten Living`,
          _replyto: shopEmail,
        }).catch(() => {});
        provider = 'formsubmit';
      } catch (e) {
        return json({
          ok: true,
          orderId,
          emailed: false,
          warning: String(e.message || e),
        });
      }
    }

    return json({ ok: true, orderId, emailed: true, provider });
  } catch (e) {
    return json({ error: String(e.message || e) }, 500);
  }
}

async function sendResend(apiKey, { from, to, subject, text, reply_to }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from, to, subject, text, reply_to }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error('Resend failed: ' + t);
  }
}

async function sendFormSubmit(toEmail, data) {
  const fd = new FormData();
  Object.entries(data).forEach(([k, v]) => {
    if (v != null) fd.append(k, String(v));
  });
  // formsubmit.co needs the form endpoint as the recipient
  const res = await fetch(`https://formsubmit.co/ajax/${encodeURIComponent(toEmail)}`, {
    method: 'POST',
    body: fd,
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || 'FormSubmit failed');
  }
}
