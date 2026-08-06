/* Corten Living — Admin Quotes Phase 1 */

const STORAGE_SESSION = 'cortenAdminSession';
const STORAGE_PASS = 'cortenAdminPass';

let settings = QuoteCost.defaultSettings();
let customers = [];
let quoteList = [];
let nextSeq = 1843;

/** Current builder state */
let state = {
  id: null,
  number: '',
  items: [],
  selectedItemId: null,
  overrides: {},
  marginPercent: 35,
  gstOn: true,
  freightId: null,
  leadTime: '',
  paymentTerms: '',
  costManual: false,
};

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
function adminHeaders() {
  const h = { 'Content-Type': 'application/json', Accept: 'application/json' };
  const pass = getAdminPassword();
  if (pass) h['X-Admin-Password'] = pass;
  return h;
}
async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { ...adminHeaders(), ...options.headers },
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { res, data, ok: res.ok };
}
function toast(msg, isError) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('opacity-0', 'pointer-events-none');
  el.style.background = isError ? '#7f1d1d' : '#1a1814';
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add('opacity-0', 'pointer-events-none'), 3000);
}
function money(n) {
  return QuoteCost.money(n);
}
function fmt(n) {
  return money(n).toFixed(2);
}
function uid() {
  return 'i_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/* ── Views ── */
function showView(name) {
  document.getElementById('list-view')?.classList.toggle('hidden', name !== 'quotes');
  document.getElementById('builder')?.classList.toggle('hidden', name !== 'builder');
  document.getElementById('customers-view')?.classList.toggle('hidden', name !== 'customers');
  document.getElementById('settings-view')?.classList.toggle('hidden', name !== 'settings');
  document.querySelectorAll('.nav-btn').forEach((btn) => {
    const v = btn.getAttribute('data-view');
    const on = (name === 'builder' ? 'quotes' : name) === v;
    btn.classList.toggle('border-corten-500', on);
    btn.classList.toggle('text-white', on);
    btn.classList.toggle('border-transparent', !on);
    btn.classList.toggle('text-gray-400', !on);
  });
  if (name === 'quotes') renderQuoteList();
  if (name === 'customers') renderCustomerList();
  if (name === 'settings') fillSettingsForm();
}

/* ── Load cloud data ── */
async function loadAll() {
  const [s, c, q] = await Promise.all([
    api('/api/quote-settings'),
    api('/api/customers'),
    api('/api/quotes'),
  ]);
  if (s.data?.settings) {
    const def = QuoteCost.defaultSettings();
    settings = {
      ...def,
      ...s.data.settings,
      material: { ...def.material, ...(s.data.settings.material || {}) },
      laser: { ...def.laser, ...(s.data.settings.laser || {}) },
      setup: { ...def.setup, ...(s.data.settings.setup || {}) },
      freight: { ...def.freight, ...(s.data.settings.freight || {}) },
      print: { ...def.print, ...(s.data.settings.print || {}) },
    };
  }
  if (Array.isArray(c.data?.customers)) customers = c.data.customers;
  if (Array.isArray(q.data?.quotes)) quoteList = q.data.quotes;
  if (q.data?.nextSeq) nextSeq = q.data.nextSeq;
  fillCustomerSelect();
  fillLeadPaySelects();
  document.getElementById('q-valid-days').textContent = settings.quoteValidDays || 14;
  state.marginPercent = settings.defaultMarginPercent ?? 35;
  document.getElementById('margin-range').value = state.marginPercent;
  document.getElementById('margin-label').textContent = state.marginPercent + '%';
  renderQuoteList();
}

function fillLeadPaySelects() {
  const lead = document.getElementById('q-lead');
  const pay = document.getElementById('q-pay');
  const leads = settings.leadTimes || ['1–2 weeks'];
  const pays = settings.paymentTerms || ['Invoice 7 days'];
  lead.innerHTML = leads.map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join('');
  pay.innerHTML = pays.map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join('');
  state.leadTime = leads[0] || '';
  state.paymentTerms = pays[0] || '';
}

function fillCustomerSelect() {
  const sel = document.getElementById('customer-select');
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML =
    '<option value="">Select saved customer</option>' +
    customers
      .map(
        (c) =>
          `<option value="${esc(c.id)}">${esc(c.name || 'Unnamed')}${c.company ? ' · ' + esc(c.company) : ''}</option>`
      )
      .join('');
  if (cur) sel.value = cur;
}

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;');
}

