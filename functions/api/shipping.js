import { json, handleOptions, checkAdmin } from '../../lib/auth.js';
import { getJsonFilePublic, putJsonFile, requireGithub } from '../../lib/github-store.js';

const FILE = 'data/shipping.json';

const DEFAULT_CONFIG = {
  enabled: true,
  label: 'NZ shipping',
  currency: 'NZD',
  freeShippingOver: null,
  houseNumbers: {
    baseGramsPerChar: 20,
    gramsPerMmPerChar: 0.12,
    holesExtraGramsPerChar: 2,
  },
  defaultItemGrams: 500,
  tiers: [
    { maxWeightKg: 0.3, price: 9 },
    { maxWeightKg: 0.6, price: 12 },
    { maxWeightKg: 1.0, price: 16 },
    { maxWeightKg: 2.0, price: 24 },
    { maxWeightKg: 5.0, price: 35 },
    { maxWeightKg: 999, price: 55 },
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
    config.updatedAt = new Date().toISOString();
    await putJsonFile(context.env, FILE, config, 'Admin: update shipping rates');
    return json({ ok: true, config, storage: 'github' });
  } catch (e) {
    return json({ error: String(e.message || e) }, 500);
  }
}
