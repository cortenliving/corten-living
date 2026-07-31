/**
 * NZ address autocomplete + standard/rural detection.
 * Uses OpenStreetMap Nominatim (free, NZ only). Debounced search.
 */
(function (global) {
  const NOMINATIM = 'https://nominatim.openstreetmap.org/search';

  /** NZ rural delivery patterns (RD, Rural Delivery, etc.) */
  function detectRural(address) {
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
    ];
    for (const t of tests) {
      if (t.re.test(s)) return { rural: true, reason: t.reason };
    }
    return { rural: false, reason: '' };
  }

  function formatDisplay(item) {
    return item.display_name || '';
  }

  function formatShort(item) {
    // Prefer NZ-style compact line from address parts
    const a = item.address || {};
    const line1 = [a.house_number, a.road].filter(Boolean).join(' ');
    const line2 = [a.suburb || a.village || a.hamlet || a.neighbourhood, a.city || a.town || a.municipality, a.postcode]
      .filter(Boolean)
      .join(', ');
    if (line1 && line2) return line1 + ', ' + line2;
    return formatDisplay(item);
  }

  let debounceTimer = null;
  let abortCtrl = null;

  /**
   * Attach autocomplete to an input.
   * @param {HTMLInputElement} input
   * @param {HTMLElement} dropdown
   * @param {(result: {display, short, rural, raw}) => void} onSelect
   */
  function attachAutocomplete(input, dropdown, onSelect) {
    if (!input || !dropdown) return;

    function hide() {
      dropdown.classList.add('hidden');
      dropdown.innerHTML = '';
    }

    function showLoading() {
      dropdown.classList.remove('hidden');
      dropdown.innerHTML = '<div class="px-3 py-2 text-xs text-gray-400">Searching NZ addresses…</div>';
    }

    async function search(q) {
      if (abortCtrl) abortCtrl.abort();
      abortCtrl = new AbortController();
      const url = new URL(NOMINATIM);
      url.searchParams.set('q', q);
      url.searchParams.set('format', 'json');
      url.searchParams.set('addressdetails', '1');
      url.searchParams.set('countrycodes', 'nz');
      url.searchParams.set('limit', '6');

      const res = await fetch(url.toString(), {
        signal: abortCtrl.signal,
        headers: {
          Accept: 'application/json',
          // Nominatim usage policy: identify the app
          'Accept-Language': 'en-NZ,en',
        },
      });
      if (!res.ok) throw new Error('Address lookup failed');
      return res.json();
    }

    input.addEventListener('input', () => {
      const q = input.value.trim();
      clearTimeout(debounceTimer);
      if (q.length < 3) {
        hide();
        return;
      }
      debounceTimer = setTimeout(async () => {
        showLoading();
        try {
          const results = await search(q);
          if (!results.length) {
            dropdown.innerHTML = '<div class="px-3 py-2 text-xs text-gray-400">No matches — keep typing or enter manually</div>';
            dropdown.classList.remove('hidden');
            return;
          }
          dropdown.innerHTML = results.map((item, i) => {
            const short = formatShort(item);
            const rural = detectRural(item.display_name + ' ' + short);
            return `<button type="button" data-idx="${i}" class="addr-opt w-full text-left px-3 py-2.5 text-sm hover:bg-corten-600/20 border-b border-white/5 last:border-0 transition">
              <span class="text-white block leading-snug">${escapeHtml(short)}</span>
              <span class="text-[10px] ${rural.rural ? 'text-amber-400' : 'text-gray-500'} mt-0.5 block">
                ${rural.rural ? 'Rural delivery · higher shipping' : 'Standard address'}
              </span>
            </button>`;
          }).join('');
          dropdown.classList.remove('hidden');

          dropdown.querySelectorAll('.addr-opt').forEach((btn) => {
            btn.addEventListener('click', () => {
              const item = results[parseInt(btn.dataset.idx, 10)];
              const short = formatShort(item);
              const display = formatDisplay(item);
              const rural = detectRural(display + ' ' + short);
              input.value = short;
              hide();
              onSelect({
                display,
                short,
                rural: rural.rural,
                reason: rural.reason,
                raw: item,
              });
            });
          });
        } catch (e) {
          if (e.name === 'AbortError') return;
          dropdown.innerHTML = '<div class="px-3 py-2 text-xs text-gray-400">Could not look up addresses — type manually</div>';
          dropdown.classList.remove('hidden');
        }
      }, 350);
    });

    input.addEventListener('blur', () => {
      setTimeout(hide, 200);
    });

    // Re-detect rural when typing manually
    input.addEventListener('change', () => {
      const rural = detectRural(input.value);
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

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  global.NzAddress = {
    detectRural,
    attachAutocomplete,
  };
})(typeof window !== 'undefined' ? window : globalThis);
