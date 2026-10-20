window.SketchSaathi = window.SketchSaathi || {};

SketchSaathi.canvas = (() => {
  const canvas = document.getElementById('canvas');
  const ctx = canvas.getContext('2d');
  const listeners = {
    add: [], update: [], remove: [], clear: [], order: [],
    change: [], render: [], view: [], cursor: [], select: [], editing: [], laser: [], frameRename: [], contextmenu: [],
    toolchange: [],
  };
  const MIN_SCALE = 0.1, MAX_SCALE = 8;
  const CLOSED = ['rectangle', 'diamond', 'ellipse'];
  const ROUNDABLE = ['rectangle', 'diamond'];
  const FONTS = {
    hand: "'Caveat', 'Segoe Print', 'Comic Sans MS', cursive",
    sans: "system-ui, 'Segoe UI', Roboto, sans-serif",
    mono: "'Cascadia Code', Consolas, 'Courier New', monospace",
  };
  const TEXT_KEYS = ['fontFamily', 'fontSize', 'align'];
  const ACCENT = '#0d9488';
  const HANDLE = 8;
  const BOXED = ['rectangle', 'text', 'image', 'frame'];
  const LASER_MS = 1000;
  const FRAME_LABEL = 14;

  let elements = [];
  let current = null;
  let tool = 'pen';
  const style = {
    color: '#1e1e1e', fill: '', size: 4, strokeStyle: 'solid', round: false, opacity: 1,
    fontFamily: 'hand', fontSize: 20, align: 'left',
  };
  let editing = null;
  let toolLocked = false;
  let view = { x: 0, y: 0, scale: 1 };
  let selectedIds = new Set();
  let pointer = [0, 0];
  const images = new Map();
  const lasers = new Map();
  let laserFrame = null;
  let spaceDown = false;
  let showGrid = false;
  let background = '#ffffff';
  let lastCursorSent = 0;

  // one step = the changes made by one action; only our own edits are tracked
  const HISTORY_LIMIT = 200;
  const history = [];
  const future = [];
  let batch = null;

  const emit = (name, payload) => listeners[name].forEach(fn => fn(payload));
  const newId = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()));
  const dpr = () => window.devicePixelRatio || 1;
  const fontPx = el => el.fontSize || 14 + (el.size || 4) * 3;
  const fontCss = el => `${fontPx(el)}px ${FONTS[el.fontFamily] || FONTS.hand}`;
  const clone = el => JSON.parse(JSON.stringify(el));
  const snapshot = list => new Map(list.map(el => [el.id, clone(el)]));

  function pushStep(changes) {
    if (!changes.length) return;
    history.push(changes);
    if (history.length > HISTORY_LIMIT) history.shift();
    future.length = 0;
  }
  function record(change) {
    if (batch) batch.push(change);
    else pushStep([change]);
  }
  function beginBatch() { if (!batch) batch = []; }
  function endBatch() {
    if (!batch) return;
    const changes = batch;
    batch = null;
    pushStep(changes);
  }
  function inBatch(fn) {
    if (batch) return fn();
    beginBatch();
    try { return fn(); } finally { endBatch(); }
  }
  function recordUpdates(before, list) {
    inBatch(() => list.forEach(el => {
      const old = before.get(el.id), now = clone(el);
      if (old && JSON.stringify(old) !== JSON.stringify(now)) record({ id: el.id, before: old, after: now });
    }));
  }
  const selectedList = () => elements.filter(el => selectedIds.has(el.id));
  const selected = () => selectedList()[0] || null;
  const single = () => { const list = selectedList(); return list.length === 1 ? list[0] : null; };

  function setSelected(ids) {
    const next = new Set(ids == null ? [] : Array.isArray(ids) ? ids : [ids]);
    if (next.size === selectedIds.size && [...next].every(id => selectedIds.has(id))) return;
    selectedIds = next;
    emit('select', selected());
  }

  function unionBox(list) {
    const boxes = list.map(bounds);
    const x = Math.min(...boxes.map(b => b.x)), y = Math.min(...boxes.map(b => b.y));
    return { x, y, width: Math.max(...boxes.map(b => b.x + b.width)) - x,
             height: Math.max(...boxes.map(b => b.y + b.height)) - y };
  }

  const textCache = new Map();
  if (document.fonts) {
    document.fonts.addEventListener('loadingdone', () => { textCache.clear(); render(); if (editing) styleEditor(); });
  }
  const layoutKey = (el, text) => `${fontCss(el)}|${el.boxWidth || 0}|${text}`;

  function cached(key, compute) {
    let value = textCache.get(key);
    if (value === undefined) {
      if (textCache.size > 3000) textCache.clear();
      value = compute();
      textCache.set(key, value);
    }
    return value;
  }

  function wrapLines(el, text = el.text) {
    return cached('lines|' + layoutKey(el, text), () => computeLines(el, text));
  }

  function computeLines(el, text) {
    const paragraphs = text.split('\n');
    if (!el.boxWidth) return paragraphs;
    ctx.save();
    ctx.font = fontCss(el);
    const fits = line => ctx.measureText(line).width <= el.boxWidth;
    const lines = [];
    paragraphs.forEach(paragraph => {
      let line = '';
      paragraph.split(/(\s+)/).forEach(word => {
        const next = line + word;
        if (fits(next) || !line.trim()) { line = next; } else { lines.push(line.trimEnd()); line = word.trimStart(); }
        while (!fits(line) && line.length > 1) {
          let cut = line.length - 1;
          while (cut > 1 && !fits(line.slice(0, cut))) cut--;
          lines.push(line.slice(0, cut));
          line = line.slice(cut);
        }
      });
      lines.push(line);
    });
    ctx.restore();
    return lines;
  }

  function textBox(el) {
    const px = fontPx(el);
    const lines = wrapLines(el);
    const width = el.boxWidth || cached('width|' + layoutKey(el, el.text), () => {
      ctx.save();
      ctx.font = fontCss(el);
      const widest = Math.max(...lines.map(l => ctx.measureText(l).width), 4);
      ctx.restore();
      return widest;
    });
    return { x: el.x, y: el.y, width, height: lines.length * px * 1.25 };
  }

  function bounds(el) {
    if (el.type === 'text') return textBox(el);
    if (el.type === 'pen') {
      const xs = el.points.map(p => p[0]), ys = el.points.map(p => p[1]);
      const x = Math.min(...xs), y = Math.min(...ys);
      return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
    }
    const x = Math.min(el.x, el.x + el.width), y = Math.min(el.y, el.y + el.height);
    return { x, y, width: Math.abs(el.width), height: Math.abs(el.height) };
  }

  function outline(el) {
    if (el.type === 'pen') return el.points;
    if (el.type === 'line' || el.type === 'arrow') return [[el.x, el.y], [el.x + el.width, el.y + el.height]];
    const { x, y, width: w, height: h } = el.type === 'text' ? textBox(el) : el;
    if (BOXED.includes(el.type)) return [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]];
    if (el.type === 'diamond') {
      return [[x + w / 2, y], [x + w, y + h / 2], [x + w / 2, y + h], [x, y + h / 2], [x + w / 2, y]];
    }
    const cx = x + w / 2, cy = y + h / 2, rx = Math.abs(w / 2), ry = Math.abs(h / 2);
    return Array.from({ length: 49 }, (_, i) => {
      const a = (i / 48) * Math.PI * 2;
      return [cx + rx * Math.cos(a), cy + ry * Math.sin(a)];
    });
  }

  function distanceToSegment(px, py, [ax, ay], [bx, by]) {
    const dx = bx - ax, dy = by - ay;
    const lengthSq = dx * dx + dy * dy;
    const t = lengthSq ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq)) : 0;
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  }

  function pick(el, x, y) {
    const reach = (8 + (el.size || 2) / 2) / view.scale;
    const inBox = (b, pad = 0) => x >= b.x - pad && x <= b.x + b.width + pad && y >= b.y - pad && y <= b.y + b.height + pad;
    if (el.type === 'image') return inBox(bounds(el));
    if (el.type === 'frame') {
      const b = bounds(el);
      const label = { x: b.x, y: b.y - FRAME_LABEL * 1.6, width: Math.max(60, (el.name || '').length * 8), height: FRAME_LABEL * 1.6 };
      if (inBox(label)) return true;
    }
    if (el.type === 'text' || (el.fill && CLOSED.includes(el.type))) {
      const b = bounds(el);
      if (x >= b.x - reach && x <= b.x + b.width + reach && y >= b.y - reach && y <= b.y + b.height + reach) return true;
      if (el.type === 'text') return false;
    }
    const points = outline(el);
    if (points.length === 1) return Math.hypot(x - points[0][0], y - points[0][1]) <= reach;
    return points.some((p, i) => i && distanceToSegment(x, y, points[i - 1], p) <= reach);
  }

  const topmostAt = (x, y, includeLocked = false) =>
    [...elements].reverse().find(el => (includeLocked || !el.locked) && pick(el, x, y));

  function constrain(type, w, h) {
    if (type === 'line' || type === 'arrow') {
      const step = Math.PI / 12;
      const angle = Math.round(Math.atan2(h, w) / step) * step;
      const length = Math.hypot(w, h);
      return [length * Math.cos(angle), length * Math.sin(angle)];
    }
    const side = Math.max(Math.abs(w), Math.abs(h));
    return [(w < 0 ? -1 : 1) * side, (h < 0 ? -1 : 1) * side];
  }

  function translate(el, dx, dy) {
    if (el.type === 'pen') el.points = el.points.map(([x, y]) => [x + dx, y + dy]);
    else { el.x += dx; el.y += dy; }
  }

  function selectionBox(el) {
    const b = bounds(el), pad = 6 / view.scale;
    return { x: b.x - pad, y: b.y - pad, width: b.width + pad * 2, height: b.height + pad * 2 };
  }

  function corners(box) {
    return {
      nw: [box.x, box.y], ne: [box.x + box.width, box.y],
      se: [box.x + box.width, box.y + box.height], sw: [box.x, box.y + box.height],
    };
  }

  function handles(el) {
    const box = selectionBox(el);
    const all = corners(box);
    if (el.type === 'text') {
      all.e = [box.x + box.width, box.y + box.height / 2];
      all.w = [box.x, box.y + box.height / 2];
    }
    return all;
  }

  function handleAt(x, y) {
    const el = single();
    if (!el || tool !== 'select') return null;
    const reach = HANDLE / view.scale;
    const found = Object.entries(handles(el))
      .find(([, [hx, hy]]) => Math.abs(x - hx) <= reach && Math.abs(y - hy) <= reach);
    return found ? found[0] : null;
  }

  function resizeInto(el, original, from, to) {
    const sx = from.width ? to.width / from.width : 1;
    const sy = from.height ? to.height / from.height : 1;
    const map = ([x, y]) => [to.x + (x - from.x) * sx, to.y + (y - from.y) * sy];
    if (original.type === 'pen') {
      el.points = original.points.map(map);
    } else if (original.type === 'text') {
      el.fontSize = Math.max(6, fontPx(original) * sy);
      if (original.boxWidth) el.boxWidth = original.boxWidth * sy;
      [el.x, el.y] = [to.x, to.y];
    } else {
      const [x1, y1] = map([original.x, original.y]);
      const [x2, y2] = map([original.x + original.width, original.y + original.height]);
      Object.assign(el, { x: x1, y: y1, width: x2 - x1, height: y2 - y1 });
    }
  }

  function dashFor(el) {
    const w = el.size || 2;
    if (el.strokeStyle === 'dashed') return [w * 3, w * 2.5];
    if (el.strokeStyle === 'dotted') return [0.1, w * 2.2];
    return [];
  }

  function roundedPolygon(c, points, radius) {
    const pts = points.slice(0, -1);
    const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    c.moveTo(...mid(pts[pts.length - 1], pts[0]));
    pts.forEach((p, i) => c.arcTo(p[0], p[1], ...mid(p, pts[(i + 1) % pts.length]), radius));
    c.closePath();
  }

  function drawElement(c, el) {
    c.save();
    c.globalAlpha = el.opacity ?? 1;
    c.strokeStyle = el.color;
    c.fillStyle = el.color;
    c.lineWidth = el.size || 2;
    c.lineCap = c.lineJoin = 'round';
    c.setLineDash(dashFor(el));

    if (el.type === 'image') {
      const b = bounds(el);
      const img = imageFor(el.src);
      if (el.flipX || el.flipY) {
        c.translate(b.x + b.width / 2, b.y + b.height / 2);
        c.scale(el.flipX ? -1 : 1, el.flipY ? -1 : 1);
        c.translate(-(b.x + b.width / 2), -(b.y + b.height / 2));
      }
      if (img.complete && img.naturalWidth) c.drawImage(img, b.x, b.y, b.width, b.height);
      else { c.fillStyle = '#e5e7eb'; c.fillRect(b.x, b.y, b.width, b.height); }
      c.restore();
      return;
    }
    if (el.type === 'frame') {
      const b = bounds(el);
      c.globalAlpha = 1;
      c.setLineDash([]);
      c.lineWidth = 1.5;
      c.strokeStyle = '#a1a1aa';
      c.beginPath();
      c.roundRect(b.x, b.y, b.width, b.height, 8);
      c.stroke();
      c.fillStyle = '#71717a';
      c.font = `${FRAME_LABEL}px system-ui, 'Segoe UI', sans-serif`;
      c.textBaseline = 'bottom';
      c.fillText(el.name || 'Frame', b.x + 2, b.y - 4);
      c.restore();
      return;
    }

    if (el.type === 'text') {
      const px = fontPx(el);
      const box = textBox(el);
      c.font = fontCss(el);
      c.textBaseline = 'middle';
      wrapLines(el).forEach((line, i) => {
        const gap = box.width - c.measureText(line).width;
        const dx = el.align === 'center' ? gap / 2 : el.align === 'right' ? gap : 0;
        c.fillText(line, el.x + dx, el.y + (i + 0.5) * px * 1.25);
      });
      c.restore();
      return;
    }

    c.beginPath();
    if (el.type === 'pen') {
      if (el.points.length === 1) {
        c.moveTo(el.points[0][0], el.points[0][1]);
        c.lineTo(el.points[0][0] + 0.01, el.points[0][1]);
      } else {
        const pts = el.points;
        c.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length - 1; i++) {
          const [x1, y1] = pts[i], [x2, y2] = pts[i + 1];
          c.quadraticCurveTo(x1, y1, (x1 + x2) / 2, (y1 + y2) / 2);
        }
        c.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
      }
    } else if (el.type === 'ellipse') {
      c.ellipse(el.x + el.width / 2, el.y + el.height / 2,
                Math.abs(el.width / 2), Math.abs(el.height / 2), 0, 0, Math.PI * 2);
    } else if (el.round && ROUNDABLE.includes(el.type)) {
      const b = bounds(el);
      const radius = Math.min(b.width, b.height) * (el.type === 'diamond' ? 0.12 : 0.18);
      roundedPolygon(c, outline(el), radius);
    } else {
      outline(el).forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
      if (ROUNDABLE.includes(el.type)) c.closePath();
    }
    if (el.fill && CLOSED.includes(el.type)) { c.fillStyle = el.fill; c.fill(); }
    c.stroke();

    if (el.type === 'arrow' && (el.width || el.height)) {
      c.setLineDash([]);
      const angle = Math.atan2(el.height, el.width);
      const head = 10 + (el.size || 2) * 2;
      const ex = el.x + el.width, ey = el.y + el.height;
      c.beginPath();
      c.moveTo(ex - head * Math.cos(angle - 0.45), ey - head * Math.sin(angle - 0.45));
      c.lineTo(ex, ey);
      c.lineTo(ex - head * Math.cos(angle + 0.45), ey - head * Math.sin(angle + 0.45));
      c.stroke();
    }
    c.restore();
  }

  function imageFor(src) {
    let img = images.get(src);
    if (!img) {
      img = new Image();
      img.onload = () => render();
      img.src = src;
      images.set(src, img);
    }
    return img;
  }

  function drawLasers() {
    const now = performance.now();
    let alive = false;
    lasers.forEach(({ color, strokes }) => {
      strokes.forEach(stroke => {
        while (stroke.length && now - stroke[0].t > LASER_MS) stroke.shift();
        for (let i = 1; i < stroke.length; i++) {
          const life = Math.max(0, 1 - (now - stroke[i].t) / LASER_MS);
          ctx.save();
          ctx.globalAlpha = life;
          ctx.lineCap = 'butt';
          ctx.strokeStyle = color;
          ctx.lineWidth = (1.5 + 2.5 * life) / view.scale;
          ctx.shadowColor = color;
          ctx.shadowBlur = 3;
          ctx.beginPath();
          ctx.moveTo(stroke[i - 1].x, stroke[i - 1].y);
          ctx.lineTo(stroke[i].x, stroke[i].y);
          ctx.stroke();
          ctx.restore();
        }
        if (stroke.length > 1) {
          ctx.save();
          ctx.globalAlpha = Math.max(0, 1 - (now - stroke[stroke.length - 1].t) / LASER_MS) * 0.9;
          ctx.strokeStyle = '#fff';
          ctx.lineCap = ctx.lineJoin = 'round';
          ctx.lineWidth = 1 / view.scale;
          ctx.beginPath();
          stroke.forEach((point, i) => (i ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y)));
          ctx.stroke();
          ctx.restore();
        }
        if (stroke.length) alive = true;
      });
    });
    if (alive && !laserFrame) laserFrame = requestAnimationFrame(() => { laserFrame = null; render(); });
  }

  function addLaserPoint(who, color, x, y, start) {
    let trail = lasers.get(who);
    if (!trail) { trail = { color, strokes: [] }; lasers.set(who, trail); }
    if (start || !trail.strokes.length) trail.strokes.push([]);
    trail.strokes[trail.strokes.length - 1].push({ x, y, t: performance.now() });
    trail.strokes = trail.strokes.filter((stroke, i) => stroke.length || i === trail.strokes.length - 1);
    render();
  }

  function insidePolygon([px, py], polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const [xi, yi] = polygon[i], [xj, yj] = polygon[j];
      if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  function renderToCanvas(list, pad = 24) {
    const boxes = list.map(bounds);
    const minX = Math.min(...boxes.map(b => b.x)) - pad, minY = Math.min(...boxes.map(b => b.y)) - pad;
    const out = document.createElement('canvas');
    out.width = Math.max(1, Math.ceil(Math.max(...boxes.map(b => b.x + b.width)) + pad - minX));
    out.height = Math.max(1, Math.ceil(Math.max(...boxes.map(b => b.y + b.height)) + pad - minY));
    const octx = out.getContext('2d');
    octx.fillStyle = background;
    octx.fillRect(0, 0, out.width, out.height);
    octx.translate(-minX, -minY);
    list.forEach(el => drawElement(octx, el));
    return out;
  }

  function drawGrid() {
    const gap = 24 * view.scale;
    if (gap < 8) return;
    const k = dpr();
    ctx.fillStyle = 'rgba(120, 124, 140, .35)';
    const startX = ((view.x % gap) + gap) % gap, startY = ((view.y % gap) + gap) % gap;
    for (let x = startX; x < canvas.clientWidth; x += gap) {
      for (let y = startY; y < canvas.clientHeight; y += gap) ctx.fillRect(x * k, y * k, 1.5 * k, 1.5 * k);
    }
  }

  function drawSelection() {
    const unit = 1 / view.scale;
    if (current && current.textAt && Math.abs(current.to[0] - current.textAt[0]) * view.scale > 8) {
      const [ax, ay] = current.textAt, [bx] = current.to;
      ctx.save();
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = unit;
      ctx.setLineDash([4 * unit, 3 * unit]);
      ctx.strokeRect(Math.min(ax, bx), ay, Math.abs(bx - ax), fontPx(style) * 1.25);
      ctx.restore();
    }
    if (current && current.lasso) {
      ctx.save();
      ctx.strokeStyle = ACCENT;
      ctx.fillStyle = 'rgba(13, 148, 136, .06)';
      ctx.lineWidth = unit;
      ctx.setLineDash([4 * unit, 4 * unit]);
      ctx.beginPath();
      current.lasso.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
    if (current && current.marquee) {
      const [ax, ay] = current.marquee, [bx, by] = current.to;
      ctx.save();
      ctx.fillStyle = 'rgba(13, 148, 136, .08)';
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = unit;
      ctx.fillRect(Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay));
      ctx.strokeRect(Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay));
      ctx.restore();
    }
    const list = selectedList();
    if (!list.length) return;
    ctx.save();
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = unit;
    if (list.length > 1) {
      list.forEach(el => { const b = selectionBox(el); ctx.strokeRect(b.x, b.y, b.width, b.height); });
      const pad = 10 * unit, g = unionBox(list);
      ctx.setLineDash([5 * unit, 4 * unit]);
      ctx.strokeRect(g.x - pad, g.y - pad, g.width + pad * 2, g.height + pad * 2);
      ctx.restore();
      return;
    }
    const box = selectionBox(list[0]);
    ctx.strokeRect(box.x, box.y, box.width, box.height);
    if (tool === 'select') {
      ctx.fillStyle = '#fff';
      const s = HANDLE * unit;
      Object.values(handles(list[0])).forEach(([hx, hy]) => {
        ctx.beginPath();
        ctx.roundRect(hx - s / 2, hy - s / 2, s, s, 2 * unit);
        ctx.fill();
        ctx.stroke();
      });
    }
    ctx.restore();
  }

  let frameRequest = null;
  function render() {
    if (frameRequest === null) frameRequest = requestAnimationFrame(() => { frameRequest = null; draw(); });
  }

  // the pixel density can change without a resize event, so re-check before every draw
  function syncSize() {
    const k = dpr();
    const width = Math.round(canvas.clientWidth * k), height = Math.round(canvas.clientHeight * k);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
  }

  function draw() {
    syncSize();
    const k = dpr();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (showGrid) drawGrid();
    ctx.setTransform(view.scale * k, 0, 0, view.scale * k, view.x * k, view.y * k);
    elements.forEach(el => { if (!editing || editing.el.id !== el.id) drawElement(ctx, el); });
    if (current && current.type) drawElement(ctx, current);
    if (!editing) drawSelection();
    drawLasers();
    emit('render');
  }

  function resize() {
    draw();
  }
  if (window.ResizeObserver) new ResizeObserver(() => { draw(); if (editing) styleEditor(); }).observe(canvas);

  let viewAnimation = null;

  function setView(next, animating = false) {
    if (!animating && viewAnimation) { cancelAnimationFrame(viewAnimation.frame); viewAnimation = null; }
    view = next;
    if (editing) styleEditor();
    render();
    emit('view', view);
  }

  function animateView(target, duration = 220) {
    if (viewAnimation) cancelAnimationFrame(viewAnimation.frame);
    const from = { ...view }, start = performance.now();
    const ease = t => 1 - Math.pow(1 - t, 3);
    const step = now => {
      const t = Math.min(1, (now - start) / duration), k = ease(t);
      const scale = from.scale * Math.pow(target.scale / from.scale, k);
      const mix = (a, b) => a + (b - a) * k;
      setView({ scale, x: mix(from.x, target.x), y: mix(from.y, target.y) }, true);
      if (t < 1) viewAnimation.frame = requestAnimationFrame(step);
      else viewAnimation = null;
    };
    viewAnimation = { target, frame: requestAnimationFrame(step) };
  }

  function zoomAt(factor, cx, cy, animate = false) {
    const base = viewAnimation ? viewAnimation.target : view;
    const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, base.scale * factor));
    const ratio = scale / base.scale;
    const next = { scale, x: cx - (cx - base.x) * ratio, y: cy - (cy - base.y) * ratio };
    if (animate) animateView(next);
    else setView(next);
  }

  function removeElement(id) {
    const index = elements.findIndex(el => el.id === id);
    if (index < 0) return;
    record({ id, before: clone(elements[index]), after: null, index });
    elements.splice(index, 1);
    if (selectedIds.has(id)) setSelected([...selectedIds].filter(other => other !== id));
    render();
    emit('remove', id);
    emit('change');
  }

  function addElement(el) {
    if (el.type === 'frame') elements.unshift(el);
    else elements.push(el);
    record({ id: el.id, before: null, after: clone(el) });
    render();
    emit('add', el);
    if (el.type === 'frame') emit('order', elements.map(e => e.id));
    emit('change');
  }

  // apply one history step forwards (redo) or backwards (undo)
  function applyStep(changes, undoing) {
    let reordered = false;
    (undoing ? [...changes].reverse() : changes).forEach(change => {
      if (change.order) {
        const rank = new Map((undoing ? change.order.before : change.order.after).map((id, i) => [id, i]));
        elements.sort((a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity));
        reordered = true;
        return;
      }
      const target = undoing ? change.before : change.after;
      const index = elements.findIndex(el => el.id === change.id);
      if (!target) {
        if (index >= 0) { elements.splice(index, 1); emit('remove', change.id); }
        return;
      }
      const copy = clone(target);
      if (index >= 0) {
        elements[index] = copy;
        emit('update', copy);
      } else {
        const at = change.index ?? (copy.type === 'frame' ? 0 : elements.length);
        elements.splice(Math.min(at, elements.length), 0, copy);
        emit('add', copy);
        reordered = true;
      }
    });
    if (reordered) emit('order', elements.map(el => el.id));
    const alive = new Set(elements.map(el => el.id));
    if ([...selectedIds].some(id => !alive.has(id))) setSelected([...selectedIds].filter(id => alive.has(id)));
    render();
    emit('change');
  }

  function newElement(type, props) {
    const el = { id: newId(), type, color: style.color, opacity: style.opacity, ...props };
    if (type === 'text') {
      Object.assign(el, { fontFamily: style.fontFamily, fontSize: style.fontSize, align: style.align });
      return el;
    }
    Object.assign(el, { size: style.size, strokeStyle: style.strokeStyle });
    if (style.fill && CLOSED.includes(type)) el.fill = style.fill;
    if (style.round && ROUNDABLE.includes(type)) el.round = true;
    return el;
  }

  function styleEditor() {
    const { el, box } = editing;
    const r = canvas.getBoundingClientRect();
    const px = fontPx(el) * view.scale;
    const lines = wrapLines(el, box.value);
    ctx.save();
    ctx.font = fontCss(el);
    const width = (el.boxWidth || Math.max(...lines.map(l => ctx.measureText(l).width), fontPx(el) * 0.5)) * view.scale;
    ctx.restore();
    box.style.whiteSpace = el.boxWidth ? 'pre-wrap' : 'pre';
    box.style.overflowWrap = el.boxWidth ? 'anywhere' : 'normal';
    Object.assign(box.style, {
      left: `${r.left + view.x + el.x * view.scale}px`,
      top: `${r.top + view.y + el.y * view.scale}px`,
      width: `${Math.ceil(width) + 2}px`,
      height: `${lines.length * px * 1.25}px`,
      fontSize: `${px}px`,
      fontFamily: FONTS[el.fontFamily] || FONTS.hand,
      textAlign: el.align || 'left',
      color: el.color,
      opacity: el.opacity ?? 1,
    });
    box.rows = lines.length;
  }

  function startText(wx, wy, existing, boxWidth = 0) {
    if (editing) editing.box.blur();
    const el = existing || newElement('text', { x: wx, y: wy, text: '' });
    if (!existing && boxWidth) el.boxWidth = boxWidth;
    const box = document.createElement('textarea');
    box.className = 'text-editor';
    box.value = el.text;
    box.spellcheck = false;
    document.body.appendChild(box);
    editing = { el, box, original: existing ? clone(existing) : null };
    setSelected(existing ? existing.id : null);
    styleEditor();
    render();
    box.focus();
    if (existing) box.select();
    emit('editing', el);

    let done = false;
    const commit = () => {
      if (done) return;
      done = true;
      const text = box.value.replace(/\s+$/, '');
      const session = editing;
      editing = null;
      box.remove();
      emit('editing', null);
      if (!existing) {
        if (text) { el.text = text; addElement(el); selectAfterDrawing(el); }
        return render();
      }
      if (!text) {
        Object.assign(el, session.original);
        return removeElement(el.id);
      }
      el.text = text;
      setSelected(el.id);
      render();
      if (JSON.stringify(el) !== JSON.stringify(session.original)) {
        record({ id: el.id, before: session.original, after: clone(el) });
        emit('update', el);
        emit('change');
      }
    };
    box.addEventListener('input', styleEditor);
    box.addEventListener('blur', commit);
    box.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
        e.preventDefault();
        box.blur();
      }
    });
  }

  function screenPoint(e) {
    const r = canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  function worldPoint(e) {
    const [sx, sy] = screenPoint(e);
    return [(sx - view.x) / view.scale, (sy - view.y) / view.scale];
  }

  const RESIZE_CURSOR = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', e: 'ew-resize', w: 'ew-resize' };
  const OPPOSITE = { nw: 'se', se: 'nw', ne: 'sw', sw: 'ne' };

  const touches = new Map();
  function pinchState() {
    const [a, b] = [...touches.values()];
    return { distance: Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] };
  }
  // two fingers pinch to zoom; a second finger cancels a half-drawn stroke
  function startPinch() {
    if (current && current.type) current = null;
    else if (current && !current.pinch) finish();
    const { distance, mid } = pinchState();
    current = { pinch: true, distance, mid, view: { ...view } };
    canvas.classList.remove('panning', 'moving');
    render();
  }
  function updatePinch() {
    const { distance, mid } = pinchState();
    const start = current.view;
    const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, start.scale * (distance / current.distance)));
    const worldX = (current.mid[0] - start.x) / start.scale, worldY = (current.mid[1] - start.y) / start.scale;
    setView({ scale, x: mid[0] - worldX * scale, y: mid[1] - worldY * scale });
  }

  canvas.addEventListener('pointerdown', e => {
    if (e.pointerType === 'touch') {
      // a new first finger starts fresh, in case an earlier touch never reported lifting
      if (e.isPrimary) {
        touches.clear();
        if (current && current.pinch) current = null;
      }
      touches.set(e.pointerId, screenPoint(e));
      if (touches.size === 2) return startPinch();
      if (touches.size > 2) return;
    }
    try { canvas.setPointerCapture(e.pointerId); } catch {}
    if (tool === 'hand' || spaceDown || e.button === 1) {
      current = { panning: true, from: screenPoint(e), origin: { ...view } };
      canvas.classList.add('panning');
      return;
    }
    const [x, y] = worldPoint(e);

    if (tool === 'select') {
      const handle = handleAt(x, y);
      if (handle === 'e' || handle === 'w') {
        const el = single();
        current = { textWidth: el, handle, startX: x, from: bounds(el), before: snapshot([el]), changed: false };
        return;
      }
      if (handle) {
        const el = single();
        current = { resizing: el, handle, from: bounds(el), original: clone(el),
                    anchor: corners(bounds(el))[OPPOSITE[handle]], changed: false };
        return;
      }
      const hit = topmostAt(x, y);
      const additive = e.shiftKey || e.ctrlKey || e.metaKey;
      if (!hit) {
        const base = additive ? [...selectedIds] : [];
        setSelected(base);
        current = { marquee: [x, y], to: [x, y], base };
        return render();
      }
      if (additive && selectedIds.has(hit.id)) {
        setSelected([...selectedIds].filter(id => id !== hit.id));
        return render();
      }
      if (additive) setSelected([...selectedIds, hit.id]);
      else if (!selectedIds.has(hit.id)) setSelected(hit.id);
      const moving = selectedList();
      moving.filter(el => el.type === 'frame').forEach(frame => {
        const f = bounds(frame);
        elements.forEach(el => {
          if (moving.includes(el) || el.type === 'frame') return;
          const b = bounds(el);
          if (b.x >= f.x && b.y >= f.y && b.x + b.width <= f.x + f.width && b.y + b.height <= f.y + f.height) moving.push(el);
        });
      });
      current = { moving, before: snapshot(moving), last: [x, y], moved: false };
      canvas.classList.add('moving');
      return render();
    }
    if (tool === 'laser') {
      current = { laser: true };
      addLaserPoint('me', '#ef4444', x, y, true);
      emit('laser', [x, y, true]);
      return;
    }
    if (tool === 'lasso') {
      const base = e.shiftKey || e.ctrlKey ? [...selectedIds] : [];
      setSelected(base);
      current = { lasso: [[x, y]], base };
      return render();
    }
    if (tool === 'bucket') {
      const hit = topmostAt(x, y);
      if (!hit) return;
      const before = snapshot([hit]);
      if (CLOSED.includes(hit.type)) hit.fill = style.fill || style.color;
      else if (hit.type !== 'image' && hit.type !== 'frame') hit.color = style.color;
      else return;
      recordUpdates(before, [hit]);
      render();
      emit('update', hit);
      emit('change');
      return;
    }
    if (tool === 'eraser') {
      current = { erasing: true };
      beginBatch();
      const hit = topmostAt(x, y);
      if (hit) removeElement(hit.id);
      return;
    }
    if (tool === 'text') {
      const hit = topmostAt(x, y);
      current = hit && hit.type === 'text' ? { editText: hit } : { textAt: [x, y], to: [x, y] };
      return;
    }

    if (tool === 'frame') {
      const count = elements.filter(el => el.type === 'frame').length;
      current = { id: newId(), type: 'frame', x, y, width: 0, height: 0, name: `Frame ${count + 1}` };
      return render();
    }
    current = tool === 'pen'
      ? newElement('pen', { points: [[x, y]] })
      : newElement(tool, { x, y, width: 0, height: 0 });
    render();
  });

  canvas.addEventListener('pointermove', e => {
    if (e.pointerType === 'touch' && touches.has(e.pointerId)) {
      touches.set(e.pointerId, screenPoint(e));
      if (current && current.pinch) { if (touches.size >= 2) updatePinch(); return; }
    }
    const [x, y] = worldPoint(e);
    pointer = [x, y];

    const now = performance.now();
    if (now - lastCursorSent > 50) { lastCursorSent = now; emit('cursor', [x, y]); }

    if (!current) {
      if (tool === 'select') {
        const handle = handleAt(x, y);
        canvas.style.cursor = handle ? RESIZE_CURSOR[handle] : (topmostAt(x, y) ? 'move' : '');
      }
      return;
    }
    if (current.panning) {
      const [sx, sy] = screenPoint(e);
      return setView({ ...view, x: current.origin.x + sx - current.from[0], y: current.origin.y + sy - current.from[1] });
    }
    if (current.textWidth) {
      const el = current.textWidth, { from } = current;
      const dx = x - current.startX;
      const min = fontPx(el);
      if (current.handle === 'e') {
        el.boxWidth = Math.max(min, from.width + dx);
      } else {
        el.boxWidth = Math.max(min, from.width - dx);
        el.x = from.x + from.width - el.boxWidth;
      }
      current.changed = true;
      return render();
    }
    if (current.resizing) {
      const [ax, ay] = current.anchor;
      const { from } = current;
      const min = 2 / view.scale;
      let w = Math.max(min, Math.abs(x - ax)), h = Math.max(min, Math.abs(y - ay));
      if ((e.shiftKey || ['text', 'image'].includes(current.original.type)) && from.width && from.height) {
        const k = Math.max(w / from.width, h / from.height);
        [w, h] = [from.width * k, from.height * k];
      }
      const to = { x: x < ax ? ax - w : ax, y: y < ay ? ay - h : ay, width: w, height: h };
      resizeInto(current.resizing, current.original, current.from, to);
      current.changed = true;
      return render();
    }
    if (current.textAt) {
      current.to = [x, y];
      return render();
    }
    if (current.laser) {
      addLaserPoint('me', '#ef4444', x, y, false);
      emit('laser', [x, y, false]);
      return;
    }
    if (current.lasso) {
      current.lasso.push([x, y]);
      const loop = current.lasso;
      const inside = loop.length < 3 ? [] : elements.filter(el => !el.locked).filter(el => {
        const points = el.type === 'pen' || el.type === 'line' || el.type === 'arrow' ? outline(el) : outline({ ...el, type: 'rectangle', ...bounds(el) });
        return points.every(point => insidePolygon(point, loop));
      }).map(el => el.id);
      setSelected([...new Set([...current.base, ...inside])]);
      return render();
    }
    if (current.marquee) {
      current.to = [x, y];
      const [ax, ay] = current.marquee;
      const area = { x: Math.min(ax, x), y: Math.min(ay, y), x2: Math.max(ax, x), y2: Math.max(ay, y) };
      const inside = elements.filter(el => !el.locked).filter(el => {
        const b = bounds(el);
        return b.x >= area.x && b.y >= area.y && b.x + b.width <= area.x2 && b.y + b.height <= area.y2;
      }).map(el => el.id);
      setSelected([...new Set([...current.base, ...inside])]);
      return render();
    }
    if (current.moving) {
      current.moving.forEach(el => translate(el, x - current.last[0], y - current.last[1]));
      current.last = [x, y];
      current.moved = true;
      return render();
    }
    if (current.erasing) {
      const hit = topmostAt(x, y);
      if (hit) removeElement(hit.id);
      return;
    }
    if (current.type === 'pen') {
      if (e.shiftKey) {
        if (current.shiftFrom === undefined) current.shiftFrom = current.points.length - 1;
        current.points.length = current.shiftFrom + 1;
        current.points.push([x, y]);
      } else {
        delete current.shiftFrom;
        const samples = e.pointerType !== 'touch' && e.getCoalescedEvents ? e.getCoalescedEvents() : [];
        const minGap = 0.75 / view.scale;
        (samples.length ? samples : [e]).forEach(sample => {
          const [px, py] = worldPoint(sample);
          const [lx, ly] = current.points[current.points.length - 1];
          if (Math.hypot(px - lx, py - ly) >= minGap) current.points.push([px, py]);
        });
      }
    } else {
      let w = x - current.x, h = y - current.y;
      if (e.shiftKey) [w, h] = constrain(current.type, w, h);
      current.width = w;
      current.height = h;
    }
    render();
  });

  function finish() {
    if (!current) return;
    if (current.pinch) { current = null; return render(); }
    const el = current;
    current = null;
    canvas.classList.remove('panning', 'moving');
    if (el.textAt) {
      const [ax, ay] = el.textAt, [bx, by] = el.to;
      const dragged = Math.abs(bx - ax) * view.scale > 8;
      return startText(Math.min(ax, bx), dragged ? Math.min(ay, by) : ay, null, dragged ? Math.abs(bx - ax) : 0);
    }
    if (el.editText) return startText(0, 0, el.editText);
    if (el.erasing) endBatch();
    if (el.panning || el.erasing || el.marquee || el.lasso || el.laser) return render();
    if (el.type === 'frame' && (Math.abs(el.width) < 4 || Math.abs(el.height) < 4)) return render();
    if (el.moving) {
      render();
      if (el.moved) {
        recordUpdates(el.before, el.moving);
        el.moving.forEach(moved => emit('update', moved));
        emit('change');
      }
      return;
    }
    if (el.resizing || el.textWidth) {
      render();
      if (el.changed) {
        const shape = el.resizing || el.textWidth;
        recordUpdates(el.resizing ? new Map([[shape.id, el.original]]) : el.before, [shape]);
        emit('update', shape);
        emit('change');
      }
      return;
    }
    delete el.shiftFrom;
    addElement(el);
    if (el.type !== 'pen') selectAfterDrawing(el);
  }

  // like Excalidraw: after a shape, switch to Select with it selected (the tool lock skips this)
  function selectAfterDrawing(el) {
    if (toolLocked) return;
    emit('toolchange', 'select');
    setSelected(el.id);
    render();
  }
  function release(e) {
    if (e.pointerType === 'touch') {
      touches.delete(e.pointerId);
      if (current && current.pinch) {
        if (!touches.size) { current = null; render(); }
        return;
      }
    }
    finish();
  }
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('contextmenu', e => {
    e.preventDefault();
    if (editing || (current && current.pinch)) return;
    const [x, y] = worldPoint(e);
    pointer = [x, y];
    const hit = topmostAt(x, y, true);
    if (!hit) setSelected(null);
    else if (!hit.locked && !selectedIds.has(hit.id)) setSelected(hit.id);
    render();
    emit('contextmenu', { clientX: e.clientX, clientY: e.clientY, locked: hit && hit.locked ? hit : null });
  });
  canvas.addEventListener('dblclick', e => {
    if (tool !== 'select') return;
    const [x, y] = worldPoint(e);
    const hit = topmostAt(x, y);
    if (hit && hit.type === 'text') startText(0, 0, hit);
    else if (hit && hit.type === 'frame') emit('frameRename', hit);
    else if (!hit) startText(x, y);
  });
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('lostpointercapture', e => {
    if (e.pointerType === 'touch') touches.delete(e.pointerId);
    finish();
  });
  canvas.addEventListener('pointerleave', () => { if (!current) canvas.style.cursor = ''; });
  window.addEventListener('blur', () => {
    spaceDown = false;
    canvas.classList.toggle('hand', tool === 'hand');
    canvas.classList.remove('panning', 'moving');
    if (current && !current.textAt && !current.editText) finish();
  });

  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const [sx, sy] = screenPoint(e);
    if (e.ctrlKey || e.metaKey) zoomAt(Math.exp(-e.deltaY * 0.01), sx, sy);
    else setView({ ...view, x: view.x - e.deltaX, y: view.y - e.deltaY });
  }, { passive: false });

  window.addEventListener('keydown', e => {
    if (e.code === 'Space' && !/^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(e.target.tagName)) {
      spaceDown = true;
      canvas.classList.add('hand');
    }
  });
  window.addEventListener('keyup', e => {
    if (e.code === 'Space') { spaceDown = false; canvas.classList.toggle('hand', tool === 'hand'); }
  });
  window.addEventListener('resize', () => { resize(); if (editing) styleEditor(); });

  return {
    resize,
    getElements: () => elements,
    getSelection: selected,
    getSelectedList: selectedList,
    isEmpty: () => elements.length === 0 && !(current && current.type),
    canUndo: () => history.length > 0,
    canRedo: () => future.length > 0,
    toScreen: (x, y) => [x * view.scale + view.x, y * view.scale + view.y],
    isContentVisible() {
      if (!elements.length) return true;
      const x0 = -view.x / view.scale, y0 = -view.y / view.scale;
      const x1 = x0 + canvas.clientWidth / view.scale, y1 = y0 + canvas.clientHeight / view.scale;
      return elements.some(el => {
        const b = bounds(el);
        return b.x <= x1 && b.x + b.width >= x0 && b.y <= y1 && b.y + b.height >= y0;
      });
    },
    on(name, fn) { listeners[name].push(fn); },

    setStyle(changes) {
      Object.assign(style, changes);
      const targets = editing ? [editing.el] : selectedList();
      const before = snapshot(targets);
      const changed = targets.filter(el => {
        const isText = el.type === 'text';
        const allowed = Object.keys(changes).filter(key =>
          (isText ? ['color', 'opacity', ...TEXT_KEYS].includes(key) : !TEXT_KEYS.includes(key)) &&
          !(key === 'fill' && !CLOSED.includes(el.type)) &&
          !(key === 'round' && !ROUNDABLE.includes(el.type)));
        allowed.forEach(key => {
          if ((key === 'fill' && !changes.fill) || (key === 'round' && !changes.round)) delete el[key];
          else el[key] = changes[key];
        });
        return allowed.length > 0;
      });
      if (!changed.length) return;
      if (editing) { styleEditor(); return; }
      recordUpdates(before, changed);
      render();
      changed.forEach(el => emit('update', el));
      emit('change');
    },
    editSelected() {
      const el = single();
      if (el && el.type === 'text') startText(0, 0, el);
    },
    getEditing: () => (editing ? editing.el : null),
    setToolLock(on) { toolLocked = on; },
    setTool(name) {
      tool = name;
      if (name !== 'select') setSelected(null);
      canvas.style.cursor = '';
      ['hand', 'eraser', 'select', 'text', 'laser', 'bucket', 'lasso'].forEach(t => canvas.classList.toggle(t, name === t));
      render();
    },
    setGrid(on) { showGrid = on; render(); },
    getBackground: () => background,
    setBackground(value) {
      background = value || '#ffffff';
      canvas.style.backgroundColor = background;
      canvas.classList.toggle('custom-bg', background.toLowerCase() !== '#ffffff');
    },

    zoomBy(factor) { zoomAt(factor, canvas.clientWidth / 2, canvas.clientHeight / 2, true); },
    zoomReset() { animateView({ x: 0, y: 0, scale: 1 }); },
    zoomToFit(maxScale = 1) {
      if (!elements.length) return this.zoomReset();
      const boxes = elements.map(bounds);
      const minX = Math.min(...boxes.map(b => b.x)), minY = Math.min(...boxes.map(b => b.y));
      const maxX = Math.max(...boxes.map(b => b.x + b.width)), maxY = Math.max(...boxes.map(b => b.y + b.height));
      const pad = 80;
      const fit = Math.min(
        (canvas.clientWidth - pad * 2) / Math.max(1, maxX - minX),
        (canvas.clientHeight - pad * 2) / Math.max(1, maxY - minY),
      );
      const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, maxScale, fit));
      animateView({
        scale,
        x: (canvas.clientWidth - (maxX - minX) * scale) / 2 - minX * scale,
        y: (canvas.clientHeight - (maxY - minY) * scale) / 2 - minY * scale,
      }, 320);
    },

    scrollToContent() {
      this.zoomToFit((viewAnimation ? viewAnimation.target : view).scale);
    },

    load(list) {
      elements = list || [];
      setSelected(null);
      current = null;
      history.length = 0;
      future.length = 0;
      render();
    },

    // small preview of a page for the "My boards" gallery
    thumbnail(list, bg, width = 360, height = 220) {
      const out = document.createElement('canvas');
      out.width = width; out.height = height;
      const octx = out.getContext('2d');
      octx.fillStyle = bg || '#ffffff';
      octx.fillRect(0, 0, width, height);
      if (!list.length) return out;
      const boxes = list.map(bounds);
      const minX = Math.min(...boxes.map(b => b.x)), minY = Math.min(...boxes.map(b => b.y));
      const w = Math.max(...boxes.map(b => b.x + b.width)) - minX || 1;
      const h = Math.max(...boxes.map(b => b.y + b.height)) - minY || 1;
      const scale = Math.min((width - 36) / w, (height - 36) / h, 1.2);
      octx.translate((width - w * scale) / 2 - minX * scale, (height - h * scale) / 2 - minY * scale);
      octx.scale(scale, scale);
      list.forEach(el => drawElement(octx, el));
      return out;
    },

    exportPng(filename) {
      if (!elements.length) return;
      const link = document.createElement('a');
      link.download = filename;
      link.href = renderToCanvas(elements).toDataURL('image/png');
      link.click();
    },

    selectionToBlob() {
      const list = selectedList();
      if (!list.length) return Promise.resolve(null);
      return new Promise(resolve => renderToCanvas(list).toBlob(resolve, 'image/png'));
    },

    getSelectionStyle() {
      const el = selected();
      if (!el) return null;
      const copied = { color: el.color, opacity: el.opacity ?? 1 };
      if (el.type === 'text') {
        Object.assign(copied, { fontFamily: el.fontFamily || 'hand', fontSize: fontPx(el), align: el.align || 'left' });
      } else {
        Object.assign(copied, { size: el.size || 2, strokeStyle: el.strokeStyle || 'solid', fill: el.fill || '', round: Boolean(el.round) });
      }
      return copied;
    },

    flipSelected(axis) {
      const list = selectedList();
      if (!list.length) return;
      const g = unionBox(list);
      const c = axis === 'x' ? g.x + g.width / 2 : g.y + g.height / 2;
      const before = snapshot(list);
      list.forEach(el => {
        if (el.type === 'pen') {
          el.points = el.points.map(([x, y]) => (axis === 'x' ? [2 * c - x, y] : [x, 2 * c - y]));
        } else if (el.type === 'line' || el.type === 'arrow') {
          if (axis === 'x') { el.x = 2 * c - el.x; el.width = -el.width; }
          else { el.y = 2 * c - el.y; el.height = -el.height; }
        } else {
          const b = bounds(el);
          if (axis === 'x') {
            el.x = 2 * c - (b.x + b.width);
            if (el.type !== 'text') { el.width = b.width; el.y = b.y; el.height = b.height; }
            if (el.type === 'image') el.flipX = !el.flipX;
          } else {
            el.y = 2 * c - (b.y + b.height);
            if (el.type !== 'text') { el.height = b.height; el.x = b.x; el.width = b.width; }
            if (el.type === 'image') el.flipY = !el.flipY;
          }
        }
      });
      recordUpdates(before, list);
      render();
      list.forEach(el => emit('update', el));
      emit('change');
    },

    lockSelected() {
      const list = selectedList();
      if (!list.length) return;
      const before = snapshot(list);
      list.forEach(el => { el.locked = true; });
      recordUpdates(before, list);
      setSelected(null);
      render();
      list.forEach(el => emit('update', el));
      emit('change');
    },
    unlock(id) {
      const el = elements.find(item => item.id === id);
      if (!el || !el.locked) return;
      const before = snapshot([el]);
      delete el.locked;
      recordUpdates(before, [el]);
      setSelected(el.id);
      render();
      emit('update', el);
      emit('change');
    },

    wrapSelectionInFrame() {
      const list = selectedList().filter(el => el.type !== 'frame');
      if (!list.length) return;
      const g = unionBox(list), pad = 24;
      const count = elements.filter(el => el.type === 'frame').length;
      const frame = { id: newId(), type: 'frame', x: g.x - pad, y: g.y - pad,
                      width: g.width + pad * 2, height: g.height + pad * 2, name: `Frame ${count + 1}` };
      addElement(frame);
      setSelected(frame.id);
      render();
    },

    undo() {
      const step = history.pop();
      if (!step) return;
      applyStep(step, true);
      future.push(step);
    },
    redo() {
      const step = future.pop();
      if (!step) return;
      applyStep(step, false);
      history.push(step);
    },
    selectAll() { setSelected(elements.filter(el => !el.locked).map(el => el.id)); render(); },

    pointAt(clientX, clientY) {
      const r = canvas.getBoundingClientRect();
      pointer = [(clientX - r.left - view.x) / view.scale, (clientY - r.top - view.y) / view.scale];
    },

    insertImage(src, width, height, atPointer) {
      const scale = Math.min(1, 480 / Math.max(width, height));
      const w = width * scale, h = height * scale;
      const [cx, cy] = atPointer ? pointer
        : [(canvas.clientWidth / 2 - view.x) / view.scale, (canvas.clientHeight / 2 - view.y) / view.scale];
      const el = { id: newId(), type: 'image', src, x: cx - w / 2, y: cy - h / 2, width: w, height: h, opacity: 1 };
      addElement(el);
      setSelected(el.id);
      render();
    },

    renameFrame(id, name) {
      const frame = elements.find(el => el.id === id && el.type === 'frame');
      if (!frame || !name) return;
      const before = snapshot([frame]);
      frame.name = name;
      recordUpdates(before, [frame]);
      render();
      emit('update', frame);
      emit('change');
    },

    showRemoteLaser(who, color, x, y, start) { addLaserPoint(who, color, x, y, start); },
    clearSelection() { setSelected(null); render(); },

    copySelection: () => selectedList().map(clone),

    pasteElements(list, atPointer) {
      if (!Array.isArray(list) || !list.length) return;
      const copies = list.filter(el => el && el.type).map(el => ({ ...clone(el), id: newId() }));
      const box = unionBox(copies);
      const [dx, dy] = atPointer ? [pointer[0] - box.x - box.width / 2, pointer[1] - box.y - box.height / 2] : [16, 16];
      inBatch(() => copies.forEach(el => { translate(el, dx, dy); addElement(el); }));
      setSelected(copies.map(el => el.id));
      render();
    },
    pasteText(text) {
      const el = newElement('text', { x: pointer[0], y: pointer[1], text: text.replace(/\s+$/, '') });
      if (!el.text) return;
      addElement(el);
      setSelected(el.id);
      render();
    },

    duplicateSelected() {
      const list = selectedList();
      if (!list.length) return;
      const copies = list.map(el => ({ ...clone(el), id: newId() }));
      inBatch(() => copies.forEach(el => { translate(el, 16, 16); addElement(el); }));
      setSelected(copies.map(el => el.id));
      render();
    },
    deleteSelected() { inBatch(() => [...selectedIds].forEach(removeElement)); },
    nudgeSelected(dx, dy) {
      const list = selectedList();
      if (!list.length) return;
      const before = snapshot(list);
      list.forEach(el => translate(el, dx, dy));
      recordUpdates(before, list);
      render();
      list.forEach(el => emit('update', el));
      emit('change');
    },
    reorderSelected(where) {
      if (!selectedIds.size) return;
      const orderBefore = elements.map(el => el.id);
      const isSel = el => selectedIds.has(el.id);
      if (where === 'back') elements = [...elements.filter(isSel), ...elements.filter(el => !isSel(el))];
      else if (where === 'front') elements = [...elements.filter(el => !isSel(el)), ...elements.filter(isSel)];
      else if (where === 'backward') {
        for (let i = 1; i < elements.length; i++) {
          if (isSel(elements[i]) && !isSel(elements[i - 1])) [elements[i - 1], elements[i]] = [elements[i], elements[i - 1]];
        }
      } else if (where === 'forward') {
        for (let i = elements.length - 2; i >= 0; i--) {
          if (isSel(elements[i]) && !isSel(elements[i + 1])) [elements[i], elements[i + 1]] = [elements[i + 1], elements[i]];
        }
      }
      const orderAfter = elements.map(el => el.id);
      if (orderAfter.join() !== orderBefore.join()) record({ order: { before: orderBefore, after: orderAfter } });
      render();
      emit('order', orderAfter);
      emit('change');
    },
    clear() {
      inBatch(() => elements.forEach((el, index) => record({ id: el.id, before: clone(el), after: null, index })));
      elements = [];
      setSelected(null);
      render();
      emit('clear');
      emit('change');
    },

    applyRemote(event) {
      if (event.type === 'add') elements.push(event.element);
      else if (event.type === 'update') elements = elements.map(el => (el.id === event.element.id ? event.element : el));
      else if (event.type === 'remove') elements = elements.filter(el => el.id !== event.id);
      else if (event.type === 'clear') elements = [];
      else if (event.type === 'order' && Array.isArray(event.ids)) {
        const rank = new Map(event.ids.map((id, i) => [id, i]));
        elements.sort((a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity));
      } else return;
      const alive = new Set(elements.map(el => el.id));
      if ([...selectedIds].some(id => !alive.has(id))) setSelected([...selectedIds].filter(id => alive.has(id)));
      render();
      emit('change');
    },
  };
})();
