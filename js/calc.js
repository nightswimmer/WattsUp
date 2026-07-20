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

/* ================================================================
   Cell Management — charger-log parsing and pack grouping.
   All functions are pure (no DOM) so they can be unit-tested in Node.
   ================================================================ */

/** Median of a non-empty numeric array. */
function median(values) {
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Scaled median absolute deviation (robust stand-in for the std deviation). */
function medianAbsDev(values, med = median(values)) {
  return 1.4826 * median(values.map(v => Math.abs(v - med)));
}

/**
 * Map a charger-log filename to real cell numbers.
 * "1-4.csv" → {start:1, end:4}; "cells 5-8 (retest).csv" → {start:5, end:8};
 * "12.csv" → {start:12, end:12}. Returns null when no number is found.
 */
function cellRangeFromFilename(name) {
  const base = String(name).replace(/\.[^.]*$/, "");
  const ranges = [...base.matchAll(/(\d+)\s*[-–_]\s*(\d+)/g)];
  if (ranges.length) {
    const m = ranges[ranges.length - 1];
    const a = parseInt(m[1], 10), b = parseInt(m[2], 10);
    if (a > 0 && b >= a) return { start: a, end: b };
  }
  const single = base.match(/(\d+)(?!.*\d)/);
  if (single) {
    const n = parseInt(single[1], 10);
    if (n > 0) return { start: n, end: n };
  }
  return null;
}

/**
 * Parse a charger/analyzer CSV log (written for the SkyRC MC5000, but
 * deliberately tolerant: delimiter, header row and column layout are
 * auto-detected, units converted from header hints).
 *
 * Understands two shapes:
 *   - long: one row per sample with a Slot/Channel column
 *   - wide: per-slot numbered columns ("Voltage1", "Slot 2 Capacity(mAh)", …)
 * A file with neither is treated as a single-slot log.
 *
 * Returns { slots: [{slot, capacity, ir, vEnd, samples}], warnings: [] }
 *   capacity — final capacity in mAh (max of the accumulating column)
 *   ir       — median internal resistance in mΩ, or null
 *   vEnd     — last logged voltage in V, or null
 * Throws Error with a friendly message when the file can't be understood.
 */
function parseCellCsv(text) {
  const warnings = [];
  const lines = String(text).replace(/^﻿/, "").split(/\r\n|\r|\n/);

  // -- locate the header row and the delimiter that splits it best --
  const KNOWN = /(slot|channel|\bbay\b|volt|curr|\bcap|m?ah\b|time|elapsed|resist|m?ohm|\bir\b|temp|mode|status)/i;
  let best = null;   // {line, delim, score}
  const delims = [",", ";", "\t"];
  for (let i = 0; i < Math.min(lines.length, 40); i++) {
    if (!lines[i].trim()) continue;
    for (const d of delims) {
      const cells = lines[i].split(d);
      if (cells.length < 2) continue;
      const score = cells.filter(c => KNOWN.test(c)).length;
      if (score >= 2 && (!best || score > best.score)) best = { line: i, delim: d, score };
    }
  }
  if (!best) throw new Error("no recognizable header row (expected columns like Slot, Voltage, Capacity)");

  const delim = best.delim;
  const header = lines[best.line].split(delim).map(h => h.trim());
  const lower = header.map(h => h.toLowerCase());

  // -- map columns --
  const findCol = re => lower.findIndex(h => re.test(h));
  const col = {
    slot: findCol(/^(slot|channel|ch\b|bay)/),
    voltage: findCol(/volt|^u\s*[(\[]|^v\s*[(\[]/),
    current: findCol(/current|^i\s*[(\[]|amps?\b/),
    capacity: findCol(/\bcap|m?ah\b/),
    ir: findCol(/resist|m?ohm|\bir\b/),
  };

  // unit hints from the header text
  const unit = (i, re) => i >= 0 && re.test(lower[i]);
  const mV = unit(col.voltage, /\bmv\b|\(mv\)/);
  const ahOnly = unit(col.capacity, /\(ah\)|\bah\b/) && !unit(col.capacity, /mah/);
  const ohmOnly = unit(col.ir, /\(ohm|\bohms?\b/) && !unit(col.ir, /mohm|mΩ/);

  // -- wide format? per-slot numbered columns --
  const wide = new Map();   // slot → {voltage, capacity, ir}
  if (col.slot < 0) {
    lower.forEach((h, i) => {
      let m = h.match(/^(?:slot|channel|ch|bay)\s*#?\s*(\d+)/);
      let slot = m ? parseInt(m[1], 10) : null;
      if (slot === null) {
        m = h.match(/(\d+)\s*(?:[(\[][^)\]]*[)\]])?\s*$/);   // "voltage1", "capacity2(mah)"
        if (m && /volt|cap|curr|resist|ir\b/.test(h)) slot = parseInt(m[1], 10);
      }
      if (slot === null || slot < 1 || slot > 32) return;
      const entry = wide.get(slot) || {};
      if (/volt/.test(h) && entry.voltage === undefined) entry.voltage = i;
      if (/cap|m?ah\b/.test(h) && entry.capacity === undefined) entry.capacity = i;
      if (/resist|m?ohm|\bir\b/.test(h) && entry.ir === undefined) entry.ir = i;
      wide.set(slot, entry);
    });
    for (const [slot, entry] of wide) {
      if (entry.capacity === undefined && entry.voltage === undefined) wide.delete(slot);
    }
  }

  if (col.slot < 0 && wide.size === 0 && col.capacity < 0) {
    throw new Error("no capacity column found (expected something like Capacity(mAh))");
  }

  // -- collect samples per slot --
  const slots = new Map();  // slot → {caps: [], irs: [], volts: [], samples: 0}
  const bucket = slot => {
    if (!slots.has(slot)) slots.set(slot, { caps: [], irs: [], volts: [], samples: 0 });
    return slots.get(slot);
  };
  const num = v => {
    if (v === undefined) return null;
    const n = parseFloat(String(v).replace(",", "."));
    return Number.isFinite(n) ? n : null;
  };

  for (let i = best.line + 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const cells = lines[i].split(delim);
    if (wide.size > 0) {
      for (const [slot, entry] of wide) {
        const b = bucket(slot);
        const cap = num(cells[entry.capacity]);
        const v = num(cells[entry.voltage]);
        const ir = num(cells[entry.ir]);
        if (cap !== null) b.caps.push(cap);
        if (v !== null) b.volts.push(v);
        if (ir !== null && ir > 0) b.irs.push(ir);
        if (cap !== null || v !== null) b.samples++;
      }
    } else {
      const slot = col.slot >= 0 ? num(cells[col.slot]) : 1;
      if (slot === null || !Number.isInteger(slot) || slot < 1 || slot > 32) continue;
      const b = bucket(slot);
      const cap = col.capacity >= 0 ? num(cells[col.capacity]) : null;
      const v = col.voltage >= 0 ? num(cells[col.voltage]) : null;
      const ir = col.ir >= 0 ? num(cells[col.ir]) : null;
      if (cap === null && v === null) continue;   // footer / text row
      if (cap !== null) b.caps.push(cap);
      if (v !== null) b.volts.push(v);
      if (ir !== null && ir > 0) b.irs.push(ir);
      b.samples++;
    }
  }
  if (slots.size === 0) throw new Error("a header was found but no data rows could be read");

  // -- reduce each slot to a summary --
  const out = [];
  for (const [slot, b] of [...slots.entries()].sort((a, z) => a[0] - z[0])) {
    let capacity = b.caps.length ? Math.max(...b.caps) : null;
    if (capacity !== null) {
      if (ahOnly || capacity < 20) {   // header said Ah, or values are clearly in Ah
        capacity *= 1000;
        if (!ahOnly) warnings.push(`slot ${slot}: capacity looked like Ah — converted to mAh`);
      }
    } else {
      warnings.push(`slot ${slot}: no capacity data`);
    }
    let ir = b.irs.length ? median(b.irs) : null;
    if (ir !== null && (ohmOnly || ir < 1)) ir *= 1000;
    let vEnd = b.volts.length ? b.volts[b.volts.length - 1] : null;
    if (vEnd !== null && (mV || vEnd > 100)) vEnd /= 1000;
    out.push({
      slot,
      capacity: capacity !== null ? Math.round(capacity) : null,
      ir: ir !== null ? Math.round(ir * 10) / 10 : null,
      vEnd: vEnd !== null ? Math.round(vEnd * 1000) / 1000 : null,
      samples: b.samples
    });
  }
  return { slots: out, warnings };
}

/**
 * Distribute cells over S groups of exactly P, balancing group capacity.
 * Greedy LPT (largest first into the emptiest non-full group), then a
 * bounded swap-refinement pass between the richest and poorest groups.
 * Returns [{cells, sum}] — cells sorted by id inside each group.
 */
function balanceCellGroups(cells, s, p) {
  const sorted = [...cells].sort((a, b) => b.capacity - a.capacity);
  const groups = Array.from({ length: s }, () => ({ cells: [], sum: 0 }));
  for (const c of sorted) {
    let target = null;
    for (const g of groups) {
      if (g.cells.length < p && (target === null || g.sum < target.sum)) target = g;
    }
    target.cells.push(c);
    target.sum += c.capacity;
  }

  // swap refinement: move capacity from the richest to the poorest group
  for (let iter = 0; iter < 200; iter++) {
    let hi = groups[0], lo = groups[0];
    for (const g of groups) {
      if (g.sum > hi.sum) hi = g;
      if (g.sum < lo.sum) lo = g;
    }
    const gap = hi.sum - lo.sum;
    if (gap < 1) break;
    let bestSwap = null;   // swap a (rich) ↔ b (poor), ideal transfer = gap/2
    for (const a of hi.cells) {
      for (const b of lo.cells) {
        const d = a.capacity - b.capacity;
        if (d <= 0 || d >= gap) continue;          // must shrink the gap
        const score = Math.abs(d - gap / 2);
        if (!bestSwap || score < bestSwap.score) bestSwap = { a, b, score };
      }
    }
    if (!bestSwap) break;
    hi.cells[hi.cells.indexOf(bestSwap.a)] = bestSwap.b;
    lo.cells[lo.cells.indexOf(bestSwap.b)] = bestSwap.a;
    hi.sum += bestSwap.b.capacity - bestSwap.a.capacity;
    lo.sum += bestSwap.a.capacity - bestSwap.b.capacity;
  }

  for (const g of groups) g.cells.sort((a, b) => a.id - b.id);
  return groups;
}

/**
 * Plan an S×P pack from a set of measured cells.
 * Discards the surplus cells (worst first): internal-resistance outliers,
 * then the lowest capacities. The kept cells are balanced into S parallel
 * groups of P; pack capacity = the weakest group's sum.
 *
 * cells: [{id, capacity (mAh), ir (mΩ|null)}] — pre-filtered (no exclusions).
 * Returns {ok:false, needed, available, reason} or
 *   {ok:true, needed, groups:[{cells, sum, effIr}], discarded:[{cell, reason}],
 *    capacityAh, groupMin, groupMax, groupMean, spreadPct, packIr}
 */
function planCellPack(cells, s, p) {
  const needed = s * p;
  const usable = cells.filter(c => Number.isFinite(c.capacity) && c.capacity > 0);
  if (usable.length < needed) {
    return {
      ok: false, needed, available: usable.length,
      reason: `the ${s}S${p}P pack needs ${needed} cells but only ${usable.length} usable cells are loaded`
    };
  }

  const discarded = [];
  let pool = [...usable];

  // 1) internal-resistance outliers (only when we can afford to drop them
  //    and there is enough IR data for a robust median)
  const irs = pool.filter(c => Number.isFinite(c.ir)).map(c => c.ir);
  let spare = pool.length - needed;
  if (spare > 0 && irs.length >= Math.min(8, pool.length)) {
    const med = median(irs);
    const threshold = med + Math.max(3.5 * medianAbsDev(irs, med), 0.3 * med);
    const outliers = pool
      .filter(c => Number.isFinite(c.ir) && c.ir > threshold)
      .sort((a, b) => b.ir - a.ir)
      .slice(0, spare);
    for (const c of outliers) {
      discarded.push({ cell: c, reason: `high internal resistance (${fmt(c.ir, 1)} mΩ vs. median ${fmt(med, 1)} mΩ)` });
    }
    const drop = new Set(outliers);
    pool = pool.filter(c => !drop.has(c));
  }

  // 2) lowest capacities
  pool.sort((a, b) => a.capacity - b.capacity);
  spare = pool.length - needed;
  for (const c of pool.slice(0, spare)) {
    discarded.push({ cell: c, reason: `lowest capacity (${fmt(c.capacity, 0)} mAh)` });
  }
  pool = pool.slice(spare);

  const groups = balanceCellGroups(pool, s, p).map(g => {
    const haveIr = g.cells.every(c => Number.isFinite(c.ir) && c.ir > 0);
    return {
      cells: g.cells,
      sum: g.sum,
      effIr: haveIr ? 1 / g.cells.reduce((acc, c) => acc + 1 / c.ir, 0) : null
    };
  });

  const sums = groups.map(g => g.sum);
  const groupMin = Math.min(...sums);
  const groupMax = Math.max(...sums);
  const groupMean = sums.reduce((a, b) => a + b, 0) / sums.length;
  return {
    ok: true, needed, groups, discarded,
    capacityAh: groupMin / 1000,
    groupMin, groupMax, groupMean,
    spreadPct: groupMean > 0 ? ((groupMax - groupMin) / groupMean) * 100 : 0,
    packIr: groups.every(g => g.effIr !== null) ? groups.reduce((a, g) => a + g.effIr, 0) : null
  };
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
