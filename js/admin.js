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
let cloudStatus = { cloud: false, hasGithub: false, hasAdminPassword: false, storage: 'none' };

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

async function loadCatalogue() {
 // 1) Cloud
 try {
 const { res, data } = await api('/api/products', { headers: {} });
 if (res.ok && Array.isArray(data?.products) && data.products.length) {
 catalogue = data.products;
 localStorage.setItem(STORAGE_PRODUCTS, JSON.stringify(catalogue));
 return;
 }
 } catch (_) {}

 // 2) Local draft
 try {
 const raw = localStorage.getItem(STORAGE_PRODUCTS);
 if (raw) {
 catalogue = JSON.parse(raw);
 return;
 }
 } catch (_) {}

 // 3) Seed from products.js
 if (typeof window.products !== 'undefined' && Array.isArray(window.products)) {
 catalogue = JSON.parse(JSON.stringify(window.products));
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
 slides: pendingImages.map((s) => ({ src: s.src, label: s.label || '' })),
 };
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
 const idx = catalogue.findIndex((p) => p.id === (editingId || finalProduct.id));
 if (idx >= 0) catalogue[idx] = finalProduct;
 else catalogue.push(finalProduct);
 saveDraftLocal();
 if (cloudStatus.hasGithub || cloudStatus.cloud) {
 const { res, data } = await api('/api/products', {
 method: 'PUT',
 body: JSON.stringify({ products: catalogue }),
 });
 if (!res.ok) throw new Error(data?.error || 'Cloud save failed');
 toast('Product saved live for everyone');
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

async function bootAdmin() {
 await refreshCloudStatus();
 await loadCatalogue();
 renderList();
 const prices = await loadHnPrices();
 renderHnPricing(prices);
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

 document.querySelectorAll('[data-tab]').forEach((btn) => {
 btn.addEventListener('click', () => switchTab(btn.dataset.tab));
 });
});
