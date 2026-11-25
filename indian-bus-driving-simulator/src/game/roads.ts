// Road network, spatial queries and GPS navigation
export type RoadType = 'city' | 'highway' | 'rural' | 'mountain' | 'town' | 'village';

export interface RoadTypeSpec { lanes: number; laneW: number; median: number; width: number; limit: number; traffic: number; condition: number }

export const ROAD_SPECS: Record<RoadType, RoadTypeSpec> = {
  city: { lanes: 1, laneW: 3.7, median: 0, width: 9.5, limit: 40, traffic: 0.8, condition: 0.7 },
  highway: { lanes: 2, laneW: 3.7, median: 1.4, width: 17, limit: 80, traffic: 0.45, condition: 0.95 },
  rural: { lanes: 1, laneW: 3.5, median: 0, width: 8, limit: 50, traffic: 0.2, condition: 0.45 },
  mountain: { lanes: 1, laneW: 3.5, median: 0, width: 8, limit: 35, traffic: 0.15, condition: 0.55 },
  town: { lanes: 1, laneW: 3.6, median: 0, width: 9, limit: 30, traffic: 0.6, condition: 0.6 },
  village: { lanes: 1, laneW: 3.3, median: 0, width: 7, limit: 25, traffic: 0.3, condition: 0.35 },
};

export const RIVER_Z = -450;
export const RAIL_Z = 500;

export interface P3 { x: number; y: number; z: number }
export interface RoadNode { id: string; x: number; z: number; edges: number[]; signal: boolean }
export interface RoadEdge {
  id: number; a: string; b: string; type: RoadType; name: string;
  lanes: number; laneW: number; median: number; width: number; limit: number; traffic: number; condition: number;
  pts: P3[]; cum: number[]; len: number;
}

export function bridgeHeight(_x: number, z: number): number {
  const d = Math.abs(z - RIVER_Z);
  if (d > 70) return 0;
  if (d < 30) return 4.5;
  const t = (70 - d) / 40;
  return 4.5 * t * t * (3 - 2 * t);
}

const NODES: [string, number, number][] = [];
const xs = [-180, -60, 60, 180];
for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) NODES.push([`c${i}${j}`, xs[i], xs[j]]);
NODES.push(
  ['hwA', 450, 60], ['hwB', 1050, 60], ['rW', 1400, 60], ['rC', 1500, 60], ['rE', 1600, 60], ['rN', 1500, -40], ['rS', 1500, 160],
  ['vR1', -70, 465], ['vR2', -80, 540], ['v0', -100, 900], ['v1', -230, 900], ['v2', -100, 1010],
  ['k0', 650, 900], ['rs1', 1500, 880], ['rs2', 1500, 545], ['rs3', 1500, 455],
  ['mA', 60, -380], ['mB', 60, -520], ['m0', 300, -1300], ['m1', 420, -1300], ['m2', 300, -1420],
  ['nA', 1500, -520], ['nB', 1500, -380],
);

