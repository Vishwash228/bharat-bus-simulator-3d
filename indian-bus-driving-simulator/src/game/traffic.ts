import * as THREE from 'three';
import { edges, nodes, queryRoad, RAIL_Z, sampleEdge, zoneAt, type RoadEdge } from './roads';
import { buildAnimal, buildPerson, buildTrain, buildVehicle, type AnimalModel, type PersonModel, type VehicleProto, type VehicleType } from './models';
import { signalColor, type WorldData } from './world';

export interface Obstacle { x: number; z: number; r: number; len: number; hx: number; hz: number; speed: number; kind: string; ref?: unknown }

export interface Vehicle {
  type: VehicleType; mesh: THREE.Group; length: number; width: number; maxSpeed: number;
  edge: RoadEdge; dir: number; s: number; lane: number; lat: number; speed: number;
  x: number; y: number; z: number; hx: number; hz: number; yaw: number;
  active: boolean; crashed: number; honkT: number; aggressive: number; nextEdge: { e: RoadEdge; dir: number } | null;
}

const TYPE_MIX: Record<string, [VehicleType, number][]> = {
  city: [['car', 30], ['auto', 25], ['bike', 25], ['bus', 8], ['taxi', 8], ['truck', 4]],
  town: [['car', 20], ['auto', 30], ['bike', 30], ['tractor', 8], ['bus', 6], ['truck', 6]],
  highway: [['truck', 32], ['car', 34], ['bus', 16], ['bike', 10], ['tractor', 3], ['taxi', 5]],
  rural: [['tractor', 18], ['bike', 30], ['truck', 14], ['car', 14], ['auto', 12], ['bus', 12]],
  mountain: [['car', 40], ['bus', 20], ['truck', 24], ['bike', 16]],
  village: [['bike', 40], ['tractor', 30], ['auto', 20], ['car', 10]],
};
function pickType(t: string): VehicleType {
  const mix = TYPE_MIX[t] || TYPE_MIX.city; const tot = mix.reduce((a, b) => a + b[1], 0);
  let r = Math.random() * tot; for (const [k, w] of mix) { r -= w; if (r <= 0) return k; } return 'car';
}

export class TrafficSystem {
  vehicles: Vehicle[] = [];
  private pool = new Map<VehicleType, THREE.Group[]>();
  private protos = new Map<string, VehicleProto>();
  density = 1;
  time = 0;
  onHonk: ((x: number, z: number) => void) | null = null;
  constructor(private scene: THREE.Scene, private world: WorldData, private gatesClosed: (x: number) => boolean) {}