/* ── Quote list ── */
function renderQuoteList() {
  const el = document.getElementById('quote-list');
  if (!el) return;
  if (!quoteList.length) {
    el.innerHTML = '<p class="p-8 text-sm text-gray-500 text-center">No saved quotes yet. Create one with + New quote.</p>';
    return;
  }
  el.innerHTML = `
    <table class="w-full text-sm text-left">
      <thead class="text-xs text-gray-500 uppercase bg-paper-100 border-b border-gray-200">
        <tr>
          <th class="px-4 py-3">Quote</th>
          <th class="px-4 py-3">Customer</th>
          <th class="px-4 py-3">Items</th>
          <th class="px-4 py-3">Price excl.</th>
          <th class="px-4 py-3">Updated</th>
          <th class="px-4 py-3"></th>
        </tr>
      </thead>
      <tbody>
        ${quoteList
          .map(
            (q) => `
          <tr class="border-b border-gray-100 hover:bg-paper-50">
            <td class="px-4 py-3 font-medium">${esc(q.number)}</td>
            <td class="px-4 py-3">${esc(q.customerName || '—')}${q.company ? '<span class="text-gray-400"> · ' + esc(q.company) + '</span>' : ''}</td>
            <td class="px-4 py-3 text-gray-500">${q.itemCount || 0}</td>
            <td class="px-4 py-3">${q.priceExcl != null ? '$' + fmt(q.priceExcl) : '—'}</td>
            <td class="px-4 py-3 text-gray-500 text-xs">${q.updatedAt ? new Date(q.updatedAt).toLocaleDateString() : '—'}</td>
            <td class="px-4 py-3 text-right whitespace-nowrap space-x-2">
              ${
                q.pdfUrl
                  ? `<a href="${esc(q.pdfUrl)}" target="_blank" rel="noopener" class="text-ink-900 hover:underline text-xs font-medium">PDF</a>`
                  : ''
              }
              <button type="button" data-open-quote="${esc(q.id)}" class="text-corten-600 hover:underline text-xs font-medium">Open</button>
            </td>
          </tr>`
          )
          .join('')}
      </tbody>
    </table>`;
  el.querySelectorAll('[data-open-quote]').forEach((btn) => {
    btn.addEventListener('click', () => openQuote(btn.getAttribute('data-open-quote')));
  });
}

async function openQuote(id) {
  const { ok, data } = await api('/api/quotes?id=' + encodeURIComponent(id));
  if (!ok || !data?.quote) {
    toast(data?.error || 'Could not load quote', true);
    return;
  }
  loadQuoteIntoBuilder(data.quote);
  showView('builder');
}

function loadQuoteIntoBuilder(q) {
  state.id = q.id;
  state.number = q.number || '';
  state.items = Array.isArray(q.items) ? q.items : [];
  state.selectedItemId = state.items[0]?.id || null;
  state.overrides = q.overrides || {};
  state.costManual = !!(q.overrides && Object.keys(q.overrides).length);
  state.marginPercent = q.marginPercent ?? settings.defaultMarginPercent ?? 35;
  state.gstOn = q.gstOn !== false;
  state.freightId = q.freightId || null;
  state.leadTime = q.leadTime || '';
  state.paymentTerms = q.paymentTerms || '';
  state.pdfUrl = q.pdfUrl || null;
  state.pdfPath = q.pdfPath || null;

  document.getElementById('c-name').value = q.customer?.name || '';
  document.getElementById('c-company').value = q.customer?.company || '';
  document.getElementById('c-email').value = q.customer?.email || '';
  document.getElementById('c-phone').value = q.customer?.phone || '';
  document.getElementById('c-address').value = q.customer?.address || '';
  document.getElementById('margin-range').value = state.marginPercent;
  document.getElementById('margin-label').textContent = state.marginPercent + '%';
  document.getElementById('q-number').textContent = state.number || 'CL-…';
  if (state.leadTime) document.getElementById('q-lead').value = state.leadTime;
  if (state.paymentTerms) document.getElementById('q-pay').value = state.paymentTerms;
  updateGstButton();
  renderItems();
  recalc(true);
  previewSelected();
}

function newQuote() {
  const year = new Date().getFullYear();
  state = {
    id: null,
    number: `CL-${year}-${nextSeq}`,
    items: [],
    selectedItemId: null,
    overrides: {},
    marginPercent: settings.defaultMarginPercent ?? 35,
    gstOn: true,
    freightId: null,
    leadTime: (settings.leadTimes || [])[0] || '',
    paymentTerms: (settings.paymentTerms || [])[0] || '',
    costManual: false,
    pdfUrl: null,
    pdfPath: null,
  };
  ['c-name', 'c-company', 'c-email', 'c-phone', 'c-address'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.getElementById('customer-select').value = '';
  document.getElementById('margin-range').value = state.marginPercent;
  document.getElementById('margin-label').textContent = state.marginPercent + '%';
  document.getElementById('q-number').textContent = state.number;
  updateGstButton();
  renderItems();
  recalc(false);
  document.getElementById('preview-stage').innerHTML =
    '<p class="text-sm text-gray-400">Upload a DXF to preview</p>';
  document.getElementById('preview-size-label').textContent = '—';
  showView('builder');
}

/* ── DXF upload ── */
function setupDropzone() {
  const zone = document.getElementById('dxf-drop');
  const input = document.getElementById('dxf-input');
  if (!zone || !input) return;

  zone.addEventListener('click', () => input.click());
  zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    zone.classList.add('drag');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('drag');
    handleFiles(e.dataTransfer.files);
  });
  input.addEventListener('change', () => {
    handleFiles(input.files);
    input.value = '';
  });
}

