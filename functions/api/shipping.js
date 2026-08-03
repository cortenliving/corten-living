import { json, handleOptions, checkAdmin } from '../../lib/auth.js';
import { getJsonFilePublic, putJsonFile, requireGithub } from '../../lib/github-store.js';

const FILE = 'data/shipping.json';

const DEFAULT_CONFIG = {
  enabled: true,
  label: 'NZ shipping',
  currency: 'NZD',
  freeShippingOver: null,
  ruralSurcharge: 12,
  ruralLabel: 'Rural delivery surcharge',
  houseNumbers: {
    baseGramsPerChar: 80,
    gramsPerMmPerChar: 0.45,
    holesExtraGramsPerChar: 5,
  },
  defaultItemGrams: 1200,
  cortenKgPerM2: 23.55,
  silhouetteFill: 0.32,
  packagingGrams: 200,
  tiers: [
    { maxWeightKg: 0.5, price: 9 },
    { maxWeightKg: 1.0, price: 12 },
    { maxWeightKg: 2.0, price: 16 },
    { maxWeightKg: 5.0, price: 24 },
    { maxWeightKg: 10.0, price: 35 },
    { maxWeightKg: 20.0, price: 45 },
    { maxWeightKg: 999, price: 65 },
  ],
};

export async function onRequestOptions() {
  return handleOptions();
}

/** Public read — cart uses this */
export async function onRequestGet(context) {
  try {
    const data = await getJsonFilePublic(context.env, FILE);
    const config = data && typeof data === 'object' ? { ...DEFAULT_CONFIG, ...data } : DEFAULT_CONFIG;
    return json({ config }, 200, { 'Cache-Control': 'public, max-age=30' });
  } catch (e) {
    return json({ config: DEFAULT_CONFIG, error: String(e.message || e) }, 200);
  }
}

/** Admin save */
export async function onRequestPut(context) {
  const auth = checkAdmin(context.request, context.env);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  const gh = requireGithub(context.env);
  if (!gh.ok) return json({ error: gh.error }, gh.status);

  try {
    const body = await context.request.json();
    const config = body.config || body;
    if (!config || typeof config !== 'object') {
      return json({ error: 'Invalid shipping config' }, 400);
    }
    // Normalise tiers
    if (Array.isArray(config.tiers)) {
      config.tiers = config.tiers
        .map((t) => ({
          maxWeightKg: Number(t.maxWeightKg),
          price: Number(t.price),
        }))
        .filter((t) => Number.isFinite(t.maxWeightKg) && Number.isFinite(t.price))
        .sort((a, b) => a.maxWeightKg - b.maxWeightKg);
    }
    if (config.houseNumbers) {
      config.houseNumbers = {
        baseGramsPerChar: Number(config.houseNumbers.baseGramsPerChar) || 0,
        gramsPerMmPerChar: Number(config.houseNumbers.gramsPerMmPerChar) || 0,
        holesExtraGramsPerChar: Number(config.houseNumbers.holesExtraGramsPerChar) || 0,
        note: config.houseNumbers.note || '',
      };
    }
    if (config.ruralSurcharge != null) {
      config.ruralSurcharge = Number(config.ruralSurcharge) || 0;
    }
    if (config.defaultItemGrams != null) {
      config.defaultItemGrams = Number(config.defaultItemGrams) || DEFAULT_CONFIG.defaultItemGrams;
    }
    if (config.cortenKgPerM2 != null) {
      config.cortenKgPerM2 = Number(config.cortenKgPerM2) || DEFAULT_CONFIG.cortenKgPerM2;
    }
    if (config.silhouetteFill != null) {
      const f = Number(config.silhouetteFill);
      config.silhouetteFill = Number.isFinite(f) ? Math.min(1, Math.max(0, f)) : DEFAULT_CONFIG.silhouetteFill;
    }
    if (config.packagingGrams != null) {
      config.packagingGrams = Number(config.packagingGrams) || 0;
    }
    config.updatedAt = new Date().toISOString();
    await putJsonFile(context.env, FILE, config, 'Admin: update shipping rates');
    return json({ ok: true, config, storage: 'github' });
  } catch (e) {
    return json({ error: String(e.message || e) }, 500);
  }
}
