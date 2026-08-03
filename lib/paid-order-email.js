/**
 * Shop order emails via Forminit only (same form as contact page).
 * Customer payment receipts: Stripe (Customer emails → Successful payments ON).
 *
 * Note: Forminit free/public mode rate-limits ~1 submission / 30s.
 * We only notify once per paid order (not on checkout start).
 */

const FORMINIT_URL = 'https://forminit.com/f/mwpwiikqjzy';

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
    email ? `Customer email (Stripe receipt goes here): ${email}` : 'Customer email: (missing)',
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
    receiptUrl ? `Stripe receipt: ${receiptUrl}` : null,
    '',
    'Payment confirmed by Stripe.',
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

  // Optional Resend (if you add RESEND_API_KEY later)
  if (env.RESEND_API_KEY && email) {
    try {
      const from = env.ORDER_FROM_EMAIL || 'Corten Living <onboarding@resend.dev>';
      const customerBody = [
        `Hi ${name},`,
        '',
        `Thanks for your purchase with Corten Living — payment received.`,
        `Order: ${orderId}`,
        amountTotal ? `Amount paid: $${amountTotal} NZD (incl. GST)` : null,
        receiptUrl ? `Receipt: ${receiptUrl}` : null,
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

  // Forminit → shop (single notification — avoids free-plan rate limit)
  try {
    const fi = await postForminit(env, {
      name: name || 'Stripe customer',
      email: email || shopEmail,
      phone,
      message: shopBody,
    });
    results.providers.push('forminit');
    results.shopNotified = true;
    results.forminitSubmission = fi?.submission?.hashId || null;
  } catch (e) {
    results.shopError = String(e.message || e);
    // Retry once after short wait (rate limit 1/30s on free Forminit)
    try {
      await new Promise((r) => setTimeout(r, 2000));
      await postForminit(env, {
        name: name || 'Stripe customer',
        email: email || shopEmail,
        phone,
        message: shopBody,
      });
      results.providers.push('forminit-retry');
      results.shopNotified = true;
      results.shopError = undefined;
    } catch (e2) {
      results.shopError = String(e2.message || e2);
    }
  }

  return {
    ...results,
    emailed: !!results.shopNotified,
    provider: results.providers.join('+') || 'none',
    warning: results.shopNotified
      ? (email
        ? `Shop email sent via Forminit. Stripe should email a receipt to ${email} — check spam. Use View Stripe receipt if needed.`
        : 'Shop email sent via Forminit.')
      : 'Forminit shop email failed: ' + (results.shopError || 'unknown') +
        '. Check Forminit dashboard + email notifications. Free plan allows ~1 submit / 30 seconds.',
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

export async function postForminit(env, data) {
  const url = env.ORDER_FORMINIT_URL || FORMINIT_URL;
  const fd = new FormData();
  fd.append('fi-sender-fullName', String(data.name || 'Customer').slice(0, 120));
  fd.append('fi-sender-email', String(data.email || 'orders@corten-living.pages.dev').slice(0, 200));
  if (data.phone) fd.append('fi-text-phone', String(data.phone).slice(0, 40));
  fd.append('fi-text-message', String(data.message || '').slice(0, 8000));

  const res = await fetch(url, {
    method: 'POST',
    body: fd,
    headers: {
      Accept: 'application/json',
      Origin: 'https://corten-living.pages.dev',
      Referer: 'https://corten-living.pages.dev/cart',
    },
  });

  const text = await res.text();
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch (_) {}

  if (res.status === 429) {
    throw new Error('Forminit rate limit (wait 30s between free-plan submissions)');
  }
  if (!res.ok) {
    throw new Error(parsed?.message || text.slice(0, 200) || ('Forminit HTTP ' + res.status));
  }
  if (parsed && parsed.success === false) {
    throw new Error(parsed.message || parsed.error || 'Forminit rejected submission');
  }
  // success:true JSON, or HTML thank-you still ok
  return parsed || { success: true };
}

/**
 * Do NOT call Forminit here — free plan rate-limits to 1/30s and would
 * block the paid-order email. Shop is notified only after payment succeeds.
 */
export async function notifyShopCheckoutStarted(_env, _payload) {
  return { ok: true, skipped: true, reason: 'avoid Forminit rate limit; notify on paid only' };
}
