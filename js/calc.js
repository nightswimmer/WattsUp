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

/**
 * Solve the interconnect-strip network of two parallel groups in series
 * (the repeating unit of any S ≥ 2 pack).
 *
 * Model (matches the reference drawing): each group's P cells sit on a bus
 * strip; the two strips are joined by max(1, P−1) series bridges placed at
 * the midpoints between adjacent cells. Every cell is assumed to source an
 * equal share I/P (ideal, balanced cells). Nodal analysis on the resistor
 * network then gives the current in every strip segment and bridge.
 *
 * Inputs: { p, current, rHalf, rBridge }
 *   p       — cells per parallel group (≥ 1)
 *   current — total pack current I (A)
 *   rHalf   — resistance of one half-pitch bus segment (cell → midpoint), Ω
 *   rBridge — resistance of one series bridge, Ω
 *
 * Returns { segA, segB, bridges, vDrop, rEff, powerW }
 *   segA/segB — per half-segment current (A), left→right, length 2(P−1)
 *   bridges   — per series-bridge current (A), length max(1, P−1)
 *   vDrop     — mean potential drop from group A cells to group B cells (V)
 *   rEff      — effective interconnect resistance vDrop / I (Ω)
 *   powerW    — total power dissipated in the interconnect (W)
 */
function solveStripNetwork({ p, current, rHalf, rBridge }) {
  const iCell = current / p;

  if (p === 1) {
    // Degenerate case: one cell per group, a single bridge carries everything.
    const vDrop = current * rBridge;
    return { segA: [], segB: [], bridges: [current], vDrop, rEff: rBridge, powerW: current * vDrop };
  }

  // Node layout per row: a0, m0, a1, m1, …, a(P−1) → 2P−1 nodes.
  // Row A occupies indices [0, 2P−2], row B the same layout offset by 2P−1.
  const rowN = 2 * p - 1;
  const n = 2 * rowN;
  const aNode = i => 2 * i;            // cell i of row A
  const mNodeA = i => 2 * i + 1;       // midpoint between cells i, i+1 of row A
  const bNode = i => rowN + 2 * i;
  const mNodeB = i => rowN + 2 * i + 1;

  const G = Array.from({ length: n }, () => new Float64Array(n));
  const rhs = new Float64Array(n);
  const edges = [];

  function addEdge(u, v, r) {
    const g = 1 / r;
    G[u][u] += g; G[v][v] += g;
    G[u][v] -= g; G[v][u] -= g;
    edges.push([u, v, r]);
  }

  for (let i = 0; i < p - 1; i++) {
    addEdge(aNode(i), mNodeA(i), rHalf);
    addEdge(mNodeA(i), aNode(i + 1), rHalf);
    addEdge(bNode(i), mNodeB(i), rHalf);
    addEdge(mNodeB(i), bNode(i + 1), rHalf);
    addEdge(mNodeA(i), mNodeB(i), rBridge);
  }
  for (let i = 0; i < p; i++) {
    rhs[aNode(i)] += iCell;   // cells feed the A strip…
    rhs[bNode(i)] -= iCell;   // …and drain through the B cells
  }

  // Ground node b0 (fix V = 0) so the system is non-singular.
  // Other rows keep their coupling terms in the gnd column; they multiply V[gnd] = 0.
  const gnd = bNode(0);
  G[gnd].fill(0);
  G[gnd][gnd] = 1;
  rhs[gnd] = 0;

  const V = gaussSolve(G, rhs);

  const edgeCurrent = (u, v, r) => (V[u] - V[v]) / r;
  const segA = [], segB = [], bridges = [];
  for (let i = 0; i < p - 1; i++) {
    segA.push(edgeCurrent(aNode(i), mNodeA(i), rHalf), edgeCurrent(mNodeA(i), aNode(i + 1), rHalf));
    segB.push(edgeCurrent(bNode(i), mNodeB(i), rHalf), edgeCurrent(mNodeB(i), bNode(i + 1), rHalf));
    bridges.push(edgeCurrent(mNodeA(i), mNodeB(i), rBridge));
  }

  let meanA = 0, meanB = 0;
  for (let i = 0; i < p; i++) { meanA += V[aNode(i)]; meanB += V[bNode(i)]; }
  const vDrop = (meanA - meanB) / p;     // equal cell currents ⇒ power in = I · vDrop
  const powerW = current * vDrop;
  return { segA, segB, bridges, vDrop, rEff: current > 0 ? vDrop / current : 0, powerW };
}

