/**
 * Privacy screen configurator — pricing & options (shared by shop + product page).
 * Admin edits live in data/privacy-settings.json via /api/privacy-settings.
 */

const PRIVACY_SETTINGS_KEY = 'cortenPrivacySettings';

function defaultPrivacyConfig() {
  return {
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
      note: 'Powder coating available. Colours from the Dulux powdercoat range.',
      allowOnCorten: true,
      colours: [
        { id: 'ebony', label: 'Ebony', enabled: true, hex: '#1A1A1A' },
        { id: 'grey-friars', label: 'Grey Friars', enabled: true, hex: '#4A4F52' },
        { id: 'ironsand', label: 'Ironsand', enabled: true, hex: '#3D3835' },
        { id: 'flaxpod', label: 'FlaxPod', enabled: true, hex: '#5C5346' },
        { id: 'karaka', label: 'Karaka', enabled: true, hex: '#2F4A28' },
        { id: 'sandstone-grey', label: 'Sandstone Grey', enabled: true, hex: '#8A857C' },
        { id: 'thunder-grey', label: 'Thunder Grey', enabled: true, hex: '#5C5E62' },
        { id: 'windsor-grey', label: 'Windsor Grey', enabled: true, hex: '#6B6E71' },
        { id: 'titania', label: 'Titania', enabled: true, hex: '#D6D2C4' },
        { id: 'desert-sand', label: 'Desert Sand', enabled: true, hex: '#C4A882' },
        { id: 'lichen', label: 'Lichen', enabled: true, hex: '#7A8B6F' },
        { id: 'mist-green', label: 'Mist Green', enabled: true, hex: '#8FA08A' },
        { id: 'permanent-green', label: 'Permanent Green', enabled: true, hex: '#2E5A3C' },
        { id: 'new-denim-blue', label: 'New Denim Blue', enabled: true, hex: '#3A5169' },
        { id: 'pioneer-red', label: 'Pioneer Red', enabled: true, hex: '#8B2E2A' },
        { id: 'matt-charcoal', label: 'Matt Charcoal', enabled: true, hex: '#2C2C2C' },
        { id: 'white', label: 'White', enabled: true, hex: '#F2F0EB' },
        { id: 'black', label: 'Black', enabled: true, hex: '#0D0D0D' },
      ],
    },
    sizes: [
      { id: 'sz-1200x600', label: 'Compact', size: '1200 × 600 mm', price: 320, enabled: true },
      { id: 'sz-1500x750', label: 'Medium', size: '1500 × 750 mm', price: 420, enabled: true },
      { id: 'sz-1800x900', label: 'Standard', size: '1800 × 900 mm', price: 520, enabled: true },
      { id: 'sz-1800x1200', label: 'Wide', size: '1800 × 1200 mm', price: 640, enabled: true },
      { id: 'sz-custom', label: 'Custom size', size: 'Custom — we will confirm', price: 0, enabled: true, quoteOnly: true },
    ],
    /** Optional posts sold with each panel (no mounting brackets). Posts are powdercoat only. */
    accessories: [
      {
        id: 'inground-post',
        name: 'Inground Fence Post - Soft Ground',
        enabled: true,
        price: 149,
        note: 'Powder coated only (Dulux colours). For soft ground / fence runs.',
        variants: [
          { id: 'ig-1200-end', label: '1200/1650 mm / Powder Coated / End Post', enabled: true },
          { id: 'ig-1200-mid', label: '1200/1650 mm / Powder Coated / Middle Post', enabled: true },
          { id: 'ig-1200-cor', label: '1200/1650 mm / Powder Coated / Corner Post', enabled: true },
          { id: 'ig-1500-end', label: '1500/2100 mm / Powder Coated / End Post', enabled: true },
          { id: 'ig-1500-mid', label: '1500/2100 mm / Powder Coated / Middle Post', enabled: true },
          { id: 'ig-1500-cor', label: '1500/2100 mm / Powder Coated / Corner Post', enabled: true },
          { id: 'ig-1800-end', label: '1800/2400 mm / Powder Coated / End Post', enabled: true },
          { id: 'ig-1800-mid', label: '1800/2400 mm / Powder Coated / Middle Post', enabled: true },
          { id: 'ig-1800-cor', label: '1800/2400 mm / Powder Coated / Corner Post', enabled: true },
        ],
      },
      {
        id: 'flange-post',
        name: 'Flange Mounted Fence Post - Deck & Patio',
        enabled: true,
        price: 169,
        note: 'Powder coated only (Dulux colours). Flange base for deck / patio mounting.',
        variants: [
          { id: 'fl-1200-end', label: '1200 mm (65 × 65 mm) / Powder Coated / End Post', enabled: true },
          { id: 'fl-1200-mid', label: '1200 mm (65 × 65 mm) / Powder Coated / Middle Post', enabled: true },
          { id: 'fl-1200-cor', label: '1200 mm (65 × 65 mm) / Powder Coated / Corner Post', enabled: true },
          { id: 'fl-1500-end', label: '1500 mm (65 × 65 mm) / Powder Coated / End Post', enabled: true },
          { id: 'fl-1500-mid', label: '1500 mm (65 × 65 mm) / Powder Coated / Middle Post', enabled: true },
          { id: 'fl-1500-cor', label: '1500 mm (65 × 65 mm) / Powder Coated / Corner Post', enabled: true },
          { id: 'fl-1800-end', label: '1800 mm (75 × 75 mm) / Powder Coated / End Post', enabled: true },
          { id: 'fl-1800-mid', label: '1800 mm (75 × 75 mm) / Powder Coated / Middle Post', enabled: true },
          { id: 'fl-1800-cor', label: '1800 mm (75 × 75 mm) / Powder Coated / Corner Post', enabled: true },
        ],
      },
    ],
    defaultMaterial: 'corten',
    defaultThickness: '3',
    defaultFinish: 'raw',
  };
}

