/* Corten Living Admin — products, photos, pricing (cloud + local fallback) */

const STORAGE_PRODUCTS = 'cortenAdminProducts';
const STORAGE_PUBLISHED = 'cortenProductsPublished';
const STORAGE_HN_PRICES = 'cortenHouseNumberPrices';
const STORAGE_SESSION = 'cortenAdminSession';
const STORAGE_PASS = 'cortenAdminPass'; // session-only password for API
// Local-only fallback password: CortenAdmin!
const DEFAULT_PASS_HASH = '3c1db5a70bf6cf2ba4ebc27d48cd017c94bc623c3491fe2c2d7dcd4144f765ab';
const STORAGE_PASS_HASH = 'cortenAdminPassHash';

// 150/250/300 scaled linearly from 100↔200 anchors
const DEFAULT_HN_PRICES = {
 100: { clean: { 1: 8, 2: 15, 3: 21 }, holes: { 1: 10, 2: 17, 3: 24 } },
 150: { clean: { 1: 12, 2: 22, 3: 32 }, holes: { 1: 14, 2: 25, 3: 35 } },
 200: { clean: { 1: 15, 2: 28, 3: 42 }, holes: { 1: 17, 2: 32, 3: 46 } },
 250: { clean: { 1: 19, 2: 35, 3: 53 }, holes: { 1: 21, 2: 40, 3: 57 } },
 300: { clean: { 1: 22, 2: 41, 3: 63 }, holes: { 1: 24, 2: 47, 3: 68 } }
};

let catalogue = [];
let editingId = null;
let pendingImages = [];
/** Size options for the product being edited: { id, label, size, price }[] */
let pendingSizes = [];
/** Stripe payment links for in-store QR: { key, sizeId, label, size, priceExcl, amountIncl, url, stripeId, createdAt }[] */
let pendingPaymentLinks = [];
let cloudStatus = { cloud: false, hasGithub: false, hasAdminPassword: false, storage: 'none' };

const GST_RATE_ADMIN = 0.15;

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

function getAdminPassword() {
 return sessionStorage.getItem(STORAGE_PASS) || '';
}

function setLoggedIn(password) {
 sessionStorage.setItem(STORAGE_SESSION, '1');
 if (password) sessionStorage.setItem(STORAGE_PASS, password);
}

function clearSession() {
 sessionStorage.removeItem(STORAGE_SESSION);
 sessionStorage.removeItem(STORAGE_PASS);
}

function adminHeaders(jsonBody = true) {
 const h = {};
 if (jsonBody) h['Content-Type'] = 'application/json';
 const pass = getAdminPassword();
 if (pass) h['X-Admin-Password'] = pass;
 return h;
}

async function api(path, options = {}) {
 const res = await fetch(path, {
 ...options,
 headers: { ...adminHeaders(options.body != null), ...options.headers },
 });
 let data = null;
 try { data = await res.json(); } catch { data = null; }
 return { res, data, ok: res.ok };
}

function toast(msg, isError = false) {
 const el = document.getElementById('toast');
 if (!el) return;
 el.textContent = msg;
 el.classList.toggle('border-red-700', isError);
 el.classList.toggle('border-corten-700', !isError);
 el.classList.remove('opacity-0', 'pointer-events-none');
 clearTimeout(toast._t);
 toast._t = setTimeout(() => el.classList.add('opacity-0', 'pointer-events-none'), 3200);
}

function updateCloudBadge() {
 const el = document.getElementById('cloud-badge');
 if (!el) return;
 if (cloudStatus.cloud) {
 el.textContent = 'Cloud live';
 el.className = 'text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-sm bg-green-900/50 text-green-400 border border-green-800';
 } else if (!cloudStatus.hasAdminPassword && !cloudStatus.hasGithub) {
 el.textContent = 'Setup needed';
 el.className = 'text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-sm bg-amber-900/40 text-amber-400 border border-amber-800';
 } else if (!cloudStatus.hasAdminPassword) {
 el.textContent = 'Set ADMIN_PASSWORD';
 el.className = 'text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-sm bg-amber-900/40 text-amber-400 border border-amber-800';
 } else if (!cloudStatus.hasGithub) {
 el.textContent = 'Set GITHUB_TOKEN';
 el.className = 'text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-sm bg-amber-900/40 text-amber-400 border border-amber-800';
 } else {
 el.textContent = 'Local only';
 el.className = 'text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-sm bg-gray-800 text-gray-400 border border-gray-700';
 }
 const hint = document.getElementById('cloud-hint');
 if (hint) {
 if (cloudStatus.cloud) {
 hint.textContent = 'Saves go live for every visitor (stored in your GitHub repo).';
 } else {
 hint.innerHTML = 'Add two secrets under Cloudflare Pages → Settings → Variables and secrets (see steps below). No KV needed.';
 }
 }
 updateSettingsPanels();
}

function updateSettingsPanels() {
 const cloud = document.getElementById('settings-cloud-pass');
 const local = document.getElementById('settings-local-pass');
 if (!cloud || !local) return;
 if (cloudStatus.hasAdminPassword) {
 cloud.classList.remove('hidden');
 local.classList.add('hidden');
 } else {
 cloud.classList.add('hidden');
 local.classList.remove('hidden');
 }
}

async function refreshCloudStatus() {
 try {
 const { res, data } = await api('/api/status', { headers: {} });
 if (res.ok && data) {
 cloudStatus = {
 cloud: !!data.cloud,
 hasGithub: !!data.hasGithub,
 hasAdminPassword: !!data.hasAdminPassword,
 storage: data.storage || 'none',
 productCount: data.productCount,
 };
 }
 } catch {
 cloudStatus = { cloud: false, hasGithub: false, hasAdminPassword: false, storage: 'none' };
 }
 updateCloudBadge();
}

function slugify(str) {
 return String(str || 'product')
 .toLowerCase()
 .replace(/[^a-z0-9]+/g, '-')
 .replace(/^-|-$/g, '')
 .slice(0, 40) || 'product';
}

function compressImage(file, maxW = 1000, quality = 0.72) {
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
 canvas.getContext('2d').drawImage(img, 0, 0, w, h);
 resolve(canvas.toDataURL('image/jpeg', quality));
 };
 img.onerror = () => {
 URL.revokeObjectURL(url);
 reject(new Error('Could not read image'));
 };
 img.src = url;
 });
}

/** Upload data URL to cloud → permanent /api/media/… URL */
async function uploadToCloud(dataUrl, filename) {
 if (!cloudStatus.cloud && !cloudStatus.hasGithub) {
 return dataUrl; // keep local data URL
 }
 const { res, data } = await api('/api/upload', {
 method: 'POST',
 body: JSON.stringify({ dataUrl, filename }),
 });
 if (!res.ok) throw new Error(data?.error || 'Upload failed');
 return data.url;
}

async function ensureCloudUrls(product) {
 const out = JSON.parse(JSON.stringify(product));
 if (out.image && out.image.startsWith('data:')) {
 out.image = await uploadToCloud(out.image, out.id + '.jpg');
 }
 if (out.slides?.length) {
 for (let i = 0; i < out.slides.length; i++) {
 if (out.slides[i].src?.startsWith('data:')) {
 out.slides[i].src = await uploadToCloud(out.slides[i].src, `${out.id}-${i + 1}.jpg`);
 }
 }
 }
 // Prefer first slide as main image if empty
 if (!out.image && out.slides?.[0]?.src) out.image = out.slides[0].src;
 return out;
}

function productThumb(p) {
 const src = p.image || (p.slides && p.slides[0] && p.slides[0].src) || '';
 if (src) return `<img src="${src}" alt="" class="w-14 h-14 object-cover rounded-sm bg-metal-950">`;
 return `<div class="w-14 h-14 rounded-sm bg-metal-950 flex items-center justify-center text-corten-600 font-display text-lg">${(p.name || '?').charAt(0)}</div>`;
}