  private getMesh(type: VehicleType): { mesh: THREE.Group; proto: VehicleProto } {
    const seed = Math.floor(Math.random() * 6);
    const key = type + seed;
    let proto = this.protos.get(key);
    if (!proto) { proto = buildVehicle(type, seed); proto.mesh.traverse(o => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; } }); this.protos.set(key, proto); }
    const pool = this.pool.get(type) || [];
    const mesh = pool.pop() || proto.mesh.clone();
    mesh.visible = true;
    if (!mesh.parent) this.scene.add(mesh);
    return { mesh, proto };
  }
  private release(v: Vehicle) {
    v.mesh.visible = false; v.active = false;
    const pool = this.pool.get(v.type) || []; pool.push(v.mesh); this.pool.set(v.type, pool);
  }

  spawnNear(px: number, pz: number, minR: number, maxR: number): boolean {
    for (let attempt = 0; attempt < 6; attempt++) {
      const a = Math.random() * Math.PI * 2, r = minR + Math.random() * (maxR - minR);
      const x = px + Math.cos(a) * r, z = pz + Math.sin(a) * r;
      const h = queryRoad(x, z);
      if (!h || h.dist > 30) continue;
      const e = h.edge;
      if (h.s < 15 || h.s > e.len - 15) continue;
      const dir = Math.random() < 0.5 ? 1 : -1;
      const s = dir > 0 ? h.s : e.len - h.s;
      const lane = Math.floor(Math.random() * e.lanes);
      const sp = sampleEdge(e, h.s);
      if (this.vehicles.some(v => v.active && Math.abs(v.x - sp.x) < 16 && Math.abs(v.z - sp.z) < 16)) continue;
      if (Math.abs(sp.z - RAIL_Z) < 15) continue;
      const type = pickType(e.type);
      const { mesh, proto } = this.getMesh(type);
      const v: Vehicle = {
        type, mesh, length: proto.length, width: proto.width, maxSpeed: proto.maxSpeed * (0.85 + Math.random() * 0.3),
        edge: e, dir, s, lane, lat: e.median / 2 + (lane + 0.5) * e.laneW, speed: 0, x: sp.x, y: sp.y, z: sp.z, hx: sp.dx * dir, hz: sp.dz * dir, yaw: Math.atan2(sp.dx * dir, sp.dz * dir),
        active: true, crashed: 0, honkT: 0, aggressive: Math.random(), nextEdge: null,
      };
      v.speed = Math.min(v.maxSpeed, e.limit / 3.6) * 0.8;
      this.place(v, 1);
      const slot = this.vehicles.findIndex(o => !o.active);
      if (slot >= 0) this.vehicles[slot] = v; else this.vehicles.push(v);
      return true;
    }
    return false;
  }

  private chooseNext(v: Vehicle) {
    const nodeId = v.dir > 0 ? v.edge.b : v.edge.a;
    const n = nodes.get(nodeId)!;
    let opts = n.edges.filter(i => i !== v.edge.id);
    if (!opts.length) opts = [v.edge.id];
    const ei = opts[Math.floor(Math.random() * opts.length)];
    const e = edges[ei];
    v.nextEdge = { e, dir: e.a === nodeId ? 1 : -1 };
  }

  private place(v: Vehicle, smooth: number) {
    const e = v.edge;
    const sp = sampleEdge(e, v.dir > 0 ? v.s : e.len - v.s);
    const dx = sp.dx * v.dir, dz = sp.dz * v.dir;
    const tx = sp.x + dz * v.lat, tz = sp.z - dx * v.lat;
    v.x += (tx - v.x) * smooth; v.z += (tz - v.z) * smooth; v.y = sp.y;
    v.hx += (dx - v.hx) * smooth; v.hz += (dz - v.hz) * smooth;
    const L = Math.hypot(v.hx, v.hz) || 1; v.hx /= L; v.hz /= L;
    v.yaw = Math.atan2(v.hx, v.hz);
    v.mesh.position.set(v.x, v.y, v.z); v.mesh.rotation.y = v.yaw;
  }

  update(dt: number, player: Obstacle, others: Obstacle[], tollActive: boolean) {
    this.time += dt;
    const target = Math.round((14 + 18 * (zoneAt(player.x, player.z) === 'city' ? 1.2 : zoneAt(player.x, player.z) === 'highway' ? 0.9 : 0.6)) * this.density);
    let active = 0;
    for (const v of this.vehicles) {
      if (!v.active) continue;
      if (Math.abs(v.x - player.x) > 420 || Math.abs(v.z - player.z) > 420) { this.release(v); continue; }
      active++;
    }
    if (active < target) this.spawnNear(player.x, player.z, active < target * 0.5 ? 60 : 160, 360);
    const list = this.vehicles;
    for (const v of list) {
      if (!v.active) continue;
      const e = v.edge;
      const remaining = e.len - v.s;
      let vDes = Math.min(v.maxSpeed, e.limit / 3.6 * (1 + v.aggressive * 0.15));
      if (v.crashed > 0) { v.crashed -= dt; vDes = 0; }
      // junction handling
      if (!v.nextEdge) this.chooseNext(v);
      const nodeId = v.dir > 0 ? e.b : e.a; const node = nodes.get(nodeId)!;
      if (remaining < 30 && node.edges.length > 2) vDes = Math.min(vDes, 5.5 + remaining * 0.25);
      if (node.signal && remaining < 45) {
        const axis = Math.abs(v.hx) > Math.abs(v.hz) ? 'x' : 'z';
        const c = signalColor(node, axis, this.time);
        const stopAt = remaining - (e.width / 2 + 4.5);
        if (c === 'red' || (c === 'yellow' && stopAt > 8)) { if (stopAt > -1) vDes = Math.min(vDes, Math.max(0, stopAt) * 0.45); }
      }
      // railway
      if (Math.abs(v.z - RAIL_Z) < 45 && Math.abs(v.hz) > 0.5) {
        const towards = (RAIL_Z - v.z) * v.hz > 0;
        const cx = this.world.crossings.find(c => Math.abs(c.x - v.x) < 20);
        if (towards && cx && this.gatesClosed(cx.x)) { const d = Math.abs(RAIL_Z - v.z) - 11; vDes = Math.min(vDes, Math.max(0, d) * 0.4); }
      }
      // toll
      if (tollActive && e.type === 'highway' && Math.abs(v.x - this.world.toll.x) < 50 && Math.abs(v.z - 60) < 12) {
        const ahead = (this.world.toll.x - v.x) * v.hx;
        if (ahead > -6) vDes = Math.min(vDes, 3 + Math.max(0, ahead) * 0.2);
      }
      // leader detection
      let gap = 999; let blockedByPlayer = false; let leaderSpeed = 0;
      const check = (ox: number, oz: number, ow: number, ol: number, osp: number, isPlayer: boolean) => {
        const rx = ox - v.x, rz = oz - v.z;
        const ahead = rx * v.hx + rz * v.hz;
        if (ahead <= 0 || ahead > 40) return;
        const lat = Math.abs(rx * v.hz - rz * v.hx);
        if (lat > (v.width + ow) / 2 + 0.6) return;
        const g = ahead - (v.length + ol) / 2;
        if (g < gap) { gap = g; blockedByPlayer = isPlayer; leaderSpeed = osp; }
      };
      for (const o of list) if (o !== v && o.active) check(o.x, o.z, o.width, o.length, o.speed, false);
      check(player.x, player.z, player.r * 2, player.len, player.speed, true);
      for (const o of others) check(o.x, o.z, o.r * 2, o.len, 0, false);
      if (gap < 999) {
        const safe = 3 + v.speed * 0.9;
        if (gap < safe) vDes = Math.min(vDes, Math.max(0, leaderSpeed + (gap - 3) * 0.5));
        if (gap < 2.5) vDes = 0;
        // overtake on multi-lane
        if (e.lanes > 1 && gap < 20 && leaderSpeed < v.speed + 1 && Math.random() < dt * 2) {
          const nl = v.lane === 0 ? 1 : 0;
          const nlat = e.median / 2 + (nl + 0.5) * e.laneW;
          const free = !list.some(o => o !== v && o.active && o.edge === e && o.dir === v.dir && o.lane === nl && Math.abs(o.s - v.s) < 25);
          if (free) { v.lane = nl; v.lat = v.lat; (v as Vehicle & { tlat?: number }).tlat = nlat; }
        }
        const vv = v as Vehicle & { blockT?: number; passT?: number };
        const atSignal = node.signal && remaining < 60;
        if (gap < 14 && leaderSpeed < 0.5 && e.lanes === 1 && !atSignal && v.crashed <= 0) {
          vv.blockT = (vv.blockT || 0) + dt;
          if (vv.blockT > 2.5 + v.aggressive * 2) { vv.passT = 5; vv.blockT = 0; }
        } else vv.blockT = 0;
        if (blockedByPlayer && v.speed < 2 && gap < 15) {
          v.honkT -= dt;
          if (v.honkT < 0) { v.honkT = 2 + Math.random() * 4; this.onHonk?.(v.x, v.z); }
        }
      }
      // lane drift towards target
      const pv = v as Vehicle & { passT?: number };
      if (pv.passT && pv.passT > 0) pv.passT -= dt;
      const tl = pv.passT && pv.passT > 0 ? -e.laneW * 0.55 : e.median / 2 + (v.lane + 0.5) * e.laneW;
      v.lat += (tl - v.lat) * Math.min(1, dt * 1.5);
      // speed integrate
      const acc = vDes > v.speed ? 2.2 : -7;
      v.speed += Math.max(-7 * dt, Math.min(2.2 * dt, (vDes - v.speed))) * (acc > 0 ? 1 : 1);
      if (v.speed < 0) v.speed = 0;
      v.s += v.speed * dt;
      if (v.s > e.len) {
        if (!v.nextEdge) this.chooseNext(v);
        const nx = v.nextEdge!;
        v.s -= e.len; v.edge = nx.e; v.dir = nx.dir; v.lane = Math.min(v.lane, nx.e.lanes - 1); v.nextEdge = null;
      }
      this.place(v, Math.min(1, dt * 6));
    }
  }

  clear() { for (const v of this.vehicles) if (v.active) this.release(v); }
  setLights(on: number) { void on; }
}

