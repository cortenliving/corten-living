/**
 * Live finish preview — recolour cut-out panel photos for Corten / powdercoat.
 * Images are typically dark metal + light cutouts on white stage.
 */

/** Strong, clearly different preview colours */
const FINISH_PREVIEW_COLOURS = {
  // Materials — corten is bright rust-orange so it reads clearly
  corten: '#E8611A',
  aluminium: '#C5CCD3',
  // Dulux-style powdercoat (pushed for screen contrast)
  ebony: '#111111',
  'grey-friars': '#5A6166',
  ironsand: '#4A403A',
  flaxpod: '#6B5E4A',
  karaka: '#3D6B32',
  'sandstone-grey': '#A39E94',
  'thunder-grey': '#6E7278',
  'windsor-grey': '#7A7E82',
  titania: '#E8E4D6',
  'desert-sand': '#D4B48A',
  lichen: '#8A9B72',
  'mist-green': '#9BB094',
  'permanent-green': '#2F7A45',
  'new-denim-blue': '#3F6A8C',
  'pioneer-red': '#B83A34',
  'matt-charcoal': '#333333',
  white: '#F7F5F0',
  black: '#0A0A0A',
};

const PREVIEW_ALGO = 'v3';
const _previewCache = new Map();
const _imgCache = new Map();

function hexToRgb(hex) {
  const h = String(hex || '').replace('#', '');
  if (h.length !== 6) return { r: 232, g: 97, b: 26 };
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

function clamp(n) {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function resolveFinishHex(opts) {
  if (!opts) return FINISH_PREVIEW_COLOURS.corten;
  if (opts.hex) return opts.hex;
  if (opts.finish === 'powdercoat' && opts.colourId) {
    const id = String(opts.colourId).toLowerCase();
    if (opts.colourHex) return opts.colourHex;
    if (FINISH_PREVIEW_COLOURS[id]) return FINISH_PREVIEW_COLOURS[id];
  }
  if (opts.materialId === 'aluminium') return FINISH_PREVIEW_COLOURS.aluminium;
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
    // cache-bust relative paths so we always get a clean bitmap
    img.src = src;
  });
  _imgCache.set(src, p);
  return p;
}

/**
 * Recolour metal (dark) pixels to target finish; keep cut-outs bright/white.
 * Much stronger tint than luminance-only multiply so colours read clearly.
 */
function colorizeImageData(imageData, hex, isCorten) {
  const { r: tr, g: tg, b: tb } = hexToRgb(hex);
  const d = imageData.data;
  const n = d.length / 4;

  // Pass 1: find metal luminance range (ignore near-white cutouts)
  let minM = 1;
  let maxM = 0;
  let metalCount = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 12) continue;
    const lum = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
    if (lum >= 0.78) continue; // cutout / white
    metalCount++;
    if (lum < minM) minM = lum;
    if (lum > maxM) maxM = lum;
  }
  if (metalCount < 10) {
    minM = 0.05;
    maxM = 0.55;
  }
  const span = Math.max(0.12, maxM - minM);

  // Pass 2: recolour
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3];
    if (a < 12) continue;
    const r = d[i];
    const g = d[i + 1];
    const b = d[i + 2];
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    const maxc = Math.max(r, g, b);
    const minc = Math.min(r, g, b);

    // Cut-outs / white holes — pure white so they pop on white stage
    if (lum > 0.78 || (lum > 0.7 && maxc - minc < 25)) {
      d[i] = 255;
      d[i + 1] = 255;
      d[i + 2] = 255;
      continue;
    }

    // Metal: map original darkness → shade of target colour
    // t=0 darkest metal, t=1 lightest metal
    let t = (lum - minM) / span;
    t = Math.max(0, Math.min(1, t));
    // Keep visible midtones so colour shows (not near-black)
    // Corten: brighter overall, stronger orange midtones
    let shade;
    if (isCorten) {
      // 0.55–1.15 range — sharp bright rust
      shade = 0.55 + 0.6 * Math.pow(t, 0.7);
      // Boost red/orange channel a bit more
      d[i] = clamp(tr * shade * 1.08);
      d[i + 1] = clamp(tg * shade * 0.95);
      d[i + 2] = clamp(tb * shade * 0.75);
    } else {
      // Powdercoat / aluminium: 0.48–1.05 — solid paint look with light shading
      shade = 0.48 + 0.57 * Math.pow(t, 0.75);
      d[i] = clamp(tr * shade);
      d[i + 1] = clamp(tg * shade);
      d[i + 2] = clamp(tb * shade);
    }
  }
  return imageData;
}

