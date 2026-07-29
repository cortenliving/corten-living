/* Corten Living Admin — product & pricing manager */

const STORAGE_PRODUCTS = 'cortenAdminProducts';
const STORAGE_PUBLISHED = 'cortenProductsPublished';
const STORAGE_HN_PRICES = 'cortenHouseNumberPrices';
const STORAGE_SESSION = 'cortenAdminSession';
// Default password: CortenAdmin!  (change after first login via Settings)
const DEFAULT_PASS_HASH = '3c1db5a70bf6cf2ba4ebc27d48cd017c94bc623c3491fe2c2d7dcd4144f765ab';
const STORAGE_PASS_HASH = 'cortenAdminPassHash';

const DEFAULT_HN_PRICES = {
  100: { clean: { 1: 8, 2: 15, 3: 21 }, holes: { 1: 10, 2: 17, 3: 24 } },
  200: { clean: { 1: 15, 2: 28, 3: 42 }, holes: { 1: 17, 2: 32, 3: 46 } }
};

const CATEGORIES = [
  { value: 'sculpture', label: 'Sculpture' },
  { value: 'signage', label: 'Signage' },
  { value: 'numbers', label: 'Numbers' },
  { value: 'planter', label: 'Planter' },
  { value: 'other', label: 'Other' }
];

let catalogue = [];
let editingId = null;
let pendingImages = []; // base64 slides being added in form

async function sha256(text) {
  const data = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function getPassHash() {
  return localStorage.getItem(STORAGE_PASS_HASH) || DEFAULT_PASS_HASH;
}

function isLoggedIn() {
  return sessionStorage.getItem(STORAGE_SESSION) === '1';
}

function setLoggedIn(v) {
  if (v) sessionStorage.setItem(STORAGE_SESSION, '1');
  else sessionStorage.removeItem(STORAGE_SESSION);
}

function loadCatalogue() {
  try {
    const raw = localStorage.getItem(STORAGE_PRODUCTS);
    if (raw) {
      catalogue = JSON.parse(raw);
      return;
    }
  } catch (_) {}
  // Seed from live site products.js if available
  if (typeof window.products !== 'undefined' && Array.isArray(window.products)) {
    catalogue = JSON.parse(JSON.stringify(window.products));
  } else {
    catalogue = [];
  }
}

function saveCatalogue() {
  localStorage.setItem(STORAGE_PRODUCTS, JSON.stringify(catalogue));
  toast('Draft saved on this device');
  renderList();
}

function publishCatalogue() {
  localStorage.setItem(STORAGE_PUBLISHED, JSON.stringify(catalogue));
  localStorage.setItem(STORAGE_PRODUCTS, JSON.stringify(catalogue));
  toast('Published to this browser — Shop & Home will show updates here');
}

function loadHnPrices() {
  try {
    const raw = localStorage.getItem(STORAGE_HN_PRICES);
    if (raw) return JSON.parse(raw);
  } catch (_) {}
  return JSON.parse(JSON.stringify(DEFAULT_HN_PRICES));
}

function saveHnPrices(prices) {
  localStorage.setItem(STORAGE_HN_PRICES, JSON.stringify(prices));
  toast('House number pricing saved');
}

function toast(msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('opacity-0', 'pointer-events-none');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => {
    el.classList.add('opacity-0', 'pointer-events-none');
  }, 2800);
}

function slugify(str) {
  return String(str || 'product')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'product';
}

function uid() {
  return slugify(Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
}

/** Compress image file → JPEG data URL */
function compressImage(file, maxW = 1100, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let w = img.width;
      let h = img.height;
      if (w > maxW || h > maxW) {
        const r = Math.min(maxW / w, maxW / h);
        w = Math.round(w * r);
        h = Math.round(h * r);
      }
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read image'));
    };
    img.src = url;
  });
}

function productThumb(p) {
  const src = p.image || (p.slides && p.slides[0] && p.slides[0].src) || '';
  if (src) {
    return `<img src="${src}" alt="" class="w-14 h-14 object-cover rounded-sm bg-metal-950">`;
  }
  return `<div class="w-14 h-14 rounded-sm bg-metal-950 flex items-center justify-center text-corten-600 font-display text-lg">${(p.name || '?').charAt(0)}</div>`;
}

