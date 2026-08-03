import { json, handleOptions } from '../../lib/auth.js';
import { sendPaidOrderEmails } from '../../lib/paid-order-email.js';

/**
 * After Stripe success page:
 * - Load session + charge receipt URL
 * - Send Stripe invoice if present
 * - Email shop + customer (Forminit/FormSubmit/Resend)
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

    const stripeEmail = await forceStripeCustomerEmails(secret, session);

    // Attach receipt URL into metadata for our email body
    if (stripeEmail.receiptUrl && session.metadata) {
      session.metadata = { ...session.metadata, receipt_url: stripeEmail.receiptUrl };
    }

    const result = await sendPaidOrderEmails(env, session, {
      receiptUrl: stripeEmail.receiptUrl || null,
    });

    return json({
      ok: true,
      ...result,
      stripeEmail,
      receiptUrl: stripeEmail.receiptUrl || null,
    });
  } catch (e) {
    return json({ error: String(e.message || e) }, 500);
  }
}

async function forceStripeCustomerEmails(secret, session) {
  const out = {
    invoiceSent: false,
    receiptUrl: null,
    details: [],
  };
  const headers = {
    Authorization: `Bearer ${secret}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  };

  const customerEmail =
    session.customer_details?.email ||
    session.customer_email ||
    session.metadata?.customer_email ||
    '';

  // Receipt URL from charge (customer can open this even if email fails)
  const pi = session.payment_intent;
  const charge =
    typeof pi === 'object' && pi?.latest_charge
      ? typeof pi.latest_charge === 'string'
        ? null
        : pi.latest_charge
      : null;

  if (charge?.receipt_url) {
    out.receiptUrl = charge.receipt_url;
    out.details.push('Receipt link available');
  } else if (typeof pi === 'object' && typeof pi?.latest_charge === 'string') {
    try {
      const chRes = await fetch(
        `https://api.stripe.com/v1/charges/${encodeURIComponent(pi.latest_charge)}`,
        { headers: { Authorization: `Bearer ${secret}` } }
      );
      const ch = await chRes.json();
      if (ch.receipt_url) {
        out.receiptUrl = ch.receipt_url;
        out.details.push('Receipt link loaded from charge');
      }
    } catch (_) {}
  }

  // Send invoice email if Checkout created an invoice
  let invoiceId = null;
  if (typeof session.invoice === 'string') invoiceId = session.invoice;
  else if (session.invoice?.id) invoiceId = session.invoice.id;

  if (invoiceId) {
    try {
      const sendRes = await fetch(
        `https://api.stripe.com/v1/invoices/${encodeURIComponent(invoiceId)}/send`,
        { method: 'POST', headers: { Authorization: `Bearer ${secret}` } }
      );
      const sendBody = await sendRes.json().catch(() => ({}));
      if (sendRes.ok) {
        out.invoiceSent = true;
        out.details.push('Stripe invoice emailed');
        if (sendBody.hosted_invoice_url && !out.receiptUrl) {
          out.receiptUrl = sendBody.hosted_invoice_url;
        }
      } else {
        out.details.push('Invoice send: ' + (sendBody?.error?.message || sendRes.status));
      }
    } catch (e) {
      out.details.push('Invoice send error: ' + String(e.message || e));
    }
  } else {
    out.details.push('No invoice on this payment');
  }

  out.customerEmail = customerEmail || null;
  return out;
}