type EdgeDef = [string, string, RoadType, string, [number, number][]?, Partial<RoadTypeSpec>?];
const H = ['Nehru Marg', 'MG Road', 'Station Road', 'Gandhi Chowk Road'];
const V = ['Tilak Marg', 'Subhash Road', 'Patel Road', 'Ashoka Road'];
const EDGE_DEFS: EdgeDef[] = [];
for (let j = 0; j < 4; j++) for (let i = 0; i < 3; i++) EDGE_DEFS.push([`c${i}${j}`, `c${i + 1}${j}`, 'city', H[j], undefined, j === 1 ? { traffic: 0.95 } : undefined]);
for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) EDGE_DEFS.push([`c${i}${j}`, `c${i}${j + 1}`, 'city', V[i], undefined, i === 1 ? { traffic: 1, condition: 0.5 } : undefined]);
EDGE_DEFS.push(
  ['c32', 'hwA', 'highway', 'NH-48 Highway'],
  ['hwA', 'hwB', 'highway', 'NH-48 Highway'],
  ['hwB', 'rW', 'highway', 'NH-48 Highway'],
  ['rW', 'rC', 'town', 'Rampur Main Road'],
  ['rC', 'rE', 'town', 'Rampur Bazaar'],
  ['rC', 'rN', 'town', 'Mandi Road'],
  ['rC', 'rS', 'town', 'Kachehri Road'],
  ['c13', 'vR1', 'rural', 'Gaon Marg SH-12', [[-40, 300], [-90, 400]]],
  ['vR1', 'vR2', 'rural', 'Gaon Marg SH-12'],
  ['vR2', 'v0', 'rural', 'Gaon Marg SH-12', [[-50, 650], [-120, 780]]],
  ['v0', 'v1', 'village', 'Sitapur Bazaar'],
  ['v0', 'v2', 'village', 'Panchayat Lane'],
  ['v0', 'k0', 'rural', 'Khetpur Road', [[150, 950], [400, 870]]],
  ['k0', 'rs1', 'rural', 'Khetpur Road', [[900, 940], [1200, 870]], { condition: 0.3 }],
  ['rs1', 'rs2', 'rural', 'Rampur Link Road', [[1530, 700]]],
  ['rs2', 'rs3', 'rural', 'Rampur Link Road'],
  ['rs3', 'rS', 'rural', 'Rampur Link Road', [[1480, 300]]],
  ['c20', 'mA', 'rural', 'Ghat Road', undefined, { limit: 40 }],
  ['mA', 'mB', 'rural', 'Ganga Setu Bridge', undefined, { limit: 40 }],
  ['mB', 'm0', 'mountain', 'Himgiri Ghat Road', [[140, -650], [30, -780], [180, -900], [60, -1020], [230, -1150]]],
  ['m0', 'm1', 'town', 'Mall Road'],
  ['m0', 'm2', 'town', 'Cantt Road'],
  ['m1', 'nA', 'mountain', 'Nadi Ghat Road', [[650, -1150], [900, -950], [1120, -760], [1380, -680], [1490, -610]], { limit: 45 }],
  ['nA', 'nB', 'rural', 'Rampur Setu Bridge'],
  ['nB', 'rN', 'rural', 'Rampur Setu Road'],
);

export const nodes = new Map<string, RoadNode>();
export const edges: RoadEdge[] = [];

function catmull(p0: number[], p1: number[], p2: number[], p3: number[], t: number) {
  const t2 = t * t, t3 = t2 * t;
  return [0, 1].map(k => 0.5 * ((2 * p1[k]) + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3));
}

for (const [id, x, z] of NODES) nodes.set(id, { id, x, z, edges: [], signal: false });

for (const def of EDGE_DEFS) {
  const [a, b, type, name, ctrl, over] = def;
  const na = nodes.get(a)!, nb = nodes.get(b)!;
  const spec = { ...ROAD_SPECS[type], ...(over || {}) };
  const raw: number[][] = [];
  const control = [[na.x, na.z], ...(ctrl || []), [nb.x, nb.z]];
  if (ctrl && ctrl.length) {
    const ext = [
      [2 * control[0][0] - control[1][0], 2 * control[0][1] - control[1][1]],
      ...control,
      [2 * control[control.length - 1][0] - control[control.length - 2][0], 2 * control[control.length - 1][1] - control[control.length - 2][1]],
    ];
    for (let i = 1; i < ext.length - 2; i++) {
      const segLen = Math.hypot(ext[i + 1][0] - ext[i][0], ext[i + 1][1] - ext[i][1]);
      const n = Math.max(4, Math.ceil(segLen / 6));
      for (let k = 0; k < n; k++) raw.push(catmull(ext[i - 1], ext[i], ext[i + 1], ext[i + 2], k / n));
    }
    raw.push(control[control.length - 1]);
  } else {
    for (let i = 0; i < control.length - 1; i++) {
      const segLen = Math.hypot(control[i + 1][0] - control[i][0], control[i + 1][1] - control[i][1]);
      const n = Math.max(1, Math.ceil(segLen / 10));
      for (let k = 0; k < n; k++) raw.push([control[i][0] + (control[i + 1][0] - control[i][0]) * k / n, control[i][1] + (control[i + 1][1] - control[i][1]) * k / n]);
    }
    raw.push(control[control.length - 1]);
  }
  const pts: P3[] = raw.map(([x, z]) => ({ x, y: bridgeHeight(x, z), z }));
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
  const e: RoadEdge = { id: edges.length, a, b, type, name, ...spec, pts, cum, len: cum[cum.length - 1] };
  edges.push(e);
  na.edges.push(e.id); nb.edges.push(e.id);
}

