import * as THREE from 'three';
import type { BusSpec } from './data';
import { busSideTexture, coachTexture, destinationTexture, gaugeTexture, truckBackTexture, truckSideTexture } from './textures';

const matCache = new Map<string, THREE.Material>();
export function mat(color: string, opts: { rough?: number; metal?: number; emissive?: string; ei?: number; transparent?: number; side?: THREE.Side; flat?: boolean } = {}) {
  const key = color + JSON.stringify(opts);
  let m = matCache.get(key) as THREE.MeshStandardMaterial | undefined;
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: opts.rough ?? 0.7, metalness: opts.metal ?? 0.05, flatShading: opts.flat });
    if (opts.emissive) { m.emissive = new THREE.Color(opts.emissive); m.emissiveIntensity = opts.ei ?? 1; }
    if (opts.transparent !== undefined) { m.transparent = true; m.opacity = opts.transparent; m.depthWrite = false; }
    if (opts.side) m.side = opts.side;
    matCache.set(key, m);
  }
  return m;
}

const geoCache = new Map<string, THREE.BufferGeometry>();
function boxGeo(w: number, h: number, d: number) {
  const k = `b${w.toFixed(3)},${h.toFixed(3)},${d.toFixed(3)}`;
  let g = geoCache.get(k); if (!g) { g = new THREE.BoxGeometry(w, h, d); geoCache.set(k, g); } return g;
}
function cylGeo(r: number, h: number, seg = 14, r2?: number) {
  const k = `c${r},${h},${seg},${r2}`;
  let g = geoCache.get(k); if (!g) { g = new THREE.CylinderGeometry(r2 ?? r, r, h, seg); geoCache.set(k, g); } return g;
}
function sphGeo(r: number, seg = 10) {
  const k = `s${r},${seg}`;
  let g = geoCache.get(k); if (!g) { g = new THREE.SphereGeometry(r, seg, Math.max(6, seg - 3)); geoCache.set(k, g); } return g;
}

export function box(parent: THREE.Object3D, w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, cast = true) {
  const mesh = new THREE.Mesh(boxGeo(w, h, d), m);
  mesh.position.set(x, y, z); mesh.castShadow = cast; mesh.receiveShadow = true;
  parent.add(mesh); return mesh;
}
function cyl(parent: THREE.Object3D, r: number, h: number, m: THREE.Material, x: number, y: number, z: number, rotZ = 0, seg = 14) {
  const mesh = new THREE.Mesh(cylGeo(r, h, seg), m);
  mesh.position.set(x, y, z); mesh.rotation.z = rotZ; mesh.castShadow = true; parent.add(mesh); return mesh;
}

function wheel(parent: THREE.Object3D, x: number, y: number, z: number, r = 0.52, w = 0.36) {
  const pivot = new THREE.Group(); pivot.position.set(x, y, z); parent.add(pivot);
  const spin = new THREE.Group(); pivot.add(spin);
  const tire = new THREE.Mesh(cylGeo(r, w, 18), mat('#151515', { rough: 0.9 })); tire.rotation.z = Math.PI / 2; tire.castShadow = true; spin.add(tire);
  const hub = new THREE.Mesh(cylGeo(r * 0.55, w + 0.02, 10), mat('#b0b0b0', { metal: 0.7, rough: 0.35 })); hub.rotation.z = Math.PI / 2; spin.add(hub);
  const nut = new THREE.Mesh(boxGeo(w + 0.04, r * 0.25, r * 0.25), mat('#777', { metal: 0.6 })); spin.add(nut);
  return { pivot, spin };
}

export interface BusModel {
  group: THREE.Group; body: THREE.Group;
  wheels: THREE.Object3D[]; frontPivots: THREE.Object3D[];
  steering: THREE.Object3D; door: THREE.Object3D; wipers: THREE.Object3D[];
  needles: { speed: THREE.Object3D; rpm: THREE.Object3D; fuel: THREE.Object3D; temp: THREE.Object3D };
  mats: { head: THREE.MeshStandardMaterial; brake: THREE.MeshStandardMaterial; indL: THREE.MeshStandardMaterial; indR: THREE.MeshStandardMaterial; reverse: THREE.MeshStandardMaterial; interior: THREE.MeshStandardMaterial };
  spot: THREE.SpotLight; spotTarget: THREE.Object3D;
  seated: THREE.Object3D[];
  driverEye: THREE.Vector3; interiorEye: THREE.Vector3; doorPos: THREE.Vector3; mirrorL: THREE.Vector3; mirrorR: THREE.Vector3;
  length: number; width: number; wheelbase: number; doorZ: number;
  destMat: THREE.MeshBasicMaterial;
  setDestination: (t: string, h: string) => void;
}

