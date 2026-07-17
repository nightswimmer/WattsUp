/* WattsUp — app state, pack CRUD, comparison, wiring. */
"use strict";

(() => {
  const STORAGE_KEY = "wattsup-state-v1";

  const state = {
    packs: [],        // pack: {id, slot, name, s, p, chemistry, size, diameter, height, plen, pwid, phei, capacity, current, weight, price}
    positions: {},    // packId → {x, y} mm on the canvas
    compareIds: [],   // up to 2 pack ids
    currency: "€"
  };

  let editingId = null;

  /* ---------- persistence ---------- */
  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      packs: state.packs, positions: state.positions,
      compareIds: state.compareIds, currency: state.currency
    }));
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      state.packs = Array.isArray(data.packs) ? data.packs : [];
      state.positions = data.positions || {};
      state.compareIds = (data.compareIds || []).filter(id => state.packs.some(p => p.id === id));
      state.currency = data.currency || "€";
    } catch { /* corrupted state — start fresh */ }
  }

  /* ---------- theming / colors ---------- */
  const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
  const mode = () => (darkQuery.matches ? "dark" : "light");
  const packColor = pack => SERIES_COLORS[mode()][pack.slot % MAX_SERIES];

  /* ---------- pack helpers ---------- */
  function freeSlot() {
    for (let s = 0; s < MAX_SERIES; s++) {
      if (!state.packs.some(p => p.slot === s)) return s;
    }
    return -1;
  }

  function numOrNull(el) {
    const v = parseFloat(el.value);
    return Number.isFinite(v) ? v : null;
  }

  /* ---------- dialog ---------- */
  const dialog = document.getElementById("pack-dialog");
  const form = document.getElementById("pack-form");
  const sizeSelect = document.getElementById("f-size");
  const chemSelect = document.getElementById("f-chemistry");

  function populateSelects() {
    chemSelect.appendChild(new Option("— not specified —", ""));
    for (const [key, chem] of Object.entries(CHEMISTRIES)) {
      chemSelect.appendChild(new Option(chem.label, key));
    }
    sizeSelect.appendChild(new Option("— not specified —", ""));
    for (const [key, size] of Object.entries(CELL_SIZES)) {
      sizeSelect.appendChild(new Option(size.label, key));
    }
  }

  function updateSizeFields() {
    const type = sizeSelect.value ? CELL_SIZES[sizeSelect.value]?.type : null;
    document.getElementById("custom-cyl-fields").hidden = type !== "custom-cyl";
    document.getElementById("prismatic-fields").hidden = type !== "prismatic";
  }
  sizeSelect.addEventListener("change", updateSizeFields);

  function openDialog(pack) {
    editingId = pack ? pack.id : null;
    document.getElementById("dialog-title").textContent = pack ? "Edit pack" : "Add pack";
    document.getElementById("f-name").value = pack ? pack.name : "";
    document.getElementById("f-s").value = pack ? pack.s : 1;
    document.getElementById("f-p").value = pack ? pack.p : 1;
    chemSelect.value = pack?.chemistry || "";
    sizeSelect.value = pack?.size || "";
    document.getElementById("f-diameter").value = pack?.diameter ?? "";
    document.getElementById("f-height").value = pack?.height ?? "";
    document.getElementById("f-plen").value = pack?.plen ?? "";
    document.getElementById("f-pwid").value = pack?.pwid ?? "";
    document.getElementById("f-phei").value = pack?.phei ?? "";
    document.getElementById("f-capacity").value = pack?.capacity ?? "";
    document.getElementById("f-current").value = pack?.current ?? "";
    document.getElementById("f-weight").value = pack?.weight ?? "";
    document.getElementById("f-price").value = pack?.price ?? "";
    updateSizeFields();
    dialog.showModal();
  }

  form.addEventListener("submit", ev => {
    ev.preventDefault();
    const s = Math.max(1, Math.round(numOrNull(document.getElementById("f-s")) || 1));
    const p = Math.max(1, Math.round(numOrNull(document.getElementById("f-p")) || 1));
    const base = editingId ? state.packs.find(x => x.id === editingId) : null;

    const pack = {
      id: base ? base.id : "pk" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      slot: base ? base.slot : freeSlot(),
      name: document.getElementById("f-name").value.trim() || `Pack ${state.packs.length + 1}`,
      s, p,
      chemistry: chemSelect.value || null,
      size: sizeSelect.value || null,
      diameter: numOrNull(document.getElementById("f-diameter")),
      height: numOrNull(document.getElementById("f-height")),
      plen: numOrNull(document.getElementById("f-plen")),
      pwid: numOrNull(document.getElementById("f-pwid")),
      phei: numOrNull(document.getElementById("f-phei")),
      capacity: numOrNull(document.getElementById("f-capacity")),
      current: numOrNull(document.getElementById("f-current")),
      weight: numOrNull(document.getElementById("f-weight")),
      price: numOrNull(document.getElementById("f-price"))
    };

    const isNew = !base;
    if (base) {
      Object.assign(base, pack);
      delete state.positions[base.id];  // size may have changed — let the canvas re-place it
    } else {
      state.packs.push(pack);
    }
    dialog.close();
    save();
    renderAll();
    if (isNew) TopView.fit();
  });

  document.getElementById("dialog-cancel").addEventListener("click", () => dialog.close());

  document.getElementById("add-pack-btn").addEventListener("click", () => {
    if (state.packs.length >= MAX_SERIES) {
      alert(`Up to ${MAX_SERIES} packs are supported (one per chart color). Delete one to add another.`);
      return;
    }
    openDialog(null);
  });

  /* ---------- pack cards ---------- */
  function specRow(label, value) {
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = value;
    return [dt, dd];
  }

  function renderPacks() {
    const list = document.getElementById("pack-list");
    list.textContent = "";
    document.getElementById("empty-hint").hidden = state.packs.length > 0;

    for (const pack of state.packs) {
      const m = computePack(pack);
      const card = document.createElement("article");
      card.className = "pack-card";
      card.style.borderTopColor = packColor(pack);

      const head = document.createElement("header");
      const nameEl = document.createElement("h3");
      nameEl.textContent = pack.name;
      const config = document.createElement("span");
      config.className = "pack-config";
      config.textContent = `${pack.s}S${pack.p}P · ${m.cells} cells`;
      head.append(nameEl, config);
      card.appendChild(head);

      const meta = document.createElement("p");
      meta.className = "pack-meta";
      meta.textContent = [
        m.chem ? m.chem.label : "chemistry —",
        pack.size ? CELL_SIZES[pack.size].label.replace("…", "") : null
      ].filter(Boolean).join(" · ");
      card.appendChild(meta);

      const dl = document.createElement("dl");
      dl.className = "pack-specs";
      const rows = [
        ["Voltage", m.vNom !== null ? `${fmt(m.vNom, 1)} V (${fmt(m.vMin, 1)}–${fmt(m.vMax, 1)})` : "—"],
        ["Capacity", m.capacityAh !== null ? `${fmt(m.capacityAh, 1)} Ah` : "—"],
        ["Energy", fmtUnit(m.energyWh, "Wh", 0)],
        ["Max current", fmtUnit(m.maxCurrentA, "A", 0)],
        ["Max power", fmtUnit(m.maxPowerW, "W", 0)],
        ["Weight", fmtUnit(m.weightKg, "kg", 2)],
        ["Size", m.geo ? `${fmt(m.geo.width, 0)}×${fmt(m.geo.length, 0)}×${fmt(m.geo.height, 0)} mm` : "—"],
        ["Volume", m.geo ? `${fmt(m.geo.volumeL, 2)} L` : "—"],
        ["Energy density", m.whPerKg !== null ? `${fmt(m.whPerKg, 0)} Wh/kg` : "—"],
        ["Price", m.price !== null ? `${state.currency}${fmt(m.price, 2)}` : "—"]
      ];
      for (const [label, value] of rows) dl.append(...specRow(label, value));
      card.appendChild(dl);

      if (m.chem) {
        const details = document.createElement("details");
        const summary = document.createElement("summary");
        summary.textContent = "Chemistry notes";
        const note = document.createElement("p");
        note.textContent = m.chem.notes;
        details.append(summary, note);
        card.appendChild(details);
      }

      const actions = document.createElement("div");
      actions.className = "card-actions";

      const cmpLabel = document.createElement("label");
      cmpLabel.className = "compare-toggle";
      const cmp = document.createElement("input");
      cmp.type = "checkbox";
      cmp.checked = state.compareIds.includes(pack.id);
      cmp.addEventListener("change", () => toggleCompare(pack.id));
      cmpLabel.append(cmp, document.createTextNode(" Compare"));

      const editBtn = document.createElement("button");
      editBtn.className = "btn btn-small";
      editBtn.textContent = "Edit";
      editBtn.addEventListener("click", () => openDialog(pack));

      const dupBtn = document.createElement("button");
      dupBtn.className = "btn btn-small";
      dupBtn.textContent = "Duplicate";
      dupBtn.addEventListener("click", () => duplicatePack(pack));

      const delBtn = document.createElement("button");
      delBtn.className = "btn btn-small btn-danger";
      delBtn.textContent = "Delete";
      delBtn.addEventListener("click", () => {
        if (confirm(`Delete pack "${pack.name}"?`)) deletePack(pack.id);
      });

      actions.append(cmpLabel, editBtn, dupBtn, delBtn);
      card.appendChild(actions);
      list.appendChild(card);
    }
  }

  function duplicatePack(pack) {
    if (state.packs.length >= MAX_SERIES) {
      alert(`Up to ${MAX_SERIES} packs are supported. Delete one to add another.`);
      return;
    }
    const copy = { ...pack, id: "pk" + Date.now().toString(36), slot: freeSlot(), name: pack.name + " (copy)" };
    state.packs.push(copy);
    save();
    renderAll();
    TopView.fit();
  }

  function deletePack(id) {
    state.packs = state.packs.filter(p => p.id !== id);
    delete state.positions[id];
    state.compareIds = state.compareIds.filter(x => x !== id);
    save();
    renderAll();
  }

  function toggleCompare(id) {
    if (state.compareIds.includes(id)) {
      state.compareIds = state.compareIds.filter(x => x !== id);
    } else {
      state.compareIds.push(id);
      if (state.compareIds.length > 2) state.compareIds.shift();  // keep the two most recent
    }
    save();
    renderAll();
  }

  /* ---------- comparison table ---------- */
  // direction: "higher" | "lower" | null (no winner)
  const COMPARE_METRICS = [
    { label: "Nominal voltage", get: m => m.vNom, unit: "V", digits: 1, direction: null },
    { label: "Voltage range", get: m => (m.vMin !== null ? `${fmt(m.vMin, 1)}–${fmt(m.vMax, 1)} V` : null), text: true },
    { label: "Cell count", get: m => m.cells, unit: "", digits: 0, direction: null },
    { label: "Capacity", get: m => m.capacityAh, unit: "Ah", digits: 1, direction: "higher" },
    { label: "Energy", get: m => m.energyWh, unit: "Wh", digits: 0, direction: "higher" },
    { label: "Max current", get: m => m.maxCurrentA, unit: "A", digits: 0, direction: "higher" },
    { label: "Max power", get: m => m.maxPowerW, unit: "W", digits: 0, direction: "higher" },
    { label: "Weight", get: m => m.weightKg, unit: "kg", digits: 2, direction: "lower" },
    { label: "Energy density (mass)", get: m => m.whPerKg, unit: "Wh/kg", digits: 0, direction: "higher" },
    { label: "Footprint", get: m => (m.geo ? m.geo.footprintCm2 : null), unit: "cm²", digits: 0, direction: "lower" },
    { label: "Volume", get: m => (m.geo ? m.geo.volumeL : null), unit: "L", digits: 2, direction: "lower" },
    { label: "Energy density (volume)", get: m => m.whPerL, unit: "Wh/L", digits: 0, direction: "higher" },
    { label: "Price", get: m => m.price, unit: "", digits: 2, direction: "lower", currency: true },
    { label: "Price per Wh", get: m => m.pricePerWh, unit: "/Wh", digits: 3, direction: "lower", currency: true }
  ];

  function renderComparison() {
    const section = document.getElementById("compare-section");
    const hint = document.getElementById("compare-hint");
    const table = document.getElementById("compare-table");
    table.textContent = "";

    const selected = state.compareIds
      .map(id => state.packs.find(p => p.id === id))
      .filter(Boolean);

    if (state.packs.length < 2) { section.hidden = true; return; }
    section.hidden = false;

    if (selected.length !== 2) {
      hint.textContent = "Tick “Compare” on two packs to see them side by side.";
      return;
    }
    hint.textContent = "";

    const [pa, pb] = selected;
    const ma = computePack(pa), mb = computePack(pb);

    const thead = document.createElement("thead");
    const hr = document.createElement("tr");
    const cells = ["Metric", pa.name, pb.name, "Winner"];
    cells.forEach((txt, i) => {
      const th = document.createElement("th");
      if (i === 1 || i === 2) {
        const key = document.createElement("span");
        key.className = "legend-key";
        key.style.background = packColor(i === 1 ? pa : pb);
        th.append(key, document.createTextNode(" " + txt));
      } else {
        th.textContent = txt;
      }
      hr.appendChild(th);
    });
    thead.appendChild(hr);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    for (const metric of COMPARE_METRICS) {
      const va = metric.get(ma);
      const vb = metric.get(mb);
      if ((va === null || va === undefined) && (vb === null || vb === undefined)) continue;

      const tr = document.createElement("tr");
      const tdLabel = document.createElement("td");
      tdLabel.textContent = metric.label;
      tr.appendChild(tdLabel);

      const fmtVal = v => {
        if (v === null || v === undefined) return "—";
        if (metric.text) return v;
        const num = fmt(v, metric.digits);
        return metric.currency ? `${state.currency}${num}${metric.unit}` : (metric.unit ? `${num} ${metric.unit}` : num);
      };

      const tdA = document.createElement("td");
      tdA.textContent = fmtVal(va);
      const tdB = document.createElement("td");
      tdB.textContent = fmtVal(vb);
      const tdW = document.createElement("td");

      if (!metric.text && metric.direction && va !== null && vb !== null && va !== vb) {
        const aWins = metric.direction === "higher" ? va > vb : va < vb;
        const winner = aWins ? pa : pb;
        const [wv, lv] = aWins ? [va, vb] : [vb, va];
        // winner relative to loser: +28% more energy / −16.9% less weight
        const pct = ((wv - lv) / lv) * 100;
        (aWins ? tdA : tdB).classList.add("winner-cell");
        const key = document.createElement("span");
        key.className = "legend-key";
        key.style.background = packColor(winner);
        tdW.append(key, document.createTextNode(` ${winner.name} `));
        const pctEl = document.createElement("span");
        pctEl.className = "winner-pct";
        pctEl.textContent = `${pct >= 0 ? "+" : "−"}${fmt(Math.abs(pct), 1)}%`;
        tdW.appendChild(pctEl);
      } else if (!metric.text && metric.direction === null) {
        tdW.textContent = "·";
        tdW.className = "neutral-cell";
      } else if (!metric.text && va !== null && vb !== null && va === vb) {
        tdW.textContent = "tie";
        tdW.className = "neutral-cell";
      } else {
        tdW.textContent = "—";
        tdW.className = "neutral-cell";
      }

      tr.append(tdA, tdB, tdW);
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
  }

  /* ---------- chart + canvas ---------- */
  function renderChart() {
    const section = document.getElementById("curves-section");
    const withChem = state.packs.filter(p => p.chemistry);
    section.hidden = withChem.length === 0;
    if (withChem.length === 0) return;
    CurveChart.render(state.packs, state.packs.map(p => packColor(p)));
  }

  function renderCanvas() {
    const section = document.getElementById("canvas-section");
    const drawable = state.packs.filter(p => computePack(p).geo);
    section.hidden = drawable.length === 0;
    if (drawable.length === 0) return;
    TopView.setPacks(
      state.packs.map(p => ({ pack: p, metrics: computePack(p), color: packColor(p) })),
      state.positions
    );
  }

  function renderAll() {
    renderPacks();
    renderComparison();
    renderChart();
    renderCanvas();
  }

  /* ---------- init ---------- */
  function init() {
    populateSelects();
    load();

    const currencySelect = document.getElementById("currency-select");
    currencySelect.value = state.currency;
    currencySelect.addEventListener("change", () => {
      state.currency = currencySelect.value;
      save();
      renderAll();
    });

    TopView.init(document.getElementById("top-canvas"), positions => {
      state.positions = positions;
      save();
    });
    document.getElementById("canvas-reset").addEventListener("click", () => TopView.fit());

    darkQuery.addEventListener("change", renderAll);
    window.addEventListener("resize", () => renderChart());

    renderAll();
    if (state.packs.length > 0) TopView.fit();
  }

  init();
})();