async function handleFiles(fileList) {
  const files = Array.from(fileList || []).filter((f) =>
    /\.dxf$/i.test(f.name) || /dxf/i.test(f.type || '')
  );
  if (!files.length) {
    toast('Please drop .dxf files', true);
    return;
  }
  for (const file of files) {
    try {
      const text = await file.text();
      const summary = DxfParse.parseDxf(text);
      if (!summary.entityCount && !summary.pathCount) {
        toast(file.name + ': no cut geometry found (try export as R12/ASCII DXF)', true);
        continue;
      }
      if ((summary.pathCount || 0) < 2 && (summary.entityCount || 0) < 3) {
        console.warn('DXF low geometry', file.name, summary);
      }
      const item = {
        id: uid(),
        fileName: file.name,
        qty: 1,
        widthMm: summary.widthMm,
        heightMm: summary.heightMm,
        cutLengthMm: summary.cutLengthMm,
        entityCount: summary.entityCount,
        pathCount: summary.pathCount,
        areaMm2: summary.areaMm2,
        linked: true,
        paths: summary.paths,
        polylines: summary.polylines,
        bounds: summary.bounds,
        // keep for re-preview; strip if huge on save
        dxfText: text.length < 800000 ? text : '',
      };
      state.items.push(item);
      state.selectedItemId = item.id;
      state.costManual = false;
      state.overrides = {};
    } catch (e) {
      toast(file.name + ': ' + (e.message || 'parse failed'), true);
    }
  }
  renderItems();
  recalc(false);
  previewSelected();
}

function renderItems() {
  const host = document.getElementById('job-items');
  if (!host) return;
  if (!state.items.length) {
    host.innerHTML = '';
    return;
  }
  host.innerHTML = state.items
    .map((it, idx) => {
      const active = it.id === state.selectedItemId;
      const wt = DxfParse.partWeightKg(it.widthMm, it.heightMm, it.qty, {
        silhouetteFill: settings.material?.silhouetteFill,
        cortenKgPerM2: settings.cortenKgPerM2,
      });
      return `
      <div class="border rounded p-3 ${active ? 'border-corten-500 bg-orange-50/40' : 'border-gray-200 bg-white'}" data-item="${esc(it.id)}">
        <div class="flex items-start justify-between gap-2">
          <div class="flex gap-2 min-w-0">
            <span class="shrink-0 w-6 h-6 rounded bg-ink-950 text-white text-[10px] font-bold flex items-center justify-center">${idx + 1}</span>
            <div class="min-w-0">
              <p class="text-sm font-medium truncate">${esc(it.fileName)}</p>
              <p class="text-[11px] text-gray-500">${fmt(it.widthMm)} × ${fmt(it.heightMm)} mm · ${it.pathCount || it.entityCount || 0} paths · cut ~${fmt(it.cutLengthMm)} mm</p>
              <p class="text-[11px] text-ink-900 font-medium mt-0.5">~${fmt(wt.weightKg)} kg · ${wt.solidAreaM2.toFixed(4)} m² steel @ 3 mm</p>
            </div>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <label class="text-[10px] text-gray-500">Qty
              <input type="number" min="1" step="1" value="${it.qty}" data-qty="${esc(it.id)}" class="input w-14 py-1 text-center ml-1">
            </label>
            <button type="button" data-del="${esc(it.id)}" class="text-gray-400 hover:text-red-600 text-lg leading-none px-1">×</button>
          </div>
        </div>
        <div class="mt-2 grid grid-cols-[1fr_auto_1fr] gap-2 items-end">
          <div>
            <label class="text-[10px] text-gray-500">Width mm</label>
            <input type="number" step="0.1" min="0.1" value="${it.widthMm}" data-w="${esc(it.id)}" class="input py-1">
          </div>
          <button type="button" data-link="${esc(it.id)}" class="mb-0.5 px-2 py-1.5 text-[10px] font-semibold rounded border ${it.linked ? 'border-emerald-500 text-emerald-700 bg-emerald-50' : 'border-gray-300 text-gray-500'}">${it.linked ? 'LINKED' : 'FREE'}</button>
          <div>
            <label class="text-[10px] text-gray-500">Height mm</label>
            <input type="number" step="0.1" min="0.1" value="${it.heightMm}" data-h="${esc(it.id)}" class="input py-1">
          </div>
        </div>
      </div>`;
    })
    .join('');

  host.querySelectorAll('[data-item]').forEach((row) => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('input,button')) return;
      state.selectedItemId = row.getAttribute('data-item');
      renderItems();
      previewSelected();
    });
  });
  host.querySelectorAll('[data-del]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-del');
      state.items = state.items.filter((x) => x.id !== id);
      if (state.selectedItemId === id) state.selectedItemId = state.items[0]?.id || null;
      state.costManual = false;
      state.overrides = {};
      renderItems();
      recalc(false);
      previewSelected();
    });
  });
  host.querySelectorAll('[data-qty]').forEach((inp) => {
    inp.addEventListener('change', () => {
      const it = state.items.find((x) => x.id === inp.getAttribute('data-qty'));
      if (!it) return;
      it.qty = Math.max(1, parseInt(inp.value, 10) || 1);
      state.costManual = false;
      state.overrides = {};
      recalc(false);
    });
  });
  host.querySelectorAll('[data-w]').forEach((inp) => {
    inp.addEventListener('change', () => scaleItem(inp.getAttribute('data-w'), 'w', parseFloat(inp.value)));
  });
  host.querySelectorAll('[data-h]').forEach((inp) => {
    inp.addEventListener('change', () => scaleItem(inp.getAttribute('data-h'), 'h', parseFloat(inp.value)));
  });
  host.querySelectorAll('[data-link]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const it = state.items.find((x) => x.id === btn.getAttribute('data-link'));
      if (!it) return;
      it.linked = !it.linked;
      renderItems();
    });
  });
}

