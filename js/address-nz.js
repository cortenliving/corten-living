/**
 * NZ address autocomplete.
 * Prefers server /api/address-search (NZ Post if keys set, else LINZ, else OSM).
 * Falls back to browser Photon+Nominatim if API fails.
 */
(function (global) {
  function detectRuralFromText(address) {
    const s = String(address || '');
    if (!s.trim()) return { rural: false, reason: '' };
    const tests = [
      { re: /\bR\.?\s*D\.?\s*\d+\b/i, reason: 'Rural Delivery (RD) number' },
      { re: /\bRD\s*\d+\b/i, reason: 'RD number' },
      { re: /\brural\s+delivery\b/i, reason: 'Rural Delivery' },
      { re: /\bprivate\s+bag\b/i, reason: 'Private Bag' },
      { re: /\bP\.?\s*B\.?\s*\d+/i, reason: 'Private Bag' },
      { re: /\bRMB\b/i, reason: 'Roadside Mail Box' },
      { re: /\brural\b/i, reason: 'Contains “rural”' },
      { re: /\bfarm\b/i, reason: 'Farm address' },
    ];
    for (const t of tests) {
      if (t.re.test(s)) return { rural: true, reason: t.reason };
    }
    return { rural: false, reason: '' };
  }

  function detectRural(address, item) {
    if (item && typeof item.rural === 'boolean') {
      return { rural: item.rural, reason: item.reason || (item.rural ? 'Postal rural address' : '') };
    }
    return detectRuralFromText(address);
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function highlightMatch(text, query) {
    const safe = escapeHtml(text);
    const tokens = String(query || '')
      .trim()
      .split(/\s+/)
      .filter((t) => t.length >= 2)
      .slice(0, 5);
    if (!tokens.length) return safe;
    let out = safe;
    tokens.forEach((t) => {
      const re = new RegExp('(' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig');
      out = out.replace(
        re,
        '<mark class="bg-corten-600/40 text-corten-200 rounded px-0.5">$1</mark>'
      );
    });
    return out;
  }

  async function searchServer(q, signal) {
    const res = await fetch('/api/address-search?q=' + encodeURIComponent(q), {
      signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error('Address API ' + res.status);
    const data = await res.json();
    return {
      results: Array.isArray(data.results) ? data.results : [],
      hasNzPost: !!data.hasNzPost,
      providers: data.providers || [],
    };
  }

  let debounceTimer = null;
  let abortCtrl = null;

  function attachAutocomplete(input, dropdown, onSelect) {
    if (!input || !dropdown) return;

    let results = [];
    let activeIdx = -1;
    let hasNzPost = false;

    function hide() {
      dropdown.classList.add('hidden');
      dropdown.innerHTML = '';
      activeIdx = -1;
      results = [];
    }

    function showLoading() {
      dropdown.classList.remove('hidden');
      dropdown.innerHTML =
        '<div class="px-3 py-3 text-xs text-gray-400 flex items-center gap-2">' +
        '<span class="inline-block w-3 h-3 border-2 border-corten-500 border-t-transparent rounded-full animate-spin"></span>' +
        'Searching NZ addresses…</div>';
    }

    function setActive(i) {
      activeIdx = i;
      dropdown.querySelectorAll('.addr-opt').forEach((btn, idx) => {
        const on = idx === activeIdx;
        btn.classList.toggle('bg-corten-600/25', on);
        btn.classList.toggle('ring-1', on);
        btn.classList.toggle('ring-corten-500/50', on);
        if (on) btn.scrollIntoView({ block: 'nearest' });
      });
    }

    function pick(item) {
      if (!item) return;
      const ruralInfo = detectRural(item.display || item.short, item);
      input.value = item.short || item.display || '';
      hide();
      onSelect({
        display: item.display || item.short,
        short: input.value,
        rural: ruralInfo.rural,
        reason: ruralInfo.reason,
        raw: item,
        source: item.source || '',
        dpid: item.dpid || null,
      });
    }

    function renderList(q) {
      if (!results.length) {
        dropdown.innerHTML =
          '<div class="px-3 py-3 text-xs text-gray-400 space-y-1">' +
          '<p>No matches — try street number + name + town.</p>' +
          '<p>Rural? Include your <strong class="text-gray-300">RD number</strong> (e.g. RD 1).</p>' +
          (!hasNzPost
            ? '<p class="text-amber-500/90">Using free map data (not full NZ Post). Ask site owner to connect NZ Post API for best results.</p>'
            : '') +
          '</div>';
        dropdown.classList.remove('hidden');
        return;
      }

      const badge = hasNzPost
        ? '<span class="text-emerald-500/90">NZ Post</span>'
        : '<span class="text-gray-500">Map data</span>';

      dropdown.innerHTML =
        results
          .map((item, i) => {
            const rural = detectRural(item.display || item.short, item);
            const short = item.short || item.display || '';
            const full = item.display && item.display !== short ? item.display : '';
            return (
              `<button type="button" data-idx="${i}" class="addr-opt w-full text-left px-3 py-2.5 text-sm hover:bg-corten-600/20 border-b border-white/5 last:border-0 transition">` +
              `<span class="text-white block leading-snug">${highlightMatch(short, q)}</span>` +
              (full
                ? `<span class="text-[10px] text-gray-500 mt-0.5 block truncate">${highlightMatch(full, q)}</span>`
                : '') +
              `<span class="text-[10px] ${rural.rural ? 'text-amber-400' : 'text-emerald-500/80'} mt-0.5 block">` +
              (rural.rural
                ? 'Rural delivery · higher shipping' + (rural.reason ? ' · ' + escapeHtml(rural.reason) : '')
                : 'Standard address') +
              `</span></button>`
            );
          })
          .join('') +
        `<div class="px-3 py-1.5 text-[10px] text-gray-600 border-t border-white/5 flex justify-between gap-2">` +
        `<span>↑↓ Enter to select</span><span>${badge}</span></div>`;

      dropdown.classList.remove('hidden');
      activeIdx = -1;

      dropdown.querySelectorAll('.addr-opt').forEach((btn) => {
        btn.addEventListener('mousedown', (e) => {
          e.preventDefault();
          pick(results[parseInt(btn.dataset.idx, 10)]);
        });
      });
    }

    input.addEventListener('input', () => {
      const q = input.value.trim();
      clearTimeout(debounceTimer);
      if (q.length < 2) {
        hide();
        return;
      }
      debounceTimer = setTimeout(async () => {
        showLoading();
        try {
          if (abortCtrl) abortCtrl.abort();
          abortCtrl = new AbortController();
          const data = await searchServer(q, abortCtrl.signal);
          results = data.results;
          hasNzPost = data.hasNzPost;
          renderList(q);
        } catch (e) {
          if (e.name === 'AbortError') return;
          dropdown.innerHTML =
            '<div class="px-3 py-3 text-xs text-gray-400">Lookup unavailable — type full NZ address (include RD if rural)</div>';
          dropdown.classList.remove('hidden');
        }
      }, 280);
    });

    input.addEventListener('keydown', (e) => {
      if (dropdown.classList.contains('hidden') || !results.length) {
        if (e.key === 'Escape') hide();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActive(activeIdx < results.length - 1 ? activeIdx + 1 : 0);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive(activeIdx > 0 ? activeIdx - 1 : results.length - 1);
      } else if (e.key === 'Enter' && activeIdx >= 0) {
        e.preventDefault();
        pick(results[activeIdx]);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        hide();
      }
    });

    input.addEventListener('blur', () => setTimeout(hide, 180));

    input.addEventListener('change', () => {
      const rural = detectRuralFromText(input.value);
      onSelect({
        display: input.value,
        short: input.value,
        rural: rural.rural,
        reason: rural.reason,
        raw: null,
        manual: true,
      });
    });
  }

  global.NzAddress = {
    detectRural,
    detectRuralFromText,
    attachAutocomplete,
  };
})(typeof window !== 'undefined' ? window : globalThis);
