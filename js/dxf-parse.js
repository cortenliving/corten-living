/**
 * Lightweight DXF parser for quote tooling.
 * Bounding box, cut length, SVG preview (full geometry, Y-flipped correctly).
 * LINE, LWPOLYLINE, POLYLINE+VERTEX, CIRCLE, ARC, ELLIPSE (approx), SPLINE (fit/control pts).
 */
(function (global) {
  function parsePairs(text) {
    const lines = String(text || '')
      .replace(/^\uFEFF/, '')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .split('\n');
    const pairs = [];
    for (let i = 0; i + 1 < lines.length; i += 2) {
      const code = parseInt(String(lines[i]).trim(), 10);
      if (!Number.isFinite(code)) {
        i -= 1; // resync if odd blank line
        continue;
      }
      const value = String(lines[i + 1] != null ? lines[i + 1] : '').replace(/\s+$/, '');
      pairs.push({ code, value: value.trim() });
    }
    return pairs;
  }

  function dist(a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function round2(n) {
    return Math.round(n * 100) / 100;
  }

  function parseDxf(text) {
    const pairs = parsePairs(text);
    let entities = parseEntitiesInSection(pairs, true);
    // Some exporters omit SECTION markers or use weird structure — fall back to full scan
    if (!entities.length) {
      entities = parseEntitiesInSection(pairs, false);
    }
    return summarize(entities);
  }

  function parseEntitiesInSection(pairs, requireSection) {
    const entities = [];
    let i = 0;
    let inEntities = !requireSection;
    let currentPoly = null;

    while (i < pairs.length) {
      const p = pairs[i];

      if (p.code === 0 && p.value === 'SECTION') {
        const name = pairs[i + 1] && pairs[i + 1].code === 2 ? pairs[i + 1].value : '';
        inEntities = name === 'ENTITIES';
        i += 1;
        continue;
      }
      if (p.code === 0 && p.value === 'ENDSEC') {
        if (requireSection) inEntities = false;
        currentPoly = null;
        i += 1;
        continue;
      }
      if (!inEntities || p.code !== 0) {
        i += 1;
        continue;
      }

      const type = String(p.value || '').toUpperCase();
      i += 1;

      const f = {};
      const verts = [];
      let vx = null;

      while (i < pairs.length && pairs[i].code !== 0) {
        const code = pairs[i].code;
        const value = pairs[i].value;
        const num = parseFloat(value);

        if (type === 'LWPOLYLINE') {
          if (code === 10) {
            vx = { x: num, y: 0 };
            verts.push(vx);
          } else if (code === 20 && vx) {
            vx.y = num;
          } else if (code === 70) f.flags = parseInt(value, 10) || 0;
        } else if (type === 'VERTEX') {
          if (code === 10) vx = { x: num, y: 0 };
          else if (code === 20 && vx) {
            vx.y = num;
            verts.push({ x: vx.x, y: vx.y });
            vx = null;
          } else if (code === 70) f.vflags = parseInt(value, 10) || 0;
        } else if (type === 'SPLINE') {
          if (code === 11) {
            vx = { x: num, y: 0 };
          } else if (code === 21 && vx) {
            vx.y = num;
            verts.push({ x: vx.x, y: vx.y });
            vx = null;
          } else if (code === 10) {
            // control points also useful as fallback
            vx = { x: num, y: 0, ctrl: true };
          } else if (code === 20 && vx && vx.ctrl) {
            vx.y = num;
            verts.push({ x: vx.x, y: vx.y });
            vx = null;
          }
        } else {
          if (code === 10) f.x = num;
          else if (code === 20) f.y = num;
          else if (code === 11) f.x2 = num;
          else if (code === 21) f.y2 = num;
          else if (code === 40) f.r = num;
          else if (code === 41) f.r2 = num;
          else if (code === 42) f.ratio = num;
          else if (code === 50) f.a0 = num;
          else if (code === 51) f.a1 = num;
          else if (code === 70) f.flags = parseInt(value, 10) || 0;
        }
        i += 1;
      }

      if (type === 'LINE' && finite(f.x, f.y, f.x2, f.y2)) {
        entities.push({
          type: 'LINE',
          points: [
            { x: f.x, y: f.y },
            { x: f.x2, y: f.y2 },
          ],
        });
        currentPoly = null;
      } else if (type === 'LWPOLYLINE' && verts.length) {
        entities.push({
          type: 'LWPOLYLINE',
          closed: !!(f.flags & 1),
          points: verts.map((v) => ({ x: v.x, y: v.y })),
        });
        currentPoly = null;
      } else if (type === 'POLYLINE') {
        currentPoly = {
          type: 'POLYLINE',
          closed: !!(f.flags & 1),
          points: [],
        };
        entities.push(currentPoly);
      } else if (type === 'VERTEX') {
        if (currentPoly && verts.length) {
          // skip mesh/face vertices when possible
          if (!(f.vflags & 128)) {
            currentPoly.points.push(...verts.map((v) => ({ x: v.x, y: v.y })));
          }
        }
      } else if (type === 'SEQEND') {
        currentPoly = null;
      } else if (type === 'CIRCLE' && finite(f.x, f.y, f.r) && f.r > 0) {
        entities.push({ type: 'CIRCLE', cx: f.x, cy: f.y, r: f.r });
        currentPoly = null;
      } else if (type === 'ARC' && finite(f.x, f.y, f.r, f.a0, f.a1) && f.r > 0) {
        entities.push({
          type: 'ARC',
          cx: f.x,
          cy: f.y,
          r: f.r,
          startAngle: f.a0,
          endAngle: f.a1,
        });
        currentPoly = null;
      } else if (type === 'ELLIPSE' && finite(f.x, f.y, f.x2, f.y2)) {
        // centre + major axis end point, ratio = minor/major
        const ratio = f.ratio > 0 ? f.ratio : 1;
        const mj = Math.sqrt(f.x2 * f.x2 + f.y2 * f.y2) || 1;
        entities.push({
          type: 'ELLIPSE',
          cx: f.x,
          cy: f.y,
          mx: f.x2,
          my: f.y2,
          ratio,
          a0: f.a0 != null ? f.a0 : 0,
          a1: f.a1 != null ? f.a1 : Math.PI * 2,
          mj,
        });
        currentPoly = null;
      } else if (type === 'SPLINE' && verts.length >= 2) {
        entities.push({
          type: 'SPLINE',
          points: verts.map((v) => ({ x: v.x, y: v.y })),
        });
        currentPoly = null;
      }
    }

    return entities.filter((e) => {
      if (e.type === 'POLYLINE') return e.points && e.points.length >= 2;
      return true;
    });
  }

  function finite() {
    for (let i = 0; i < arguments.length; i++) {
      if (!Number.isFinite(arguments[i])) return false;
    }
    return true;
  }

  function circlePoints(cx, cy, r, steps) {
    const n = steps || Math.max(24, Math.ceil((2 * Math.PI * r) / 1.5));
    const pts = [];
    for (let s = 0; s < n; s++) {
      const a = (2 * Math.PI * s) / n;
      pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
    }
    return pts;
  }

  function arcPoints(cx, cy, r, startDeg, endDeg) {
    let a0 = (startDeg * Math.PI) / 180;
    let a1 = (endDeg * Math.PI) / 180;
    let sweep = a1 - a0;
    if (sweep <= 0) sweep += 2 * Math.PI;
    const steps = Math.max(12, Math.ceil((sweep * r) / 1.5));
    const pts = [];
    for (let s = 0; s <= steps; s++) {
      const a = a0 + (sweep * s) / steps;
      pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
    }
    return pts;
  }

  function ellipsePoints(e) {
    const maj = Math.sqrt(e.mx * e.mx + e.my * e.my) || 1;
    const min = maj * (e.ratio || 1);
    const rot = Math.atan2(e.my, e.mx);
    let a0 = e.a0 != null ? e.a0 : 0;
    let a1 = e.a1 != null ? e.a1 : Math.PI * 2;
    // DXF ellipse params often in radians already
    if (Math.abs(a1) > 2 * Math.PI + 0.1 || Math.abs(a0) > 2 * Math.PI + 0.1) {
      a0 = (a0 * Math.PI) / 180;
      a1 = (a1 * Math.PI) / 180;
    }
    let sweep = a1 - a0;
    if (Math.abs(sweep) < 1e-9) sweep = 2 * Math.PI;
    if (sweep < 0) sweep += 2 * Math.PI;
    const steps = Math.max(32, Math.ceil((sweep * maj) / 1.5));
    const pts = [];
    for (let s = 0; s <= steps; s++) {
      const t = a0 + (sweep * s) / steps;
      const lx = maj * Math.cos(t);
      const ly = min * Math.sin(t);
      pts.push({
        x: e.cx + lx * Math.cos(rot) - ly * Math.sin(rot),
        y: e.cy + lx * Math.sin(rot) + ly * Math.cos(rot),
      });
    }
    return pts;
  }

  function summarize(entities) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let cutLength = 0;
    /** @type {{points: {x,y}[], closed: boolean}[]} */
    const polylines = [];

    function expand(x, y) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }

    function addPoly(pts, closed) {
      if (!pts || pts.length < 2) return;
      const clean = pts.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
      if (clean.length < 2) return;
      clean.forEach((p) => expand(p.x, p.y));
      for (let i = 1; i < clean.length; i++) cutLength += dist(clean[i - 1], clean[i]);
      if (closed) cutLength += dist(clean[clean.length - 1], clean[0]);
      polylines.push({ points: clean, closed: !!closed });
    }

    entities.forEach((e) => {
      if (e.type === 'LINE') addPoly(e.points, false);
      else if (e.type === 'LWPOLYLINE' || e.type === 'POLYLINE' || e.type === 'SPLINE') {
        addPoly(e.points, !!e.closed);
      } else if (e.type === 'CIRCLE') {
        addPoly(circlePoints(e.cx, e.cy, e.r), true);
      } else if (e.type === 'ARC') {
        addPoly(arcPoints(e.cx, e.cy, e.r, e.startAngle, e.endAngle), false);
      } else if (e.type === 'ELLIPSE') {
        addPoly(ellipsePoints(e), Math.abs((e.a1 || 0) - (e.a0 || 0)) > 6);
      }
    });

    if (!Number.isFinite(minX)) {
      minX = minY = 0;
      maxX = maxY = 1;
    }

    const width = Math.max(0, maxX - minX);
    const height = Math.max(0, maxY - minY);

    // SVG-ready path strings in raw DXF coords (toSvg normalises)
    const paths = polylines.map((pl) => {
      const d = pl.points
        .map((p, idx) => (idx === 0 ? 'M' : 'L') + round2(p.x) + ' ' + round2(p.y))
        .join(' ');
      return pl.closed ? d + ' Z' : d;
    });

    return {
      entityCount: entities.length,
      widthMm: round2(width),
      heightMm: round2(height),
      areaMm2: round2(width * height),
      cutLengthMm: round2(cutLength),
      bounds: { minX, minY, maxX, maxY },
      polylines,
      paths,
      entities,
    };
  }

  /**
   * Build SVG with all geometry visible (normalise to 0..w, 0..h, flip Y).
   */
  function toSvg(summary, opts) {
    const o = opts || {};
    const pad = o.pad != null ? o.pad : 6;
    const minX = summary.bounds?.minX ?? 0;
    const minY = summary.bounds?.minY ?? 0;
    const maxX = summary.bounds?.maxX ?? minX + 1;
    const maxY = summary.bounds?.maxY ?? minY + 1;
    const w = Math.max(0.1, maxX - minX);
    const h = Math.max(0.1, maxY - minY);
    const stroke = o.stroke || '#b7410e';
    const sw = o.strokeWidth != null ? o.strokeWidth : Math.max(0.4, Math.min(w, h) * 0.008);

    // Prefer polylines (accurate); fall back to path strings
    let pathEls = '';
    if (summary.polylines && summary.polylines.length) {
      pathEls = summary.polylines
        .map((pl) => {
          const d = pl.points
            .map((p, idx) => {
              const x = p.x - minX;
              const y = maxY - p.y; // flip Y for SVG
              return (idx === 0 ? 'M' : 'L') + round2(x) + ' ' + round2(y);
            })
            .join(' ');
          return `<path d="${d}${pl.closed ? ' Z' : ''}" fill="none" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round" stroke-linecap="round"/>`;
        })
        .join('\n');
    } else {
      pathEls = (summary.paths || [])
        .map((raw) => {
          const d = String(raw).replace(/([ML])\s*([-\d.eE+]+)\s+([-\d.eE+]+)/g, (_, cmd, xs, ys) => {
            const x = parseFloat(xs) - minX;
            const y = maxY - parseFloat(ys);
            return cmd + round2(x) + ' ' + round2(y);
          });
          return `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round" stroke-linecap="round"/>`;
        })
        .join('\n');
    }

    const vbW = w + pad * 2;
    const vbH = h + pad * 2;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-pad} ${-pad} ${vbW} ${vbH}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet">
  ${pathEls}
</svg>`;

    return { svg, viewBox: `${-pad} ${-pad} ${vbW} ${vbH}`, width: w, height: h };
  }

  function scaleToSize(summary, targetW, targetH, linked) {
    const sw = summary.widthMm || 1;
    const sh = summary.heightMm || 1;
    let sx = 1;
    let sy = 1;
    if (linked) {
      if (targetW && targetH) sx = sy = Math.min(targetW / sw, targetH / sh);
      else if (targetW) sx = sy = targetW / sw;
      else if (targetH) sx = sy = targetH / sh;
    } else {
      if (targetW) sx = targetW / sw;
      if (targetH) sy = targetH / sh;
    }
    const widthMm = round2(sw * sx);
    const heightMm = round2(sh * sy);
    return {
      ...summary,
      widthMm,
      heightMm,
      areaMm2: round2(widthMm * heightMm),
      cutLengthMm: round2((summary.cutLengthMm || 0) * ((sx + sy) / 2)),
      scaleX: sx,
      scaleY: sy,
    };
  }

  /**
   * 3 mm Corten part weight (kg).
   * solidAreaM2 ≈ bounding box × silhouette fill.
   * kgPerM2 default 23.55 (3 mm plate).
   */
  function partWeightKg(widthMm, heightMm, qty, opts) {
    const o = opts || {};
    const fill = Number(o.silhouetteFill) > 0 ? Number(o.silhouetteFill) : 0.32;
    const kgPerM2 = Number(o.cortenKgPerM2) > 0 ? Number(o.cortenKgPerM2) : 23.55;
    const q = Math.max(1, parseInt(qty, 10) || 1);
    const areaM2 = (Math.max(0, widthMm) * Math.max(0, heightMm)) / 1e6;
    const solidM2 = areaM2 * fill;
    return {
      weightKg: round2(solidM2 * kgPerM2 * q),
      solidAreaM2: solidM2 * q,
      plateAreaM2: areaM2 * q,
      fill,
      kgPerM2,
      thicknessMm: 3,
    };
  }

  global.DxfParse = {
    parseDxf,
    toSvg,
    scaleToSize,
    partWeightKg,
  };
})(typeof window !== 'undefined' ? window : globalThis);
