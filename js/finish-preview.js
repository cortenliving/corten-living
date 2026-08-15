/**
 * Live finish preview — recolour product photos for Corten / powdercoat.
 * Same-origin images only (canvas read). Caches results per src+colour.
 */

/** Approximate Dulux powdercoat / finish colours for on-screen preview */
const FINISH_PREVIEW_COLOURS = {
  // Materials
  corten: '#C45A28',
  aluminium: '#A8B0B8',
  // Dulux-style powdercoat (approx brand hues for preview)
  ebony: '#1A1A1A',
  'grey-friars': '#4A4F52',
  ironsand: '#3D3835',
  flaxpod: '#5C5346',
  karaka: '#2F4A28',
  'sandstone-grey': '#8A857C',
  'thunder-grey': '#5C5E62',
  'windsor-grey': '#6B6E71',
  titania: '#D6D2C4',
  'desert-sand': '#C4A882',
  lichen: '#7A8B6F',
  'mist-green': '#8FA08A',
  'permanent-green': '#2E5A3C',
  'new-denim-blue': '#3A5169',
  'pioneer-red': '#8B2E2A',
  'matt-charcoal': '#2C2C2C',
  white: '#F2F0EB',
  black: '#0D0D0D',
};

const _previewCache = new Map();
const _imgCache = new Map();

function hexToRgb(hex) {
  const h = String(hex || '').replace('#', '');
  if (h.length !== 6) return { r: 180, g: 90, b: 40 };
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

function resolveFinishHex(opts) {
  if (!opts) return FINISH_PREVIEW_COLOURS.corten;
  if (opts.hex) return opts.hex;
  if (opts.finish === 'powdercoat' && opts.colourId) {
    const id = String(opts.colourId).toLowerCase();
    if (FINISH_PREVIEW_COLOURS[id]) return FINISH_PREVIEW_COLOURS[id];
    // try match from cfg colours with hex field
    if (opts.colourHex) return opts.colourHex;
  }
  if (opts.materialId === 'aluminium' || opts.finish === 'raw' && opts.materialId === 'aluminium') {
    return FINISH_PREVIEW_COLOURS.aluminium;
  }
  if (opts.finish === 'raw' || opts.materialId === 'corten') {
    return FINISH_PREVIEW_COLOURS.corten;
  }
  return FINISH_PREVIEW_COLOURS.corten;
}

function loadImage(src) {
  if (_imgCache.has(src)) return _imgCache.get(src);
  const p = new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Image load failed'));
    img.src = src;
  });
  _imgCache.set(src, p);
  return p;
}

/**
 * Recolour metal pixels while keeping luminance (cut-out / photo detail).
 * Leaves near-white / near-transparent pixels alone.
 */
function colorizeImageData(imageData, hex) {
  const { r: tr, g: tg, b: tb } = hexToRgb(hex);
  const d = imageData.data;
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3];
    if (a < 12) continue;
    const r = d[i];
    const g = d[i + 1];
    const b = d[i + 2];
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    // Skip bright background / paper white
    const maxc = Math.max(r, g, b);
    const minc = Math.min(r, g, b);
    if (lum > 0.93 && maxc - minc < 28) continue;
    // Soften very light greys (photo background)
    if (lum > 0.88 && maxc - minc < 18) continue;

    // Preserve shading: darker areas stay darker
    let m = Math.pow(Math.max(0.08, lum), 0.78);
    // Slight contrast for powdercoat “paint” look
    m = Math.min(1.15, m * 1.05);
    d[i] = Math.min(255, Math.round(tr * m));
    d[i + 1] = Math.min(255, Math.round(tg * m));
    d[i + 2] = Math.min(255, Math.round(tb * m));
  }
  return imageData;
}

/**
 * Returns a data-URL of the recolored image (or original src on failure).
 */
async function colorizeImageSrc(src, hex, maxSide) {
  if (!src || !hex) return src;
  const key = src + '|' + hex + '|' + (maxSide || 0);
  if (_previewCache.has(key)) return _previewCache.get(key);

  const promise = (async () => {
    try {
      const img = await loadImage(src);
      let w = img.naturalWidth || img.width;
      let h = img.naturalHeight || img.height;
      if (!w || !h) return src;
      const cap = maxSide || 900;
      if (Math.max(w, h) > cap) {
        const s = cap / Math.max(w, h);
        w = Math.round(w * s);
        h = Math.round(h * s);
      }
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      const id = ctx.getImageData(0, 0, w, h);
      colorizeImageData(id, hex);
      ctx.putImageData(id, 0, 0);
      return canvas.toDataURL('image/jpeg', 0.88);
    } catch (_) {
      return src;
    }
  })();

  _previewCache.set(key, promise);
  return promise;
}

/**
 * Apply finish preview to an <img>. Stores original in data-preview-original.
 * opts: { finish, materialId, colourId, colourHex }
 */
async function applyFinishPreview(imgEl, opts) {
  if (!imgEl) return;
  const original =
    imgEl.getAttribute('data-preview-original') ||
    (imgEl.src && !imgEl.src.startsWith('data:') ? imgEl.src : '') ||
    '';
  if (original && !imgEl.getAttribute('data-preview-original')) {
    imgEl.setAttribute('data-preview-original', original);
  }
  const src = imgEl.getAttribute('data-preview-original') || original;
  if (!src) return;

  const hex = resolveFinishHex(opts);
  imgEl.style.opacity = '0.55';
  try {
    const out = await colorizeImageSrc(src, hex, 1000);
    // Only update if still the same original (user may have switched slides)
    if (imgEl.getAttribute('data-preview-original') === src || !imgEl.getAttribute('data-preview-original')) {
      imgEl.src = out;
    }
  } finally {
    imgEl.style.opacity = '1';
  }
}

