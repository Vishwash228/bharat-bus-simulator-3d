import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { edges, nearestRoadBrute, nodes, queryRoad, RAIL_Z, RIVER_Z, stops, zoneAt, type RoadEdge, type RoadNode } from './roads';
import { billboardTexture, cropTexture, groundDetailTexture, junctionTexture, milestoneTexture, roadTexture, signTexture, windowTexture, zebraTexture } from './textures';
import { buildPerson, buildVehicle, mat } from './models';
import type { Quality } from './types';

export function rng(seed: number) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

export interface Collider { x0: number; z0: number; x1: number; z1: number; kind?: string }

const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpE = new THREE.Euler(), tmpS = new THREE.Vector3(1, 1, 1), tmpP = new THREE.Vector3();

class Batcher {
  groups = new Map<string, { mat: THREE.Material; geos: THREE.BufferGeometry[]; shadow: boolean; receive: boolean }>();
  add(geo: THREE.BufferGeometry, key: string, m: THREE.Material, x: number, z: number, color?: THREE.ColorRepresentation, shadow = true) {
    if (!geo.getAttribute('color')) {
      const c = new THREE.Color(color ?? '#ffffff');
      const n = geo.getAttribute('position').count;
      const arr = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
      geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    }
    if (!geo.getAttribute('uv')) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(geo.getAttribute('position').count * 2), 2));
    if (!geo.index) { const idx = []; for (let i = 0; i < geo.getAttribute('position').count; i++) idx.push(i); geo.setIndex(idx); }
    const ck = key + '|' + Math.floor(x / 400) + ',' + Math.floor(z / 400);
    let g = this.groups.get(ck);
    if (!g) { g = { mat: m, geos: [], shadow, receive: true }; this.groups.set(ck, g); }
    g.geos.push(geo);
  }
  build(parent: THREE.Object3D) {
    for (const g of this.groups.values()) {
      const merged = mergeGeometries(g.geos, false);
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, g.mat);
      mesh.castShadow = g.shadow; mesh.receiveShadow = g.receive; mesh.matrixAutoUpdate = false; mesh.updateMatrix();
      parent.add(mesh);
      g.geos.forEach(x => x.dispose());
    }
    this.groups.clear();
  }
}

export function signalColor(node: RoadNode, axis: 'x' | 'z', t: number): 'green' | 'yellow' | 'red' {
  let h = 0; for (const c of node.id) h = (h * 31 + c.charCodeAt(0)) % 997;
  const cyc = 30, p = (t + h * 0.37) % cyc;
  const xs = p < 12 ? 'green' : p < 15 ? 'yellow' : 'red';
  const zs = p >= 15 && p < 27 ? 'green' : p >= 27 ? 'yellow' : 'red';
  return axis === 'x' ? xs : zs;
}

export interface WorldData {
  root: THREE.Group;
  colliders: Collider[];
  queryColliders: (x: number, z: number) => Collider[];
  paved: Collider[];
  windowMat: THREE.MeshStandardMaterial; lampMat: THREE.MeshStandardMaterial; roadMats: THREE.MeshStandardMaterial[]; waterMat: THREE.MeshStandardMaterial;
  signalLamps: THREE.InstancedMesh; signalInfo: { node: RoadNode; axis: 'x' | 'z'; color: number }[];
  pump: { x: number; z: number; r: number };
  toll: { x: number; z: number; barriers: { obj: THREE.Object3D; x: number; z: number }[] };
  checkpoint: { x: number; z: number };
  crossings: { x: number; z: number; gates: THREE.Object3D[] }[];
  police: { x: number; z: number }[];
  bridgeZones: { x: number; z0: number; z1: number }[];
}