export function buildBus(spec: BusSpec): BusModel {
  const L = spec.length, W = 2.55, hl = L / 2;
  const FLOOR = 1.05, WIN0 = 1.8, WIN1 = 2.72, ROOF = 2.95;
  const group = new THREE.Group();
  const body = new THREE.Group(); group.add(body);
  const bodyM = mat(spec.body, { rough: 0.45, metal: 0.2 });
  const stripeM = mat(spec.stripe, { rough: 0.5 });
  const roofM = mat(spec.roof, { rough: 0.6 });
  const sideTex = busSideTexture(spec.body, spec.stripe, spec.stripe2, spec.operator, spec.style);
  const sideM = new THREE.MeshStandardMaterial({ map: sideTex, roughness: 0.45, metalness: 0.15 });
  const glassM = mat(spec.style === 'volvo' || spec.style === 'express' ? '#1d2b36' : '#4d6b78', { transparent: spec.style === 'volvo' ? 0.55 : 0.32, rough: 0.05, metal: 0.6 });
  const darkM = mat('#1a1a1a', { rough: 0.8 });
  const chromeM = mat('#d6d6d6', { metal: 0.9, rough: 0.2 });
  const liningM = mat(spec.style === 'volvo' ? '#d7ccc8' : '#c9c1a8', { rough: 0.9 });
  const floorM = mat(spec.style === 'volvo' ? '#5d4037' : '#3b3b3b', { rough: 0.95 });
  const doorZ0 = hl - 1.75, doorZ1 = hl - 0.55;
  const frontAxle = hl - 2.65, rearAxle = -hl + (spec.axles === 3 ? 3.3 : 2.9);

  // chassis / skirt
  box(body, W - 0.9, 0.62, L - 0.3, darkM, 0, 0.74, 0);
  const arches = [frontAxle, rearAxle, ...(spec.axles === 3 ? [rearAxle - 1.35] : [])].sort((a, b) => a - b);
  let zStart = -hl;
  for (const a of arches) {
    const z1 = a - 0.68;
    if (z1 > zStart) { box(body, 0.08, 0.6, z1 - zStart, bodyM, W / 2 - 0.04, 0.75, (zStart + z1) / 2); box(body, 0.08, 0.6, z1 - zStart, bodyM, -W / 2 + 0.04, 0.75, (zStart + z1) / 2); }
    zStart = a + 0.68;
  }
  box(body, 0.08, 0.6, hl - zStart, bodyM, W / 2 - 0.04, 0.75, (zStart + hl) / 2); box(body, 0.08, 0.6, hl - zStart, bodyM, -W / 2 + 0.04, 0.75, (zStart + hl) / 2);
  // stripes on skirt
  box(body, W + 0.01, 0.06, L, stripeM, 0, 0.98, 0, false);

  // lower side panels (livery)
  const lowH = WIN0 - FLOOR, lowY = (WIN0 + FLOOR) / 2;
  box(body, 0.06, lowH, L, sideM, -W / 2 + 0.03, lowY, 0);
  box(body, 0.06, lowH, doorZ0 + hl, sideM, W / 2 - 0.03, lowY, (doorZ0 - hl) / 2);
  box(body, 0.06, lowH, hl - doorZ1, bodyM, W / 2 - 0.03, lowY, (doorZ1 + hl) / 2);
  box(body, 0.02, lowH, L - 0.3, liningM, -W / 2 + 0.08, lowY, 0, false);
  box(body, 0.02, lowH, doorZ0 + hl - 0.2, liningM, W / 2 - 0.08, lowY, (doorZ0 - hl) / 2 + 0.1, false);
  // windows
  const winH = WIN1 - WIN0, winY = (WIN0 + WIN1) / 2;
  box(body, 0.03, winH, L - 0.1, glassM, -W / 2 + 0.03, winY, 0, false);
  box(body, 0.03, winH, doorZ0 + hl, glassM, W / 2 - 0.03, winY, (doorZ0 - hl) / 2, false);
  box(body, 0.03, winH, hl - doorZ1, glassM, W / 2 - 0.03, winY, (doorZ1 + hl) / 2, false);
  const pillarStep = spec.style === 'volvo' ? 2.2 : 1.25;
  for (let z = -hl + 0.05; z <= hl - 0.05; z += pillarStep) {
    box(body, 0.1, winH, 0.1, bodyM, -W / 2 + 0.04, winY, z);
    if (z < doorZ0 - 0.05 || z > doorZ1 + 0.05) box(body, 0.1, winH, 0.1, bodyM, W / 2 - 0.04, winY, z);
  }
  box(body, 0.1, winH, 0.12, bodyM, W / 2 - 0.04, winY, doorZ0); box(body, 0.1, winH, 0.12, bodyM, W / 2 - 0.04, winY, doorZ1);
  box(body, 0.1, WIN1 - FLOOR + 0.1, 0.14, bodyM, W / 2 - 0.04, (WIN1 + FLOOR) / 2, hl - 0.05);
  box(body, 0.1, WIN1 - FLOOR + 0.1, 0.14, bodyM, -W / 2 + 0.04, (WIN1 + FLOOR) / 2, hl - 0.05);
  // window belt rail inside
  box(body, 0.05, 0.05, L - 0.4, chromeM, -W / 2 + 0.12, WIN0 + 0.02, 0, false);
  // upper band + roof
  box(body, W, ROOF - WIN1, L, roofM, 0, (ROOF + WIN1) / 2 + 0.06, 0);
  box(body, W - 0.06, 0.12, L - 0.06, roofM, 0, ROOF + 0.06, 0);
  box(body, W - 0.2, 0.02, L - 0.3, mat('#e8e4da', { rough: 0.9 }), 0, WIN1 + 0.01, 0, false);
  // roof extras
  if (spec.style === 'ordinary') {
    const rackM = mat('#555', { metal: 0.6, rough: 0.4 });
    box(body, 0.05, 0.25, L * 0.55, rackM, W / 2 - 0.15, ROOF + 0.25, -hl * 0.3);
    box(body, 0.05, 0.25, L * 0.55, rackM, -W / 2 + 0.15, ROOF + 0.25, -hl * 0.3);
    for (let i = 0; i < 6; i++) box(body, W - 0.3, 0.04, 0.05, rackM, 0, ROOF + 0.36, -hl * 0.3 - L * 0.27 + i * L * 0.11);
    // luggage bundles
    box(body, 1.0, 0.45, 1.3, mat('#6d4c41'), 0.3, ROOF + 0.35, -hl * 0.45);
    box(body, 0.8, 0.35, 0.9, mat('#1565c0'), -0.4, ROOF + 0.3, -hl * 0.15);
    // ladder at rear
    for (let i = 0; i < 6; i++) box(body, 0.45, 0.04, 0.04, rackM, -0.7, 1.2 + i * 0.3, -hl - 0.06);
  } else if (spec.style === 'volvo') {
    box(body, 1.6, 0.25, 3.2, mat('#eeeeee', { rough: 0.4 }), 0, ROOF + 0.24, -hl * 0.2);
    box(body, 1.2, 0.05, 2.6, mat('#9e9e9e'), 0, ROOF + 0.38, -hl * 0.2);
  } else {
    box(body, 1.3, 0.22, 2.4, mat('#e0e0e0', { rough: 0.5 }), 0, ROOF + 0.2, -hl * 0.1);
  }

  // front
  box(body, W, WIN0 - 0.15 - FLOOR, 0.1, bodyM, 0, (WIN0 - 0.15 + FLOOR) / 2, hl);
  const windshield = box(body, W - 0.12, WIN1 - WIN0 + 0.2, 0.04, mat('#4a6470', { transparent: 0.22, rough: 0.05, metal: 0.5 }), 0, (WIN0 + WIN1) / 2 - 0.05, hl + 0.02, false);
  windshield.castShadow = false;
  box(body, 0.12, WIN1 - WIN0 + 0.25, 0.12, bodyM, 0, (WIN0 + WIN1) / 2 - 0.05, hl + 0.01);
  const destMat = new THREE.MeshBasicMaterial({ map: destinationTexture('BHARAT', 'भारत') });
  const dest = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.24), destMat); dest.position.set(0, WIN1 + 0.12, hl + 0.06); body.add(dest);
  box(body, W, 0.28, 0.08, darkM, 0, WIN1 + 0.12, hl + 0.01, false);
  // grille & bumper
  box(body, 1.2, 0.35, 0.05, chromeM, 0, 1.25, hl + 0.06);
  for (let i = 0; i < 4; i++) box(body, 1.1, 0.03, 0.06, darkM, 0, 1.13 + i * 0.08, hl + 0.08, false);
  box(body, W + 0.06, 0.28, 0.25, mat('#2b2b2b', { rough: 0.6 }), 0, 0.58, hl + 0.08);
  const headM = new THREE.MeshStandardMaterial({ color: '#fffbe8', emissive: new THREE.Color('#fff2c0'), emissiveIntensity: 0.1, roughness: 0.2 });
  const indL = new THREE.MeshStandardMaterial({ color: '#ff9800', emissive: new THREE.Color('#ff8a00'), emissiveIntensity: 0, roughness: 0.3 });
  const indR = indL.clone();
  const brakeM = new THREE.MeshStandardMaterial({ color: '#8b0000', emissive: new THREE.Color('#ff1010'), emissiveIntensity: 0.15, roughness: 0.3 });
  const revM = new THREE.MeshStandardMaterial({ color: '#dddddd', emissive: new THREE.Color('#ffffff'), emissiveIntensity: 0, roughness: 0.3 });
  for (const s of [1, -1]) {
    const hlMesh = new THREE.Mesh(cylGeo(0.13, 0.06, 16), headM); hlMesh.rotation.x = Math.PI / 2; hlMesh.position.set(s * 0.95, 1.12, hl + 0.07); body.add(hlMesh);
    const h2 = new THREE.Mesh(cylGeo(0.1, 0.06, 16), headM); h2.rotation.x = Math.PI / 2; h2.position.set(s * 0.68, 1.12, hl + 0.07); body.add(h2);
    box(body, 0.22, 0.1, 0.05, s > 0 ? indL : indR, s * 1.12, 0.88, hl + 0.08, false);
    // rear lights
    box(body, 0.2, 0.42, 0.05, brakeM, s * 1.08, 1.3, -hl - 0.05, false);
    box(body, 0.2, 0.14, 0.05, s > 0 ? indL : indR, s * 1.08, 1.6, -hl - 0.05, false);
    box(body, 0.14, 0.1, 0.05, revM, s * 0.8, 1.15, -hl - 0.05, false);
    // side indicators
    box(body, 0.04, 0.08, 0.2, s > 0 ? indL : indR, s * (W / 2 + 0.01), 1.1, hl - 0.4, false);
    // mirrors (forward-hanging Indian style)
    const arm = box(body, 0.05, 0.05, 0.7, chromeM, s * (W / 2 + 0.15), 2.55, hl + 0.25, false);
    arm.rotation.y = s * 0.3;
    box(body, 0.05, 0.6, 0.05, chromeM, s * (W / 2 + 0.3), 2.25, hl + 0.55, false);
    box(body, 0.32, 0.5, 0.08, darkM, s * (W / 2 + 0.3), 2.05, hl + 0.55);
  }
  // rear
  box(body, W, ROOF - FLOOR, 0.1, bodyM, 0, (ROOF + FLOOR) / 2, -hl);
  box(body, W - 0.4, 0.7, 0.04, glassM, 0, 2.3, -hl - 0.05, false);
  box(body, W + 0.04, 0.26, 0.22, mat('#2b2b2b'), 0, 0.6, -hl - 0.05);
  box(body, 0.6, 0.18, 0.03, mat('#fafafa'), 0, 0.9, -hl - 0.08, false);

  // wheels
  const wheels: THREE.Object3D[] = [], frontPivots: THREE.Object3D[] = [];
  for (const s of [1, -1]) {
    const f = wheel(group, s * (W / 2 - 0.22), 0.52, frontAxle); wheels.push(f.spin); frontPivots.push(f.pivot);
    const r = wheel(group, s * (W / 2 - 0.25), 0.52, rearAxle, 0.52, 0.5); wheels.push(r.spin);
    if (spec.axles === 3) { const r2 = wheel(group, s * (W / 2 - 0.25), 0.52, rearAxle - 1.35, 0.52, 0.5); wheels.push(r2.spin); }
  }

  // door (sliding plug door)
  const door = new THREE.Group(); door.position.set(W / 2 + 0.01, 0, (doorZ0 + doorZ1) / 2); body.add(door);
  box(door, 0.05, 0.85, 1.18, bodyM, 0, FLOOR + 0.3, 0);
  box(door, 0.04, 0.95, 1.1, glassM, 0, FLOOR + 1.2, 0, false);
  box(door, 0.06, 0.06, 1.18, chromeM, 0.01, FLOOR + 0.75, 0, false);
  box(door, 0.06, 0.06, 1.18, darkM, 0, WIN1 - 0.05, 0, false);
  // steps
  box(body, 0.6, 0.12, 1.1, mat('#555'), W / 2 - 0.35, 0.6, (doorZ0 + doorZ1) / 2);
  box(body, 0.5, 0.12, 1.1, mat('#555'), W / 2 - 0.45, 0.85, (doorZ0 + doorZ1) / 2);

  // ---- interior ----
  box(body, W - 0.14, 0.05, L - 0.2, floorM, 0, FLOOR + 0.02, 0, false);
  const seatM = mat(spec.seatColor, { rough: 0.8 });
  const seatFrame = mat('#888', { metal: 0.6, rough: 0.4 });
  const pitch = spec.style === 'volvo' ? 0.98 : spec.style === 'express' ? 0.92 : 0.82;
  const leftN = 2, rightN = spec.style === 'ordinary' ? 3 : 2;
  const seatW = 0.46;
  const seatPos: THREE.Vector3[] = [];
  const seatStart = hl - 2.25, seatEnd = -hl + 0.9;
  for (let z = seatStart; z > seatEnd && seatPos.length < spec.seats + 6; z -= pitch) {
    for (const side of [1, -1]) {
      const n = side > 0 ? leftN : rightN;
      const wTot = n * seatW;
      const cx = side * (W / 2 - 0.14 - wTot / 2);
      box(body, wTot, 0.12, 0.46, seatM, cx, FLOOR + 0.45, z, false);
      const back = box(body, wTot, 0.62, 0.1, seatM, cx, FLOOR + 0.82, z - 0.24, false); back.rotation.x = -0.12;
      box(body, wTot - 0.1, 0.05, 0.05, seatFrame, cx, FLOOR + 1.16, z - 0.27, false);
      box(body, 0.05, 0.42, 0.05, seatFrame, cx + side * (-wTot / 2 + 0.06), FLOOR + 0.2, z, false);
      for (let k = 0; k < n; k++) seatPos.push(new THREE.Vector3(cx - wTot / 2 + seatW * (k + 0.5), FLOOR + 0.5, z));
    }
  }
  // handrails
  for (const s of [0.42, -0.42]) {
    const rail = cyl(body, 0.02, L - 1.5, chromeM, s, WIN1 - 0.15, -0.5, 0, 8); rail.rotation.x = Math.PI / 2;
  }
  for (let z = seatStart; z > seatEnd; z -= pitch * 3) cyl(body, 0.022, WIN1 - FLOOR, chromeM, 0.42, (WIN1 + FLOOR) / 2, z, 0, 8);
  const interiorM = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: new THREE.Color(spec.style === 'ordinary' ? '#c8ffd0' : '#e8f0ff'), emissiveIntensity: 0.3 });
  for (let z = hl - 2; z > -hl + 1; z -= 2.2) { box(body, 0.18, 0.03, 1.2, interiorM, 0.62, WIN1 - 0.01, z, false); box(body, 0.18, 0.03, 1.2, interiorM, -0.62, WIN1 - 0.01, z, false); }
  // seated passengers
  const seated: THREE.Object3D[] = [];
  const shirtCols = ['#e53935', '#1e88e5', '#43a047', '#fdd835', '#8e24aa', '#fb8c00', '#ffffff', '#00897b', '#d81b60', '#5d4037'];
  for (let i = 0; i < seatPos.length; i++) {
    const p = seatPos[i];
    const g = new THREE.Group(); g.position.copy(p);
    box(g, 0.36, 0.55, 0.26, mat(shirtCols[i % shirtCols.length]), 0, 0.38, -0.1, false);
    const head = new THREE.Mesh(sphGeo(0.12, 8), mat(['#8d5524', '#a0673f', '#c68642', '#7a4a26'][i % 4])); head.position.set(0, 0.78, -0.08); g.add(head);
    const hair = new THREE.Mesh(sphGeo(0.125, 8), mat('#111')); hair.position.set(0, 0.82, -0.11); hair.scale.set(1, 0.7, 1); g.add(hair);
    box(g, 0.34, 0.14, 0.4, mat('#37474f'), 0, 0.08, 0.12, false);
    g.visible = false; body.add(g); seated.push(g);
  }
  // shuffle seat order for realism
  for (let i = seated.length - 1; i > 0; i--) { const j = (i * 7 + 3) % (i + 1); [seated[i], seated[j]] = [seated[j], seated[i]]; }

  // driver cabin
  const dx = -0.72, dz = hl - 1.15;
  box(body, 0.55, 0.12, 0.5, mat('#3e2723'), dx, FLOOR + 0.5, dz, false);
  box(body, 0.55, 0.75, 0.1, mat('#3e2723'), dx, FLOOR + 0.9, dz - 0.27, false);
  box(body, 0.85, 0.5, 1.1, mat('#5d4037', { rough: 0.9 }), 0.05, FLOOR + 0.25, hl - 1.25, false); // engine hump
  const dashM = mat('#2a2a2e', { rough: 0.85 });
  const dash = box(body, W - 0.2, 0.36, 0.55, dashM, 0, WIN0 - 0.15, hl - 0.32, false); dash.rotation.x = 0.1;
  box(body, 0.75, 0.3, 0.1, mat('#111'), dx, WIN0 - 0.02, hl - 0.6, false);
  const gaugeGeo = new THREE.PlaneGeometry(0.26, 0.26);
  const mkGauge = (kind: 'speed' | 'rpm', x: number) => {
    const g = new THREE.Mesh(gaugeGeo, new THREE.MeshBasicMaterial({ map: gaugeTexture(kind) }));
    g.position.set(x, WIN0 - 0.02, hl - 0.66); g.rotation.y = Math.PI; g.rotation.x = 0.15; body.add(g);
    const needle = new THREE.Group(); needle.position.set(x, WIN0 - 0.02, hl - 0.67); needle.rotation.y = Math.PI; needle.rotation.x = 0.15;
    const nm = new THREE.Mesh(boxGeo(0.008, 0.1, 0.005), new THREE.MeshBasicMaterial({ color: '#ff3d00' })); nm.position.y = 0.045; needle.add(nm);
    const holder = new THREE.Group(); needle.add(holder); holder.add(nm);
    body.add(needle); return holder;
  };
  const speedN = mkGauge('speed', dx - 0.17), rpmN = mkGauge('rpm', dx + 0.17);
  const smallDial = (x: number) => {
    const g = new THREE.Mesh(new THREE.CircleGeometry(0.05, 16), new THREE.MeshBasicMaterial({ color: '#111' }));
    g.position.set(x, WIN0 - 0.11, hl - 0.645); g.rotation.y = Math.PI; g.rotation.x = 0.15; body.add(g);
    const holder = new THREE.Group(); holder.position.set(x, WIN0 - 0.11, hl - 0.65); holder.rotation.y = Math.PI; holder.rotation.x = 0.15;
    const inner = new THREE.Group(); holder.add(inner);
    const nm = new THREE.Mesh(boxGeo(0.006, 0.04, 0.004), new THREE.MeshBasicMaterial({ color: '#ffffff' })); nm.position.y = 0.02; inner.add(nm);
    body.add(holder); return inner;
  };
  const fuelN = smallDial(dx - 0.05), tempN = smallDial(dx + 0.05);
  // steering
  const steerBase = new THREE.Group(); steerBase.position.set(dx, FLOOR + 0.95, hl - 0.78); steerBase.rotation.x = -0.95; body.add(steerBase);
  const col = cyl(steerBase, 0.035, 0.5, mat('#222'), 0, -0.25, 0, 0, 8); col.rotation.x = 0;
  const steering = new THREE.Group(); steerBase.add(steering);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.025, 8, 28), mat('#1b1b1b', { rough: 0.5 })); rim.rotation.x = Math.PI / 2; steering.add(rim);
  for (let i = 0; i < 3; i++) { const sp = box(steering, 0.24, 0.02, 0.03, mat('#333'), 0, 0, 0, false); sp.rotation.y = i * Math.PI * 2 / 3; sp.position.set(Math.cos(i * 2.094) * 0.12, 0, -Math.sin(i * 2.094) * 0.12); }
  const hubMesh = new THREE.Mesh(cylGeo(0.06, 0.04, 12), mat('#c0a000', { metal: 0.7, rough: 0.3 })); steering.add(hubMesh);
  // Indian touches: garland and idol
  const garland = new THREE.Group(); garland.position.set(0.1, WIN1 - 0.12, hl - 0.08); body.add(garland);
  for (let i = 0; i <= 16; i++) {
    const t = i / 16; const x = (t - 0.5) * 1.2; const y = -Math.sin(t * Math.PI) * 0.22;
    const b = new THREE.Mesh(sphGeo(0.035, 6), mat(i % 3 === 0 ? '#ffeb3b' : '#ff6f00', { emissive: '#ff6f00', ei: 0.15 })); b.position.set(x, y, 0); garland.add(b);
  }
  box(body, 0.1, 0.14, 0.08, mat('#ffb300', { metal: 0.8, rough: 0.3 }), 0.25, WIN0 + 0.08, hl - 0.25, false);
  const idolHead = new THREE.Mesh(sphGeo(0.05, 8), mat('#ff8f00', { metal: 0.6, rough: 0.3 })); idolHead.position.set(0.25, WIN0 + 0.19, hl - 0.25); body.add(idolHead);
  // wipers
  const wipers: THREE.Object3D[] = [];
  for (const x of [-0.65, 0.45]) {
    const w = new THREE.Group(); w.position.set(x, WIN0 - 0.02, hl + 0.06); body.add(w);
    box(w, 0.025, 0.95, 0.025, mat('#111'), 0, 0.47, 0, false);
    w.rotation.z = 1.4; wipers.push(w);
  }
  // headlight spot
  const spot = new THREE.SpotLight('#fff3d6', 0, 90, 0.62, 0.55, 1.2);
  spot.position.set(0, 1.2, hl + 0.3);
  const spotTarget = new THREE.Object3D(); spotTarget.position.set(0, 0, hl + 25); group.add(spotTarget); spot.target = spotTarget;
  group.add(spot);

  const doorPos = new THREE.Vector3(W / 2 + 1.2, 0, (doorZ0 + doorZ1) / 2);
  const model: BusModel = {
    group, body, wheels, frontPivots, steering, door, wipers,
    needles: { speed: speedN, rpm: rpmN, fuel: fuelN, temp: tempN },
    mats: { head: headM, brake: brakeM, indL, indR, reverse: revM, interior: interiorM },
    spot, spotTarget, seated,
    driverEye: new THREE.Vector3(dx, FLOOR + 1.45, hl - 1.05),
    interiorEye: new THREE.Vector3(0.05, FLOOR + 1.55, -hl + 1.2),
    doorPos, mirrorL: new THREE.Vector3(W / 2 + 0.3, 2.05, hl + 0.5), mirrorR: new THREE.Vector3(-W / 2 - 0.3, 2.05, hl + 0.5),
    length: L, width: W, wheelbase: frontAxle - rearAxle + (spec.axles === 3 ? 0.6 : 0), doorZ: (doorZ0 + doorZ1) / 2,
    destMat,
    setDestination: (t, h) => { destMat.map?.dispose(); destMat.map = destinationTexture(t, h); destMat.needsUpdate = true; },
  };
  return model;
}

