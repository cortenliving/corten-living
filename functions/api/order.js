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
    const total = Number(body.total) || 0;

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
      '',
      'Items:',
      lines,
      '',
      `Total (excl. GST & shipping): $${total}`,
    ].filter(Boolean).join('\n');

    const customerConfirm = [
      `Hi ${name},`,
      '',
      `Thanks for your order with Corten Living (${orderId}).`,
      '',
      'We have received:',
      lines,
      '',
      `Subtotal (excl. GST & shipping): $${total}`,
      '',
      'We will confirm shipping, GST and payment details shortly.',
      '',
      'If you have any questions, reply to this email or call 027 383 8178.',
      '',
      'Corten Living',
      'Gisborne, New Zealand',
      'cortenliving@gmail.com',
    ].join('\n');

    // Prefer Resend if configured
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

    // FormSubmit.co — free, notifies shop + autoresponse to customer
    // First use: FormSubmit may send an activation email to the shop address.
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
        _subject: `New order ${orderId} — Corten Living`,
        _template: 'table',
        _replyto: email,
        _autoresponse: customerConfirm,
        message: summary,
        orderId,
        total: `$${total}`,
        items: lines,
      }),
    });

    if (!fsRes.ok) {
      const errText = await fsRes.text();
      // Fallback: Forminit (business only) if FormSubmit fails
      if (env.ORDER_FORMINIT_URL || true) {
        try {
          await postForminit(env, {
            name, email, phone, message: summary, orderId, total,
          });
          return json({
            ok: true,
            orderId,
            emailed: true,
            provider: 'forminit-fallback',
            warning: 'Customer auto-email may need FormSubmit activation. Shop was notified.',
            detail: errText.slice(0, 200),
          });
        } catch (e2) {
          return json({ error: 'Could not send order email: ' + (e2.message || errText) }, 502);
        }
      }
      return json({ error: 'Email service error', detail: errText.slice(0, 300) }, 502);
    }

    return json({ ok: true, orderId, emailed: true, provider: 'formsubmit' });
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
  fd.append('fi-sender-fullName', data.name);
  fd.append('fi-sender-email', data.email);
  if (data.phone) fd.append('fi-text-phone', data.phone);
  fd.append('fi-text-message', data.message);
  const res = await fetch(url, { method: 'POST', body: fd });
  if (!res.ok && res.status >= 400) {
    throw new Error('Forminit ' + res.status);
  }
}