// ---------------- pedestrians & animals ----------------
export interface Ped { m: PersonModel; x: number; z: number; y: number; hx: number; hz: number; speed: number; mode: 'walk' | 'cross' | 'wait' | 'down'; t: number; side: number; off: number; phase: number; active: boolean; crossDir: number }
export interface Animal { m: AnimalModel; x: number; z: number; hx: number; hz: number; speed: number; t: number; flee: number; active: boolean; down: number }

export class PedSystem {
  peds: Ped[] = []; animals: Animal[] = [];
  constructor(scene: THREE.Scene, maxPeds: number) {
    for (let i = 0; i < maxPeds; i++) {
      const m = buildPerson(i * 7 + 3); m.group.visible = false; scene.add(m.group);
      this.peds.push({ m, x: 0, z: 0, y: 0, hx: 1, hz: 0, speed: 1.2, mode: 'walk', t: 0, side: 1, off: 6, phase: Math.random() * 6, active: false, crossDir: 1 });
    }
    const kinds: ('cow' | 'dog' | 'goat')[] = ['cow', 'cow', 'cow', 'dog', 'dog', 'goat', 'cow', 'goat'];
    kinds.forEach((k, i) => { const m = buildAnimal(k, i); m.group.visible = false; scene.add(m.group); this.animals.push({ m, x: 0, z: 0, hx: 1, hz: 0, speed: 0, t: 0, flee: 0, active: false, down: 0 }); });
  }