async function colorizeImageSrc(src, hex, maxSide, isCorten) {
  if (!src || !hex) return src;
  const key = PREVIEW_ALGO + '|' + src + '|' + hex + '|' + (maxSide || 0) + '|' + (isCorten ? 'c' : 'p');
  if (_previewCache.has(key)) return _previewCache.get(key);

  const promise = (async () => {
    try {
      const img = await loadImage(src);
      let w = img.naturalWidth || img.width;
      let h = img.naturalHeight || img.height;
      if (!w || !h) return src;
      const cap = maxSide || 1000;
      if (Math.max(w, h) > cap) {
        const s = cap / Math.max(w, h);
        w = Math.round(w * s);
        h = Math.round(h * s);
      }
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      // White fill behind in case of transparency
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      const id = ctx.getImageData(0, 0, w, h);
      colorizeImageData(id, hex, !!isCorten);
      ctx.putImageData(id, 0, 0);
      return canvas.toDataURL('image/png');
    } catch (_) {
      return src;
    }
  })();

  _previewCache.set(key, promise);
  return promise;
}

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
  const isCorten =
    opts &&
    opts.finish !== 'powdercoat' &&
    (opts.materialId === 'corten' || !opts.materialId || opts.materialId !== 'aluminium');

  imgEl.style.opacity = '0.45';
  try {
    const out = await colorizeImageSrc(src, hex, 1000, isCorten);
    if (
      imgEl.getAttribute('data-preview-original') === src ||
      !imgEl.getAttribute('data-preview-original')
    ) {
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

function drawPostSilhouette(canvas, kind, hex) {
  const w = canvas.width;
  const h = canvas.height;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  const { r, g, b } = hexToRgb(hex);
  const grad = ctx.createLinearGradient(0, 0, w * 0.3, h);
  grad.addColorStop(0, `rgb(${clamp(r + 40)},${clamp(g + 25)},${clamp(b + 15)})`);
  grad.addColorStop(0.45, hex);
  grad.addColorStop(1, `rgb(${clamp(r * 0.55)},${clamp(g * 0.55)},${clamp(b * 0.55)})`);
  ctx.fillStyle = grad;
  ctx.strokeStyle = 'rgba(0,0,0,0.28)';
  ctx.lineWidth = 2;

  const cx = w / 2;
  const postW = w * 0.16;
  const top = h * 0.08;
  const bottom = h * 0.86;
  ctx.fillRect(cx - postW / 2, top, postW, bottom - top);
  ctx.strokeRect(cx - postW / 2, top, postW, bottom - top);

  ctx.fillStyle = '#ffffff';
  for (let i = 0; i < 7; i++) {
    const sy = top + (bottom - top) * (0.12 + i * 0.1);
    ctx.fillRect(cx - postW * 0.3, sy, postW * 0.6, 7);
  }

  if (kind === 'corner' || (kind && String(kind).includes('cor'))) {
    ctx.fillStyle = grad;
    ctx.fillRect(cx - postW / 2, top, postW, (bottom - top) * 0.55);
    ctx.save();
    ctx.translate(cx + postW / 2, top + postW / 2);
    ctx.rotate(Math.PI / 2);
    ctx.fillStyle = grad;
    ctx.fillRect(-postW / 2, 0, postW, (bottom - top) * 0.4);
    ctx.restore();
  }

  if (kind === 'flange' || (kind && String(kind).includes('fl'))) {
    ctx.fillStyle = grad;
    ctx.fillRect(cx - postW * 1.7, bottom - 10, postW * 3.4, 16);
    ctx.strokeRect(cx - postW * 1.7, bottom - 10, postW * 3.4, 16);
    ctx.fillStyle = '#ffffff';
    [
      [-1.25, -1],
      [1.25, -1],
      [-1.25, 8],
      [1.25, 8],
    ].forEach(([dx, dy]) => {
      ctx.beginPath();
      ctx.arc(cx + postW * dx, bottom + dy, 3.5, 0, Math.PI * 2);
      ctx.fill();
    });
  } else {
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(cx - postW / 2, bottom);
    ctx.lineTo(cx + postW / 2, bottom);
    ctx.lineTo(cx, h * 0.96);
    ctx.closePath();
    ctx.fill();
  }
}

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