// signals at busy junctions
for (const n of nodes.values()) {
  const cityNode = n.id.startsWith('c') && n.edges.length >= 3;
  if (cityNode || n.id === 'rC') n.signal = true;
}

// ---------- sampling ----------
export interface Sample { x: number; y: number; z: number; dx: number; dz: number }
export function sampleEdge(e: RoadEdge, s: number): Sample {
  s = Math.max(0, Math.min(e.len, s));
  let lo = 0, hi = e.cum.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (e.cum[m] <= s) lo = m; else hi = m; }
  const p = e.pts[lo], q = e.pts[hi];
  const L = e.cum[hi] - e.cum[lo] || 1;
  const t = (s - e.cum[lo]) / L;
  const dx = (q.x - p.x) / L, dz = (q.z - p.z) / L;
  return { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t, z: p.z + (q.z - p.z) * t, dx, dz };
}

/** position of a lane, dir=+1 a->b, dir=-1 b->a; s measured along travel direction */
export function lanePos(e: RoadEdge, dir: number, s: number, lane: number, offset = 0) {
  const sm = dir > 0 ? s : e.len - s;
  const p = sampleEdge(e, sm);
  const dx = p.dx * dir, dz = p.dz * dir;
  const off = e.median / 2 + (lane + 0.5) * e.laneW + offset;
  // left of travel direction = (dz, -dx)
  return { x: p.x + dz * off, y: p.y, z: p.z - dx * off, dx, dz };
}

// ---------- spatial grid ----------
interface Seg { e: number; i: number; ax: number; az: number; bx: number; bz: number; ay: number; by: number; len: number }
const segs: Seg[] = [];
const CELL = 40;
const grid = new Map<string, number[]>();
for (const e of edges) {
  for (let i = 0; i < e.pts.length - 1; i++) {
    const p = e.pts[i], q = e.pts[i + 1];
    const sg: Seg = { e: e.id, i, ax: p.x, az: p.z, bx: q.x, bz: q.z, ay: p.y, by: q.y, len: Math.hypot(q.x - p.x, q.z - p.z) };
    const idx = segs.length; segs.push(sg);
    const pad = 20;
    const x0 = Math.floor((Math.min(p.x, q.x) - pad) / CELL), x1 = Math.floor((Math.max(p.x, q.x) + pad) / CELL);
    const z0 = Math.floor((Math.min(p.z, q.z) - pad) / CELL), z1 = Math.floor((Math.max(p.z, q.z) + pad) / CELL);
    for (let gx = x0; gx <= x1; gx++) for (let gz = z0; gz <= z1; gz++) {
      const k = gx + ',' + gz; let arr = grid.get(k); if (!arr) { arr = []; grid.set(k, arr); } arr.push(idx);
    }
  }
}

export interface RoadHit { edge: RoadEdge; dist: number; s: number; x: number; y: number; z: number; dx: number; dz: number; lateral: number }

function projectSeg(sg: Seg, x: number, z: number) {
  const vx = sg.bx - sg.ax, vz = sg.bz - sg.az;
  const L2 = vx * vx + vz * vz || 1;
  let t = ((x - sg.ax) * vx + (z - sg.az) * vz) / L2;
  t = Math.max(0, Math.min(1, t));
  const px = sg.ax + vx * t, pz = sg.az + vz * t;
  return { t, px, pz, d: Math.hypot(x - px, z - pz) };
}

function hitFrom(sg: Seg, x: number, z: number, pr: { t: number; px: number; pz: number; d: number }): RoadHit {
  const e = edges[sg.e];
  const dx = (sg.bx - sg.ax) / (sg.len || 1), dz = (sg.bz - sg.az) / (sg.len || 1);
  const lateral = (x - pr.px) * dz + (z - pr.pz) * -dx; // + = left of a->b
  return { edge: e, dist: pr.d, s: e.cum[sg.i] + pr.t * sg.len, x: pr.px, y: sg.ay + (sg.by - sg.ay) * pr.t, z: pr.pz, dx, dz, lateral };
}