function scaleItem(id, which, value) {
  const it = state.items.find((x) => x.id === id);
  if (!it || !(value > 0)) return;
  const baseW = it.widthMm || 1;
  const baseH = it.heightMm || 1;
  const baseCut = it.cutLengthMm || 0;
  // Use ratio against previous size
  if (it.linked) {
    if (which === 'w') {
      const s = value / baseW;
      it.widthMm = money(value);
      it.heightMm = money(baseH * s);
      it.cutLengthMm = money(baseCut * s);
    } else {
      const s = value / baseH;
      it.heightMm = money(value);
      it.widthMm = money(baseW * s);
      it.cutLengthMm = money(baseCut * s);
    }
  } else {
    if (which === 'w') {
      const s = value / baseW;
      it.widthMm = money(value);
      it.cutLengthMm = money(baseCut * ((s + 1) / 2));
    } else {
      const s = value / baseH;
      it.heightMm = money(value);
      it.cutLengthMm = money(baseCut * ((s + 1) / 2));
    }
  }
  it.areaMm2 = money(it.widthMm * it.heightMm);
  state.costManual = false;
  state.overrides = {};
  renderItems();
  recalc(false);
  previewSelected();
}

function previewSelected() {
  const stage = document.getElementById('preview-stage');
  const label = document.getElementById('preview-size-label');
  const it = state.items.find((x) => x.id === state.selectedItemId) || state.items[0];
  if (!it || !it.paths || !it.paths.length) {
    stage.innerHTML = '<p class="text-sm text-gray-400">Upload a DXF to preview</p>';
    label.textContent = '—';
    return;
  }
  label.textContent = `${fmt(it.widthMm)} × ${fmt(it.heightMm)} mm`;
  // If we only have paths/bounds from a saved quote, use those; re-parse if dxfText present
  let summary = {
    widthMm: it.widthMm,
    heightMm: it.heightMm,
    paths: it.paths,
    polylines: it.polylines,
    bounds: it.bounds || { minX: 0, minY: 0, maxX: it.widthMm, maxY: it.heightMm },
  };
  if ((!summary.polylines || !summary.polylines.length) && it.dxfText && DxfParse.parseDxf) {
    try {
      const full = DxfParse.parseDxf(it.dxfText);
      summary = {
        ...full,
        widthMm: it.widthMm,
        heightMm: it.heightMm,
      };
      it.polylines = full.polylines;
      it.paths = full.paths;
      it.bounds = full.bounds;
    } catch (_) {}
  }
  const { svg } = DxfParse.toSvg(summary, { stroke: '#b7410e', strokeWidth: 0.9, pad: 8 });
  stage.innerHTML = `<div class="w-full h-full max-h-full">${svg}</div>`;
}

/* ── Costing ── */
function recalc(fromOverrides) {
  const result = QuoteCost.calculateQuote({
    items: state.items,
    settings,
    marginPercent: state.marginPercent,
    overrides: state.costManual ? state.overrides : {},
    freightId: state.freightId,
    gstOn: state.gstOn,
  });

  if (!fromOverrides && !state.costManual) {
    document.getElementById('cost-material').value = result.auto.material;
    document.getElementById('cost-laser').value = result.auto.laser;
    document.getElementById('cost-setup').value = result.auto.setup;
    document.getElementById('cost-freight').value = result.auto.freight;
    state.overrides = {
      material: result.auto.material,
      laser: result.auto.laser,
      setup: result.auto.setup,
      freight: result.auto.freight,
    };
  }

  const mb = result.materialBreakdown;
  const matNote = document.getElementById('mat-breakdown');
  if (matNote) {
    if (mb && mb.steelM2 > 0) {
      matNote.textContent =
        `${mb.steelM2.toFixed(4)} m² steel × $${fmt(mb.ratePerM2)}/m²` +
        `  (plate ${mb.plateM2.toFixed(4)} m² × fill ${(mb.fill * 100).toFixed(0)}%)`;
    } else {
      matNote.textContent = 'Add a DXF — material = m² × $/m² rate';
    }
  }

  state.freightId = result.freightTier?.id || state.freightId;
  document.getElementById('freight-label').textContent = result.freightTier?.label || '—';
  document.getElementById('q-price').textContent = fmt(result.priceExcl);
  document.getElementById('q-subtotal').textContent = '$' + fmt(result.priceExcl);
  document.getElementById('q-gst').textContent = '$' + fmt(result.gst);
  document.getElementById('q-total').textContent = '$' + fmt(result.priceIncl);
  const wEl = document.getElementById('q-weight');
  if (wEl) {
    if (result.weightKg > 0) {
      wEl.innerHTML =
        `<span class="text-ink-900 font-medium">Part weight (3 mm Corten): ~${fmt(result.weightKg)} kg</span>` +
        `<span class="block text-gray-400">${fmt(result.cortenKgPerM2 || 23.55)} kg/m² × steel m²` +
        (mb ? ` (${mb.steelM2.toFixed(4)} m²)` : '') +
        `</span>`;
    } else {
      wEl.textContent = '';
    }
  }

  state._lastCalc = result;
  return result;
}

function readCostInputs() {
  state.costManual = true;
  state.overrides = {
    material: parseFloat(document.getElementById('cost-material').value) || 0,
    laser: parseFloat(document.getElementById('cost-laser').value) || 0,
    setup: parseFloat(document.getElementById('cost-setup').value) || 0,
    freight: parseFloat(document.getElementById('cost-freight').value) || 0,
  };
  recalc(true);
}

