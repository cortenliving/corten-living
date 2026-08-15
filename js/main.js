/* Corten Living — shared site logic */

const CART_KEY = 'cortenCart';
const PUBLISHED_PRODUCTS_KEY = 'cortenProductsPublished';
const HN_PRICES_KEY = 'cortenHouseNumberPrices';

/**
 * Prefer site CDN paths over raw.githubusercontent.com (slow, poor cache).
 * Rewrites …/images/live/x.jpg → /images/live/x.jpg
 */
function normalizeImageUrl(url) {
 if (!url || typeof url !== 'string') return url;
 if (url.startsWith('data:')) return url;
 const m = url.match(
  /^https?:\/\/raw\.githubusercontent\.com\/[^/]+\/[^/]+\/[^/]+\/(images\/live\/[^?#]+)/i
 );
 if (m) return '/' + m[1];
 // Already absolute github pages or other — leave alone
 return url;
}

function normalizeProductImages(p) {
 if (!p || typeof p !== 'object') return p;
 const out = { ...p };
 if (out.image) out.image = normalizeImageUrl(out.image);
 if (Array.isArray(out.slides)) {
  out.slides = out.slides.map((s) =>
   s && typeof s === 'object' ? { ...s, src: normalizeImageUrl(s.src) } : s
  );
 }
 return out;
}

function normalizeProductList(list) {
 if (!Array.isArray(list)) return list;
 return list.map(normalizeProductImages);
}

function seedProducts() {
 return typeof products !== 'undefined' && Array.isArray(products) ? products : [];
}

/** Sync snapshot: localStorage publish or products.js */
function loadActiveProducts() {
 try {
 const raw = localStorage.getItem(PUBLISHED_PRODUCTS_KEY);
 if (raw) {
 const list = normalizeProductList(JSON.parse(raw));
 if (Array.isArray(list) && list.length) {
 window.products = list;
 return list;
 }
 }
 } catch (_) {}
 const seed = seedProducts();
 window.products = seed;
 return seed;
}

/**
 * Prefer cloud catalogue (everyone sees admin publishes), then localStorage, then products.js.
 */
async function loadActiveProductsAsync() {
 try {
 const res = await fetch('/api/products', { headers: { Accept: 'application/json' } });
 if (res.ok) {
 const data = await res.json();
 if (Array.isArray(data.products) && data.products.length) {
 const list = normalizeProductList(data.products);
 window.products = list;
 try {
 localStorage.setItem(PUBLISHED_PRODUCTS_KEY, JSON.stringify(list));
 } catch (_) {}
 return list;
 }
 }
 } catch (_) {}
 return loadActiveProducts();
}

function getCart() {
 try {
 return JSON.parse(localStorage.getItem(CART_KEY) || '[]');
 } catch {
 return [];
 }
}

function setCart(cart) {
 localStorage.setItem(CART_KEY, JSON.stringify(cart));
 updateCartCount();
}

function updateCartCount() {
 const cart = getCart();
 document.querySelectorAll('[data-cart-count]').forEach((el) => {
 if (cart.length > 0) {
 el.textContent = String(cart.length);
 el.classList.remove('hidden');
 el.removeAttribute('hidden');
 } else {
 el.textContent = '0';
 el.classList.add('hidden');
 }
 });
}

function initMobileMenu() {
 const btn = document.getElementById('mobile-menu-btn');
 const menu = document.getElementById('mobile-menu');
 if (!btn || !menu) return;
 btn.addEventListener('click', () => {
 const open = menu.classList.toggle('hidden') === false;
 btn.setAttribute('aria-expanded', open ? 'true' : 'false');
 });
}

function startSlideShow(container) {
 const slides = container.querySelectorAll('.slide');
 if (slides.length < 2) return;
 let i = 0;
 const ms = parseInt(container.dataset.interval || '4000', 10);
 setInterval(() => {
 slides[i].classList.remove('opacity-100');
 slides[i].classList.add('opacity-0');
 i = (i + 1) % slides.length;
 slides[i].classList.remove('opacity-0');
 slides[i].classList.add('opacity-100');
 }, ms);
}

/** House numbers use the dedicated configurator; everything else uses /product?id= */
function isHouseNumberProduct(p) {
 if (!p) return false;
 if (p.id === 'house-numbers') return true;
 if (String(p.category || '').toLowerCase() === 'numbers') return true;
 const link = String(p.link || '');
 if (link.includes('house-numbers')) return true;
 const name = String(p.name || '').toLowerCase();
 return name.includes('house number');
}

function productHref(p) {
 if (isHouseNumberProduct(p)) return p.link || '/house-numbers';
 if (p && p.id) return '/product?id=' + encodeURIComponent(p.id);
 return '/shop';
}

/**
 * Size options for shop products (not house numbers).
 * Uses product.sizes from Admin — every size you add on that product shows as a choice.
 * If no sizes saved yet, falls back to one option from the product’s main size/price.
 */
function getProductSizes(p) {
 if (!p) return [];
 if (isHouseNumberProduct(p)) return [];
 if (Array.isArray(p.sizes) && p.sizes.length) {
 return p.sizes.map((s, i) => ({
 id: s.id || ('sz-' + i),
 label: s.label || s.size || ('Size ' + (i + 1)),
 size: s.size || s.label || '',
 price: Number(s.price) || 0,
 }));
 }
 // Single fallback so old products still work until sizes are set in Admin
 const base = Number(p.price) || 0;
 const listed = String(p.size || '').trim() || 'Standard';
 return [{ id: 'std', label: 'Standard', size: listed, price: base }];
}

/** Rough scale for labels like "500 × 600 mm" or "300 mm" */
function scaleSizeLabel(label, factor) {
 const s = String(label || '');
 if (!s || /various|custom|up to/i.test(s)) {
 if (factor < 0.9) return 'Small';
 if (factor > 1.1) return 'Large';
 return s || 'Medium';
 }
 const nums = s.match(/\d+/g);
 if (!nums || !nums.length) return s;
 let i = 0;
 return s.replace(/\d+/g, () => {
 const n = Math.round(parseInt(nums[i++], 10) * factor);
 return String(n);
 });
}

/** Cached privacy settings for shop card “From $…” */
let _shopPrivacyCfg = null;

/** Display price for cards: always prefer lowest size option when sizes exist */
function productPriceDisplay(p) {
 if (!p) return '';
 // Privacy panels use global configurator pricing
 if (typeof isPrivacyProduct === 'function' ? isPrivacyProduct(p) : p.category === 'privacy') {
  if (_shopPrivacyCfg && typeof privacyFromPrice === 'function') {
   const from = privacyFromPrice(_shopPrivacyCfg);
   if (from != null && from > 0) return 'From $' + from;
  }
  if (p.priceLabel && String(p.priceLabel).trim()) return p.priceLabel;
  return 'Configure';
 }
 if (!isHouseNumberProduct(p) && Array.isArray(p.sizes) && p.sizes.length) {
  const prices = p.sizes.map((s) => Number(s.price)).filter((n) => !Number.isNaN(n) && n > 0);
  if (prices.length) {
   const minP = Math.min(...prices);
   const maxP = Math.max(...prices);
   return minP === maxP ? ('$' + minP) : ('From $' + minP);
  }
 }
 // House numbers / single-price products
 if (p.priceLabel && String(p.priceLabel).trim()) {
  // If label is stale "From $X" but p.price is lower, trust numeric price when no sizes
  // (sizes case handled above)
  return p.priceLabel;
 }
 if (p.price != null && p.price !== '') return '$' + p.price;
 return '';
}

function productCardHTML(p, options = {}) {
 const compact = options.compact;
 const href = productHref(p);
 const priceText = productPriceDisplay(p);
 const hasSlides = p.slides && p.slides.length;
 const firstImg = (hasSlides && p.slides[0].src) || p.image || '';
 const isHN = isHouseNumberProduct(p);

 // Slideshow for multi-photo products (featured + shop). Featured uses 3s interval.
 const slideMs = compact ? 3000 : 4200;
 let media;
 if (hasSlides && p.slides.length > 1) {
 media = `<div class="product-slides relative w-full h-full" data-interval="${slideMs}">
 ${p.slides.map((s, i) => `
 <div class="slide absolute inset-0 transition-opacity duration-700 ${i === 0 ? 'opacity-100' : 'opacity-0'}">
 <img src="${s.src}" alt="${s.label || p.name}" class="w-full h-full object-contain" loading="${i === 0 ? 'eager' : 'lazy'}"
 onerror="this.onerror=null;this.src='';this.parentElement.querySelector('.fallback')?.classList.remove('hidden')">
 <div class="fallback hidden absolute inset-0 flex flex-col items-center justify-center bg-metal-950">
 <span class="font-display text-3xl text-corten-600/70">${p.name.charAt(0)}</span>
 </div>
 </div>`).join('')}
 </div>`;
 } else if (hasSlides && p.slides.length === 1) {
 media = `<img src="${p.slides[0].src}" alt="${p.name}" class="w-full h-full object-contain" loading="lazy"
 onerror="this.style.display='none';this.nextElementSibling?.classList.remove('hidden')">
 <div class="fallback hidden absolute inset-0 flex items-center justify-center bg-metal-950">
 <span class="font-display text-3xl text-corten-600/70">${p.name.charAt(0)}</span>
 </div>`;
 } else if (firstImg) {
 media = `<img src="${firstImg}" alt="${p.name}" class="w-full h-full object-contain" loading="lazy"
 onerror="this.style.display='none';this.nextElementSibling?.classList.remove('hidden')">
 <div class="fallback hidden absolute inset-0 flex items-center justify-center bg-metal-950">
 <span class="font-display text-3xl text-corten-600/70">${p.name.charAt(0)}</span>
 </div>`;
 } else {
 media = `<div class="w-full h-full flex items-center justify-center bg-metal-950">
 <span class="font-display text-3xl text-corten-600/70">${p.name.charAt(0)}</span>
 </div>`;
 }

 const cta = isHN ? 'Configure & Preview →' : 'Choose size →';
 const descHtml = compact
 ? ''
 : `<p class="text-sm text-gray-400 mt-3 leading-relaxed line-clamp-4 whitespace-pre-line">${p.desc || ''}</p>`;

 const tagHtml = p.tag
  ? `<span class="absolute top-3 left-3 z-10 text-[10px] uppercase tracking-wider bg-corten-600 text-white px-2 py-0.5 rounded-sm">${String(p.tag)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/"/g, '&quot;')}</span>`
  : '';

 return `
 <article class="product-card group bg-metal-850 border border-corten-900/40 rounded-sm overflow-hidden transition-all duration-300">
 <a href="${href}" class="block aspect-[4/3] bg-metal-950 relative overflow-hidden flex items-center justify-center">
 ${media}
 ${tagHtml}
 </a>
 <div class="p-5">
 <div class="flex justify-between items-start gap-2">
 <h3 class="font-display text-lg text-white tracking-wide">
 <a href="${href}" class="hover:text-corten-400 transition">${p.name}</a>
 </h3>
 <p class="text-corten-400 font-semibold whitespace-nowrap">${priceText}</p>
 </div>
 <p class="text-xs text-gray-400 mt-1">${p.size} · 3 mm Corten</p>
 ${descHtml}
 <a href="${href}" class="mt-4 inline-block text-sm text-corten-500 hover:text-corten-400 font-medium">${cta}</a>
 </div>
 </article>`;
}

function renderProducts(filter = 'all') {
 const grid = document.getElementById('product-grid');
 const list = loadActiveProducts();
 if (!grid) return;

 const filtered = filter === 'all'
 ? list
 : list.filter((p) => p.category === filter);

 if (filtered.length === 0) {
 grid.innerHTML = `<p class="col-span-full text-center text-gray-400 py-12">No products in this category yet. <a href="/house-numbers" class="text-corten-500 hover:underline">Configure House Numbers</a> or <a href="/quote" class="text-corten-500 hover:underline">request a custom cut</a>.</p>`;
 return;
 }

 grid.innerHTML = filtered.map((p) => productCardHTML(p)).join('');
 grid.querySelectorAll('.product-slides').forEach(startSlideShow);
}

function filterProducts(cat, opts) {
 const skipUrl = opts && opts.skipUrl;
 document.querySelectorAll('.filter-btn').forEach((btn) => {
 const active = btn.dataset.filter === cat;
 btn.classList.toggle('active', active);
 btn.classList.toggle('border-corten-700', active);
 btn.classList.toggle('text-corten-400', active);
 btn.classList.toggle('border-gray-700', !active);
 btn.classList.toggle('text-gray-400', !active);
 });
 renderProducts(cat);
 // Keep shop URL in sync so Back links can return to this filter
 if (!skipUrl && document.getElementById('product-grid')) {
  try {
   const url = new URL(location.href);
   if (cat && cat !== 'all') {
    url.searchParams.set('filter', cat);
   } else {
    url.searchParams.delete('filter');
   }
   history.replaceState(null, '', url.pathname + url.search + (url.hash || ''));
  } catch (_) {}
 }
}

/** Read ?filter=privacy or #privacy on shop page */
function getShopFilterFromUrl() {
 try {
  const params = new URLSearchParams(location.search);
  const q = (params.get('filter') || params.get('category') || '').trim().toLowerCase();
  if (q) return q;
  const hash = (location.hash || '').replace(/^#/, '').trim().toLowerCase();
  if (hash && hash !== 'main') return hash;
 } catch (_) {}
 return 'all';
}

function renderFeatured() {
 const grid = document.getElementById('featured-grid');
 if (!grid) return;
 const all = loadActiveProducts();
 const featured = all.filter((p) => p.featured).slice(0, 4);
 const list = featured.length ? featured : all.slice(0, 4);
 grid.innerHTML = list.map((p) => productCardHTML(p, { compact: true })).join('');
 grid.querySelectorAll('.product-slides').forEach(startSlideShow);
}

/* Quick estimator (quote page) */
function initEstimator() {
 const form = document.getElementById('estimator-form');
 if (!form) return;
 form.addEventListener('submit', (e) => {
 e.preventDefault();
 const w = parseFloat(document.getElementById('est-width').value) || 0;
 const h = parseFloat(document.getElementById('est-height').value) || 0;
 const qty = parseInt(document.getElementById('est-qty').value, 10) || 1;
 const complexity = parseFloat(document.getElementById('est-complexity').value) || 1;

 // Rough guide: material + cut time (NZD excl GST/shipping)
 const areaM2 = (w * h) / 1e6;
 const material = areaM2 * 185; // ~$185/m² for 3mm Corten + waste
 const perimeter = 2 * (w + h) / 1000; // metres approx outline
 const cut = Math.max(12, perimeter * 18 * complexity);
 const setup = 25;
 const unit = material + cut + setup;
 const total = Math.round(unit * qty);

 const result = document.getElementById('estimate-result');
 const priceEl = document.getElementById('estimate-price');
 if (result && priceEl) {
 priceEl.textContent = '$' + total;
 result.classList.remove('hidden');
 }
 });
}

/* DXF file drop UX */
function initFileDrop() {
 const input = document.getElementById('dxf-file');
 const drop = document.getElementById('file-drop');
 const preview = document.getElementById('file-preview');
 const placeholder = document.getElementById('drop-placeholder');
 const clearBtn = document.getElementById('clear-file');
 if (!input || !drop) return;

 function showFile(file) {
 if (!file || !preview) return;
 const name = document.getElementById('preview-name');
 const meta = document.getElementById('preview-meta');
 if (name) name.textContent = file.name;
 if (meta) meta.textContent = `${(file.size / 1024).toFixed(1)} KB · ${file.type || 'drawing file'}`;
 preview.classList.remove('hidden');
 if (placeholder) placeholder.classList.add('hidden');
 }

 input.addEventListener('change', () => {
 if (input.files?.[0]) showFile(input.files[0]);
 });

 ['dragenter', 'dragover'].forEach((ev) => {
 drop.addEventListener(ev, (e) => {
 e.preventDefault();
 drop.classList.add('dragover');
 });
 });
 ['dragleave', 'drop'].forEach((ev) => {
 drop.addEventListener(ev, (e) => {
 e.preventDefault();
 drop.classList.remove('dragover');
 });
 });
 drop.addEventListener('drop', (e) => {
 const file = e.dataTransfer?.files?.[0];
 if (file) {
 const dt = new DataTransfer();
 dt.items.add(file);
 input.files = dt.files;
 showFile(file);
 }
 });

 clearBtn?.addEventListener('click', () => {
 input.value = '';
 preview?.classList.add('hidden');
 placeholder?.classList.remove('hidden');
 });
}

/* Prefill quote form from query params / cart */
function initQuotePrefill() {
 const params = new URLSearchParams(window.location.search);
 const notes = document.querySelector('textarea[name="fi-text-message"]');
 if (!notes) return;

 const parts = [];
 if (params.get('product')) parts.push('Product: ' + params.get('product'));
 if (params.get('size')) parts.push('Size: ' + params.get('size'));
 if (params.get('mount')) parts.push('Mount: ' + params.get('mount'));
 if (params.get('chars')) parts.push('Characters: ' + params.get('chars'));
 if (params.get('price')) parts.push('Est. price: ' + params.get('price'));
 if (params.get('note')) parts.push(params.get('note'));
 if (params.get('message')) parts.push(params.get('message'));

 if (parts.length && !notes.value) {
 notes.value = parts.join('\n');
 }
}

document.addEventListener('DOMContentLoaded', async () => {
 initMobileMenu();
 updateCartCount();
 const startFilter = document.getElementById('product-grid')
  ? getShopFilterFromUrl()
  : 'all';
 // Paint seed quickly, then refresh from cloud
 loadActiveProducts();
 if (document.getElementById('product-grid')) {
  filterProducts(startFilter, { skipUrl: true });
 }
 renderFeatured();
 await loadActiveProductsAsync();
 // Privacy “From $…” on shop cards
 if (typeof loadPrivacySettings === 'function') {
  try {
   _shopPrivacyCfg = await loadPrivacySettings();
  } catch (_) {}
 }
 if (document.getElementById('product-grid')) {
  filterProducts(startFilter, { skipUrl: true });
 }
 renderFeatured();
 initEstimator();
 initFileDrop();
 initQuotePrefill();
});

// Expose for inline onclick handlers
window.filterProducts = filterProducts;
window.getShopFilterFromUrl = getShopFilterFromUrl;
window.getCart = getCart;
window.setCart = setCart;
window.updateCartCount = updateCartCount;