  obstacles(out: Obstacle[]) {
    for (const p of this.peds) if (p.active && p.mode !== 'down') out.push({ x: p.x, z: p.z, r: 0.35, len: 0.5, hx: p.hx, hz: p.hz, speed: p.speed, kind: 'ped', ref: p });
    for (const a of this.animals) if (a.active && a.down <= 0) out.push({ x: a.x, z: a.z, r: a.m.kind === 'cow' ? 0.8 : 0.4, len: a.m.kind === 'cow' ? 1.9 : 0.9, hx: a.hx, hz: a.hz, speed: a.speed, kind: 'animal', ref: a });
  }

  private spawnPed(p: Ped, px: number, pz: number) {
    for (let k = 0; k < 5; k++) {
      const a = Math.random() * Math.PI * 2, r = 30 + Math.random() * 110;
      const x = px + Math.cos(a) * r, z = pz + Math.sin(a) * r;
      const zone = zoneAt(x, z);
      if (zone === 'mountain' || zone === 'highway') continue;
      if (zone === 'rural' && Math.random() < 0.7) continue;
      const h = queryRoad(x, z); if (!h || h.dist > 25) continue;
      const side = Math.random() < 0.5 ? 1 : -1; const off = h.edge.width / 2 + (h.edge.type === 'city' ? 1.6 : 1.2);
      p.x = h.x + h.dz * off * side; p.z = h.z - h.dx * off * side; p.y = h.edge.type === 'city' ? 0.18 : 0;
      const d = Math.random() < 0.5 ? 1 : -1; p.hx = h.dx * d; p.hz = h.dz * d;
      p.side = side; p.off = off; p.mode = 'walk'; p.speed = 1 + Math.random() * 0.6; p.t = 3 + Math.random() * 10; p.active = true;
      p.m.group.visible = true; p.m.group.rotation.set(0, 0, 0);
      return;
    }
  }
  private spawnAnimal(a: Animal, px: number, pz: number) {
    for (let k = 0; k < 4; k++) {
      const ang = Math.random() * Math.PI * 2, r = 60 + Math.random() * 140;
      const x = px + Math.cos(ang) * r, z = pz + Math.sin(ang) * r;
      const zone = zoneAt(x, z);
      if (!(zone === 'rural' || zone === 'village' || zone === 'town' || (zone === 'city' && a.m.kind === 'cow' && Math.random() < 0.3))) continue;
      const h = queryRoad(x, z); if (!h || h.dist > 20) continue;
      const lat = (Math.random() - 0.5) * h.edge.width * 1.4;
      a.x = h.x + h.dz * lat; a.z = h.z - h.dx * lat;
      const ang2 = Math.random() * Math.PI * 2; a.hx = Math.sin(ang2); a.hz = Math.cos(ang2);
      a.speed = 0; a.t = 2 + Math.random() * 6; a.flee = 0; a.active = true; a.down = 0;
      a.m.group.visible = true; a.m.group.rotation.set(0, Math.atan2(a.hx, a.hz), 0);
      return;
    }
  }

