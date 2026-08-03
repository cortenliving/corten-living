/**
 * Send shop + customer emails after a paid Stripe Checkout session.
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

  if (!email) {
    return { orderId, emailed: false, warning: 'No customer email on Stripe session' };
  }

  const shopEmail = env.ORDER_NOTIFY_EMAIL || 'cortenliving@gmail.com';

  const shopBody = [
    `PAID ORDER ${orderId}`,
    `Stripe session: ${session.id}`,
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
      reply_to: shopEmail,
      subject: `Payment received — ${orderId} · Corten Living`,
      text: customerBody,
    });
    return { orderId, emailed: true, provider: 'resend', customer: email, shop: shopEmail };
  }

  // FormSubmit → shop, autoresponse → customer
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
        _replyto: email,
        _autoresponse: customerBody,
        message: shopBody,
        orderId,
        total: amountTotal ? `$${amountTotal}` : '',
        items: itemsText,
      }),
    });

    if (!fsRes.ok) {
      const errText = await fsRes.text();
      try {
        await postForminit(env, { name, email, phone, message: shopBody });
        return {
          orderId,
          emailed: true,
          provider: 'forminit-fallback',
          warning:
            'Shop notified. Customer email may need FormSubmit activation — check cortenliving@gmail.com for a FormSubmit activation link.',
          detail: errText.slice(0, 200),
          customer: email,
          shop: shopEmail,
        };
      } catch (e2) {
        return {
          orderId,
          emailed: false,
          warning: 'Email failed: ' + String(e2.message || errText).slice(0, 200),
          customer: email,
          shop: shopEmail,
        };
      }
    }

    return {
      orderId,
      emailed: true,
      provider: 'formsubmit',
      customer: email,
      shop: shopEmail,
    };
  } catch (e) {
    return {
      orderId,
      emailed: false,
      warning: String(e.message || e),
      customer: email,
      shop: shopEmail,
    };
  }
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
  fd.append('fi-sender-email', data.email || 'noreply@cortenliving.local');
  if (data.phone) fd.append('fi-text-phone', data.phone);
  fd.append('fi-text-message', data.message || '');
  const res = await fetch(url, { method: 'POST', body: fd });
  if (!res.ok && res.status >= 400) throw new Error('Forminit ' + res.status);
}