function updateGstButton() {
  const btn = document.getElementById('btn-gst');
  if (!btn) return;
  if (state.gstOn) {
    btn.textContent = 'GST ON';
    btn.className = 'px-3 py-1 rounded text-xs font-semibold bg-emerald-100 text-emerald-800 border border-emerald-200';
  } else {
    btn.textContent = 'GST OFF';
    btn.className = 'px-3 py-1 rounded text-xs font-semibold bg-gray-100 text-gray-600 border border-gray-200';
  }
}

/* ── Save quote / customer ── */
function collectCustomer() {
  return {
    name: document.getElementById('c-name').value.trim(),
    company: document.getElementById('c-company').value.trim(),
    email: document.getElementById('c-email').value.trim(),
    phone: document.getElementById('c-phone').value.trim(),
    address: document.getElementById('c-address').value.trim(),
  };
}

async function saveCustomer() {
  const c = collectCustomer();
  if (!c.name) {
    toast('Customer name required', true);
    return;
  }
  const sel = document.getElementById('customer-select');
  if (sel.value) c.id = sel.value;
  const { ok, data } = await api('/api/customers', {
    method: 'PUT',
    body: JSON.stringify({ customer: c }),
  });
  if (!ok) {
    toast(data?.error || 'Save failed', true);
    return;
  }
  customers = data.customers || customers;
  fillCustomerSelect();
  if (c.id || data.customers?.[0]?.id) {
    const id = c.id || data.customers[0].id;
    document.getElementById('customer-select').value = id;
  }
  toast('Customer saved');
}

function itemSvgMarkup(it, maxH) {
  if (!it) return '';
  let summary = {
    widthMm: it.widthMm,
    heightMm: it.heightMm,
    paths: it.paths,
    polylines: it.polylines,
    bounds: it.bounds || { minX: 0, minY: 0, maxX: it.widthMm || 1, maxY: it.heightMm || 1 },
  };
  if ((!summary.polylines || !summary.polylines.length) && it.dxfText) {
    try {
      const full = DxfParse.parseDxf(it.dxfText);
      summary = { ...full, widthMm: it.widthMm, heightMm: it.heightMm };
    } catch (_) {}
  }
  if ((!summary.polylines || !summary.polylines.length) && (!summary.paths || !summary.paths.length)) {
    return '';
  }
  const { svg } = DxfParse.toSvg(summary, { stroke: '#b7410e', strokeWidth: 0.7, pad: 6 });
  // Constrain height for print cards
  return svg.replace(
    '<svg ',
    `<svg style="max-height:${maxH || 110}px;width:100%;" `
  );
}

async function saveQuote() {
  if (!state.items.length) {
    toast('Add at least one DXF', true);
    return;
  }
  const calc = recalc(true);
  const quote = {
    id: state.id || undefined,
    number: state.number,
    status: 'saved',
    customer: collectCustomer(),
    items: state.items.map((it) => {
      const wt = DxfParse.partWeightKg(it.widthMm, it.heightMm, it.qty, {
        silhouetteFill: settings.material?.silhouetteFill,
        cortenKgPerM2: settings.cortenKgPerM2,
      });
      return {
        id: it.id,
        fileName: it.fileName,
        qty: it.qty,
        widthMm: it.widthMm,
        heightMm: it.heightMm,
        cutLengthMm: it.cutLengthMm,
        entityCount: it.entityCount,
        areaMm2: it.areaMm2,
        linked: it.linked,
        paths: it.paths,
        polylines: it.polylines,
        bounds: it.bounds,
        weightKg: wt.weightKg,
        thicknessMm: 3,
      };
    }),
    overrides: state.overrides,
    marginPercent: state.marginPercent,
    gstOn: state.gstOn,
    freightId: state.freightId,
    leadTime: document.getElementById('q-lead').value,
    paymentTerms: document.getElementById('q-pay').value,
    totals: {
      costExcl: calc.costExcl,
      priceExcl: calc.priceExcl,
      gst: calc.gst,
      priceIncl: calc.priceIncl,
      weightKg: calc.weightKg,
      costings: calc.costings,
    },
    pdfUrl: state.pdfUrl || null,
    pdfPath: state.pdfPath || null,
  };

  toast('Saving quote…');
  const { ok, data } = await api('/api/quotes', {
    method: 'PUT',
    body: JSON.stringify({ quote }),
  });
  if (!ok) {
    toast(data?.error || 'Save failed — check cloud (GITHUB_TOKEN)', true);
    return;
  }
  if (data.quote) {
    state.id = data.quote.id;
    state.number = data.quote.number;
    document.getElementById('q-number').textContent = state.number;
  }
  if (data.nextSeq) nextSeq = data.nextSeq;

  // Generate customer PDF (with profiles) and store under data/quote-files/
  try {
    toast('Saving PDF copy…');
    const pdfResult = await generateAndUploadQuotePdf(state.number);
    if (pdfResult?.url) {
      state.pdfUrl = pdfResult.url;
      state.pdfPath = pdfResult.path;
      // Patch quote record with PDF link
      await api('/api/quotes', {
        method: 'PUT',
        body: JSON.stringify({
          quote: {
            ...quote,
            id: state.id,
            number: state.number,
            pdfUrl: pdfResult.url,
            pdfPath: pdfResult.path,
          },
        }),
      });
    }
  } catch (e) {
    console.warn('PDF save failed', e);
    toast('Quote saved, but PDF upload failed: ' + (e.message || e), true);
    const list = await api('/api/quotes');
    if (list.data?.quotes) quoteList = list.data.quotes;
    return;
  }

  const list = await api('/api/quotes');
  if (list.data?.quotes) quoteList = list.data.quotes;
  toast('Quote + PDF saved');
}

