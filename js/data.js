/* WattsUp — static data: chemistries, standard cell sizes, palette */
"use strict";

/**
 * Cell chemistries.
 * Voltages are per cell: vMin (cutoff), vNom (nominal), vMax (full charge).
 * curve: typical discharge curve at moderate load (~0.5C) as [DOD %, voltage V] points.
 * Curves are indicative — real behaviour depends on load, temperature and cell quality.
 */
const CHEMISTRIES = {
  "li-ion-nmc": {
    label: "Li-ion (NMC)",
    vMin: 2.5, vNom: 3.6, vMax: 4.2,
    notes: "High energy density, the most common chemistry in 18650/21700 cells (laptops, e-bikes, EVs). Good balance of capacity and power. ~500–1000 cycles.",
    curve: [[0, 4.15], [5, 4.05], [10, 3.98], [20, 3.88], [30, 3.80], [40, 3.73], [50, 3.67], [60, 3.61], [70, 3.55], [80, 3.46], [90, 3.30], [95, 3.12], [100, 2.70]]
  },
  "li-ion-nca": {
    label: "Li-ion (NCA)",
    vMin: 2.5, vNom: 3.6, vMax: 4.2,
    notes: "Very high energy density, used by Tesla (Panasonic cells). Similar to NMC with slightly higher capacity, slightly lower cycle life.",
    curve: [[0, 4.15], [5, 4.06], [10, 4.00], [20, 3.90], [30, 3.82], [40, 3.75], [50, 3.68], [60, 3.62], [70, 3.55], [80, 3.45], [90, 3.28], [95, 3.10], [100, 2.70]]
  },
  "lifepo4": {
    label: "LiFePO₄ (LFP)",
    vMin: 2.5, vNom: 3.2, vMax: 3.65,
    notes: "Very safe, long cycle life (2000–5000 cycles), very flat discharge curve. Lower energy density than NMC. Popular for solar storage and starter batteries.",
    curve: [[0, 3.42], [5, 3.34], [10, 3.32], [20, 3.30], [30, 3.29], [40, 3.28], [50, 3.27], [60, 3.26], [70, 3.25], [80, 3.22], [90, 3.15], [95, 3.00], [100, 2.50]]
  },
  "lipo": {
    label: "LiPo (pouch)",
    vMin: 3.0, vNom: 3.7, vMax: 4.2,
    notes: "Pouch-format lithium polymer. Very high discharge rates possible (RC, drones), flexible form factor. Sensitive to puncture and over-discharge.",
    curve: [[0, 4.16], [5, 4.08], [10, 4.00], [20, 3.90], [30, 3.83], [40, 3.77], [50, 3.72], [60, 3.66], [70, 3.60], [80, 3.50], [90, 3.35], [95, 3.18], [100, 3.00]]
  },
  "lco": {
    label: "Li-ion (LCO)",
    vMin: 3.0, vNom: 3.7, vMax: 4.2,
    notes: "Lithium cobalt oxide — classic phone/laptop chemistry. High energy density, modest discharge rate and cycle life.",
    curve: [[0, 4.15], [5, 4.05], [10, 3.99], [20, 3.90], [30, 3.84], [40, 3.78], [50, 3.73], [60, 3.68], [70, 3.62], [80, 3.53], [90, 3.38], [95, 3.20], [100, 3.00]]
  },
  "lto": {
    label: "LTO (titanate)",
    vMin: 1.5, vNom: 2.3, vMax: 2.85,
    notes: "Extreme cycle life (10 000+ cycles), very fast charge, works below 0 °C. Low voltage and energy density make packs bigger and heavier.",
    curve: [[0, 2.70], [5, 2.55], [10, 2.48], [20, 2.42], [30, 2.38], [40, 2.34], [50, 2.31], [60, 2.28], [70, 2.25], [80, 2.20], [90, 2.10], [95, 1.95], [100, 1.60]]
  },
  "na-ion": {
    label: "Sodium-ion",
    vMin: 1.5, vNom: 3.1, vMax: 4.0,
    notes: "Emerging chemistry — cheap, no lithium/cobalt, good cold performance. Steeply sloping discharge curve, lower energy density than Li-ion.",
    curve: [[0, 3.95], [5, 3.75], [10, 3.62], [20, 3.45], [30, 3.32], [40, 3.20], [50, 3.10], [60, 3.00], [70, 2.90], [80, 2.75], [90, 2.50], [95, 2.20], [100, 1.60]]
  },
  "nimh": {
    label: "NiMH",
    vMin: 1.0, vNom: 1.2, vMax: 1.45,
    notes: "Robust, tolerant of abuse, no BMS strictly required. Heavy per Wh and self-discharges faster (unless low-self-discharge type like Eneloop).",
    curve: [[0, 1.40], [5, 1.33], [10, 1.30], [20, 1.27], [30, 1.25], [40, 1.24], [50, 1.23], [60, 1.22], [70, 1.20], [80, 1.18], [90, 1.12], [95, 1.02], [100, 0.90]]
  },
  "nicd": {
    label: "NiCd",
    vMin: 1.0, vNom: 1.2, vMax: 1.45,
    notes: "Legacy chemistry — very rugged, high discharge rate, works in extreme cold, but toxic cadmium and memory effect. Mostly replaced by NiMH/Li-ion.",
    curve: [[0, 1.38], [5, 1.32], [10, 1.29], [20, 1.26], [30, 1.25], [40, 1.24], [50, 1.23], [60, 1.22], [70, 1.21], [80, 1.19], [90, 1.14], [95, 1.05], [100, 0.90]]
  },
  "lead-acid": {
    label: "Lead-acid (per cell)",
    vMin: 1.75, vNom: 2.0, vMax: 2.45,
    notes: "Cheap and proven (a 12 V battery is 6 cells in series). Very heavy, limited depth of discharge (~50 %) for good life.",
    curve: [[0, 2.10], [5, 2.08], [10, 2.06], [20, 2.03], [30, 2.01], [40, 1.99], [50, 1.97], [60, 1.95], [70, 1.92], [80, 1.89], [90, 1.84], [95, 1.79], [100, 1.70]]
  }
};

