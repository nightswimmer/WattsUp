# WattsUp — Project State

This file is the reference point passed to each new Claude conversation. Update it at the end of every session.

## What the project is

WattsUp is a browser-based tool to **dimension, calculate, and compare battery cell packs**. A user defines packs by their series/parallel (S/P) configuration and optional cell parameters; the app calculates every derivable pack spec, compares all packs against a chosen reference pack, plots typical discharge curves, and draws all packs to scale in a top-view canvas.

The app has **three tabs** (segmented control in the sticky header): **Pack Planner** (everything above), **Pack Connections** (dimension the nickel strips that join the cells — material, thickness, widths → per-bridge currents, utilisation vs. recommended limits, losses), and **Cell Management** (import battery-analyzer CSV logs of real cells, discard the odd ones out, and balance the rest into the pack's parallel groups).

## Tech stack

- **Pure static web app** — plain HTML, CSS, and vanilla JavaScript. No build step, no framework, no dependencies.
- Runs by opening `index.html` directly, serving the folder with any static server, or via GitHub Pages.
- State persists in the browser via `localStorage` (key `wattsup-state-v1`) and can also be exported to / imported from a `.json` file.
- Persisted/serialized state shape (`snapshot()` in `app.js`): `{ version, packs, positions, referenceId, currency, connections, cellmgr }` — `connections` is `StripPlanner.getState()` (all Pack Connections inputs + selected output taps); `cellmgr` is `CellManager.getState()` (`{s, p, vnom, cells:[…]}` — imported cell summaries, not the raw logs). The active tab is stored separately under `wattsup-tab-v1` (not part of exports).

## File structure

```
index.html          — markup: header (with tab bar), planner sections, connections tab, cells tab, add/edit dialog
css/style.css       — all styles; light theme default, dark via prefers-color-scheme
js/data.js          — static data: CHEMISTRIES, CELL_SIZES, CELL_SPACING_MM, STRIP_MATERIALS, SERIES_COLORS
js/calc.js          — pure calculation functions (computePack, computeGeometry, voltageAtDod, formatters,
                      solveStripNetwork, solveOutputStrip, gaussSolve, parseCellCsv,
                      cellRangeFromFilename, planCellPack, balanceCellGroups, median, medianAbsDev)
js/chart.js         — CurveChart: SVG discharge-curve line chart with crosshair + tooltip
js/canvas.js        — TopView: to-scale top-view canvas with drag / pan / zoom
js/strips.js        — StripPlanner: Pack Connections tab (inputs, SVG diagram, particle animation, results)
js/cells.js         — CellManager: Cell Management tab (CSV import, inventory, build plan, layout SVG)
js/app.js           — app state, pack CRUD, comparison table, tabs, wiring, persistence
data/               — 25 dummy MC5000-style CSV logs (100 simulated cells, incl. planted outliers) for testing
```

## Features implemented

- **Packs (up to 8 — one per chart color slot):** add / edit / duplicate / delete. Each has a name, S, P, and optional cell params.
  - **Drag to reorder:** each card has a ⠿ drag handle (top-right); dragging onto another card's left/right half inserts before/after. Reordering `state.packs` reorders everything (cards, comparison columns, chart, canvas). Handle-based (not whole-card) to avoid conflicting with the card's buttons.
  - **Card layout:** three fixed-height top lines — (1) pack name (clamped to max 2 lines, 2 lines always reserved), (2) `cell size · S/P · cell count`, (3) chemistry — followed by the spec list. Fixed heights keep every spec row aligned across cards.
- **Cell parameters (all optional):** chemistry, cell size, capacity (mAh), max discharge current (A), weight (g), price per cell. We calculate whatever the available params allow; missing values render as "—".
  - **Chemistries (10):** Li-ion NMC, NCA, LCO; LiFePO₄; LiPo; LTO; sodium-ion; NiMH; NiCd; lead-acid. Each defines vMin/vNom/vMax per cell, a typical discharge curve (~0.5C), and notes. Pack voltages are inferred from chemistry × S.
  - **Cell sizes:** 12 standard cylindrical (10440 → 4680), plus "Custom cylindrical" (diameter × height) and "Prismatic / pouch" (L × W × H).
- **Calculated pack specs:** voltage min/nom/max, capacity (Ah), energy (Wh), max current (A), max power (W), cell size, pack size (mm, incl. 2 mm inter-cell spacing), volume (L), weight (kg), energy density (Wh/kg and Wh/L), price, price per Wh.
- **Reference comparison:** click "Set as reference" on one pack (shows a ★ Reference badge; click to clear). The table renders packs as columns (reference first, highlighted) and metrics as rows; each non-reference cell shows a direction-aware, color-coded % vs. the reference (green = better, red = worse; neutral for metrics with no better/worse). Requires ≥2 packs and a reference set. Uses the same `COMPARE_METRICS` definitions as before.
- **Discharge curves:** SVG line chart, pack voltage vs. depth of discharge, scaled by S. Hover crosshair with a tooltip listing every pack's voltage at that DOD; direct end-labels (≤4 series); legend; collapsible data table.
- **Top-view canvas:** packs drawn to scale in mm with individual cells (circles for cylindrical, rects for prismatic). Drag a pack to move, drag empty space to pan, scroll to zoom, "Fit" button, adaptive grid + scale bar. Cell rendering is capped for very large packs / tiny zoom for performance.
- **Save / load:** auto-saved to `localStorage` on every change; header has **Export** (downloads `wattsup-YYYY-MM-DD.json`) and **Import** (file picker, validates JSON, **replaces** current state after a confirm, re-syncs currency + canvas fit). Connections settings are included.
- **Chrome:** currency selector (€ / $ / £) in the header; theme follows OS light/dark. Colors use a CVD-safe, contrast-validated categorical palette assigned to packs by fixed slot (never cycled). Up to 5 pack cards per row; reduced page side margins.
- **Tabs:** segmented control in the sticky header — Pack Planner / Pack Connections. Active tab persists (`wattsup-tab-v1`); "+ Add pack" is hidden on the connections tab. Switching back to the planner re-renders the chart and re-fits the canvas if they were rendered while hidden (zero-size guard, `plannerDirty` flag in `app.js`).

### Pack Connections tab (`js/strips.js` + solvers in `js/calc.js`)

- **Inputs:** strip material (pure nickel / Ni-plated steel / Ni-plated copper / copper / custom — presets fill resistivity Ω·mm²/m and max current density A/mm², both editable), thickness, layers (1–4), group-bridge width, series-bridge width, S, P (≤100), max pack current, cell pitch, group gap. "Load from pack" copies S/P/current/pitch from a planner pack. All persisted via `state.connections`.
- **Model:** the repeating unit of the pack — two parallel groups (A, B) joined by max(1, P−1) series bridges at the midpoints between cells. Balanced cells assumed (each sources/sinks I/P). `solveStripNetwork` does dense nodal analysis (Gaussian elimination, `gaussSolve`) and returns per-half-segment currents (`segA`/`segB`), per-bridge currents, vDrop, rEff, power. The interconnect is **independent of output taps**.
- **Output taps:** `solveOutputStrip` models the pack's **output collector strip** (the last group's far-side terminal): each B cell delivers I/P into it, the cable taps it at user-selected midpoints (taps joined, ideal leads). Selected via clickable round markers on the strip (keyboard-accessible); stored as midpoint indices in `connections.outputs`, pruned when P shrinks.
- **Diagram (SVG, built in JS):** styled like a real welded assembly — blue cells under continuous gray strips (`#828578`), weld-slot cut-outs showing the cell through the strip, square grid (horizontal pitch = A↔B row distance = 164 px, cells r 24). The B group is drawn with **two side lines per cell** from the B row down to its bottom face (solid circle, no slot) sitting **on top of** the ghosted output bar; B labels centered on the cell body. Selected taps get a down arrow with the exiting current below. Amp labels sit next to the cells (junction areas stay clear); bridge labels beside each bridge; tooltips with % of limit on all labels.
- **Current visualisation:** moving particles along every conductor (rAF animation) — direction = current direction, count & color (green→amber→red status ramp, `UTIL_STOPS`) = share of the recommended limit. Numeric labels always present (color never the only encoding). Honors `prefers-reduced-motion` (static particles), skips work while the tab is hidden, restarts on re-render (`stopFlow`/`startFlow`), thins density for P>30, hard cap ~900 particles.
- **Results panel:** per-cell current, junction count (S−1), tap currents, cross-sections & limits, worst group bridge / series bridge / output-strip segment with % of limit, suggested minimum widths, interconnect resistance, voltage drop and power loss (per junction · ×(S−1) total; output strip counted once per pack). Warning banner (amber near / red over limit).
- **Limits are rules of thumb** for welded strip with limited cooling (stated in UI): pure Ni 10 A/mm², Ni-steel 4, Ni-Cu/Cu 25; resistivity at 20 °C.