export function queryRoad(x: number, z: number): RoadHit | null {
  const arr = grid.get(Math.floor(x / CELL) + ',' + Math.floor(z / CELL));
  if (!arr) return null;
  let best: Seg | null = null, bp: ReturnType<typeof projectSeg> | null = null;
  for (const idx of arr) {
    const sg = segs[idx];
    const pr = projectSeg(sg, x, z);
    if (!bp || pr.d < bp.d) { bp = pr; best = sg; }
  }
  if (!best || !bp) return null;
  return hitFrom(best, x, z, bp);
}

export function nearestRoadBrute(x: number, z: number): RoadHit {
  let best = segs[0], bp = projectSeg(segs[0], x, z);
  for (const sg of segs) { const pr = projectSeg(sg, x, z); if (pr.d < bp.d) { bp = pr; best = sg; } }
  return hitFrom(best, x, z, bp);
}

/** max height of road surface near point (handles bridges); returns -1 if off road */
export function roadSurface(x: number, z: number): { y: number; on: boolean; hit: RoadHit | null } {
  const h = queryRoad(x, z);
  if (h && h.dist < h.edge.width / 2 + 0.6) return { y: h.y, on: true, hit: h };
  // check junction patches
  return { y: 0, on: false, hit: h };
}

export function nearNode(x: number, z: number, r: number): RoadNode | null {
  for (const n of nodes.values()) if (Math.abs(n.x - x) < r && Math.abs(n.z - z) < r && Math.hypot(n.x - x, n.z - z) < r) return n;
  return null;
}

export function zoneAt(x: number, z: number): 'city' | 'town' | 'village' | 'hill' | 'mountain' | 'rural' | 'highway' {
  if (Math.abs(x) < 250 && Math.abs(z) < 250) return 'city';
  if (x > 1340 && x < 1680 && z > -120 && z < 240) return 'town';
  if (x > -320 && x < 100 && z > 820 && z < 1090) return 'village';
  if (x > 160 && x < 540 && z > -1490 && z < -1180) return 'hill';
  if (z < -560) return 'mountain';
  if (Math.abs(z - 60) < 120 && x > 250 && x < 1340) return 'highway';
  return 'rural';
}

// ---------- stops ----------
export interface StopDef { id: string; name: string; hindi: string; x: number; z: number }
export const STOP_DEFS: StopDef[] = [
  { id: 'central', name: 'Central Bus Stand', hindi: 'केंद्रीय बस अड्डा', x: 0, z: 52 },
  { id: 'market', name: 'Sadar Bazaar', hindi: 'सदर बाज़ार', x: -68, z: 0 },
  { id: 'school', name: 'Govt. School', hindi: 'सरकारी विद्यालय', x: -120, z: 68 },
  { id: 'hospital', name: 'City Hospital', hindi: 'सिटी अस्पताल', x: 120, z: -68 },
  { id: 'dhaba', name: 'Highway Dhaba', hindi: 'हाईवे ढाबा', x: 950, z: 48 },
  { id: 'rampur', name: 'Rampur Bus Stand', hindi: 'रामपुर बस स्टैंड', x: 1450, z: 52 },
  { id: 'sitapur', name: 'Sitapur Village', hindi: 'सीतापुर गाँव', x: -165, z: 908 },
  { id: 'khetpur', name: 'Khetpur Chauraha', hindi: 'खेतपुर चौराहा', x: 760, z: 935 },
  { id: 'ghat', name: 'Pahadi Mod', hindi: 'पहाड़ी मोड़', x: 69, z: -330 },
  { id: 'deodar', name: 'Deodar Point', hindi: 'देवदार पॉइंट', x: 190, z: -905 },
  { id: 'hillstation', name: 'Himgiri Hill Station', hindi: 'हिमगिरि', x: 360, z: -1292 },
  { id: 'nadighat', name: 'Nadi Ghat', hindi: 'नदी घाट', x: 1128, z: -752 },
];

export interface Stop extends StopDef { edge: RoadEdge; s: number; rx: number; rz: number; sx: number; sz: number; side: number; dirx: number; dirz: number }
export const stops: Stop[] = STOP_DEFS.map(d => {
  const h = nearestRoadBrute(d.x, d.z);
  const side = h.lateral >= 0 ? 1 : -1;
  const off = h.edge.width / 2 + 3;
  const lx = h.dz, lz = -h.dx;
  return { ...d, edge: h.edge, s: h.s, rx: h.x, rz: h.z, sx: h.x + lx * off * side, sz: h.z + lz * off * side, side, dirx: h.dx, dirz: h.dz };
});
export const stopById = (id: string) => stops.find(s => s.id === id)!;

