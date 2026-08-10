import { json, handleOptions, checkAdmin } from '../../lib/auth.js';

/**
 * Create / list Stripe promotion codes from Admin.
 * Secret: STRIPE_SECRET_KEY
 *
 * GET  — list recent promotion codes
 * POST — create coupon + promotion code
 *   { code, type: 'percent'|'amount', value, duration?: 'once'|'forever',
 *     maxRedemptions?, expiresAt?: ISO date string, name? }
 */

export async function onRequestOptions() {
  return handleOptions();
}

async function stripeForm(secret, path, params) {
  const res = await fetch('https://api.stripe.com/v1/' + path, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });
  const data = await res.json();
  return { res, data };
}

export async function onRequestGet(context) {
  const auth = checkAdmin(context.request, context.env);
  if (!auth.ok) return json({ error: auth.error }, auth.status);

  const secret = context.env.STRIPE_SECRET_KEY;
  if (!secret) {
    return json({ error: 'STRIPE_SECRET_KEY not configured', codes: [] }, 503);
  }

  try {
    const url = new URL('https://api.stripe.com/v1/promotion_codes');
    url.searchParams.set('limit', '30');
    url.searchParams.set('expand[]', 'data.coupon');
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${secret}` },
    });
    const data = await res.json();
    if (!res.ok) {
      return json({ error: data?.error?.message || 'Failed to list codes', codes: [] }, 502);
    }
    const codes = (data.data || []).map((pc) => {
      const c = pc.coupon || {};
      let discount = '';
      if (c.percent_off != null) discount = c.percent_off + '% off';
      else if (c.amount_off != null) discount = '$' + (c.amount_off / 100).toFixed(2) + ' off';
      return {
        id: pc.id,
        code: pc.code,
        active: !!pc.active,
        timesRedeemed: pc.times_redeemed || 0,
        maxRedemptions: pc.max_redemptions || null,
        expiresAt: pc.expires_at ? new Date(pc.expires_at * 1000).toISOString() : null,
        discount,
        couponId: typeof c === 'string' ? c : c.id,
        created: pc.created ? new Date(pc.created * 1000).toISOString() : null,
      };
    });
    return json({ codes });
  } catch (e) {
    return json({ error: String(e.message || e), codes: [] }, 500);
  }
}

export async function onRequestPost(context) {
  const auth = checkAdmin(context.request, context.env);
  if (!auth.ok) return json({ error: auth.error }, auth.status);

  const secret = context.env.STRIPE_SECRET_KEY;
  if (!secret) {
    return json(
      {
        error: 'STRIPE_SECRET_KEY not configured. Add your live secret key in Cloudflare.',
        code: 'STRIPE_NOT_CONFIGURED',
      },
      503
    );
  }

  try {
    const body = await context.request.json();
    let code = String(body.code || '')
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9_-]/g, '');
    if (code.length < 3) {
      return json({ error: 'Code must be at least 3 letters/numbers' }, 400);
    }

    const type = body.type === 'amount' ? 'amount' : 'percent';
    const value = Number(body.value);
    if (!Number.isFinite(value) || value <= 0) {
      return json({ error: 'Enter a discount value greater than 0' }, 400);
    }
    if (type === 'percent' && value > 100) {
      return json({ error: 'Percent off cannot exceed 100' }, 400);
    }

    const duration = body.duration === 'forever' ? 'forever' : 'once';
    const name = String(body.name || code).slice(0, 40);
    const maxRedemptions =
      body.maxRedemptions != null && body.maxRedemptions !== ''
        ? parseInt(body.maxRedemptions, 10)
        : null;

    // 1) Create coupon
    const couponParams = new URLSearchParams();
    couponParams.set('duration', duration);
    couponParams.set('name', name);
    if (type === 'percent') {
      couponParams.set('percent_off', String(value));
    } else {
      const cents = Math.round(value * 100);
      if (cents < 1) return json({ error: 'Amount too small' }, 400);
      couponParams.set('amount_off', String(cents));
      couponParams.set('currency', 'nzd');
    }
    if (maxRedemptions > 0) {
      // also set on promo code for code-level limit
    }

    const { res: cRes, data: coupon } = await stripeForm(secret, 'coupons', couponParams);
    if (!cRes.ok || !coupon.id) {
      return json(
        { error: coupon?.error?.message || 'Failed to create coupon in Stripe' },
        502
      );
    }

    // 2) Create promotion code (what customers type)
    const promoParams = new URLSearchParams();
    promoParams.set('coupon', coupon.id);
    promoParams.set('code', code);
    if (maxRedemptions > 0) {
      promoParams.set('max_redemptions', String(maxRedemptions));
    }
    if (body.expiresAt) {
      const exp = new Date(body.expiresAt);
      if (!Number.isNaN(exp.getTime())) {
        // end of that day NZ-ish: use UTC end of day
        exp.setUTCHours(23, 59, 59, 0);
        promoParams.set('expires_at', String(Math.floor(exp.getTime() / 1000)));
      }
    }

    const { res: pRes, data: promo } = await stripeForm(
      secret,
      'promotion_codes',
      promoParams
    );
    if (!pRes.ok || !promo.id) {
      return json(
        {
          error: promo?.error?.message || 'Coupon created but promotion code failed',
          couponId: coupon.id,
        },
        502
      );
    }

    return json({
      ok: true,
      code: promo.code,
      promotionCodeId: promo.id,
      couponId: coupon.id,
      active: promo.active,
      discount:
        type === 'percent' ? value + '% off' : '$' + Number(value).toFixed(2) + ' off',
      url: null,
    });
  } catch (e) {
    return json({ error: String(e.message || e) }, 500);
  }
}

/** Deactivate a promotion code */
export async function onRequestPut(context) {
  const auth = checkAdmin(context.request, context.env);
  if (!auth.ok) return json({ error: auth.error }, auth.status);

  const secret = context.env.STRIPE_SECRET_KEY;
  if (!secret) return json({ error: 'STRIPE_SECRET_KEY not configured' }, 503);

  try {
    const body = await context.request.json();
    const id = String(body.id || body.promotionCodeId || '').trim();
    if (!id) return json({ error: 'Missing promotion code id' }, 400);

    const params = new URLSearchParams();
    params.set('active', body.active === true ? 'true' : 'false');

    const res = await fetch('https://api.stripe.com/v1/promotion_codes/' + encodeURIComponent(id), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secret}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });
    const data = await res.json();
    if (!res.ok) {
      return json({ error: data?.error?.message || 'Update failed' }, 502);
    }
    return json({ ok: true, id: data.id, active: data.active, code: data.code });
  } catch (e) {
    return json({ error: String(e.message || e) }, 500);
  }
}