function enabledList(arr) {
  return (arr || []).filter((x) => x && x.enabled !== false);
}

/**
 * Price = size base + material adder + thickness adder + powdercoat price (if coated)
 */
function calcPrivacyPrice(cfg, selection) {
  const c = cfg || defaultPrivacyConfig();
  const mat = (c.materials || []).find((m) => m.id === selection.materialId);
  const th = (c.thicknesses || []).find((t) => t.id === selection.thicknessId);
  const sz = (c.sizes || []).find((s) => s.id === selection.sizeId);
  if (!mat || !th || !sz) {
    return { unit: 0, quoteOnly: true, breakdown: {}, error: 'Incomplete selection' };
  }
  if (sz.quoteOnly || !(Number(sz.price) > 0)) {
    return {
      unit: 0,
      quoteOnly: true,
      breakdown: {
        size: 0,
        material: Number(mat.adder) || 0,
        thickness: Number(th.adder) || 0,
        powdercoat: 0,
      },
      size: sz,
      material: mat,
      thickness: th,
    };
  }
  const sizeP = Number(sz.price) || 0;
  const matP = Number(mat.adder) || 0;
  const thP = Number(th.adder) || 0;
  let pcP = 0;
  if (selection.finish === 'powdercoat' && c.powdercoat?.enabled !== false) {
    pcP = Number(c.powdercoat.price) || 0;
  }
  const unit = sizeP + matP + thP + pcP;
  return {
    unit,
    quoteOnly: false,
    breakdown: { size: sizeP, material: matP, thickness: thP, powdercoat: pcP },
    size: sz,
    material: mat,
    thickness: th,
  };
}

/** Lowest non-quote size + cheapest material/thickness, raw finish */
function privacyFromPrice(cfg) {
  const c = cfg || defaultPrivacyConfig();
  const sizes = enabledList(c.sizes).filter((s) => !s.quoteOnly && Number(s.price) > 0);
  const mats = enabledList(c.materials);
  const ths = enabledList(c.thicknesses);
  if (!sizes.length || !mats.length || !ths.length) return null;
  const minSize = Math.min(...sizes.map((s) => Number(s.price) || 0));
  const minMat = Math.min(...mats.map((m) => Number(m.adder) || 0));
  const minTh = Math.min(...ths.map((t) => Number(t.adder) || 0));
  return minSize + minMat + minTh;
}

