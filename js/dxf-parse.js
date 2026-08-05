/**
 * Lightweight DXF parser for quote tooling.
 * Extracts bounding box, cut length estimate, and SVG path data.
 * Supports LINE, LWPOLYLINE, POLYLINE, CIRCLE, ARC, POINT (ignored for cut).
 */
(function (global) {
  function parsePairs(text) {
    const lines = String(text || '')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .split('\n');
    const pairs = [];
    for (let i = 0; i + 1 < lines.length; i += 2) {
      const code = parseInt(String(lines[i]).trim(), 10);
      const value = String(lines[i + 1] != null ? lines[i + 1] : '').trim();
      if (Number.isFinite(code)) pairs.push({ code, value });
    }
    return pairs;
  }

  function dist(a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function parseDxf(text) {
    const pairs = parsePairs(text);
    const entities = [];
    let i = 0;
    let inEntities = false;

    while (i < pairs.length) {
      const p = pairs[i];
      if (p.code === 0 && p.value === 'SECTION') {
        const name = pairs[i + 1] && pairs[i + 1].code === 2 ? pairs[i + 1].value : '';
        inEntities = name === 'ENTITIES';
        i += 1;
        continue;
      }
      if (p.code === 0 && p.value === 'ENDSEC') {
        inEntities = false;
        i += 1;
        continue;
      }
      if (!inEntities || p.code !== 0) {
        i += 1;
        continue;
      }

      const type = p.value;
      i += 1;
      const fields = {};
      const vertices = [];
      let currentVertex = null;

      while (i < pairs.length && pairs[i].code !== 0) {
        const { code, value } = pairs[i];
        const num = parseFloat(value);

        if (type === 'LWPOLYLINE') {
          if (code === 10) {
            currentVertex = { x: num, y: 0 };
            vertices.push(currentVertex);
          } else if (code === 20 && currentVertex) {
            currentVertex.y = num;
          } else if (code === 70) fields.flags = parseInt(value, 10) || 0;
          else if (code === 90) fields.nVerts = parseInt(value, 10) || 0;
        } else if (type === 'POLYLINE') {
          fields.flags = code === 70 ? parseInt(value, 10) || 0 : fields.flags;
        } else if (type === 'VERTEX') {
          if (code === 10) currentVertex = { x: num, y: 0 };
          else if (code === 20 && currentVertex) {
            currentVertex.y = num;
            vertices.push(currentVertex);
            currentVertex = null;
          }
        } else {
          if (code === 10) fields.x = num;
          else if (code === 20) fields.y = num;
          else if (code === 11) fields.x2 = num;
          else if (code === 21) fields.y2 = num;
          else if (code === 40) fields.r = num;
          else if (code === 50) fields.startAngle = num;
          else if (code === 51) fields.endAngle = num;
        }
        i += 1;
      }

      if (type === 'SEQEND' && entities.length) {
        const last = entities[entities.length - 1];
        if (last.type === 'POLYLINE' && vertices.length) {
          last.vertices = vertices.slice();
        }
      }

      if (type === 'LINE' && fields.x != null && fields.y != null && fields.x2 != null && fields.y2 != null) {
        entities.push({
          type: 'LINE',
          points: [
            { x: fields.x, y: fields.y },
            { x: fields.x2, y: fields.y2 },
          ],
        });
      } else if (type === 'LWPOLYLINE' && vertices.length) {
        entities.push({
          type: 'LWPOLYLINE',
          closed: !!(fields.flags & 1),
          points: vertices.map((v) => ({ x: v.x, y: v.y })),
        });
      } else if (type === 'POLYLINE') {
        entities.push({ type: 'POLYLINE', closed: !!(fields.flags & 1), points: [], _collect: true });
      } else if (type === 'VERTEX') {
        // attached via SEQEND for classic polylines; also stash on last POLYLINE
        const last = entities[entities.length - 1];
        if (last && last.type === 'POLYLINE' && vertices.length) {
          last.points = last.points.concat(vertices);
        }
      } else if (type === 'CIRCLE' && fields.x != null && fields.y != null && fields.r != null) {
        entities.push({ type: 'CIRCLE', cx: fields.x, cy: fields.y, r: fields.r });
      } else if (
        type === 'ARC' &&
        fields.x != null &&
        fields.y != null &&
        fields.r != null &&
        fields.startAngle != null &&
        fields.endAngle != null
      ) {
        entities.push({
          type: 'ARC',
          cx: fields.x,
          cy: fields.y,
          r: fields.r,
          startAngle: fields.startAngle,
          endAngle: fields.endAngle,
        });
      }
    }

    // Merge POLYLINE vertices if collected
    const cleaned = entities.filter((e) => e.type !== 'POLYLINE' || (e.points && e.points.length));

    return summarize(cleaned);
  }

  function summarize(entities) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let cutLength = 0;
    const paths = [];

    function expand(x, y) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }

    function addPoly(pts, closed) {
      if (!pts.length) return;
      const d = [];
      pts.forEach((p, idx) => {
        expand(p.x, p.y);
        d.push((idx === 0 ? 'M' : 'L') + p.x + ' ' + p.y);
        if (idx > 0) cutLength += dist(pts[idx - 1], p);
      });
      if (closed && pts.length > 1) {
        cutLength += dist(pts[pts.length - 1], pts[0]);
        d.push('Z');
      }
      paths.push(d.join(' '));
    }

    entities.forEach((e) => {
      if (e.type === 'LINE') {
        addPoly(e.points, false);
      } else if (e.type === 'LWPOLYLINE' || e.type === 'POLYLINE') {
        addPoly(e.points, !!e.closed);
      } else if (e.type === 'CIRCLE') {
        expand(e.cx - e.r, e.cy - e.r);
        expand(e.cx + e.r, e.cy + e.r);
        cutLength += 2 * Math.PI * e.r;
        paths.push(
          `M ${e.cx - e.r} ${e.cy} A ${e.r} ${e.r} 0 1 0 ${e.cx + e.r} ${e.cy} A ${e.r} ${e.r} 0 1 0 ${e.cx - e.r} ${e.cy}`
        );
      } else if (e.type === 'ARC') {
        let a0 = (e.startAngle * Math.PI) / 180;
        let a1 = (e.endAngle * Math.PI) / 180;
        let sweep = a1 - a0;
        if (sweep <= 0) sweep += 2 * Math.PI;
        const steps = Math.max(8, Math.ceil((sweep * e.r) / 2));
        const pts = [];
        for (let s = 0; s <= steps; s++) {
          const a = a0 + (sweep * s) / steps;
          pts.push({ x: e.cx + e.r * Math.cos(a), y: e.cy + e.r * Math.sin(a) });
        }
        addPoly(pts, false);
      }
    });

    if (!Number.isFinite(minX)) {
      minX = minY = 0;
      maxX = maxY = 0;
    }

    const width = Math.max(0, maxX - minX);
    const height = Math.max(0, maxY - minY);
    const area = width * height;

    return {
      entityCount: entities.length,
      widthMm: round2(width),
      heightMm: round2(height),
      areaMm2: round2(area),
      cutLengthMm: round2(cutLength),
      bounds: { minX, minY, maxX, maxY },
      paths,
      entities,
    };
  }

  function round2(n) {
    return Math.round(n * 100) / 100;
  }

  function toSvg(summary, opts) {
    const o = opts || {};
    const pad = o.pad != null ? o.pad : 8;
    const vbW = Math.max(1, summary.widthMm) + pad * 2;
    const vbH = Math.max(1, summary.heightMm) + pad * 2;
    const ox = (summary.bounds?.minX || 0) - pad;
    // SVG Y is down; flip DXF Y
    const maxY = summary.bounds?.maxY || 0;
    const pathEls = (summary.paths || [])
      .map((d) => {
        // Flip Y relative to maxY
        const flipped = d.replace(/([ML])\s*([-\d.]+)\s+([-\d.]+)/g, (_, cmd, x, y) => {
          const fy = maxY - parseFloat(y) + (summary.bounds?.minY || 0);
          // Actually: svgY = maxY - y, then offset by min so viewBox starts 0
          const sy = maxY - parseFloat(y);
          return cmd + ' ' + x + ' ' + sy;
        }).replace(/Z/g, 'Z');
        // Simpler flip: transform on group
        return d;
      })
      .map(
        (d) =>
          `<path d="${d}" fill="none" stroke="${o.stroke || '#b7410e'}" stroke-width="${o.strokeWidth || 0.8}" vector-effect="non-scaling-stroke"/>`
      )
      .join('');

    const minX = summary.bounds?.minX || 0;
    const minY = summary.bounds?.minY || 0;
    const w = Math.max(1, summary.widthMm);
    const h = Math.max(1, summary.heightMm);

    return {
      svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX - pad} ${-(minY + h) - pad} ${w + pad * 2} ${h + pad * 2}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet">
  <g transform="scale(1,-1)">
    ${pathEls}
  </g>
</svg>`,
      viewBox: `${minX - pad} ${minY - pad} ${w + pad * 2} ${h + pad * 2}`,
    };
  }

  /**
   * Scale geometry so width or height matches target mm (linked aspect).
   */
  function scaleToSize(summary, targetW, targetH, linked) {
    const sw = summary.widthMm || 1;
    const sh = summary.heightMm || 1;
    let sx = 1;
    let sy = 1;
    if (linked) {
      if (targetW && targetH) {
        sx = sy = Math.min(targetW / sw, targetH / sh);
      } else if (targetW) {
        sx = sy = targetW / sw;
      } else if (targetH) {
        sx = sy = targetH / sh;
      }
    } else {
      if (targetW) sx = targetW / sw;
      if (targetH) sy = targetH / sh;
    }
    const widthMm = round2(sw * sx);
    const heightMm = round2(sh * sy);
    const cutLengthMm = round2((summary.cutLengthMm || 0) * ((sx + sy) / 2));
    return {
      ...summary,
      widthMm,
      heightMm,
      areaMm2: round2(widthMm * heightMm),
      cutLengthMm,
      scaleX: sx,
      scaleY: sy,
    };
  }

  global.DxfParse = {
    parseDxf,
    toSvg,
    scaleToSize,
  };
})(typeof window !== 'undefined' ? window : globalThis);
