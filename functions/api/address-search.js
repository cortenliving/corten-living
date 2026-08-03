import { json, handleOptions } from '../../lib/auth.js';

/**
 * NZ address autocomplete (server-side).
 *
 * Providers (first available wins for ranking, results are merged):
 *  1) NZ Post Address / ParcelAddress API — needs NZ_POST_CLIENT_ID + NZ_POST_CLIENT_SECRET
 *     (or NZ_POST_API_KEY for legacy). This is the real NZ Post postal database + rural flag.
 *  2) LINZ NZ Addresses — free key from data.linz.govt.nz (LINZ_API_KEY)
 *  3) Photon + Nominatim (OpenStreetMap) — free fallback, no key
 *
 * GET /api/address-search?q=12+peel+st+gisborne
 */

export async function onRequestOptions() {
  return handleOptions();
}

export async function onRequestGet(context) {
  const { env, request } = context;
  const url = new URL(request.url);
  const q = String(url.searchParams.get('q') || '').trim();
  if (q.length < 2) {
    return json({ results: [], provider: 'none', hint: 'Type at least 2 characters' });
  }

  const results = [];
  const providers = [];
  const errors = [];

  // 1) NZ Post (authoritative postal + rural)
  if (env.NZ_POST_CLIENT_ID && env.NZ_POST_CLIENT_SECRET) {
    try {
      const nz = await searchNzPost(env, q);
      if (nz.length) {
        results.push(...nz);
        providers.push('nzpost');
      }
    } catch (e) {
      errors.push('nzpost: ' + String(e.message || e));
    }
  } else if (env.NZ_POST_API_KEY) {
    try {
      const nz = await searchNzPostLegacyKey(env, q);
      if (nz.length) {
        results.push(...nz);
        providers.push('nzpost-legacy');
      }
    } catch (e) {
      errors.push('nzpost-legacy: ' + String(e.message || e));
    }
  }

  // 2) LINZ free addresses (physical TA addresses — may lack RD type)
  let linzCount = 0;
  if (env.LINZ_API_KEY) {
    try {
      const linz = await searchLinz(env, q);
      linzCount = linz.length;
      results.push(...linz);
      providers.push('linz');
      if (!linz.length) errors.push('linz: key ok but 0 matches for this query');
    } catch (e) {
      errors.push('linz: ' + String(e.message || e).slice(0, 200));
    }
  }

  // 3) OSM fallback (always fill gaps)
  if (results.length < 8) {
    try {
      const osm = await searchOsm(q);
      results.push(...osm);
      providers.push('osm');
    } catch (e) {
      errors.push('osm: ' + String(e.message || e));
    }
  }

  const merged = dedupeAndRank(results).slice(0, 10);
  return json({
    results: merged,
    providers,
    linzCount,
    hasLinzKey: !!env.LINZ_API_KEY,
    errors: errors.length ? errors : undefined,
    hasNzPost: !!(env.NZ_POST_CLIENT_ID && env.NZ_POST_CLIENT_SECRET) || !!env.NZ_POST_API_KEY,
  });
}

/* ─── NZ Post OAuth + Address search ─── */

let cachedToken = { value: null, exp: 0 };

async function getNzPostToken(env) {
  if (cachedToken.value && Date.now() < cachedToken.exp - 60_000) {
    return cachedToken.value;
  }
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: env.NZ_POST_CLIENT_ID,
    client_secret: env.NZ_POST_CLIENT_SECRET,
  });
  // Optional: some apps need a scope
  if (env.NZ_POST_OAUTH_SCOPE) body.set('scope', env.NZ_POST_OAUTH_SCOPE);

  const tokenUrl = env.NZ_POST_TOKEN_URL || 'https://oauth.nzpost.co.nz/as/token.oauth2';
  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: body.toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || ('token HTTP ' + res.status));
  }
  cachedToken = {
    value: data.access_token,
    exp: Date.now() + (Number(data.expires_in) || 3600) * 1000,
  };
  return cachedToken.value;
}