function renderList() {
  const list = document.getElementById('product-list');
  if (!list) return;
  if (!catalogue.length) {
    list.innerHTML = `<p class="text-gray-500 text-sm py-8 text-center">No products yet. Click <strong class="text-corten-400">Add product</strong>.</p>`;
    return;
  }
  list.innerHTML = catalogue.map((p, i) => `
    <div class="flex items-center gap-4 p-4 bg-metal-850 border border-corten-900/40 rounded-sm hover:border-corten-700/60 transition">
      ${productThumb(p)}
      <div class="flex-1 min-w-0">
        <div class="flex flex-wrap items-center gap-2">
          <p class="font-display text-white truncate">${escapeHtml(p.name)}</p>
          ${p.featured ? '<span class="text-[10px] uppercase bg-corten-600 text-white px-1.5 py-0.5 rounded-sm">Featured</span>' : ''}
          ${p.tag ? `<span class="text-[10px] text-corten-500">${escapeHtml(p.tag)}</span>` : ''}
        </div>
        <p class="text-xs text-gray-500 mt-0.5">${escapeHtml(p.category || '')} · ${escapeHtml(p.size || '')} · <span class="text-corten-400">${escapeHtml(p.priceLabel || ('$' + p.price))}</span></p>
      </div>
      <div class="flex items-center gap-1 shrink-0">
        <button type="button" data-move="${i}" data-dir="-1" class="move-btn p-2 text-gray-500 hover:text-white" title="Move up">↑</button>
        <button type="button" data-move="${i}" data-dir="1" class="move-btn p-2 text-gray-500 hover:text-white" title="Move down">↓</button>
        <button type="button" data-edit="${escapeHtml(p.id)}" class="edit-btn px-3 py-1.5 text-sm text-corten-400 hover:bg-corten-950/50 rounded-sm">Edit</button>
        <button type="button" data-del="${escapeHtml(p.id)}" class="del-btn px-3 py-1.5 text-sm text-gray-500 hover:text-red-400 rounded-sm">Delete</button>
      </div>
    </div>
  `).join('');

  list.querySelectorAll('.edit-btn').forEach((btn) => {
    btn.addEventListener('click', () => openEditor(btn.dataset.edit));
  });
  list.querySelectorAll('.del-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!confirm('Delete this product?')) return;
      catalogue = catalogue.filter((p) => p.id !== btn.dataset.del);
      saveCatalogue();
    });
  });
  list.querySelectorAll('.move-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const i = parseInt(btn.dataset.move, 10);
      const dir = parseInt(btn.dataset.dir, 10);
      const j = i + dir;
      if (j < 0 || j >= catalogue.length) return;
      const t = catalogue[i];
      catalogue[i] = catalogue[j];
      catalogue[j] = t;
      saveCatalogue();
    });
  });
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function openEditor(id) {
  editingId = id || null;
  pendingImages = [];
  const p = id ? catalogue.find((x) => x.id === id) : null;
  document.getElementById('editor-title').textContent = p ? 'Edit product' : 'Add product';
  document.getElementById('f-id').value = p?.id || '';
  document.getElementById('f-name').value = p?.name || '';
  document.getElementById('f-category').value = p?.category || 'sculpture';
  document.getElementById('f-size').value = p?.size || '';
  document.getElementById('f-price').value = p?.price ?? '';
  document.getElementById('f-priceLabel').value = p?.priceLabel || '';
  document.getElementById('f-tag').value = p?.tag || '';
  document.getElementById('f-desc').value = p?.desc || '';
  document.getElementById('f-link').value = p?.link || '';
  document.getElementById('f-featured').checked = !!p?.featured;
  document.getElementById('f-image').value = p?.image || '';

  // Existing slides
  const slides = p?.slides ? [...p.slides] : [];
  pendingImages = slides.map((s) => ({ src: s.src, label: s.label || '' }));
  renderSlidePreviews();

  document.getElementById('editor-panel').classList.remove('hidden');
  document.getElementById('list-panel').classList.add('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function closeEditor() {
  document.getElementById('editor-panel').classList.add('hidden');
  document.getElementById('list-panel').classList.remove('hidden');
  editingId = null;
}

function renderSlidePreviews() {
  const box = document.getElementById('slide-previews');
  if (!box) return;
  if (!pendingImages.length) {
    box.innerHTML = '<p class="text-xs text-gray-600">No photos yet — upload below.</p>';
    return;
  }
  box.innerHTML = pendingImages.map((s, i) => `
    <div class="relative group border border-corten-900/50 rounded-sm overflow-hidden">
      <img src="${s.src}" alt="" class="w-full aspect-square object-cover">
      <input type="text" data-slide-label="${i}" value="${escapeHtml(s.label)}" placeholder="Label"
        class="absolute bottom-0 inset-x-0 bg-black/70 text-[10px] text-white px-1 py-1 border-0 outline-none">
      <button type="button" data-slide-del="${i}" class="absolute top-1 right-1 bg-black/70 text-white text-xs w-6 h-6 rounded-sm opacity-80 hover:opacity-100">×</button>
    </div>
  `).join('');

  box.querySelectorAll('[data-slide-del]').forEach((btn) => {
    btn.addEventListener('click', () => {
      pendingImages.splice(parseInt(btn.dataset.slideDel, 10), 1);
      renderSlidePreviews();
    });
  });
  box.querySelectorAll('[data-slide-label]').forEach((inp) => {
    inp.addEventListener('change', () => {
      const i = parseInt(inp.dataset.slideLabel, 10);
      if (pendingImages[i]) pendingImages[i].label = inp.value;
    });
  });
}

function collectFormProduct() {
  const name = document.getElementById('f-name').value.trim();
  if (!name) {
    alert('Name is required');
    return null;
  }
  // Sync labels from inputs
  document.querySelectorAll('[data-slide-label]').forEach((inp) => {
    const i = parseInt(inp.dataset.slideLabel, 10);
    if (pendingImages[i]) pendingImages[i].label = inp.value;
  });

  let id = document.getElementById('f-id').value.trim() || slugify(name);
  if (!editingId) {
    // ensure unique
    let base = id;
    let n = 1;
    while (catalogue.some((p) => p.id === id)) {
      id = base + '-' + n++;
    }
  }

  const price = parseFloat(document.getElementById('f-price').value);
  let priceLabel = document.getElementById('f-priceLabel').value.trim();
  if (!priceLabel && !Number.isNaN(price)) {
    priceLabel = '$' + price;
  }

  let image = document.getElementById('f-image').value.trim();
  if (!image && pendingImages[0]) image = pendingImages[0].src;

  const linkRaw = document.getElementById('f-link').value.trim();
  const link = linkRaw || `/quote?product=${encodeURIComponent(name)}`;

  return {
    id,
    name,
    category: document.getElementById('f-category').value,
    size: document.getElementById('f-size').value.trim() || 'Various',
    price: Number.isNaN(price) ? 0 : price,
    priceLabel,
    desc: document.getElementById('f-desc').value.trim(),
    tag: document.getElementById('f-tag').value.trim(),
    featured: document.getElementById('f-featured').checked,
    link,
    image,
    slides: pendingImages.map((s) => ({ src: s.src, label: s.label || '' }))
  };
}

function saveProductFromForm() {
  const product = collectFormProduct();
  if (!product) return;
  const idx = catalogue.findIndex((p) => p.id === (editingId || product.id));
  if (editingId && idx >= 0) {
    catalogue[idx] = product;
  } else if (idx >= 0 && !editingId) {
    catalogue[idx] = product;
  } else {
    catalogue.push(product);
  }
  saveCatalogue();
  closeEditor();
}

/** Build products.js file content for deploy */
function buildProductsJs(list) {
  // Convert data-URL images to /images/ paths for deployable export
  const exportList = list.map((p) => {
    const copy = JSON.parse(JSON.stringify(p));
    const fileBase = slugify(p.id || p.name);
    if (copy.image && copy.image.startsWith('data:')) {
      copy.image = `/images/${fileBase}.jpg`;
    }
    if (copy.slides) {
      copy.slides = copy.slides.map((s, i) => {
        if (s.src && s.src.startsWith('data:')) {
          return { ...s, src: `/images/${fileBase}${i ? '-' + (i + 1) : ''}.jpg` };
        }
        return s;
      });
    }
    return copy;
  });

  return `// Corten Living product catalogue
// Generated by Admin — ${new Date().toISOString().slice(0, 10)}
const products = ${JSON.stringify(exportList, null, 2)};

// Expose for other scripts
window.products = products;
`;
}

function downloadText(filename, text, mime = 'text/javascript') {
  const blob = new Blob([text], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function dataUrlToBlob(dataUrl) {
  const [meta, b64] = dataUrl.split(',');
  const mime = (meta.match(/:(.*?);/) || [])[1] || 'image/jpeg';
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

async function downloadImages() {
  let count = 0;
  for (const p of catalogue) {
    const fileBase = slugify(p.id || p.name);
    if (p.image && p.image.startsWith('data:')) {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(dataUrlToBlob(p.image));
      a.download = `${fileBase}.jpg`;
      a.click();
      count++;
      await new Promise((r) => setTimeout(r, 200));
    }
    if (p.slides) {
      for (let i = 0; i < p.slides.length; i++) {
        const s = p.slides[i];
        if (s.src && s.src.startsWith('data:')) {
          const a = document.createElement('a');
          a.href = URL.createObjectURL(dataUrlToBlob(s.src));
          a.download = `${fileBase}${i ? '-' + (i + 1) : ''}.jpg`;
          a.click();
          count++;
          await new Promise((r) => setTimeout(r, 200));
        }
      }
    }
  }
  toast(count ? `Downloading ${count} image(s)… put them in the images/ folder` : 'No new uploaded images to download (paths only)');
}

function exportProductsJs() {
  saveCatalogue();
  const js = buildProductsJs(catalogue);
  downloadText('products.js', js);
  toast('Downloaded products.js — replace js/products.js in the repo and push');
}

function importProductsJson(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      let data = reader.result;
      // Accept raw JSON array or products.js content
      if (typeof data === 'string' && data.includes('const products')) {
        const m = data.match(/const products\s*=\s*(\[[\s\S]*?\]);/);
        if (!m) throw new Error('Could not parse products array');
        data = m[1];
      }
      const arr = JSON.parse(data);
      if (!Array.isArray(arr)) throw new Error('Expected an array');
      catalogue = arr;
      saveCatalogue();
      toast('Imported ' + arr.length + ' products');
    } catch (e) {
      alert('Import failed: ' + e.message);
    }
  };
  reader.readAsText(file);
}

function renderHnPricing() {
  const prices = loadHnPrices();
  const root = document.getElementById('hn-pricing');
  if (!root) return;
  const sizes = Object.keys(prices).sort((a, b) => a - b);
  root.innerHTML = sizes.map((size) => {
    const row = prices[size];
    return `
    <div class="bg-metal-850 border border-corten-900/40 rounded-sm p-4">
      <p class="font-display text-white mb-3">${size} mm height</p>
      <div class="grid sm:grid-cols-2 gap-4 text-sm">
        ${['clean', 'holes'].map((mount) => `
          <div>
            <p class="text-xs text-corten-500 uppercase mb-2">${mount === 'clean' ? 'Clean face' : 'Pre-drilled'}</p>
            <div class="grid grid-cols-3 gap-2">
              ${[1, 2, 3].map((n) => `
                <label class="block">
                  <span class="text-[10px] text-gray-500">${n} char$</span>
                  <input type="number" min="0" step="1" data-hn="${size}" data-mount="${mount}" data-n="${n}"
                    value="${row[mount]?.[n] ?? 0}"
                    class="w-full mt-0.5 bg-metal-950 border border-gray-700 rounded-sm px-2 py-1.5 text-white text-sm">
                </label>
              `).join('')}
            </div>
          </div>
        `).join('')}
      </div>
    </div>`;
  }).join('');
}

function collectHnPricing() {
  const prices = loadHnPrices();
  document.querySelectorAll('[data-hn]').forEach((inp) => {
    const size = inp.dataset.hn;
    const mount = inp.dataset.mount;
    const n = inp.dataset.n;
    if (!prices[size]) prices[size] = { clean: {}, holes: {} };
    if (!prices[size][mount]) prices[size][mount] = {};
    prices[size][mount][n] = parseFloat(inp.value) || 0;
  });
  return prices;
}

function showApp() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('admin-app').classList.remove('hidden');
  loadCatalogue();
  renderList();
  renderHnPricing();
}

function showLogin() {
  document.getElementById('login-screen').classList.remove('hidden');
  document.getElementById('admin-app').classList.add('hidden');
}

function switchTab(tab) {
  document.querySelectorAll('[data-tab-panel]').forEach((el) => {
    el.classList.toggle('hidden', el.dataset.tabPanel !== tab);
  });
  document.querySelectorAll('[data-tab]').forEach((btn) => {
    const on = btn.dataset.tab === tab;
    btn.classList.toggle('text-corten-400', on);
    btn.classList.toggle('border-corten-600', on);
    btn.classList.toggle('text-gray-400', !on);
    btn.classList.toggle('border-transparent', !on);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  if (isLoggedIn()) showApp();
  else showLogin();

  document.getElementById('login-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const pass = document.getElementById('login-pass').value;
    const hash = await sha256(pass);
    if (hash === getPassHash()) {
      setLoggedIn(true);
      showApp();
    } else {
      document.getElementById('login-error').classList.remove('hidden');
    }
  });

  document.getElementById('btn-logout')?.addEventListener('click', () => {
    setLoggedIn(false);
    showLogin();
  });

  document.getElementById('btn-add')?.addEventListener('click', () => openEditor(null));
  document.getElementById('btn-cancel-edit')?.addEventListener('click', closeEditor);
  document.getElementById('btn-save-product')?.addEventListener('click', saveProductFromForm);

  document.getElementById('btn-save-draft')?.addEventListener('click', () => {
    saveCatalogue();
  });
  document.getElementById('btn-publish')?.addEventListener('click', publishCatalogue);
  document.getElementById('btn-export-js')?.addEventListener('click', exportProductsJs);
  document.getElementById('btn-export-images')?.addEventListener('click', () => downloadImages());
  document.getElementById('btn-reset-seed')?.addEventListener('click', () => {
    if (!confirm('Reset catalogue from the built-in products.js seed? Unsaved local edits will be lost.')) return;
    localStorage.removeItem(STORAGE_PRODUCTS);
    if (typeof window.products !== 'undefined') {
      catalogue = JSON.parse(JSON.stringify(window.products));
    } else catalogue = [];
    saveCatalogue();
  });

  document.getElementById('import-file')?.addEventListener('change', (e) => {
    const f = e.target.files?.[0];
    if (f) importProductsJson(f);
    e.target.value = '';
  });

  document.getElementById('photo-input')?.addEventListener('change', async (e) => {
    const files = Array.from(e.target.files || []);
    for (const file of files) {
      if (!file.type.startsWith('image/')) continue;
      try {
        const dataUrl = await compressImage(file);
        pendingImages.push({ src: dataUrl, label: file.name.replace(/\.[^.]+$/, '') });
      } catch (err) {
        alert('Image failed: ' + err.message);
      }
    }
    renderSlidePreviews();
    // If main image empty, set first
    if (pendingImages[0] && !document.getElementById('f-image').value) {
      document.getElementById('f-image').value = pendingImages[0].src.startsWith('data:')
        ? ''
        : pendingImages[0].src;
      // keep image field as path preference; data URLs live in slides
      if (!document.getElementById('f-image').value && pendingImages[0]) {
        // leave blank — image taken from first slide on save
      }
    }
    e.target.value = '';
    toast('Photo(s) added');
  });

  document.getElementById('btn-save-hn')?.addEventListener('click', () => {
    saveHnPrices(collectHnPricing());
  });

  document.getElementById('btn-change-pass')?.addEventListener('click', async () => {
    const next = document.getElementById('new-pass').value;
    const conf = document.getElementById('new-pass-conf').value;
    if (!next || next.length < 8) {
      alert('Password must be at least 8 characters');
      return;
    }
    if (next !== conf) {
      alert('Passwords do not match');
      return;
    }
    const hash = await sha256(next);
    localStorage.setItem(STORAGE_PASS_HASH, hash);
    document.getElementById('new-pass').value = '';
    document.getElementById('new-pass-conf').value = '';
    toast('Password updated for this browser');
  });

  document.querySelectorAll('[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
});