/**
 * Solve the pack-output collector strip — the strip on the B group's far
 * terminal where the pack's output cable is attached (only meaningful when
 * B is the last group of the series chain).
 *
 * Each of the P cells delivers its equal share I/P into the strip at its
 * weld position; the cable taps the strip at the given midpoint indices
 * (0 … P−2), all taps joined by an ideal lead. Solving the line network
 * gives the current in every half-segment and the share of each tap.
 *
 * Inputs: { p, current, rHalf, taps }
 * Returns null when p < 2 or no valid taps; otherwise
 *   { seg, outAt, vDrop, rEff, powerW }
 *   seg   — per half-segment current (A), left→right, length 2(P−1)
 *   outAt — per-midpoint tap current (A), null where not a tap
 *   vDrop — mean potential drop from the cells to the taps (V)
 */
function solveOutputStrip({ p, current, rHalf, taps }) {
  const list = Array.isArray(taps)
    ? [...new Set(taps.filter(i => Number.isInteger(i) && i >= 0 && i < p - 1))]
    : [];
  if (p < 2 || list.length === 0) return null;

  const iCell = current / p;
  const tapSet = new Set(list);
  // Nodes: c0, m0, c1, m1, …, c(P−1) → 2P−1, plus terminal T for the joined
  // taps. Tapped midpoints map to T; their unused ids stay at 0 V, unreferenced.
  const rowN = 2 * p - 1;
  const T = rowN;
  const n = rowN + 1;
  const cNode = i => 2 * i;
  const mNode = i => (tapSet.has(i) ? T : 2 * i + 1);

  const G = Array.from({ length: n }, () => new Float64Array(n));
  const rhs = new Float64Array(n);
  function addEdge(u, v) {
    const g = 1 / rHalf;
    G[u][u] += g; G[v][v] += g;
    G[u][v] -= g; G[v][u] -= g;
  }
  for (let i = 0; i < p - 1; i++) {
    addEdge(cNode(i), mNode(i));
    addEdge(mNode(i), cNode(i + 1));
  }
  for (let i = 0; i < p; i++) rhs[cNode(i)] += iCell;
  G[T].fill(0);
  G[T][T] = 1;
  rhs[T] = 0;                     // T grounded — it absorbs the pack current

  const V = gaussSolve(G, rhs);

  const seg = [], outAt = [];
  for (let i = 0; i < p - 1; i++) {
    seg.push((V[cNode(i)] - V[mNode(i)]) / rHalf, (V[mNode(i)] - V[cNode(i + 1)]) / rHalf);
    outAt.push(tapSet.has(i) ? seg[2 * i] - seg[2 * i + 1] : null);
  }
  let meanC = 0;
  for (let i = 0; i < p; i++) meanC += V[cNode(i)];
  const vDrop = meanC / p;
  return { seg, outAt, vDrop, rEff: current > 0 ? vDrop / current : 0, powerW: current * vDrop };
}

/** In-place Gaussian elimination with partial pivoting. A: array of Float64Array rows. */
function gaussSolve(A, b) {
  const n = b.length;
  const x = Float64Array.from(b);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    if (piv !== col) {
      [A[col], A[piv]] = [A[piv], A[col]];
      const t = x[col]; x[col] = x[piv]; x[piv] = t;
    }
    const d = A[col][col];
    if (Math.abs(d) < 1e-15) continue;   // shouldn't happen on a grounded network
    for (let r = col + 1; r < n; r++) {
      const f = A[r][col] / d;
      if (f === 0) continue;
      for (let c = col; c < n; c++) A[r][c] -= f * A[col][c];
      x[r] -= f * x[col];
    }
  }
  for (let r = n - 1; r >= 0; r--) {
    let s = x[r];
    for (let c = r + 1; c < n; c++) s -= A[r][c] * x[c];
    x[r] = Math.abs(A[r][r]) < 1e-15 ? 0 : s / A[r][r];
  }
  return x;
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
