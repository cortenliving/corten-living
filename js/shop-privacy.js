/**
 * Shop privacy hub: choose Panels vs Posts, design run-through carousel.
 * Used only on /shop when Privacy screens filter is active.
 */
(function () {
  let privacyView = 'panels'; // 'panels' | 'posts'
  let privacyCfg = null;
  let rtIndex = 0;

  function esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function setShopHeadings(mode) {
    const title = document.getElementById('shop-title');
    const sub = document.getElementById('shop-subtitle');
    if (!title || !sub) return;
    if (mode === 'privacy') {
      title.textContent = 'Privacy screens';
      sub.textContent =
        'Decorative panels and matching fence posts. Choose screens or posts below — powdercoat colours from the Dulux range.';
    } else {
      title.textContent = 'The Collection';
      sub.textContent =
        'Ready-to-order pieces cut from 3 mm Corten. Supplied raw so the weathering begins outdoors — or ask for pre-weathered.';
    }
  }

  function updatePrivacyViewButtons() {
    document.querySelectorAll('[data-privacy-view]').forEach((btn) => {
      const on = btn.dataset.privacyView === privacyView;
      btn.classList.toggle('border-corten-500', on);
      btn.classList.toggle('bg-corten-950/40', on);
      btn.classList.toggle('border-white/15', !on);
      btn.classList.toggle('bg-metal-850', !on);
    });
  }

  function renderRunthrough() {
    const track = document.getElementById('privacy-rt-track');
    if (!track) return;
    const list =
      typeof loadActiveProducts === 'function' ? loadActiveProducts() : [];
    const panels = list.filter(
      (p) =>
        (typeof isPrivacyProduct === 'function' ? isPrivacyProduct(p) : p.category === 'privacy')
    );
    // Even sample across the catalogue so run-through shows variety
    const step = Math.max(1, Math.floor(panels.length / 24));
    const sample = [];
    for (let i = 0; i < panels.length && sample.length < 24; i += step) {
      sample.push(panels[i]);
    }
    if (!sample.length) {
      track.innerHTML =
        '<p class="text-sm text-gray-500 py-4">No privacy panels loaded yet.</p>';
      return;
    }
    track.innerHTML = sample
      .map((p) => {
        const href =
          typeof productHref === 'function' ? productHref(p) : '/product?id=' + encodeURIComponent(p.id);
        const img =
          (p.slides && p.slides[0] && p.slides[0].src) || p.image || '';
        const name = p.name || 'Panel';
        const short = name.replace(/^Privacy Screen\s*/i, '') || name;
        return `
 <a href="${esc(href)}" class="snap-start shrink-0 w-36 sm:w-44 group">
  <div class="aspect-[3/4] rounded-sm overflow-hidden border border-corten-900/50 bg-metal-950 flex items-center justify-center">
   ${
     img
       ? `<img src="${esc(img)}" alt="${esc(name)}" class="w-full h-full object-contain group-hover:scale-105 transition duration-300" loading="lazy">`
       : `<span class="font-display text-2xl text-corten-600/50">${esc(short.charAt(0))}</span>`
   }
  </div>
  <p class="mt-2 text-xs text-gray-400 group-hover:text-corten-400 truncate text-center">${esc(short)}</p>
 </a>`;
      })
      .join('');
    rtIndex = 0;
    scrollRunthrough(0);
  }

  function scrollRunthrough(dir) {
    const track = document.getElementById('privacy-rt-track');
    if (!track) return;
    const cardW = 176;
    rtIndex = Math.max(0, rtIndex + dir);
    track.scrollTo({ left: rtIndex * cardW, behavior: 'smooth' });
  }

  function renderPostsInline() {
    const panel = document.getElementById('privacy-posts-panel');
    if (!panel) return;
    const accs =
      typeof getPrivacyAccessories === 'function'
        ? getPrivacyAccessories(privacyCfg)
        : [];
    const colours =
      typeof enabledPrivacyList === 'function'
        ? enabledPrivacyList(privacyCfg?.powdercoat?.colours || [])
        : (privacyCfg?.powdercoat?.colours || []).filter((c) => c.enabled !== false);

    if (!accs.length) {
      panel.innerHTML =
        '<p class="text-sm text-gray-500">Post options are loading or not configured yet. You can also open the <a href="/posts" class="text-corten-400 hover:underline">posts page</a>.</p>';
      return;
    }

    panel.innerHTML = `
 <div class="space-y-4">
  <p class="text-sm text-gray-400">Choose <strong class="text-gray-200">end</strong>, <strong class="text-gray-200">middle</strong> or <strong class="text-gray-200">corner</strong> posts. Powder coated only — Dulux colours.</p>
  ${accs
    .map((a) => {
      const vOpts = (a.variants || [])
        .map((v) => `<option value="${esc(v.id)}">${esc(v.label)}</option>`)
        .join('');
      const cOpts = colours
        .map((c) => `<option value="${esc(c.id)}">${esc(c.label)}</option>`)
        .join('');
      const price = Number(a.price) || 0;
      return `
 <article class="bg-metal-850 border border-corten-900/40 rounded-sm p-5 sm:p-6" data-shop-post="${esc(a.id)}">
  <div class="flex flex-wrap items-start justify-between gap-3">
   <div>
    <h3 class="font-display text-lg text-white">${esc(a.name)}</h3>
    <p class="text-xs text-gray-500 mt-1">${esc(a.note || 'Powder coated · Dulux colours')}</p>
   </div>
   <p class="text-xl font-display font-bold text-corten-400">$${price.toFixed(2)}</p>
  </div>
  <div class="mt-4 grid sm:grid-cols-2 gap-3">
   <div class="sm:col-span-2">
    <label class="block text-[10px] uppercase text-gray-500 mb-1">Size / post type (end · middle · corner)</label>
    <select data-sp-variant class="w-full bg-metal-950 border border-gray-700 rounded-sm px-3 py-2.5 text-white text-sm focus:border-corten-500 outline-none">${vOpts}</select>
   </div>
   <div>
    <label class="block text-[10px] uppercase text-gray-500 mb-1">Powdercoat colour (Dulux)</label>
    <select data-sp-colour class="w-full bg-metal-950 border border-gray-700 rounded-sm px-3 py-2.5 text-white text-sm focus:border-corten-500 outline-none">${cOpts}</select>
   </div>
   <div>
    <label class="block text-[10px] uppercase text-gray-500 mb-1">Qty</label>
    <input type="number" data-sp-qty min="1" max="50" value="1" class="w-24 bg-metal-950 border border-gray-700 rounded-sm px-3 py-2.5 text-white text-sm">
   </div>
  </div>
  <button type="button" data-sp-add class="mt-4 px-5 py-2.5 corten-gradient text-white text-sm font-semibold rounded-sm hover:opacity-90">Add post to cart</button>
 </article>`;
    })
    .join('')}
  <p class="text-xs text-gray-600">Prefer a full-page view? <a href="/posts" class="text-corten-400 hover:underline">Open posts page →</a></p>
 </div>`;

    panel.querySelectorAll('[data-shop-post]').forEach((card) => {
      const id = card.dataset.shopPost;
      const acc = accs.find((a) => a.id === id);
      card.querySelector('[data-sp-add]')?.addEventListener('click', () => {
        const variantId = card.querySelector('[data-sp-variant]')?.value;
        const colourId = card.querySelector('[data-sp-colour]')?.value;
        const qty = Math.max(
          1,
          Math.min(50, parseInt(card.querySelector('[data-sp-qty]')?.value, 10) || 1)
        );
        const variant =
          (acc.variants || []).find((v) => v.id === variantId) || acc.variants[0];
        const col = colours.find((c) => c.id === colourId) || colours[0];
        const unit = Number(acc.price) || 0;
        if (!(unit > 0)) {
          alert('This post is not priced yet — please contact us.');
          return;
        }
        const cart = typeof getCart === 'function' ? getCart() : [];
        cart.push({
          id: 'acc-' + acc.id + '-' + Date.now(),
          productId: acc.id,
          type: acc.name,
          category: 'privacy-accessory',
          chars: variant?.label || 'Post',
          size: variant?.label || '',
          mount: 'Powder Coated · ' + (col?.label || 'Dulux'),
          material: 'Powder coated steel',
          finish: 'Powdercoat',
          colour: col?.label || '',
          price: unit,
          qty,
        });
        if (typeof setCart === 'function') setCart(cart);
        else {
          localStorage.setItem('cortenCart', JSON.stringify(cart));
          if (typeof updateCartCount === 'function') updateCartCount();
        }
        if (typeof toast === 'function') toast('Post added to cart');
        else alert('Added to cart: ' + acc.name);
      });
    });
  }

  function applyPrivacySubView() {
    const hub = document.getElementById('privacy-hub');
    const postsPanel = document.getElementById('privacy-posts-panel');
    const grid = document.getElementById('product-grid');
    const runthrough = document.getElementById('privacy-runthrough');
    if (!hub) return;

    updatePrivacyViewButtons();

    if (privacyView === 'posts') {
      if (runthrough) runthrough.classList.add('hidden');
      if (grid) grid.classList.add('hidden');
      if (postsPanel) {
        postsPanel.classList.remove('hidden');
        renderPostsInline();
      }
    } else {
      if (runthrough) runthrough.classList.remove('hidden');
      if (postsPanel) postsPanel.classList.add('hidden');
      if (grid) grid.classList.remove('hidden');
      if (typeof renderProducts === 'function') renderProducts('privacy');
    }

    try {
      const url = new URL(location.href);
      url.searchParams.set('filter', 'privacy');
      if (privacyView === 'posts') url.searchParams.set('view', 'posts');
      else url.searchParams.delete('view');
      history.replaceState(null, '', url.pathname + url.search);
    } catch (_) {}
  }

  /** Called when shop filter becomes privacy / leaves privacy */
  async function onShopFilterChange(cat) {
    const hub = document.getElementById('privacy-hub');
    const postsPanel = document.getElementById('privacy-posts-panel');
    const grid = document.getElementById('product-grid');
    if (!hub) return;

    if (cat === 'privacy') {
      setShopHeadings('privacy');
      hub.classList.remove('hidden');
      if (!privacyCfg && typeof loadPrivacySettings === 'function') {
        try {
          privacyCfg = await loadPrivacySettings();
        } catch (_) {
          privacyCfg = typeof defaultPrivacyConfig === 'function' ? defaultPrivacyConfig() : {};
        }
      }
      renderRunthrough();
      applyPrivacySubView();
    } else {
      setShopHeadings('all');
      hub.classList.add('hidden');
      if (postsPanel) postsPanel.classList.add('hidden');
      if (grid) grid.classList.remove('hidden');
    }
  }

  function initPrivacyHub() {
    if (!document.getElementById('privacy-hub')) return;

    document.getElementById('privacy-view-panels')?.addEventListener('click', () => {
      privacyView = 'panels';
      applyPrivacySubView();
    });
    document.getElementById('privacy-view-posts')?.addEventListener('click', () => {
      privacyView = 'posts';
      applyPrivacySubView();
    });
    document.getElementById('privacy-rt-prev')?.addEventListener('click', () => scrollRunthrough(-1));
    document.getElementById('privacy-rt-next')?.addEventListener('click', () => scrollRunthrough(1));

    // URL: ?filter=privacy&view=posts
    try {
      const view = new URLSearchParams(location.search).get('view');
      if (view === 'posts') privacyView = 'posts';
    } catch (_) {}

    // Hook filterProducts
    const orig = window.filterProducts;
    if (typeof orig === 'function') {
      window.filterProducts = function (cat, opts) {
        orig(cat, opts);
        onShopFilterChange(cat);
      };
    }

    // Initial state after products load
    const start = typeof getShopFilterFromUrl === 'function' ? getShopFilterFromUrl() : 'all';
    // Delay so main.js finishes first paint
    setTimeout(() => onShopFilterChange(start), 50);
    setTimeout(() => onShopFilterChange(start), 400);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPrivacyHub);
  } else {
    initPrivacyHub();
  }

  window.setPrivacyShopView = function (view) {
    privacyView = view === 'posts' ? 'posts' : 'panels';
    if (typeof filterProducts === 'function') filterProducts('privacy');
    else applyPrivacySubView();
  };
})();