/**
 * Build print DOM, render to PDF via html2pdf, upload to GitHub data/quote-files/
 */
async function generateAndUploadQuotePdf(quoteNumber) {
  if (typeof html2pdf === 'undefined') {
    throw new Error('PDF library not loaded');
  }
  buildCustomerPrint();
  const el = document.getElementById('customer-print');
  if (!el) throw new Error('Print sheet missing');

  // Off-screen but renderable for html2canvas
  const prev = {
    display: el.style.display,
    position: el.style.position,
    left: el.style.left,
    top: el.style.top,
    width: el.style.width,
    zIndex: el.style.zIndex,
    background: el.style.background,
  };
  el.style.display = 'block';
  el.style.position = 'fixed';
  el.style.left = '0';
  el.style.top = '0';
  el.style.width = '800px';
  el.style.zIndex = '-1';
  el.style.background = '#fff';

  try {
    await new Promise((r) => setTimeout(r, 100));
    const opt = {
      margin: [10, 12, 10, 12],
      filename: `${quoteNumber || 'quote'}.pdf`,
      image: { type: 'jpeg', quality: 0.92 },
      html2canvas: { scale: 2, useCORS: true, logging: false, backgroundColor: '#ffffff' },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      pagebreak: { mode: ['avoid-all', 'css', 'legacy'] },
    };
    const blob = await html2pdf().set(opt).from(el).outputPdf('blob');
    const buf = await blob.arrayBuffer();
    const u8 = new Uint8Array(buf);
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < u8.length; i += chunk) {
      binary += String.fromCharCode.apply(null, u8.subarray(i, i + chunk));
    }
    const dataUrl = 'data:application/pdf;base64,' + btoa(binary);

    const { ok, data } = await api('/api/quote-file', {
      method: 'POST',
      body: JSON.stringify({ quoteNumber: quoteNumber || state.number, dataUrl }),
    });
    if (!ok) throw new Error(data?.error || 'PDF upload failed');
    return { url: data.url, path: data.path };
  } finally {
    el.style.display = prev.display || 'none';
    el.style.position = prev.position || '';
    el.style.left = prev.left || '';
    el.style.top = prev.top || '';
    el.style.width = prev.width || '';
    el.style.zIndex = prev.zIndex || '';
    el.style.background = prev.background || '';
  }
}

/* ── Customers view ── */
function renderCustomerList() {
  const el = document.getElementById('customer-list');
  if (!el) return;
  if (!customers.length) {
    el.innerHTML = '<p class="p-8 text-sm text-gray-500 text-center">No customers yet. Save one from a quote.</p>';
    return;
  }
  el.innerHTML = `
    <table class="w-full text-sm">
      <thead class="text-xs text-gray-500 uppercase bg-paper-100 border-b">
        <tr>
          <th class="px-4 py-3 text-left">Name</th>
          <th class="px-4 py-3 text-left">Company</th>
          <th class="px-4 py-3 text-left">Email</th>
          <th class="px-4 py-3 text-left">Phone</th>
        </tr>
      </thead>
      <tbody>
        ${customers
          .map(
            (c) => `
          <tr class="border-b border-gray-100">
            <td class="px-4 py-3 font-medium">${esc(c.name)}</td>
            <td class="px-4 py-3 text-gray-600">${esc(c.company || '—')}</td>
            <td class="px-4 py-3 text-gray-600">${esc(c.email || '—')}</td>
            <td class="px-4 py-3 text-gray-600">${esc(c.phone || '—')}</td>
          </tr>`
          )
          .join('')}
      </tbody>
    </table>`;
}

/* ── Settings ── */
function printDefaults() {
  return (
    QuoteCost.defaultSettings().print || {
      companyName: 'CORTEN LIVING',
      tagline: 'Profile-cut 3 mm Corten · Made in Gisborne, NZ',
      contact: '027 383 8178 · cortenliving@gmail.com\nGisborne, New Zealand',
      intro: '',
      footer: '',
      showSize: true,
      showLeadTime: true,
      showPaymentTerms: true,
      showWeight: false,
      showLogo: true,
    }
  );
}

function getPrintSettings() {
  return { ...printDefaults(), ...(settings.print || {}) };
}

