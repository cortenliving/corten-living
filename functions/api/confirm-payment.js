import { json, handleOptions } from '../../lib/auth.js';
import { sendPaidOrderEmails } from '../../lib/paid-order-email.js';

/**
 * After Stripe Checkout success page loads:
 * 1) Ask Stripe to email the invoice/receipt to the customer
 * 2) Email shop + customer via Forminit/FormSubmit/Resend
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

    // Expand invoice + payment_intent so we can force Stripe emails
    const stripeRes = await fetch(
      `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}?expand[]=invoice&expand[]=payment_intent&expand[]=payment_intent.latest_charge`,
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

    // Force Stripe to email invoice / ensure receipt email is set
    const stripeEmail = await forceStripeCustomerEmails(secret, session);

    const result = await sendPaidOrderEmails(env, session);
    return json({
      ok: true,
      ...result,
      stripeEmail,
    });
  } catch (e) {
    return json({ error: String(e.message || e) }, 500);
  }
}

/**
 * Best-effort: send invoice email + set receipt_email on PaymentIntent/Charge.
 */
async function forceStripeCustomerEmails(secret, session) {
  const out = { invoiceSent: false, receiptEmailSet: false, details: [] };
  const headers = {
    Authorization: `Bearer ${secret}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  };

  const customerEmail =
    session.customer_details?.email ||
    session.customer_email ||
    session.metadata?.customer_email ||
    '';

  // 1) Send invoice if Checkout created one
  let invoiceId = null;
  if (typeof session.invoice === 'string') invoiceId = session.invoice;
  else if (session.invoice?.id) invoiceId = session.invoice.id;

  if (invoiceId) {
    try {
      // Ensure invoice has customer_email
      if (customerEmail) {
        await fetch(`https://api.stripe.com/v1/invoices/${encodeURIComponent(invoiceId)}`, {
          method: 'POST',
          headers,
          body: new URLSearchParams({
            // custom fields not needed
          }).toString(),
        }).catch(() => {});
      }
      const sendRes = await fetch(
        `https://api.stripe.com/v1/invoices/${encodeURIComponent(invoiceId)}/send`,
        { method: 'POST', headers }
      );
      const sendBody = await sendRes.json().catch(() => ({}));
      if (sendRes.ok) {
        out.invoiceSent = true;
        out.details.push('Stripe invoice emailed to customer');
      } else {
        out.details.push('Invoice send: ' + (sendBody?.error?.message || sendRes.status));
      }
    } catch (e) {
      out.details.push('Invoice send error: ' + String(e.message || e));
    }
  } else {
    out.details.push('No invoice on session (invoice_creation may be off)');
  }

  // 2) Ensure PaymentIntent has receipt_email (helps automatic receipts)
  let pi = session.payment_intent;
  let piId = typeof pi === 'string' ? pi : pi?.id;
  if (piId && customerEmail) {
    try {
      const piRes = await fetch(`https://api.stripe.com/v1/payment_intents/${encodeURIComponent(piId)}`, {
        method: 'POST',
        headers,
        body: new URLSearchParams({ receipt_email: customerEmail }).toString(),
      });
      if (piRes.ok) {
        out.receiptEmailSet = true;
        out.details.push('PaymentIntent receipt_email set to ' + customerEmail);
      } else {
        const t = await piRes.json().catch(() => ({}));
        out.details.push('PI update: ' + (t?.error?.message || piRes.status));
      }
    } catch (e) {
      out.details.push('PI update error: ' + String(e.message || e));
    }
  }

  // 3) If we have a charge id, try updating receipt_email on the charge
  const chargeId =
    (typeof pi === 'object' && pi?.latest_charge && (typeof pi.latest_charge === 'string' ? pi.latest_charge : pi.latest_charge?.id)) ||
    null;
  if (chargeId && customerEmail) {
    try {
      const chRes = await fetch(`https://api.stripe.com/v1/charges/${encodeURIComponent(chargeId)}`, {
        method: 'POST',
        headers,
        body: new URLSearchParams({ receipt_email: customerEmail }).toString(),
      });
      if (chRes.ok) {
        out.details.push('Charge receipt_email set');
      }
    } catch (_) {}
  }

  out.customerEmail = customerEmail || null;
  return out;
}
