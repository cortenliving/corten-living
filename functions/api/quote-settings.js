import { json, handleOptions, checkAdmin } from '../../lib/auth.js';
import { getJsonFilePublic, putJsonFile, requireGithub } from '../../lib/github-store.js';

const FILE = 'data/quote-settings.json';

const DEFAULTS = {
  currency: 'NZD',
  gstRate: 0.15,
  defaultMarginPercent: 35,
  quoteValidDays: 14,
  quoteNumberPrefix: 'CL',
  material: { label: 'Material (3 mm Corten)', ratePerM2: 95, silhouetteFill: 0.32 },
  laser: { label: 'Laser cutting', ratePerMetre: 2.8, minCharge: 12 },
  setup: { label: 'Setup (once per quote)', amount: 28 },
  freight: {
    label: 'Freight',
    tiers: [
      { id: 'small', label: 'Small', maxKg: 2, price: 15 },
      { id: 'medium', label: 'Medium', maxKg: 10, price: 25 },
      { id: 'large', label: 'Large', maxKg: 30, price: 45 },
      { id: 'xl', label: 'XL / rural', maxKg: 999, price: 65 },
    ],
  },
  leadTimes: ['3–5 days', '1–2 weeks', '2–3 weeks', '3–4 weeks'],
  paymentTerms: [
    'Credit card payment portal',
    'Invoice 7 days',
    'Invoice 14 days',
    '50% deposit, balance on completion',
  ],
  cortenKgPerM2: 23.55,
  print: {
    companyName: 'CORTEN LIVING',
    tagline: 'Profile-cut 3 mm Corten · Made in Gisborne, NZ',
    contact: '027 383 8178 · cortenliving@gmail.com\nGisborne, New Zealand',
    intro:
      'Thank you for your enquiry. This quote is for custom laser-cut 3 mm Corten steel as described below.',
    footer:
      'Prices in NZD. This quote is valid for the period stated unless withdrawn earlier. Payment terms as listed.',
    showSize: true,
    showLeadTime: true,
    showPaymentTerms: true,
    showWeight: false,
    showLogo: true,
    showProfile: true,
  },
  invoice: {
    title: 'TAX INVOICE',
    dueDays: 7,
    gstNumber: '',
    logoUrl: '/images/logo.svg',
    fromAddress:
      'Corten Living\n21A Cameron Road, Makauri\nGisborne 4071, New Zealand\n027 383 8178 · cortenliving@gmail.com',
    bankDetails:
      'Payment details\nPay to: Corten Living\nBank: (your bank)\nAccount: 00-0000-0000000-00\nReference: invoice number',
    notes:
      'Payment is due by the date shown. Goods remain the property of Corten Living until paid in full. Prices in NZD.',
  },
};

export async function onRequestOptions() {
  return handleOptions();
}

export async function onRequestGet(context) {
  try {
    const data = await getJsonFilePublic(context.env, FILE);
    const settings = data && typeof data === 'object' ? { ...DEFAULTS, ...data } : DEFAULTS;
    return json({ settings }, 200, { 'Cache-Control': 'private, max-age=10' });
  } catch (e) {
    return json({ settings: DEFAULTS, error: String(e.message || e) }, 200);
  }
}

export async function onRequestPut(context) {
  const auth = checkAdmin(context.request, context.env);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  const gh = requireGithub(context.env);
  if (!gh.ok) return json({ error: gh.error }, gh.status);

  try {
    const body = await context.request.json();
    const settings = body.settings || body;
    if (!settings || typeof settings !== 'object') {
      return json({ error: 'Invalid settings' }, 400);
    }
    settings.updatedAt = new Date().toISOString();
    await putJsonFile(context.env, FILE, settings, 'Admin: update quote settings');
    return json({ ok: true, settings, storage: 'github' });
  } catch (e) {
    return json({ error: String(e.message || e) }, 500);
  }
}