function fillSettingsForm() {
  document.getElementById('set-mat-rate').value = settings.material?.ratePerM2 ?? 95;
  document.getElementById('set-fill').value = settings.material?.silhouetteFill ?? 0.32;
  document.getElementById('set-laser-rate').value = settings.laser?.ratePerMetre ?? 2.8;
  document.getElementById('set-laser-min').value = settings.laser?.minCharge ?? 12;
  document.getElementById('set-setup').value = settings.setup?.amount ?? 28;
  document.getElementById('set-margin').value = settings.defaultMarginPercent ?? 35;

  const p = getPrintSettings();
  document.getElementById('set-print-company').value = p.companyName || '';
  document.getElementById('set-print-tagline').value = p.tagline || '';
  document.getElementById('set-print-contact').value = p.contact || '';
  document.getElementById('set-print-intro').value = p.intro || '';
  document.getElementById('set-print-footer').value = p.footer || '';
  document.getElementById('set-print-show-size').checked = p.showSize !== false;
  document.getElementById('set-print-show-lead').checked = p.showLeadTime !== false;
  document.getElementById('set-print-show-pay').checked = p.showPaymentTerms !== false;
  document.getElementById('set-print-show-weight').checked = !!p.showWeight;
  document.getElementById('set-print-show-logo').checked = p.showLogo !== false;
  const prof = document.getElementById('set-print-show-profile');
  if (prof) prof.checked = p.showProfile !== false;
}

async function saveSettings() {
  const next = {
    ...settings,
    material: {
      ...(settings.material || {}),
      ratePerM2: parseFloat(document.getElementById('set-mat-rate').value) || 0,
      silhouetteFill: parseFloat(document.getElementById('set-fill').value) || 0.32,
    },
    laser: {
      ...(settings.laser || {}),
      ratePerMetre: parseFloat(document.getElementById('set-laser-rate').value) || 0,
      minCharge: parseFloat(document.getElementById('set-laser-min').value) || 0,
    },
    setup: {
      ...(settings.setup || {}),
      amount: parseFloat(document.getElementById('set-setup').value) || 0,
    },
    defaultMarginPercent: parseFloat(document.getElementById('set-margin').value) || 35,
    print: {
      companyName: document.getElementById('set-print-company').value.trim() || 'CORTEN LIVING',
      tagline: document.getElementById('set-print-tagline').value.trim(),
      contact: document.getElementById('set-print-contact').value.trim(),
      intro: document.getElementById('set-print-intro').value.trim(),
      footer: document.getElementById('set-print-footer').value.trim(),
      showSize: !!document.getElementById('set-print-show-size').checked,
      showLeadTime: !!document.getElementById('set-print-show-lead').checked,
      showPaymentTerms: !!document.getElementById('set-print-show-pay').checked,
      showWeight: !!document.getElementById('set-print-show-weight').checked,
      showLogo: !!document.getElementById('set-print-show-logo').checked,
      showProfile: document.getElementById('set-print-show-profile')
        ? !!document.getElementById('set-print-show-profile').checked
        : true,
    },
  };
  const msg = document.getElementById('settings-msg');
  msg.textContent = 'Saving…';
  const { ok, data } = await api('/api/quote-settings', {
    method: 'PUT',
    body: JSON.stringify({ settings: next }),
  });
  if (!ok) {
    msg.textContent = data?.error || 'Failed';
    toast(data?.error || 'Settings save failed', true);
    return;
  }
  settings = { ...next, ...(data.settings || {}) };
  if (data.settings?.print) settings.print = data.settings.print;
  else settings.print = next.print;
  msg.textContent = 'Saved live';
  toast('Quote settings saved');
}

/** Build customer-facing print sheet — no internal costings */
function buildCustomerPrint() {
  const p = getPrintSettings();
  const calc = state._lastCalc || recalc(true);
  const cust = collectCustomer();
  const days = settings.quoteValidDays || 14;
  const lead = document.getElementById('q-lead')?.value || state.leadTime || '';
  const pay = document.getElementById('q-pay')?.value || state.paymentTerms || '';

  const setText = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val || '';
  };

  const logo = document.getElementById('print-logo');
  if (logo) logo.style.display = p.showLogo === false ? 'none' : '';

  setText('print-company', p.companyName || 'CORTEN LIVING');
  setText('print-tagline', p.tagline || '');
  setText('print-contact', p.contact || '');
  setText('print-intro', p.intro || '');
  setText('print-footer', p.footer || '');
  setText('print-number', state.number || '—');
  setText(
    'print-date',
    'Date: ' +
      new Date().toLocaleDateString('en-NZ', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
  );
  setText('print-valid', 'Valid for ' + days + ' days');

  const lines = [];
  if (cust.name) lines.push(cust.name);
  if (cust.company) lines.push(cust.company);
  if (cust.email) lines.push(cust.email);
  if (cust.phone) lines.push(cust.phone);
  if (cust.address) lines.push(cust.address);
  setText('print-customer', lines.length ? lines.join('\n') : '—');

  const meta = [];
  if (p.showLeadTime !== false && lead) meta.push('Lead time: ' + lead);
  if (p.showPaymentTerms !== false && pay) meta.push('Payment: ' + pay);
  if (p.showWeight && calc.weightKg > 0) {
    meta.push('Est. part weight: ~' + fmt(calc.weightKg) + ' kg (3 mm Corten)');
  }
  setText('print-meta', meta.join('\n') || 'Custom laser-cut Corten');
  const metaWrap = document.getElementById('print-meta-wrap');
  if (metaWrap) metaWrap.style.display = meta.length ? '' : 'none';

  const thSize = document.getElementById('print-th-size');
  if (thSize) thSize.style.display = p.showSize === false ? 'none' : '';

  const tbody = document.getElementById('print-items');
  if (tbody) {
    if (!state.items.length) {
      tbody.innerHTML =
        '<tr><td colspan="4" style="color:#888;">No line items</td></tr>';
    } else {
      tbody.innerHTML = state.items
        .map((it, idx) => {
          const size =
            p.showSize === false
              ? ''
              : `<td style="text-align:right;">${fmt(it.widthMm)} × ${fmt(it.heightMm)} mm</td>`;
          const name = (it.fileName || 'Part').replace(/\.dxf$/i, '');
          return `<tr>
            <td>${idx + 1}</td>
            <td>Laser-cut 3 mm Corten — ${esc(name)}</td>
            <td style="text-align:right;">${it.qty || 1}</td>
            ${size}
          </tr>`;
        })
        .join('');
    }
  }

  // DXF profile drawings for customer print / PDF
  const profHost = document.getElementById('print-profiles');
  if (profHost) {
    if (p.showProfile === false || !state.items.length) {
      profHost.innerHTML = '';
    } else {
      const cards = state.items
        .map((it, idx) => {
          const svg = itemSvgMarkup(it, 100);
          if (!svg) return '';
          const name = (it.fileName || 'Part').replace(/\.dxf$/i, '');
          const size = `${fmt(it.widthMm)} × ${fmt(it.heightMm)} mm`;
          return `<div class="profile-card">
            ${svg}
            <div class="cap"><strong>${idx + 1}.</strong> ${esc(name)}<br>${esc(size)}${it.qty > 1 ? ' · qty ' + it.qty : ''}</div>
          </div>`;
        })
        .filter(Boolean)
        .join('');
      profHost.innerHTML = cards
        ? `<p style="margin:0 0 6px;font-size:8pt;text-transform:uppercase;letter-spacing:0.08em;color:#888;font-weight:600;">Profiles</p>
           <div class="profile-grid">${cards}</div>`
        : '';
    }
  }

  setText('print-subtotal', '$' + fmt(calc.priceExcl));
  const gstRow = document.getElementById('print-gst-row');
  if (gstRow) gstRow.style.display = calc.gstOn === false ? 'none' : '';
  setText('print-gst', '$' + fmt(calc.gst));
  setText(
    'print-total',
    calc.gstOn === false ? '$' + fmt(calc.priceExcl) + ' excl. GST' : '$' + fmt(calc.priceIncl) + ' incl. GST'
  );

  setText('print-notes', '');
}

