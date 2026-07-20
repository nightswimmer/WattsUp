/* WattsUp — Cell Management: charger-log import, grading and pack assignment. */
"use strict";

/**
 * CellManager renders the "Cell Management" tab: drop CSV logs from a
 * battery analyzer (SkyRC MC5000 — 4 slots per file, filename "1-4.csv"
 * maps slots to real cell numbers), build an inventory of measured cells,
 * pick the best S×P subset (discarding IR/capacity outliers), balance the
 * kept cells into S parallel groups and draw the resulting build plan.
 *
 * API (used by app.js — same contract as StripPlanner):
 *   init({ onChange })  — wire inputs; call once after DOM is ready
 *   getState()          — settings + cells for persistence
 *   setState(obj|null)  — apply persisted state (merged over defaults)
 *   setPacks(list)      — populate the "load config from pack" dropdown
 *   render()            — recompute + redraw
 */
const CellManager = (() => {
  const DEFAULTS = { s: 7, p: 4, vnom: 3.6 };

  let settings = { ...DEFAULTS };
  let cells = [];        // {id, capacity, ir, vEnd, file, slot, samples, excluded}
  let packs = [];        // [{id, name, s, p, vnom}]
  let onChange = null;
  let els = null;

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  /* ---------- settings <-> inputs ---------- */
  function writeInputs() {
    els.s.value = settings.s;
    els.p.value = settings.p;
    els.vnom.value = settings.vnom;
  }

  function readInputs() {
    const s = parseFloat(els.s.value);
    const p = parseFloat(els.p.value);
    const v = parseFloat(els.vnom.value);
    if (Number.isFinite(s)) settings.s = clamp(Math.round(s), 1, 100);
    if (Number.isFinite(p)) settings.p = clamp(Math.round(p), 1, 100);
    if (Number.isFinite(v)) settings.vnom = clamp(v, 0.5, 5);
  }

  /* ---------- file import ---------- */
  function isCsv(file) {
    return /\.csv$/i.test(file.name) || /csv|text\/plain/i.test(file.type || "");
  }

  async function addFiles(fileList) {
    const files = [...fileList];
    if (!files.length) return;
    const report = [];

    for (const file of files) {
      if (!isCsv(file)) {
        report.push({ ok: false, name: file.name, error: "not a .csv file — skipped" });
        continue;
      }
      try {
        const text = await file.text();
        const { slots, warnings } = parseCellCsv(text);
        const range = cellRangeFromFilename(file.name);
        if (!range) {
          throw new Error("can’t tell which cells this is — name the file after them, e.g. “1-4.csv”");
        }
        const width = range.end - range.start + 1;
        const maxSlot = Math.max(...slots.map(sl => sl.slot));
        if (maxSlot > width) {
          throw new Error(`the file has data for ${maxSlot} slots but “${file.name}” only covers ${width} cell number${width === 1 ? "" : "s"}`);
        }

        const ids = [];
        for (const sl of slots) {
          if (sl.capacity === null) {
            warnings.push(`slot ${sl.slot}: skipped (no capacity data)`);
            continue;
          }
          const id = range.start + sl.slot - 1;
          const cell = {
            id,
            capacity: sl.capacity,
            ir: sl.ir,
            vEnd: sl.vEnd,
            file: file.name,
            slot: sl.slot,
            samples: sl.samples,
            excluded: false
          };
          const at = cells.findIndex(c => c.id === id);
          if (at >= 0) {
            cell.excluded = cells[at].excluded;   // keep the user's choice
            cells[at] = cell;
          } else {
            cells.push(cell);
          }
          ids.push(id);
        }
        if (!ids.length) throw new Error("no usable cell data in the file");
        report.push({
          ok: true, name: file.name,
          text: ids.length === 1 ? `cell ${ids[0]}` : `cells ${Math.min(...ids)}–${Math.max(...ids)} (${ids.length})`,
          warnings
        });
      } catch (err) {
        report.push({ ok: false, name: file.name, error: err.message });
      }
    }

    cells.sort((a, b) => a.id - b.id);
    renderImportLog(report);
    render();
    onChange?.();
  }

  function renderImportLog(report) {
    const host = els.importLog;
    host.textContent = "";
    for (const r of report) {
      const li = document.createElement("li");
      li.className = r.ok ? "import-ok" : "import-err";
      const name = document.createElement("strong");
      name.textContent = r.name;
      li.append(r.ok ? "✓ " : "✗ ", name, ` — ${r.ok ? "imported " + r.text : r.error}`);
      if (r.ok && r.warnings.length) {
        const w = document.createElement("span");
        w.className = "import-warn";
        w.textContent = ` (${r.warnings.join("; ")})`;
        li.appendChild(w);
      }
      host.appendChild(li);
    }
  }

  /* ---------- rendering ---------- */
  function resultRow(host, label, value) {
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    if (value instanceof Node) dd.appendChild(value);
    else dd.textContent = value;
    host.append(dt, dd);
  }

  function renderStats() {
    const host = els.stats;
    host.textContent = "";
    if (!cells.length) return;
    const usable = cells.filter(c => !c.excluded && Number.isFinite(c.capacity));
    const caps = usable.map(c => c.capacity);
    const irs = usable.filter(c => Number.isFinite(c.ir)).map(c => c.ir);
    resultRow(host, "Cells loaded", `${cells.length}${cells.some(c => c.excluded) ? ` (${cells.filter(c => c.excluded).length} excluded)` : ""}`);
    if (caps.length) {
      resultRow(host, "Capacity median", `${fmt(median(caps), 0)} mAh`);
      resultRow(host, "Capacity range", `${fmt(Math.min(...caps), 0)}–${fmt(Math.max(...caps), 0)} mAh`);
    }
    if (irs.length) resultRow(host, "IR median", `${fmt(median(irs), 1)} mΩ`);
  }

  function renderResults(plan) {
    const host = els.results;
    host.textContent = "";
    const warn = els.warnings;
    warn.hidden = true;

    if (!plan) return;
    if (!plan.ok) {
      warn.hidden = false;
      warn.className = "strip-warning over";
      warn.textContent = `Not enough cells: ${plan.reason}. Drop more log files, or shrink S / P.`;
      return;
    }

    const s = settings.s, p = settings.p;
    const weakest = plan.groups.reduce((worst, g, i) => (g.sum < plan.groups[worst].sum ? i : worst), 0);

    resultRow(host, "Configuration", `${s}S${p}P — ${plan.needed} cells used, ${plan.discarded.length} left out`);
    resultRow(host, "Estimated pack capacity", `${fmt(plan.capacityAh, 2)} Ah (weakest group — Group ${weakest + 1})`);
    resultRow(host, "Estimated pack energy", `${fmt(plan.capacityAh * settings.vnom * s, 0)} Wh (at ${fmt(settings.vnom, 2)} V/cell nominal)`);
    resultRow(host, "Group capacity", `${fmt(plan.groupMin, 0)} – ${fmt(plan.groupMax, 0)} mAh (mean ${fmt(plan.groupMean, 0)})`);
    resultRow(host, "Group imbalance", `${fmt(plan.spreadPct, 2)} % (max − min vs. mean)`);
    if (plan.packIr !== null) {
      resultRow(host, "Pack internal resistance", `≈ ${fmt(plan.packIr, 1)} mΩ (sum of group parallel IRs)`);
    }

    const msgs = [];
    if (plan.spreadPct > 3) {
      msgs.push(`The parallel groups differ by ${fmt(plan.spreadPct, 1)} % in capacity — consider testing more cells so weaker ones can be swapped out.`);
    }
    const noIr = plan.groups.flatMap(g => g.cells).filter(c => !Number.isFinite(c.ir)).length;
    if (noIr) msgs.push(`${noIr} used cell${noIr === 1 ? " has" : "s have"} no internal-resistance data.`);
    if (msgs.length) {
      warn.hidden = false;
      warn.className = "strip-warning near";
      warn.textContent = msgs.join(" ");
    }
  }

  function renderDiscarded(plan) {
    const details = els.discardedDetails;
    const host = els.discarded;
    host.textContent = "";
    const list = plan?.ok ? plan.discarded : [];
    const excluded = cells.filter(c => c.excluded);
    const unusable = cells.filter(c => !c.excluded && !Number.isFinite(c.capacity));
    details.hidden = !list.length && !excluded.length && !unusable.length;
    if (details.hidden) return;

    const add = (label, cls) => {
      const li = document.createElement("li");
      li.className = cls;
      li.textContent = label;
      host.appendChild(li);
    };
    for (const d of [...list].sort((a, b) => a.cell.id - b.cell.id)) {
      add(`Cell ${d.cell.id} — ${d.reason}`, "");
    }
    for (const c of excluded) add(`Cell ${c.id} — excluded by you`, "muted");
    for (const c of unusable) add(`Cell ${c.id} — unusable (no capacity reading)`, "muted");
  }

  /* Build plan drawing: S rows of P cells, real cell numbers at each position. */
  function renderLayout(plan) {
    const host = els.layout;
    host.textContent = "";
    if (!plan?.ok) return;
    if (plan.needed > 600) {
      const p = document.createElement("p");
      p.className = "section-hint";
      p.textContent = "Pack too large to draw — the group assignment is listed in the inventory table below.";
      host.appendChild(p);
      return;
    }

    const R = 21, PITCH = 54, ROW_H = 96, LEFT = 118, TOP = 16;
    const s = settings.s, p = settings.p;
    const width = LEFT + p * PITCH + 12;
    const height = TOP + s * ROW_H;
    const weakest = plan.groups.reduce((worst, g, i) => (g.sum < plan.groups[worst].sum ? i : worst), 0);

    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("class", "cellm-svg");
    svg.setAttribute("width", width);
    svg.setAttribute("height", height);
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);

    const text = (x, y, str, cls, anchor = "middle") => {
      const t = document.createElementNS(NS, "text");
      t.setAttribute("x", x);
      t.setAttribute("y", y);
      t.setAttribute("text-anchor", anchor);
      t.setAttribute("class", cls);
      t.textContent = str;
      return t;
    };

    // series backbone hinting at the wiring order (Group 1 → Group S)
    if (s > 1) {
      const line = document.createElementNS(NS, "line");
      line.setAttribute("x1", LEFT - 34);
      line.setAttribute("x2", LEFT - 34);
      line.setAttribute("y1", TOP + ROW_H / 2);
      line.setAttribute("y2", TOP + (s - 1) * ROW_H + ROW_H / 2);
      line.setAttribute("class", "cellm-chain");
      svg.appendChild(line);
    }

    plan.groups.forEach((g, gi) => {
      const cy = TOP + gi * ROW_H + ROW_H / 2 - 10;
      svg.appendChild(text(8, cy - 4, `Group ${gi + 1}`, "cellm-group", "start"));
      svg.appendChild(text(8, cy + 14, `${fmt(g.sum, 0)} mAh`, "cellm-group-sum" + (gi === weakest ? " weakest" : ""), "start"));
      const dot = document.createElementNS(NS, "circle");
      dot.setAttribute("cx", LEFT - 34);
      dot.setAttribute("cy", cy);
      dot.setAttribute("r", 3.5);
      dot.setAttribute("class", "cellm-chain-dot");
      svg.appendChild(dot);

      g.cells.forEach((c, ci) => {
        const cx = LEFT + ci * PITCH + R;
        const circle = document.createElementNS(NS, "circle");
        circle.setAttribute("cx", cx);
        circle.setAttribute("cy", cy);
        circle.setAttribute("r", R);
        circle.setAttribute("class", "cellm-cell");
        const title = document.createElementNS(NS, "title");
        title.textContent = `Cell ${c.id} — ${fmt(c.capacity, 0)} mAh` +
          (Number.isFinite(c.ir) ? `, ${fmt(c.ir, 1)} mΩ` : "") +
          (c.file ? ` (${c.file})` : "");
        circle.appendChild(title);
        svg.appendChild(circle);
        svg.appendChild(text(cx, cy + 4.5, String(c.id), "cellm-id"));
        svg.appendChild(text(cx, cy + R + 15, fmt(c.capacity, 0), "cellm-cap"));
      });
    });

    host.appendChild(svg);
  }

  function renderTable(plan) {
    const table = els.table;
    table.textContent = "";
    if (!cells.length) return;

    // cell id → assignment text
    const where = new Map();
    if (plan?.ok) {
      plan.groups.forEach((g, gi) => g.cells.forEach(c => where.set(c.id, { text: `Group ${gi + 1}`, cls: "assign-group" })));
      plan.discarded.forEach(d => where.set(d.cell.id, { text: d.reason, cls: "assign-out" }));
    }

    const thead = document.createElement("thead");
    const hr = document.createElement("tr");
    for (const h of ["Use", "Cell #", "Capacity (mAh)", "IR (mΩ)", "End V", "Source file", "Assignment"]) {
      hr.appendChild(Object.assign(document.createElement("th"), { textContent: h }));
    }
    thead.appendChild(hr);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    for (const c of cells) {
      const tr = document.createElement("tr");
      if (c.excluded) tr.className = "cell-excluded";

      const tdUse = document.createElement("td");
      const box = document.createElement("input");
      box.type = "checkbox";
      box.checked = !c.excluded;
      box.title = box.checked ? "Uncheck to exclude this cell" : "Check to include this cell again";
      box.addEventListener("change", () => {
        c.excluded = !box.checked;
        render();
        onChange?.();
      });
      tdUse.appendChild(box);
      tr.appendChild(tdUse);

      const cellsText = [
        `#${c.id}`,
        Number.isFinite(c.capacity) ? fmt(c.capacity, 0) : "—",
        Number.isFinite(c.ir) ? fmt(c.ir, 1) : "—",
        Number.isFinite(c.vEnd) ? fmt(c.vEnd, 2) : "—",
        c.file || "—"
      ];
      for (const t of cellsText) {
        tr.appendChild(Object.assign(document.createElement("td"), { textContent: t }));
      }

      const tdWhere = document.createElement("td");
      const w = c.excluded ? { text: "excluded", cls: "assign-out" }
        : !Number.isFinite(c.capacity) ? { text: "no capacity data", cls: "assign-out" }
        : where.get(c.id) || { text: "—", cls: "" };
      tdWhere.textContent = w.text;
      if (w.cls) tdWhere.className = w.cls;
      tr.appendChild(tdWhere);
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
  }

  /* ---------- public API ---------- */
  function render() {
    if (!els) return;
    const hasCells = cells.length > 0;
    els.empty.hidden = hasCells;
    els.main.hidden = !hasCells;
    renderStats();
    if (!hasCells) return;
    const candidates = cells.filter(c => !c.excluded);
    const plan = planCellPack(candidates, settings.s, settings.p);
    renderResults(plan);
    renderLayout(plan);
    renderDiscarded(plan);
    renderTable(plan);
  }

  function getState() {
    return { ...settings, cells: cells.map(c => ({ ...c })) };
  }

  function setState(obj) {
    const data = obj || {};
    settings = {
      s: clamp(Math.round(data.s ?? DEFAULTS.s) || DEFAULTS.s, 1, 100),
      p: clamp(Math.round(data.p ?? DEFAULTS.p) || DEFAULTS.p, 1, 100),
      vnom: clamp(parseFloat(data.vnom) || DEFAULTS.vnom, 0.5, 5)
    };
    cells = Array.isArray(data.cells)
      ? data.cells
          .filter(c => c && Number.isInteger(c.id) && c.id > 0)
          .map(c => ({
            id: c.id,
            capacity: Number.isFinite(c.capacity) ? c.capacity : null,
            ir: Number.isFinite(c.ir) ? c.ir : null,
            vEnd: Number.isFinite(c.vEnd) ? c.vEnd : null,
            file: typeof c.file === "string" ? c.file : null,
            slot: Number.isInteger(c.slot) ? c.slot : null,
            samples: Number.isInteger(c.samples) ? c.samples : null,
            excluded: !!c.excluded
          }))
          .sort((a, b) => a.id - b.id)
      : [];
    if (els) { writeInputs(); render(); }
  }

  function setPacks(list) {
    packs = list;
    if (!els) return;
    const sel = els.fromPack;
    sel.textContent = "";
    sel.appendChild(new Option(packs.length ? "— copy S / P / voltage from a pack —" : "— no packs defined yet —", ""));
    for (const pk of packs) sel.appendChild(new Option(`${pk.name} (${pk.s}S${pk.p}P)`, pk.id));
    sel.disabled = packs.length === 0;
  }

  function init(opts) {
    onChange = opts?.onChange || null;
    els = {
      s: document.getElementById("m-s"),
      p: document.getElementById("m-p"),
      vnom: document.getElementById("m-vnom"),
      fromPack: document.getElementById("m-from-pack"),
      clear: document.getElementById("m-clear"),
      dropzone: document.getElementById("cell-dropzone"),
      fileInput: document.getElementById("cell-files"),
      importLog: document.getElementById("cell-import-log"),
      warnings: document.getElementById("cell-warnings"),
      results: document.getElementById("cell-results"),
      layout: document.getElementById("cell-layout"),
      discarded: document.getElementById("cell-discarded"),
      discardedDetails: document.getElementById("cell-discarded-details"),
      table: document.getElementById("cell-table"),
      stats: document.getElementById("cell-stats"),
      empty: document.getElementById("cells-empty"),
      main: document.getElementById("cells-main"),
      panel: document.getElementById("tab-cells")
    };

    for (const el of [els.s, els.p, els.vnom]) {
      el.addEventListener("input", () => {
        readInputs();
        render();
        onChange?.();
      });
    }

    els.fromPack.addEventListener("change", () => {
      const pk = packs.find(x => x.id === els.fromPack.value);
      els.fromPack.value = "";
      if (!pk) return;
      settings.s = clamp(pk.s, 1, 100);
      settings.p = clamp(pk.p, 1, 100);
      if (pk.vnom) settings.vnom = pk.vnom;
      writeInputs();
      render();
      onChange?.();
    });

    els.clear.addEventListener("click", () => {
      if (!cells.length) return;
      if (!confirm(`Remove all ${cells.length} imported cells?`)) return;
      cells = [];
      els.importLog.textContent = "";
      render();
      onChange?.();
    });

    // dropzone: click / keyboard / drag & drop (whole tab accepts drops)
    els.dropzone.addEventListener("click", () => els.fileInput.click());
    els.dropzone.addEventListener("keydown", ev => {
      if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); els.fileInput.click(); }
    });
    els.fileInput.addEventListener("change", () => {
      if (els.fileInput.files.length) addFiles(els.fileInput.files);
      els.fileInput.value = "";   // allow re-importing the same files
    });

    els.panel.addEventListener("dragover", ev => {
      if (![...ev.dataTransfer.types].includes("Files")) return;
      ev.preventDefault();
      ev.dataTransfer.dropEffect = "copy";
      els.dropzone.classList.add("dragover");
    });
    els.panel.addEventListener("dragleave", ev => {
      if (ev.target === els.panel || !els.panel.contains(ev.relatedTarget)) {
        els.dropzone.classList.remove("dragover");
      }
    });
    els.panel.addEventListener("drop", ev => {
      if (![...ev.dataTransfer.types].includes("Files")) return;
      ev.preventDefault();
      els.dropzone.classList.remove("dragover");
      addFiles(ev.dataTransfer.files);
    });

    writeInputs();
  }

  return { init, render, getState, setState, setPacks };
})();
