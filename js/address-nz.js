/**
 * NZ address autocomplete + rural detection.
 *
 * Primary: Photon (Komoot) — fast type-ahead, typo-tolerant
 * Fallback/merge: OpenStreetMap Nominatim — richer NZ address parts
 *
 * Free, no API key. Debounced, keyboard-friendly.
 */
(function (global) {
  const PHOTON = 'https://photon.komoot.io/api/';
  const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
  // Approximate NZ bounding box (lon/lat)
  const NZ_BBOX = { minLon: 166.0, minLat: -47.5, maxLon: 179.0, maxLat: -34.0 };
  // Bias toward Gisborne (workshop) then NZ centre
  const BIAS = { lat: -38.6623, lon: 178.0176 };

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
      { re: /\bstate\s+highway\b/i, reason: 'State Highway' },
      { re: /\bSH\s*\d+\b/i, reason: 'State Highway' },
    ];
    for (const t of tests) {
      if (t.re.test(s)) return { rural: true, reason: t.reason };
    }
    return { rural: false, reason: '' };
  }

  function detectRuralFromParts(item) {
    if (!item) return detectRuralFromText('');
    const a = item.address || {};
    const type = String(item.type || item.osm_value || '').toLowerCase();
    const display = String(item.display_name || item.short || '');

    const textHit = detectRuralFromText(
      [
        display,
        a.suburb,
        a.hamlet,
        a.village,
        a.locality,
        a.road,
        a.street,
        a.city,
        a.town,
        a.municipality,
        a.county,
        a.district,
        a.state,
      ]
        .filter(Boolean)
        .join(' ')
    );
    if (textHit.rural) return textHit;

    const ruralTypes = [
      'hamlet',
      'farm',
      'farmyard',
      'isolated_dwelling',
      'allotments',
      'locality',
      'croft',
      'house', // house on rural road often still ok either way
    ];
    // Only flag clearly rural place types
    if (['hamlet', 'farm', 'farmyard', 'isolated_dwelling', 'locality', 'croft'].includes(type)) {
      return { rural: true, reason: 'Rural locality (' + type + ')' };
    }

    const hasRuralPart = !!(a.hamlet || a.locality || a.farm || a.croft);
    const hasVillage = !!a.village;
    const hasSuburb = !!(a.suburb || a.neighbourhood || a.quarter || a.district);
    const hasCity = !!(a.city || a.town || a.municipality || a.city_district);

    if (hasRuralPart) return { rural: true, reason: 'Rural locality in address' };
    if (hasVillage && !hasSuburb) return { rural: true, reason: 'Village / rural settlement' };
    if (a.road && a.postcode && !hasSuburb && !hasCity && !hasVillage) {
      return { rural: true, reason: 'Rural road (no town suburb)' };
    }
    return { rural: false, reason: '' };
  }

  function detectRural(address, item) {
    if (item) return detectRuralFromParts(item);
    return detectRuralFromText(address);
  }

  function formatShort(item) {
    const a = item.address || {};
    const num = a.house_number || a.housenumber || '';
    const road = a.road || a.street || a.name || '';
    const line1 = [num, road].filter(Boolean).join(' ').trim();
    const mid =
      a.hamlet || a.locality || a.village || a.suburb || a.neighbourhood || a.district || '';
    const city = a.city || a.town || a.municipality || a.county || a.state || '';
    const pc = a.postcode || '';
    const line2 = [mid, city, pc].filter(Boolean).join(', ');
    if (line1 && line2) return line1 + ', ' + line2;
    if (line1) return line1 + (pc ? ', ' + pc : '');
    return item.display_name || item.label || '';
  }

  function formatDisplay(item) {
    return item.display_name || formatShort(item) || '';
  }

  /** Normalize Photon feature → internal item */
  function fromPhoton(feature) {
    const p = feature.properties || {};
    const coords = (feature.geometry && feature.geometry.coordinates) || [];
    const address = {
      house_number: p.housenumber || '',
      housenumber: p.housenumber || '',
      road: p.street || p.name || '',
      street: p.street || '',
      name: p.name || '',
      suburb: p.district || p.locality || '',
      neighbourhood: p.district || '',
      district: p.district || '',
      city: p.city || '',
      town: p.city || p.town || '',
      municipality: p.city || '',
      county: p.county || '',
      state: p.state || '',
      postcode: p.postcode || '',
      country: p.country || 'New Zealand',
      country_code: (p.countrycode || 'nz').toLowerCase(),
      hamlet: p.osm_value === 'hamlet' ? p.name : '',
      locality: p.osm_value === 'locality' ? p.name : '',
      village: p.osm_value === 'village' ? p.name : '',
    };
    // Build a display line Photon-style
    const parts = [
      [p.housenumber, p.street || p.name].filter(Boolean).join(' '),
      p.district,
      p.city,
      p.county,
      p.state,
      p.postcode,
      p.country,
    ].filter(Boolean);
    const item = {
      source: 'photon',
      lat: coords[1],
      lon: coords[0],
      type: p.osm_value || p.type || '',
      class: p.osm_key || '',
      osm_value: p.osm_value || '',
      address,
      display_name: parts.join(', '),
      importance: p.osm_value === 'house' || p.housenumber ? 1 : 0.5,
    };
    item.short = formatShort(item);
    return item;
  }

  /** Normalize Nominatim result */
  function fromNominatim(raw) {
    const item = {
      source: 'nominatim',
      lat: parseFloat(raw.lat),
      lon: parseFloat(raw.lon),
      type: raw.type || '',
      class: raw.class || '',
      address: raw.address || {},
      display_name: raw.display_name || '',
      importance: Number(raw.importance) || 0,
      raw,
    };
    // Promote house numbers
    if (item.address.house_number) item.importance += 0.5;
    item.short = formatShort(item);
    return item;
  }

  function dedupeKey(item) {
    return (item.short || item.display_name || '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  function mergeResults(lists) {
    const map = new Map();
    lists.flat().forEach((item) => {
      if (!item) return;
      // NZ only
      const cc = (item.address && (item.address.country_code || item.address.countrycode)) || '';
      const country = (item.address && item.address.country) || '';
      if (cc && String(cc).toLowerCase() !== 'nz' && !/new zealand/i.test(country)) {
        // Photon sometimes omits countrycode when biased — keep if coords in NZ box
        if (item.lat == null || item.lon == null) return;
        if (
          item.lon < NZ_BBOX.minLon ||
          item.lon > NZ_BBOX.maxLon ||
          item.lat < NZ_BBOX.minLat ||
          item.lat > NZ_BBOX.maxLat
        ) {
          return;
        }
      }
      const key = dedupeKey(item);
      if (!key) return;
      const prev = map.get(key);
      if (!prev || (item.importance || 0) > (prev.importance || 0)) {
        map.set(key, item);
      }
    });
    return [...map.values()]
      .sort((a, b) => {
        // Prefer numbered street addresses
        const aNum = a.address && (a.address.house_number || a.address.housenumber) ? 1 : 0;
        const bNum = b.address && (b.address.house_number || b.address.housenumber) ? 1 : 0;
        if (bNum !== aNum) return bNum - aNum;
        return (b.importance || 0) - (a.importance || 0);
      })
      .slice(0, 8);
  }

  async function searchPhoton(q, signal) {
    const url = new URL(PHOTON);
    url.searchParams.set('q', q);
    url.searchParams.set('limit', '10');
    url.searchParams.set('lang', 'en');
    url.searchParams.set('lat', String(BIAS.lat));
    url.searchParams.set('lon', String(BIAS.lon));
    // bbox: minLon,minLat,maxLon,maxLat
    url.searchParams.set(
      'bbox',
      [NZ_BBOX.minLon, NZ_BBOX.minLat, NZ_BBOX.maxLon, NZ_BBOX.maxLat].join(',')
    );

    const res = await fetch(url.toString(), {
      signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error('Photon lookup failed');
    const data = await res.json();
    const features = Array.isArray(data.features) ? data.features : [];
    return features
      .map(fromPhoton)
      .filter((it) => {
        // Prefer NZ results
        const cc = (it.address.country_code || '').toLowerCase();
        if (cc && cc !== 'nz') return false;
        if (it.lat != null && it.lon != null) {
          return (
            it.lon >= NZ_BBOX.minLon &&
            it.lon <= NZ_BBOX.maxLon &&
            it.lat >= NZ_BBOX.minLat &&
            it.lat <= NZ_BBOX.maxLat
          );
        }
        return true;
      });
  }

  async function searchNominatim(q, signal) {
    const url = new URL(NOMINATIM);
    // Append New Zealand to bias freer text
    const query = /new zealand|\bnz\b/i.test(q) ? q : q + ', New Zealand';
    url.searchParams.set('q', query);
    url.searchParams.set('format', 'json');
    url.searchParams.set('addressdetails', '1');
    url.searchParams.set('countrycodes', 'nz');
    url.searchParams.set('limit', '8');
    url.searchParams.set('dedupe', '1');
    // Viewbox NZ (left,top,right,bottom) — lon/lat
    url.searchParams.set(
      'viewbox',
      [NZ_BBOX.minLon, NZ_BBOX.maxLat, NZ_BBOX.maxLon, NZ_BBOX.minLat].join(',')
    );
    url.searchParams.set('bounded', '0'); // prefer viewbox but allow outside

    const res = await fetch(url.toString(), {
      signal,
      headers: {
        Accept: 'application/json',
        'Accept-Language': 'en-NZ,en',
      },
    });
    if (!res.ok) throw new Error('Nominatim lookup failed');
    const data = await res.json();
    return (Array.isArray(data) ? data : []).map(fromNominatim);
  }

  async function searchBoth(q, signal) {
    // Photon is faster for typeahead; Nominatim fills gaps for full NZ addresses
    const tasks = [
      searchPhoton(q, signal).catch(() => []),
      searchNominatim(q, signal).catch(() => []),
    ];
    const [photon, nomi] = await Promise.all(tasks);
    return mergeResults([photon, nomi]);
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /** Highlight query tokens in result text */
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
      out = out.replace(re, '<mark class="bg-corten-600/40 text-corten-200 rounded px-0.5">$1</mark>');
    });
    return out;
  }

  let debounceTimer = null;
  let abortCtrl = null;

  /**
   * @param {HTMLInputElement} input
   * @param {HTMLElement} dropdown
   * @param {(result: object) => void} onSelect
   */
  function attachAutocomplete(input, dropdown, onSelect) {
    if (!input || !dropdown) return;

    let results = [];
    let activeIdx = -1;

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
        btn.classList.toggle('bg-corten-600/25', idx === activeIdx);
        btn.classList.toggle('ring-1', idx === activeIdx);
        btn.classList.toggle('ring-corten-500/50', idx === activeIdx);
        if (idx === activeIdx) btn.scrollIntoView({ block: 'nearest' });
      });
    }

    function pick(item) {
      if (!item) return;
      const rural = detectRuralFromParts(item);
      const textRural = detectRuralFromText(item.display_name + ' ' + item.short);
      const finalRural = rural.rural || textRural.rural;
      const reason = rural.rural ? rural.reason : textRural.reason;
      // Prefer fuller line when it keeps RD / rural markers
      const value =
        textRural.rural && item.display_name && item.display_name.length > (item.short || '').length
          ? item.display_name
          : item.short || item.display_name;
      input.value = value;
      hide();
      onSelect({
        display: item.display_name,
        short: value,
        rural: finalRural,
        reason,
        raw: item,
      });
    }

    function renderList(q) {
      if (!results.length) {
        dropdown.innerHTML =
          '<div class="px-3 py-3 text-xs text-gray-400">' +
          'No matches — keep typing street number + name, or enter full address (include <strong class="text-gray-300">RD</strong> if rural)' +
          '</div>';
        dropdown.classList.remove('hidden');
        return;
      }

      dropdown.innerHTML =
        results
          .map((item, i) => {
            const rural = detectRuralFromParts(item);
            const short = item.short || formatShort(item);
            const full = item.display_name || short;
            return (
              `<button type="button" data-idx="${i}" class="addr-opt w-full text-left px-3 py-2.5 text-sm hover:bg-corten-600/20 border-b border-white/5 last:border-0 transition">` +
              `<span class="text-white block leading-snug">${highlightMatch(short, q)}</span>` +
              (full !== short
                ? `<span class="text-[10px] text-gray-500 mt-0.5 block truncate">${highlightMatch(full, q)}</span>`
                : '') +
              `<span class="text-[10px] ${rural.rural ? 'text-amber-400' : 'text-emerald-500/80'} mt-0.5 block">` +
              (rural.rural ? 'Rural delivery · higher shipping' : 'Standard address') +
              `</span></button>`
            );
          })
          .join('') +
        '<div class="px-3 py-1.5 text-[10px] text-gray-600 border-t border-white/5">NZ addresses · pick one from the list</div>';

      dropdown.classList.remove('hidden');
      activeIdx = -1;

      dropdown.querySelectorAll('.addr-opt').forEach((btn) => {
        btn.addEventListener('mousedown', (e) => {
          // mousedown before blur so click registers
          e.preventDefault();
          const item = results[parseInt(btn.dataset.idx, 10)];
          pick(item);
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
          results = await searchBoth(q, abortCtrl.signal);
          renderList(q);
        } catch (e) {
          if (e.name === 'AbortError') return;
          dropdown.innerHTML =
            '<div class="px-3 py-3 text-xs text-gray-400">' +
            'Lookup unavailable — type full NZ address manually (include RD if rural)' +
            '</div>';
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
      } else if (e.key === 'Enter') {
        if (activeIdx >= 0 && results[activeIdx]) {
          e.preventDefault();
          pick(results[activeIdx]);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        hide();
      }
    });

    input.addEventListener('blur', () => {
      setTimeout(hide, 180);
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

  global.NzAddress = {
    detectRural,
    detectRuralFromText,
    detectRuralFromNominatim: detectRuralFromParts,
    attachAutocomplete,
  };
})(typeof window !== 'undefined' ? window : globalThis);