// ---------- GPS ----------
export type RouteOption = 'fastest' | 'shortest' | 'traffic' | 'road';
export const ROUTE_OPTION_LABEL: Record<RouteOption, string> = { fastest: 'Fastest', shortest: 'Shortest', traffic: 'Least Traffic', road: 'Best Road' };

function edgeCostScale(e: RoadEdge, opt: RouteOption) {
  switch (opt) {
    case 'fastest': return (1 / (e.limit / 3.6 * (0.6 + 0.4 * e.condition))) * (1 + e.traffic * 0.8) * 10;
    case 'shortest': return 1;
    case 'traffic': return 1 + e.traffic * 4;
    case 'road': return 1 + (1 - e.condition) * 4;
  }
}

export interface Leg { edge: RoadEdge; from: number; to: number }
export interface Maneuver { along: number; type: 'left' | 'right' | 'slight-left' | 'slight-right' | 'straight' | 'uturn' | 'arrive'; road: string }
export interface PlannedRoute { option: RouteOption; legs: Leg[]; pts: { x: number; z: number }[]; cum: number[]; length: number; eta: number; maneuvers: Maneuver[]; traffic: number; condition: number }

function legPoints(l: Leg, out: { x: number; z: number }[]) {
  const e = l.edge;
  const a = sampleEdge(e, l.from);
  out.push({ x: a.x, z: a.z });
  if (l.to >= l.from) { for (let i = 0; i < e.pts.length; i++) if (e.cum[i] > l.from && e.cum[i] < l.to) out.push({ x: e.pts[i].x, z: e.pts[i].z }); }
  else { for (let i = e.pts.length - 1; i >= 0; i--) if (e.cum[i] < l.from && e.cum[i] > l.to) out.push({ x: e.pts[i].x, z: e.pts[i].z }); }
  const b = sampleEdge(e, l.to);
  out.push({ x: b.x, z: b.z });
}