  update(dt: number, px: number, pz: number, pSpeed: number, horn: boolean, phx: number, phz: number) {
    for (const p of this.peds) {
      if (!p.active) { if (Math.random() < dt * 2) this.spawnPed(p, px, pz); continue; }
      const dist = Math.hypot(p.x - px, p.z - pz);
      if (dist > 190) { p.active = false; p.m.group.visible = false; continue; }
      if (p.mode === 'down') { p.t -= dt; if (p.t < 0) { p.active = false; p.m.group.visible = false; } continue; }
      p.t -= dt;
      if (horn && dist < 25) p.speed = 2.6;
      if (p.mode === 'walk') {
        p.x += p.hx * p.speed * dt; p.z += p.hz * p.speed * dt;
        if (Math.random() < dt) {
          const h = queryRoad(p.x, p.z);
          if (h) { const d = Math.sign(p.hx * h.dx + p.hz * h.dz) || 1; p.hx = h.dx * d; p.hz = h.dz * d; const tx = h.x + h.dz * p.off * p.side, tz = h.z - h.dx * p.off * p.side; p.x += (tx - p.x) * 0.5; p.z += (tz - p.z) * 0.5; }
        }
        if (p.t < 0) { p.t = 6 + Math.random() * 12; if (Math.random() < 0.45) { p.mode = 'wait'; p.crossDir = -p.side; } }
      } else if (p.mode === 'wait') {
        // wait for bus to pass
        const toPed = (p.x - px) * phx + (p.z - pz) * phz;
        const busComing = dist < 45 && toPed > -5 && pSpeed > 2;
        if (!busComing && p.t < 4) {
          p.mode = 'cross'; const h = queryRoad(p.x, p.z);
          if (h) { p.hx = h.dz * p.crossDir; p.hz = -h.dx * p.crossDir; p.t = (p.off * 2) / 1.3; } else p.mode = 'walk';
        }
        if (p.t < -6) p.mode = 'walk';
      } else if (p.mode === 'cross') {
        p.x += p.hx * 1.3 * dt * (horn && dist < 25 ? 1.8 : 1); p.z += p.hz * 1.3 * dt * (horn && dist < 25 ? 1.8 : 1);
        if (p.t < 0) { p.side = -p.side; p.mode = 'walk'; const h = queryRoad(p.x, p.z); if (h) { const d = Math.random() < 0.5 ? 1 : -1; p.hx = h.dx * d; p.hz = h.dz * d; } p.t = 8; }
      }
      const moving = p.mode !== 'wait';
      p.phase += dt * (moving ? p.speed * 5 : 0);
      const sw = moving ? Math.sin(p.phase) * 0.55 : 0;
      p.m.legL.rotation.x = sw; p.m.legR.rotation.x = -sw; p.m.armL.rotation.x = -sw * 0.8; p.m.armR.rotation.x = sw * 0.8;
      p.m.group.position.set(p.x, p.y, p.z); p.m.group.rotation.y = Math.atan2(p.hx, p.hz);
    }
    for (const a of this.animals) {
      if (!a.active) { if (Math.random() < dt * 0.5) this.spawnAnimal(a, px, pz); continue; }
      const dist = Math.hypot(a.x - px, a.z - pz);
      if (dist > 260) { a.active = false; a.m.group.visible = false; continue; }
      if (a.down > 0) { a.down -= dt; if (a.down <= 0) { a.active = false; a.m.group.visible = false; } continue; }
      a.t -= dt;
      if (horn && dist < 35 && a.flee <= 0) {
        a.flee = 5; const h = queryRoad(a.x, a.z);
        if (h) { const side = h.lateral >= 0 ? 1 : -1; a.hx = h.dz * side; a.hz = -h.dx * side; }
      }
      if (a.flee > 0) { a.flee -= dt; a.speed = a.m.kind === 'dog' ? 4 : 1.6; }
      else if (a.t < 0) { a.t = 3 + Math.random() * 8; a.speed = Math.random() < 0.5 ? 0 : (a.m.kind === 'dog' ? 2.5 : 0.5); const ang = Math.random() * Math.PI * 2; a.hx = Math.sin(ang); a.hz = Math.cos(ang); }
      a.x += a.hx * a.speed * dt; a.z += a.hz * a.speed * dt;
      const sw = a.speed > 0 ? Math.sin(performance.now() * 0.006 * (1 + a.speed)) * 0.4 : 0;
      a.m.legs.forEach((l, i) => l.rotation.x = i % 2 ? sw : -sw);
      a.m.group.position.set(a.x, 0, a.z);
      const yaw = Math.atan2(a.hx, a.hz); a.m.group.rotation.y += (yaw - a.m.group.rotation.y) * Math.min(1, dt * 3);
    }
  }
  knock(o: Obstacle, hx: number, hz: number) {
    if (o.kind === 'ped') { const p = o.ref as Ped; p.mode = 'down'; p.t = 5; p.x += hx * 2; p.z += hz * 2; p.m.group.position.set(p.x, 0.2, p.z); p.m.group.rotation.x = -Math.PI / 2; }
    else { const a = o.ref as Animal; a.down = 5; a.x += hx * 2; a.z += hz * 2; a.m.group.position.set(a.x, 0, a.z); a.m.group.rotation.z = Math.PI / 2; }
  }
  clear() { this.peds.forEach(p => { p.active = false; p.m.group.visible = false; }); this.animals.forEach(a => { a.active = false; a.m.group.visible = false; }); }
}