function escapeHtml(s) {
 return String(s ?? '')
 .replace(/&/g, '&amp;')
 .replace(/</g, '&lt;')
 .replace(/>/g, '&gt;')
 .replace(/"/g, '&quot;');
}

function renderList() {
 const list = document.getElementById('product-list');
 if (!list) return;
 if (!catalogue.length) {
 list.innerHTML = `<p class="text-gray-500 text-sm py-8 text-center">No products yet. Click <strong class="text-corten-400">Add product</strong>.</p>`;
 const cnt = document.getElementById('list-count');
 if (cnt) cnt.textContent = '';
 return;
 }
 const catFilter = document.getElementById('list-filter-cat')?.value || 'all';
 const q = (document.getElementById('list-filter-q')?.value || '').trim().toLowerCase();
 const indexed = catalogue.map((p, i) => ({ p, i })).filter(({ p }) => {
  if (catFilter !== 'all' && (p.category || '') !== catFilter) return false;
  if (q && !String(p.name || '').toLowerCase().includes(q) && !String(p.id || '').toLowerCase().includes(q)) return false;
  return true;
 });
 const cnt = document.getElementById('list-count');
 if (cnt) cnt.textContent = `${indexed.length} of ${catalogue.length}`;
 if (!indexed.length) {
  list.innerHTML = `<p class="text-gray-500 text-sm py-8 text-center">No products match this filter.</p>`;
  return;
 }
 list.innerHTML = indexed.map(({ p, i }) => `
 <div class="flex items-center gap-4 p-4 bg-metal-850 border border-corten-900/40 rounded-sm hover:border-corten-700/60 transition">
 ${productThumb(p)}
 <div class="flex-1 min-w-0">
 <div class="flex flex-wrap items-center gap-2">
 <p class="font-display text-white truncate">${escapeHtml(p.name)}</p>
 ${p.featured ? '<span class="text-[10px] uppercase bg-corten-600 text-white px-1.5 py-0.5 rounded-sm">Featured</span>' : ''}
 ${p.tag ? `<span class="text-[10px] text-corten-500">${escapeHtml(p.tag)}</span>` : ''}
 ${Array.isArray(p.paymentLinks) && p.paymentLinks.length ? '<span class="text-[10px] uppercase bg-emerald-900/50 text-emerald-400 border border-emerald-800 px-1.5 py-0.5 rounded-sm">QR pay</span>' : ''}
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

 list.querySelectorAll('.edit-btn').forEach((btn) => btn.addEventListener('click', () => openEditor(btn.dataset.edit)));
 list.querySelectorAll('.del-btn').forEach((btn) => {
 btn.addEventListener('click', async () => {
 if (!confirm('Delete this product?')) return;
 catalogue = catalogue.filter((p) => p.id !== btn.dataset.del);
 await saveDraftLocal();
 renderList();
 });
 });
 list.querySelectorAll('.move-btn').forEach((btn) => {
 btn.addEventListener('click', async () => {
 const i = parseInt(btn.dataset.move, 10);
 const j = i + parseInt(btn.dataset.dir, 10);
 if (j < 0 || j >= catalogue.length) return;
 [catalogue[i], catalogue[j]] = [catalogue[j], catalogue[i]];
 await saveDraftLocal();
 renderList();
 });
 });
}

/** Prefer /images/live/… over raw.githubusercontent.com for CDN speed */
function normalizeImageUrl(url) {
 if (!url || typeof url !== 'string') return url;
 if (url.startsWith('data:')) return url;
 const m = url.match(
  /^https?:\/\/raw\.githubusercontent\.com\/[^/]+\/[^/]+\/[^/]+\/(images\/live\/[^?#]+)/i
 );
 if (m) return '/' + m[1];
 return url;
}

function normalizeCatalogueImages(list) {
 if (!Array.isArray(list)) return list || [];
 return list.map((p) => {
  if (!p || typeof p !== 'object') return p;
  const out = { ...p };
  if (out.image) out.image = normalizeImageUrl(out.image);
  if (Array.isArray(out.slides)) {
   out.slides = out.slides.map((s) =>
    s && typeof s === 'object' ? { ...s, src: normalizeImageUrl(s.src) } : s
   );
  }
  return out;
 });
}

async function loadCatalogue() {
 // 1) Cloud
 try {
 const { res, data } = await api('/api/products', { headers: {} });
 if (res.ok && Array.isArray(data?.products) && data.products.length) {
 catalogue = normalizeCatalogueImages(data.products);
 localStorage.setItem(STORAGE_PRODUCTS, JSON.stringify(catalogue));
 return;
 }
 } catch (_) {}

 // 2) Local draft
 try {
 const raw = localStorage.getItem(STORAGE_PRODUCTS);
 if (raw) {
 catalogue = normalizeCatalogueImages(JSON.parse(raw));
 return;
 }
 } catch (_) {}

 // 3) Seed from products.js
 if (typeof window.products !== 'undefined' && Array.isArray(window.products)) {
 catalogue = normalizeCatalogueImages(JSON.parse(JSON.stringify(window.products)));
 } else {
 catalogue = [];
 }
}

function saveDraftLocal() {
 localStorage.setItem(STORAGE_PRODUCTS, JSON.stringify(catalogue));
 localStorage.setItem(STORAGE_PUBLISHED, JSON.stringify(catalogue));
}

async function publishLive() {
 const btn = document.getElementById('btn-publish');
 if (btn) {
 btn.disabled = true;
 btn.textContent = 'Publishing…';
 }
 try {
 // Upload any remaining data: URLs in products
 toast('Uploading photos & saving…');
 const uploaded = [];
 for (const p of catalogue) {
 uploaded.push(await ensureCloudUrls(p));
 }
 catalogue = uploaded;
 saveDraftLocal();

 if (cloudStatus.hasGithub || cloudStatus.cloud) {
 const { res, data } = await api('/api/products', {
 method: 'PUT',
 body: JSON.stringify({ products: catalogue }),
 });
 if (!res.ok) throw new Error(data?.error || `Save failed (${res.status})`);
 toast(`Live for everyone — ${catalogue.length} products saved`);
 } else {
 toast('Saved on this browser only (add GITHUB_TOKEN + ADMIN_PASSWORD secrets)', true);
 }
 renderList();
 } catch (e) {
 toast(String(e.message || e), true);
 } finally {
 if (btn) {
 btn.disabled = false;
 btn.textContent = 'Publish live (everyone)';
 }
 }
}

function loadHnPricesLocal() {
 try {
 const raw = localStorage.getItem(STORAGE_HN_PRICES);
 if (raw) return JSON.parse(raw);
 } catch (_) {}
 return JSON.parse(JSON.stringify(DEFAULT_HN_PRICES));
}

async function loadHnPrices() {
 try {
 const { res, data } = await api('/api/pricing', { headers: {} });
 if (res.ok && data?.prices) {
 localStorage.setItem(STORAGE_HN_PRICES, JSON.stringify(data.prices));
 return data.prices;
 }
 } catch (_) {}
 return loadHnPricesLocal();
}

async function saveHnPricesCloud(prices) {
 localStorage.setItem(STORAGE_HN_PRICES, JSON.stringify(prices));
 if (cloudStatus.hasGithub || cloudStatus.cloud) {
 const { res, data } = await api('/api/pricing', {
 method: 'PUT',
 body: JSON.stringify({ prices }),
 });
 if (!res.ok) throw new Error(data?.error || 'Pricing save failed');
 toast('Number pricing live for everyone');
 } else {
 toast('Number pricing saved on this device only', true);
 }
}

function openEditor(id) {
 editingId = id || null;
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
 pendingImages = (p?.slides || []).map((s) => ({ src: s.src, label: s.label || '' }));
 // Size options: use saved sizes, or seed one row from main size/price
 if (Array.isArray(p?.sizes) && p.sizes.length) {
  pendingSizes = p.sizes.map((s, i) => ({
   id: s.id || ('sz-' + i),
   label: s.label || '',
   size: s.size || '',
   price: s.price != null ? s.price : '',
  }));
 } else if (p && (p.size || p.price)) {
  pendingSizes = [{
   id: 'sz-0',
   label: 'Standard',
   size: p.size || '',
   price: p.price ?? '',
  }];
 } else {
  pendingSizes = [
   { id: 'sz-sm', label: 'Small', size: '', price: '' },
   { id: 'sz-md', label: 'Medium', size: '', price: '' },
   { id: 'sz-lg', label: 'Large', size: '', price: '' },
  ];
 }
 pendingPaymentLinks = Array.isArray(p?.paymentLinks)
  ? p.paymentLinks.map((l) => ({ ...l }))
  : [];
 renderSlidePreviews();
 renderSizeRows();
 updateSizesEditorVisibility();
 renderQrPayRows();
 document.getElementById('editor-panel').classList.remove('hidden');
 document.getElementById('list-panel').classList.add('hidden');
 window.scrollTo({ top: 0, behavior: 'smooth' });
}

function updateSizesEditorVisibility() {
 const cat = document.getElementById('f-category')?.value;
 const box = document.getElementById('sizes-editor');
 if (!box) return;
 // House numbers use the numbers configurator — hide size options
 const hide = cat === 'numbers';
 box.classList.toggle('hidden', hide);
 // Refresh QR rows when category/sizes change
 try {
  renderQrPayRows();
 } catch (_) {}
}

function syncPendingSizesFromDom() {
 const body = document.getElementById('f-sizes-body');
 if (!body) return;
 const rows = [];
 body.querySelectorAll('tr[data-size-row]').forEach((tr, i) => {
  const id = tr.dataset.sizeId || ('sz-' + i);
  const label = tr.querySelector('[data-size-label]')?.value.trim() || '';
  const size = tr.querySelector('[data-size-dims]')?.value.trim() || '';
  const priceRaw = tr.querySelector('[data-size-price]')?.value;
  const price = priceRaw === '' || priceRaw == null ? '' : parseFloat(priceRaw);
  rows.push({ id, label, size, price: Number.isNaN(price) ? '' : price });
 });
 pendingSizes = rows;
}

function renderSizeRows() {
 const body = document.getElementById('f-sizes-body');
 if (!body) return;
 if (!pendingSizes.length) {
  body.innerHTML = `<tr><td colspan="4" class="py-3 text-xs text-gray-600">No sizes yet — click “+ Add size”.</td></tr>`;
  return;
 }
 body.innerHTML = pendingSizes.map((s, i) => `
  <tr data-size-row="${i}" data-size-id="${escapeHtml(s.id || ('sz-' + i))}" class="border-t border-gray-800">
   <td class="py-2 pr-2">
    <input type="text" data-size-label value="${escapeHtml(s.label || '')}" placeholder="Small"
     class="w-full min-w-[5rem] bg-metal-950 border border-gray-700 rounded-sm px-2 py-1.5 text-white text-sm">
   </td>
   <td class="py-2 pr-2">
    <input type="text" data-size-dims value="${escapeHtml(s.size || '')}" placeholder="500 × 600 mm"
     class="w-full min-w-[7rem] bg-metal-950 border border-gray-700 rounded-sm px-2 py-1.5 text-white text-sm">
   </td>
   <td class="py-2 pr-2">
    <input type="number" data-size-price min="0" step="1" value="${s.price === '' || s.price == null ? '' : s.price}" placeholder="72"
     class="w-24 bg-metal-950 border border-gray-700 rounded-sm px-2 py-1.5 text-white text-sm">
   </td>
   <td class="py-2">
    <button type="button" data-size-del="${i}" class="text-xs text-gray-500 hover:text-red-400">Remove</button>
   </td>
  </tr>
 `).join('');

 body.querySelectorAll('[data-size-del]').forEach((btn) => {
  btn.addEventListener('click', () => {
   syncPendingSizesFromDom();
   pendingSizes.splice(parseInt(btn.dataset.sizeDel, 10), 1);
   renderSizeRows();
  });
 });
 body.querySelectorAll('input').forEach((inp) => {
  inp.addEventListener('change', () => {
   syncPendingSizesFromDom();
   renderQrPayRows();
  });
 });
 renderQrPayRows();
}

function collectSizesFromForm() {
 syncPendingSizesFromDom();
 return pendingSizes
  .map((s, i) => ({
   id: s.id || ('sz-' + i),
   label: String(s.label || '').trim() || ('Size ' + (i + 1)),
   size: String(s.size || '').trim(),
   price: Number(s.price) || 0,
  }))
  .filter((s) => s.label || s.size || s.price > 0);
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
 <button type="button" data-slide-del="${i}" class="absolute top-1 right-1 bg-black/70 text-white text-xs w-6 h-6 rounded-sm">×</button>
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
 document.querySelectorAll('[data-slide-label]').forEach((inp) => {
 const i = parseInt(inp.dataset.slideLabel, 10);
 if (pendingImages[i]) pendingImages[i].label = inp.value;
 });

 let id = document.getElementById('f-id').value.trim() || slugify(name);
 if (!editingId) {
 let base = id;
 let n = 1;
 while (catalogue.some((p) => p.id === id)) id = base + '-' + n++;
 }

 const price = parseFloat(document.getElementById('f-price').value);
 let priceLabel = document.getElementById('f-priceLabel').value.trim();
 if (!priceLabel && !Number.isNaN(price)) priceLabel = '$' + price;

 let image = document.getElementById('f-image').value.trim();
 if (!image && pendingImages[0]) image = pendingImages[0].src;

 const category = document.getElementById('f-category').value;
 const linkRaw = document.getElementById('f-link').value.trim();
 // House numbers → configurator; all other products → product page with size picker
 let link = linkRaw;
 if (!link) {
 if (category === 'numbers' || id === 'house-numbers') link = '/house-numbers';
 else link = '/product?id=' + encodeURIComponent(id);
 }

 // Size options (all products except numbers)
 let sizes = [];
 if (category !== 'numbers' && id !== 'house-numbers') {
  sizes = collectSizesFromForm();
  // If admin left sizes empty, seed one from main size/price fields
  if (!sizes.length) {
   const mainSize = document.getElementById('f-size')?.value.trim() || 'Standard';
   const mainPrice = Number.isNaN(price) ? 0 : price;
   if (mainPrice > 0 || mainSize) {
    sizes = [{ id: 'sz-0', label: 'Standard', size: mainSize, price: mainPrice }];
   }
  }
 }

 // Always sync card price + "From $X" label from cheapest size option
 let basePrice = Number.isNaN(price) ? 0 : price;
 let baseSize = document.getElementById('f-size').value.trim() || 'Various';
 let displayLabel = priceLabel;
 if (sizes.length) {
  const prices = sizes.map((s) => Number(s.price) || 0).filter((n) => n > 0);
  if (prices.length) {
   const minP = Math.min(...prices);
   const maxP = Math.max(...prices);
   basePrice = minP;
   // Always overwrite display from sizes so old "From $72" can't stick after a price cut
   displayLabel = minP === maxP ? ('$' + minP) : ('From $' + minP);
  }
  // Summary size line for shop cards — show range if multiple sizes
  if (sizes.length > 1) {
   baseSize = 'Multiple sizes';
  } else if (sizes[0]) {
   baseSize = sizes[0].size || sizes[0].label || baseSize || 'Various';
  }
 }

 return {
 id,
 name,
 category,
 size: baseSize,
 price: basePrice,
 priceLabel: displayLabel || (basePrice ? ('$' + basePrice) : ''),
 desc: document.getElementById('f-desc').value.trim(),
 tag: document.getElementById('f-tag').value.trim(),
 featured: document.getElementById('f-featured').checked,
 link,
 image,
 slides: pendingImages.map((s) => ({ src: s.src, label: s.label || '' })),
 ...(sizes.length ? { sizes } : {}),
 ...(pendingPaymentLinks.length ? { paymentLinks: pendingPaymentLinks } : {}),
 };
}

/* ── In-store Stripe Payment Link + QR ── */

function qrImageUrl(payUrl, size) {
  const s = size || 280;
  return (
    'https://api.qrserver.com/v1/create-qr-code/?size=' +
    s +
    'x' +
    s +
    '&margin=12&data=' +
    encodeURIComponent(payUrl)
  );
}

function paymentLinkKey(sizeId) {
  return sizeId ? 'size:' + sizeId : 'base';
}

function findPaymentLink(sizeId) {
  const key = paymentLinkKey(sizeId);
  return pendingPaymentLinks.find((l) => l.key === key || (sizeId && l.sizeId === sizeId));
}

function getQrPayVariants() {
  syncPendingSizesFromDom();
  const cat = document.getElementById('f-category')?.value;
  const name = document.getElementById('f-name')?.value.trim() || 'Product';
  const mainPrice = parseFloat(document.getElementById('f-price')?.value);
  const mainSize = document.getElementById('f-size')?.value.trim() || '';

  // Prefer size rows with prices
  const fromSizes = (pendingSizes || [])
    .filter((s) => s.price !== '' && s.price != null && Number(s.price) > 0)
    .map((s) => ({
      sizeId: s.id || '',
      label: s.label || 'Size',
      size: s.size || '',
      priceExcl: Number(s.price),
    }));

  if (fromSizes.length && cat !== 'numbers') return fromSizes;

  // Fallback: single base price
  if (Number.isFinite(mainPrice) && mainPrice > 0) {
    return [
      {
        sizeId: '',
        label: mainSize || 'Standard',
        size: mainSize,
        priceExcl: mainPrice,
      },
    ];
  }
  return [];
}

function renderPaymentLinkCard(entry) {
  if (!entry?.url) return '';
  const qr = qrImageUrl(entry.url, 200);
  const title = entry.label || entry.description || 'Payment';
  const excl = Number(entry.priceExcl) || 0;
  const incl = Number(entry.amountIncl) || Math.round(excl * (1 + GST_RATE_ADMIN) * 100) / 100;
  const safeName = slugify(title).slice(0, 40) || 'pay';
  return `
 <div class="bg-metal-950 border border-emerald-900/40 rounded-sm p-3 space-y-2">
  <div class="flex flex-wrap items-start justify-between gap-2">
   <div class="min-w-0">
    <p class="text-sm text-white font-medium truncate">${escapeHtml(title)}</p>
    <p class="text-[11px] text-gray-500">$${excl.toFixed(2)} excl. · <span class="text-corten-400">$${incl.toFixed(2)} charged</span>${entry.includeGst === false ? ' (no GST added)' : ' incl. GST'}</p>
   </div>
   <button type="button" data-qr-remove="${escapeHtml(entry.key || '')}" class="text-[11px] text-gray-500 hover:text-red-400">Remove</button>
  </div>
  <div class="flex flex-wrap gap-3 items-center">
   <img src="${qr}" alt="QR" class="w-28 h-28 bg-white rounded-sm p-1 border border-gray-700" width="112" height="112">
   <div class="min-w-0 flex-1 space-y-1.5">
    <input type="text" readonly value="${escapeHtml(entry.url)}" class="w-full bg-metal-900 border border-gray-700 rounded-sm px-2 py-1.5 text-[10px] text-gray-300 font-mono">
    <div class="flex flex-wrap gap-2">
     <button type="button" data-qr-copy="${escapeHtml(entry.url)}" class="px-2.5 py-1 text-[11px] border border-gray-600 rounded-sm text-gray-300 hover:border-corten-500">Copy link</button>
     <a href="${qr}" target="_blank" rel="noopener" class="px-2.5 py-1 text-[11px] border border-gray-600 rounded-sm text-gray-300 hover:border-corten-500">Open QR image</a>
     <a href="${escapeHtml(entry.url)}" target="_blank" rel="noopener" class="px-2.5 py-1 text-[11px] text-corten-400 hover:underline">Test pay ↗</a>
    </div>
   </div>
  </div>
 </div>`;
}

function wireQrCardButtons(root) {
  const el = root || document;
  el.querySelectorAll('[data-qr-copy]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const url = btn.getAttribute('data-qr-copy');
      try {
        await navigator.clipboard.writeText(url);
        toast('Payment link copied');
      } catch {
        toast('Copy failed — select the link manually', true);
      }
    });
  });
  el.querySelectorAll('[data-qr-remove]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.getAttribute('data-qr-remove');
      pendingPaymentLinks = pendingPaymentLinks.filter((l) => l.key !== key);
      renderQrPayRows();
      toast('Removed from this product (Save product to update cloud)');
    });
  });
}

function renderQrPayRows() {
  const host = document.getElementById('qr-pay-rows');
  if (!host) return;

  // Show all saved links for this product (custom + size-based)
  const links = pendingPaymentLinks.filter((l) => l.url);
  if (!links.length) {
    host.innerHTML =
      '<p class="text-xs text-gray-500">Generated links for this product appear here. Use the form above: description + price → Generate.</p>';
    return;
  }
  host.innerHTML =
    '<p class="text-[10px] text-gray-500 uppercase tracking-wide">Saved links for this product</p>' +
    links.map((l) => renderPaymentLinkCard(l)).join('');
  wireQrCardButtons(host);
}

function updateCustomQrInclHint() {
  const price = parseFloat(document.getElementById('qr-custom-price')?.value);
  const addGst = document.getElementById('qr-custom-incl-gst')?.checked !== false;
  const el = document.getElementById('qr-custom-incl');
  if (!el) return;
  if (!Number.isFinite(price) || price <= 0) {
    el.textContent = 'Incl. GST: —';
    return;
  }
  const charged = addGst ? Math.round(price * (1 + GST_RATE_ADMIN) * 100) / 100 : price;
  el.textContent = addGst
    ? `Customer pays: $${charged.toFixed(2)} (incl. GST)`
    : `Customer pays: $${charged.toFixed(2)} (as entered)`;
}

function updateQuickQrInclHint() {
  const price = parseFloat(document.getElementById('quick-qr-price')?.value);
  const addGst = document.getElementById('quick-qr-incl-gst')?.checked !== false;
  const el = document.getElementById('quick-qr-incl');
  if (!el) return;
  if (!Number.isFinite(price) || price <= 0) {
    el.textContent = 'Customer pays: —';
    return;
  }
  const charged = addGst ? Math.round(price * (1 + GST_RATE_ADMIN) * 100) / 100 : price;
  el.textContent = addGst
    ? `Customer pays: $${charged.toFixed(2)} incl. GST`
    : `Customer pays: $${charged.toFixed(2)}`;
}

/**
 * Create Stripe Payment Link from description + price (freeform).
 * @param {{ description, priceExcl, includeGst, productId?, productName?, attachToProduct? }} opts
 */
async function createFreeformPaymentLink(opts) {
  const description = String(opts.description || '').trim();
  const priceExcl = Number(opts.priceExcl);
  const includeGst = opts.includeGst !== false;
  if (!description) {
    toast('Enter a description', true);
    return null;
  }
  if (!Number.isFinite(priceExcl) || priceExcl <= 0) {
    toast('Enter a price greater than 0', true);
    return null;
  }

  const productName = opts.productName || description;
  const productId = opts.productId || 'qr-' + slugify(description).slice(0, 24);

  const { res, data } = await api('/api/product-payment-link', {
    method: 'POST',
    body: JSON.stringify({
      productId,
      productName,
      sizeLabel: description,
      sizeDims: '',
      priceExcl,
      includeGst,
      description,
    }),
  });
  if (!res.ok || !data?.url) {
    throw new Error(data?.error || 'Stripe link failed');
  }

  const entry = {
    key: 'custom:' + Date.now().toString(36),
    sizeId: '',
    label: description,
    description,
    size: '',
    priceExcl,
    amountIncl: data.amountIncl,
    includeGst,
    url: data.url,
    stripeId: data.id || '',
    createdAt: new Date().toISOString(),
  };
  return entry;
}

async function createCustomQrFromEditor() {
  const msg = document.getElementById('qr-pay-msg');
  const description =
    document.getElementById('qr-custom-desc')?.value.trim() ||
    document.getElementById('f-name')?.value.trim() ||
    '';
  const priceExcl = parseFloat(document.getElementById('qr-custom-price')?.value);
  const includeGst = document.getElementById('qr-custom-incl-gst')?.checked !== false;
  const name = document.getElementById('f-name')?.value.trim() || description;
  let id = document.getElementById('f-id')?.value.trim();
  if (!id && name) id = slugify(name);

  if (msg) msg.textContent = 'Creating Stripe Payment Link…';
  try {
    const entry = await createFreeformPaymentLink({
      description,
      priceExcl,
      includeGst,
      productId: id || undefined,
      productName: name,
    });
    if (!entry) {
      if (msg) msg.textContent = '';
      return;
    }
    pendingPaymentLinks.unshift(entry);

    // Attach to product if we can
    if (id || name) {
      const product = collectFormProduct();
      if (product) {
        product.paymentLinks = pendingPaymentLinks;
        const cIdx = catalogue.findIndex((p) => p.id === product.id);
        if (cIdx >= 0) catalogue[cIdx] = { ...catalogue[cIdx], ...product, paymentLinks: pendingPaymentLinks };
        else if (name) catalogue.push({ ...product, paymentLinks: pendingPaymentLinks });
        saveDraftLocal();
        if (cloudStatus.hasGithub || cloudStatus.cloud) {
          await api('/api/products', {
            method: 'PUT',
            body: JSON.stringify({ products: catalogue }),
          });
        }
      }
    }

    renderQrPayRows();
    if (msg) msg.textContent = 'Done — print the QR for the shelf. Link also under this product.';
    toast('Payment link + QR created');
    try {
      await navigator.clipboard.writeText(entry.url);
    } catch (_) {}
  } catch (e) {
    if (msg) msg.textContent = '';
    toast(String(e.message || e), true);
  }
}

async function createQuickQr() {
  const msg = document.getElementById('quick-qr-msg');
  const result = document.getElementById('quick-qr-result');
  const description = document.getElementById('quick-qr-desc')?.value.trim() || '';
  const priceExcl = parseFloat(document.getElementById('quick-qr-price')?.value);
  const includeGst = document.getElementById('quick-qr-incl-gst')?.checked !== false;
  const btn = document.getElementById('btn-quick-qr');

  if (msg) msg.textContent = 'Creating Stripe Payment Link…';
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Generating…';
  }
  try {
    const entry = await createFreeformPaymentLink({
      description,
      priceExcl,
      includeGst,
      productId: 'quick-qr',
      productName: description,
    });
    if (!entry) {
      if (msg) msg.textContent = '';
      return;
    }
    if (result) {
      result.classList.remove('hidden');
      result.innerHTML = renderPaymentLinkCard(entry);
      wireQrCardButtons(result);
    }
    if (msg) msg.textContent = 'Scan/print the QR or copy the link for the customer.';
    toast('Payment link + QR ready');
    try {
      await navigator.clipboard.writeText(entry.url);
      toast('Link copied to clipboard');
    } catch (_) {}
  } catch (e) {
    if (msg) msg.textContent = '';
    toast(String(e.message || e), true);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Generate link + QR';
    }
  }
}

async function saveProductFromForm() {
 const product = collectFormProduct();
 if (!product) return;
 const saveBtn = document.getElementById('btn-save-product');
 if (saveBtn) {
 saveBtn.disabled = true;
 saveBtn.textContent = 'Saving…';
 }
 try {
 // Upload images now if cloud available
 let finalProduct = product;
 if (cloudStatus.hasGithub || cloudStatus.cloud) {
 finalProduct = await ensureCloudUrls(product);
 }
 // Merge with existing so tag/desc/paymentLinks etc. never drop unexpectedly
 const idx = catalogue.findIndex((p) => p.id === (editingId || finalProduct.id));
 if (idx >= 0) {
  const prev = catalogue[idx] || {};
  catalogue[idx] = {
   ...prev,
   ...finalProduct,
   tag: finalProduct.tag != null ? finalProduct.tag : (prev.tag || ''),
   desc: finalProduct.desc != null ? finalProduct.desc : prev.desc,
   paymentLinks: finalProduct.paymentLinks || prev.paymentLinks || [],
  };
  // Explicit empty tag clears the badge
  if (document.getElementById('f-tag')) {
   catalogue[idx].tag = document.getElementById('f-tag').value.trim();
  }
 } else {
  catalogue.push(finalProduct);
 }
 saveDraftLocal();
 // Keep public shop cache in sync so tag/photo changes show immediately
 try {
  localStorage.setItem(STORAGE_PUBLISHED, JSON.stringify(catalogue));
 } catch (_) {}
 if (cloudStatus.hasGithub || cloudStatus.cloud) {
 const { res, data } = await api('/api/products', {
 method: 'PUT',
 body: JSON.stringify({ products: catalogue }),
 });
 if (!res.ok) throw new Error(data?.error || 'Cloud save failed');
 toast(
  finalProduct.tag
   ? `Saved live · tag “${finalProduct.tag}”`
   : 'Product saved live for everyone'
 );
 } else {
 toast('Product saved on this device (add secrets to go live)');
 }
 closeEditor();
 renderList();
 } catch (e) {
 toast(String(e.message || e), true);
 } finally {
 if (saveBtn) {
 saveBtn.disabled = false;
 saveBtn.textContent = 'Save product';
 }
 }
}

function buildProductsJs(list) {
 return `// Corten Living product catalogue
// Generated by Admin — ${new Date().toISOString().slice(0, 10)}
const products = ${JSON.stringify(list, null, 2)};

// Expose for other scripts
window.products = products;
`;
}

function downloadText(filename, text) {
 const blob = new Blob([text], { type: 'text/javascript' });
 const a = document.createElement('a');
 a.href = URL.createObjectURL(blob);
 a.download = filename;
 a.click();
 URL.revokeObjectURL(a.href);
}

function renderHnPricing(prices) {
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
 const prices = loadHnPricesLocal();
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
}

function showLogin() {
 document.getElementById('login-screen').classList.remove('hidden');
 document.getElementById('admin-app').classList.add('hidden');
}

function switchTab(tab) {
 if (!tab) return;
 document.querySelectorAll('[data-tab-panel]').forEach((el) => {
 el.classList.toggle('hidden', el.dataset.tabPanel !== tab);
 });
 document.querySelectorAll('button[data-tab], a[data-tab]').forEach((btn) => {
 const on = btn.dataset.tab === tab;
 btn.classList.toggle('text-corten-400', on);
 btn.classList.toggle('border-corten-600', on);
 btn.classList.toggle('text-gray-400', !on);
 btn.classList.toggle('border-transparent', !on);
 btn.classList.toggle('font-medium', on);
 });
 try {
  if (location.hash !== '#' + tab) history.replaceState(null, '', '#' + tab);
 } catch (_) {}
 if (tab === 'promo') loadPromoCodes();
 if (tab === 'privacy') loadPrivacyAdmin();
 document.querySelector('main')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* —— Shipping admin —— */
let shippingDraft = null;

function defaultShippingConfig() {
 return {
 enabled: true,
 label: 'NZ shipping',
 freeShippingOver: null,
 ruralSurcharge: 12,
 ruralLabel: 'Rural delivery surcharge',
 defaultItemGrams: 1200,
 cortenKgPerM2: 23.55,
 silhouetteFill: 0.32,
 packagingGrams: 200,
 houseNumbers: {
 baseGramsPerChar: 80,
 gramsPerMmPerChar: 0.45,
 holesExtraGramsPerChar: 5,
 },
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
}

async function loadShippingAdmin() {
 try {
 const { res, data } = await api('/api/shipping', { headers: {} });
 if (res.ok && data?.config) {
 shippingDraft = data.config;
 } else {
 shippingDraft = defaultShippingConfig();
 }
 } catch {
 shippingDraft = defaultShippingConfig();
 }
 fillShippingForm(shippingDraft);
}

function fillShippingForm(cfg) {
 const c = cfg || defaultShippingConfig();
 const d = defaultShippingConfig();
 const en = document.getElementById('ship-enabled');
 if (en) en.checked = c.enabled !== false;
 const lab = document.getElementById('ship-label');
 if (lab) lab.value = c.label || 'NZ shipping';
 const free = document.getElementById('ship-free-over');
 if (free) free.value = c.freeShippingOver != null && c.freeShippingOver !== '' ? c.freeShippingOver : '';
 const defG = document.getElementById('ship-default-g');
 if (defG) defG.value = c.defaultItemGrams ?? d.defaultItemGrams;
 const ruralS = document.getElementById('ship-rural-surcharge');
 if (ruralS) ruralS.value = c.ruralSurcharge != null ? c.ruralSurcharge : 12;
 const ruralL = document.getElementById('ship-rural-label');
 if (ruralL) ruralL.value = c.ruralLabel || 'Rural delivery surcharge';
 const kg = document.getElementById('ship-corten-kg');
 if (kg) kg.value = c.cortenKgPerM2 != null ? c.cortenKgPerM2 : d.cortenKgPerM2;
 const fill = document.getElementById('ship-fill');
 if (fill) fill.value = c.silhouetteFill != null ? c.silhouetteFill : d.silhouetteFill;
 const pack = document.getElementById('ship-pack-g');
 if (pack) pack.value = c.packagingGrams != null ? c.packagingGrams : d.packagingGrams;
 const hn = c.houseNumbers || {};
 const b = document.getElementById('ship-hn-base');
 const m = document.getElementById('ship-hn-mm');
 const h = document.getElementById('ship-hn-holes');
 if (b) b.value = hn.baseGramsPerChar ?? d.houseNumbers.baseGramsPerChar;
 if (m) m.value = hn.gramsPerMmPerChar ?? d.houseNumbers.gramsPerMmPerChar;
 if (h) h.value = hn.holesExtraGramsPerChar ?? d.houseNumbers.holesExtraGramsPerChar;
 renderShipTiers(c.tiers || []);
 updateShipExamples();
}

function renderShipTiers(tiers) {
 const body = document.getElementById('ship-tiers-body');
 if (!body) return;
 const list = Array.isArray(tiers) && tiers.length ? tiers : defaultShippingConfig().tiers;
 body.innerHTML = list.map((t, i) => `
 <tr class="border-t border-gray-800">
 <td class="py-2 pr-3">
 <input type="number" step="0.01" min="0" data-tier-max="${i}" value="${t.maxWeightKg}"
 class="w-28 bg-metal-950 border border-gray-700 rounded-sm px-2 py-1.5 text-white text-sm">
 </td>
 <td class="py-2 pr-3">
 <input type="number" step="0.01" min="0" data-tier-price="${i}" value="${t.price}"
 class="w-28 bg-metal-950 border border-gray-700 rounded-sm px-2 py-1.5 text-white text-sm">
 </td>
 <td class="py-2">
 <button type="button" data-tier-del="${i}" class="text-xs text-gray-500 hover:text-red-400">Remove</button>
 </td>
 </tr>
 `).join('');
 body.querySelectorAll('[data-tier-del]').forEach((btn) => {
 btn.addEventListener('click', () => {
 const rows = collectShipTiers();
 rows.splice(parseInt(btn.dataset.tierDel, 10), 1);
 renderShipTiers(rows.length ? rows : [{ maxWeightKg: 1, price: 15 }]);
 updateShipExamples();
 });
 });
 ['input', 'change'].forEach((ev) => {
 body.querySelectorAll('input').forEach((inp) => {
 inp.addEventListener(ev, updateShipExamples);
 });
 });
}

function collectShipTiers() {
 const body = document.getElementById('ship-tiers-body');
 if (!body) return [];
 const maxes = body.querySelectorAll('[data-tier-max]');
 const prices = body.querySelectorAll('[data-tier-price]');
 const tiers = [];
 maxes.forEach((inp, i) => {
 tiers.push({
 maxWeightKg: parseFloat(inp.value) || 0,
 price: parseFloat(prices[i]?.value) || 0,
 });
 });
 return tiers.sort((a, b) => a.maxWeightKg - b.maxWeightKg);
}

function collectShippingConfig() {
 const freeRaw = document.getElementById('ship-free-over')?.value;
 const d = defaultShippingConfig();
 return {
 enabled: !!document.getElementById('ship-enabled')?.checked,
 label: document.getElementById('ship-label')?.value.trim() || 'NZ shipping',
 freeShippingOver: freeRaw === '' || freeRaw == null ? null : parseFloat(freeRaw),
 ruralSurcharge: parseFloat(document.getElementById('ship-rural-surcharge')?.value) || 0,
 ruralLabel: document.getElementById('ship-rural-label')?.value.trim() || 'Rural delivery surcharge',
 defaultItemGrams: parseFloat(document.getElementById('ship-default-g')?.value) || d.defaultItemGrams,
 cortenKgPerM2: parseFloat(document.getElementById('ship-corten-kg')?.value) || d.cortenKgPerM2,
 silhouetteFill: parseFloat(document.getElementById('ship-fill')?.value) || d.silhouetteFill,
 packagingGrams: parseFloat(document.getElementById('ship-pack-g')?.value) || 0,
 houseNumbers: {
 baseGramsPerChar: parseFloat(document.getElementById('ship-hn-base')?.value) || 0,
 gramsPerMmPerChar: parseFloat(document.getElementById('ship-hn-mm')?.value) || 0,
 holesExtraGramsPerChar: parseFloat(document.getElementById('ship-hn-holes')?.value) || 0,
 note: 'Weight uses 3mm Corten silhouette estimate + formula. Tweak in Admin → Shipping.',
 },
 tiers: collectShipTiers(),
 };
}

function exampleWeight(heightMm, chars, holes) {
 const cfg = collectShippingConfig();
 let grams;
 if (typeof CortenShipping !== 'undefined' && CortenShipping.itemWeightGrams) {
 grams = CortenShipping.itemWeightGrams(
 {
 productId: 'house-numbers',
 type: 'House Numbers',
 size: String(heightMm) + ' mm',
 chars: 'X'.repeat(chars),
 charCount: chars,
 mount: holes ? 'holes' : 'clean',
 qty: 1,
 },
 cfg
 );
 } else {
 const hn = cfg.houseNumbers;
 let per = hn.baseGramsPerChar + heightMm * hn.gramsPerMmPerChar;
 if (holes) per += hn.holesExtraGramsPerChar;
 grams = Math.round(per * chars);
 }
 const kg = grams / 1000;
 let price = 0;
 for (const t of cfg.tiers) {
 if (kg <= t.maxWeightKg) {
 price = t.price;
 break;
 }
 }
 return { grams, price };
}

function updateShipExamples() {
 try {
 const a = exampleWeight(100, 3, false);
 const b = exampleWeight(200, 3, false);
 const c = exampleWeight(300, 3, true);
 const el100 = document.getElementById('ship-example-100');
 const el200 = document.getElementById('ship-example-200');
 const el300 = document.getElementById('ship-example-300');
 if (el100) el100.textContent = `100 mm × 3 chars clean: ~${a.grams} g → $${a.price} ship`;
 if (el200) el200.textContent = `200 mm × 3 chars clean: ~${b.grams} g → $${b.price} ship`;
 if (el300) el300.textContent = `300 mm × 3 chars holes: ~${c.grams} g → $${c.price} ship`;
 } catch (_) {}
}

async function saveShippingLive() {
 const msg = document.getElementById('ship-save-msg');
 const cfg = collectShippingConfig();
 if (msg) msg.textContent = 'Saving…';
 try {
 const { res, data } = await api('/api/shipping', {
 method: 'PUT',
 body: JSON.stringify({ config: cfg }),
 });
 if (!res.ok) throw new Error(data?.error || 'Save failed');
 shippingDraft = cfg;
 if (msg) msg.textContent = 'Saved live — cart will use these rates.';
 toast('Shipping rates saved live');
 } catch (e) {
 if (msg) msg.textContent = '';
 toast(String(e.message || e), true);
 }
}

/* —— Promo codes (Stripe) —— */
function updatePromoValueLabel() {
 const type = document.getElementById('promo-type')?.value;
 const label = document.getElementById('promo-value-label');
 const input = document.getElementById('promo-value');
 if (!label) return;
 if (type === 'amount') {
  label.textContent = 'Amount off ($ NZD) *';
  if (input) input.placeholder = '5.00';
 } else {
  label.textContent = 'Percent off *';
  if (input) input.placeholder = '10';
 }
}

function formatPromoDate(iso) {
 if (!iso) return '';
 try {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' });
 } catch {
  return '';
 }
}

async function loadPromoCodes() {
 const list = document.getElementById('promo-list');
 if (!list) return;
 list.innerHTML = '<p class="text-xs text-gray-600">Loading from Stripe…</p>';
 try {
  const { res, data } = await api('/api/promo-codes');
  if (!res.ok) throw new Error(data?.error || 'Failed to load codes');
  const codes = data?.codes || [];
  if (!codes.length) {
   list.innerHTML = '<p class="text-xs text-gray-600">No promotion codes yet. Create one on the left.</p>';
   return;
  }
  list.innerHTML = codes
   .map((c) => {
    const status = c.active
     ? '<span class="text-green-400">Active</span>'
     : '<span class="text-gray-500">Inactive</span>';
    const used =
     c.maxRedemptions != null
      ? `${c.timesRedeemed || 0} / ${c.maxRedemptions} used`
      : `${c.timesRedeemed || 0} used`;
    const exp = c.expiresAt ? ` · expires ${formatPromoDate(c.expiresAt)}` : '';
    const deactivateBtn = c.active
     ? `<button type="button" data-deactivate-promo="${escapeHtml(c.id)}" class="text-xs text-red-400 hover:text-red-300 ml-2">Deactivate</button>`
     : '';
    return `<div class="flex flex-wrap items-start justify-between gap-2 border border-gray-800 rounded-sm px-3 py-2 bg-metal-950/50">
 <div>
 <span class="font-mono text-white tracking-wide">${escapeHtml(c.code)}</span>
 <span class="text-gray-500 mx-1">·</span>
 <span class="text-corten-400">${escapeHtml(c.discount || '—')}</span>
 <div class="text-[11px] text-gray-500 mt-0.5">${status} · ${escapeHtml(used)}${escapeHtml(exp)}</div>
 </div>
 <div class="flex items-center">${deactivateBtn}</div>
 </div>`;
   })
   .join('');
  list.querySelectorAll('[data-deactivate-promo]').forEach((btn) => {
   btn.addEventListener('click', () => deactivatePromo(btn.dataset.deactivatePromo));
  });
 } catch (e) {
  list.innerHTML = `<p class="text-xs text-red-400">${escapeHtml(String(e.message || e))}</p>`;
 }
}

async function createPromoCode() {
 const msg = document.getElementById('promo-msg');
 const codeEl = document.getElementById('promo-code');
 const type = document.getElementById('promo-type')?.value || 'percent';
 const value = Number(document.getElementById('promo-value')?.value);
 const duration = document.getElementById('promo-duration')?.value || 'once';
 const maxRaw = document.getElementById('promo-max')?.value;
 const expiresAt = document.getElementById('promo-expires')?.value || '';
 const name = document.getElementById('promo-name')?.value || '';
 const code = String(codeEl?.value || '').trim();

 if (!code || code.length < 3) {
  toast('Code must be at least 3 letters/numbers', true);
  return;
 }
 if (!Number.isFinite(value) || value <= 0) {
  toast('Enter a discount value greater than 0', true);
  return;
 }

 if (msg) msg.textContent = 'Creating in Stripe…';
 const btn = document.getElementById('btn-create-promo');
 if (btn) btn.disabled = true;
 try {
  const body = {
   code,
   type,
   value,
   duration,
   name: name || undefined,
   expiresAt: expiresAt || undefined,
  };
  if (maxRaw !== '' && maxRaw != null) {
   const n = parseInt(maxRaw, 10);
   if (n > 0) body.maxRedemptions = n;
  }
  const { res, data } = await api('/api/promo-codes', {
   method: 'POST',
   body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(data?.error || 'Create failed');
  if (msg) {
   msg.textContent = `Created ${data.code} — ${data.discount}. Customers can type it at checkout.`;
   msg.className = 'text-xs text-green-400';
  }
  toast(`Promo ${data.code} live`);
  if (codeEl) codeEl.value = '';
  const valEl = document.getElementById('promo-value');
  if (valEl) valEl.value = '';
  await loadPromoCodes();
 } catch (e) {
  if (msg) {
   msg.textContent = String(e.message || e);
   msg.className = 'text-xs text-red-400';
  }
  toast(String(e.message || e), true);
 } finally {
  if (btn) btn.disabled = false;
 }
}

async function deactivatePromo(id) {
 if (!id) return;
 if (!confirm('Deactivate this promo code? Customers will no longer be able to use it.')) return;
 try {
  const { res, data } = await api('/api/promo-codes', {
   method: 'PUT',
   body: JSON.stringify({ id, active: false }),
  });
  if (!res.ok) throw new Error(data?.error || 'Deactivate failed');
  toast(`Deactivated ${data.code || id}`);
  await loadPromoCodes();
 } catch (e) {
  toast(String(e.message || e), true);
 }
}

/* —— Privacy screen pricing admin —— */
let privacyDraft = null;

function slugColourId(label) {
 return String(label || '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '')
  .slice(0, 40) || 'colour-' + Date.now().toString(36);
}

async function loadPrivacyAdmin() {
 try {
  const { res, data } = await api('/api/privacy-settings', { headers: {} });
  if (res.ok && data?.config) {
   privacyDraft = data.config;
  } else if (typeof defaultPrivacyConfig === 'function') {
   privacyDraft = defaultPrivacyConfig();
  } else {
   privacyDraft = { materials: [], thicknesses: [], sizes: [], powdercoat: { colours: [], price: 0, enabled: true } };
  }
 } catch {
  privacyDraft = typeof defaultPrivacyConfig === 'function' ? defaultPrivacyConfig() : {};
 }
 fillPrivacyAdminForm(privacyDraft);
}

function fillPrivacyAdminForm(cfg) {
 const c = cfg || {};
 const pc = c.powdercoat || {};
 const en = document.getElementById('priv-pc-enabled');
 if (en) en.checked = pc.enabled !== false;
 const ac = document.getElementById('priv-pc-corten');
 if (ac) ac.checked = pc.allowOnCorten !== false;
 const pr = document.getElementById('priv-pc-price');
 if (pr) pr.value = pc.price != null ? pc.price : 85;

 // Materials table
 const matBox = document.getElementById('priv-materials-body');
 if (matBox) {
  matBox.innerHTML = (c.materials || [])
   .map(
    (m, i) => `
 <tr data-priv-mat="${i}" class="border-t border-gray-800">
 <td class="py-2 pr-2">
  <input type="text" data-mat-label value="${escapeHtml(m.label || '')}" class="w-full min-w-[8rem] bg-metal-900 border border-gray-700 rounded-sm px-2 py-1.5 text-white text-sm">
  <span class="text-[10px] text-gray-600 font-mono">${escapeHtml(m.id || '')}</span>
 </td>
 <td class="py-2 pr-2">
  <div class="flex items-center gap-1">
   <span class="text-xs text-gray-500">+$</span>
   <input type="number" data-mat-adder step="1" value="${Number(m.adder) || 0}" class="w-28 bg-metal-900 border border-gray-700 rounded-sm px-2 py-1.5 text-white text-sm font-semibold text-corten-400">
  </div>
 </td>
 <td class="py-2 text-center"><input type="checkbox" data-mat-on ${m.enabled !== false ? 'checked' : ''} class="rounded border-gray-600 text-corten-600"></td>
 </tr>`
   )
   .join('');
 }

 // Thickness table
 const thBox = document.getElementById('priv-thickness-body');
 if (thBox) {
  thBox.innerHTML = (c.thicknesses || [])
   .map(
    (t, i) => `
 <tr data-priv-th="${i}" class="border-t border-gray-800">
 <td class="py-2 pr-2"><input type="text" data-th-label value="${escapeHtml(t.label || '')}" placeholder="3 mm" class="w-full min-w-[6rem] bg-metal-900 border border-gray-700 rounded-sm px-2 py-1.5 text-white text-sm"></td>
 <td class="py-2 pr-2"><input type="number" data-th-mm step="0.1" min="0" value="${t.mm != null ? t.mm : ''}" placeholder="3" class="w-24 bg-metal-900 border border-gray-700 rounded-sm px-2 py-1.5 text-white text-sm"></td>
 <td class="py-2 pr-2">
  <div class="flex items-center gap-1">
   <span class="text-xs text-gray-500">+$</span>
   <input type="number" data-th-adder step="1" value="${Number(t.adder) || 0}" class="w-28 bg-metal-900 border border-gray-700 rounded-sm px-2 py-1.5 text-white text-sm font-semibold text-corten-400">
  </div>
 </td>
 <td class="py-2 pr-2 text-center"><input type="checkbox" data-th-on ${t.enabled !== false ? 'checked' : ''} class="rounded border-gray-600 text-corten-600"></td>
 <td class="py-2"><button type="button" data-th-del="${i}" class="text-xs text-gray-500 hover:text-red-400">Remove</button></td>
 </tr>`
   )
   .join('');
  thBox.querySelectorAll('[data-th-del]').forEach((btn) => {
   btn.addEventListener('click', () => {
    const i = parseInt(btn.dataset.thDel, 10);
    privacyDraft = collectPrivacyConfig();
    privacyDraft.thicknesses.splice(i, 1);
    fillPrivacyAdminForm(privacyDraft);
   });
  });
 }

 // Sizes table
 const szBody = document.getElementById('priv-sizes-body');
 if (szBody) {
  szBody.innerHTML = (c.sizes || [])
   .map(
    (s, i) => `
 <tr data-priv-sz="${i}" class="border-t border-gray-800">
 <td class="py-2 pr-2"><input type="text" data-sz-label value="${escapeHtml(s.label || '')}" placeholder="Standard" class="w-full min-w-[5rem] bg-metal-900 border border-gray-700 rounded-sm px-2 py-1.5 text-white text-sm"></td>
 <td class="py-2 pr-2"><input type="text" data-sz-size value="${escapeHtml(s.size || '')}" placeholder="1800 × 900 mm" class="w-full min-w-[9rem] bg-metal-900 border border-gray-700 rounded-sm px-2 py-1.5 text-white text-sm"></td>
 <td class="py-2 pr-2">
  <div class="flex items-center gap-1">
   <span class="text-xs text-gray-500">$</span>
   <input type="number" data-sz-price step="1" min="0" value="${Number(s.price) || 0}" class="w-28 bg-metal-900 border border-gray-700 rounded-sm px-2 py-1.5 text-white text-sm font-semibold text-corten-400">
  </div>
 </td>
 <td class="py-2 pr-2 text-center"><input type="checkbox" data-sz-on ${s.enabled !== false ? 'checked' : ''} class="rounded border-gray-600 text-corten-600"></td>
 <td class="py-2 pr-2 text-center"><input type="checkbox" data-sz-quote ${s.quoteOnly ? 'checked' : ''} class="rounded border-gray-600 text-corten-600" title="Quote only (no fixed price)"></td>
 <td class="py-2"><button type="button" data-sz-del="${i}" class="text-xs text-gray-500 hover:text-red-400">Remove</button></td>
 </tr>`
   )
   .join('');
  szBody.querySelectorAll('[data-sz-del]').forEach((btn) => {
   btn.addEventListener('click', () => {
    const i = parseInt(btn.dataset.szDel, 10);
    privacyDraft = collectPrivacyConfig();
    privacyDraft.sizes.splice(i, 1);
    fillPrivacyAdminForm(privacyDraft);
   });
  });
 }

 // Colours
 const colBox = document.getElementById('priv-colours-body');
 if (colBox) {
  colBox.innerHTML = (pc.colours || [])
   .map(
    (col, i) => `
 <label class="flex items-center gap-2 text-sm text-gray-300 border border-gray-800 rounded-sm px-2 py-1.5 bg-metal-950/40">
 <input type="checkbox" data-col-on data-col-i="${i}" ${col.enabled !== false ? 'checked' : ''} class="rounded border-gray-600 text-corten-600">
 <span class="truncate">${escapeHtml(col.label || col.id)}</span>
 </label>`
   )
   .join('');
 }
}

function collectPrivacyConfig() {
 const base =
  privacyDraft && typeof privacyDraft === 'object'
   ? JSON.parse(JSON.stringify(privacyDraft))
   : typeof defaultPrivacyConfig === 'function'
     ? defaultPrivacyConfig()
     : {};

 const materials = [];
 document.querySelectorAll('[data-priv-mat]').forEach((row, i) => {
  const prev = (base.materials || [])[i] || {};
  materials.push({
   id: prev.id || slugColourId(row.querySelector('[data-mat-label]')?.value),
   label: row.querySelector('[data-mat-label]')?.value.trim() || prev.label || 'Material',
   enabled: !!row.querySelector('[data-mat-on]')?.checked,
   adder: Number(row.querySelector('[data-mat-adder]')?.value) || 0,
  });
 });

 const thicknesses = [];
 document.querySelectorAll('[data-priv-th]').forEach((row, i) => {
  const prev = (base.thicknesses || [])[i] || {};
  const mmVal = Number(row.querySelector('[data-th-mm]')?.value);
  const mm = Number.isFinite(mmVal) && mmVal > 0 ? mmVal : prev.mm || 0;
  const label =
   row.querySelector('[data-th-label]')?.value.trim() ||
   (mm ? mm + ' mm' : prev.label || 'Thickness');
  const id = prev.id && String(prev.mm) === String(mm) ? prev.id : String(mm || prev.id || i);
  thicknesses.push({
   id,
   label,
   mm,
   enabled: !!row.querySelector('[data-th-on]')?.checked,
   adder: Number(row.querySelector('[data-th-adder]')?.value) || 0,
  });
 });

 const sizes = [];
 document.querySelectorAll('[data-priv-sz]').forEach((row, i) => {
  const prev = (base.sizes || [])[i] || {};
  sizes.push({
   id: prev.id || 'sz-' + i + '-' + Date.now().toString(36),
   label: row.querySelector('[data-sz-label]')?.value.trim() || 'Size',
   size: row.querySelector('[data-sz-size]')?.value.trim() || '',
   price: Number(row.querySelector('[data-sz-price]')?.value) || 0,
   enabled: !!row.querySelector('[data-sz-on]')?.checked,
   quoteOnly: !!row.querySelector('[data-sz-quote]')?.checked,
  });
 });

 const colours = (base.powdercoat?.colours || []).map((col, i) => {
  const cb = document.querySelector(`[data-col-on][data-col-i="${i}"]`);
  return {
   ...col,
   enabled: cb ? !!cb.checked : col.enabled !== false,
  };
 });

 return {
  ...base,
  materials,
  thicknesses,
  sizes,
  powdercoat: {
   ...(base.powdercoat || {}),
   enabled: !!document.getElementById('priv-pc-enabled')?.checked,
   allowOnCorten: !!document.getElementById('priv-pc-corten')?.checked,
   price: Number(document.getElementById('priv-pc-price')?.value) || 0,
   label: base.powdercoat?.label || 'Powder coated (Dulux)',
   colours,
  },
 };
}

async function savePrivacyLive() {
 const msg = document.getElementById('priv-save-msg');
 const cfg = collectPrivacyConfig();
 if (msg) msg.textContent = 'Saving…';
 try {
  const { res, data } = await api('/api/privacy-settings', {
   method: 'PUT',
   body: JSON.stringify({ config: cfg }),
  });
  if (!res.ok) throw new Error(data?.error || 'Save failed');
  privacyDraft = data.config || cfg;
  if (msg) msg.textContent = 'Saved live — privacy panel configurator will use these prices.';
  toast('Privacy pricing saved live');
 } catch (e) {
  if (msg) msg.textContent = '';
  toast(String(e.message || e), true);
 }
}

function addPrivacySizeRow() {
 privacyDraft = collectPrivacyConfig();
 if (!Array.isArray(privacyDraft.sizes)) privacyDraft.sizes = [];
 privacyDraft.sizes.push({
  id: 'sz-' + Date.now().toString(36),
  label: 'New size',
  size: '1800 × 900 mm',
  price: 0,
  enabled: true,
  quoteOnly: false,
 });
 fillPrivacyAdminForm(privacyDraft);
}

function addPrivacyThicknessRow() {
 privacyDraft = collectPrivacyConfig();
 if (!Array.isArray(privacyDraft.thicknesses)) privacyDraft.thicknesses = [];
 privacyDraft.thicknesses.push({
  id: 'th-' + Date.now().toString(36),
  label: 'New',
  mm: 0,
  adder: 0,
  enabled: true,
 });
 fillPrivacyAdminForm(privacyDraft);
}

function addPrivacyColour() {
 const input = document.getElementById('priv-colour-new');
 const label = (input?.value || '').trim();
 if (!label) {
  toast('Enter a colour name', true);
  return;
 }
 privacyDraft = collectPrivacyConfig();
 if (!privacyDraft.powdercoat) privacyDraft.powdercoat = { colours: [] };
 if (!Array.isArray(privacyDraft.powdercoat.colours)) privacyDraft.powdercoat.colours = [];
 const id = slugColourId(label);
 if (privacyDraft.powdercoat.colours.some((c) => c.id === id || c.label === label)) {
  toast('That colour is already listed', true);
  return;
 }
 privacyDraft.powdercoat.colours.push({ id, label, enabled: true });
 if (input) input.value = '';
 fillPrivacyAdminForm(privacyDraft);
}

async function bootAdmin() {
 await refreshCloudStatus();
 await loadCatalogue();
 renderList();
 const prices = await loadHnPrices();
 renderHnPricing(prices);
 await loadShippingAdmin();
 await loadPrivacyAdmin();
}

document.addEventListener('DOMContentLoaded', async () => {
 await refreshCloudStatus();

 if (isLoggedIn()) {
 showApp();
 await bootAdmin();
 } else {
 showLogin();
 }

 document.getElementById('login-form')?.addEventListener('submit', async (e) => {
 e.preventDefault();
 const pass = document.getElementById('login-pass').value;
 const err = document.getElementById('login-error');
 err.classList.add('hidden');

 // Prefer cloud auth when ADMIN_PASSWORD is configured
 if (cloudStatus.hasAdminPassword) {
 sessionStorage.setItem(STORAGE_PASS, pass);
 const { res, data } = await api('/api/auth', { method: 'POST', body: '{}' });
 if (res.ok) {
 setLoggedIn(pass);
 showApp();
 await bootAdmin();
 return;
 }
 sessionStorage.removeItem(STORAGE_PASS);
 err.textContent = data?.error === 'Unauthorized' ? 'Incorrect password' : (data?.error || 'Login failed');
 err.classList.remove('hidden');
 return;
 }

 // Local fallback hash
 const hash = await sha256(pass);
 if (hash === getPassHash()) {
 setLoggedIn(pass);
 showApp();
 await bootAdmin();
 } else {
 err.textContent = 'Incorrect password';
 err.classList.remove('hidden');
 }
 });

 document.getElementById('btn-logout')?.addEventListener('click', () => {
 clearSession();
 showLogin();
 });

 document.getElementById('btn-add')?.addEventListener('click', () => openEditor(null));
 document.getElementById('list-filter-cat')?.addEventListener('change', () => renderList());
 document.getElementById('list-filter-q')?.addEventListener('input', () => renderList());
 document.getElementById('btn-add-size')?.addEventListener('click', () => {
  syncPendingSizesFromDom();
  pendingSizes.push({
   id: 'sz-' + Date.now(),
   label: '',
   size: '',
   price: '',
  });
  renderSizeRows();
 });
 document.getElementById('f-category')?.addEventListener('change', updateSizesEditorVisibility);
 document.getElementById('f-price')?.addEventListener('change', () => renderQrPayRows());
 document.getElementById('f-name')?.addEventListener('change', () => renderQrPayRows());
 document.getElementById('btn-qr-custom-create')?.addEventListener('click', createCustomQrFromEditor);
 document.getElementById('qr-custom-price')?.addEventListener('input', updateCustomQrInclHint);
 document.getElementById('qr-custom-incl-gst')?.addEventListener('change', updateCustomQrInclHint);
 document.getElementById('btn-quick-qr')?.addEventListener('click', createQuickQr);
 document.getElementById('quick-qr-price')?.addEventListener('input', updateQuickQrInclHint);
 document.getElementById('quick-qr-incl-gst')?.addEventListener('change', updateQuickQrInclHint);
 document.getElementById('btn-cancel-edit')?.addEventListener('click', closeEditor);
 document.getElementById('btn-save-product')?.addEventListener('click', () => saveProductFromForm());

 document.getElementById('btn-publish')?.addEventListener('click', () => publishLive());
 document.getElementById('btn-save-draft')?.addEventListener('click', () => {
 saveDraftLocal();
 toast('Draft saved on this device');
 });
 document.getElementById('btn-export-js')?.addEventListener('click', () => {
 downloadText('products.js', buildProductsJs(catalogue));
 toast('Downloaded products.js (optional backup)');
 });

 document.getElementById('btn-reset-seed')?.addEventListener('click', async () => {
 if (!confirm('Reset catalogue from built-in products.js?')) return;
 localStorage.removeItem(STORAGE_PRODUCTS);
 if (typeof window.products !== 'undefined') {
 catalogue = JSON.parse(JSON.stringify(window.products));
 } else catalogue = [];
 saveDraftLocal();
 renderList();
 toast('Reset to seed catalogue (not published yet)');
 });

 document.getElementById('import-file')?.addEventListener('change', (e) => {
 const f = e.target.files?.[0];
 if (!f) return;
 const reader = new FileReader();
 reader.onload = () => {
 try {
 let text = reader.result;
 if (typeof text === 'string' && text.includes('const products')) {
 const m = text.match(/const products\s*=\s*(\[[\s\S]*?\]);/);
 if (!m) throw new Error('Could not parse products array');
 text = m[1];
 }
 const arr = JSON.parse(text);
 if (!Array.isArray(arr)) throw new Error('Expected an array');
 catalogue = arr;
 saveDraftLocal();
 renderList();
 toast('Imported ' + arr.length + ' products — click Publish live to go online');
 } catch (err) {
 alert('Import failed: ' + err.message);
 }
 };
 reader.readAsText(f);
 e.target.value = '';
 });

 document.getElementById('photo-input')?.addEventListener('change', async (e) => {
 const files = Array.from(e.target.files || []);
 for (const file of files) {
 if (!file.type.startsWith('image/')) continue;
 try {
 let dataUrl = await compressImage(file);
 // Upload immediately when cloud is ready
 if (cloudStatus.hasGithub || cloudStatus.cloud) {
 try {
 dataUrl = await uploadToCloud(dataUrl, file.name);
 } catch (upErr) {
 toast('Cloud upload failed, kept local preview: ' + upErr.message, true);
 }
 }
 pendingImages.push({ src: dataUrl, label: file.name.replace(/\.[^.]+$/, '') });
 } catch (err) {
 alert('Image failed: ' + err.message);
 }
 }
 renderSlidePreviews();
 e.target.value = '';
 toast('Photo(s) added');
 });

 document.getElementById('btn-save-hn')?.addEventListener('click', async () => {
 try {
 await saveHnPricesCloud(collectHnPricing());
 } catch (e) {
 toast(String(e.message || e), true);
 }
 });

 document.getElementById('ship-add-tier')?.addEventListener('click', () => {
 const tiers = collectShipTiers();
 tiers.push({ maxWeightKg: 10, price: 40 });
 renderShipTiers(tiers);
 updateShipExamples();
 });
 document.getElementById('btn-save-shipping')?.addEventListener('click', () => saveShippingLive());
 [
 'ship-hn-base',
 'ship-hn-mm',
 'ship-hn-holes',
 'ship-corten-kg',
 'ship-fill',
 'ship-pack-g',
 'ship-enabled',
 'ship-label',
 'ship-free-over',
 'ship-default-g',
 'ship-rural-surcharge',
 ].forEach((id) => {
 document.getElementById(id)?.addEventListener('input', updateShipExamples);
 document.getElementById(id)?.addEventListener('change', updateShipExamples);
 });

 document.getElementById('btn-change-pass')?.addEventListener('click', async () => {
 const next = document.getElementById('new-pass').value;
 const conf = document.getElementById('new-pass-conf').value;
 if (cloudStatus.hasAdminPassword) {
 alert('Cloud password is set in Cloudflare Pages → Settings → Environment variables (ADMIN_PASSWORD). Change it there.');
 return;
 }
 if (!next || next.length < 8) {
 alert('Password must be at least 8 characters');
 return;
 }
 if (next !== conf) {
 alert('Passwords do not match');
 return;
 }
 localStorage.setItem(STORAGE_PASS_HASH, await sha256(next));
 document.getElementById('new-pass').value = '';
 document.getElementById('new-pass-conf').value = '';
 toast('Local password updated for this browser');
 });

 document.querySelectorAll('button[data-tab], a[data-tab]').forEach((btn) => {
 btn.addEventListener('click', (e) => {
  e.preventDefault();
  switchTab(btn.dataset.tab);
 });
 });

 document.getElementById('btn-create-promo')?.addEventListener('click', () => createPromoCode());
 document.getElementById('btn-refresh-promo')?.addEventListener('click', () => loadPromoCodes());
 document.getElementById('promo-type')?.addEventListener('change', updatePromoValueLabel);
 updatePromoValueLabel();

 document.getElementById('btn-save-privacy')?.addEventListener('click', () => savePrivacyLive());
 document.getElementById('btn-priv-add-size')?.addEventListener('click', () => addPrivacySizeRow());
 document.getElementById('btn-priv-add-thickness')?.addEventListener('click', () => addPrivacyThicknessRow());
 document.getElementById('btn-priv-add-colour')?.addEventListener('click', () => addPrivacyColour());
 document.getElementById('priv-colour-new')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
   e.preventDefault();
   addPrivacyColour();
  }
 });

 // Open Privacy prices from Products shortcuts
 const goPrivacy = () => switchTab('privacy');
 document.getElementById('btn-goto-privacy-pricing')?.addEventListener('click', goPrivacy);
 document.getElementById('btn-goto-privacy-pricing-2')?.addEventListener('click', goPrivacy);

 // Deep link: /admin#privacy or /admin?tab=privacy
 if (isLoggedIn()) {
  const params = new URLSearchParams(location.search);
  const tabFromQuery = params.get('tab');
  const tabFromHash = (location.hash || '').replace(/^#/, '');
  const startTab = tabFromQuery || tabFromHash;
  if (startTab && document.querySelector(`[data-tab-panel="${startTab}"]`)) {
   switchTab(startTab);
  }
 }
});