export function buildWorld(scene: THREE.Scene, quality: Quality): WorldData {
  const root = new THREE.Group(); scene.add(root);
  const B = new Batcher();
  const R = rng(1337);
  const colliders: Collider[] = [];
  const paved: Collider[] = [];
  const vcMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
  const vcFlat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true });
  const windowMat = new THREE.MeshStandardMaterial({ map: windowTexture(false), emissiveMap: windowTexture(true), emissive: new THREE.Color('#ffffff'), emissiveIntensity: 0, vertexColors: true, roughness: 0.8 });
  const lampMat = new THREE.MeshStandardMaterial({ color: '#fff6d0', emissive: new THREE.Color('#ffd27a'), emissiveIntensity: 0.05 });
  const density = quality === 'low' ? 0.45 : quality === 'medium' ? 0.75 : 1;

  const addBox = (w: number, h: number, d: number, x: number, y: number, z: number, color: THREE.ColorRepresentation, rotY = 0, key = 'vc', m: THREE.Material = vcMat, shadow = true) => {
    const g = new THREE.BoxGeometry(w, h, d);
    tmpE.set(0, rotY, 0); tmpQ.setFromEuler(tmpE); tmpP.set(x, y, z); tmpM.compose(tmpP, tmpQ, tmpS); g.applyMatrix4(tmpM);
    B.add(g, key, m, x, z, color, shadow);
  };
  const addGeo = (g: THREE.BufferGeometry, x: number, y: number, z: number, color: THREE.ColorRepresentation, rotY = 0, key = 'vc', m: THREE.Material = vcMat, rx = 0, shadow = true) => {
    tmpE.set(rx, rotY, 0); tmpQ.setFromEuler(tmpE); tmpP.set(x, y, z); tmpM.compose(tmpP, tmpQ, tmpS); g.applyMatrix4(tmpM);
    B.add(g, key, m, x, z, color, shadow);
  };
  const collide = (x: number, z: number, w: number, d: number, kind?: string) => colliders.push({ x0: x - w / 2, z0: z - d / 2, x1: x + w / 2, z1: z + d / 2, kind });
  const building = (x: number, z: number, w: number, d: number, h: number, color: THREE.ColorRepresentation) => {
    const g = new THREE.BoxGeometry(w, h, d);
    const uv = g.getAttribute('uv') as THREE.BufferAttribute;
    for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      if (f === 2 || f === 3) { uv.setXY(i, 0.02, 0.02); continue; }
      const span = f < 2 ? d : w;
      uv.setXY(i, uv.getX(i) * span / 14, uv.getY(i) * h / 13.6);
    }
    g.translate(x, h / 2, z);
    B.add(g, 'win', windowMat, x, z, color);
    collide(x, z, w, d, 'building');
    if (R() < 0.5 && h > 6) {
      const tank = new THREE.CylinderGeometry(0.8, 0.8, 1.4, 10);
      addGeo(tank, x + (R() - 0.5) * w * 0.5, h + 0.7, z + (R() - 0.5) * d * 0.5, '#1a1a1a');
    }
    if (R() < 0.35) addBox(w * 0.9, 0.9, 0.1, x, h + 0.45, z + d / 2 - 0.05, color); // parapet
  };
  const roadDistOk = (x: number, z: number, pad: number) => { const h = queryRoad(x, z); return !h || h.dist > h.edge.width / 2 + pad; };
  const roadFarOk = (x: number, z: number, pad: number) => { const h = nearestRoadBrute(x, z); return h.dist > h.edge.width / 2 + pad; };
  const insideCollider = (x: number, z: number, pad = 1) => colliders.some(c => x > c.x0 - pad && x < c.x1 + pad && z > c.z0 - pad && z < c.z1 + pad);

  // ---------------- ground ----------------
  const gsize = 5200, gseg = quality === 'low' ? 90 : 140;
  const ground = new THREE.PlaneGeometry(gsize, gsize, gseg, gseg);
  ground.rotateX(-Math.PI / 2); ground.translate(700, 0, -200);
  const gpos = ground.getAttribute('position');
  const gcol = new Float32Array(gpos.count * 3);
  const cc = new THREE.Color();
  for (let i = 0; i < gpos.count; i++) {
    const x = gpos.getX(i), z = gpos.getZ(i);
    const zone = zoneAt(x, z);
    const n = Math.sin(x * 0.013) * Math.cos(z * 0.011) * 0.5 + Math.sin(x * 0.041 + z * 0.03) * 0.25;
    if (zone === 'city' || zone === 'town') cc.set('#8c8672');
    else if (zone === 'village') cc.set('#9b8a5c');
    else if (zone === 'mountain' || zone === 'hill') cc.set(z < -1500 ? '#7f8a6a' : '#55733a');
    else cc.set('#6e8f3c');
    cc.offsetHSL(n * 0.03, n * 0.08, n * 0.06);
    if (Math.abs(z - RIVER_Z) < 40) cc.lerp(new THREE.Color('#b8a77a'), 1 - Math.abs(z - RIVER_Z) / 40);
    if (Math.abs(z - RAIL_Z) < 4) cc.set('#6b625a');
    gcol[i * 3] = cc.r; gcol[i * 3 + 1] = cc.g; gcol[i * 3 + 2] = cc.b;
  }
  ground.setAttribute('color', new THREE.BufferAttribute(gcol, 3));
  const gtex = groundDetailTexture(); gtex.repeat.set(700, 700);
  const groundMesh = new THREE.Mesh(ground, new THREE.MeshStandardMaterial({ map: gtex, vertexColors: true, roughness: 0.95 }));
  groundMesh.receiveShadow = true; root.add(groundMesh);

  // ---------------- roads ----------------
  const roadMats: THREE.MeshStandardMaterial[] = [];
  const roadMatFor = new Map<string, THREE.MeshStandardMaterial>();
  const getRoadMat = (e: RoadEdge) => {
    let m = roadMatFor.get(e.type);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ map: roadTexture(e.type, e.lanes, e.median, e.width), roughness: 0.88, metalness: 0, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
      roadMatFor.set(e.type, m); roadMats.push(m);
    }
    return m;
  };
  for (const e of edges) {
    const n = e.pts.length;
    const pos: number[] = [], uvs: number[] = [], nor: number[] = [], idx: number[] = [];
    for (let i = 0; i < n; i++) {
      const p = e.pts[i];
      const a = e.pts[Math.max(0, i - 1)], b = e.pts[Math.min(n - 1, i + 1)];
      let dx = b.x - a.x, dz = b.z - a.z; const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
      const lx = dz, lz = -dx, hw = e.width / 2;
      const y = p.y + 0.03;
      pos.push(p.x + lx * hw, y, p.z + lz * hw, p.x - lx * hw, y, p.z - lz * hw);
      uvs.push(0, e.cum[i] / 12, 1, e.cum[i] / 12);
      nor.push(0, 1, 0, 0, 1, 0);
      if (i < n - 1) { const k = i * 2; idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setIndex(idx);
    const mid = e.pts[Math.floor(n / 2)];
    B.add(g, 'road-' + e.type, getRoadMat(e), mid.x, mid.z, '#ffffff', false);
    // dirt shoulders for rural/mountain
    if ((e.type === 'rural' || e.type === 'mountain' || e.type === 'village') && !e.pts.some(p => p.y > 0.05)) {
      const sp: number[] = [], si: number[] = [];
      for (let i = 0; i < n; i++) {
        const p = e.pts[i]; const a = e.pts[Math.max(0, i - 1)], b = e.pts[Math.min(n - 1, i + 1)];
        let dx = b.x - a.x, dz = b.z - a.z; const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
        const hw = e.width / 2 + 2.2;
        sp.push(p.x + dz * hw, p.y + 0.018, p.z - dx * hw, p.x - dz * hw, p.y + 0.018, p.z + dx * hw);
        if (i < n - 1) { const k = i * 2; si.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
      }
      const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3)); sg.setIndex(si); sg.computeVertexNormals();
      sg.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(sp.length).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
      B.add(sg, 'vc-flatground', vcMat, mid.x, mid.z, '#8a7552', false);
    }
  }
  // junction patches
  const jMat = new THREE.MeshStandardMaterial({ map: junctionTexture(), roughness: 0.88, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  roadMats.push(jMat);
  for (const n of nodes.values()) {
    const w = Math.max(...n.edges.map(i => edges[i].width));
    const isGrid = n.id.startsWith('c') || n.id === 'rC';
    const g = isGrid ? new THREE.PlaneGeometry(w, w) : new THREE.CircleGeometry(w / 2, 20);
    g.rotateX(-Math.PI / 2);
    g.translate(n.x, 0.045, n.z);
    if (n.edges.length > 1 || isGrid) B.add(g, 'junction', jMat, n.x, n.z, '#ffffff', false);
  }
  // zebra crossings at signals
  const zMat = new THREE.MeshStandardMaterial({ map: zebraTexture(), transparent: true, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6, depthWrite: false });
  roadMats.push(zMat);

  // ---------------- signals ----------------
  const signalInfo: WorldData['signalInfo'] = [];
  const lampPos: THREE.Vector3[] = [];
  for (const n of nodes.values()) {
    if (!n.signal) continue;
    for (const ei of n.edges) {
      const e = edges[ei];
      const atB = e.b === n.id;
      const p0 = atB ? e.pts[e.pts.length - 2] : e.pts[1];
      let dx = n.x - p0.x, dz = n.z - p0.z; const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L; // approach dir
      const axis: 'x' | 'z' = Math.abs(dx) > Math.abs(dz) ? 'x' : 'z';
      const hw = e.width / 2;
      const px = n.x - dx * (hw + 3.2) + dz * (hw + 1.0), pz = n.z - dz * (hw + 3.2) - dx * (hw + 1.0);
      addBox(0.16, 4.2, 0.16, px, 2.1, pz, '#333');
      const rot = Math.atan2(dx, dz);
      addBox(0.45, 1.25, 0.35, px, 4.4, pz, '#1a1a1a', rot);
      for (let k = 0; k < 3; k++) { lampPos.push(new THREE.Vector3(px - dx * 0.2, 4.8 - k * 0.38, pz - dz * 0.2)); signalInfo.push({ node: n, axis, color: k }); }
      // zebra
      const zg = new THREE.PlaneGeometry(e.width - 1, 3); zg.rotateX(-Math.PI / 2); zg.rotateY(rot);
      zg.translate(n.x - dx * (hw + 1.6), 0.06, n.z - dz * (hw + 1.6));
      B.add(zg, 'zebra', zMat, n.x, n.z, '#ffffff', false);
    }
  }
  const signalLamps = new THREE.InstancedMesh(new THREE.SphereGeometry(0.15, 8, 6), new THREE.MeshBasicMaterial({ color: '#ffffff' }), Math.max(1, lampPos.length));
  lampPos.forEach((p, i) => { tmpM.makeTranslation(p.x, p.y, p.z); signalLamps.setMatrixAt(i, tmpM); signalLamps.setColorAt(i, new THREE.Color('#222')); });
  root.add(signalLamps);

  // ---------------- city ----------------
  const xs = [-180, -60, 60, 180];
  const pastel = ['#f3e5ab', '#f8bbd0', '#b3e5fc', '#ffe0b2', '#e6ee9c', '#ffffff', '#d7ccc8', '#ffcc80', '#c5e1a5', '#f0f4c3', '#ffab91', '#e1bee7'];
  const awningCols = ['#e53935', '#1e88e5', '#43a047', '#fdd835', '#fb8c00', '#8e24aa'];
  const police: { x: number; z: number }[] = [];
  const signMesh = (text: string, sub: string, x: number, y: number, z: number, rotY: number, w: number, h: number, bg = '#0d47a1', fg = '#ffffff') => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: signTexture(text, sub, bg, fg), roughness: 0.6, side: THREE.DoubleSide, emissive: new THREE.Color('#ffffff'), emissiveIntensity: 0.08 }));
    m.position.set(x, y, z); m.rotation.y = rotY; root.add(m); return m;
  };
  const tree = (x: number, z: number, kind: 'neem' | 'palm' | 'pine' | 'banyan' | 'shrub', s = 1) => {
    if (kind === 'palm') {
      addGeo(new THREE.CylinderGeometry(0.18 * s, 0.28 * s, 8 * s, 6), x, 4 * s, z, '#7b5e3b');
      for (let i = 0; i < 6; i++) { const lf = new THREE.BoxGeometry(0.6 * s, 0.08, 3.4 * s); lf.translate(0, 0, 1.6 * s); lf.rotateX(0.45); lf.rotateY(i * Math.PI / 3); lf.translate(x, 8 * s, z); B.add(lf, 'vc', vcMat, x, z, '#3f7f2f'); }
    } else if (kind === 'pine') {
      addGeo(new THREE.CylinderGeometry(0.2 * s, 0.3 * s, 3 * s, 5), x, 1.5 * s, z, '#4e342e');
      addGeo(new THREE.ConeGeometry(2.4 * s, 5 * s, 7), x, 4.5 * s, z, '#1f4d2b', R() * 3, 'vcf', vcFlat);
      addGeo(new THREE.ConeGeometry(1.8 * s, 4 * s, 7), x, 7 * s, z, '#24582f', R() * 3, 'vcf', vcFlat);
    } else if (kind === 'shrub') {
      addGeo(new THREE.IcosahedronGeometry(1.1 * s, 0), x, 0.8 * s, z, '#4a7a2a', R() * 3, 'vcf', vcFlat);
    } else {
      const big = kind === 'banyan' ? 2.2 : 1;
      addGeo(new THREE.CylinderGeometry(0.3 * s * big, 0.45 * s * big, 3.5 * s, 6), x, 1.75 * s, z, '#5d4037');
      const cg = new THREE.IcosahedronGeometry(3 * s * big, 1);
      addGeo(cg, x, (4.5 + big) * s, z, ['#3d6b2a', '#4a7c2c', '#56873a'][Math.floor(R() * 3)], R() * 3, 'vcf', vcFlat);
    }
  };
  const streetLamp = (x: number, z: number, armDx: number, armDz: number) => {
    addBox(0.15, 7, 0.15, x, 3.5, z, '#6b6b6b');
    addBox(Math.abs(armDx) > 0.1 ? 1.6 : 0.12, 0.1, Math.abs(armDz) > 0.1 ? 1.6 : 0.12, x + armDx * 0.8, 7, z + armDz * 0.8, '#6b6b6b');
    const lg = new THREE.BoxGeometry(0.5, 0.15, 0.5); lg.translate(x + armDx * 1.6, 6.9, z + armDz * 1.6);
    B.add(lg, 'lamp', lampMat, x, z, '#ffffff', false);
  };

  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    const bx0 = xs[i] + 4.75, bx1 = xs[i + 1] - 4.75, bz0 = xs[j] + 4.75, bz1 = xs[j + 1] - 4.75;
    // sidewalks
    addBox(bx1 - bx0, 0.18, 3, (bx0 + bx1) / 2, 0.09, bz0 + 1.5, '#a8a39a', 0, 'vc', vcMat, false);
    addBox(bx1 - bx0, 0.18, 3, (bx0 + bx1) / 2, 0.09, bz1 - 1.5, '#a8a39a', 0, 'vc', vcMat, false);
    addBox(3, 0.18, bz1 - bz0 - 6, bx0 + 1.5, 0.09, (bz0 + bz1) / 2, '#a8a39a', 0, 'vc', vcMat, false);
    addBox(3, 0.18, bz1 - bz0 - 6, bx1 - 1.5, 0.09, (bz0 + bz1) / 2, '#a8a39a', 0, 'vc', vcMat, false);
    // inner ground
    addBox(bx1 - bx0 - 6, 0.06, bz1 - bz0 - 6, (bx0 + bx1) / 2, 0.03, (bz0 + bz1) / 2, '#8f8a7a', 0, 'vc', vcMat, false);
    // street lamps
    for (let x = bx0 + 10; x < bx1 - 5; x += 32) { streetLamp(x, bz0 + 0.6, 0, -1); streetLamp(x, bz1 - 0.6, 0, 1); }
    const ix0 = bx0 + 4, ix1 = bx1 - 4, iz0 = bz0 + 4, iz1 = bz1 - 4;
    const key = `${i}${j}`;
    if (key === '11') {
      // Central Bus Stand
      addBox(84, 0.3, 40, 0, 0.15, -8, '#9e9e9e', 0, 'vc', vcMat, false);
      paved.push({ x0: ix0, z0: iz0, x1: ix1, z1: iz1 });
      for (let x = -38; x <= 38; x += 12.6) for (const z of [-24, 8]) { addBox(0.6, 7, 0.6, x, 3.5, z, '#eeeeee'); collide(x, z, 0.8, 0.8); }
      addBox(86, 0.6, 38, 0, 7.3, -8, '#2e7d32');
      addBox(86, 0.2, 38.4, 0, 7.65, -8, '#e0e0e0');
      building(0, -40, 90, 14, 12, '#fff3e0');
      for (let k = 0; k < 4; k++) { addBox(1.5, 0.35, 18, -30 + k * 20, 0.35, -8, '#bdbdbd'); }
      signMesh('CENTRAL BUS STAND', 'केंद्रीय बस अड्डा • Platform 1-6', 0, 9.6, 10.9, 0, 26, 3.2, '#b71c1c');
      for (let k = 0; k < 3; k++) {
        const pb = buildVehicle('bus', k + 1); pb.mesh.position.set(-20 + k * 20, 0, -6); pb.mesh.rotation.y = Math.PI; root.add(pb.mesh);
        pb.mesh.traverse(o => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
        collide(-20 + k * 20, -6, 2.6, 11);
      }
    } else if (key === '01') {
      // Sadar Bazaar market
      paved.push({ x0: ix0, z0: iz0, x1: ix1, z1: iz1 });
      for (let x = ix0 + 4; x < ix1 - 3; x += 7.5) for (const [z, f] of [[iz0 + 5, 1], [iz1 - 5, -1]] as [number, number][]) {
        const h = 5 + Math.floor(R() * 3) * 3.4;
        building(x, z, 7, 9, h, pastel[Math.floor(R() * pastel.length)]);
        const aw = new THREE.BoxGeometry(6.6, 0.12, 2.4); aw.rotateX(-f * 0.25); aw.translate(x, 3.1, z + f * 5.6);
        B.add(aw, 'vc', vcMat, x, z, awningCols[Math.floor(R() * awningCols.length)]);
      }
      for (let z = iz0 + 14; z < iz1 - 14; z += 7.5) {
        const h = 5 + Math.floor(R() * 3) * 3.4;
        building(ix1 - 5, z, 9, 7, h, pastel[Math.floor(R() * pastel.length)]);
        const aw = new THREE.BoxGeometry(2.4, 0.12, 6.6); aw.rotateZ(-0.25); aw.translate(ix1 - 10.6, 3.1, z);
        B.add(aw, 'vc', vcMat, ix1, z, awningCols[Math.floor(R() * awningCols.length)]);
      }
      for (let k = 0; k < 22; k++) {
        const x = ix0 + 14 + R() * (ix1 - ix0 - 32), z = iz0 + 16 + R() * (iz1 - iz0 - 32);
        addGeo(new THREE.ConeGeometry(1.8, 0.8, 8), x, 2.6, z, awningCols[k % awningCols.length]);
        addBox(0.08, 2.4, 0.08, x, 1.2, z, '#555');
        addBox(1.8, 0.8, 1.0, x, 0.6, z + 0.3, ['#8d6e63', '#a1887f'][k % 2]);
        addBox(1.6, 0.25, 0.8, x, 1.1, z + 0.3, ['#ff7043', '#ffee58', '#66bb6a', '#ef5350'][k % 4]);
      }
      signMesh('SADAR BAZAAR', 'सदर बाज़ार', -120, 7, iz1 + 0.5, 0, 14, 2.4, '#e65100');
    } else if (key === '20') {
      // City hospital
      building(120, -128, 70, 26, 22, '#fafafa');
      building(98, -105, 22, 18, 10, '#e3f2fd');
      addBox(6, 6, 0.3, 120, 18, -114.8, '#ffffff');
      addBox(4.5, 1.4, 0.35, 120, 18, -114.7, '#e53935', 0, 'vc', vcMat, false); addBox(1.4, 4.5, 0.35, 120, 18, -114.7, '#e53935', 0, 'vc', vcMat, false);
      signMesh('CITY HOSPITAL', 'सिटी अस्पताल • 24x7 Emergency', 132, 12, -114.7, 0, 18, 2.6, '#c62828');
      const amb = new THREE.Group(); root.add(amb);
      const ab = new THREE.Mesh(new THREE.BoxGeometry(2.1, 2.3, 5), mat('#ffffff')); ab.position.y = 1.4; amb.add(ab);
      const ar = new THREE.Mesh(new THREE.BoxGeometry(2.12, 0.3, 5.02), mat('#e53935')); ar.position.y = 1.5; amb.add(ar);
      amb.position.set(150, 0, -95); amb.rotation.y = 0.3; collide(150, -95, 3, 5);
      for (let x = ix0 + 3; x < ix1; x += 9) tree(x, iz1 - 3, 'neem', 0.8);
    } else if (key === '02') {
      // School
      building(-140, 140, 52, 14, 10, '#ffe082');
      building(-160, 110, 14, 30, 10, '#ffe082');
      addBox(56, 0.08, 34, -110, 0.07, 96, '#a1887f', 0, 'vc', vcMat, false);
      addBox(0.12, 9, 0.12, -84, 4.5, 84, '#bbbbbb');
      addBox(0.04, 0.5, 1.6, -84, 8.6, 84.8, '#ff9933'); addBox(0.04, 0.5, 1.6, -84, 8.1, 84.8, '#ffffff'); addBox(0.04, 0.5, 1.6, -84, 7.6, 84.8, '#138808');
      for (const x of [-130, -92]) { addBox(0.15, 3, 0.15, x, 1.5, 96, '#eee'); addBox(0.1, 0.1, 6, x, 3, 96, '#eee'); }
      signMesh('GOVT. SR. SEC. SCHOOL', 'राजकीय विद्यालय', -120, 6.5, 76.4, Math.PI, 16, 2.4, '#1b5e20');
    } else if (key === '22') {
      // temple + park
      addBox(20, 1.2, 20, 120, 0.6, 120, '#efebe9');
      addGeo(new THREE.ConeGeometry(5, 16, 8), 120, 9.2, 120, '#ffcc80', 0, 'vcf', vcFlat);
      addBox(9, 6, 9, 120, 4.2, 120, '#fff3e0');
      addBox(0.1, 6, 0.1, 120, 20, 120, '#8d6e63'); addBox(0.05, 1, 1.6, 120, 22.4, 120.8, '#ff6f00');
      collide(120, 120, 20, 20);
      for (let k = 0; k < 14; k++) { const a = k / 14 * Math.PI * 2; tree(120 + Math.cos(a) * 34, 120 + Math.sin(a) * 34, k % 3 ? 'neem' : 'palm', 0.9); }
      for (const [x, z] of [[ix0 + 6, iz0 + 6], [ix1 - 6, iz0 + 6], [ix0 + 6, iz1 - 6], [ix1 - 6, iz1 - 6]]) building(x, z, 12, 12, 9 + R() * 8, pastel[Math.floor(R() * pastel.length)]);
    } else {
      // generic city block
      const center = Math.abs((xs[i] + xs[i + 1]) / 2) < 100 && Math.abs((xs[j] + xs[j + 1]) / 2) < 100;
      for (const [z, f] of [[iz0 + 8, 1], [iz1 - 8, -1]] as [number, number][]) {
        let x = ix0 + 6;
        while (x < ix1 - 6) {
          const w = 9 + R() * 9; const cx = Math.min(x + w / 2, ix1 - w / 2);
          const h = (center ? 12 : 7) + R() * (center ? 26 : 14);
          building(cx, z, w - 0.6, 15, h, pastel[Math.floor(R() * pastel.length)]);
          if (R() < 0.6) { const aw = new THREE.BoxGeometry(w - 1.5, 0.1, 2); aw.rotateX(-f * 0.25); aw.translate(cx, 3.2, z + f * 8.4); B.add(aw, 'vc', vcMat, cx, z, awningCols[Math.floor(R() * awningCols.length)]); }
          x += w;
        }
      }
      for (const [xx, f] of [[ix0 + 8, 1], [ix1 - 8, -1]] as [number, number][]) {
        let z = iz0 + 22;
        while (z < iz1 - 22) {
          const w = 9 + R() * 8; const cz = Math.min(z + w / 2, iz1 - 16 - w / 2);
          building(xx, cz, 15, w - 0.6, 7 + R() * 16, pastel[Math.floor(R() * pastel.length)]);
          void f; z += w;
        }
      }
      for (let k = 0; k < 5; k++) tree(ix0 + 30 + R() * (ix1 - ix0 - 60), iz0 + 30 + R() * (iz1 - iz0 - 60), 'neem', 0.9);
    }
  }
  // outer ring of city buildings beyond grid edges
  for (const side of [-1, 1]) {
    for (let t = -170; t <= 170; t += 16) {
      if (!roadDistOk(t, side * 205, 4)) continue;
      if (R() < 0.85) building(t, side * 205, 12, 14, 6 + R() * 12, pastel[Math.floor(R() * pastel.length)]);
      if (roadDistOk(side * 205, t, 4) && R() < 0.85) building(side * 205, t, 14, 12, 6 + R() * 12, pastel[Math.floor(R() * pastel.length)]);
    }
  }
  // traffic police podiums at main junctions
  for (const id of ['c11', 'c22', 'c21']) {
    const n = nodes.get(id)!;
    const px = n.x - 7.5, pz = n.z + 7.5;
    addGeo(new THREE.CylinderGeometry(0.7, 0.8, 0.5, 10), px, 0.25, pz, '#fdd835');
    addGeo(new THREE.ConeGeometry(1.3, 0.6, 8), px, 3.2, pz, '#e53935');
    addBox(0.06, 3, 0.06, px, 1.5, pz, '#555');
    const cop = buildPerson(id.length, true); cop.group.position.set(px, 0.5, pz); cop.armR.rotation.x = -1.3; root.add(cop.group);
    police.push({ x: n.x, z: n.z });
  }

  // ---------------- highway features ----------------
  // median barrier segments + shrubs + lamps
  for (const [a, b] of [[200, 435], [465, 1035], [1065, 1385]]) {
    addBox(b - a, 0.5, 0.7, (a + b) / 2, 0.3, 60, '#bdbdbd');
    collide((a + b) / 2, 60, b - a, 0.8, 'median');
    for (let x = a + 4; x < b; x += 9) addGeo(new THREE.IcosahedronGeometry(0.7, 0), x, 0.9, 60, '#3d7a2a', R() * 3, 'vcf', vcFlat);
    for (let x = a + 10; x < b; x += 45) {
      addBox(0.18, 8, 0.18, x, 4, 60, '#777');
      addBox(0.1, 0.1, 3.2, x, 8, 60, '#777');
      for (const s of [-1, 1]) { const lg = new THREE.BoxGeometry(0.6, 0.15, 0.4); lg.translate(x, 7.9, 60 + s * 1.6); B.add(lg, 'lamp', lampMat, x, 60, '#fff', false); }
    }
  }
  // milestones
  for (let x = 260, km = 12; x < 1380; x += 280, km -= 2) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.9, 0.3), [mat('#eee'), mat('#eee'), mat('#fbc02d'), mat('#eee'), new THREE.MeshStandardMaterial({ map: milestoneTexture('RAMPUR', Math.max(1, km)) }), mat('#eee')]);
    m.position.set(x, 0.45, 51.5 - 1.5); m.rotation.y = -Math.PI / 2; root.add(m);
  }
  // billboards
  const bbs: [number, number, number][] = [[300, 82, Math.PI], [620, 36, 0], [880, 84, Math.PI], [1200, 36, 0], [-40, 360, Math.PI / 2], [110, -430, -Math.PI / 2], [-20, 260, Math.PI / 2]];
  bbs.forEach(([x, z, r], k) => {
    addBox(0.3, 6, 0.3, x - 3, 3, z, '#555'); addBox(0.3, 6, 0.3, x + 3, 3, z, '#555');
    const bb = new THREE.Mesh(new THREE.PlaneGeometry(9, 4.5), new THREE.MeshStandardMaterial({ map: billboardTexture(k), side: THREE.DoubleSide, roughness: 0.6 }));
    bb.position.set(x, 7.5, z); bb.rotation.y = r; root.add(bb);
  });
  // petrol pump (north side, eastbound access)
  const pump = { x: 320, z: 36, r: 24 };
  addBox(70, 0.1, 36, 320, 0.05, 32, '#9e9e9e', 0, 'vc', vcMat, false);
  paved.push({ x0: 285, z0: 13, x1: 355, z1: 52 });
  addBox(34, 0.8, 16, 320, 6.2, 34, '#ffffff'); addBox(34.2, 0.4, 16.2, 320, 5.7, 34, '#1565c0');
  for (const [x, z] of [[306, 28], [334, 28], [306, 40], [334, 40]]) { addBox(0.6, 5.8, 0.6, x, 2.9, z, '#e0e0e0'); collide(x, z, 0.8, 0.8); }
  for (const x of [312, 328]) { addBox(1.4, 2, 0.9, x, 1, 34, '#fdd835'); addBox(1.0, 0.6, 0.95, x, 1.6, 34, '#1565c0'); collide(x, 34, 1.8, 1.4); }
  building(320, 17, 22, 6, 4, '#e3f2fd');
  addBox(0.5, 12, 0.5, 350, 6, 50, '#888');
  signMesh('BHARAT FUELS', 'Petrol • Diesel • CNG', 350, 12, 50.3, 0, 7, 3, '#0d47a1', '#fdd835');
  // toll plaza
  const toll = { x: 750, z: 60, barriers: [] as { obj: THREE.Object3D; x: number; z: number }[] };
  addBox(10, 0.6, 26, 750, 7, 60, '#fafafa'); addBox(10.2, 0.5, 26.2, 750, 6.6, 60, '#2e7d32');
  for (const off of [-0.7, 0.7, -4.4, 4.4, -8.6, 8.6]) {
    const z = 60 + off;
    addBox(8, 0.25, 0.6, 750, 0.13, z, '#fdd835');
    if (Math.abs(off) > 1) { addBox(1.6, 2.6, 0.55, 750, 1.4, z, '#eceff1'); addBox(1.6, 0.9, 0.58, 750, 2.0, z, '#4fc3f7'); }
    addBox(0.35, 6.6, 0.35, 750, 3.3, z, '#cfd8dc');
    collide(750, z, 8, 0.6, 'toll');
  }
  const barrierMatA = mat('#e53935'), barrierMatB = mat('#ffffff');
  for (const lane of [-6.5, -2.55, 2.55, 6.5]) {
    const bz = 60 + lane - Math.sign(lane) * 1.5;
    const piv = new THREE.Group(); piv.position.set(lane < 0 ? 746.5 : 753.5, 1.1, bz);
    for (let k = 0; k < 6; k++) { const seg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.55), k % 2 ? barrierMatA : barrierMatB); seg.position.z = Math.sign(lane) * (0.3 + k * 0.55); piv.add(seg); }
    root.add(piv); toll.barriers.push({ obj: piv, x: piv.position.x, z: 60 + lane });
  }
  signMesh('TOLL PLAZA – NH-48', 'FASTag Lanes • टोल प्लाज़ा', 744.9, 8.6, 60, -Math.PI / 2, 22, 2.6, '#1b5e20');
  signMesh('TOLL PLAZA – NH-48', 'FASTag Lanes • टोल प्लाज़ा', 755.1, 8.6, 60, Math.PI / 2, 22, 2.6, '#1b5e20');
  // dhaba (north side)
  building(955, 24, 22, 10, 4.2, '#d7a86e');
  addGeo(new THREE.ConeGeometry(15, 3, 4), 955, 5.7, 24, '#c2a15a', Math.PI / 4, 'vcf', vcFlat);
  addBox(40, 0.08, 24, 960, 0.04, 36, '#a1887f', 0, 'vc', vcMat, false);
  paved.push({ x0: 940, z0: 26, x1: 985, z1: 52 });
  for (let k = 0; k < 6; k++) { const x = 940 + k * 5, z = 36; addBox(1.0, 0.45, 2, x, 0.45, z, '#8d6e63'); addBox(0.9, 0.05, 1.9, x, 0.7, z, '#efebe9'); }
  signMesh('SHER-E-PUNJAB DHABA', 'Pure Veg • Chai • Paratha 24 hrs', 955, 6.4, 29.2, 0, 14, 2.6, '#e65100', '#fff59d');
  const dtruck = buildVehicle('truck', 2); dtruck.mesh.position.set(980, 0, 30); dtruck.mesh.rotation.y = Math.PI / 2; root.add(dtruck.mesh); collide(980, 30, 8, 2.6);

  // ---------------- police checkpoint ----------------
  const checkpoint = { x: 60, z: -270 };
  for (const [x, z] of [[55.2, -262], [64.8, -278], [55.2, -282], [64.8, -258]]) {
    for (let k = 0; k < 3; k++) addBox(0.9, 0.9, 0.3, x + (k - 1) * 0.0, 0.45, z + (k - 1) * 1.0, k % 2 ? '#ffffff' : '#e53935');
    collide(x, z, 1, 3, 'barricade');
  }
  building(72, -270, 4, 4, 3, '#8d6e63');
  addBox(4.4, 0.3, 4.4, 72, 3.1, -270, '#3e2723');
  signMesh('POLICE CHECK POST', 'रुकिए • STOP – पुलिस जाँच', 69, 4.2, -262, -Math.PI / 2, 6, 1.6, '#0d47a1');
  for (let k = 0; k < 2; k++) { const cop = buildPerson(3 + k, true); cop.group.position.set(66.5, 0, -266 - k * 6); cop.group.rotation.y = -Math.PI / 2; if (k === 0) cop.armR.rotation.x = -1.5; root.add(cop.group); }
  police.push(checkpoint);

  // ---------------- river & bridges ----------------
  const waterMat = new THREE.MeshStandardMaterial({ color: '#2f7086', roughness: 0.15, metalness: 0.35 });
  const water = new THREE.Mesh(new THREE.PlaneGeometry(5200, 52), waterMat); water.rotation.x = -Math.PI / 2; water.position.set(700, 0.06, RIVER_Z); water.receiveShadow = true; root.add(water);
  const bridgeZones: WorldData['bridgeZones'] = [];
  for (const e of edges) {
    if (!e.pts.some(p => p.y > 0.1)) continue;
    const x = e.pts[0].x; const z0 = Math.min(e.pts[0].z, e.pts[e.pts.length - 1].z), z1 = Math.max(e.pts[0].z, e.pts[e.pts.length - 1].z);
    bridgeZones.push({ x, z0, z1 });
    for (let i = 0; i < e.pts.length - 1; i++) {
      const p = e.pts[i], q = e.pts[i + 1];
      const y = (p.y + q.y) / 2, zc = (p.z + q.z) / 2, len = Math.abs(q.z - p.z);
      if (y > 0.2) addBox(e.width + 1, 0.8, len + 0.05, x, y - 0.4, zc, '#9e9e9e');
      for (const s of [-1, 1]) {
        addBox(0.35, 1.1, len + 0.05, x + s * (e.width / 2 + 0.4), y + 0.55, zc, '#e0e0e0');
      }
      if (y > 3 && i % 2 === 0) for (const s of [-1, 1]) addBox(1.4, y, 1.4, x + s * (e.width / 2 - 1), y / 2 - 0.4, zc, '#8d8d8d');
    }
    for (const s of [-1, 1]) collide(x + s * (e.width / 2 + 0.5), (z0 + z1) / 2, 0.5, z1 - z0, 'rail');
    signMesh(e.name.toUpperCase(), 'नदी पुल', x - e.width / 2 - 2, 3, z1 - 2, Math.PI / 2, 6, 1.4, '#1b5e20');
  }

  // ---------------- railway ----------------
  addBox(5200, 0.25, 3.6, 700, 0.12, RAIL_Z, '#6b625a', 0, 'vc', vcMat, false);
  for (const s of [-0.75, 0.75]) addBox(5200, 0.16, 0.12, 700, 0.32, RAIL_Z + s, '#9e9e9e', 0, 'vc', vcMat, false);
  const sleeperStep = quality === 'low' ? 3 : 1.8;
  for (let x = -1800; x < 3200; x += sleeperStep) {
    if (Math.abs(x - 700) > 1300 && quality !== 'high') continue;
    addBox(0.25, 0.12, 2.6, x, 0.24, RAIL_Z, '#4e3b2a', 0, 'vc', vcMat, false);
  }
  // overhead electric poles
  for (let x = -1200; x < 2600; x += 60) { addBox(0.25, 7, 0.25, x, 3.5, RAIL_Z - 3, '#777'); addBox(0.12, 0.12, 3.5, x, 6.9, RAIL_Z - 1.4, '#777'); }
  const crossings: WorldData['crossings'] = [];
  for (const e of edges) for (let i = 0; i < e.pts.length - 1; i++) {
    const p = e.pts[i], q = e.pts[i + 1];
    if ((p.z - RAIL_Z) * (q.z - RAIL_Z) <= 0 && p.z !== q.z) {
      const t = (RAIL_Z - p.z) / (q.z - p.z); const cx = p.x + (q.x - p.x) * t;
      const gates: THREE.Object3D[] = [];
      for (const s of [-1, 1]) {
        const gz = RAIL_Z + s * 6.5;
        const postX = cx + s * (e.width / 2 + 0.8);
        addBox(0.4, 1.4, 0.4, postX, 0.7, gz, '#fdd835');
        const piv = new THREE.Group(); piv.position.set(postX, 1.2, gz);
        for (let k = 0; k < Math.ceil(e.width / 0.8); k++) { const seg = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.12, 0.12), k % 2 ? barrierMatA : barrierMatB); seg.position.x = -s * (0.4 + k * 0.8); piv.add(seg); }
        piv.rotation.z = s * 1.4;
        root.add(piv); gates.push(piv);
        addBox(0.1, 3, 0.1, cx - s * (e.width / 2 + 2), 1.5, RAIL_Z + s * 9, '#eee');
        addBox(1.6, 0.25, 0.05, cx - s * (e.width / 2 + 2), 2.9, RAIL_Z + s * 9, '#e53935', 0.78);
        addBox(1.6, 0.25, 0.05, cx - s * (e.width / 2 + 2), 2.9, RAIL_Z + s * 9, '#e53935', -0.78);
      }
      signMesh('RAILWAY CROSSING', 'रुकें • देखें • जाएँ', cx + e.width / 2 + 3, 3.2, RAIL_Z + 14, 0, 5, 1.3, '#fdd835', '#111');
      crossings.push({ x: cx, z: RAIL_Z, gates });
      // small station hut
      building(cx + 18, RAIL_Z - 12, 10, 6, 4, '#ffcc80');
    }
  }

  // ---------------- Rampur town ----------------
  for (const [x0, x1, z] of [[1410, 1490, 46], [1410, 1490, 74], [1510, 1590, 46], [1510, 1590, 74]] as [number, number, number][]) {
    for (let x = x0 + 5; x < x1 - 4; x += 11) {
      const zz = z < 60 ? z - 9 : z + 9;
      if (x > 1435 && x < 1465 && z < 60) continue;
      building(x, zz, 10, 12, 6 + R() * 9, pastel[Math.floor(R() * pastel.length)]);
    }
  }
  for (const [x, z0, z1] of [[1486, -30, 46], [1514, -30, 46], [1486, 74, 150], [1514, 74, 150]] as [number, number, number][]) {
    for (let z = z0 + 6; z < z1 - 5; z += 11) building(x < 1500 ? x - 9 : x + 9, z, 12, 10, 6 + R() * 8, pastel[Math.floor(R() * pastel.length)]);
  }
  addBox(30, 0.4, 10, 1450, 4.6, 40, '#c62828'); for (const x of [1437, 1463]) { addBox(0.4, 4.6, 0.4, x, 2.3, 44, '#ddd'); }
  signMesh('RAMPUR BUS STAND', 'रामपुर बस स्टैंड', 1450, 5.8, 45.3, 0, 12, 1.8, '#c62828');
  police.push({ x: 1500, z: 60 });

  // ---------------- Sitapur village ----------------
  const hut = (x: number, z: number, r: number) => {
    addBox(5, 2.6, 4.4, x, 1.3, z, '#b07a4a', r);
    addGeo(new THREE.ConeGeometry(4.2, 2.4, 4), x, 3.8, z, '#c9a85a', r + Math.PI / 4, 'vcf', vcFlat);
    addBox(1, 1.8, 0.1, x + Math.sin(r) * 2.22, 0.9, z + Math.cos(r) * 2.22, '#4e342e', r);
    collide(x, z, 5, 5);
  };
  for (let k = 0; k < 34 * density + 8; k++) {
    const x = -300 + R() * 380, z = 830 + R() * 240;
    if (!roadDistOk(x, z, 6) || insideCollider(x, z, 4)) continue;
    hut(x, z, Math.floor(R() * 4) * Math.PI / 2);
  }
  addGeo(new THREE.CylinderGeometry(1.4, 1.4, 1, 14), -60, 0.5, 940, '#9e9e9e'); collide(-60, 940, 2.8, 2.8);
  tree(-140, 960, 'banyan', 1.2); collide(-140, 960, 3, 3);
  building(-40, 880, 18, 10, 4.5, '#e8f5e9'); signMesh('PRIMARY HEALTH CENTRE', 'प्राथमिक स्वास्थ्य केंद्र', -40, 3.6, 885.1, 0, 10, 1.6, '#2e7d32');
  addBox(8, 1, 8, -200, 0.5, 940, '#fff3e0'); addGeo(new THREE.ConeGeometry(3, 8, 8), -200, 5, 940, '#ff8a65', 0, 'vcf', vcFlat); collide(-200, 940, 8, 8);
  signMesh('SITAPUR', 'सीतापुर • ग्राम पंचायत', -60, 3, 850, 0, 6, 1.5, '#2e7d32');
  for (let k = 0; k < 14; k++) { const x = -280 + R() * 340, z = 800 + R() * 280; if (roadDistOk(x, z, 5) && !insideCollider(x, z, 3)) addGeo(new THREE.ConeGeometry(1.6, 2.4, 8), x, 1.2, z, '#e3c16f'); }

  // ---------------- Himgiri hill station ----------------
  const cottage = (x: number, z: number, r: number) => {
    const c = ['#fff8e1', '#ffecb3', '#e1f5fe', '#fbe9e7'][Math.floor(R() * 4)];
    addBox(7, 4, 6, x, 2, z, c, r);
    const roof = new THREE.CylinderGeometry(4.3, 4.3, 7.4, 3, 1); roof.rotateZ(Math.PI / 2); roof.scale(1, 0.55, 1);
    addGeo(roof, x, 5.1, z, ['#c62828', '#2e7d32', '#1565c0'][Math.floor(R() * 3)], r, 'vcf', vcFlat);
    collide(x, z, 7.5, 7.5);
  };
  for (let k = 0; k < 40; k++) {
    const x = 180 + R() * 340, z = -1470 + R() * 280;
    if (!roadDistOk(x, z, 6) || insideCollider(x, z, 4)) continue;
    cottage(x, z, (R() - 0.5) * 0.6);
  }
  // welcome arch
  { const e = edges.find(ed => ed.name === 'Himgiri Ghat Road')!; const p = e.pts[e.pts.length - 8]; const q = e.pts[e.pts.length - 7]; const r = Math.atan2(q.x - p.x, q.z - p.z);
    const lx = Math.cos(r), lz = -Math.sin(r);
    for (const s of [-1, 1]) addBox(0.8, 7, 0.8, p.x + lx * s * 6, 3.5, p.z + lz * s * 6, '#8d6e63');
    signMesh('WELCOME TO HIMGIRI', 'हिमगिरि में आपका स्वागत है', p.x, 7.2, p.z, r + Math.PI, 13, 2, '#4a148c');
  }

  // ---------------- stops shelters ----------------
  for (const s of stops) {
    const th = Math.atan2(s.dirx, s.dirz);
    const r = th + Math.PI / 2;
    const signRot = th + (s.side > 0 ? -Math.PI / 2 : Math.PI / 2);
    const bx = s.sx + s.dirz * s.side * 1.2, bz = s.sz - s.dirx * s.side * 1.2;
    addBox(6, 0.15, 2.6, s.sx, 2.8, s.sz, '#1565c0', r);
    addBox(6, 2.6, 0.08, bx, 1.4, bz, '#90caf9', r);
    addBox(5, 0.12, 0.6, s.sx + s.dirz * s.side * 0.8, 0.55, s.sz - s.dirx * s.side * 0.8, '#5d4037', r);
    for (const k of [-2.8, 2.8]) addBox(0.12, 2.8, 0.12, s.sx + s.dirx * k, 1.4, s.sz + s.dirz * k, '#1e88e5');
    addBox(7, 0.1, 4, s.sx, 0.06, s.sz, '#a8a39a', r, 'vc', vcMat, false);
    paved.push({ x0: s.sx - 6, z0: s.sz - 6, x1: s.sx + 6, z1: s.sz + 6 });
    signMesh(s.name, s.hindi, s.sx + s.dirx * 3.6, 2.6, s.sz + s.dirz * 3.6, signRot, 3.4, 0.9, '#0d47a1');
  }

  // ---------------- guard rails & signs on mountain roads ----------------
  for (const e of edges) {
    if (e.type !== 'mountain') continue;
    for (let i = 0; i < e.pts.length - 1; i += 1) {
      const p = e.pts[i], q = e.pts[i + 1];
      const dx = q.x - p.x, dz = q.z - p.z, L = Math.hypot(dx, dz) || 1;
      const r = Math.atan2(dx, dz);
      for (const s of [-1, 1]) {
        const ox = (dz / L) * s * (e.width / 2 + 1.6), oz = (-dx / L) * s * (e.width / 2 + 1.6);
        addBox(0.1, 0.35, L + 0.1, (p.x + q.x) / 2 + ox, 0.75, (p.z + q.z) / 2 + oz, i % 4 < 2 ? '#fdd835' : '#212121', r);
        if (i % 2 === 0) addBox(0.12, 0.8, 0.12, p.x + ox, 0.4, p.z + oz, '#eeeeee');
      }
    }
    for (let k = 40; k < e.pts.length; k += 45) {
      const p = e.pts[k]; const q = e.pts[Math.min(e.pts.length - 1, k + 1)];
      const r = Math.atan2(q.x - p.x, q.z - p.z);
      const ox = Math.cos(r) * (e.width / 2 + 3), oz = -Math.sin(r) * (e.width / 2 + 3);
      addBox(0.1, 2.4, 0.1, p.x + ox, 1.2, p.z + oz, '#888');
      signMesh(k % 90 === 40 ? 'BLOW HORN' : 'DRIVE SLOWLY', k % 90 === 40 ? 'हॉर्न बजाएँ • Sharp Curve' : 'Hill Road – पहाड़ी रास्ता', p.x + ox, 2.6, p.z + oz, r + Math.PI, 2.6, 0.8, '#fdd835', '#111');
    }
  }

  // ---------------- fields ----------------
  const cropMats = ['#7cb342', '#c0ca33', '#9ccc65', '#e0c050'].map(c => new THREE.MeshStandardMaterial({ map: cropTexture(c), roughness: 0.95 }));
  cropMats.forEach(m => (m.map as THREE.Texture).repeat.set(6, 6));
  const fieldCount = Math.floor(90 * density);
  for (let k = 0; k < fieldCount; k++) {
    const x = -350 + R() * 2100, z = 260 + R() * 820;
    const w = 40 + R() * 60, d = 30 + R() * 50;
    if (Math.abs(z - RAIL_Z) < d / 2 + 6 || !roadFarOk(x, z, Math.hypot(w, d) / 2 + 3)) continue;
    if (zoneAt(x, z) === 'village' && R() < 0.5) continue;
    const g = new THREE.PlaneGeometry(w, d); g.rotateX(-Math.PI / 2); g.rotateY(R() * 0.4);
    g.translate(x, 0.04, z);
    B.add(g, 'crop' + (k % 4), cropMats[k % 4], x, z, '#ffffff', false);
  }
  for (let k = 0; k < Math.floor(40 * density); k++) {
    const x = 250 + R() * 1100, z = R() < 0.5 ? 120 + R() * 120 : -10 - R() * 150;
    const w = 40 + R() * 50, d = 30 + R() * 40;
    if (insideCollider(x, z, Math.max(w, d) / 2) || !roadFarOk(x, z, Math.hypot(w, d) / 2 + 3)) continue;
    const g = new THREE.PlaneGeometry(w, d); g.rotateX(-Math.PI / 2); g.translate(x, 0.04, z);
    B.add(g, 'crop' + (k % 4), cropMats[k % 4], x, z, '#ffffff', false);
  }

  // ---------------- trees ----------------
  const treeCount = Math.floor(2600 * density);
  for (let k = 0; k < treeCount; k++) {
    const x = -450 + R() * 2300, z = -1600 + R() * 2800;
    const zone = zoneAt(x, z);
    if (zone === 'city' && (Math.abs(x) < 215 && Math.abs(z) < 215)) continue;
    if (Math.abs(z - RIVER_Z) < 32 || Math.abs(z - RAIL_Z) < 8) continue;
    if (!roadDistOk(x, z, 4)) continue;
    if (zone === 'town' && R() < 0.7) continue;
    if (insideCollider(x, z, 3)) continue;
    let kind: 'neem' | 'palm' | 'pine' | 'banyan' | 'shrub' = 'neem';
    if (zone === 'mountain' || zone === 'hill') kind = R() < 0.85 ? 'pine' : 'shrub';
    else if (zone === 'highway') kind = R() < 0.35 ? 'palm' : R() < 0.5 ? 'shrub' : 'neem';
    else kind = R() < 0.2 ? 'palm' : R() < 0.3 ? 'shrub' : R() < 0.03 ? 'banyan' : 'neem';
    if (zone === 'rural' && R() < 0.35) continue;
    if (paved.some(p => x > p.x0 - 2 && x < p.x1 + 2 && z > p.z0 - 2 && z < p.z1 + 2)) continue;
    const s = 0.8 + R() * 0.6;
    tree(x, z, kind, s);
    if (kind !== 'shrub') colliders.push({ x0: x - 0.45 * s, z0: z - 0.45 * s, x1: x + 0.45 * s, z1: z + 0.45 * s, kind: 'tree' });
  }
  // roadside tree lines along highway
  for (let x = 200; x < 1390; x += 22) for (const z of [36, 84]) { if (roadDistOk(x, z, 3) && !insideCollider(x, z, 3)) tree(x + R() * 4, z + (R() - 0.5) * 6, R() < 0.5 ? 'neem' : 'palm', 0.9); }

  // ---------------- mountains ----------------
  const mountain = (x: number, z: number, r: number, h: number, snow: boolean) => {
    const g = new THREE.ConeGeometry(r, h, 10, 5, true);
    const pos = g.getAttribute('position');
    const col = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) + h / 2; const t = y / h;
      const ang = Math.atan2(pos.getZ(i), pos.getX(i));
      const jitter = 1 + Math.sin(ang * 5 + t * 9 + x * 0.01) * 0.1 + Math.sin(ang * 11 + z * 0.02) * 0.06;
      if (t < 0.98) { pos.setX(i, pos.getX(i) * jitter); pos.setZ(i, pos.getZ(i) * jitter); }
      if (snow && t > 0.68) c.set('#f4f6f8'); else if (t > 0.45) c.set('#7a7266'); else if (t > 0.2) c.set('#4f6b35'); else c.set('#5a7a3a');
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    g.translate(x, h / 2 - 2, z);
    B.add(g, 'mtn', vcFlat, x, z, undefined, false);
  };
  for (let k = 0; k < 140; k++) {
    const x = -500 + R() * 2500, z = -1700 + R() * 1150;
    const r = 60 + R() * 140, h = r * (0.6 + R() * 0.7);
    if (z > -560) continue;
    if (zoneAt(x, z) === 'hill') continue;
    if (z + r * 0.9 > RIVER_Z - 45) continue;
    if (roadFarOk(x, z, r * 1.08 + 18)) mountain(x, z, r, h, h > 140);
  }
  for (let x = -1400; x < 2800; x += 180) mountain(x + R() * 80, -1950 - R() * 300, 260 + R() * 200, 300 + R() * 260, true);
  // distant hills ring
  for (let a = 0; a < 40; a++) {
    const ang = a / 40 * Math.PI * 2;
    const x = 700 + Math.cos(ang) * 2300, z = -200 + Math.sin(ang) * 2200;
    if (z < -1700) continue;
    mountain(x, z, 260 + R() * 160, 90 + R() * 140, false);
  }

  B.build(root);
  root.traverse(o => { if ((o as THREE.Mesh).isMesh && o !== groundMesh) { o.castShadow = o.castShadow && quality !== 'low'; } });

  // collider grid
  const CG = 30; const cgrid = new Map<string, Collider[]>();
  for (const c of colliders) {
    for (let gx = Math.floor(c.x0 / CG); gx <= Math.floor(c.x1 / CG); gx++) for (let gz = Math.floor(c.z0 / CG); gz <= Math.floor(c.z1 / CG); gz++) {
      const k = gx + ',' + gz; let a = cgrid.get(k); if (!a) { a = []; cgrid.set(k, a); } a.push(c);
    }
  }
  const empty: Collider[] = [];
  const queryColliders = (x: number, z: number) => cgrid.get(Math.floor(x / CG) + ',' + Math.floor(z / CG)) || empty;

  return { root, colliders, queryColliders, paved, windowMat, lampMat, roadMats, waterMat, signalLamps, signalInfo, pump, toll, checkpoint, crossings, police, bridgeZones };
}