/**
 * Standard cell sizes. type: "cyl" (diameter × height, mm) or special entries.
 */
const CELL_SIZES = {
  "10440": { label: "10440 (AAA size)", type: "cyl", d: 10.5, h: 44.5 },
  "14500": { label: "14500 (AA size)", type: "cyl", d: 14.2, h: 53.0 },
  "16340": { label: "16340 (CR123)", type: "cyl", d: 16.7, h: 34.2 },
  "18350": { label: "18350", type: "cyl", d: 18.4, h: 35.0 },
  "18500": { label: "18500", type: "cyl", d: 18.4, h: 49.8 },
  "18650": { label: "18650", type: "cyl", d: 18.6, h: 65.2 },
  "20700": { label: "20700", type: "cyl", d: 20.4, h: 70.3 },
  "21700": { label: "21700", type: "cyl", d: 21.2, h: 70.5 },
  "26650": { label: "26650", type: "cyl", d: 26.5, h: 65.4 },
  "32700": { label: "32700", type: "cyl", d: 32.3, h: 70.2 },
  "4680":  { label: "4680 (Tesla)", type: "cyl", d: 46.0, h: 80.0 },
  "custom-cyl": { label: "Custom cylindrical…", type: "custom-cyl" },
  "prismatic": { label: "Prismatic / pouch…", type: "prismatic" }
};

/** Typical spacing between cells inside a pack (holders / glue gap), mm. */
const CELL_SPACING_MM = 2;

/**
 * Strip materials for cell interconnects (Pack Connections tab).
 * resistivity: Ω·mm²/m (numerically equal to µΩ·m) at ~20 °C.
 * maxDensity: recommended continuous current density in A/mm² for welded
 * strip inside a pack with limited cooling — conservative rule-of-thumb
 * values, meant as a design limit, not an absolute physical maximum.
 */
const STRIP_MATERIALS = {
  "pure-nickel": {
    label: "Pure nickel (99.6 %)",
    resistivity: 0.0699,
    maxDensity: 10,
    notes: "The standard for spot-welded packs. Corrosion-proof, welds easily, good conductivity."
  },
  "nickel-steel": {
    label: "Nickel-plated steel",
    resistivity: 0.15,
    maxDensity: 4,
    notes: "Much cheaper but ~2× the resistance of pure nickel — runs hotter at the same current. Often sold as “nickel strip”; verify what you buy."
  },
  "nickel-copper": {
    label: "Nickel-plated copper",
    resistivity: 0.0178,
    maxDensity: 25,
    notes: "~4× the conductivity of pure nickel — for high-current packs. Harder to spot-weld (needs more energy or a nickel sandwich)."
  },
  "copper": {
    label: "Copper (bare)",
    resistivity: 0.0172,
    maxDensity: 25,
    notes: "Best conductor, but very hard to spot-weld directly and can corrode; usually used as busbar with nickel tabs."
  },
  "custom": {
    label: "Custom…",
    resistivity: 0.07,
    maxDensity: 8,
    notes: "Enter your own resistivity and current-density limit."
  }
};

/**
 * Categorical series palette (validated for CVD safety and contrast,
 * light + dark). Assigned to packs in fixed slot order, never cycled.
 */
const SERIES_COLORS = {
  light: ["#2a78d6", "#008300", "#e87ba4", "#eda100", "#1baf7a", "#eb6834", "#4a3aa7", "#e34948"],
  dark:  ["#3987e5", "#008300", "#d55181", "#c98500", "#199e70", "#d95926", "#9085e9", "#e66767"]
};
const MAX_SERIES = SERIES_COLORS.light.length;
