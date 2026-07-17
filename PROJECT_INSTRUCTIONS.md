# WattsUp — Project State

This file is the reference point passed to each new Claude conversation. Update it at the end of every session.

## What the project is

WattsUp is a browser-based tool to **dimension, calculate, and compare battery cell packs**. A user defines packs by their series/parallel (S/P) configuration and optional cell parameters; the app calculates every derivable pack spec, compares two packs side by side, plots typical discharge curves, and draws all packs to scale in a top-view canvas.

## Tech stack

- **Pure static web app** — plain HTML, CSS, and vanilla JavaScript. No build step, no framework, no dependencies.
- Runs by opening `index.html` directly, serving the folder with any static server, or via GitHub Pages.
- State persists in the browser via `localStorage` (key `wattsup-state-v1`).

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
- **Cell parameters (all optional):** chemistry, cell size, capacity (mAh), max discharge current (A), weight (g), price per cell. We calculate whatever the available params allow; missing values render as "—".
  - **Chemistries (10):** Li-ion NMC, NCA, LCO; LiFePO₄; LiPo; LTO; sodium-ion; NiMH; NiCd; lead-acid. Each defines vMin/vNom/vMax per cell, a typical discharge curve (~0.5C), and notes. Pack voltages are inferred from chemistry × S.
  - **Cell sizes:** 12 standard cylindrical (10440 → 4680), plus "Custom cylindrical" (diameter × height) and "Prismatic / pouch" (L × W × H).
- **Calculated pack specs:** voltage min/nom/max, capacity (Ah), energy (Wh), max current (A), max power (W), size (mm, incl. 2 mm inter-cell spacing), volume (L), weight (kg), energy density (Wh/kg and Wh/L), price, price per Wh.
- **Comparison:** tick "Compare" on exactly two packs → 14-metric table with per-metric winner (highlighted + color key) and % difference. Direction-aware (higher-is-better for capacity/energy/power/density; lower-is-better for weight/footprint/volume/price). % is winner relative to loser.
- **Discharge curves:** SVG line chart, pack voltage vs. depth of discharge, scaled by S. Hover crosshair with a tooltip listing every pack's voltage at that DOD; direct end-labels (≤4 series); legend; collapsible data table.
- **Top-view canvas:** packs drawn to scale in mm with individual cells (circles for cylindrical, rects for prismatic). Drag a pack to move, drag empty space to pan, scroll to zoom, "Fit" button, adaptive grid + scale bar. Cell rendering is capped for very large packs / tiny zoom for performance.
- **Chrome:** currency selector (€ / $ / £) in the header; theme follows OS light/dark. Colors use a CVD-safe, contrast-validated categorical palette assigned to packs by fixed slot (never cycled).

## Notable design decisions / conventions

- Max 8 packs because each maps to one validated color slot; adding beyond that is blocked with a message.
- Editing a pack clears its saved canvas position (size may have changed) so it gets re-placed on next fit.
- Discharge curves are **indicative** — derived from typical chemistry curves at moderate load, not measured data. This is stated in the UI.
- All series colors come from `SERIES_COLORS` in `data.js` (separate light/dark values), validated for colorblind-safety and contrast.

## Verified

Tested end-to-end in a headless browser: creating packs, comparing, chart hover/tooltip, canvas render, and both light/dark themes — no console errors.

## Possible next steps (not yet built)

- Charge-time estimate given a charger current; C-rate input as an alternative to absolute max current.
- JSON export/import to share pack definitions.
- Configurable inter-cell spacing (currently fixed at 2 mm).
- Non-rectangular cell layouts (offset / honeycomb rows) in the top view.
- Persisted per-pack canvas positions across edits.
