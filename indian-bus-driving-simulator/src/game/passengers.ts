import * as THREE from 'three';
import { stops, type Stop } from './roads';
import { buildPerson, type PersonModel } from './models';

export interface Passenger { id: number; from: string; dest: string; sat: number; board: number; dist: number; emergency?: boolean; waited: number }
export interface Waiting { id: number; stop: string; since: number; emergency?: boolean; dest?: string }
interface Walker { m: PersonModel; ax: number; az: number; bx: number; bz: number; t: number; dur: number; done: () => void; phase: number }

const NAMES_HI = ['Ramesh', 'Sunita', 'Aarav', 'Priya', 'Mohan', 'Lakshmi', 'Imran', 'Gurpreet', 'Anjali', 'Ravi', 'Fatima', 'Suresh', 'Kavya', 'Arjun', 'Meena'];
export const randomName = () => NAMES_HI[Math.floor(Math.random() * NAMES_HI.length)];

export class PassengerSystem {
  waiting = new Map<string, Waiting[]>();
  onboard: Passenger[] = [];
  private pool: PersonModel[] = [];
  private assigned = new Map<number, PersonModel>();
  private walkers: Walker[] = [];
  private nextId = 1;
  time = 0;
  delivered = 0;

  constructor(scene: THREE.Scene) {
    for (let i = 0; i < 30; i++) { const m = buildPerson(i * 13 + 5); m.group.visible = false; scene.add(m.group); this.pool.push(m); }
    for (const s of stops) this.waiting.set(s.id, []);
  }

  reset() {
    for (const s of stops) this.waiting.set(s.id, []);
    this.onboard = []; this.delivered = 0;
    for (const m of this.assigned.values()) { m.group.visible = false; this.pool.push(m); }
    this.assigned.clear();
    for (const w of this.walkers) { w.m.group.visible = false; this.pool.push(w.m); }
    this.walkers = [];
  }

  addWaiting(stopId: string, n: number, extra?: Partial<Waiting>) {
    const arr = this.waiting.get(stopId)!;
    for (let i = 0; i < n; i++) arr.push({ id: this.nextId++, stop: stopId, since: this.time - Math.random() * 30, ...extra });
  }

  private slot(stop: Stop, k: number) {
    const along = ((k % 5) - 2) * 1.1, back = Math.floor(k / 5) * 0.9 + 0.3;
    const lx = stop.dirz * stop.side, lz = -stop.dirx * stop.side; // away from road
    return { x: stop.sx + stop.dirx * along + lx * back, z: stop.sz + stop.dirz * along + lz * back, ry: Math.atan2(-lx, -lz) };
  }

  syncVisuals(bx: number, bz: number) {
    const keep = new Set<number>();
    for (const s of stops) {
      if (Math.abs(s.sx - bx) > 200 || Math.abs(s.sz - bz) > 200) continue;
      const arr = this.waiting.get(s.id)!;
      arr.forEach((w, k) => {
        if (k > 9) return;
        keep.add(w.id);
        let m = this.assigned.get(w.id);
        if (!m) { m = this.pool.pop(); if (!m) return; this.assigned.set(w.id, m); m.group.visible = true; const p = this.slot(s, k); m.group.position.set(p.x, 0.1, p.z); m.group.rotation.set(0, p.ry, 0); }
        const t = this.time + w.id;
        m.armL.rotation.x = Math.sin(t * 1.3) * 0.1; m.armR.rotation.x = w.emergency ? -1.2 : Math.sin(t * 1.1 + 1) * 0.1;
        m.legL.rotation.x = 0; m.legR.rotation.x = 0;
      });
    }
    for (const [id, m] of this.assigned) if (!keep.has(id)) { m.group.visible = false; this.pool.push(m); this.assigned.delete(id); }
  }

  /** take waiting passenger visual and walk it to the door */
  walkToDoor(w: Waiting, door: THREE.Vector3, done: () => void) {
    let m = this.assigned.get(w.id);
    this.assigned.delete(w.id);
    if (!m) { m = this.pool.pop(); if (!m) { done(); return; } const s = stops.find(x => x.id === w.stop)!; m.group.position.set(s.sx, 0.1, s.sz); m.group.visible = true; }
    const p = m.group.position;
    const d = Math.hypot(door.x - p.x, door.z - p.z);
    this.walkers.push({ m, ax: p.x, az: p.z, bx: door.x, bz: door.z, t: 0, dur: Math.max(0.6, d / 2.2), done, phase: 0 });
  }
  walkFromDoor(door: THREE.Vector3, stop: Stop) {
    const m = this.pool.pop(); if (!m) return;
    m.group.visible = true; m.group.position.set(door.x, 0.1, door.z); m.group.rotation.x = 0;
    const away = 8 + Math.random() * 6;
    const lx = stop.dirz * stop.side, lz = -stop.dirx * stop.side;
    const tx = stop.sx + lx * away + stop.dirx * (Math.random() - 0.5) * 10, tz = stop.sz + lz * away + stop.dirz * (Math.random() - 0.5) * 10;
    this.walkers.push({ m, ax: door.x, az: door.z, bx: tx, bz: tz, t: 0, dur: Math.hypot(tx - door.x, tz - door.z) / 1.6, done: () => {}, phase: 0 });
  }

  update(dt: number) {
    this.time += dt;
    for (let i = this.walkers.length - 1; i >= 0; i--) {
      const w = this.walkers[i];
      w.t += dt; w.phase += dt * 9;
      const k = Math.min(1, w.t / w.dur);
      const x = w.ax + (w.bx - w.ax) * k, z = w.az + (w.bz - w.az) * k;
      w.m.group.position.set(x, 0.1 + Math.abs(Math.sin(w.phase)) * 0.04, z);
      w.m.group.rotation.y = Math.atan2(w.bx - w.ax, w.bz - w.az);
      const sw = Math.sin(w.phase) * 0.6; w.m.legL.rotation.x = sw; w.m.legR.rotation.x = -sw; w.m.armL.rotation.x = -sw * 0.7; w.m.armR.rotation.x = sw * 0.7;
      if (k >= 1) { w.m.group.visible = false; this.pool.push(w.m); this.walkers.splice(i, 1); w.done(); }
    }
  }

  avgSatisfaction() { return this.onboard.length ? this.onboard.reduce((a, p) => a + p.sat, 0) / this.onboard.length : 100; }
  hit(amount: number) { for (const p of this.onboard) p.sat = Math.max(0, p.sat - amount); }
}