// ---------------- traffic vehicles ----------------
export type VehicleType = 'car' | 'taxi' | 'truck' | 'auto' | 'bike' | 'tractor' | 'bus';
export interface VehicleProto { type: VehicleType; mesh: THREE.Group; length: number; width: number; maxSpeed: number; lights: THREE.MeshStandardMaterial[] }

const carColors = ['#f5f5f5', '#c0c0c0', '#b71c1c', '#1a237e', '#212121', '#795548', '#0277bd', '#9e9e9e', '#e65100', '#2e7d32'];
export const vehicleHeadMat = new THREE.MeshStandardMaterial({ color: '#fffbe0', emissive: new THREE.Color('#fff4c0'), emissiveIntensity: 0.1 });
export const vehicleTailMat = new THREE.MeshStandardMaterial({ color: '#7a0000', emissive: new THREE.Color('#ff0000'), emissiveIntensity: 0.2 });

function smallWheel(g: THREE.Object3D, x: number, y: number, z: number, r: number, w: number) {
  const m = new THREE.Mesh(cylGeo(r, w, 12), mat('#141414', { rough: 0.9 })); m.rotation.z = Math.PI / 2; m.position.set(x, y, z); g.add(m); return m;
}
function lightsFB(g: THREE.Object3D, w: number, y: number, zf: number, zb: number) {
  for (const s of [1, -1]) { box(g, 0.25, 0.12, 0.05, vehicleHeadMat, s * (w / 2 - 0.25), y, zf, false); box(g, 0.25, 0.12, 0.05, vehicleTailMat, s * (w / 2 - 0.25), y, zb, false); }
}

