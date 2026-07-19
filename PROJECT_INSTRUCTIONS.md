# WattsUp — Project State

This file is the reference point passed to each new Claude conversation. Update it at the end of every session.

## What the project is

WattsUp is a browser-based tool to **dimension, calculate, and compare battery cell packs**. A user defines packs by their series/parallel (S/P) configuration and optional cell parameters; the app calculates every derivable pack spec, compares all packs against a chosen reference pack, plots typical discharge curves, and draws all packs to scale in a top-view canvas.

## Tech stack

- **Pure static web app** — plain HTML, CSS, and vanilla JavaScript. No build step, no framework, no dependencies.
- Runs by opening `index.html` directly, serving the folder with any static server, or via GitHub Pages.
- State persists in the browser via `localStorage` (key `wattsup-state-v1`) and can also be exported to / imported from a `.json` file.
- Persisted/serialized state shape (`snapshot()` in `app.js`): `{ version, packs, positions, referenceId, currency }`.

## File structure

```
index.html          — markup: header, pack cards, comparison, chart, canvas sections, add/edit dialog
css/style.css       — all styles; light theme default, dark via prefers-color-scheme
js/data.js          — static data: CHEMISTRIES, CELL_SIZES, CELL_SPACING_MM, SERIES_COLORS palette
js/calc.js          — pure calculation functions (computePack, computeGeometry, voltageAtDod, formatters)
js/chart.js         — CurveChart: SVG discharge-curve line chart with crosshair + tooltip
js/canvas.js        — TopView: to-scale top-view canvas with drag / pan / zoom
js/app.js           — app state, pack CRUD, comparison table, wiring, persistence
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
- **Save / load:** auto-saved to `localStorage` on every change; header has **Export** (downloads `wattsup-YYYY-MM-DD.json`) and **Import** (file picker, validates JSON, **replaces** current state after a confirm, re-syncs currency + canvas fit).
- **Chrome:** currency selector (€ / $ / £) in the header; theme follows OS light/dark. Colors use a CVD-safe, contrast-validated categorical palette assigned to packs by fixed slot (never cycled). Up to 5 pack cards per row; reduced page side margins.

## Notable design decisions / conventions

- Max 8 packs because each maps to one validated color slot; adding beyond that is blocked with a message.
- Editing a pack clears its saved canvas position (size may have changed) so it gets re-placed on next fit.
- Comparison is **reference-based** (one reference, all others compared to it) rather than pick-two. Reordering is via a per-card handle (not whole-card draggable) so it doesn't fight the card's buttons.
- Import **replaces** all state (with a confirm) — chosen over merge/append to keep "load everything from a file" predictable.
- Discharge curves are **indicative** — derived from typical chemistry curves at moderate load, not measured data. This is stated in the UI.
- All series colors come from `SERIES_COLORS` in `data.js` (separate light/dark values), validated for colorblind-safety and contrast.

## Verified

Tested via headless Chrome (seeded `localStorage` + screenshots): pack cards render with aligned rows across cards, 5-column layout, cell-size row for all size types, reference comparison with correct direction-aware % math, and Export/Import wiring. Drag-to-reorder: the array splice logic is unit-tested for all before/after cases; the drag *gesture* itself can't be exercised headless, so it should be spot-checked in a real browser.

## Possible next steps (not yet built)

- Charge-time estimate given a charger current; C-rate input as an alternative to absolute max current.
- Configurable inter-cell spacing (currently fixed at 2 mm).
- Non-rectangular cell layouts (offset / honeycomb rows) in the top view.
- Persisted per-pack canvas positions across edits.
- Keyboard-accessible reordering (drag is pointer-only today).
