import { json } from '../../lib/auth.js';
import { sendPaidOrderEmails } from '../../lib/paid-order-email.js';

/**
 * Stripe webhook backup for emails (works even if success page is closed).
 *
 * Stripe Dashboard → Developers → Webhooks → Add endpoint:
 *   https://corten-living.pages.dev/api/stripe-webhook
 * Events: checkout.session.completed
 *
 * Optional: STRIPE_WEBHOOK_SECRET
 */

export async function onRequestPost(context) {
  const { env, request } = context;
  const secret = env.STRIPE_SECRET_KEY;
  if (!secret) {
    return json({ error: 'Stripe not configured' }, 503);
  }

  try {
    const rawBody = await request.text();
    let event;
    try {
      event = JSON.parse(rawBody);
    } catch {
      return json({ error: 'Invalid JSON' }, 400);
    }

    const whSecret = env.STRIPE_WEBHOOK_SECRET;
    if (whSecret) {
      const sig = request.headers.get('stripe-signature') || '';
      const ok = await verifyStripeSignature(rawBody, sig, whSecret);
      if (!ok) return json({ error: 'Invalid signature' }, 400);
    }

    if (
      event.type !== 'checkout.session.completed' &&
      event.type !== 'checkout.session.async_payment_succeeded'
    ) {
      return json({ ok: true, ignored: event.type });
    }

    let session = event.data?.object;
    if (!session?.id) return json({ error: 'No session in event' }, 400);

    const stripeRes = await fetch(
      `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(session.id)}`,
      { headers: { Authorization: `Bearer ${secret}` } }
    );
    const full = await stripeRes.json();
    if (stripeRes.ok) session = full;

    const result = await sendPaidOrderEmails(env, session);
    return json({ ok: true, ...result });
  } catch (e) {
    return json({ error: String(e.message || e) }, 500);
  }
}

async function verifyStripeSignature(payload, header, secret) {
  try {
    const parts = Object.fromEntries(
      header.split(',').map((p) => {
        const [k, ...rest] = p.split('=');
        return [k.trim(), rest.join('=')];
      })
    );
    const t = parts.t;
    const v1 = parts.v1;
    if (!t || !v1) return false;

    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const signed = await crypto.subtle.sign('HMAC', key, encoder.encode(`${t}.${payload}`));
    const hex = [...new Uint8Array(signed)].map((b) => b.toString(16).padStart(2, '0')).join('');
    if (hex.length !== v1.length) return false;
    let out = 0;
    for (let i = 0; i < hex.length; i++) out |= hex.charCodeAt(i) ^ v1.charCodeAt(i);
    return out === 0;
  } catch {
    return false;
  }
}
