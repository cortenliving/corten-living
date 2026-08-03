/**
 * Shop emails via Forminit (your existing form).
 * Customer payment receipts come from Stripe (Customer emails ON).
 *
 * No FormSubmit — you only use Forminit.
 */

export async function sendPaidOrderEmails(env, session, extras = {}) {
  const meta = session.metadata || {};
  const orderId = meta.order_id || String(session.id || '').slice(0, 18);
  const name = meta.customer_name || session.customer_details?.name || 'Customer';
  const email =
    session.customer_details?.email ||
    session.customer_email ||
    meta.customer_email ||
    '';
  const phone = meta.phone || session.customer_details?.phone || '';
  const address = meta.address || '';
  const notes = meta.notes || '';
  const shipping = meta.shipping || '0';
  const deliveryType = meta.delivery_type || 'standard';
  const gst = meta.gst || '';
  const subtotal = meta.subtotal_excl || '';
  const itemsText = meta.items || '(see Stripe dashboard for line items)';
  const amountTotal =
    session.amount_total != null ? (session.amount_total / 100).toFixed(2) : '';
  const receiptUrl = extras.receiptUrl || meta.receipt_url || '';

  const shopEmail = env.ORDER_NOTIFY_EMAIL || 'cortenliving@gmail.com';

  const shopBody = [
    `PAID ORDER ${orderId}`,
    `Stripe session: ${session.id}`,
    `Customer: ${name}`,
    email ? `Customer email: ${email}` : 'Customer email: (missing)',
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
    receiptUrl ? `Stripe receipt link: ${receiptUrl}` : null,
    '',
    'Payment confirmed by Stripe.',
    email
      ? `Customer should receive a Stripe payment receipt at ${email} (if Customer emails are ON in Stripe).`
      : null,
  ].filter(Boolean).join('\n');

  const results = {
    orderId,
    shop: shopEmail,
    customer: email || null,
    providers: [],
    receiptUrl: receiptUrl || null,
    shopNotified: false,
    customerEmailed: false,
  };

  // Optional Resend — only if you add RESEND_API_KEY later
  if (env.RESEND_API_KEY && email) {
    try {
      const from = env.ORDER_FROM_EMAIL || 'Corten Living <onboarding@resend.dev>';
      const customerBody = [
        `Hi ${name},`,
        '',
        `Thanks for your purchase with Corten Living — payment received.`,
        '',
        `Order: ${orderId}`,
        amountTotal ? `Amount paid: $${amountTotal} NZD (incl. GST)` : null,
        address ? `Delivery address: ${address}` : null,
        receiptUrl ? `Receipt: ${receiptUrl}` : null,
        '',
        'We’ll be in touch about production and dispatch.',
        '',
        'Corten Living · 027 383 8178 · cortenliving@gmail.com',
      ].filter(Boolean).join('\n');

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
        reply_to: shopEmail,
        subject: `Payment received — ${orderId} · Corten Living`,
        text: customerBody,
      });
      results.providers.push('resend');
      results.shopNotified = true;
      results.customerEmailed = true;
      return { ...results, emailed: true, provider: 'resend' };
    } catch (e) {
      results.resendError = String(e.message || e);
    }
  }

  // Forminit → shop only (your existing form — no FormSubmit)
  try {
    await postForminit(env, {
      name: name || 'Stripe customer',
      email: email || shopEmail,
      phone,
      message: shopBody,
    });
    results.providers.push('forminit');
    results.shopNotified = true;
  } catch (e) {
    results.shopError = String(e.message || e);
  }

  return {
    ...results,
    emailed: !!results.shopNotified,
    provider: results.providers.join('+') || 'none',
    // Customer receipt is Stripe's job when Customer emails is ON
    warning: results.shopNotified
      ? (email
        ? `Shop notified via Forminit. Customer receipt should come from Stripe to ${email} (check spam). Use “View Stripe receipt” on this page if needed.`
        : 'Shop notified via Forminit. No customer email on payment.')
      : 'Could not notify shop via Forminit. ' + (results.shopError || ''),
  };
}

async function sendResend(apiKey, payload) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error('Resend failed: ' + t.slice(0, 200));
  }
}

async function postForminit(env, data) {
  const url = env.ORDER_FORMINIT_URL || 'https://forminit.com/f/mwpwiikqjzy';
  const fd = new FormData();
  fd.append('fi-sender-fullName', data.name || 'Customer');
  fd.append('fi-sender-email', data.email || 'orders@corten-living.pages.dev');
  if (data.phone) fd.append('fi-text-phone', data.phone);
  fd.append('fi-text-message', data.message || '');
  const res = await fetch(url, { method: 'POST', body: fd });
  if (!res.ok && res.status >= 400) throw new Error('Forminit ' + res.status);
}

/** Notify shop when checkout starts (Forminit) */
export async function notifyShopCheckoutStarted(env, payload) {
  const msg = [
    'CHECKOUT STARTED (not paid yet)',
    `Order draft: ${payload.orderId}`,
    `Customer: ${payload.name}`,
    `Email: ${payload.email}`,
    payload.phone ? `Phone: ${payload.phone}` : null,
    payload.address ? `Address: ${payload.address}` : null,
    `Total (incl GST estimate): $${payload.totalIncl || '?'}`,
    '',
    'Customer is on Stripe to pay.',
  ].filter(Boolean).join('\n');

  try {
    await postForminit(env, {
      name: payload.name || 'Checkout',
      email: payload.email || 'orders@corten-living.pages.dev',
      phone: payload.phone,
      message: msg,
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}