export function buildVehicle(type: VehicleType, seed: number): VehicleProto {
  const g = new THREE.Group();
  const glass = mat('#1c2830', { rough: 0.1, metal: 0.5 });
  if (type === 'car' || type === 'taxi') {
    const col = type === 'taxi' ? '#111111' : carColors[seed % carColors.length];
    const m = mat(col, { rough: 0.35, metal: 0.4 });
    box(g, 1.72, 0.62, 4.1, m, 0, 0.62, 0);
    box(g, 1.56, 0.55, 2.1, glass, 0, 1.2, -0.25);
    box(g, 1.5, 0.08, 2.0, type === 'taxi' ? mat('#fdd835') : m, 0, 1.5, -0.25);
    for (const z of [1.3, -1.3]) for (const s of [1, -1]) smallWheel(g, s * 0.78, 0.32, z, 0.32, 0.22);
    lightsFB(g, 1.72, 0.72, 2.06, -2.06);
    return { type, mesh: g, length: 4.1, width: 1.75, maxSpeed: 19 + (seed % 5), lights: [] };
  }
  if (type === 'truck') {
    const cab = mat(['#ff8f00', '#fdd835', '#d84315', '#1565c0'][seed % 4], { rough: 0.5 });
    box(g, 2.4, 1.6, 1.9, cab, 0, 1.75, 3.0);
    box(g, 2.3, 0.7, 0.05, glass, 0, 2.15, 3.96, false);
    box(g, 2.5, 0.6, 7.6, mat('#3e2723'), 0, 0.85, 0.2);
    const sideM = new THREE.MeshStandardMaterial({ map: truckSideTexture(seed), roughness: 0.6 });
    const backM = new THREE.MeshStandardMaterial({ map: truckBackTexture(), roughness: 0.6 });
    const cargo = new THREE.Mesh(boxGeo(2.5, 2.2, 5.6), [sideM, sideM, mat('#5d4037'), mat('#333'), mat('#5d4037'), backM]);
    cargo.position.set(0, 2.25, -0.9); cargo.castShadow = true; g.add(cargo);
    // tarpaulin top
    box(g, 2.55, 0.4, 5.6, mat('#1565c0'), 0, 3.5, -0.9);
    for (const z of [3.0, -1.5, -2.9]) for (const s of [1, -1]) smallWheel(g, s * 1.05, 0.5, z, 0.5, 0.4);
    lightsFB(g, 2.4, 1.1, 3.96, -3.72);
    return { type, mesh: g, length: 8, width: 2.5, maxSpeed: 15 + (seed % 3), lights: [] };
  }
  if (type === 'auto') {
    const green = seed % 2 === 0;
    box(g, 1.3, 0.55, 2.5, mat(green ? '#2e7d32' : '#212121', { rough: 0.5 }), 0, 0.55, 0);
    box(g, 1.35, 0.1, 2.0, mat('#fdd835'), 0, 1.75, -0.1);
    box(g, 1.35, 0.85, 0.06, mat('#fdd835'), 0, 1.3, -1.12);
    box(g, 0.06, 0.85, 0.8, mat('#fdd835'), 0.66, 1.3, -0.7); box(g, 0.06, 0.85, 0.8, mat('#fdd835'), -0.66, 1.3, -0.7);
    box(g, 1.2, 0.6, 0.05, glass, 0, 1.35, 0.85, false);
    box(g, 0.1, 0.9, 0.1, mat('#fdd835'), 0, 1.3, 0.9);
    smallWheel(g, 0, 0.25, 1.0, 0.25, 0.15); smallWheel(g, 0.6, 0.25, -0.8, 0.25, 0.15); smallWheel(g, -0.6, 0.25, -0.8, 0.25, 0.15);
    const drv = new THREE.Mesh(sphGeo(0.13, 8), mat('#8d5524')); drv.position.set(0, 1.45, 0.4); g.add(drv);
    box(g, 0.2, 0.12, 0.05, vehicleHeadMat, 0, 0.9, 1.26, false);
    return { type, mesh: g, length: 2.6, width: 1.35, maxSpeed: 12 + (seed % 3), lights: [] };
  }
  if (type === 'bike') {
    box(g, 0.32, 0.45, 1.6, mat(['#b71c1c', '#111', '#1565c0', '#666'][seed % 4], { metal: 0.4, rough: 0.4 }), 0, 0.65, 0);
    smallWheel(g, 0, 0.32, 0.7, 0.32, 0.1); smallWheel(g, 0, 0.32, -0.7, 0.32, 0.1);
    const riders = 1 + (seed % 3 === 0 ? 1 : 0) + (seed % 7 === 0 ? 1 : 0);
    for (let i = 0; i < riders; i++) {
      box(g, 0.4, 0.6, 0.3, mat(['#1e88e5', '#e53935', '#fdd835', '#43a047', '#ec407a'][(seed + i) % 5]), 0, 1.2, 0.1 - i * 0.42);
      const h = new THREE.Mesh(sphGeo(0.15, 8), mat(i === 0 ? '#263238' : '#3e2723')); h.position.set(0, 1.65, 0.12 - i * 0.42); g.add(h);
    }
    box(g, 0.15, 0.1, 0.05, vehicleHeadMat, 0, 0.95, 0.82, false);
    return { type, mesh: g, length: 1.9, width: 0.7, maxSpeed: 16 + (seed % 4), lights: [] };
  }
  if (type === 'tractor') {
    const red = mat(seed % 2 ? '#c62828' : '#1565c0', { rough: 0.5 });
    box(g, 1.0, 0.9, 2.0, red, 0, 1.05, 3.0);
    box(g, 0.1, 0.8, 0.1, mat('#333'), 0.3, 1.9, 3.6);
    const big = (x: number) => { const m = new THREE.Mesh(cylGeo(0.8, 0.45, 16), mat('#1a1a1a')); m.rotation.z = Math.PI / 2; m.position.set(x, 0.8, 2.2); g.add(m); };
    big(0.85); big(-0.85);
    smallWheel(g, 0.55, 0.38, 3.8, 0.38, 0.25); smallWheel(g, -0.55, 0.38, 3.8, 0.38, 0.25);
    const drv = new THREE.Mesh(sphGeo(0.15, 8), mat('#8d5524')); drv.position.set(0, 2.0, 2.2); g.add(drv);
    box(g, 0.45, 0.55, 0.3, mat('#fff'), 0, 1.6, 2.2);
    // trolley with hay
    box(g, 2.2, 0.6, 4.0, mat('#6d4c41'), 0, 1.0, -0.6);
    box(g, 2.3, 1.2, 4.1, mat('#e6c35c', { rough: 1 }), 0, 1.9, -0.6);
    smallWheel(g, 1.05, 0.45, -0.6, 0.45, 0.3); smallWheel(g, -1.05, 0.45, -0.6, 0.45, 0.3);
    return { type, mesh: g, length: 6.8, width: 2.3, maxSpeed: 8 + (seed % 2), lights: [] };
  }
  // bus
  const ops = [['RAJ TRAVELS', '#f9a825', '#3e2723', '#fff'], ['UP ROADWAYS', '#00838f', '#fff', '#fdd835'], ['KALPANA', '#ad1457', '#fff', '#ffeb3b'], ['NAGAR SEVA', '#ef6c00', '#fff', '#5d4037']][seed % 4];
  const sideM = new THREE.MeshStandardMaterial({ map: busSideTexture(ops[1], ops[2], ops[3], ops[0], 'city'), roughness: 0.5 });
  const bm = mat(ops[1], { rough: 0.5 });
  const lower = new THREE.Mesh(boxGeo(2.5, 1.3, 11), [sideM, sideM, bm, bm, bm, bm]); lower.position.y = 1.15; lower.castShadow = true; g.add(lower);
  box(g, 2.48, 0.9, 10.9, glass, 0, 2.25, 0);
  box(g, 2.5, 0.3, 11, mat('#eeeeee'), 0, 2.85, 0);
  for (const z of [3.6, -3.2]) for (const s of [1, -1]) smallWheel(g, s * 1.05, 0.5, z, 0.5, 0.4);
  lightsFB(g, 2.5, 1.0, 5.52, -5.52);
  return { type, mesh: g, length: 11, width: 2.5, maxSpeed: 16 + (seed % 3), lights: [] };
}