function finishPreviewLabel(opts) {
  if (!opts) return '';
  if (opts.finish === 'powdercoat') {
    return 'Preview: Powdercoat' + (opts.colourLabel ? ' · ' + opts.colourLabel : '');
  }
  if (opts.materialId === 'aluminium') return 'Preview: Aluminium';
  return 'Preview: Corten steel';
}

/** Draw a simple post silhouette onto canvas and tint (fallback if no photo) */
function drawPostSilhouette(canvas, kind, hex) {
  const w = canvas.width;
  const h = canvas.height;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  // Background
  ctx.fillStyle = '#1a1410';
  ctx.fillRect(0, 0, w, h);
  const { r, g, b } = hexToRgb(hex);
  const grad = ctx.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, `rgb(${Math.min(255, r + 30)},${Math.min(255, g + 20)},${Math.min(255, b + 10)})`);
  grad.addColorStop(0.5, hex);
  grad.addColorStop(1, `rgb(${Math.max(0, r - 40)},${Math.max(0, g - 35)},${Math.max(0, b - 30)})`);
  ctx.fillStyle = grad;
  ctx.strokeStyle = `rgba(0,0,0,0.35)`;
  ctx.lineWidth = 2;

  const cx = w / 2;
  const postW = w * 0.14;
  const top = h * 0.08;
  const bottom = h * 0.88;
  // Main upright
  ctx.fillRect(cx - postW / 2, top, postW, bottom - top);
  ctx.strokeRect(cx - postW / 2, top, postW, bottom - top);

  // Decorative cut pattern (privacy-style slots)
  ctx.fillStyle = '#1a1410';
  const slots = 7;
  for (let i = 0; i < slots; i++) {
    const sy = top + (bottom - top) * (0.12 + i * 0.1);
    ctx.fillRect(cx - postW * 0.28, sy, postW * 0.56, 6);
  }

  if (kind === 'corner' || (kind && String(kind).includes('cor'))) {
    // Second leg for corner
    ctx.fillStyle = grad;
    ctx.fillRect(cx - postW / 2, top, postW, (bottom - top) * 0.55);
    ctx.save();
    ctx.translate(cx + postW / 2, top + postW / 2);
    ctx.rotate(Math.PI / 2);
    ctx.fillStyle = grad;
    ctx.fillRect(-postW / 2, 0, postW, (bottom - top) * 0.4);
    ctx.restore();
  }

  if (kind === 'flange' || (kind && kind.includes('fl'))) {
    // Base plate
    ctx.fillStyle = grad;
    ctx.fillRect(cx - postW * 1.6, bottom - 8, postW * 3.2, 14);
    ctx.strokeRect(cx - postW * 1.6, bottom - 8, postW * 3.2, 14);
    // Bolt holes
    ctx.fillStyle = '#1a1410';
    [[-1.2, -2], [1.2, -2], [-1.2, 6], [1.2, 6]].forEach(([dx, dy]) => {
      ctx.beginPath();
      ctx.arc(cx + postW * dx, bottom + dy, 3, 0, Math.PI * 2);
      ctx.fill();
    });
  } else {
    // Pointed tip for inground
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(cx - postW / 2, bottom);
    ctx.lineTo(cx + postW / 2, bottom);
    ctx.lineTo(cx, h * 0.96);
    ctx.closePath();
    ctx.fill();
  }
}

/**
 * Apply preview to a post card: use photo if data-post-photo set, else silhouette.
 */
async function applyPostPreview(containerEl, opts) {
  if (!containerEl) return;
  const hex = resolveFinishHex(opts);
  const img = containerEl.querySelector('[data-post-preview-img]');
  const canvas = containerEl.querySelector('[data-post-preview-canvas]');
  const label = containerEl.querySelector('[data-post-preview-label]');
  const photo = containerEl.getAttribute('data-post-photo') || opts.photoSrc || '';

  if (label) label.textContent = finishPreviewLabel(opts);

  if (photo && img) {
    img.classList.remove('hidden');
    if (canvas) canvas.classList.add('hidden');
    if (!img.getAttribute('data-preview-original')) {
      img.setAttribute('data-preview-original', photo);
      img.src = photo;
    }
    await applyFinishPreview(img, { ...opts, hex });
    return;
  }

  if (canvas) {
    if (img) img.classList.add('hidden');
    canvas.classList.remove('hidden');
    const kind = opts.postKind || opts.accessoryId || 'inground';
    drawPostSilhouette(canvas, kind, hex);
  }
}

if (typeof window !== 'undefined') {
  window.FINISH_PREVIEW_COLOURS = FINISH_PREVIEW_COLOURS;
  window.resolveFinishHex = resolveFinishHex;
  window.colorizeImageSrc = colorizeImageSrc;
  window.applyFinishPreview = applyFinishPreview;
  window.applyPostPreview = applyPostPreview;
  window.finishPreviewLabel = finishPreviewLabel;
  window.drawPostSilhouette = drawPostSilhouette;
}
