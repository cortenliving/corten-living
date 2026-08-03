import { json, handleOptions } from '../../lib/auth.js';
import { sendPaidOrderEmails } from '../../lib/paid-order-email.js';

/**
 * After Stripe Checkout success page loads, verify session + email shop/customer.
 */

export async function onRequestOptions() {
  return handleOptions();
}

export async function onRequestPost(context) {
  const { env } = context;
  const secret = env.STRIPE_SECRET_KEY;
  if (!secret) {
    return json({ error: 'Stripe not configured (STRIPE_SECRET_KEY)' }, 503);
  }

  try {
    const body = await context.request.json();
    const sessionId = String(body.sessionId || body.session_id || '').trim();
    if (!sessionId || !sessionId.startsWith('cs_')) {
      return json({ error: 'Invalid session id' }, 400);
    }

    const stripeRes = await fetch(
      `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`,
      { headers: { Authorization: `Bearer ${secret}` } }
    );
    const session = await stripeRes.json();
    if (!stripeRes.ok) {
      return json({
        error: session?.error?.message || 'Could not load Stripe session',
        stripe: session?.error || null,
      }, 502);
    }

    const paid =
      session.payment_status === 'paid' ||
      session.payment_status === 'no_payment_required' ||
      session.status === 'complete';

    if (!paid) {
      return json({
        error: 'Payment not complete yet',
        payment_status: session.payment_status,
        status: session.status,
      }, 400);
    }

    const result = await sendPaidOrderEmails(env, session);
    return json({ ok: true, ...result });
  } catch (e) {
    return json({ error: String(e.message || e) }, 500);
  }
}
