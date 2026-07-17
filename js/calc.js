/* WattsUp — pack calculations. All functions are pure; missing inputs yield null outputs. */
"use strict";

/**
 * Compute the physical footprint of one pack (top view) and volume.
 * Cylindrical cells stand upright in an S × P grid (S rows of P cells)
 * with CELL_SPACING_MM between cells and around the edge.
 * Returns null if the size is unknown/incomplete.
 */
function computeGeometry(pack) {
  const size = pack.size ? CELL_SIZES[pack.size] : null;
  const gap = CELL_SPACING_MM;
  const s = pack.s, p = pack.p;

  let cellW = null, cellL = null, cellH = null, shape = null;

  if (size && size.type === "cyl") {
    cellW = cellL = size.d;
    cellH = size.h;
    shape = "cyl";
  } else if (size && size.type === "custom-cyl") {
    if (!pack.diameter || !pack.height) return null;
    cellW = cellL = pack.diameter;
    cellH = pack.height;
    shape = "cyl";
  } else if (size && size.type === "prismatic") {
    if (!pack.plen || !pack.pwid || !pack.phei) return null;
    cellW = pack.pwid;   // width of one cell in the row direction (P)
    cellL = pack.plen;   // length in the S direction
    cellH = pack.phei;
    shape = "prism";
  } else {
    return null;
  }

  const width  = p * cellW + (p + 1) * gap;  // mm, P cells side by side
  const length = s * cellL + (s + 1) * gap;  // mm, S rows
  const height = cellH;                      // mm, cells standing
  return {
    shape, cellW, cellL, cellH,
    width, length, height,
    footprintCm2: (width * length) / 100,
    volumeL: (width * length * height) / 1e6
  };
}

/**
 * Compute all derivable pack metrics from a pack definition.
 * Any metric whose inputs are missing is null.
 */
function computePack(pack) {
  const chem = pack.chemistry ? CHEMISTRIES[pack.chemistry] : null;
  const cells = pack.s * pack.p;

  const vMin = chem ? chem.vMin * pack.s : null;
  const vNom = chem ? chem.vNom * pack.s : null;
  const vMax = chem ? chem.vMax * pack.s : null;

  const capacityAh = pack.capacity ? (pack.capacity * pack.p) / 1000 : null;
  const energyWh = (vNom !== null && capacityAh !== null) ? vNom * capacityAh : null;

  const maxCurrentA = pack.current ? pack.current * pack.p : null;
  const maxPowerW = (vNom !== null && maxCurrentA !== null) ? vNom * maxCurrentA : null;

  const weightKg = pack.weight ? (pack.weight * cells) / 1000 : null;
  const whPerKg = (energyWh !== null && weightKg !== null) ? energyWh / weightKg : null;

  const geo = computeGeometry(pack);
  const whPerL = (energyWh !== null && geo) ? energyWh / geo.volumeL : null;

  const price = (pack.price !== null && pack.price !== undefined) ? pack.price * cells : null;
  const pricePerWh = (price !== null && energyWh) ? price / energyWh : null;

  return {
    cells, chem,
    vMin, vNom, vMax,
    capacityAh, energyWh,
    maxCurrentA, maxPowerW,
    weightKg, whPerKg,
    geo, whPerL,
    price, pricePerWh
  };
}

/**
 * Pack voltage at a given depth of discharge (%), from the chemistry's
 * typical curve, linearly interpolated. Returns null without a chemistry.
 */
function voltageAtDod(pack, dod) {
  const chem = pack.chemistry ? CHEMISTRIES[pack.chemistry] : null;
  if (!chem) return null;
  const curve = chem.curve;
  if (dod <= curve[0][0]) return curve[0][1] * pack.s;
  for (let i = 1; i < curve.length; i++) {
    const [x1, y1] = curve[i - 1];
    const [x2, y2] = curve[i];
    if (dod <= x2) {
      const t = (dod - x1) / (x2 - x1);
      return (y1 + t * (y2 - y1)) * pack.s;
    }
  }
  return curve[curve.length - 1][1] * pack.s;
}

/* ---- formatting helpers ---- */

function fmt(value, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return value.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: digits });
}

function fmtUnit(value, unit, digits = 1) {
  const v = fmt(value, digits);
  return v === "—" ? "—" : `${v} ${unit}`;
}
