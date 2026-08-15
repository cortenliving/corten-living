import { json, handleOptions, checkAdmin } from '../../lib/auth.js';
import { getJsonFilePublic, putJsonFile, requireGithub } from '../../lib/github-store.js';

const FILE = 'data/privacy-settings.json';

const DEFAULT_CONFIG = {
  enabled: true,
  currency: 'NZD',
  materials: [
    { id: 'corten', label: 'Corten steel', enabled: true, adder: 0 },
    { id: 'aluminium', label: 'Aluminium', enabled: true, adder: 40 },
  ],
  thicknesses: [
    { id: '1.6', label: '1.6 mm', mm: 1.6, enabled: true, adder: 0 },
    { id: '2.5', label: '2.5 mm', mm: 2.5, enabled: true, adder: 25 },
    { id: '3', label: '3 mm', mm: 3, enabled: true, adder: 45 },
  ],
  powdercoat: {
    enabled: true,
    label: 'Powder coated (Dulux)',
    price: 85,
    note: 'Powder coating available on aluminium (and corten if requested). Colours are Dulux powdercoat range.',
    allowOnCorten: true,
    colours: [
      { id: 'ebony', label: 'Ebony', enabled: true },
      { id: 'grey-friars', label: 'Grey Friars', enabled: true },
      { id: 'ironsand', label: 'Ironsand', enabled: true },
      { id: 'flaxpod', label: 'FlaxPod', enabled: true },
      { id: 'karaka', label: 'Karaka', enabled: true },
      { id: 'sandstone-grey', label: 'Sandstone Grey', enabled: true },
      { id: 'thunder-grey', label: 'Thunder Grey', enabled: true },
      { id: 'windsor-grey', label: 'Windsor Grey', enabled: true },
      { id: 'titania', label: 'Titania', enabled: true },
      { id: 'desert-sand', label: 'Desert Sand', enabled: true },
      { id: 'lichen', label: 'Lichen', enabled: true },
      { id: 'mist-green', label: 'Mist Green', enabled: true },
      { id: 'permanent-green', label: 'Permanent Green', enabled: true },
      { id: 'new-denim-blue', label: 'New Denim Blue', enabled: true },
      { id: 'pioneer-red', label: 'Pioneer Red', enabled: true },
      { id: 'matt-charcoal', label: 'Matt Charcoal', enabled: true },
      { id: 'white', label: 'White', enabled: true },
      { id: 'black', label: 'Black', enabled: true },
    ],
  },
  sizes: [
    { id: 'sz-1200x600', label: 'Compact', size: '1200 × 600 mm', price: 320, enabled: true },
    { id: 'sz-1500x750', label: 'Medium', size: '1500 × 750 mm', price: 420, enabled: true },
    { id: 'sz-1800x900', label: 'Standard', size: '1800 × 900 mm', price: 520, enabled: true },
    { id: 'sz-1800x1200', label: 'Wide', size: '1800 × 1200 mm', price: 640, enabled: true },
    { id: 'sz-custom', label: 'Custom size', size: 'Custom — we will confirm', price: 0, enabled: true, quoteOnly: true },
  ],
  defaultMaterial: 'corten',
  defaultThickness: '3',
  defaultFinish: 'raw',
};

export async function onRequestOptions() {
  return handleOptions();
}

function mergeConfig(raw) {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_CONFIG };
  return {
    ...DEFAULT_CONFIG,
    ...raw,
    materials: Array.isArray(raw.materials) ? raw.materials : DEFAULT_CONFIG.materials,
    thicknesses: Array.isArray(raw.thicknesses) ? raw.thicknesses : DEFAULT_CONFIG.thicknesses,
    sizes: Array.isArray(raw.sizes) ? raw.sizes : DEFAULT_CONFIG.sizes,
    powdercoat: {
      ...DEFAULT_CONFIG.powdercoat,
      ...(raw.powdercoat || {}),
      colours: Array.isArray(raw.powdercoat?.colours)
        ? raw.powdercoat.colours
        : DEFAULT_CONFIG.powdercoat.colours,
    },
  };
}

/** Public read — product page + shop */
export async function onRequestGet(context) {
  try {
    const data = await getJsonFilePublic(context.env, FILE);
    const config = mergeConfig(data);
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
    const incoming = body.config || body;
    if (!incoming || typeof incoming !== 'object') {
      return json({ error: 'Invalid privacy settings' }, 400);
    }
    const config = mergeConfig(incoming);
    config.updatedAt = new Date().toISOString();
    await putJsonFile(
      context.env,
      FILE,
      config,
      'Admin: update privacy screen pricing'
    );
    return json({ ok: true, config, storage: 'github' });
  } catch (e) {
    return json({ error: String(e.message || e) }, 500);
  }
}
