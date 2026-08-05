/**
 * DXF parser for quote tooling — bbox, cut length, full SVG preview.
 * Expands BLOCKS + INSERT (most CNC/house-number DXFs store shapes this way).
 */
(function (global) {
  function parsePairs(text) {
    const raw = String(text || '')
      .replace(/^\uFEFF/, '')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .split('\n');
    const pairs = [];
    let i = 0;
    while (i < raw.length) {
      const code = parseInt(String(raw[i]).trim(), 10);
      if (!Number.isFinite(code)) {
        i += 1;
        continue;
      }
      const value = i + 1 < raw.length ? String(raw[i + 1]).replace(/\s+$/, '').trim() : '';
      pairs.push({ code, value });
      i += 2;
    }
    return pairs;
  }

  function dist(a, b) {
    return Math.hypot(b.x - a.x, b.y - a.y);
  }

  function round2(n) {
    return Math.round(n * 100) / 100;
  }

  function round4(n) {
    return Math.round(n * 10000) / 10000;
  }

  function finite() {
    for (let i = 0; i < arguments.length; i++) {
      if (!Number.isFinite(arguments[i])) return false;
    }
    return true;
  }

  function parseDxf(text) {
    const pairs = parsePairs(text);
    const blocks = parseBlocks(pairs);
    let entities = parseEntityList(pairs, true);
    if (!entities.length) entities = parseEntityList(pairs, false);

    // Expand INSERT → block entities (with transform)
    const expanded = [];
    entities.forEach((e) => {
      if (e.type === 'INSERT') {
        const blockEnts = blocks[e.name] || blocks[e.name.toUpperCase()] || [];
        if (!blockEnts.length) return;
        blockEnts.forEach((be) => {
          expanded.push(transformEntity(be, e));
        });
      } else {
        expanded.push(e);
      }
    });

    // If still almost empty but blocks have geometry (some files only put drawing in *Model_Space)
    if (expanded.length < 2) {
      Object.keys(blocks).forEach((name) => {
        if (name.startsWith('*') && name !== '*MODEL_SPACE' && name !== '*Model_Space') return;
        (blocks[name] || []).forEach((be) => expanded.push(be));
      });
    }

    return summarize(expanded);
  }

  function parseBlocks(pairs) {
    const blocks = {};
    let i = 0;
    let inBlocks = false;
    let currentName = null;
    let currentEnts = [];
    let currentPoly = null;

    function flushBlock() {
      if (currentName) {
        blocks[currentName] = currentEnts;
        // also store uppercase key for case-insensitive INSERT match
        blocks[currentName.toUpperCase()] = currentEnts;
      }
      currentName = null;
      currentEnts = [];
      currentPoly = null;
    }

    while (i < pairs.length) {
      const p = pairs[i];
      if (p.code === 0 && p.value === 'SECTION') {
        const name = pairs[i + 1] && pairs[i + 1].code === 2 ? pairs[i + 1].value : '';
        inBlocks = name === 'BLOCKS';
        i += 1;
        continue;
      }
      if (p.code === 0 && p.value === 'ENDSEC') {
        if (inBlocks) flushBlock();
        inBlocks = false;
        i += 1;
        continue;
      }
      if (!inBlocks) {
        i += 1;
        continue;
      }

      if (p.code === 0 && p.value === 'BLOCK') {
        flushBlock();
        i += 1;
        let name = '';
        while (i < pairs.length && pairs[i].code !== 0) {
          if (pairs[i].code === 2 || pairs[i].code === 3) name = pairs[i].value;
          i += 1;
        }
        currentName = name;
        currentEnts = [];
        currentPoly = null;
        continue;
      }
      if (p.code === 0 && p.value === 'ENDBLK') {
        flushBlock();
        i += 1;
        continue;
      }

      if (p.code !== 0) {
        i += 1;
        continue;
      }

      const type = String(p.value || '').toUpperCase();
      i += 1;
      const parsed = readEntity(type, pairs, i);
      i = parsed.next;
      if (parsed.entity) {
        if (parsed.entity.type === 'POLYLINE') {
          currentPoly = parsed.entity;
          currentEnts.push(currentPoly);
        } else if (parsed.entity.type === 'VERTEX' && currentPoly) {
          currentPoly.points.push(...parsed.entity.points);
        } else if (parsed.entity.type === 'SEQEND') {
          currentPoly = null;
        } else if (parsed.entity.type !== 'VERTEX') {
          currentEnts.push(parsed.entity);
          currentPoly = null;
        }
      }
    }
    return blocks;
  }

  function parseEntityList(pairs, requireSection) {
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
      const parsed = readEntity(type, pairs, i);
      i = parsed.next;
      if (!parsed.entity) continue;

      if (parsed.entity.type === 'POLYLINE') {
        currentPoly = parsed.entity;
        entities.push(currentPoly);
      } else if (parsed.entity.type === 'VERTEX' && currentPoly) {
        currentPoly.points.push(...parsed.entity.points);
      } else if (parsed.entity.type === 'SEQEND') {
        currentPoly = null;
      } else if (parsed.entity.type !== 'VERTEX') {
        entities.push(parsed.entity);
        currentPoly = null;
      }
    }

    return entities.filter((e) => {
      if (e.type === 'POLYLINE' || e.type === 'LWPOLYLINE') return e.points && e.points.length >= 2;
      return true;
    });
  }

  function readEntity(type, pairs, i) {
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
        } else if (code === 20 && vx) vx.y = num;
        else if (code === 70) f.flags = parseInt(value, 10) || 0;
      } else if (type === 'VERTEX') {
        if (code === 10) vx = { x: num, y: 0 };
        else if (code === 20 && vx) {
          vx.y = num;
          verts.push({ x: vx.x, y: vx.y });
          vx = null;
        } else if (code === 70) f.vflags = parseInt(value, 10) || 0;
      } else if (type === 'SPLINE') {
        if (code === 11) vx = { x: num, y: 0, fit: true };
        else if (code === 21 && vx && vx.fit) {
          vx.y = num;
          verts.push({ x: vx.x, y: vx.y });
          vx = null;
        } else if (code === 10) vx = { x: num, y: 0, ctrl: true };
        else if (code === 20 && vx && vx.ctrl) {
          vx.y = num;
          verts.push({ x: vx.x, y: vx.y });
          vx = null;
        }
      } else if (type === 'INSERT') {
        if (code === 2) f.name = value;
        else if (code === 10) f.x = num;
        else if (code === 20) f.y = num;
        else if (code === 41) f.sx = num;
        else if (code === 42) f.sy = num;
        else if (code === 43) f.sz = num;
        else if (code === 50) f.rot = num;
        else if (code === 70) f.colCount = parseInt(value, 10) || 1;
        else if (code === 71) f.rowCount = parseInt(value, 10) || 1;
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

    let entity = null;

    if (type === 'LINE' && finite(f.x, f.y, f.x2, f.y2)) {
      entity = {
        type: 'LINE',
        points: [
          { x: f.x, y: f.y },
          { x: f.x2, y: f.y2 },
        ],
      };
    } else if (type === 'LWPOLYLINE' && verts.length >= 2) {
      entity = {
        type: 'LWPOLYLINE',
        closed: !!(f.flags & 1),
        points: verts.map((v) => ({ x: v.x, y: v.y })),
      };
    } else if (type === 'POLYLINE') {
      entity = { type: 'POLYLINE', closed: !!(f.flags & 1), points: [] };
    } else if (type === 'VERTEX' && verts.length) {
      if (!(f.vflags & 128)) {
        entity = { type: 'VERTEX', points: verts.map((v) => ({ x: v.x, y: v.y })) };
      }
    } else if (type === 'SEQEND') {
      entity = { type: 'SEQEND' };
    } else if (type === 'CIRCLE' && finite(f.x, f.y, f.r) && f.r > 0) {
      entity = { type: 'CIRCLE', cx: f.x, cy: f.y, r: f.r };
    } else if (type === 'ARC' && finite(f.x, f.y, f.r, f.a0, f.a1) && f.r > 0) {
      entity = {
        type: 'ARC',
        cx: f.x,
        cy: f.y,
        r: f.r,
        startAngle: f.a0,
        endAngle: f.a1,
      };
    } else if (type === 'ELLIPSE' && finite(f.x, f.y, f.x2, f.y2)) {
      entity = {
        type: 'ELLIPSE',
        cx: f.x,
        cy: f.y,
        mx: f.x2,
        my: f.y2,
        ratio: f.ratio > 0 ? f.ratio : 1,
        a0: f.a0 != null ? f.a0 : 0,
        a1: f.a1 != null ? f.a1 : Math.PI * 2,
      };
    } else if (type === 'SPLINE' && verts.length >= 2) {
      entity = { type: 'SPLINE', points: verts.map((v) => ({ x: v.x, y: v.y })), closed: false };
    } else if (type === 'INSERT' && f.name) {
      entity = {
        type: 'INSERT',
        name: f.name,
        x: f.x || 0,
        y: f.y || 0,
        sx: f.sx != null ? f.sx : 1,
        sy: f.sy != null ? f.sy : 1,
        rot: f.rot || 0,
      };
    }

    return { entity, next: i };
  }

  function transformPoint(p, ins) {
    let x = p.x * (ins.sx || 1);
    let y = p.y * (ins.sy || 1);
    const rot = ((ins.rot || 0) * Math.PI) / 180;
    if (rot) {
      const c = Math.cos(rot);
      const s = Math.sin(rot);
      const nx = x * c - y * s;
      const ny = x * s + y * c;
      x = nx;
      y = ny;
    }
    return { x: x + (ins.x || 0), y: y + (ins.y || 0) };
  }

  function transformEntity(e, ins) {
    if (e.type === 'LINE' || e.type === 'LWPOLYLINE' || e.type === 'POLYLINE' || e.type === 'SPLINE') {
      return {
        ...e,
        points: (e.points || []).map((p) => transformPoint(p, ins)),
      };
    }
    if (e.type === 'CIRCLE') {
      const c = transformPoint({ x: e.cx, y: e.cy }, ins);
      const scale = (Math.abs(ins.sx || 1) + Math.abs(ins.sy || 1)) / 2;
      return { type: 'CIRCLE', cx: c.x, cy: c.y, r: e.r * scale };
    }
    if (e.type === 'ARC') {
      const c = transformPoint({ x: e.cx, y: e.cy }, ins);
      const scale = (Math.abs(ins.sx || 1) + Math.abs(ins.sy || 1)) / 2;
      return {
        type: 'ARC',
        cx: c.x,
        cy: c.y,
        r: e.r * scale,
        startAngle: e.startAngle + (ins.rot || 0),
        endAngle: e.endAngle + (ins.rot || 0),
      };
    }
    if (e.type === 'ELLIPSE') {
      const c = transformPoint({ x: e.cx, y: e.cy }, ins);
      const maj = transformPoint({ x: e.mx, y: e.my }, { x: 0, y: 0, sx: ins.sx, sy: ins.sy, rot: ins.rot });
      return {
        type: 'ELLIPSE',
        cx: c.x,
        cy: c.y,
        mx: maj.x,
        my: maj.y,
        ratio: e.ratio,
        a0: e.a0,
        a1: e.a1,
      };
    }
    return e;
  }

  function circlePoints(cx, cy, r) {
    const n = Math.max(24, Math.ceil((2 * Math.PI * Math.abs(r)) / 1.2));
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
    const steps = Math.max(12, Math.ceil((sweep * Math.abs(r)) / 1.2));
    const pts = [];
    for (let s = 0; s <= steps; s++) {
      const a = a0 + (sweep * s) / steps;
      pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
    }
    return pts;
  }

  function ellipsePoints(e) {
    const maj = Math.hypot(e.mx, e.my) || 1;
    const min = maj * (e.ratio || 1);
    const rot = Math.atan2(e.my, e.mx);
    let a0 = e.a0 != null ? e.a0 : 0;
    let a1 = e.a1 != null ? e.a1 : Math.PI * 2;
    if (Math.abs(a1) > 7 || Math.abs(a0) > 7) {
      a0 = (a0 * Math.PI) / 180;
      a1 = (a1 * Math.PI) / 180;
    }
    let sweep = a1 - a0;
    if (Math.abs(sweep) < 1e-9) sweep = 2 * Math.PI;
    if (sweep < 0) sweep += 2 * Math.PI;
    const steps = Math.max(32, Math.ceil((sweep * maj) / 1.2));
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
      } else if (e.type === 'CIRCLE') addPoly(circlePoints(e.cx, e.cy, e.r), true);
      else if (e.type === 'ARC') addPoly(arcPoints(e.cx, e.cy, e.r, e.startAngle, e.endAngle), false);
      else if (e.type === 'ELLIPSE') addPoly(ellipsePoints(e), true);
    });

    if (!Number.isFinite(minX)) {
      minX = minY = 0;
      maxX = maxY = 1;
    }

    const width = Math.max(0, maxX - minX);
    const height = Math.max(0, maxY - minY);
    const paths = polylines.map((pl) => {
      const d = pl.points
        .map((p, idx) => (idx === 0 ? 'M' : 'L') + round2(p.x) + ' ' + round2(p.y))
        .join(' ');
      return pl.closed ? d + ' Z' : d;
    });

    return {
      entityCount: entities.length,
      pathCount: polylines.length,
      widthMm: round2(width),
      heightMm: round2(height),
      areaMm2: round2(width * height),
      cutLengthMm: round2(cutLength),
      bounds: { minX, minY, maxX, maxY },
      polylines,
      paths,
    };
  }

  function toSvg(summary, opts) {
    const o = opts || {};
    const pad = o.pad != null ? o.pad : 8;
    const minX = summary.bounds?.minX ?? 0;
    const minY = summary.bounds?.minY ?? 0;
    const maxX = summary.bounds?.maxX ?? minX + 1;
    const maxY = summary.bounds?.maxY ?? minY + 1;
    const w = Math.max(0.1, maxX - minX);
    const h = Math.max(0.1, maxY - minY);
    const stroke = o.stroke || '#b7410e';
    const sw = o.strokeWidth != null ? o.strokeWidth : Math.max(0.35, Math.min(w, h) * 0.006);

    const polys =
      summary.polylines && summary.polylines.length
        ? summary.polylines
        : (summary.paths || []).map((raw) => {
            const pts = [];
            String(raw).replace(/([ML])\s*([-\d.eE+]+)\s+([-\d.eE+]+)/g, (_, cmd, xs, ys) => {
              pts.push({ x: parseFloat(xs), y: parseFloat(ys) });
              return '';
            });
            return { points: pts, closed: /Z/i.test(raw) };
          });

    const pathEls = polys
      .map((pl) => {
        if (!pl.points || pl.points.length < 2) return '';
        const d = pl.points
          .map((p, idx) => {
            const x = p.x - minX;
            const y = maxY - p.y;
            return (idx === 0 ? 'M' : 'L') + round2(x) + ' ' + round2(y);
          })
          .join(' ');
        return `<path d="${d}${pl.closed ? ' Z' : ''}" fill="none" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round" stroke-linecap="round"/>`;
      })
      .join('\n');

    const vbW = w + pad * 2;
    const vbH = h + pad * 2;
    return {
      svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-pad} ${-pad} ${vbW} ${vbH}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet">${pathEls}</svg>`,
      width: w,
      height: h,
    };
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
    return {
      ...summary,
      widthMm: round2(sw * sx),
      heightMm: round2(sh * sy),
      areaMm2: round2(sw * sx * sh * sy),
      cutLengthMm: round2((summary.cutLengthMm || 0) * ((sx + sy) / 2)),
      scaleX: sx,
      scaleY: sy,
    };
  }

  /** Steel area in m² for quoting: plate bbox × fill (0–1). */
  function steelAreaM2(widthMm, heightMm, qty, fill) {
    const f = Number(fill) > 0 && Number(fill) <= 1 ? Number(fill) : 1;
    const q = Math.max(1, parseInt(qty, 10) || 1);
    const plate = (Math.max(0, widthMm) * Math.max(0, heightMm)) / 1e6;
    return {
      plateM2: round4(plate * q),
      steelM2: round4(plate * f * q),
      fill: f,
    };
  }

  function partWeightKg(widthMm, heightMm, qty, opts) {
    const o = opts || {};
    const fill = Number(o.silhouetteFill) > 0 ? Number(o.silhouetteFill) : 0.32;
    const kgPerM2 = Number(o.cortenKgPerM2) > 0 ? Number(o.cortenKgPerM2) : 23.55;
    const areas = steelAreaM2(widthMm, heightMm, qty, fill);
    return {
      weightKg: round2(areas.steelM2 * kgPerM2),
      plateWeightKg: round2(areas.plateM2 * kgPerM2),
      solidAreaM2: areas.steelM2,
      plateAreaM2: areas.plateM2,
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
    steelAreaM2,
  };
})(typeof window !== 'undefined' ? window : globalThis);
