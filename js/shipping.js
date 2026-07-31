/**
 * Shipping calculator — used by cart (browser).
 * Config from /api/shipping or defaults below.
 */
(function (global) {
  const DEFAULT_SHIPPING = {
    enabled: true,
    label: 'NZ shipping',
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

  function parseHeightMm(sizeStr) {
    if (sizeStr == null) return 200;
    if (typeof sizeStr === 'number') return sizeStr;
    const m = String(sizeStr).match(/(\d+)/);
    return m ? parseInt(m[1], 10) : 200;
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

  function isHouseNumbers(item) {
    const t = String(item.type || '').toLowerCase();
    return t.includes('house') || t.includes('number') || item.size;
  }

  /** Grams for one cart line (qty applied) */
  function itemWeightGrams(item, cfg) {
    const qty = Math.max(1, parseInt(item.qty, 10) || 1);
    if (item.weightGrams != null && Number(item.weightGrams) > 0) {
      return Number(item.weightGrams) * qty;
    }
    const hn = (cfg && cfg.houseNumbers) || DEFAULT_SHIPPING.houseNumbers;
    if (isHouseNumbers(item)) {
      const height = parseHeightMm(item.size);
      const chars = parseChars(item);
      let per = (Number(hn.baseGramsPerChar) || 0) + height * (Number(hn.gramsPerMmPerChar) || 0);
      if (isHoles(item)) per += Number(hn.holesExtraGramsPerChar) || 0;
      return Math.max(1, Math.round(per * chars)) * qty;
    }
    const d = Number((cfg && cfg.defaultItemGrams) || DEFAULT_SHIPPING.defaultItemGrams) || 500;
    return d * qty;
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
   * @returns {{ enabled, label, weightKg, weightGrams, shipping, subtotal, freeShipping, total, breakdown }}
   */
  function calculateShipping(items, subtotal, cfg) {
    const c = cfg && typeof cfg === 'object' ? cfg : DEFAULT_SHIPPING;
    const sub = Number(subtotal) || 0;
    const weightKg = cartWeightKg(items, c);
    const weightGrams = Math.round(weightKg * 1000);
    const enabled = c.enabled !== false;

    if (!enabled) {
      return {
        enabled: false,
        label: c.label || 'Shipping',
        weightKg,
        weightGrams,
        shipping: 0,
        subtotal: sub,
        freeShipping: false,
        total: sub,
        breakdown: items.map((it) => ({
          label: `${it.type || 'Item'} ${it.chars || ''}`.trim(),
          grams: itemWeightGrams(it, c),
        })),
      };
    }

    let shipping = tierPrice(weightKg, c);
    let freeShipping = false;
    const threshold = c.freeShippingOver;
    if (threshold != null && threshold !== '' && sub >= Number(threshold)) {
      shipping = 0;
      freeShipping = true;
    }

    return {
      enabled: true,
      label: c.label || 'NZ shipping',
      weightKg: Math.round(weightKg * 1000) / 1000,
      weightGrams,
      shipping,
      subtotal: sub,
      freeShipping,
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
    itemWeightGrams,
    cartWeightKg,
    calculateShipping,
    loadShippingConfig,
    getCachedConfig,
  };
})(typeof window !== 'undefined' ? window : globalThis);
