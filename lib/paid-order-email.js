/**
 * Send shop + customer emails after a paid Stripe Checkout session.
 * Tries multiple providers so at least the shop always gets notified.
 */

export async function sendPaidOrderEmails(env, session) {
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

  const shopEmail = env.ORDER_NOTIFY_EMAIL || 'cortenliving@gmail.com';

  const shopBody = [
    `PAID ORDER ${orderId}`,
    `Stripe session: ${session.id}`,
    `Customer: ${name}`,
    email ? `Email: ${email}` : 'Email: (missing)',
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
    `Thanks for your purchase with Corten Living — payment received.`,
    '',
    `Order: ${orderId}`,
    amountTotal ? `Amount paid: $${amountTotal} NZD (incl. GST)` : null,
    address ? `Delivery address: ${address}` : null,
    `Delivery type: ${deliveryType === 'rural' ? 'Rural' : 'Standard'}`,
    '',
    'Items:',
    itemsText,
    '',
    'We’ll be in touch about production and dispatch.',
    '',
    'Questions? 027 383 8178 · cortenliving@gmail.com',
    '',
    'Corten Living',
    'Gisborne, New Zealand',
  ].filter(Boolean).join('\n');

  const results = { orderId, shop: shopEmail, customer: email || null, providers: [] };

  // Always notify shop via Forminit first (same form as contact page — already works)
  try {
    await postForminit(env, {
      name: name || 'Stripe customer',
      email: email || shopEmail,
      phone,
      message: shopBody,
    });
    results.providers.push('forminit-shop');
    results.shopNotified = true;
  } catch (e) {
    results.shopNotified = false;
    results.shopError = String(e.message || e);
  }

  if (!email) {
    return {
      ...results,
      emailed: !!results.shopNotified,
      warning: 'No customer email on session — shop notified only',
    };
  }

  // Resend → customer + shop (best)
  if (env.RESEND_API_KEY) {
    try {
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
        reply_to: shopEmail,
        subject: `Payment received — ${orderId} · Corten Living`,
        text: customerBody,
      });
      results.providers.push('resend');
      return { ...results, emailed: true, provider: 'resend' };
    } catch (e) {
      results.resendError = String(e.message || e);
    }
  }

  // FormSubmit: notify shop + autoresponse to customer email
  try {
    const fsRes = await fetch(`https://formsubmit.co/ajax/${encodeURIComponent(shopEmail)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        name,
        email,
        phone,
        address,
        _subject: `Paid order ${orderId} — Corten Living`,
        _template: 'table',
        _captcha: 'false',
        _replyto: email,
        _autoresponse: customerBody,
        message: shopBody,
        orderId,
        total: amountTotal ? `$${amountTotal}` : '',
        items: itemsText,
      }),
    });
    const fsText = await fsRes.text();
    let fsJson = {};
    try { fsJson = JSON.parse(fsText); } catch (_) {}

    if (fsRes.ok || fsJson.success) {
      results.providers.push('formsubmit');
      return {
        ...results,
        emailed: true,
        provider: 'formsubmit',
        warning:
          'If customer email is missing, open cortenliving@gmail.com and activate FormSubmit (one-time link). Check spam too.',
      };
    }

    results.formsubmitError = fsText.slice(0, 250);
  } catch (e) {
    results.formsubmitError = String(e.message || e);
  }

  return {
    ...results,
    emailed: !!results.shopNotified,
    provider: results.providers.join('+') || 'none',
    warning: results.shopNotified
      ? 'Shop was notified. Customer email may have failed — check FormSubmit activation or spam. Stripe receipt needs Customer emails ON in the same Test/Live mode as your API key.'
      : 'Could not send emails. ' + (results.shopError || results.formsubmitError || ''),
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

/** Notify shop when checkout session is created (before pay) */
export async function notifyShopCheckoutStarted(env, payload) {
  const shopEmail = env.ORDER_NOTIFY_EMAIL || 'cortenliving@gmail.com';
  const msg = [
    'CHECKOUT STARTED (not paid yet)',
    `Order draft: ${payload.orderId}`,
    `Customer: ${payload.name}`,
    `Email: ${payload.email}`,
    payload.phone ? `Phone: ${payload.phone}` : null,
    payload.address ? `Address: ${payload.address}` : null,
    `Total (incl GST estimate): $${payload.totalIncl || '?'}`,
    '',
    'Customer is being redirected to Stripe to pay.',
  ].filter(Boolean).join('\n');

  try {
    await postForminit(env, {
      name: payload.name || 'Checkout',
      email: payload.email || shopEmail,
      phone: payload.phone,
      message: msg,
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}
