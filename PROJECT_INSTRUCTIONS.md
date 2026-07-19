# WattsUp — Project State

This file is the reference point passed to each new Claude conversation. Update it at the end of every session.

## What the project is

WattsUp is a browser-based tool to **dimension, calculate, and compare battery cell packs**. A user defines packs by their series/parallel (S/P) configuration and optional cell parameters; the app calculates every derivable pack spec, compares all packs against a chosen reference pack, plots typical discharge curves, and draws all packs to scale in a top-view canvas.

The app has **two tabs** (segmented control in the sticky header): **Pack Planner** (everything above) and **Pack Connections** (dimension the nickel strips that join the cells — material, thickness, widths → per-bridge currents, utilisation vs. recommended limits, losses).

## Tech stack

- **Pure static web app** — plain HTML, CSS, and vanilla JavaScript. No build step, no framework, no dependencies.
- Runs by opening `index.html` directly, serving the folder with any static server, or via GitHub Pages.
- State persists in the browser via `localStorage` (key `wattsup-state-v1`) and can also be exported to / imported from a `.json` file.
- Persisted/serialized state shape (`snapshot()` in `app.js`): `{ version, packs, positions, referenceId, currency, connections }` — `connections` is `StripPlanner.getState()` (all Pack Connections inputs + selected output taps). The active tab is stored separately under `wattsup-tab-v1` (not part of exports).

## File structure

```
index.html          — markup: header (with tab bar), planner sections, connections tab, add/edit dialog
css/style.css       — all styles; light theme default, dark via prefers-color-scheme
js/data.js          — static data: CHEMISTRIES, CELL_SIZES, CELL_SPACING_MM, STRIP_MATERIALS, SERIES_COLORS
js/calc.js          — pure calculation functions (computePack, computeGeometry, voltageAtDod, formatters,
                      solveStripNetwork, solveOutputStrip, gaussSolve)
js/chart.js         — CurveChart: SVG discharge-curve line chart with crosshair + tooltip
js/canvas.js        — TopView: to-scale top-view canvas with drag / pan / zoom
js/strips.js        — StripPlanner: Pack Connections tab (inputs, SVG diagram, particle animation, results)
js/app.js           — app state, pack CRUD, comparison table, tabs, wiring, persistence
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

## Notable design decisions / conventions

- Max 8 packs because each maps to one validated color slot; adding beyond that is blocked with a message.
- Editing a pack clears its saved canvas position (size may have changed) so it gets re-placed on next fit.
- Comparison is **reference-based** (one reference, all others compared to it) rather than pick-two. Reordering is via a per-card handle (not whole-card draggable) so it doesn't fight the card's buttons.
- Import **replaces** all state (with a confirm) — chosen over merge/append to keep "load everything from a file" predictable.
- Discharge curves are **indicative** — derived from typical chemistry curves at moderate load, not measured data. This is stated in the UI.
- All series colors come from `SERIES_COLORS` in `data.js` (separate light/dark values), validated for colorblind-safety and contrast.

## Verified

Tested via headless Chrome (seeded `localStorage` + screenshots): pack cards render with aligned rows across cards, 5-column layout, cell-size row for all size types, reference comparison with correct direction-aware % math, and Export/Import wiring. Drag-to-reorder: the array splice logic is unit-tested for all before/after cases; the drag *gesture* itself can't be exercised headless, so it should be spot-checked in a real browser.

Pack Connections: both solvers unit-tested in Node (36 checks — Kirchhoff conservation, symmetry cases, KCL at inner nodes, power = ΣI²R, degenerate P=1/P=2, tap splits incl. the 5P/40A/2-tap reference case, P=100 performance ~25 ms). UI verified via headless-Chrome screenshots in dark **and** forced-light mode, tabs, ghost/active tap states, P=1 and P=12 edge cases. Note: seeding `localStorage` requires serving over `http://localhost` (Chrome isolates `file://` storage) and `charset=utf-8` headers (the `€` in seeded JSON otherwise mojibakes). The tap *click* gesture and particle *motion* can't be exercised headless — spot-check in a real browser.

## Possible next steps (not yet built)

- Separate width input for the output collector strip (currently reuses the group-bridge width).
- Output lead resistance (taps currently assumed ideal/joined — real multi-tap splits are somewhat more even).
- Charge-time estimate given a charger current; C-rate input as an alternative to absolute max current.
- Configurable inter-cell spacing (currently fixed at 2 mm).
- Non-rectangular cell layouts (offset / honeycomb rows) in the top view.
- Persisted per-pack canvas positions across edits.
- Keyboard-accessible reordering (drag is pointer-only today).