function privacySelectionSummary(cfg, selection, calc) {
  const parts = [];
  if (calc?.material) parts.push(calc.material.label);
  if (calc?.thickness) parts.push(calc.thickness.label);
  if (selection.finish === 'powdercoat') {
    const col = (cfg?.powdercoat?.colours || []).find((x) => x.id === selection.colourId);
    parts.push('Powdercoat' + (col ? ': ' + col.label : ''));
  } else {
    parts.push('Raw / uncoated');
  }
  if (calc?.size) parts.push(calc.size.size || calc.size.label);
  return parts.join(' · ');
}

let _privacyCfgPromise = null;
let _privacyCfg = null;

async function loadPrivacySettings(force) {
  if (!force && _privacyCfg) return _privacyCfg;
  if (!force && _privacyCfgPromise) return _privacyCfgPromise;
  _privacyCfgPromise = (async () => {
    try {
      const res = await fetch('/api/privacy-settings', { headers: { Accept: 'application/json' } });
      if (res.ok) {
        const data = await res.json();
        if (data?.config) {
          _privacyCfg = data.config;
          try {
            sessionStorage.setItem(PRIVACY_SETTINGS_KEY, JSON.stringify(data.config));
          } catch (_) {}
          return _privacyCfg;
        }
      }
    } catch (_) {}
    try {
      const raw = sessionStorage.getItem(PRIVACY_SETTINGS_KEY);
      if (raw) {
        _privacyCfg = JSON.parse(raw);
        return _privacyCfg;
      }
    } catch (_) {}
    _privacyCfg = defaultPrivacyConfig();
    return _privacyCfg;
  })();
  return _privacyCfgPromise;
}

function isPrivacyProduct(p) {
  if (!p) return false;
  if (String(p.category || '').toLowerCase() === 'privacy') return true;
  return String(p.id || '').startsWith('privacy-panel-');
}

// Browser globals
/** Enabled accessories with only enabled variants */
function getPrivacyAccessories(cfg) {
  const c = cfg || defaultPrivacyConfig();
  return (c.accessories || [])
    .filter((a) => a && a.enabled !== false)
    .map((a) => ({
      ...a,
      variants: (a.variants || []).filter((v) => v && v.enabled !== false),
    }))
    .filter((a) => a.variants.length > 0);
}

/**
 * accessoriesSel: { [accessoryId]: { on, variantId, colourId, qty } }
 * Returns { lines: [{ id, name, variant, colour, unit, qty, lineTotal }], total }
 */
function calcPrivacyAccessories(cfg, accessoriesSel) {
  const list = getPrivacyAccessories(cfg);
  const colours = enabledList(cfg?.powdercoat?.colours || []);
  const lines = [];
  let total = 0;
  for (const acc of list) {
    const sel = accessoriesSel && accessoriesSel[acc.id];
    if (!sel || !sel.on) continue;
    const qty = Math.max(1, Math.min(50, parseInt(sel.qty, 10) || 1));
    const variant =
      (acc.variants || []).find((v) => v.id === sel.variantId) || acc.variants[0];
    const col = colours.find((c) => c.id === sel.colourId) || colours[0];
    const unit = Number(acc.price) || 0;
    const lineTotal = unit * qty;
    total += lineTotal;
    lines.push({
      id: acc.id,
      name: acc.name,
      variantId: variant?.id || '',
      variantLabel: variant?.label || '',
      colourId: col?.id || '',
      colourLabel: col?.label || '',
      unit,
      qty,
      lineTotal,
    });
  }
  return { lines, total };
}

if (typeof window !== 'undefined') {
  window.defaultPrivacyConfig = defaultPrivacyConfig;
  window.calcPrivacyPrice = calcPrivacyPrice;
  window.privacyFromPrice = privacyFromPrice;
  window.privacySelectionSummary = privacySelectionSummary;
  window.loadPrivacySettings = loadPrivacySettings;
  window.isPrivacyProduct = isPrivacyProduct;
  window.enabledPrivacyList = enabledList;
  window.getPrivacyAccessories = getPrivacyAccessories;
  window.calcPrivacyAccessories = calcPrivacyAccessories;
}