// ---------------- people & animals ----------------
export interface PersonModel { group: THREE.Group; legL: THREE.Object3D; legR: THREE.Object3D; armL: THREE.Object3D; armR: THREE.Object3D }
const kurta = ['#ffffff', '#e53935', '#1e88e5', '#fdd835', '#43a047', '#8e24aa', '#fb8c00', '#00acc1', '#f06292', '#795548', '#ff7043'];
const skin = ['#8d5524', '#a0673f', '#c68642', '#6b3e1f', '#b07848'];
export function buildPerson(seed: number, policeman = false): PersonModel {
  const g = new THREE.Group();
  const female = !policeman && seed % 3 === 0;
  const top = policeman ? mat('#a1887f') : mat(kurta[seed % kurta.length]);
  const bottom = policeman ? mat('#8d6e63') : mat(female ? kurta[(seed + 4) % kurta.length] : ['#263238', '#5d4037', '#eeeeee', '#1a237e'][seed % 4]);
  const sk = mat(skin[seed % skin.length]);
  const mkLimb = (x: number, y: number, len: number, w: number, m: THREE.Material) => {
    const p = new THREE.Group(); p.position.set(x, y, 0);
    const l = new THREE.Mesh(boxGeo(w, len, w), m); l.position.y = -len / 2; l.castShadow = true; p.add(l); g.add(p); return p;
  };
  const legL = mkLimb(0.1, 0.85, 0.85, 0.13, bottom), legR = mkLimb(-0.1, 0.85, 0.85, 0.13, bottom);
  if (female) { const skirt = new THREE.Mesh(cylGeo(0.3, 0.8, 10, 0.18), bottom); skirt.position.y = 0.5; g.add(skirt); }
  const torso = new THREE.Mesh(boxGeo(0.42, 0.62, 0.24), top); torso.position.y = 1.16; torso.castShadow = true; g.add(torso);
  if (female) { const dupatta = new THREE.Mesh(boxGeo(0.45, 0.1, 0.27), mat(kurta[(seed + 2) % kurta.length])); dupatta.position.y = 1.35; dupatta.rotation.z = 0.5; g.add(dupatta); }
  const armL = mkLimb(0.27, 1.42, 0.6, 0.1, top), armR = mkLimb(-0.27, 1.42, 0.6, 0.1, top);
  const head = new THREE.Mesh(sphGeo(0.13, 10), sk); head.position.y = 1.62; g.add(head);
  const hair = new THREE.Mesh(sphGeo(0.135, 10), mat(policeman ? '#5d4037' : '#111')); hair.position.y = 1.67; hair.scale.set(1, 0.65, 1); g.add(hair);
  if (policeman) { const cap = new THREE.Mesh(cylGeo(0.15, 0.08, 10), mat('#3e2723')); cap.position.y = 1.76; g.add(cap); }
  else if (!female && seed % 5 === 0) { const turban = new THREE.Mesh(sphGeo(0.16, 8), mat(['#ff6f00', '#d50000', '#ffffff'][seed % 3])); turban.position.y = 1.74; turban.scale.set(1, 0.7, 1); g.add(turban); }
  return { group: g, legL, legR, armL, armR };
}