function printCustomerQuote() {
  if (!state.items.length) {
    toast('Add a DXF before printing a customer quote', true);
    return;
  }
  buildCustomerPrint();
  document.body.classList.add('printing-quote');
  const done = () => {
    document.body.classList.remove('printing-quote');
    window.removeEventListener('afterprint', done);
  };
  window.addEventListener('afterprint', done);
  // Allow layout paint then print (avoids blank first page from hidden admin UI)
  requestAnimationFrame(() => {
    setTimeout(() => window.print(), 80);
  });
}

/* ── Init ── */
function showApp() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  loadAll();
}

document.getElementById('login-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const pass = document.getElementById('login-pass').value;
  const err = document.getElementById('login-error');
  setLoggedIn(pass);
  const { res, ok, data } = await api('/api/customers');
  if (res.status === 401 || /unauthor/i.test(String(data?.error || ''))) {
    clearSession();
    err.classList.remove('hidden');
    return;
  }
  // 503 ADMIN_PASSWORD missing, or network — still open UI (local draft / setup)
  err.classList.add('hidden');
  showApp();
});

document.getElementById('btn-logout')?.addEventListener('click', () => {
  clearSession();
  location.reload();
});

document.querySelectorAll('.nav-btn').forEach((btn) => {
  btn.addEventListener('click', () => showView(btn.getAttribute('data-view')));
});

document.getElementById('btn-new-quote')?.addEventListener('click', newQuote);
document.getElementById('btn-back-list')?.addEventListener('click', () => showView('quotes'));
document.getElementById('btn-print')?.addEventListener('click', printCustomerQuote);
document.getElementById('btn-save-quote')?.addEventListener('click', saveQuote);
document.getElementById('btn-save-customer')?.addEventListener('click', saveCustomer);
document.getElementById('btn-save-settings')?.addEventListener('click', saveSettings);
document.getElementById('btn-reset-cost')?.addEventListener('click', () => {
  state.costManual = false;
  state.overrides = {};
  recalc(false);
});
document.getElementById('btn-gst')?.addEventListener('click', () => {
  state.gstOn = !state.gstOn;
  updateGstButton();
  recalc(true);
});
document.getElementById('margin-range')?.addEventListener('input', (e) => {
  state.marginPercent = parseInt(e.target.value, 10) || 0;
  document.getElementById('margin-label').textContent = state.marginPercent + '%';
  recalc(true);
});
['cost-material', 'cost-laser', 'cost-setup', 'cost-freight'].forEach((id) => {
  document.getElementById(id)?.addEventListener('change', readCostInputs);
});

document.getElementById('customer-select')?.addEventListener('change', (e) => {
  const c = customers.find((x) => x.id === e.target.value);
  if (!c) return;
  document.getElementById('c-name').value = c.name || '';
  document.getElementById('c-company').value = c.company || '';
  document.getElementById('c-email').value = c.email || '';
  document.getElementById('c-phone').value = c.phone || '';
  document.getElementById('c-address').value = c.address || '';
});

setupDropzone();

if (isLoggedIn()) {
  showApp();
}