### Cell Management tab (`js/cells.js` + pure functions in `js/calc.js`)

- **Workflow:** grade real cells with a battery analyzer (SkyRC MC5000, 4 slots), save each run's CSV named after the cells in the slots (`1-4.csv`, `5-8.csv`, … — `cellRangeFromFilename` maps slot k → start+k−1; a single number means a single-slot file). Drag & drop the files onto the tab (whole tab panel accepts drops; dropzone is also click/keyboard-browsable via a hidden multi-file input). Per-file import log with ✓/✗ + warnings. Re-dropping a file replaces those cells (keeping the user's exclude flags).
- **Parser (`parseCellCsv`) is deliberately tolerant** because the MC5000's exact CSV layout is undocumented: auto-detects delimiter (`,` `;` tab), finds the header row by known-token score, maps columns by regex (slot/voltage/current/capacity/IR), converts units from header hints (mV, Ah, Ω) plus value heuristics, supports long format (Slot column), wide format (`Voltage1(V)`, `Slot 2 Capacity`), and single-slot files. Per slot it reduces to: capacity = max of accumulating column (mAh), IR = median of positive values (mΩ), end voltage, sample count. Throws friendly errors. **If a real MC5000 log doesn't parse, get a sample and adapt.**
- **Planning (`planCellPack`):** from N usable cells pick S×P — discard surplus worst-first: IR outliers (ir > median + max(3.5·MAD, 30 % of median), needs ≥8 IR readings), then lowest capacities; every discard carries a human-readable reason. `balanceCellGroups` then makes S groups of exactly P: greedy LPT (largest cell → emptiest non-full group) + bounded best-swap refinement between richest/poorest groups. Pack capacity = weakest group sum; also reports group min/mean/max, spread %, and pack IR = Σ group parallel IRs (only when all kept cells have IR).
- **UI:** left column = S / P / nominal-V inputs ("Load config from pack" copies S, P and chemistry vNom from a planner pack) + inventory stats (count, capacity median/range, IR median). Right column = results panel, warnings (imbalance > 3 %, missing IR data), **build-plan SVG** (one row per parallel group wired in series top→bottom, real cell number inside each circle, capacity below, group sums at left, weakest group amber, `<title>` tooltips, drawing capped at 600 cells), collapsible discarded-cells list, and the full inventory table (Use-checkbox to exclude a cell, capacity/IR/end-V/source-file/assignment per cell).
- **Persistence:** only cell *summaries* are stored (id, capacity, ir, vEnd, file, slot, samples, excluded) — never the raw CSV time series (localStorage size). State in `snapshot().cellmgr`; old exports without `cellmgr` import fine (defaults, empty inventory).
- **data/ dummy logs:** 25 files / 100 cells generated deterministically (seeded PRNG) — salvaged-18650-like (~2600 mAh σ130, ~32 mΩ σ5), 1 A discharge sampled every 60 s, NMC curve + IR drop + noise, `STO` row at cut-off 2.80 V; 10 planted outliers (low capacity: #7 #23 #41 #66 #88 #97; high IR: #14 #35 #52 #77 #97). With 13S7P the app discards the right 9 and balances groups to ~0.07 % spread.

## Notable design decisions / conventions

- Max 8 packs because each maps to one validated color slot; adding beyond that is blocked with a message.
- Editing a pack clears its saved canvas position (size may have changed) so it gets re-placed on next fit.
- Comparison is **reference-based** (one reference, all others compared to it) rather than pick-two. Reordering is via a per-card handle (not whole-card draggable) so it doesn't fight the card's buttons.
- Import **replaces** all state (with a confirm) — chosen over merge/append to keep "load everything from a file" predictable.
- Discharge curves are **indicative** — derived from typical chemistry curves at moderate load, not measured data. This is stated in the UI.
- All series colors come from `SERIES_COLORS` in `data.js` (separate light/dark values), validated for colorblind-safety and contrast.
- Cell Management keeps all math (parser, filename mapping, discard/balance) in `calc.js` as pure functions so they run in Node tests; `cells.js` is UI-only, mirroring the StripPlanner module API (`init/getState/setState/setPacks/render`).
- Tabs are generalized via the `TABS` array in `app.js` (`tab-<name>` / `tab-btn-<name>` id convention) — adding a fourth tab means adding markup + one array entry.

## Verified

Tested via headless Chrome (seeded `localStorage` + screenshots): pack cards render with aligned rows across cards, 5-column layout, cell-size row for all size types, reference comparison with correct direction-aware % math, and Export/Import wiring. Drag-to-reorder: the array splice logic is unit-tested for all before/after cases; the drag *gesture* itself can't be exercised headless, so it should be spot-checked in a real browser.

Pack Connections: both solvers unit-tested in Node (36 checks — Kirchhoff conservation, symmetry cases, KCL at inner nodes, power = ΣI²R, degenerate P=1/P=2, tap splits incl. the 5P/40A/2-tap reference case, P=100 performance ~25 ms). UI verified via headless-Chrome screenshots in dark **and** forced-light mode, tabs, ghost/active tap states, P=1 and P=12 edge cases. Note: seeding `localStorage` requires serving over `http://localhost` (Chrome isolates `file://` storage) and `charset=utf-8` headers (the `€` in seeded JSON otherwise mojibakes). The tap *click* gesture and particle *motion* can't be exercised headless — spot-check in a real browser.

Cell Management: 368 Node checks — filename-range parsing, parser against all 25 dummy files (capacity within 1 %, IR within 2 mΩ, end-V ≈ cut-off), delimiter/unit/wide-format tolerance, garbage rejection, and the full 100-cell 13S7P plan (group sizes, unique assignment, planted outliers discarded with correct reasons, capacity = min group, spread < 0.5 %, edge cases S=1 / P=1 / exact count / no-IR inventory). UI verified via headless Chrome in dark + forced-light mode by seeding state through the app's own parser (fetch `/data/*.csv` in a `/seed` page). The *drag-drop gesture* and file-picker flow can't be exercised headless — spot-check in a real browser.

## Possible next steps (not yet built)

- Validate `parseCellCsv` against a **real** SkyRC MC5000 log (format was undocumented; parser is tolerant but unverified against the actual device output).
- Per-cell discharge-curve overlay from the imported logs (time series is parsed but currently reduced to summaries and not stored).
- Manual overrides in the build plan (pin/swap a cell into a specific group).
- Charger-cycle detection (charge→discharge runs in one file; currently capacity = max of the column, which handles it, but multi-cycle files keep only the biggest run).
- Separate width input for the output collector strip (currently reuses the group-bridge width).
- Output lead resistance (taps currently assumed ideal/joined — real multi-tap splits are somewhat more even).
- Charge-time estimate given a charger current; C-rate input as an alternative to absolute max current.
- Configurable inter-cell spacing (currently fixed at 2 mm).
- Non-rectangular cell layouts (offset / honeycomb rows) in the top view.
- Persisted per-pack canvas positions across edits.
- Keyboard-accessible reordering (drag is pointer-only today).
