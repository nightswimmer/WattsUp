/* WattsUp — discharge-curve line chart (SVG, with crosshair + tooltip). */
"use strict";

const CurveChart = (() => {
  const NS = "http://www.w3.org/2000/svg";
  const PAD = { top: 16, right: 110, bottom: 34, left: 46 };

  let host = null, legendHost = null, tableHost = null, tooltip = null;
  let currentPacks = [];   // [{pack, color, index}]
  let geomCache = null;    // {x(dod), y(v), width, height, vMin, vMax}

  function el(name, attrs) {
    const n = document.createElementNS(NS, name);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  }

  function niceTicks(min, max, count) {
    const span = max - min;
    if (span <= 0) return [min];
    const step0 = span / count;
    const mag = Math.pow(10, Math.floor(Math.log10(step0)));
    const step = [1, 2, 5, 10].map(m => m * mag).find(s => span / s <= count) || 10 * mag;
    const ticks = [];
    for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) ticks.push(v);
    return ticks;
  }

  /** Packs that can be plotted: need a chemistry. Capped at MAX_SERIES. */
  function plottable(packs) {
    return packs.filter(p => p.chemistry).slice(0, MAX_SERIES);
  }

  function render(packs, colors) {
    host = document.getElementById("curve-chart");
    legendHost = document.getElementById("curve-legend");
    tableHost = document.getElementById("curve-table");
    tooltip = document.getElementById("chart-tooltip");

    currentPacks = plottable(packs).map(p => ({
      pack: p,
      color: colors[packs.indexOf(p) % colors.length]
    }));

    host.textContent = "";
    legendHost.textContent = "";
    tableHost.textContent = "";
    if (currentPacks.length === 0) return false;

    const width = Math.max(320, host.clientWidth || 640);
    const height = 300;
    const iw = width - PAD.left - PAD.right;
    const ih = height - PAD.top - PAD.bottom;

    // voltage range across all plotted packs
    let vMin = Infinity, vMax = -Infinity;
    for (const { pack } of currentPacks) {
      const chem = CHEMISTRIES[pack.chemistry];
      for (const [, v] of chem.curve) {
        vMin = Math.min(vMin, v * pack.s);
        vMax = Math.max(vMax, v * pack.s);
      }
    }
    const vPad = (vMax - vMin) * 0.06 || 0.5;
    vMin -= vPad; vMax += vPad;

    const x = dod => PAD.left + (dod / 100) * iw;
    const y = v => PAD.top + ih - ((v - vMin) / (vMax - vMin)) * ih;
    geomCache = { x, y, width, height, vMin, vMax };

    const svg = el("svg", {
      width, height, viewBox: `0 0 ${width} ${height}`,
      role: "img", "aria-label": "Discharge curves: pack voltage versus depth of discharge"
    });

    // gridlines + y ticks (volts)
    for (const v of niceTicks(vMin, vMax, 6)) {
      svg.appendChild(el("line", { x1: PAD.left, x2: PAD.left + iw, y1: y(v), y2: y(v), class: "grid-line" }));
      const t = el("text", { x: PAD.left - 8, y: y(v) + 4, class: "tick-label", "text-anchor": "end" });
      t.textContent = fmt(v, 1);
      svg.appendChild(t);
    }
    // x ticks (DOD %)
    for (const d of [0, 20, 40, 60, 80, 100]) {
      const t = el("text", { x: x(d), y: PAD.top + ih + 20, class: "tick-label", "text-anchor": "middle" });
      t.textContent = d + "%";
      svg.appendChild(t);
    }
    // axes
    svg.appendChild(el("line", { x1: PAD.left, x2: PAD.left + iw, y1: PAD.top + ih, y2: PAD.top + ih, class: "axis-line" }));
    // axis titles
    const xt = el("text", { x: PAD.left + iw / 2, y: height - 2, class: "axis-title", "text-anchor": "middle" });
    xt.textContent = "Depth of discharge";
    svg.appendChild(xt);
    const yt = el("text", { x: 12, y: PAD.top + ih / 2, class: "axis-title", "text-anchor": "middle", transform: `rotate(-90 12 ${PAD.top + ih / 2})` });
    yt.textContent = "Pack voltage (V)";
    svg.appendChild(yt);

    // series lines + direct end labels (≤4 labeled; legend always carries all)
    currentPacks.forEach(({ pack, color }, i) => {
      const pts = [];
      for (let d = 0; d <= 100; d += 2) pts.push(`${x(d)},${y(voltageAtDod(pack, d))}`);
      svg.appendChild(el("polyline", {
        points: pts.join(" "), fill: "none", stroke: color,
        "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round"
      }));
      if (currentPacks.length <= 4) {
        const endV = voltageAtDod(pack, 100);
        const lbl = el("text", { x: x(100) + 8, y: y(endV) + 4, class: "series-label" });
        lbl.textContent = pack.name;
        svg.appendChild(lbl);
      }
    });

    // crosshair
    const cross = el("line", { x1: 0, x2: 0, y1: PAD.top, y2: PAD.top + ih, class: "crosshair", visibility: "hidden" });
    svg.appendChild(cross);

    // hover layer
    const hover = el("rect", { x: PAD.left, y: PAD.top, width: iw, height: ih, fill: "transparent" });
    hover.style.cursor = "crosshair";
    hover.addEventListener("pointermove", ev => {
      const rect = svg.getBoundingClientRect();
      const px = ev.clientX - rect.left;
      const dod = Math.max(0, Math.min(100, Math.round(((px - PAD.left) / iw) * 100)));
      cross.setAttribute("x1", x(dod));
      cross.setAttribute("x2", x(dod));
      cross.setAttribute("visibility", "visible");
      showTooltip(ev.clientX, ev.clientY, dod);
    });
    hover.addEventListener("pointerleave", () => {
      cross.setAttribute("visibility", "hidden");
      tooltip.hidden = true;
    });
    svg.appendChild(hover);

    host.appendChild(svg);
    renderLegend();
    renderTable();
    return true;
  }

  function showTooltip(clientX, clientY, dod) {
    tooltip.textContent = "";
    const title = document.createElement("div");
    title.className = "tt-title";
    title.textContent = `${dod}% discharged`;
    tooltip.appendChild(title);
    for (const { pack, color } of currentPacks) {
      const row = document.createElement("div");
      row.className = "tt-row";
      const key = document.createElement("span");
      key.className = "tt-key";
      key.style.background = color;
      const val = document.createElement("strong");
      val.textContent = fmtUnit(voltageAtDod(pack, dod), "V", 2);
      const name = document.createElement("span");
      name.className = "tt-name";
      name.textContent = pack.name;
      row.append(key, val, name);
      tooltip.appendChild(row);
    }
    tooltip.hidden = false;
    const pad = 14;
    let tx = clientX + pad, ty = clientY + pad;
    const tw = tooltip.offsetWidth, th = tooltip.offsetHeight;
    if (tx + tw > window.innerWidth - 8) tx = clientX - tw - pad;
    if (ty + th > window.innerHeight - 8) ty = clientY - th - pad;
    tooltip.style.left = tx + "px";
    tooltip.style.top = ty + "px";
  }

  function renderLegend() {
    for (const { pack, color } of currentPacks) {
      const item = document.createElement("span");
      item.className = "legend-item";
      const key = document.createElement("span");
      key.className = "legend-key";
      key.style.background = color;
      const name = document.createElement("span");
      name.textContent = `${pack.name} (${CHEMISTRIES[pack.chemistry].label}, ${pack.s}S${pack.p}P)`;
      item.append(key, name);
      legendHost.appendChild(item);
    }
  }

  function renderTable() {
    const steps = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    const thead = document.createElement("thead");
    const hr = document.createElement("tr");
    const h0 = document.createElement("th");
    h0.textContent = "DOD";
    hr.appendChild(h0);
    for (const { pack } of currentPacks) {
      const th = document.createElement("th");
      th.textContent = pack.name;
      hr.appendChild(th);
    }
    thead.appendChild(hr);
    const tbody = document.createElement("tbody");
    for (const d of steps) {
      const tr = document.createElement("tr");
      const td0 = document.createElement("td");
      td0.textContent = d + "%";
      tr.appendChild(td0);
      for (const { pack } of currentPacks) {
        const td = document.createElement("td");
        td.textContent = fmtUnit(voltageAtDod(pack, d), "V", 2);
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    tableHost.append(thead, tbody);
  }

  return { render };
})();