export function planRoute(px: number, pz: number, heading: number, target: { edge: RoadEdge; s: number }, opt: RouteOption): PlannedRoute | null {
  const h = queryRoad(px, pz) && queryRoad(px, pz)!.dist < 40 ? queryRoad(px, pz)! : nearestRoadBrute(px, pz);
  const E = h.edge;
  const fx = Math.sin(heading), fz = Math.cos(heading);
  const fwd = fx * h.dx + fz * h.dz >= 0;
  const sc = edgeCostScale(E, opt);
  const UTURN = 400;
  let legs: Leg[] | null = null;
  if (target.edge.id === E.id && ((fwd && target.s >= h.s) || (!fwd && target.s <= h.s))) {
    legs = [{ edge: E, from: h.s, to: target.s }];
  } else {
    const dist = new Map<string, number>();
    const prev = new Map<string, { node: string; edge: number } | null>();
    const startB = (E.len - h.s) * sc + (fwd ? 0 : UTURN);
    const startA = h.s * sc + (fwd ? UTURN : 0);
    dist.set(E.b, startB); prev.set(E.b, null);
    if (!dist.has(E.a) || startA < dist.get(E.a)!) { dist.set(E.a, startA); prev.set(E.a, null); }
    const done = new Set<string>();
    while (true) {
      let u: string | null = null, ud = Infinity;
      for (const [k, v] of dist) if (!done.has(k) && v < ud) { ud = v; u = k; }
      if (!u) break;
      done.add(u);
      for (const ei of nodes.get(u)!.edges) {
        const e = edges[ei];
        const v = e.a === u ? e.b : e.a;
        const nd = ud + e.len * edgeCostScale(e, opt);
        if (nd < (dist.get(v) ?? Infinity)) { dist.set(v, nd); prev.set(v, { node: u, edge: ei }); }
      }
    }
    const T = target.edge, tsc = edgeCostScale(T, opt);
    const viaA = (dist.get(T.a) ?? Infinity) + target.s * tsc;
    const viaB = (dist.get(T.b) ?? Infinity) + (T.len - target.s) * tsc;
    if (!isFinite(viaA) && !isFinite(viaB)) return null;
    const endNode = viaA <= viaB ? T.a : T.b;
    const chain: number[] = [];
    let cur = endNode;
    let p = prev.get(cur);
    while (p) { chain.unshift(p.edge); cur = p.node; p = prev.get(cur); }
    const startNode = cur;
    legs = [];
    const toB = startNode === E.b;
    // avoid zero-length start leg
    legs.push({ edge: E, from: h.s, to: toB ? E.len : 0 });
    let node = startNode;
    for (const ei of chain) {
      const e = edges[ei];
      if (e.a === node) { legs.push({ edge: e, from: 0, to: e.len }); node = e.b; }
      else { legs.push({ edge: e, from: e.len, to: 0 }); node = e.a; }
    }
    legs.push({ edge: T, from: endNode === T.a ? 0 : T.len, to: target.s });
    legs = legs.filter((l, i) => Math.abs(l.to - l.from) > 0.5 || i === legs!.length - 1);
  }
  const pts: { x: number; z: number }[] = [];
  const legEnd: number[] = [];
  const cumTmp: number[] = [];
  for (const l of legs) {
    const tmp: { x: number; z: number }[] = [];
    legPoints(l, tmp);
    for (const q of tmp) {
      const last = pts[pts.length - 1];
      if (last && Math.hypot(last.x - q.x, last.z - q.z) < 0.3) continue;
      pts.push(q);
      cumTmp.push(cumTmp.length ? cumTmp[cumTmp.length - 1] + Math.hypot(q.x - pts[pts.length - 2].x, q.z - pts[pts.length - 2].z) : 0);
    }
    legEnd.push(cumTmp[cumTmp.length - 1] || 0);
  }
  const length = cumTmp[cumTmp.length - 1] || 0;
  // maneuvers
  const maneuvers: Maneuver[] = [];
  let eta = 0, trafficW = 0, condW = 0;
  for (let i = 0; i < legs.length; i++) {
    const l = legs[i];
    const L = Math.abs(l.to - l.from);
    eta += L / (l.edge.limit / 3.6 * 0.7) * (1 + l.edge.traffic * 0.5);
    trafficW += l.edge.traffic * L; condW += l.edge.condition * L;
    if (i < legs.length - 1) {
      const n = legs[i + 1];
      const d1 = l.to >= l.from ? 1 : -1, d2 = n.to >= n.from ? 1 : -1;
      const s1 = sampleEdge(l.edge, l.to - d1 * 3), s2 = sampleEdge(n.edge, n.from + d2 * 3);
      const ix = s1.dx * d1, iz = s1.dz * d1, ox = s2.dx * d2, oz = s2.dz * d2;
      const dot = Math.max(-1, Math.min(1, ix * ox + iz * oz));
      const ang = Math.acos(dot) * 180 / Math.PI;
      const leftness = ox * iz - oz * ix; // dot(out, left(in)), left(in) = (iz, -ix)
      const nodeId = d1 > 0 ? l.edge.b : l.edge.a;
      const deg = nodes.get(nodeId)?.edges.length || 2;
      let type: Maneuver['type'] = 'straight';
      if (ang > 150) type = 'uturn';
      else if (ang > 50) type = leftness > 0 ? 'left' : 'right';
      else if (ang > 22) type = leftness > 0 ? 'slight-left' : 'slight-right';
      if (type === 'straight' && deg <= 2) continue;
      if ((type === 'slight-left' || type === 'slight-right') && deg <= 2) continue;
      maneuvers.push({ along: legEnd[i], type, road: n.edge.name });
    }
  }
  maneuvers.push({ along: length, type: 'arrive', road: '' });
  return { option: opt, legs, pts, cum: cumTmp, length, eta, maneuvers, traffic: trafficW / (length || 1), condition: condW / (length || 1) };
}

/** shortest road distance between two stops (meters) */
export function stopDistance(a: Stop, b: Stop): number {
  const heading = Math.atan2(a.dirx, a.dirz);
  const r1 = planRoute(a.rx, a.rz, heading, { edge: b.edge, s: b.s }, 'shortest');
  const r2 = planRoute(a.rx, a.rz, heading + Math.PI, { edge: b.edge, s: b.s }, 'shortest');
  return Math.min(r1?.length ?? 1e9, r2?.length ?? 1e9);
}

export const WORLD_BOUNDS = { minX: -420, maxX: 1820, minZ: -1560, maxZ: 1160 };
