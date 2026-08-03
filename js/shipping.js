/**
 * Shipping calculator — weight tiers + standard/rural surcharge.
 */
(function (global) {
  const DEFAULT_SHIPPING = {
    enabled: true,
    label: 'NZ shipping',
    freeShippingOver: null,
    ruralSurcharge: 12,
    ruralLabel: 'Rural delivery surcharge',
    houseNumbers: {
      // ~3 mm Corten silhouette: more realistic g per character
      baseGramsPerChar: 80,
      gramsPerMmPerChar: 0.45,
      holesExtraGramsPerChar: 5,
    },
    // Fallback when product has no size dimensions
    defaultItemGrams: 1200,
    // 3 mm Corten ≈ 23.55 kg/m²; silhouette fill factor of bounding box
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

  function parseHeightMm(sizeStr) {
    if (sizeStr == null) return 200;
    if (typeof sizeStr === 'number') return sizeStr;
    const m = String(sizeStr).match(/(\d+)/);
    return m ? parseInt(m[1], 10) : 200;
  }

  /** Parse "500 × 600 mm" or "500x600" → { w, h } mm */
  function parseBoxMm(sizeStr) {
    const s = String(sizeStr || '');
    const m = s.match(/(\d+)\s*[×xX*]\s*(\d+)/);
    if (m) return { w: parseInt(m[1], 10), h: parseInt(m[2], 10) };
    const one = s.match(/(\d+)\s*mm/i) || s.match(/^(\d+)$/);
    if (one) {
      const n = parseInt(one[1], 10);
      return { w: n, h: n };
    }
    return null;
  }

  function parseChars(item) {
    if (item.charCount != null) return Math.max(1, Number(item.charCount) || 1);
    const s = String(item.chars || '').replace(/[^0-9A-Za-z]/g, '');
    return Math.max(1, s.length || 1);
  }

  function isHoles(item) {
    const m = String(item.mount || '').toLowerCase();
    return m.includes('hole') || m.includes('drill') || m === 'holes';
  }

  /** Only true house-number line items — NOT every product that has a size field */
  function isHouseNumbers(item) {
    if (!item) return false;
    if (item.productId === 'house-numbers') return true;
    const t = String(item.type || '').toLowerCase();
    if (t.includes('house number')) return true;
    if (t === 'house numbers' || t === 'numbers') return true;
    // Configurator cart items use type "House Numbers"
    if (t.includes('house') && t.includes('number')) return true;
    return false;
  }

  function cortenSilhouetteGrams(widthMm, heightMm, cfg) {
    const kgPerM2 = Number(cfg.cortenKgPerM2) || DEFAULT_SHIPPING.cortenKgPerM2;
    const fill = Number(cfg.silhouetteFill) || DEFAULT_SHIPPING.silhouetteFill;
    const areaM2 = (Math.max(1, widthMm) * Math.max(1, heightMm)) / 1e6;
    const steelG = areaM2 * kgPerM2 * 1000 * fill;
    const pack = Number(cfg.packagingGrams) || DEFAULT_SHIPPING.packagingGrams;
    return Math.max(100, Math.round(steelG + pack));
  }

  function itemWeightGrams(item, cfg) {
    const c = cfg || DEFAULT_SHIPPING;
    const qty = Math.max(1, parseInt(item.qty, 10) || 1);
    if (item.weightGrams != null && Number(item.weightGrams) > 0) {
      return Number(item.weightGrams) * qty;
    }

    const hn = c.houseNumbers || DEFAULT_SHIPPING.houseNumbers;

    if (isHouseNumbers(item)) {
      const height = parseHeightMm(item.size);
      const chars = parseChars(item);
      // Approximate each character as height × (height * 0.55) silhouette
      const charW = height * 0.55;
      let per = cortenSilhouetteGrams(charW, height, c) * 0.85; // less packaging per char
      // Scale lightly with formula so admin knobs still matter
      const formula =
        (Number(hn.baseGramsPerChar) || 0) + height * (Number(hn.gramsPerMmPerChar) || 0);
      if (isHoles(item)) per += Number(hn.holesExtraGramsPerChar) || 0;
      // Blend silhouette estimate with formula (prefer heavier of the two for safe shipping)
      per = Math.max(per, formula);
      return Math.max(50, Math.round(per * chars)) * qty;
    }

    // Sculptures / signage / planters: use size box if present
    const box = parseBoxMm(item.size);
    if (box) {
      return cortenSilhouetteGrams(box.w, box.h, c) * qty;
    }

    // Label-only sizes like "Small" / "Medium" — scale default
    const label = String(item.chars || item.size || '').toLowerCase();
    const base = Number(c.defaultItemGrams) || DEFAULT_SHIPPING.defaultItemGrams;
    if (label.includes('small') || label === 'sm') return Math.round(base * 0.7) * qty;
    if (label.includes('large') || label === 'lg') return Math.round(base * 1.45) * qty;
    return base * qty;
  }

  function cartWeightKg(items, cfg) {
    const list = Array.isArray(items) ? items : [];
    const grams = list.reduce((s, it) => s + itemWeightGrams(it, cfg), 0);
    return grams / 1000;
  }

  function tierPrice(weightKg, cfg) {
    const tiers = [...((cfg && cfg.tiers) || DEFAULT_SHIPPING.tiers)].sort(
      (a, b) => Number(a.maxWeightKg) - Number(b.maxWeightKg)
    );
    for (const t of tiers) {
      if (weightKg <= Number(t.maxWeightKg)) return Number(t.price) || 0;
    }
    return tiers.length ? Number(tiers[tiers.length - 1].price) || 0 : 0;
  }

  /**
   * @param {object} options
   * @param {boolean} [options.rural]
   */
  function calculateShipping(items, subtotal, cfg, options = {}) {
    const c = cfg && typeof cfg === 'object' ? { ...DEFAULT_SHIPPING, ...cfg } : DEFAULT_SHIPPING;
    if (cfg && cfg.houseNumbers) {
      c.houseNumbers = { ...DEFAULT_SHIPPING.houseNumbers, ...cfg.houseNumbers };
    }
    const sub = Number(subtotal) || 0;
    const weightKg = cartWeightKg(items, c);
    const weightGrams = Math.round(weightKg * 1000);
    const enabled = c.enabled !== false;
    const rural = !!options.rural;
    const ruralSurcharge = Number(c.ruralSurcharge) || 0;

    const base = {
      weightKg: Math.round(weightKg * 1000) / 1000,
      weightGrams,
      subtotal: sub,
      rural,
      baseShipping: 0,
      ruralSurcharge: 0,
      deliveryType: rural ? 'rural' : 'standard',
    };

    if (!enabled) {
      return {
        ...base,
        enabled: false,
        label: c.label || 'Shipping',
        shipping: 0,
        freeShipping: false,
        total: sub,
        breakdown: (items || []).map((it) => ({
          label: `${it.type || 'Item'} ${it.chars || ''}`.trim(),
          grams: itemWeightGrams(it, c),
        })),
      };
    }

    let baseShipping = tierPrice(weightKg, c);
    let freeShipping = false;
    const threshold = c.freeShippingOver;
    if (threshold != null && threshold !== '' && sub >= Number(threshold)) {
      baseShipping = 0;
      freeShipping = true;
    }

    let ruralExtra = 0;
    if (rural && ruralSurcharge > 0) {
      ruralExtra = ruralSurcharge;
    }

    const shipping = baseShipping + ruralExtra;
    let label = c.label || 'NZ shipping';
    if (rural) label = (c.label || 'NZ shipping') + ' (rural)';

    return {
      enabled: true,
      label,
      weightKg: base.weightKg,
      weightGrams,
      baseShipping,
      ruralSurcharge: ruralExtra,
      shipping,
      subtotal: sub,
      freeShipping,
      rural,
      deliveryType: rural ? 'rural' : 'standard',
      total: sub + shipping,
      breakdown: (items || []).map((it) => ({
        label: `${it.type || 'Item'}${it.chars ? ' ' + it.chars : ''}${it.size ? ' · ' + it.size : ''}`.trim(),
        grams: itemWeightGrams(it, c),
      })),
    };
  }

  let cachedConfig = null;

  async function loadShippingConfig() {
    try {
      const res = await fetch('/api/shipping', { headers: { Accept: 'application/json' } });
      if (res.ok) {
        const data = await res.json();
        if (data && data.config) {
          cachedConfig = data.config;
          return cachedConfig;
        }
      }
    } catch (_) {}
    cachedConfig = DEFAULT_SHIPPING;
    return cachedConfig;
  }

  function getCachedConfig() {
    return cachedConfig || DEFAULT_SHIPPING;
  }

  global.CortenShipping = {
    DEFAULT_SHIPPING,
    parseHeightMm,
    parseBoxMm,
    isHouseNumbers,
    itemWeightGrams,
    cartWeightKg,
    calculateShipping,
    loadShippingConfig,
    getCachedConfig,
  };
})(typeof window !== 'undefined' ? window : globalThis);
