import { json, handleOptions } from '../../lib/auth.js';

/**
 * Place order from cart.
 * - Emails the shop (ORDER_NOTIFY_EMAIL or cortenliving@gmail.com)
 * - Emails the customer a confirmation (FormSubmit autoresponse, or Resend if configured)
 *
 * Optional secrets:
 *   ORDER_NOTIFY_EMAIL  — where shop orders go (default cortenliving@gmail.com)
 *   RESEND_API_KEY      — if set, use Resend instead of FormSubmit
 *   ORDER_FROM_EMAIL    — verified Resend from address
 */

export async function onRequestOptions() {
  return handleOptions();
}

export async function onRequestPost(context) {
  const { env } = context;
  try {
    const body = await context.request.json();
    const name = String(body.name || '').trim();
    const email = String(body.email || '').trim();
    const phone = String(body.phone || '').trim();
    const address = String(body.address || '').trim();
    const notes = String(body.notes || '').trim();
    const items = Array.isArray(body.items) ? body.items : [];
    const subtotal = Number(body.subtotal != null ? body.subtotal : body.total) || 0;
    const shipping = Math.max(0, Number(body.shipping) || 0);
    const shippingLabel = String(body.shippingLabel || 'NZ shipping');
    const weightKg = body.weightKg != null ? Number(body.weightKg) : null;
    const deliveryType = body.deliveryType === 'rural' ? 'rural' : 'standard';
    const GST_RATE = 0.15;
    let gst = Number(body.gst);
    if (!Number.isFinite(gst) || gst < 0) {
      gst = Math.round((subtotal + shipping) * GST_RATE * 100) / 100;
    }
    const totalExcl = Math.round((subtotal + shipping) * 100) / 100;
    const total = Number(body.total) || Math.round((totalExcl + gst) * 100) / 100;

    if (!name || !email) {
      return json({ error: 'Name and email are required' }, 400);
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ error: 'Invalid email address' }, 400);
    }
    if (!items.length) {
      return json({ error: 'Cart is empty' }, 400);
    }

    const orderId = 'CL-' + Date.now().toString(36).toUpperCase();
    const lines = items.map((it, i) => {
      const qty = it.qty || 1;
      return `${i + 1}. ${it.type || 'Item'}: ${it.chars || ''} · ${it.size || ''} · ${it.mount || ''} ×${qty} — $${it.price || 0}`;
    }).join('\n');

    const shopEmail = env.ORDER_NOTIFY_EMAIL || 'cortenliving@gmail.com';
    const summary = [
      `Order ${orderId}`,
      `Customer: ${name}`,
      `Email: ${email}`,
      phone ? `Phone: ${phone}` : null,
      address ? `Address: ${address}` : null,
      notes ? `Notes: ${notes}` : null,
      weightKg != null ? `Est. weight: ${weightKg} kg` : null,
      `Delivery type: ${deliveryType === 'rural' ? 'Rural (surcharge may apply)' : 'Standard'}`,
      '',
      'Items:',
      lines,
      '',
      `Subtotal (excl. GST): $${subtotal}`,
      `${shippingLabel}: $${shipping}${shipping === 0 && body.freeShipping ? ' (free shipping threshold)' : ''}`,
      `GST (15%): $${gst}`,
      `Total (incl. GST): $${total}`,
    ].filter(Boolean).join('\n');

    const customerConfirm = [
      `Hi ${name},`,
      '',
      `Thanks for your order with Corten Living (${orderId}).`,
      '',
      'We have received:',
      lines,
      '',
      `Subtotal (excl. GST): $${subtotal}`,
      `${shippingLabel}: $${shipping}`,
      `Delivery: ${deliveryType === 'rural' ? 'Rural' : 'Standard'}`,
      `GST (15%): $${gst}`,
      `Total (incl. GST): $${total}`,
      weightKg != null ? `Estimated parcel weight: ~${weightKg} kg` : null,
      '',
      'If you have any questions, reply to this email or call 027 383 8178.',
      '',
      'Corten Living',
      'Gisborne, New Zealand',
      'cortenliving@gmail.com',
    ].filter(Boolean).join('\n');

    // Prefer Resend if configured (optional)
    if (env.RESEND_API_KEY) {
      const from = env.ORDER_FROM_EMAIL || 'Corten Living <onboarding@resend.dev>';
      await sendResend(env.RESEND_API_KEY, {
        from,
        to: shopEmail,
        reply_to: email,
        subject: `New order ${orderId} — ${name}`,
        text: summary,
      });
      await sendResend(env.RESEND_API_KEY, {
        from,
        to: email,
        reply_to: shopEmail,
        subject: `Order confirmation ${orderId} — Corten Living`,
        text: customerConfirm,
      });
      return json({ ok: true, orderId, emailed: true, provider: 'resend' });
    }

    // Forminit only (same as contact form — no FormSubmit)
    try {
      await postForminit(env, {
        name,
        email,
        phone,
        message: summary + '\n\n--- Customer confirmation text ---\n' + customerConfirm,
        orderId,
        total,
      });
      return json({
        ok: true,
        orderId,
        emailed: true,
        provider: 'forminit',
        warning: 'Shop notified via Forminit. Customer payment receipts come from Stripe when they pay by card.',
      });
    } catch (e2) {
      return json({ error: 'Could not send order email: ' + (e2.message || e2) }, 502);
    }
  } catch (e) {
    return json({ error: String(e.message || e) }, 500);
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
  fd.append('fi-sender-fullName', String(data.name || 'Customer').slice(0, 120));
  fd.append('fi-sender-email', String(data.email || 'orders@corten-living.pages.dev').slice(0, 200));
  if (data.phone) fd.append('fi-text-phone', String(data.phone).slice(0, 40));
  const msg = data.message || '';
  fd.append('fi-text-message', String(msg).slice(0, 8000));
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
  try { parsed = JSON.parse(text); } catch (_) {}
  if (res.status === 429) throw new Error('Forminit rate limit — wait 30 seconds and try again');
  if (!res.ok || (parsed && parsed.success === false)) {
    throw new Error(parsed?.message || text.slice(0, 200) || ('Forminit ' + res.status));
  }
}
