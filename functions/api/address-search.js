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

  // Single-address details (rural flag) when cart picks a NZ Post DPID
  const dpid = String(url.searchParams.get('dpid') || '').trim();
  if (dpid) {
    if (!(env.NZ_POST_CLIENT_ID && env.NZ_POST_CLIENT_SECRET) && !env.NZ_POST_API_KEY) {
      return json({ error: 'NZ Post not configured', details: null }, 200);
    }
    try {
      const token =
        env.NZ_POST_CLIENT_ID && env.NZ_POST_CLIENT_SECRET
          ? await getNzPostToken(env)
          : env.NZ_POST_API_KEY;
      const d = await fetchNzPostDetails(env, token, dpid);
      if (!d) return json({ details: null, error: 'No details for DPID' }, 200);
      const lines = [d.AddressLine1, d.AddressLine2, d.AddressLine3, d.AddressLine4, d.AddressLine5]
        .filter(Boolean)
        .join(', ');
      const info = ruralFromNzFields(d, lines);
      return json({
        details: {
          dpid: d.DPID || dpid,
          display: lines,
          short: lines,
          fullAddress: lines,
          rural: info.rural,
          reason: info.reason,
          ruralDelivery: d.RuralDelivery ?? d.rural_delivery ?? null,
          postcode: d.Postcode || d.postcode || '',
          source: 'nzpost',
          raw: d,
        },
      });
    } catch (e) {
      return json({ details: null, error: String(e.message || e) }, 200);
    }
  }

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

function nzPostHeaders(env, token) {
  return {
    Authorization: 'Bearer ' + token,
    Accept: 'application/json',
    client_id: env.NZ_POST_CLIENT_ID,
  };
}

/** AddressChecker suggest has no rural flag — RuralDelivery is on /details */
function ruralFromNzFields(a, fullText) {
  const full = String(fullText || '');
  const rd =
    a.RuralDelivery ??
    a.rural_delivery ??
    a.rd_number ??
    a.RDNumber ??
    a.rd_no ??
    a.RdNumber ??
    null;
  if (rd != null && String(rd).trim() !== '' && String(rd).toLowerCase() !== 'null') {
    const rdStr = String(rd).trim();
    const label = /^rd\b/i.test(rdStr) ? rdStr : 'RD ' + rdStr;
    return { rural: true, reason: 'NZ Post Rural Delivery ' + label };
  }

  const bag = String(a.BoxBagType || a.box_bag_type || a.DeliveryServiceType || '');
  if (/rural|private\s*bag|cmb\s*rural|community\s*mail/i.test(bag)) {
    return { rural: true, reason: 'NZ Post ' + bag };
  }

  const type = String(
    a.address_type || a.AddressType || a.type || a.delivery_type || a.SourceDesc || a.source_desc || ''
  ).toLowerCase();
  // AddressChecker: rural postal often SourceDesc "Postal" only; urban is "Postal\Physical"
  if (type === 'postal' || type.includes('rural')) {
    // "Postal" alone is a strong rural-mail hint when FullAddress also has RD/bag markers
    if (type.includes('rural') || /\br\.?\s*d\.?\s*\d+/i.test(full) || /\brd\s*\d+/i.test(full)) {
      return { rural: true, reason: type.includes('rural') ? 'NZ Post rural type' : 'NZ Post RD in address' };
    }
  }
  if (a.is_rural_delivery === true || a.is_rural === true || a.rural === true) {
    return { rural: true, reason: 'NZ Post rural address' };
  }
  // MailTown set with no urban suburb is often rural distribution
  if ((a.MailTown || a.mailtown) && !(a.Suburb || a.suburb) && /\brd\b/i.test(full)) {
    return { rural: true, reason: 'NZ Post rural mailtown' };
  }

  if (/\bR\.?\s*D\.?\s*\d+\b/i.test(full) || /\bRD\s*\d+\b/i.test(full) || /,\s*RD\b/i.test(full)) {
    return { rural: true, reason: 'RD number in address' };
  }
  if (/\bprivate\s+bag\b/i.test(full) || /\brural\s+delivery\b/i.test(full)) {
    return { rural: true, reason: 'Rural postal wording in address' };
  }
  return { rural: false, reason: '' };
}

