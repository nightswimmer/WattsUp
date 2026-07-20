/* WattsUp — app state, pack CRUD, comparison, wiring. */
"use strict";

(() => {
  const STORAGE_KEY = "wattsup-state-v1";

  const state = {
    packs: [],        // pack: {id, slot, name, s, p, chemistry, size, diameter, height, plen, pwid, phei, capacity, current, weight, price}
    positions: {},    // packId → {x, y} mm on the canvas
    referenceId: null,// the reference pack all others are compared against
    currency: "€"
  };

  let editingId = null;
  let dragId = null;    // id of the pack card currently being dragged for reordering

  /* ---------- persistence ---------- */
  function snapshot() {
    return {
      version: 1,
      packs: state.packs,
      positions: state.positions,
      referenceId: state.referenceId,
      currency: state.currency,
      connections: StripPlanner.getState(),
      cellmgr: CellManager.getState()
    };
  }

  // Apply a loaded/imported blob onto state. Returns true on success.
  function applyData(data) {
    if (!data || !Array.isArray(data.packs)) return false;
    state.packs = data.packs;
    state.positions = data.positions || {};
    state.referenceId = state.packs.some(p => p.id === data.referenceId) ? data.referenceId : null;
    state.currency = data.currency || "€";
    StripPlanner.setState(data.connections || null);
    CellManager.setState(data.cellmgr || null);
    return true;
  }

  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot()));
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      applyData(JSON.parse(raw));
    } catch { /* corrupted state — start fresh */ }
  }

  /* ---------- file export / import ---------- */
  function exportToFile() {
    const blob = new Blob([JSON.stringify(snapshot(), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `wattsup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function importFromFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      let data;
      try { data = JSON.parse(reader.result); }
      catch { alert("Could not import: that file isn’t valid JSON."); return; }

      if (!data || !Array.isArray(data.packs)) {
        alert("Could not import: the file isn’t a valid WattsUp export.");
        return;
      }
      if (state.packs.length &&
          !confirm("Importing will replace your current packs and settings. Continue?")) return;

      applyData(data);
      document.getElementById("currency-select").value = state.currency;
      save();
      renderAll();
      if (state.packs.length > 0) TopView.fit();
    };
    reader.onerror = () => alert("Could not read the file.");
    reader.readAsText(file);
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
  // Human-readable cell size for a pack (name for standard sizes, dimensions for custom).
  function cellSizeText(pack) {
    if (!pack.size) return "—";
    const size = CELL_SIZES[pack.size];
    if (!size) return "—";
    if (size.type === "cyl") return size.label;
    if (size.type === "custom-cyl") {
      return (pack.diameter && pack.height)
        ? `⌀${fmt(pack.diameter, 1)} × ${fmt(pack.height, 1)} mm`
        : "Custom cylindrical";
    }
    if (size.type === "prismatic") {
      return (pack.plen && pack.pwid && pack.phei)
        ? `${fmt(pack.plen, 1)} × ${fmt(pack.pwid, 1)} × ${fmt(pack.phei, 1)} mm`
        : "Prismatic / pouch";
    }
    return "—";
  }

  // Compact cell-format token for the card's second line ("18650", "Custom cyl", "Prismatic").
  function cellFormatShort(pack) {
    if (!pack.size) return null;
    const size = CELL_SIZES[pack.size];
    if (!size) return null;
    if (size.type === "cyl") return pack.size;
    if (size.type === "custom-cyl") return "Custom cyl";
    if (size.type === "prismatic") return "Prismatic";
    return null;
  }

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
      card.dataset.packId = pack.id;
      wireCardDrag(card, pack);

      const nameEl = document.createElement("h3");
      nameEl.className = "pack-name";
      nameEl.textContent = pack.name;
      nameEl.title = pack.name;
      card.appendChild(nameEl);

      const config = document.createElement("p");
      config.className = "pack-config";
      const configText = [cellFormatShort(pack), `${pack.s}S${pack.p}P`, `${m.cells} cells`]
        .filter(Boolean).join(" · ");
      config.textContent = configText;
      config.title = configText;
      card.appendChild(config);

      const meta = document.createElement("p");
      meta.className = "pack-meta";
      meta.textContent = m.chem ? m.chem.label : "chemistry —";
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
        ["Cell size", cellSizeText(pack)],
        ["Pack size", m.geo ? `${fmt(m.geo.width, 0)}×${fmt(m.geo.length, 0)}×${fmt(m.geo.height, 0)} mm` : "—"],
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

      let refControl;
      if (state.referenceId === pack.id) {
        refControl = document.createElement("span");
        refControl.className = "reference-badge";
        refControl.textContent = "★ Reference";
        refControl.title = "This pack is the comparison reference. Click to clear.";
        refControl.setAttribute("role", "button");
        refControl.tabIndex = 0;
        refControl.addEventListener("click", () => setReference(null));
        refControl.addEventListener("keydown", ev => {
          if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); setReference(null); }
        });
      } else {
        refControl = document.createElement("button");
        refControl.className = "btn btn-small ref-btn";
        refControl.textContent = "Set as reference";
        refControl.addEventListener("click", () => setReference(pack.id));
      }

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

      actions.append(refControl, editBtn, dupBtn, delBtn);
      card.appendChild(actions);
      list.appendChild(card);
    }
  }

  /* ---------- drag-to-reorder ---------- */
  function clearDropMarkers() {
    document.querySelectorAll(".pack-card.drop-before, .pack-card.drop-after")
      .forEach(el => el.classList.remove("drop-before", "drop-after"));
  }

  // Where would a drop land relative to this card? true = before, false = after.
  function dropIsBefore(card, ev) {
    const rect = card.getBoundingClientRect();
    return ev.clientX < rect.left + rect.width / 2;
  }

  function wireCardDrag(card, pack) {
    const handle = document.createElement("span");
    handle.className = "drag-handle";
    handle.textContent = "⠿";
    handle.title = "Drag to reorder";
    handle.setAttribute("aria-label", "Drag to reorder");
    handle.draggable = true;

    handle.addEventListener("dragstart", ev => {
      dragId = pack.id;
      ev.dataTransfer.effectAllowed = "move";
      ev.dataTransfer.setData("text/plain", pack.id);   // Firefox needs data to start a drag
      ev.dataTransfer.setDragImage(card, 20, 20);
      card.classList.add("dragging");
    });
    handle.addEventListener("dragend", () => {
      dragId = null;
      card.classList.remove("dragging");
      clearDropMarkers();
    });
    card.appendChild(handle);

    card.addEventListener("dragover", ev => {
      if (dragId === null || dragId === pack.id) return;
      ev.preventDefault();
      ev.dataTransfer.dropEffect = "move";
      const before = dropIsBefore(card, ev);
      card.classList.toggle("drop-before", before);
      card.classList.toggle("drop-after", !before);
    });
    card.addEventListener("dragleave", () => {
      card.classList.remove("drop-before", "drop-after");
    });
    card.addEventListener("drop", ev => {
      if (dragId === null || dragId === pack.id) return;
      ev.preventDefault();
      const before = dropIsBefore(card, ev);
      const draggedId = dragId;
      dragId = null;
      movePack(draggedId, pack.id, before);
    });
  }

  function movePack(draggedId, targetId, before) {
    if (draggedId === targetId) return;
    const from = state.packs.findIndex(p => p.id === draggedId);
    if (from < 0) return;
    const [moved] = state.packs.splice(from, 1);
    let to = state.packs.findIndex(p => p.id === targetId);
    if (to < 0) { state.packs.splice(from, 0, moved); return; }  // target gone — undo
    if (!before) to += 1;
    state.packs.splice(to, 0, moved);
    save();
    renderAll();
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
    if (state.referenceId === id) state.referenceId = null;
    save();
    renderAll();
  }

  function setReference(id) {
    state.referenceId = id;
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

    if (state.packs.length < 2) { section.hidden = true; return; }
    section.hidden = false;

    const reference = state.packs.find(p => p.id === state.referenceId);
    if (!reference) {
      hint.textContent = "Click “Set as reference” on a pack to compare every other pack against it.";
      return;
    }
    const others = state.packs.filter(p => p.id !== reference.id);
    hint.textContent = `Every pack compared against the reference — ${reference.name}. Percentages are each pack relative to the reference; green is better, red is worse.`;

    const cols = [reference, ...others];
    const metricsByPack = new Map(cols.map(p => [p.id, computePack(p)]));

    // ----- header -----
    const thead = document.createElement("thead");
    const hr = document.createElement("tr");
    hr.appendChild(Object.assign(document.createElement("th"), { textContent: "Metric" }));
    cols.forEach((p, i) => {
      const th = document.createElement("th");
      if (i === 0) th.className = "ref-col";
      const key = document.createElement("span");
      key.className = "legend-key";
      key.style.background = packColor(p);
      th.append(key, document.createTextNode(" " + p.name));
      if (i === 0) {
        const tag = document.createElement("span");
        tag.className = "ref-tag";
        tag.textContent = "reference";
        th.appendChild(tag);
      }
      hr.appendChild(th);
    });
    thead.appendChild(hr);
    table.appendChild(thead);

    const fmtVal = (metric, v) => {
      if (v === null || v === undefined) return "—";
      if (metric.text) return v;
      const num = fmt(v, metric.digits);
      return metric.currency ? `${state.currency}${num}${metric.unit}`
        : (metric.unit ? `${num} ${metric.unit}` : num);
    };

    // ----- body -----
    const tbody = document.createElement("tbody");
    for (const metric of COMPARE_METRICS) {
      const values = cols.map(p => metric.get(metricsByPack.get(p.id)));
      if (values.every(v => v === null || v === undefined)) continue;

      const tr = document.createElement("tr");
      tr.appendChild(Object.assign(document.createElement("td"), { textContent: metric.label }));

      const refVal = values[0];
      values.forEach((v, i) => {
        const td = document.createElement("td");
        td.appendChild(document.createTextNode(fmtVal(metric, v)));

        if (i === 0) {                       // the reference column itself
          td.classList.add("ref-col");
        } else if (!metric.text && typeof v === "number" &&
                   typeof refVal === "number" && refVal !== 0) {
          const pct = ((v - refVal) / refVal) * 100;
          const delta = document.createElement("span");
          delta.className = "delta";
          if (metric.direction && v !== refVal) {
            const better = metric.direction === "higher" ? v > refVal : v < refVal;
            td.classList.add(better ? "better-cell" : "worse-cell");
            delta.classList.add(better ? "better" : "worse");
          } else {
            delta.classList.add("neutral");   // no winner direction, or exactly equal
          }
          delta.textContent = ` ${pct >= 0 ? "+" : "−"}${fmt(Math.abs(pct), 1)}%`;
          td.appendChild(delta);
        }
        tr.appendChild(td);
      });
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

  function renderStrips() {
    StripPlanner.setPacks(state.packs.map(p => {
      const m = computePack(p);
      return {
        id: p.id,
        name: p.name,
        s: p.s,
        p: p.p,
        current: m.maxCurrentA,
        pitch: m.geo ? m.geo.cellW + CELL_SPACING_MM : null
      };
    }));
    StripPlanner.render();
  }

  function renderCells() {
    CellManager.setPacks(state.packs.map(p => ({
      id: p.id,
      name: p.name,
      s: p.s,
      p: p.p,
      vnom: p.chemistry ? CHEMISTRIES[p.chemistry]?.vNom : null
    })));
    CellManager.render();
  }

  function renderAll() {
    renderPacks();
    renderComparison();
    renderChart();
    renderCanvas();
    renderStrips();
    renderCells();
    if (document.getElementById("tab-planner").hidden) plannerDirty = true;
  }

  /* ---------- tabs ---------- */
  const TAB_KEY = "wattsup-tab-v1";
  const TABS = ["planner", "connections", "cells"];
  let plannerDirty = false;   // chart/canvas were (re)rendered while the planner tab was hidden

  function activateTab(name) {
    if (!TABS.includes(name)) name = "planner";
    const planner = name === "planner";
    const wasHidden = document.getElementById("tab-planner").hidden;
    for (const t of TABS) {
      document.getElementById("tab-" + t).hidden = t !== name;
      const btn = document.getElementById("tab-btn-" + t);
      btn.classList.toggle("active", t === name);
      btn.setAttribute("aria-selected", t === name);
    }
    if (planner && wasHidden && plannerDirty) {
      // hidden elements had no size — re-render the chart and re-fit the canvas now
      plannerDirty = false;
      requestAnimationFrame(() => {
        renderChart();
        if (state.packs.length > 0) TopView.fit();
      });
    }
    document.getElementById("add-pack-btn").hidden = !planner;   // belongs to the planner tab
    try { localStorage.setItem(TAB_KEY, name); } catch { /* private mode */ }
  }

  /* ---------- init ---------- */
  function init() {
    populateSelects();
    StripPlanner.init({ onChange: save });   // before load() so setState can reach the inputs
    CellManager.init({ onChange: save });
    load();

    for (const t of TABS) {
      document.getElementById("tab-btn-" + t).addEventListener("click", () => activateTab(t));
    }
    activateTab(localStorage.getItem(TAB_KEY) || "planner");

    const currencySelect = document.getElementById("currency-select");
    currencySelect.value = state.currency;
    currencySelect.addEventListener("change", () => {
      state.currency = currencySelect.value;
      save();
      renderAll();
    });

    document.getElementById("export-btn").addEventListener("click", exportToFile);
    const importFile = document.getElementById("import-file");
    document.getElementById("import-btn").addEventListener("click", () => importFile.click());
    importFile.addEventListener("change", () => {
      if (importFile.files[0]) importFromFile(importFile.files[0]);
      importFile.value = "";   // allow re-importing the same file
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
