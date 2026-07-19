/* WattsUp — Pack Connections: nickel-strip interconnect calculator + diagram. */
"use strict";

/**
 * StripPlanner renders the "Pack Connections" tab: inputs for the strip
 * material / geometry, an SVG diagram of two parallel groups joined in
 * series (the repeating unit of the pack), per-bridge currents colored by
 * how close they run to the recommended limit, and a results summary.
 *
 * API (used by app.js):
 *   init({ onChange })  — wire inputs; call once after DOM is ready
 *   getState()          — settings object for persistence
 *   setState(obj|null)  — apply persisted settings (merged over defaults)
 *   setPacks(list)      — populate the "load from pack" dropdown
 *   render()            — recompute + redraw
 */
const StripPlanner = (() => {
  const DEFAULTS = {
    material: "pure-nickel",
    resistivity: STRIP_MATERIALS["pure-nickel"].resistivity, // Ω·mm²/m
    maxDensity: STRIP_MATERIALS["pure-nickel"].maxDensity,   // A/mm²
    thickness: 0.15,  // mm
    layers: 1,
    widthPar: 8,      // mm — bridges between cells of the same P group
    widthSer: 8,      // mm — bridges between the two P groups
    s: 2,
    p: 4,
    current: 30,      // A — max current demanded by the full pack
    pitch: 20.6,      // mm — distance between adjacent cell centers
    gap: 20.6,        // mm — series-bridge length (row-to-row distance)
    outputs: []       // B-side midpoint indices marked as pack output points
  };

  /* Utilization ramp: fraction of the recommended limit → status color.
     Numbers are always printed next to every bridge, so color is a
     redundant encoding, never the only one. */
  const UTIL_STOPS = {
    light: [[0.50, "#0a8a0a"], [0.75, "#c98500"], [0.90, "#e06c1e"], [1.00, "#d03b3b"]],
    dark:  [[0.50, "#4bcf4b"], [0.75, "#d9a514"], [0.90, "#e8823a"], [1.00, "#e66767"]]
  };

  let settings = { ...DEFAULTS, outputs: [] };   // clone the array — never mutate DEFAULTS
  let packs = [];        // [{id, name, s, p, current, pitch}]
  let onChange = null;
  let els = null;

  const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
  const mode = () => (darkQuery.matches ? "dark" : "light");
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  /* ---------- colors ---------- */
  function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function mixHex(h1, h2, t) {
    const a = hexToRgb(h1), b = hexToRgb(h2);
    const c = a.map((v, i) => Math.round(v + (b[i] - v) * t));
    return `rgb(${c[0]},${c[1]},${c[2]})`;
  }
  // Color for a utilization u (0…1 = share of the recommended limit).
  function utilColor(u) {
    const stops = UTIL_STOPS[mode()];
    if (u <= stops[0][0]) return stops[0][1];
    for (let i = 1; i < stops.length; i++) {
      if (u <= stops[i][0]) {
        const t = (u - stops[i - 1][0]) / (stops[i][0] - stops[i - 1][0]);
        return mixHex(stops[i - 1][1], stops[i][1], t);
      }
    }
    return stops[stops.length - 1][1];
  }

  /* ---------- settings <-> inputs ---------- */
  const FIELDS = [
    ["resistivity", "c-resistivity"],
    ["maxDensity", "c-density"],
    ["thickness", "c-thickness"],
    ["layers", "c-layers"],
    ["widthPar", "c-width-par"],
    ["widthSer", "c-width-ser"],
    ["s", "c-s"],
    ["p", "c-p"],
    ["current", "c-current"],
    ["pitch", "c-pitch"],
    ["gap", "c-gap"]
  ];

  function writeInputs() {
    els.material.value = settings.material;
    for (const [key, id] of FIELDS) document.getElementById(id).value = settings[key];
    els.materialNote.textContent = STRIP_MATERIALS[settings.material]?.notes || "";
  }

  function readInputs() {
    settings.material = els.material.value;
    for (const [key, id] of FIELDS) {
      const v = parseFloat(document.getElementById(id).value);
      if (Number.isFinite(v)) settings[key] = v;
    }
    // sanity clamps — keep the solver and the drawing well-behaved
    settings.layers = clamp(Math.round(settings.layers), 1, 4);
    settings.s = clamp(Math.round(settings.s), 2, 500);
    settings.p = clamp(Math.round(settings.p), 1, 100);
    settings.thickness = clamp(settings.thickness, 0.01, 5);
    settings.widthPar = clamp(settings.widthPar, 0.5, 100);
    settings.widthSer = clamp(settings.widthSer, 0.5, 100);
    settings.pitch = clamp(settings.pitch, 5, 200);
    settings.gap = clamp(settings.gap, 2, 200);
    settings.current = clamp(settings.current, 0, 100000);
    settings.resistivity = clamp(settings.resistivity, 0.001, 10);
    settings.maxDensity = clamp(settings.maxDensity, 0.1, 1000);
    settings.outputs = settings.outputs.filter(i => i < settings.p - 1);  // P may have shrunk
  }

  /* ---------- derived electrical model ---------- */
  function compute() {
    const s = settings;
    const areaPar = s.widthPar * s.thickness * s.layers;   // mm²
    const areaSer = s.widthSer * s.thickness * s.layers;   // mm²
    const rHalf = s.resistivity * (s.pitch / 2 / 1000) / areaPar;  // Ω
    const rBridge = s.resistivity * (s.gap / 1000) / areaSer;      // Ω
    const iLimPar = s.maxDensity * areaPar;   // A
    const iLimSer = s.maxDensity * areaSer;   // A

    // The interconnect junction is independent of the output taps: with
    // balanced cells each B cell always takes its I/P share. The output
    // collector strip (B group's far terminal) is a separate solve.
    const net = solveStripNetwork({ p: s.p, current: s.current, rHalf, rBridge });
    const outNet = solveOutputStrip({ p: s.p, current: s.current, rHalf, taps: s.outputs });
    const worstSeg = net.segA.concat(net.segB).reduce((m, i) => Math.max(m, Math.abs(i)), 0);
    const worstBridge = net.bridges.reduce((m, i) => Math.max(m, Math.abs(i)), 0);
    const worstOut = outNet ? outNet.seg.reduce((m, i) => Math.max(m, Math.abs(i)), 0) : 0;

    return {
      areaPar, areaSer, iLimPar, iLimSer, net, outNet, worstSeg, worstBridge, worstOut,
      outputsActive: !!outNet,
      utilPar: iLimPar > 0 ? worstSeg / iLimPar : 0,
      utilSer: iLimSer > 0 ? worstBridge / iLimSer : 0,
      utilOut: iLimPar > 0 ? worstOut / iLimPar : 0,   // same strip width as the group bridges
      junctions: s.s - 1
    };
  }

  /* ---------- SVG diagram ---------- */
  const SVG_NS = "http://www.w3.org/2000/svg";
  function el(tag, attrs = {}) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    return node;
  }
  function svgText(x, y, str, cls, anchor = "middle") {
    const t = el("text", { x, y, class: cls, "text-anchor": anchor });
    t.textContent = str;
    return t;
  }
  function withTitle(node, str) {
    const t = el("title");
    t.textContent = str;
    node.appendChild(t);
    return node;
  }

  function ampLabel(i, lim) {
    return `${fmt(Math.abs(i), Math.abs(i) < 10 ? 1 : 0)} A${Math.abs(i) > lim ? " ⚠" : ""}`;
  }
  function tooltip(kind, i, lim) {
    const pct = lim > 0 ? (Math.abs(i) / lim) * 100 : 0;
    return `${kind}: ${fmt(Math.abs(i), 2)} A of ${fmt(lim, 1)} A recommended (${fmt(pct, 0)} %)`;
  }

  /* ---------- current-flow particles ---------- */
  let anim = null;   // { items: [{el, x1, y1, dx, dy, len, speed, phase}], raf }
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  function stopFlow() {
    if (anim?.raf) cancelAnimationFrame(anim.raf);
    anim = null;
  }

  // Particles along one edge. Count and color scale with utilization (share of
  // the recommended limit); travel direction follows the sign of the current.
  function addFlow(svg, items, x1, y1, x2, y2, current, limit) {
    const a = Math.abs(current);
    if (a < 0.005 || limit <= 0 || items.length > 900) return;
    if (current < 0) { let t = x1; x1 = x2; x2 = t; t = y1; y1 = y2; y2 = t; }
    const u = a / limit;
    const len = Math.hypot(x2 - x1, y2 - y1);
    const density = settings.p > 30 ? 0.5 : 1;   // keep huge packs light
    const n = Math.max(1, Math.round((len / 100) * (1 + 6 * Math.min(u, 1.15)) * density));
    const color = utilColor(u);
    const speed = 22 + 55 * Math.min(u, 1.2);    // px/s
    for (let k = 0; k < n; k++) {
      const c = el("circle", { r: 3, fill: color, class: "strip-particle" });
      svg.appendChild(c);
      items.push({ el: c, x1, y1, dx: x2 - x1, dy: y2 - y1, len, speed, phase: k / n });
    }
  }

  function placeFlow(tSec) {
    for (const it of anim.items) {
      const u = (it.phase + (tSec * it.speed) / it.len) % 1;
      it.el.setAttribute("cx", it.x1 + it.dx * u);
      it.el.setAttribute("cy", it.y1 + it.dy * u);
    }
  }

  function startFlow(items) {
    stopFlow();
    if (!items.length) return;
    anim = { items, raf: 0 };
    placeFlow(0);                        // evenly spaced starting positions
    if (reducedMotion.matches) return;   // static particles still show amount + color
    const t0 = performance.now();
    const tick = now => {
      if (!anim) return;
      if (els.diagram.offsetParent !== null) placeFlow((now - t0) / 1000);  // skip work while the tab is hidden
      anim.raf = requestAnimationFrame(tick);
    };
    anim.raf = requestAnimationFrame(tick);
  }

  function drawDiagram(res) {
    stopFlow();
    const host = els.diagram;
    host.textContent = "";

    const p = settings.p;
    // Square cell grid: horizontal pitch = vertical row distance, as in a real pack.
    const PITCH = 164, R = 24, M = 72;
    const yA = 96, yB = 260, yO = 360;            // yO: output collector strip, under the B cells
    const H = p > 1 ? 440 : 340;
    const ghost = res.outputsActive ? 1 : 0.3;    // output strip is ghosted until a tap is set
    const hPar = clamp(settings.widthPar * 2.4, 10, 36);   // strip visual thickness, px
    const wSer = clamp(settings.widthSer * 2.4, 10, 36);   // bridge visual width, px
    const W = Math.max(2 * M + (p - 1) * PITCH, 300);
    const cellX = i => (p === 1 ? W / 2 : M + i * PITCH);

    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: "strip-svg" });
    const bridgeXs = p === 1 ? [cellX(0)] : Array.from({ length: p - 1 }, (_, i) => cellX(i) + PITCH / 2);
    const flow = [];   // particle animation items, filled by addFlow

    // cells first — the strips lie on top of them
    for (let i = 0; i < p; i++) {
      for (const y of [yA, yB]) {
        svg.appendChild(el("circle", { cx: cellX(i), cy: y, r: R, class: "strip-cell" }));
      }
    }
    // each B cell's body silhouette — two side lines from the B row down to
    // its bottom face on the output collector strip
    if (p > 1) {
      for (let i = 0; i < p; i++) {
        for (const dx of [-R, R]) {
          svg.appendChild(el("line", {
            x1: cellX(i) + dx, y1: yB, x2: cellX(i) + dx, y2: yO,
            class: "strip-cell-side", opacity: ghost
          }));
        }
      }
    }

    // continuous metal: series bridges, then the two bus strips over them
    for (const x of bridgeXs) {
      svg.appendChild(el("rect", {
        x: x - wSer / 2, y: yA, width: wSer, height: yB - yA,
        rx: Math.min(6, wSer / 3), class: "strip-metal"
      }));
    }
    if (p > 1) {
      for (const y of [yA, yB]) {
        svg.appendChild(el("rect", {
          x: cellX(0) - R - 8, y: y - hPar / 2, width: cellX(p - 1) - cellX(0) + 2 * (R + 8),
          height: hPar, rx: 6, class: "strip-metal"
        }));
      }
      // output collector strip — the B cells' far terminal, where the pack cable taps
      svg.appendChild(el("rect", {
        x: cellX(0) - R - 8, y: yO - hPar / 2, width: cellX(p - 1) - cellX(0) + 2 * (R + 8),
        height: hPar, rx: 6, class: "strip-metal", opacity: ghost
      }));
      // the cells' bottom faces sit on top of the collector strip
      for (let i = 0; i < p; i++) {
        svg.appendChild(el("circle", { cx: cellX(i), cy: yO, r: R, class: "strip-cell", opacity: ghost }));
      }
    }

    // weld slots — cut-outs in the strip revealing the cell underneath
    const termStroke = mode() === "dark" ? "rgba(255,255,255,0.7)" : "rgba(0,0,0,0.55)";
    for (let i = 0; i < p; i++) {
      for (const y of [yA, yB]) {
        svg.appendChild(el("rect", {
          x: cellX(i) - 13, y: y - 3.5, width: 26, height: 7, rx: 3.5,
          class: "strip-slot", stroke: termStroke, "stroke-width": 1.5
        }));
      }
    }

    // current flow: moving particles + amp labels (labels keep the ⚠ / tooltips)
    res.net.bridges.forEach((iBr, i) => {
      const x = bridgeXs[i];
      addFlow(svg, flow, x, yA + hPar / 2 + 3, x, yB - hPar / 2 - 3, iBr, res.iLimSer);
      svg.appendChild(withTitle(
        svgText(x + wSer / 2 + 6, (yA + yB) / 2 + 4, ampLabel(iBr, res.iLimSer), "strip-amp", "start"),
        tooltip("Series bridge", iBr, res.iLimSer)));
    });
    if (p > 1) {
      // amp labels sit next to the cell each half-segment leaves/enters,
      // keeping the junction (bridge/tap) area clear
      const halves = [[res.net.segA, yA], [res.net.segB, yB]];
      for (const [seg, y] of halves) {
        for (let i = 0; i < p - 1; i++) {
          const xL = cellX(i), xMid = xL + PITCH / 2, xR = cellX(i + 1);
          const pieces = [[xL, xMid, seg[2 * i]], [xMid, xR, seg[2 * i + 1]]];
          pieces.forEach(([x1, x2, iSeg], k) => {
            addFlow(svg, flow, x1, y, x2, y, iSeg, res.iLimPar);
            svg.appendChild(withTitle(
              svgText(k === 0 ? xL + R + 6 : xR - R - 6, y - hPar / 2 - 7,
                ampLabel(iSeg, res.iLimPar), "strip-amp", k === 0 ? "start" : "end"),
              tooltip("Group bridge", iSeg, res.iLimPar)));
          });
        }
      }
      // output collector strip currents (cells → taps); labels above the strip,
      // leaving the space below free for the tap arrows
      if (res.outNet) {
        for (let i = 0; i < p - 1; i++) {
          const xL = cellX(i), xMid = xL + PITCH / 2, xR = cellX(i + 1);
          const pieces = [[xL, xMid, res.outNet.seg[2 * i]], [xMid, xR, res.outNet.seg[2 * i + 1]]];
          pieces.forEach(([x1, x2, iSeg], k) => {
            addFlow(svg, flow, x1, yO, x2, yO, iSeg, res.iLimPar);
            svg.appendChild(withTitle(
              svgText(k === 0 ? xL + R + 6 : xR - R - 6, yO - hPar / 2 - 7,
                ampLabel(iSeg, res.iLimPar), "strip-amp", k === 0 ? "start" : "end"),
              tooltip("Output strip", iSeg, res.iLimPar)));
          });
        }
      }
    }

    // cell labels — A above its circle, B centered on the cell body between its two faces
    for (let i = 0; i < p; i++) {
      svg.appendChild(svgText(cellX(i), yA - R - 14, `A${i + 1}`, "strip-cell-label"));
      svg.appendChild(svgText(cellX(i), p > 1 ? (yB + yO) / 2 + 4 : yB + R + 18, `B${i + 1}`, "strip-cell-label"));
    }

    // clickable cable taps on the output collector strip
    if (p > 1) {
      bridgeXs.forEach((x, i) => {
        const selected = settings.outputs.includes(i);
        const g = el("g", {
          class: "strip-out" + (selected ? " selected" : ""),
          tabindex: 0, role: "button", "aria-pressed": selected,
          "aria-label": `Pack output tap ${i + 1} of ${p - 1}`
        });
        g.appendChild(el("circle", { cx: x, cy: yO, r: 9, class: "strip-out-ring" }));
        if (selected) g.appendChild(el("circle", { cx: x, cy: yO, r: 3.4, class: "strip-out-dot" }));
        const iOut = res.outNet ? res.outNet.outAt[i] : null;
        withTitle(g, selected
          ? `Pack output tap — ${fmt(Math.abs(iOut), 2)} A leaves here. Click to unset.`
          : "Click to tap the pack's output cable here");
        g.addEventListener("click", () => toggleOutput(i));
        g.addEventListener("keydown", ev => {
          if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); toggleOutput(i); }
        });
        svg.appendChild(g);

        if (selected && iOut !== null) {
          // arrow pointing down out of the tap, current value below it
          const yE = yO + hPar / 2;
          svg.appendChild(el("rect", {
            x: x - 1.5, y: yE + 4, width: 3, height: 13, class: "strip-out-arrow"
          }));
          svg.appendChild(el("polygon", {
            points: `${x - 6},${yE + 17} ${x + 6},${yE + 17} ${x},${yE + 27}`,
            class: "strip-out-arrow"
          }));
          svg.appendChild(svgText(x, yE + 42, `${fmt(Math.abs(iOut), Math.abs(iOut) < 10 ? 1 : 0)} A`, "strip-out-label"));
        }
      });
    }

    host.appendChild(svg);
    startFlow(flow);
  }

  function toggleOutput(i) {
    const at = settings.outputs.indexOf(i);
    if (at >= 0) settings.outputs.splice(at, 1);
    else settings.outputs.push(i);
    render();
    onChange?.();
  }

  /* ---------- legend ---------- */
  function renderLegend() {
    const host = els.legend;
    host.textContent = "";
    const MAX = 1.15;                    // bar spans 0 … 115 % of the limit
    const samples = [];
    for (let i = 0; i <= 24; i++) samples.push(utilColor((i / 24) * MAX));
    const bar = document.createElement("div");
    bar.className = "util-bar";
    bar.style.background = `linear-gradient(90deg, ${samples.join(",")})`;
    const ticks = document.createElement("div");
    ticks.className = "util-ticks";
    for (const pct of [0, 50, 75, 90, 100]) {
      const t = document.createElement("span");
      t.style.left = `${(pct / 100 / MAX) * 100}%`;
      t.textContent = `${pct}%`;
      ticks.appendChild(t);
    }
    const cap = document.createElement("span");
    cap.className = "util-caption";
    cap.textContent = "Moving particles show the current flow — their number and color = share of the recommended limit";
    host.append(cap, bar, ticks);
  }

  /* ---------- results & warnings ---------- */
  function resultRow(dl, label, value) {
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = value;
    dl.append(dt, dd);
  }

  function renderResults(res) {
    const s = settings;
    const dl = els.results;
    dl.textContent = "";
    const pctPar = res.utilPar * 100, pctSer = res.utilSer * 100, pctOut = res.utilOut * 100;
    const nBridges = Math.max(1, s.p - 1);
    const minWidth = worst => (s.maxDensity > 0 ? worst / (s.maxDensity * s.thickness * s.layers) : null);
    const minWidthPar = minWidth(res.worstSeg);
    const minWidthSer = minWidth(res.worstBridge);
    const minWidthOut = minWidth(res.worstOut);

    resultRow(dl, "Current per cell", `${fmt(s.current / s.p, 2)} A (${fmt(s.current, 1)} A ÷ ${s.p}P)`);
    resultRow(dl, "Series junctions in pack", `${res.junctions} (S − 1)`);
    if (res.outNet) {
      const parts = res.outNet.outAt
        .map((v, i) => (v === null ? null : `tap ${i + 1}: ${fmt(Math.abs(v), 1)} A`))
        .filter(Boolean);
      resultRow(dl, `Pack output (${parts.length} tap${parts.length > 1 ? "s" : ""})`, parts.join(" · "));
    }
    if (s.p > 1) {
      resultRow(dl, "Group bridge cross-section", `${fmt(res.areaPar, 2)} mm² → limit ${fmt(res.iLimPar, 1)} A`);
      resultRow(dl, "Worst group bridge", `${fmt(res.worstSeg, 2)} A (${fmt(pctPar, 0)} % of limit)`);
      resultRow(dl, "Suggested min. group-bridge width", minWidthPar !== null ? `${fmt(minWidthPar, 1)} mm` : "—");
    }
    resultRow(dl, `Series bridge cross-section (×${nBridges})`, `${fmt(res.areaSer, 2)} mm² → limit ${fmt(res.iLimSer, 1)} A`);
    resultRow(dl, "Worst series bridge", `${fmt(res.worstBridge, 2)} A (${fmt(pctSer, 0)} % of limit)`);
    resultRow(dl, "Suggested min. series-bridge width", minWidthSer !== null ? `${fmt(minWidthSer, 1)} mm` : "—");
    if (res.outNet) {
      resultRow(dl, "Worst output-strip segment", `${fmt(res.worstOut, 2)} A (${fmt(pctOut, 0)} % of limit, group-bridge width)`);
      resultRow(dl, "Output strip loss @ max current", `${fmt(res.outNet.powerW, 2)} W · ${fmt(res.outNet.vDrop * 1000, 1)} mV (once per pack)`);
    }
    resultRow(dl, "Interconnect resistance", `${fmt(res.net.rEff * 1000, 3)} mΩ per junction`);
    resultRow(dl, "Voltage drop @ max current", `${fmt(res.net.vDrop * 1000, 1)} mV per junction · ${fmt(res.net.vDrop * res.junctions * 1000, 1)} mV total`);
    resultRow(dl, "Strip power loss @ max current", `${fmt(res.net.powerW, 2)} W per junction · ${fmt(res.net.powerW * res.junctions, 2)} W total`);

    const warn = els.warnings;
    const msgs = [];
    if (res.utilPar > 1) msgs.push(`Group bridges exceed the recommended limit (${fmt(pctPar, 0)} %). Widen them to ≥ ${fmt(minWidthPar, 1)} mm, add layers, or use a better material.`);
    else if (res.utilPar > 0.9) msgs.push(`Group bridges are close to the limit (${fmt(pctPar, 0)} %).`);
    if (res.utilSer > 1) msgs.push(`Series bridges exceed the recommended limit (${fmt(pctSer, 0)} %). Widen them to ≥ ${fmt(minWidthSer, 1)} mm, add layers, or use a better material.`);
    else if (res.utilSer > 0.9) msgs.push(`Series bridges are close to the limit (${fmt(pctSer, 0)} %).`);
    if (res.utilOut > 1) msgs.push(`The output strip exceeds the recommended limit (${fmt(pctOut, 0)} %). Widen it to ≥ ${fmt(minWidthOut, 1)} mm, add a tap, or move the taps.`);
    else if (res.utilOut > 0.9) msgs.push(`The output strip is close to the limit (${fmt(pctOut, 0)} %).`);
    warn.hidden = msgs.length === 0;
    warn.textContent = msgs.join(" ");
    warn.className = "strip-warning " + (res.utilPar > 1 || res.utilSer > 1 || res.utilOut > 1 ? "over" : "near");
  }

  /* ---------- public API ---------- */
  function render() {
    if (!els) return;
    const res = compute();
    drawDiagram(res);
    renderLegend();
    renderResults(res);
  }

  function getState() { return { ...settings }; }

  function setState(obj) {
    settings = { ...DEFAULTS, ...(obj || {}) };
    if (!STRIP_MATERIALS[settings.material]) settings.material = DEFAULTS.material;
    settings.outputs = Array.isArray(settings.outputs)
      ? settings.outputs.filter(i => Number.isInteger(i) && i >= 0)
      : [];
    if (els) { writeInputs(); render(); }
  }

  function setPacks(list) {
    packs = list;
    if (!els) return;
    const sel = els.fromPack;
    sel.textContent = "";
    sel.appendChild(new Option(packs.length ? "— copy S / P / current from a pack —" : "— no packs defined yet —", ""));
    for (const pk of packs) sel.appendChild(new Option(`${pk.name} (${pk.s}S${pk.p}P)`, pk.id));
    sel.disabled = packs.length === 0;
  }

  function init(opts) {
    onChange = opts?.onChange || null;
    els = {
      material: document.getElementById("c-material"),
      materialNote: document.getElementById("c-material-note"),
      fromPack: document.getElementById("c-from-pack"),
      diagram: document.getElementById("strip-diagram"),
      legend: document.getElementById("strip-legend"),
      results: document.getElementById("strip-results"),
      warnings: document.getElementById("strip-warnings")
    };

    for (const [key, mat] of Object.entries(STRIP_MATERIALS)) {
      els.material.appendChild(new Option(mat.label, key));
    }

    els.material.addEventListener("change", () => {
      const mat = STRIP_MATERIALS[els.material.value];
      settings.material = els.material.value;
      if (mat) {
        settings.resistivity = mat.resistivity;
        settings.maxDensity = mat.maxDensity;
      }
      writeInputs();
      render();
      onChange?.();
    });

    els.fromPack.addEventListener("change", () => {
      const pk = packs.find(x => x.id === els.fromPack.value);
      els.fromPack.value = "";
      if (!pk) return;
      settings.s = Math.max(2, pk.s);
      settings.p = clamp(pk.p, 1, 100);
      settings.outputs = settings.outputs.filter(i => i < settings.p - 1);
      if (pk.current) settings.current = pk.current;
      if (pk.pitch) { settings.pitch = pk.pitch; settings.gap = pk.pitch; }
      writeInputs();
      render();
      onChange?.();
    });

    for (const [, id] of FIELDS) {
      document.getElementById(id).addEventListener("input", () => {
        readInputs();
        render();
        onChange?.();
      });
    }

    writeInputs();
    darkQuery.addEventListener("change", render);
  }

  return { init, render, getState, setState, setPacks };
})();
