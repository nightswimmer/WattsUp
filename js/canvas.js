/* WattsUp — top-view canvas: packs to scale (mm), draggable, pannable, zoomable. */
"use strict";

const TopView = (() => {
  let canvas = null, ctx = null;
  let packs = [];          // [{pack, metrics, color}]
  let view = { scale: 2, ox: 40, oy: 40 };   // world mm → screen px: px = mm*scale + o
  let drag = null;         // {type:"pan"|"pack", ...}
  let positions = {};      // packId → {x, y} in mm (persisted by app.js)
  let onPositionsChange = null;
  let cssColors = {};

  const MAX_DRAWN_CELLS = 4000;

  function init(canvasEl, positionsChangedCb) {
    canvas = canvasEl;
    ctx = canvas.getContext("2d");
    onPositionsChange = positionsChangedCb;

    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    new ResizeObserver(() => { resize(); draw(); }).observe(canvas.parentElement);
    resize();
  }

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.parentElement.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    canvas.style.width = rect.width + "px";
    canvas.style.height = rect.height + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function readCssColors() {
    const cs = getComputedStyle(document.body);
    cssColors = {
      surface: cs.getPropertyValue("--surface-1").trim() || "#fcfcfb",
      grid: cs.getPropertyValue("--grid-line").trim() || "#e1e0d9",
      ink: cs.getPropertyValue("--text-primary").trim() || "#0b0b0b",
      muted: cs.getPropertyValue("--text-muted").trim() || "#898781"
    };
  }

  /** Update the pack set. Auto-places new packs to the right of existing ones. */
  function setPacks(list, savedPositions) {
    packs = list;
    positions = savedPositions || positions;
    let cursorX = 20;
    for (const item of packs) {
      const geo = item.metrics.geo;
      if (!geo) continue;
      if (!positions[item.pack.id]) {
        positions[item.pack.id] = { x: cursorX, y: 20 };
        cursorX += geo.width + 40;
      } else {
        cursorX = Math.max(cursorX, positions[item.pack.id].x + geo.width + 40);
      }
    }
    draw();
  }

  function fit() {
    const drawable = packs.filter(p => p.metrics.geo);
    if (drawable.length === 0) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const item of drawable) {
      const pos = positions[item.pack.id];
      const geo = item.metrics.geo;
      minX = Math.min(minX, pos.x); minY = Math.min(minY, pos.y);
      maxX = Math.max(maxX, pos.x + geo.width); maxY = Math.max(maxY, pos.y + geo.length);
    }
    const rect = canvas.getBoundingClientRect();
    const margin = 60;
    const scale = Math.min(
      (rect.width - 2 * margin) / Math.max(1, maxX - minX),
      (rect.height - 2 * margin) / Math.max(1, maxY - minY)
    );
    view.scale = Math.max(0.05, Math.min(20, scale));
    view.ox = margin - minX * view.scale + (rect.width - 2 * margin - (maxX - minX) * view.scale) / 2;
    view.oy = margin - minY * view.scale;
    draw();
  }

  /* ---- coordinate helpers ---- */
  const toScreenX = mm => mm * view.scale + view.ox;
  const toScreenY = mm => mm * view.scale + view.oy;
  const toWorldX = px => (px - view.ox) / view.scale;
  const toWorldY = px => (px - view.oy) / view.scale;

  function packAt(wx, wy) {
    for (let i = packs.length - 1; i >= 0; i--) {
      const item = packs[i];
      const geo = item.metrics.geo;
      if (!geo) continue;
      const pos = positions[item.pack.id];
      if (wx >= pos.x && wx <= pos.x + geo.width && wy >= pos.y && wy <= pos.y + geo.length) return item;
    }
    return null;
  }

  /* ---- interaction ---- */
  function localXY(ev) {
    const r = canvas.getBoundingClientRect();
    return [ev.clientX - r.left, ev.clientY - r.top];
  }

  function onDown(ev) {
    const [px, py] = localXY(ev);
    const hit = packAt(toWorldX(px), toWorldY(py));
    if (hit) {
      const pos = positions[hit.pack.id];
      drag = { type: "pack", item: hit, dx: toWorldX(px) - pos.x, dy: toWorldY(py) - pos.y };
    } else {
      drag = { type: "pan", startX: px, startY: py, ox: view.ox, oy: view.oy };
    }
    canvas.setPointerCapture(ev.pointerId);
  }

  function onMove(ev) {
    const [px, py] = localXY(ev);
    if (!drag) {
      canvas.style.cursor = packAt(toWorldX(px), toWorldY(py)) ? "grab" : "default";
      return;
    }
    if (drag.type === "pan") {
      view.ox = drag.ox + (px - drag.startX);
      view.oy = drag.oy + (py - drag.startY);
    } else {
      const pos = positions[drag.item.pack.id];
      pos.x = toWorldX(px) - drag.dx;
      pos.y = toWorldY(py) - drag.dy;
    }
    draw();
  }

  function onUp() {
    if (drag && drag.type === "pack" && onPositionsChange) onPositionsChange(positions);
    drag = null;
  }

  function onWheel(ev) {
    ev.preventDefault();
    const [px, py] = localXY(ev);
    const factor = ev.deltaY < 0 ? 1.15 : 1 / 1.15;
    const newScale = Math.max(0.05, Math.min(20, view.scale * factor));
    // zoom about the cursor
    view.ox = px - (px - view.ox) * (newScale / view.scale);
    view.oy = py - (py - view.oy) * (newScale / view.scale);
    view.scale = newScale;
    draw();
  }

  /* ---- drawing ---- */
  function draw() {
    if (!ctx) return;
    readCssColors();
    const rect = canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);

    drawGrid(rect);

    for (const item of packs) {
      const geo = item.metrics.geo;
      if (!geo) continue;
      drawPack(item, positions[item.pack.id], geo);
    }
    drawScaleBar(rect);
  }

  function drawGrid(rect) {
    // adaptive grid: 10 / 50 / 100 mm depending on zoom
    let step = 100;
    if (view.scale > 4) step = 10; else if (view.scale > 0.8) step = 50;
    const sPx = step * view.scale;
    if (sPx < 8) return;
    ctx.strokeStyle = cssColors.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = view.ox % sPx; x < rect.width; x += sPx) {
      ctx.moveTo(x, 0); ctx.lineTo(x, rect.height);
    }
    for (let y = view.oy % sPx; y < rect.height; y += sPx) {
      ctx.moveTo(0, y); ctx.lineTo(rect.width, y);
    }
    ctx.stroke();
  }

  function drawPack(item, pos, geo) {
    const { pack, color } = item;
    const x = toScreenX(pos.x), y = toScreenY(pos.y);
    const w = geo.width * view.scale, l = geo.length * view.scale;
    const gap = CELL_SPACING_MM;

    // pack outline
    ctx.fillStyle = color + "14";  // ~8% alpha wash
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(x, y, w, l, 4);
    ctx.fill();
    ctx.stroke();

    // cells
    const nCells = pack.s * pack.p;
    if (nCells <= MAX_DRAWN_CELLS && geo.cellW * view.scale > 2.5) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      for (let row = 0; row < pack.s; row++) {
        for (let col = 0; col < pack.p; col++) {
          const cx = pos.x + gap + col * (geo.cellW + gap);
          const cy = pos.y + gap + row * (geo.cellL + gap);
          if (geo.shape === "cyl") {
            const r = (geo.cellW / 2) * view.scale;
            ctx.beginPath();
            ctx.arc(toScreenX(cx + geo.cellW / 2), toScreenY(cy + geo.cellL / 2), r, 0, Math.PI * 2);
            ctx.stroke();
            // polarity dot on first row (series direction hint)
            if (r > 6 && row === 0) {
              ctx.beginPath();
              ctx.arc(toScreenX(cx + geo.cellW / 2), toScreenY(cy + geo.cellL / 2), r * 0.25, 0, Math.PI * 2);
              ctx.fillStyle = color;
              ctx.fill();
            }
          } else {
            ctx.strokeRect(toScreenX(cx), toScreenY(cy), geo.cellW * view.scale, geo.cellL * view.scale);
          }
        }
      }
    }

    // name + dimensions (text tokens, not series color), centered, ellipsized to pack width
    const maxTextW = Math.max(50, w + 24);
    const ellipsize = (text) => {
      if (ctx.measureText(text).width <= maxTextW) return text;
      while (text.length > 1 && ctx.measureText(text + "…").width > maxTextW) text = text.slice(0, -1);
      return text + "…";
    };
    ctx.textAlign = "center";
    ctx.fillStyle = cssColors.ink;
    ctx.font = "600 13px system-ui, sans-serif";
    ctx.fillText(ellipsize(`${pack.name} (${pack.s}S${pack.p}P)`), x + w / 2, y - 22);
    const dims = `${fmt(geo.width, 0)} × ${fmt(geo.length, 0)} × ${fmt(geo.height, 0)} mm`;
    ctx.fillStyle = cssColors.muted;
    ctx.font = "12px system-ui, sans-serif";
    if (ctx.measureText(dims).width <= maxTextW) ctx.fillText(dims, x + w / 2, y - 7);
    ctx.textAlign = "left";
  }

  function drawScaleBar(rect) {
    // pick a nice length ≈ 120px
    const targetMm = 120 / view.scale;
    const mag = Math.pow(10, Math.floor(Math.log10(targetMm)));
    const nice = [1, 2, 5, 10].map(m => m * mag).reduce((a, b) =>
      Math.abs(b * view.scale - 120) < Math.abs(a * view.scale - 120) ? b : a);
    const px = nice * view.scale;
    const x = 16, y = rect.height - 20;
    ctx.strokeStyle = cssColors.ink;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y); ctx.lineTo(x + px, y);
    ctx.moveTo(x, y - 5); ctx.lineTo(x, y + 5);
    ctx.moveTo(x + px, y - 5); ctx.lineTo(x + px, y + 5);
    ctx.stroke();
    ctx.fillStyle = cssColors.muted;
    ctx.font = "12px system-ui, sans-serif";
    ctx.fillText(nice >= 1000 ? `${nice / 1000} m` : `${nice} mm`, x + px + 8, y + 4);
  }

  return { init, setPacks, fit, draw };
})();
