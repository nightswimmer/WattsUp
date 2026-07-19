# ⚡ WattsUp

A browser-based tool to **dimension, calculate, and compare battery cell packs** — and to size the nickel strips that connect the cells.

Define battery packs by their series/parallel configuration and cell parameters, and WattsUp calculates every derivable pack spec, compares packs side by side, plots typical discharge curves, and draws each pack to scale so you can see them next to each other. A second tab, **Pack Connections**, sizes the interconnect strips: it solves the actual resistor network of a series junction and shows the current in every bridge as animated particle flows.

## Features

The app has two tabs: **Pack Planner** (pack design & comparison) and **Pack Connections** (interconnect strip sizing).

### Pack Planner

- **Pack builder** — add, edit, duplicate, delete, and **drag to reorder** packs. Each pack has an S (series) and P (parallel) count plus optional cell parameters:
  - **Chemistry** — Li-ion (NMC / NCA / LCO), LiFePO₄, LiPo, LTO, sodium-ion, NiMH, NiCd, lead-acid. Voltage is inferred from the chemistry.
  - **Cell size** — 12 standard cylindrical sizes (10440 → 4680), or a custom cylindrical / prismatic / pouch size.
  - **Capacity, max discharge current, weight, price** — all optional; the app calculates whatever the given parameters allow.
- **Calculated pack specs** — voltage (min / nominal / max), capacity, energy, max current, max power, cell size, physical pack size (including typical inter-cell spacing), volume, weight, energy density (Wh/kg and Wh/L), price, and price per Wh.
- **Reference comparison** — mark one pack as the **reference**, and every other pack is compared against it in a single table (packs as columns, metrics as rows). Each cell shows a direction-aware, colour-coded percentage difference vs. the reference — green when better, red when worse.
- **Typical discharge curves** — voltage vs. depth-of-discharge for every pack, with an interactive hover readout and a data table.
- **To-scale top view** — all packs drawn from above in millimetres with individual cells visible. Drag packs to rearrange, drag empty space to pan, and scroll to zoom.
- **Save & load** — everything is auto-saved to your browser, and you can **export** the full state (packs, layout, settings) to a `.json` file and **import** it back later.
- **Extras** — currency selector (€ / $ / £) and automatic light/dark theme.

### Pack Connections

- **Strip materials** — pure nickel, nickel-plated steel, nickel-plated copper, or bare copper, with reference resistivity and a recommended continuous current-density limit for each. Both values can be overridden for custom materials.
- **Real network solve** — the repeating unit of the pack (two parallel groups joined in series through P−1 bridges) is solved by nodal analysis, assuming balanced cells. The current in every strip segment and bridge is computed, not estimated from rules of thumb.
- **Animated current flows** — the assembly is drawn like the physical thing: blue cells under continuous nickel strips with visible weld slots. Moving particles show the direction of the current in each conductor; their number and colour (green → amber → red) show how close it runs to the recommended limit. Every segment is also labelled with its current in amps.
- **Pack output taps** — a ghosted collector strip below the last group (its far-side terminal) can be tapped by clicking: each cell delivers its share into it, and the strip currents recalculate around your chosen cable tap points.
- **Results & warnings** — per-cell current, worst-case utilisation of group bridges / series bridges / output strip, suggested minimum widths, interconnect resistance, voltage drop, and power loss (per junction and for the whole pack). Clear warnings when any strip runs near or over its limit.
- **Pack link** — copy S, P, max current, and cell pitch straight from any Pack Planner pack.

## Running it

No build step and no dependencies. Either:

- Open `index.html` directly in a browser, or
- Serve the folder with any static server (e.g. `python -m http.server`), or
- Host it on GitHub Pages.

## Project structure

| File | Purpose |
|------|---------|
| `index.html` | Page markup, tabs, and sections |
| `css/style.css` | Styling (light + dark themes) |
| `js/data.js` | Chemistry, cell-size, strip-material, and color data |
| `js/calc.js` | Pack calculations + interconnect network solvers |
| `js/chart.js` | Discharge-curve chart |
| `js/canvas.js` | To-scale top-view canvas |
| `js/strips.js` | Pack Connections tab: inputs, SVG diagram, particle animation |
| `js/app.js` | App state, tabs, UI, and persistence |

## Notes

Discharge curves are **indicative** — they are derived from typical chemistry curves at moderate load, not measured cell data. Real behaviour depends on load, temperature, and cell quality.

Strip current limits are **conservative rules of thumb** for welded strip inside a pack with limited cooling (resistivity at 20 °C), meant as design guidance rather than physical maxima. Interconnect currents assume balanced cells that share the load equally.
