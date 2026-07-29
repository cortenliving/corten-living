/* Corten Living — shared site logic */

const CART_KEY = 'cortenCart';

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

function productCardHTML(p, options = {}) {
  const compact = options.compact;
  const href = p.link || '/quote.html';
  const priceText = p.priceLabel || ('$' + p.price);
  const hasSlides = p.slides && p.slides.length;
  const firstImg = (hasSlides && p.slides[0].src) || p.image || '';

  let media;
  if (hasSlides && !compact) {
    media = `<div class="product-slides relative w-full h-full" data-interval="4200">
      ${p.slides.map((s, i) => `
        <div class="slide absolute inset-0 transition-opacity duration-700 ${i === 0 ? 'opacity-100' : 'opacity-0'}">
          <img src="${s.src}" alt="${s.label || p.name}" class="w-full h-full object-cover" loading="lazy"
               onerror="this.onerror=null;this.src='';this.parentElement.querySelector('.fallback')?.classList.remove('hidden')">
          <div class="fallback hidden absolute inset-0 flex flex-col items-center justify-center bg-metal-950">
            <span class="font-display text-3xl text-corten-600/70">${p.name.charAt(0)}</span>
          </div>
          ${s.label ? `<span class="absolute bottom-2 left-2 right-2 text-center text-[10px] uppercase tracking-wider text-white/90 bg-black/50 rounded px-2 py-1">${s.label}</span>` : ''}
        </div>`).join('')}
    </div>`;
  } else if (firstImg) {
    media = `<img src="${firstImg}" alt="${p.name}" class="w-full h-full object-cover" loading="lazy"
      onerror="this.style.display='none';this.nextElementSibling?.classList.remove('hidden')">
      <div class="fallback hidden absolute inset-0 flex items-center justify-center bg-metal-950">
        <span class="font-display text-3xl text-corten-600/70">${p.name.charAt(0)}</span>
      </div>`;
  } else {
    media = `<div class="w-full h-full flex items-center justify-center bg-metal-950">
      <span class="font-display text-3xl text-corten-600/70">${p.name.charAt(0)}</span>
    </div>`;
  }

  const cta = p.link && p.link.includes('house-numbers')
    ? 'Configure & Preview →'
    : 'Enquire / Customise →';

  return `
  <article class="product-card group bg-metal-850 border border-corten-900/40 rounded-sm overflow-hidden transition-all duration-300">
    <a href="${href}" class="block aspect-[4/3] bg-metal-950 relative overflow-hidden">
      ${media}
      ${p.tag ? `<span class="absolute top-3 left-3 z-10 text-[10px] uppercase tracking-wider bg-corten-600 text-white px-2 py-0.5 rounded-sm">${p.tag}</span>` : ''}
    </a>
    <div class="p-5">
      <div class="flex justify-between items-start gap-2">
        <h3 class="font-display text-lg text-white tracking-wide">
          <a href="${href}" class="hover:text-corten-400 transition">${p.name}</a>
        </h3>
        <p class="text-corten-400 font-semibold whitespace-nowrap">${priceText}</p>
      </div>
      <p class="text-xs text-gray-500 mt-1">${p.size} · 3 mm Corten</p>
      ${compact ? '' : `<p class="text-sm text-gray-400 mt-3 leading-relaxed">${p.desc}</p>`}
      <a href="${href}" class="mt-4 inline-block text-sm text-corten-500 hover:text-corten-400 font-medium">${cta}</a>
    </div>
  </article>`;
}

function renderProducts(filter = 'all') {
  const grid = document.getElementById('product-grid');
  if (!grid || typeof products === 'undefined') return;

  const filtered = filter === 'all'
    ? products
    : products.filter((p) => p.category === filter);

  if (filtered.length === 0) {
    grid.innerHTML = `<p class="col-span-full text-center text-gray-500 py-12">No products in this category yet. <a href="/house-numbers.html" class="text-corten-500 hover:underline">Configure House Numbers</a> or <a href="/quote.html" class="text-corten-500 hover:underline">request a custom cut</a>.</p>`;
    return;
  }

  grid.innerHTML = filtered.map((p) => productCardHTML(p)).join('');
  grid.querySelectorAll('.product-slides').forEach(startSlideShow);
}

function filterProducts(cat) {
  document.querySelectorAll('.filter-btn').forEach((btn) => {
    const active = btn.dataset.filter === cat;
    btn.classList.toggle('active', active);
    btn.classList.toggle('border-corten-700', active);
    btn.classList.toggle('text-corten-400', active);
    btn.classList.toggle('border-gray-700', !active);
    btn.classList.toggle('text-gray-400', !active);
  });
  renderProducts(cat);
}

function renderFeatured() {
  const grid = document.getElementById('featured-grid');
  if (!grid || typeof products === 'undefined') return;
  const featured = products.filter((p) => p.featured).slice(0, 4);
  const list = featured.length ? featured : products.slice(0, 4);
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
  if (params.get('message')) parts.push(params.get('message'));

  if (parts.length && !notes.value) {
    notes.value = parts.join('\n');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initMobileMenu();
  updateCartCount();
  if (typeof products !== 'undefined') {
    renderProducts('all');
    renderFeatured();
  }
  initEstimator();
  initFileDrop();
  initQuotePrefill();
});

// Expose for inline onclick handlers
window.filterProducts = filterProducts;
window.getCart = getCart;
window.setCart = setCart;
window.updateCartCount = updateCartCount;
