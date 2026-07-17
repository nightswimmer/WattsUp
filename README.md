# ⚡ WattsUp

A browser-based tool to **dimension, calculate, and compare battery cell packs**.

Define battery packs by their series/parallel configuration and cell parameters, and WattsUp calculates every derivable pack spec, compares packs side by side, plots typical discharge curves, and draws each pack to scale so you can see them next to each other.

## Features

- **Pack builder** — add, edit, duplicate, and delete packs. Each pack has an S (series) and P (parallel) count plus optional cell parameters:
  - **Chemistry** — Li-ion (NMC / NCA / LCO), LiFePO₄, LiPo, LTO, sodium-ion, NiMH, NiCd, lead-acid. Voltage is inferred from the chemistry.
  - **Cell size** — 12 standard cylindrical sizes (10440 → 4680), or a custom cylindrical / prismatic / pouch size.
  - **Capacity, max discharge current, weight, price** — all optional; the app calculates whatever the given parameters allow.
- **Calculated pack specs** — voltage (min / nominal / max), capacity, energy, max current, max power, physical size (including typical inter-cell spacing), volume, weight, energy density (Wh/kg and Wh/L), price, and price per Wh.
- **Side-by-side comparison** — pick two packs to compare across 14 metrics, with the winner highlighted per category and the percentage difference shown.
- **Typical discharge curves** — voltage vs. depth-of-discharge for every pack, with an interactive hover readout and a data table.
- **To-scale top view** — all packs drawn from above in millimetres with individual cells visible. Drag packs to rearrange, drag empty space to pan, and scroll to zoom.
- **Extras** — currency selector (€ / $ / £), automatic light/dark theme, and state saved in your browser.

## Running it

No build step and no dependencies. Either:

- Open `index.html` directly in a browser, or
- Serve the folder with any static server (e.g. `python -m http.server`), or
- Host it on GitHub Pages.

## Project structure

| File | Purpose |
|------|---------|
| `index.html` | Page markup and sections |
| `css/style.css` | Styling (light + dark themes) |
| `js/data.js` | Chemistry, cell-size, and color data |
| `js/calc.js` | Pack calculation functions |
| `js/chart.js` | Discharge-curve chart |
| `js/canvas.js` | To-scale top-view canvas |
| `js/app.js` | App state, UI, and persistence |

## Notes

Discharge curves are **indicative** — they are derived from typical chemistry curves at moderate load, not measured cell data. Real behaviour depends on load, temperature, and cell quality.