// ---------------- train ----------------
export class TrainSystem {
  group: THREE.Group; length: number;
  x = -3000; dir = 1; speed = 24; wait = 35; running = false;
  private horned = new Set<number>();
  onHorn: ((x: number) => void) | null = null;
  constructor(scene: THREE.Scene) {
    const t = buildTrain(); this.group = t.group; this.length = t.length;
    this.group.position.set(this.x, 0, RAIL_Z); scene.add(this.group); this.group.visible = false;
  }
  update(dt: number, crossingsX: number[], focusX: number) {
    if (!this.running) {
      this.wait -= dt;
      if (this.wait < 0) {
        this.running = true; this.dir = Math.random() < 0.5 ? 1 : -1;
        this.x = focusX - this.dir * 900; this.horned.clear(); this.group.visible = true;
      }
      return;
    }
    this.x += this.dir * this.speed * dt;
    this.group.position.x = this.x; this.group.rotation.y = this.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
    for (const cx of crossingsX) {
      const ahead = (cx - this.x) * this.dir;
      if (ahead > 0 && ahead < 320 && !this.horned.has(cx)) { this.horned.add(cx); this.onHorn?.(cx); }
    }
    if ((this.x - focusX) * this.dir > 1100 + this.length) { this.running = false; this.wait = 60 + Math.random() * 80; this.group.visible = false; }
  }
  /** occupied x range */
  span(): [number, number] | null {
    if (!this.running) return null;
    const tail = this.x - this.dir * (this.length - 9);
    const head = this.x + this.dir * 9;
    return [Math.min(head, tail), Math.max(head, tail)];
  }
  gateClosed(cx: number) {
    if (!this.running) return false;
    const ahead = (cx - this.x) * this.dir;
    return ahead < 380 && ahead > -this.length - 25;
  }
}