async function fetchNzPostDetails(env, token, dpid) {
  if (!dpid) return null;
  const u = new URL(env.NZ_POST_DETAILS_URL || 'https://api.nzpost.co.nz/addresschecker/1.0/details');
  u.searchParams.set('dpid', String(dpid));
  const res = await fetch(u.toString(), { headers: nzPostHeaders(env, token) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return null;
  const details = data.details;
  if (Array.isArray(details) && details.length) return details[0];
  if (details && typeof details === 'object') return details;
  return null;
}

/** Enrich top suggestions with Address Details (authoritative RuralDelivery) */
async function enrichNzPostRural(env, token, list) {
  const targets = (list || []).filter((x) => x.dpid).slice(0, 8);
  await Promise.all(
    targets.map(async (item) => {
      try {
        const d = await fetchNzPostDetails(env, token, item.dpid);
        if (!d) return;
        const lines = [d.AddressLine1, d.AddressLine2, d.AddressLine3, d.AddressLine4, d.AddressLine5]
          .filter(Boolean)
          .join(', ');
        const full = lines || item.display || item.short;
        const info = ruralFromNzFields(d, full);
        item.raw = { ...(item.raw || {}), details: d };
        if (info.rural) {
          item.rural = true;
          item.reason = info.reason;
          item.importance = 0.9;
        }
        if (d.Postcode || d.postcode) item.postcode = d.Postcode || d.postcode;
        if (lines) {
          item.display = full;
          if (!item.short || item.short === item.display) item.short = full;
        }
      } catch (_) {
        /* keep suggest-level rural guess */
      }
    })
  );
  return list;
}

async function searchNzPost(env, q) {
  const token = await getNzPostToken(env);
  // Prefer AddressChecker (what most accounts have), then ParcelAddress
  const endpoints = [
    env.NZ_POST_ADDRESS_URL || 'https://api.nzpost.co.nz/addresschecker/1.0/suggest',
    'https://api.nzpost.co.nz/parceladdress/2.0/domestic/addresses',
  ];

  let lastErr = null;
  for (const base of endpoints) {
    try {
      const u = new URL(base);
      u.searchParams.set('q', q);
      // AddressChecker uses max; ParcelAddress uses count
      if (/addresschecker/i.test(base)) {
        u.searchParams.set('max', '10');
      } else {
        u.searchParams.set('count', '10');
      }
      const res = await fetch(u.toString(), { headers: nzPostHeaders(env, token) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        lastErr = new Error(data.message || data.error || data.status || ('HTTP ' + res.status));
        continue;
      }
      let list = normalizeNzPostResponse(data);
      if (list.length) {
        // Details API has RuralDelivery — required for reliable rural detection
        list = await enrichNzPostRural(env, token, list);
        return list;
      }
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
    env.NZ_POST_ADDRESS_URL || 'https://api.nzpost.co.nz/addresschecker/1.0/suggest'
  );
  u.searchParams.set('q', q);
  if (/addresschecker/i.test(u.pathname)) u.searchParams.set('max', '10');
  else u.searchParams.set('count', '10');
  const res = await fetch(u.toString(), {
    headers: {
      Accept: 'application/json',
      Authorization: 'Bearer ' + env.NZ_POST_API_KEY,
      client_id: env.NZ_POST_CLIENT_ID || '',
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
      [a.AddressLine1 || a.address_line_1, a.AddressLine2 || a.address_line_2, a.Suburb || a.suburb, a.City || a.city, a.Postcode || a.postcode]
        .filter(Boolean)
        .join(', ');

    const info = ruralFromNzFields(a, full);

    const short = [
      a.address_line_1 || a.AddressLine1 || a.street || '',
      a.suburb || a.Suburb || '',
      a.city || a.City || a.mailtown || a.MailTown || a.Mailtown || '',
      a.postcode || a.PostCode || a.Postcode || '',
    ]
      .filter(Boolean)
      .join(', ');

    return {
      source: 'nzpost',
      short: short || full,
      display: full,
      rural: info.rural,
      reason: info.reason,
      postcode: a.postcode || a.PostCode || a.Postcode || '',
      dpid: a.dpid || a.DPID || a.unique_id || null,
      raw: a,
      importance: info.rural ? 0.9 : 1,
    };
  });
}

/* ─── LINZ free NZ Addresses ─── */

async function searchLinz(env, q) {
  // Layer 123113 = NZ Addresses (authoritative physical addresses from TAs)
  // https://data.linz.govt.nz/layer/123113-nz-addresses/
  // Notes: full_address is Title Case ("12 Peel Street, Gisborne") — use ILIKE token AND
  // (whole-query LIKE fails when user omits commas).
  const layer = env.LINZ_ADDRESS_LAYER || 'layer-123113';
  const key = env.LINZ_API_KEY;
  const rawQ = String(q || '').trim();
  if (!rawQ) return [];

  const esc = (s) => String(s).replace(/'/g, "''");
  // Drop short noise words; keep numbers and meaningful tokens
  const tokens = rawQ
    .split(/[\s,./]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !/^(st|rd|ave|nz|new|zealand)$/i.test(t))
    .slice(0, 6)
    .map(esc);

  const filters = [];

  // Best: each significant token must appear (case-insensitive)
  if (tokens.length >= 2) {
    filters.push(tokens.map((t) => `full_address ILIKE '%${t}%'`).join(' AND '));
    filters.push(tokens.map((t) => `full_address_ascii ILIKE '%${t}%'`).join(' AND '));
  }

  // Number + road name
  const numMatch = rawQ.match(/^(\d+[A-Za-z]?)\s+(.+)$/);
  if (numMatch) {
    const num = esc(numMatch[1]);
    const roadBits = numMatch[2]
      .split(/[\s,]+/)
      .filter((t) => t.length >= 2 && !/^(st|street|rd|road|ave|avenue)$/i.test(t))
      .slice(0, 3)
      .map(esc);
    if (roadBits.length) {
      filters.push(
        `(full_address_number ILIKE '${num}%' OR address_number=${parseInt(num, 10) || 0}) AND ` +
          roadBits.map((t) => `full_road_name ILIKE '%${t}%'`).join(' AND ')
      );
    }
  }

  // Single-token / short query
  if (tokens.length === 1) {
    filters.push(`full_address ILIKE '%${tokens[0]}%'`);
    filters.push(`full_road_name ILIKE '%${tokens[0]}%'`);
  }

  // Whole string as last resort (works if user types exact LINZ formatting)
  filters.push(`full_address ILIKE '%${esc(rawQ)}%'`);

  let features = [];
  let lastErr = null;

  for (const filter of filters) {
    try {
      const u =
        `https://data.linz.govt.nz/services;key=${encodeURIComponent(key)}/wfs` +
        `?service=WFS&version=2.0.0&request=GetFeature` +
        `&typeNames=${encodeURIComponent(layer)}` +
        `&outputFormat=json` +
        `&count=12` +
        `&cql_filter=${encodeURIComponent(filter)}`;

      const res = await fetch(u, { headers: { Accept: 'application/json' } });
      const text = await res.text();
      let data = {};
      try {
        data = JSON.parse(text);
      } catch {
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

  if (!features.length && lastErr) throw lastErr;

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
    const qU = rawQ.toUpperCase().replace(/[\s,]+/g, ' ');
    const fU = text.toUpperCase();
    let importance = 8; // prefer LINZ over OSM
    if (p.address_number || p.full_address_number) importance += 1;
    if (tokens.every((t) => fU.includes(String(t).toUpperCase()))) importance += 2;
    if (fU.includes(qU)) importance += 1;
    return {
      source: 'linz',
      short: full,
      display: full + (p.territorial_authority ? ` · ${p.territorial_authority}` : ''),
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

function scoreItem(item) {
  let s = 0;
  if (item.source === 'nzpost' || item.source === 'nzpost-legacy') s += 20;
  else if (item.source === 'linz') s += 8;
  else s += 2;
  if (item.rural) s += 12; // surface rural NZ Post above bare physical LINZ
  if (item.dpid) s += 3;
  s += Number(item.importance) || 0;
  // Prefer lines that include RD wording (postal mail format)
  const t = String(item.display || item.short || '');
  if (/\bRD\s*\d+/i.test(t) || /,\s*RD\b/i.test(t)) s += 5;
  return s;
}

/** Normalize key so "10 Foo Rd, RD 1, Town" and "10 Foo Rd, Town" can compete */
function addressKey(item) {
  return String(item.short || item.display || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/,?\s*rd\s*\d+/gi, '')
    .replace(/\s+\d{4}\s*$/, '')
    .trim();
}

function dedupeAndRank(list) {
  const map = new Map();
  for (const item of list) {
    const key = addressKey(item);
    if (!key) continue;
    const score = scoreItem(item);
    const prev = map.get(key);
    if (!prev || score > scoreItem(prev)) map.set(key, item);
  }
  return [...map.values()].sort((a, b) => scoreItem(b) - scoreItem(a));
}
