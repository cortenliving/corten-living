/**
 * Quote costing: material + laser + setup + freight → sell price at target margin.
 */
(function (global) {
  function money(n) {
    return Math.round((Number(n) || 0) * 100) / 100;
  }

  function defaultSettings() {
    return {
      gstRate: 0.15,
      defaultMarginPercent: 35,
      material: { ratePerM2: 95, silhouetteFill: 0.32 },
      laser: { ratePerMetre: 2.8, minCharge: 12 },
      setup: { amount: 28 },
      freight: {
        tiers: [
          { id: 'small', label: 'Small', maxKg: 2, price: 15 },
          { id: 'medium', label: 'Medium', maxKg: 10, price: 25 },
          { id: 'large', label: 'Large', maxKg: 30, price: 45 },
          { id: 'xl', label: 'XL / rural', maxKg: 999, price: 65 },
        ],
      },
      cortenKgPerM2: 23.55,
    };
  }

  function itemMetrics(item, settings) {
    const s = settings || defaultSettings();
    const qty = Math.max(1, parseInt(item.qty, 10) || 1);
    const w = Number(item.widthMm) || 0;
    const h = Number(item.heightMm) || 0;
    const cutMm = Number(item.cutLengthMm) || 0;
    const fill = Number(s.material?.silhouetteFill) || 0.32;
    const kgPerM2 = Number(s.cortenKgPerM2) || 23.55;
    // Bounding box area (plate) and solid part area (silhouette)
    const plateM2 = (w * h) / 1e6;
    const solidM2 = plateM2 * fill;
    const cutM = cutMm / 1000;
    // 3 mm Corten ≈ kgPerM2 for solid plate
    const weightKg = solidM2 * kgPerM2 * qty;
    const plateWeightKg = plateM2 * kgPerM2 * qty;
    return {
      qty,
      areaM2: solidM2 * qty,
      plateAreaM2: plateM2 * qty,
      cutM: cutM * qty,
      weightKg,
      plateWeightKg,
      widthMm: w,
      heightMm: h,
      fill,
      kgPerM2,
      thicknessMm: 3,
    };
  }

  function calcMaterial(items, settings) {
    const rate = Number(settings.material?.ratePerM2) || 0;
    let total = 0;
    (items || []).forEach((it) => {
      const m = itemMetrics(it, settings);
      total += m.areaM2 * rate;
    });
    return money(total);
  }

  function calcLaser(items, settings) {
    const rate = Number(settings.laser?.ratePerMetre) || 0;
    const minC = Number(settings.laser?.minCharge) || 0;
    let total = 0;
    (items || []).forEach((it) => {
      const m = itemMetrics(it, settings);
      total += m.cutM * rate;
    });
    if (total > 0 && total < minC) total = minC;
    return money(total);
  }

  function totalWeightKg(items, settings) {
    return (items || []).reduce((s, it) => s + itemMetrics(it, settings).weightKg, 0);
  }

  function pickFreightTier(weightKg, settings) {
    const tiers = settings.freight?.tiers || defaultSettings().freight.tiers;
    const sorted = [...tiers].sort((a, b) => Number(a.maxKg) - Number(b.maxKg));
    for (const t of sorted) {
      if (weightKg <= Number(t.maxKg)) return t;
    }
    return sorted[sorted.length - 1] || { id: 'small', label: 'Small', price: 15 };
  }

  /**
   * @param {object} opts
   * @param {Array} opts.items
   * @param {object} opts.settings
   * @param {number} [opts.marginPercent]
   * @param {object} [opts.overrides] { material, laser, setup, freight }
   * @param {string} [opts.freightId]
   * @param {boolean} [opts.gstOn]
   */
  function calculateQuote(opts) {
    const settings = { ...defaultSettings(), ...(opts.settings || {}) };
    if (opts.settings?.material) {
      settings.material = { ...defaultSettings().material, ...opts.settings.material };
    }
    if (opts.settings?.laser) {
      settings.laser = { ...defaultSettings().laser, ...opts.settings.laser };
    }
    if (opts.settings?.setup) {
      settings.setup = { ...defaultSettings().setup, ...opts.settings.setup };
    }
    if (opts.settings?.freight) {
      settings.freight = { ...defaultSettings().freight, ...opts.settings.freight };
    }

    const items = opts.items || [];
    const autoMaterial = calcMaterial(items, settings);
    const autoLaser = calcLaser(items, settings);
    const autoSetup = items.length ? Number(settings.setup?.amount) || 0 : 0;
    const weightKg = totalWeightKg(items, settings);
    const tier =
      (settings.freight?.tiers || []).find((t) => t.id === opts.freightId) ||
      pickFreightTier(weightKg, settings);
    const autoFreight = Number(tier?.price) || 0;

    const ov = opts.overrides || {};
    const material = ov.material != null ? money(ov.material) : autoMaterial;
    const laser = ov.laser != null ? money(ov.laser) : autoLaser;
    const setup = ov.setup != null ? money(ov.setup) : money(autoSetup);
    const freight = ov.freight != null ? money(ov.freight) : money(autoFreight);

    const costExcl = money(material + laser + setup + freight);
    const margin = Math.min(90, Math.max(0, Number(opts.marginPercent != null ? opts.marginPercent : settings.defaultMarginPercent) || 0));
    // Target margin on sell price: price = cost / (1 - margin/100)
    const denom = 1 - margin / 100;
    const priceExcl = denom > 0.05 ? money(costExcl / denom) : money(costExcl);
    const gstOn = opts.gstOn !== false;
    const gstRate = Number(settings.gstRate) || 0.15;
    const gst = gstOn ? money(priceExcl * gstRate) : 0;
    const priceIncl = money(priceExcl + gst);

    const plateWeightKg = (items || []).reduce(
      (s, it) => s + itemMetrics(it, settings).plateWeightKg,
      0
    );

    return {
      auto: {
        material: autoMaterial,
        laser: autoLaser,
        setup: money(autoSetup),
        freight: money(autoFreight),
        freightTier: tier,
        weightKg: money(weightKg),
        plateWeightKg: money(plateWeightKg),
      },
      costings: { material, laser, setup, freight },
      costExcl,
      marginPercent: margin,
      priceExcl,
      gst,
      gstOn,
      gstRate,
      priceIncl,
      freightTier: tier,
      weightKg: money(weightKg),
      plateWeightKg: money(plateWeightKg),
      thicknessMm: 3,
      cortenKgPerM2: Number(settings.cortenKgPerM2) || 23.55,
    };
  }

  global.QuoteCost = {
    money,
    defaultSettings,
    itemMetrics,
    calcMaterial,
    calcLaser,
    pickFreightTier,
    calculateQuote,
  };
})(typeof window !== 'undefined' ? window : globalThis);