export interface AnimalModel { group: THREE.Group; legs: THREE.Object3D[]; kind: 'cow' | 'dog' | 'goat' }
export function buildAnimal(kind: 'cow' | 'dog' | 'goat', seed: number): AnimalModel {
  const g = new THREE.Group();
  const legs: THREE.Object3D[] = [];
  const s = kind === 'cow' ? 1 : kind === 'goat' ? 0.5 : 0.45;
  const col = kind === 'cow' ? ['#f5f5f0', '#d7ccc8', '#8d6e63', '#3e2723'][seed % 4] : kind === 'dog' ? ['#a1887f', '#d7a86e', '#3e2723'][seed % 3] : ['#f5f5f5', '#5d4037'][seed % 2];
  const m = mat(col);
  box(g, 0.75 * s, 0.75 * s, 1.7 * s, m, 0, 1.15 * s, 0);
  box(g, 0.4 * s, 0.45 * s, 0.6 * s, m, 0, 1.4 * s, 1.0 * s);
  if (kind === 'cow') { box(g, 0.05, 0.25, 0.05, mat('#ddd'), 0.15, 1.75, 1.0).rotation.z = -0.4; box(g, 0.05, 0.25, 0.05, mat('#ddd'), -0.15, 1.75, 1.0).rotation.z = 0.4; box(g, 0.3, 0.3, 0.35, m, 0, 1.6, -0.2); }
  for (const [x, z] of [[0.25, 0.65], [-0.25, 0.65], [0.25, -0.65], [-0.25, -0.65]]) {
    const p = new THREE.Group(); p.position.set(x * s, 0.8 * s, z * s);
    const l = new THREE.Mesh(boxGeo(0.15 * s, 0.8 * s, 0.15 * s), m); l.position.y = -0.4 * s; p.add(l); g.add(p); legs.push(p);
  }
  return { group: g, legs, kind };
}

// ---------------- train ----------------
export function buildTrain(): { group: THREE.Group; length: number } {
  const g = new THREE.Group();
  const loco = mat('#c62828', { rough: 0.4, metal: 0.3 });
  box(g, 3.1, 3.4, 18, loco, 0, 2.4, 0);
  box(g, 3.15, 0.5, 18.1, mat('#f5f5f5'), 0, 2.0, 0);
  box(g, 2.9, 0.9, 0.06, mat('#1c2830', { metal: 0.6, rough: 0.1 }), 0, 3.3, 9.02, false);
  box(g, 0.5, 0.3, 0.06, vehicleHeadMat, 0, 4.0, 9.03, false);
  const coachM = new THREE.MeshStandardMaterial({ map: coachTexture(), roughness: 0.6 });
  const plain = mat('#1e3a8a');
  const coachGeo = boxGeo(3.1, 3.3, 22);
  for (let i = 1; i <= 8; i++) {
    const c = new THREE.Mesh(coachGeo, [coachM, coachM, mat('#555'), plain, plain, plain]);
    c.position.set(0, 2.35, -i * 23 + 2); c.castShadow = true; g.add(c);
  }
  return { group: g, length: 18 + 8 * 23 };
}