async function searchNzPost(env, q) {
  const token = await getNzPostToken(env);
  // ParcelAddress domestic suggest (common NZ Post ecommerce API)
  // Also try AddressChecker path if configured
  const endpoints = [
    env.NZ_POST_ADDRESS_URL ||
      'https://api.nzpost.co.nz/parceladdress/2.0/domestic/addresses',
    'https://api.nzpost.co.nz/addresschecker/1.0/suggest',
  ];

  let lastErr = null;
  for (const base of endpoints) {
    try {
      const u = new URL(base);
      if (!u.searchParams.has('q') && !u.searchParams.has('count')) {
        u.searchParams.set('q', q);
        u.searchParams.set('count', '10');
      } else {
        u.searchParams.set('q', q);
      }
      const res = await fetch(u.toString(), {
        headers: {
          Authorization: 'Bearer ' + token,
          Accept: 'application/json',
          'client_id': env.NZ_POST_CLIENT_ID,
        },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        lastErr = new Error(data.message || data.error || ('HTTP ' + res.status));
        continue;
      }
      const list = normalizeNzPostResponse(data);
      if (list.length) return list;
    } catch (e) {
      lastErr = e;
    }
  }
  if (lastErr) throw lastErr;
  return [];
}

async function searchNzPostLegacyKey(env, q) {
  // Some older keys use query param
  const u = new URL(
    env.NZ_POST_ADDRESS_URL || 'https://api.nzpost.co.nz/parceladdress/2.0/domestic/addresses'
  );
  u.searchParams.set('q', q);
  u.searchParams.set('count', '10');
  const res = await fetch(u.toString(), {
    headers: {
      Accept: 'application/json',
      'Authorization': 'Bearer ' + env.NZ_POST_API_KEY,
      'client_id': env.NZ_POST_CLIENT_ID || '',
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || ('HTTP ' + res.status));
  return normalizeNzPostResponse(data);
}

function normalizeNzPostResponse(data) {
  const raw =
    data.addresses ||
    data.success?.addresses ||
    data.results ||
    data.suggestedAddresses ||
    data.addresses_found ||
    (Array.isArray(data) ? data : []);

  return (Array.isArray(raw) ? raw : []).map((a) => {
    const full =
      a.full_address ||
      a.FullAddress ||
      a.formatted_address ||
      a.address ||
      [a.address_line_1, a.address_line_2, a.suburb, a.city, a.postcode]
        .filter(Boolean)
        .join(', ');

    const type = String(
      a.address_type || a.AddressType || a.type || a.delivery_type || ''
    ).toLowerCase();
    const isRural =
      type.includes('rural') ||
      a.is_rural_delivery === true ||
      a.is_rural === true ||
      a.rural === true ||
      !!(a.rd_number || a.RDNumber || a.rd_no) ||
      /\brd\s*\d+/i.test(full);

    const short = [
      a.address_line_1 || a.AddressLine1 || a.street || '',
      a.suburb || a.Suburb || '',
      a.city || a.City || a.mailtown || a.Mailtown || '',
      a.postcode || a.PostCode || '',
    ]
      .filter(Boolean)
      .join(', ');

    return {
      source: 'nzpost',
      short: short || full,
      display: full,
      rural: isRural,
      reason: isRural
        ? a.rd_number || a.RDNumber
          ? 'NZ Post Rural Delivery RD ' + (a.rd_number || a.RDNumber)
          : 'NZ Post rural address'
        : '',
      postcode: a.postcode || a.PostCode || '',
      dpid: a.dpid || a.DPID || a.unique_id || null,
      raw: a,
      importance: isRural ? 0.9 : 1,
    };
  });
}

/* ─── LINZ free NZ Addresses ─── */

async function searchLinz(env, q) {
  // Layer 123113 = NZ Addresses (authoritative physical addresses from TAs)
  // Docs: https://data.linz.govt.nz/layer/123113-nz-addresses/
  const layer = env.LINZ_ADDRESS_LAYER || 'layer-123113';
  const key = env.LINZ_API_KEY;
  const rawQ = String(q || '').trim();
  if (!rawQ) return [];

  // LINZ address text is often Title Case / mixed — try several filters
  const safe = rawQ.replace(/'/g, "''");
  const upper = safe.toUpperCase();
  const tokens = upper.split(/[\s,]+/).filter((t) => t.length >= 2).slice(0, 6);

  // Prefer road+number style when possible
  const numMatch = rawQ.match(/^(\d+[A-Za-z]?)\s+(.+)$/);
  const filters = [];

  // full_address contains whole query (case-insensitive if supported)
  filters.push(`full_address ILIKE '%${safe}%'`);
  filters.push(`full_address LIKE '%${upper}%'`);
  // ASCII variant used on some exports
  filters.push(`full_address_ascii ILIKE '%${safe}%'`);
  filters.push(`full_address_ascii LIKE '%${upper}%'`);

  if (numMatch) {
    const num = numMatch[1].replace(/'/g, "''");
    const road = numMatch[2].replace(/'/g, "''").toUpperCase().replace(/\s+/g, ' ').trim();
    // full_road_name is usually UPPERCASE in LDS
    filters.push(
      `(address_number='${num}' OR full_address_number LIKE '${num}%') AND full_road_name LIKE '%${road.split(/\s+/).slice(0, 3).join('%')}%'`
    );
    filters.push(`full_road_name LIKE '%${road.split(/\s+/)[0]}%' AND full_address LIKE '%${num}%'`);
  }

  // Token AND match on full_address (e.g. PEEL AND GISBORNE)
  if (tokens.length >= 2) {
    const ands = tokens.map((t) => `full_address LIKE '%${t}%'`).join(' AND ');
    filters.push(ands);
  }

  let features = [];
  let lastErr = null;

  for (const filter of filters) {
    try {
      const u =
        `https://data.linz.govt.nz/services;key=${encodeURIComponent(key)}/wfs` +
        `?service=WFS&version=2.0.0&request=GetFeature` +
        `&typeNames=${encodeURIComponent(layer)}` +
        `&outputFormat=application/json` +
        `&count=12` +
        `&srsName=EPSG:4326` +
        `&cql_filter=${encodeURIComponent(filter)}`;

      const res = await fetch(u, {
        headers: { Accept: 'application/json' },
      });
      const text = await res.text();
      let data = {};
      try {
        data = JSON.parse(text);
      } catch {
        // XML exception often returned
        if (/Exception|exception/i.test(text)) {
          lastErr = new Error(text.replace(/<[^>]+>/g, ' ').slice(0, 180));
          continue;
        }
      }
      if (!res.ok) {
        lastErr = new Error(
          data.message || data.exceptions || text.slice(0, 120) || ('LINZ HTTP ' + res.status)
        );
        continue;
      }
      const feats = data.features || [];
      if (feats.length) {
        features = feats;
        break;
      }
    } catch (e) {
      lastErr = e;
    }
  }

  if (!features.length && lastErr) {
    // Don't fail whole address search — just report
    throw lastErr;
  }

  return features.map((f) => {
    const p = f.properties || {};
    const full =
      p.full_address ||
      p.full_address_ascii ||
      [p.full_address_number || p.address_number, p.full_road_name, p.suburb_locality, p.town_city]
        .filter(Boolean)
        .join(' ');
    const text = String(full);
    const isRural =
      /\bRD\s*\d+/i.test(text) ||
      /\brural\b/i.test(text) ||
      /\bprivate\s+bag\b/i.test(text);
    // Rank exact-ish matches higher
    const qU = upper.replace(/\s+/g, ' ');
    const fU = text.toUpperCase();
    let importance = 5; // base: linz beats osm in merge
    if (p.address_number || p.full_address_number) importance += 1;
    if (fU.includes(qU)) importance += 2;
    return {
      source: 'linz',
      short: full,
      display: full + (p.territorial_authority ? ` (${p.territorial_authority})` : ''),
      rural: isRural,
      reason: isRural ? 'Rural markers in LINZ address' : '',
      postcode: p.postcode || '',
      importance,
      raw: p,
    };
  });
}

/* ─── OSM fallback (server-side) ─── */

async function searchOsm(q) {
  const photonUrl = new URL('https://photon.komoot.io/api/');
  photonUrl.searchParams.set('q', q);
  photonUrl.searchParams.set('limit', '8');
  photonUrl.searchParams.set('lang', 'en');
  photonUrl.searchParams.set('lat', '-38.6623');
  photonUrl.searchParams.set('lon', '178.0176');
  photonUrl.searchParams.set('bbox', '166,-47.5,179,-34');

  const nomiUrl = new URL('https://nominatim.openstreetmap.org/search');
  const query = /new zealand|\bnz\b/i.test(q) ? q : q + ', New Zealand';
  nomiUrl.searchParams.set('q', query);
  nomiUrl.searchParams.set('format', 'json');
  nomiUrl.searchParams.set('addressdetails', '1');
  nomiUrl.searchParams.set('countrycodes', 'nz');
  nomiUrl.searchParams.set('limit', '6');

  const [pr, nr] = await Promise.all([
    fetch(photonUrl.toString(), { headers: { Accept: 'application/json' } }),
    fetch(nomiUrl.toString(), {
      headers: { Accept: 'application/json', 'Accept-Language': 'en-NZ,en' },
    }),
  ]);

  const out = [];
  if (pr.ok) {
    const pdata = await pr.json();
    (pdata.features || []).forEach((f) => {
      const p = f.properties || {};
      if ((p.countrycode || '').toLowerCase() && (p.countrycode || '').toLowerCase() !== 'nz') return;
      const short = [[p.housenumber, p.street || p.name].filter(Boolean).join(' '), p.city, p.postcode]
        .filter(Boolean)
        .join(', ');
      const display = [short, p.state, p.country].filter(Boolean).join(', ');
      const text = display + ' ' + short;
      const rural =
        /\bRD\s*\d+/i.test(text) ||
        /\brural\b/i.test(text) ||
        ['hamlet', 'farm', 'locality', 'isolated_dwelling'].includes(String(p.osm_value || ''));
      out.push({
        source: 'photon',
        short: short || display,
        display,
        rural,
        reason: rural ? 'Rural pattern / locality' : '',
        importance: p.housenumber ? 0.8 : 0.4,
      });
    });
  }
  if (nr.ok) {
    const ndata = await nr.json();
    (Array.isArray(ndata) ? ndata : []).forEach((n) => {
      const a = n.address || {};
      const short = [
        [a.house_number, a.road].filter(Boolean).join(' '),
        a.suburb || a.village || a.hamlet,
        a.city || a.town,
        a.postcode,
      ]
        .filter(Boolean)
        .join(', ');
      const display = n.display_name || short;
      const text = display + ' ' + short;
      const rural =
        /\bRD\s*\d+/i.test(text) ||
        /\brural\b/i.test(text) ||
        !!(a.hamlet || a.locality) ||
        ['hamlet', 'farm', 'locality'].includes(String(n.type || ''));
      out.push({
        source: 'nominatim',
        short: short || display,
        display,
        rural,
        reason: rural ? 'Rural pattern / locality' : '',
        importance: a.house_number ? 0.85 : 0.45,
      });
    });
  }
  return out;
}

function dedupeAndRank(list) {
  const map = new Map();
  for (const item of list) {
    const key = String(item.short || item.display || '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
    if (!key) continue;
    // Prefer nzpost over others
    const score =
      (item.source === 'nzpost' || item.source === 'nzpost-legacy' ? 10 : 0) +
      (item.source === 'linz' ? 5 : 0) +
      (item.importance || 0);
    const prev = map.get(key);
    const prevScore =
      prev
        ? (prev.source === 'nzpost' || prev.source === 'nzpost-legacy' ? 10 : 0) +
          (prev.source === 'linz' ? 5 : 0) +
          (prev.importance || 0)
        : -1;
    if (!prev || score > prevScore) map.set(key, item);
  }
  return [...map.values()].sort((a, b) => {
    const as = (a.source === 'nzpost' ? 10 : a.source === 'linz' ? 5 : 0) + (a.importance || 0);
    const bs = (b.source === 'nzpost' ? 10 : b.source === 'linz' ? 5 : 0) + (b.importance || 0);
    return bs - as;
  });
}
