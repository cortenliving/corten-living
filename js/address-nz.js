/**
 * NZ address autocomplete + standard/rural detection.
 * Uses OpenStreetMap Nominatim (free, NZ only). Debounced search.
 *
 * Rural detection uses:
 *  - RD / Private Bag / RMB text patterns
 *  - Nominatim place types (hamlet, farm, isolated_dwelling, locality…)
 *  - Address parts that indicate non-urban NZ delivery
 */
(function (global) {
  const NOMINATIM = 'https://nominatim.openstreetmap.org/search';

  /** Text / pattern rural markers (NZ couriers) */
  function detectRuralFromText(address) {
    const s = String(address || '');
    if (!s.trim()) return { rural: false, reason: '' };

    const tests = [
      { re: /\bR\.?\s*D\.?\s*\d+\b/i, reason: 'Rural Delivery (RD) number' },
      { re: /\bRD\s*\d+\b/i, reason: 'RD number' },
      { re: /\bR\s*D\s*\d+\b/i, reason: 'RD number' },
      { re: /\brural\s+delivery\b/i, reason: 'Rural Delivery' },
      { re: /\bprivate\s+bag\b/i, reason: 'Private Bag' },
      { re: /\bP\.?\s*B\.?\s*\d+/i, reason: 'Private Bag' },
      { re: /\bRMB\b/i, reason: 'Roadside Mail Box' },
      { re: /\brural\b/i, reason: 'Contains “rural”' },
      { re: /\bfarm\b/i, reason: 'Farm address' },
      { re: /\bstation\b/i, reason: 'Station / farm station' },
      // Common NZ rural road wording in free text
      { re: /\bstate\s+highway\b/i, reason: 'State Highway (often rural)' },
      { re: /\bSH\s*\d+\b/i, reason: 'State Highway' },
    ];
    for (const t of tests) {
      if (t.re.test(s)) return { rural: true, reason: t.reason };
    }
    return { rural: false, reason: '' };
  }

  /**
   * Detect rural from full Nominatim result (type + address parts).
   * Many NZ rural roads are returned without "RD" in the short line.
   */
  function detectRuralFromNominatim(item) {
    if (!item) return detectRuralFromText('');

    const a = item.address || {};
    const type = String(item.type || '').toLowerCase();
    const cls = String(item.class || '').toLowerCase();
    const display = String(item.display_name || '');

    // Explicit text markers first (full OSM line often keeps RD)
    const textHit = detectRuralFromText(
      [display, a.suburb, a.hamlet, a.village, a.locality, a.road, a.city, a.town, a.municipality, a.county]
        .filter(Boolean)
        .join(' ')
    );
    if (textHit.rural) return textHit;

    // OSM place types that are almost always rural delivery in NZ
    const ruralTypes = [
      'hamlet',
      'farm',
      'farmyard',
      'isolated_dwelling',
      'allotments',
      'locality',
      'croft',
    ];
    if (ruralTypes.includes(type)) {
      return { rural: true, reason: 'Rural locality (' + type + ')' };
    }
    if (cls === 'place' && ['hamlet', 'farm', 'isolated_dwelling', 'locality'].includes(type)) {
      return { rural: true, reason: 'Rural place type' };
    }

    // Address component heuristics (NZ):
    // - has hamlet / locality / farm and no dense suburb/city core
    // - or village without suburb (common outside towns)
    const hasRuralPart = !!(a.hamlet || a.locality || a.farm || a.croft);
    const hasVillage = !!a.village;
    const hasSuburb = !!(a.suburb || a.neighbourhood || a.quarter);
    const hasCity = !!(a.city || a.town || a.municipality || a.city_district);

    if (hasRuralPart) {
      return { rural: true, reason: 'Rural locality in address' };
    }

    // Village-only (no suburb) — often rural NZ
    if (hasVillage && !hasSuburb) {
      return { rural: true, reason: 'Village / rural settlement' };
    }

    // County / district road outside named suburb — treat carefully:
    // If we only have road + postcode + region (no suburb/city), likely rural
    if (a.road && a.postcode && !hasSuburb && !hasCity && !hasVillage) {
      return { rural: true, reason: 'Rural road (no town suburb)' };
    }

    // If county present and no suburb (Gisborne district rural parcels often look like this)
    if (a.county && a.road && !hasSuburb && !a.city) {
      // town may still be present as nearest service town — if only town + road + no suburb, could be RD
      // Prefer rural when road is long name and town is present without suburb
      if (!a.suburb && !a.neighbourhood && (a.town || a.municipality || a.county)) {
        // Still ambiguous (e.g. "Main Street, Gisborne") — only flag if road suggests rural
        const road = String(a.road || '');
        if (/\b(road|rd|track|line|valley|ridge|creek|beach|bay)\b/i.test(road) && !/\b(street|st|avenue|ave|terrace|place|crescent|drive|way)\b/i.test(road)) {
          // "Something Road, Gisborne" without suburb is often rural/edge
          // But urban also has "Roads". Skip pure street-style.
        }
      }
    }

    return { rural: false, reason: '' };
  }

  /** Public API — text only (manual typing) */
  function detectRural(address, nominatimItem) {
    if (nominatimItem) return detectRuralFromNominatim(nominatimItem);
    return detectRuralFromText(address);
  }

  function formatDisplay(item) {
    return item.display_name || '';
  }

  function formatShort(item) {
    const a = item.address || {};
    const line1 = [a.house_number, a.road].filter(Boolean).join(' ');
    // Keep rural locality / village / RD-style suburb in the line so detection + courier see it
    const mid = a.hamlet || a.locality || a.village || a.suburb || a.neighbourhood || '';
    const line2 = [mid, a.city || a.town || a.municipality, a.postcode]
      .filter(Boolean)
      .join(', ');
    if (line1 && line2) return line1 + ', ' + line2;
    if (line1) return line1 + (a.postcode ? ', ' + a.postcode : '');
    return formatDisplay(item);
  }

  let debounceTimer = null;
  let abortCtrl = null;

  /**
   * @param {HTMLInputElement} input
   * @param {HTMLElement} dropdown
   * @param {(result: {display, short, rural, reason, raw, manual?}) => void} onSelect
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
      url.searchParams.set('limit', '8');

      const res = await fetch(url.toString(), {
        signal: abortCtrl.signal,
        headers: {
          Accept: 'application/json',
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
            dropdown.innerHTML = '<div class="px-3 py-2 text-xs text-gray-400">No matches — keep typing or enter full address manually</div>';
            dropdown.classList.remove('hidden');
            return;
          }
          dropdown.innerHTML = results.map((item, i) => {
            const short = formatShort(item);
            const rural = detectRuralFromNominatim(item);
            return `<button type="button" data-idx="${i}" class="addr-opt w-full text-left px-3 py-2.5 text-sm hover:bg-corten-600/20 border-b border-white/5 last:border-0 transition">
              <span class="text-white block leading-snug">${escapeHtml(short)}</span>
              <span class="text-[10px] text-gray-500 mt-0.5 block truncate">${escapeHtml(formatDisplay(item))}</span>
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
              const rural = detectRuralFromNominatim(item);
              // Prefer full display when it carries RD / rural markers missing from short form
              const textRural = detectRuralFromText(display + ' ' + short);
              const finalRural = rural.rural || textRural.rural;
              const reason = rural.rural ? rural.reason : textRural.reason;
              // Keep full line in field when short drops RD
              input.value = (textRural.rural && display.length > short.length) ? display : short;
              hide();
              onSelect({
                display,
                short: input.value,
                rural: finalRural,
                reason,
                raw: item,
              });
            });
          });
        } catch (e) {
          if (e.name === 'AbortError') return;
          dropdown.innerHTML = '<div class="px-3 py-2 text-xs text-gray-400">Could not look up addresses — type full address manually (include RD if rural)</div>';
          dropdown.classList.remove('hidden');
        }
      }, 350);
    });

    input.addEventListener('blur', () => {
      setTimeout(hide, 200);
    });

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

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  global.NzAddress = {
    detectRural,
    detectRuralFromText,
    detectRuralFromNominatim,
    attachAutocomplete,
  };
})(typeof window !== 'undefined' ? window : globalThis);
