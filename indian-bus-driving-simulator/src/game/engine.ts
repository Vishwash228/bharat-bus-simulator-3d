import * as THREE from 'three';
import { AudioManager, RADIO_STATIONS } from './audio';
import { busById, FUEL_PRICE, MISSIONS, routeById, TOLL_FEE, type BusSpec, type MissionDef, type RouteDef } from './data';
import { Environment } from './environment';
import { buildBus, vehicleHeadMat, vehicleTailMat, type BusModel } from './models';
import { PassengerSystem, type Waiting } from './passengers';
import { edges, nearestRoadBrute, nodes, planRoute, RAIL_Z, RIVER_Z, roadSurface, stopById, stopDistance, stops, WORLD_BOUNDS, zoneAt, type PlannedRoute, type RoadEdge, type RouteOption, type Stop } from './roads';
import { store } from './save';
import { PedSystem, TrafficSystem, TrainSystem, type Obstacle } from './traffic';
import type { CameraMode, HudState, LaunchConfig, Notice, RouteResult, UpgradeLevels, Weather } from './types';
import { buildWorld, signalColor, type WorldData } from './world';

export const MIRROR_RECTS = [{ x: 0.012, y: 0.26, w: 0.17, h: 0.19 }, { x: 0.818, y: 0.26, w: 0.17, h: 0.19 }];
export const audio = new AudioManager();
const CAMS: CameraMode[] = ['driver', 'chase', 'interior', 'cinematic', 'rear'];

export interface GameCallbacks {
  hud: (h: HudState) => void;
  notice: (text: string, kind: Notice['kind']) => void;
  finish: (r: RouteResult) => void;
  ui: (what: 'map' | 'pause') => void;
}

function arrowTexture() {
  const c = document.createElement('canvas'); c.width = 64; c.height = 64; const g = c.getContext('2d')!;
  g.clearRect(0, 0, 64, 64); g.fillStyle = 'rgba(0,229,255,0.35)'; g.fillRect(0, 0, 64, 64);
  g.fillStyle = 'rgba(255,255,255,0.95)'; g.beginPath(); g.moveTo(32, 8); g.lineTo(56, 34); g.lineTo(44, 34); g.lineTo(32, 22); g.lineTo(20, 34); g.lineTo(8, 34); g.closePath(); g.fill();
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}

export class Game {
  renderer: THREE.WebGLRenderer; scene = new THREE.Scene(); camera: THREE.PerspectiveCamera; mirrorCam: THREE.PerspectiveCamera;
  world: WorldData; env: Environment; traffic: TrafficSystem; peds: PedSystem; train: TrainSystem; pax: PassengerSystem;
  bus!: BusModel; spec!: BusSpec; up!: UpgradeLevels;
  mode: 'menu' | 'garage' | 'drive' | 'finished' = 'menu';
  paused = false;
  private raf = 0; private last = 0;
  private cb: GameCallbacks;
  private quality = store.settings.quality;
  // config
  cfg: LaunchConfig | null = null; route: RouteDef | null = null; mission: MissionDef | null = null;
  routeStops: string[] = []; stopIdx = 0; freeTarget: string | null = null;
  // physics
  x = 0; z = 22; y = 0; heading = Math.PI / 2; speed = 0; steer = 0; steerIn = 0; gear = 1; rpm = 700;
  throttle = 0; brake = 0; handbrake = false; shiftT = 0; revHold = 0; latAcc = 0; longAcc = 0; roll = 0; pitch = 0; rampPitch = 0;
  fuel = 100; damage = 0; clean = 1; temp = 70; engineOn = true;
  lights: 0 | 1 | 2 = 0; indicator: HudState['indicator'] = 'none'; wipers = false; door = false; doorAmt = 0; horn = false;
  camMode: CameraMode = 'chase'; lookYaw = 0; lookPitch = 0; chaseYaw = 0; private cin = { pos: new THREE.Vector3(), t: 0 };
  private keys = new Set<string>(); private touch: { steer: number | null; throttle: number; brake: number } = { steer: null, throttle: 0, brake: 0 };
  // session
  fares = 0; fines = 0; tolls = 0; fuelSpent = 0; collisions = 0; violations = 0; distance = 0; time = 0; comfort = 100; comfortSum = 0; comfortN = 0; satSum = 0; satN = 0;
  timerLeft: number | null = null; usedHazard = 0;
  // rules state
  private overT = 0; private speedCool = 0; private wrongT = 0; private wrongCool = 0; private junction: { id: string; heading: number } | null = null;
  private lastIndL = -99; private lastIndR = -99; private cpInside = false; private cpMin = 99; private tollCool = 0; private railFlag = false;
  private lastSafe = { x: 0, z: 22, h: Math.PI / 2 }; private safeT = 0; private collideCool = 0; private nightT = 0; private nightCool = 0; private hornCool = 0; private warnCool = new Map<string, number>();
  curEdge: RoadEdge | null = null; limit = 40;
  // gps
  gpsRoute: PlannedRoute | null = null; gpsOption: RouteOption = 'fastest'; private gpsTargetId = ''; private gpsIdx = 0; gpsProg = 0; private gpsTimer = 0; private spoken = new Set<string>(); private ribbonT = 0;
  private ribbon: THREE.Mesh; private ribbonTex: THREE.Texture; private marker: THREE.Group;
  // stops
  private stopActive: Stop | null = null; private exitQ: string[] = []; private boardT = 0; private inFlight = 0; private served = false; private refillT = 0; private annT = 20;
  // misc
  private hudT = 0; private mmT = 0; private sigT = 0; minimap: HTMLCanvasElement | null = null; private fps = 60; private frames = 0; private fpsT = 0;
  private blinkT = 0; private blinkOn = false; private interiorLight: THREE.PointLight; private dragging = false; private lastPtr = { x: 0, y: 0 };
  private menuAngle = 0; private signalTime = 0; private tmpV = new THREE.Vector3(); private tmpQ = new THREE.Quaternion();
  private canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement, cb: GameCallbacks) {
    this.canvas = canvas; this.cb = cb;
    const q = this.quality;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: q !== 'low', powerPreference: 'high-performance' });
    const dpr = window.devicePixelRatio || 1;
    this.renderer.setPixelRatio(q === 'low' ? Math.min(dpr, 1) * 0.8 : q === 'medium' ? Math.min(dpr, 1.5) : Math.min(dpr, 2));
    this.renderer.shadowMap.enabled = q !== 'low'; this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.15, 3200);
    this.mirrorCam = new THREE.PerspectiveCamera(42, 1, 0.3, 800);
    this.world = buildWorld(this.scene, q);
    this.env = new Environment(this.scene, q);
    this.env.onThunder = d => audio.thunder(d);
    this.train = new TrainSystem(this.scene);
    this.train.onHorn = cx => { const d = Math.abs(cx - this.x) + Math.abs(RAIL_Z - this.z); if (d < 900) audio.trainHorn(Math.max(0.04, 0.25 - d / 4000)); };
    this.traffic = new TrafficSystem(this.scene, this.world, cx => this.train.gateClosed(cx));
    this.traffic.onHonk = (hx, hz) => { const d = Math.hypot(hx - this.x, hz - this.z); audio.carHorn(Math.max(0.02, 0.16 - d / 200), Math.random()); };
    this.peds = new PedSystem(this.scene, q === 'low' ? 14 : q === 'medium' ? 22 : 32);
    this.pax = new PassengerSystem(this.scene);
    this.ribbonTex = arrowTexture();
    this.ribbon = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ map: this.ribbonTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8, fog: false }));
    this.ribbon.frustumCulled = false; this.ribbon.renderOrder = 2; this.scene.add(this.ribbon);
    this.marker = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.2, 0.8, 32, 1, true), new THREE.MeshBasicMaterial({ color: '#22ff88', transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false }));
    ring.position.y = 0.4; this.marker.add(ring);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 60, 8, 1, true), new THREE.MeshBasicMaterial({ color: '#22ff88', transparent: true, opacity: 0.25, depthWrite: false, fog: false }));
    beam.position.y = 30; this.marker.add(beam);
    this.marker.visible = false; this.scene.add(this.marker);
    this.interiorLight = new THREE.PointLight('#fff4e0', 0, 14, 1.5);
    this.loadBus(store.save.currentBus);
    this.placeMenuBus();
    this.applySettings();
    this.resize();
    window.addEventListener('resize', this.resize);
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    canvas.addEventListener('pointerdown', this.onPtrDown);
    window.addEventListener('pointermove', this.onPtrMove);
    window.addEventListener('pointerup', this.onPtrUp);
    canvas.addEventListener('dblclick', () => { this.lookYaw = 0; this.lookPitch = 0; this.chaseYaw = 0; });
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.loop);
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.resize); window.removeEventListener('keydown', this.onKey); window.removeEventListener('keyup', this.onKeyUp); window.removeEventListener('blur', this.onBlur);
    window.removeEventListener('pointermove', this.onPtrMove); window.removeEventListener('pointerup', this.onPtrUp);
    this.canvas.removeEventListener('pointerdown', this.onPtrDown);
    audio.horn(false);
    this.renderer.dispose();
  }

  // ---------------- setup ----------------
  loadBus(id: string) {
    if (this.bus) { this.scene.remove(this.bus.group); this.bus.body.remove(this.interiorLight); }
    this.spec = busById(id);
    this.up = { ...(store.save.upgrades[id] || { engine: 0, brakes: 0, suspension: 0, comfort: 0 }) };
    this.bus = buildBus(this.spec);
    this.bus.group.traverse(o => { if ((o as THREE.Mesh).isMesh) { o.receiveShadow = true; } });
    this.bus.body.add(this.interiorLight); this.interiorLight.position.set(0, 2.6, 0);
    this.scene.add(this.bus.group);
    this.fuel = (store.save.fuel[id] ?? 1) * this.spec.tank;
    this.damage = store.save.damage[id] ?? 0;
    this.clean = store.save.cleanliness[id] ?? 1;
    this.bus.setDestination(this.spec.operator.split(' ')[0], 'भारत यात्रा');
    this.syncBus(0);
  }

  placeMenuBus() { this.x = 0; this.z = 34; this.heading = Math.PI / 2; this.speed = 0; this.y = 0; this.steer = 0; this.door = false; this.doorAmt = 0; this.syncBus(0); }

  applySettings() {
    const s = store.settings;
    audio.setVolumes(s.masterVolume, s.musicVolume, s.sfxVolume);
    audio.speechEnabled = s.speechVoices;
    this.traffic.density = s.trafficDensity;
  }

  showMenu() { this.mode = 'menu'; this.paused = false; this.marker.visible = false; this.ribbon.visible = false; this.loadBus(store.save.currentBus); this.placeMenuBus(); this.camMode = 'chase'; this.env.dynamicWeather = true; }
  showGarage(busId: string) { this.mode = 'garage'; this.paused = false; this.marker.visible = false; this.ribbon.visible = false; this.loadBus(busId); this.placeMenuBus(); }

  start(cfg: LaunchConfig) {
    audio.init();
    this.cfg = cfg; this.mode = 'drive'; this.paused = false;
    this.loadBus(store.save.currentBus);
    this.mission = cfg.missionId ? MISSIONS.find(m => m.id === cfg.missionId) || null : null;
    const routeId = this.mission?.routeId ?? cfg.routeId;
    this.route = routeId ? routeById(routeId) || null : null;
    this.routeStops = this.mission?.emergency ? ['sitapur', 'hospital'] : this.route ? [...this.route.stops] : [];
    this.stopIdx = 0; this.freeTarget = null;
    // weather / time
    const w = this.mission?.weather ?? (cfg.weather && cfg.weather !== 'dynamic' ? cfg.weather : null);
    if (w) { this.env.dynamicWeather = false; this.env.setWeather(w as Weather, true); } else { this.env.dynamicWeather = true; }
    const hr = this.mission?.hour ?? cfg.hour; if (hr !== undefined) this.env.hour = hr;
    // reset session
    this.fares = this.fines = this.tolls = this.fuelSpent = 0; this.collisions = this.violations = 0; this.distance = 0; this.time = 0;
    this.comfort = 100; this.comfortSum = this.comfortN = 0; this.satSum = this.satN = 0; this.usedHazard = 0;
    this.timerLeft = this.mission?.timeLimit ?? null;
    this.speed = 0; this.steer = 0; this.steerIn = 0; this.gear = 1; this.door = false; this.doorAmt = 0; this.indicator = 'none'; this.lights = 0; this.wipers = false; this.handbrake = false;
    this.junction = null; this.cpInside = false; this.railFlag = false; this.stopActive = null; this.exitQ = []; this.inFlight = 0; this.served = false;
    this.gpsRoute = null; this.gpsTargetId = ''; this.spoken.clear();
    this.camMode = store.settings.quality === 'low' ? 'chase' : 'driver'; this.lookYaw = 0; this.lookPitch = 0;
    this.pax.reset(); this.traffic.clear(); this.peds.clear();
    // populate stops
    const cap = this.spec.seats;
    if (this.mission?.emergency) {
      this.pax.addWaiting('sitapur', 1, { emergency: true, dest: 'hospital' });
      this.pax.addWaiting('sitapur', 1, { dest: 'hospital' });
    } else if (this.route) {
      const uniq = this.routeStops.slice(0, -1);
      let budget = Math.floor(cap * 1.2);
      uniq.forEach((id, i) => { const n = Math.min(budget, i === 0 ? 4 + Math.floor(Math.random() * 5) : 2 + Math.floor(Math.random() * 6)); budget -= n; this.pax.addWaiting(id, Math.max(1, n)); });
    } else {
      for (const s of stops) this.pax.addWaiting(s.id, 2 + Math.floor(Math.random() * 5));
    }
    // spawn
    const spawnStop = this.mission?.emergency ? stopById('central') : this.routeStops.length ? stopById(this.routeStops[0]) : stopById('central');
    const next = this.routeStops.length > 1 ? stopById(this.routeStops[this.mission?.emergency ? 0 : 1]) : null;
    let h = Math.atan2(spawnStop.dirx, spawnStop.dirz);
    if (next && next.id !== spawnStop.id) {
      const r1 = planRoute(spawnStop.rx, spawnStop.rz, h, { edge: next.edge, s: next.s }, 'fastest');
      const r2 = planRoute(spawnStop.rx, spawnStop.rz, h + Math.PI, { edge: next.edge, s: next.s }, 'fastest');
      if ((r2?.length ?? 1e9) + 60 < (r1?.length ?? 1e9)) h += Math.PI;
    }
    const fx = Math.sin(h), fz = Math.cos(h);
    const e = spawnStop.edge; const off = e.median / 2 + e.laneW * 0.5;
    this.x = spawnStop.rx + fz * off - fx * 4; this.z = spawnStop.rz - fx * off - fz * 4; this.heading = h;
    this.y = roadSurface(this.x, this.z).y;
    this.lastSafe = { x: this.x, z: this.z, h };
    const last = this.routeStops.length ? stopById(this.routeStops[this.routeStops.length - 1]) : null;
    if (last) this.bus.setDestination(last.name, last.hindi); else this.bus.setDestination('FREE RIDE', 'प्राइवेट');
    if (this.env.hour > 18.5 || this.env.hour < 6) this.lights = 1;
    if (this.env.weather === 'rain' || this.env.weather === 'storm') this.wipers = true;
    this.syncBus(0);
    for (let i = 0; i < 18; i++) this.traffic.spawnNear(this.x, this.z, 40, 300);
    const title = this.mission ? this.mission.title : this.route ? this.route.name : 'Free Ride';
    this.cb.notice(`${title} – ${this.routeStops.length ? 'First stop: ' + stopById(this.routeStops[0]).name : 'Explore Bharat! Pick passengers at any stop.'}`, 'info');
    if (spawnStop.id === 'central') setTimeout(() => audio.announce(`Attention passengers. Bus ${this.route ? 'to ' + (last?.name ?? '') : ''} is departing from platform 3.`, `यात्रीगण कृपया ध्यान दें। ${last ? last.hindi + ' जाने वाली' : ''} बस प्लेटफ़ॉर्म नंबर तीन से रवाना होगी।`), 1200);
  }

  setPaused(p: boolean) { this.paused = p; audio.suspend(p); if (p) { audio.horn(false); this.keys.clear(); } }
  setWeather(w: Weather | 'dynamic') { if (w === 'dynamic') this.env.dynamicWeather = true; else { this.env.dynamicWeather = false; this.env.setWeather(w); } }
  setHour(h: number) { this.env.hour = h; }
  setTouch(t: Partial<{ steer: number | null; throttle: number; brake: number }>) { Object.assign(this.touch, t); }
  setGpsOption(o: RouteOption) { this.gpsOption = o; this.gpsRoute = null; this.gpsTargetId = ''; }
  setFreeTarget(id: string | null) { this.freeTarget = id; this.gpsRoute = null; this.gpsTargetId = ''; }
  planOptions(stopId: string): PlannedRoute[] {
    const s = stopById(stopId); const out: PlannedRoute[] = [];
    for (const o of ['fastest', 'shortest', 'traffic', 'road'] as RouteOption[]) { const r = planRoute(this.x, this.z, this.heading, { edge: s.edge, s: s.s }, o); if (r) out.push(r); }
    return out;
  }
  currentTarget(): Stop | null {
    if (this.routeStops.length) return this.stopIdx < this.routeStops.length ? stopById(this.routeStops[this.stopIdx]) : null;
    if (this.freeTarget) return stopById(this.freeTarget);
    if (this.pax.onboard.length) { return stopById(this.pax.onboard[0].dest); }
    return null;
  }

  // ---------------- input ----------------
  private onBlur = () => { this.keys.clear(); audio.horn(false); this.horn = false; };
  private onKeyUp = (e: KeyboardEvent) => { this.keys.delete(e.code); if (e.code === 'KeyH') { this.horn = false; audio.horn(false); } };
  private onKey = (e: KeyboardEvent) => {
    if (this.mode !== 'drive') return;
    if (e.code === 'Escape' || e.code === 'KeyP') { this.cb.ui('pause'); return; }
    if (this.paused) return;
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    if (e.repeat) { this.keys.add(e.code); return; }
    this.keys.add(e.code);
    const map: Record<string, string> = { KeyH: 'horn-down', KeyJ: 'musical', KeyO: 'door', KeyL: 'lights', KeyQ: 'ind-left', KeyE: 'ind-right', KeyX: 'hazard', KeyK: 'wipers', KeyC: 'camera', KeyR: 'radio', ShiftLeft: 'gear-up', ShiftRight: 'gear-up', KeyZ: 'gear-down', Enter: 'refuel', KeyT: 'tow', KeyM: 'map', KeyF: 'refuel' };
    if (map[e.code]) this.action(map[e.code]);
    if (e.code.startsWith('Digit')) { const n = parseInt(e.code.slice(5)) - 1; if (n >= 0 && n < CAMS.length) this.setCamera(CAMS[n]); }
  };
  private onPtrDown = (e: PointerEvent) => { this.dragging = true; this.lastPtr = { x: e.clientX, y: e.clientY }; audio.init(); };
  private onPtrMove = (e: PointerEvent) => {
    if (!this.dragging) return;
    const dx = e.clientX - this.lastPtr.x, dy = e.clientY - this.lastPtr.y; this.lastPtr = { x: e.clientX, y: e.clientY };
    if (this.camMode === 'chase' || this.mode !== 'drive') this.chaseYaw -= dx * 0.006;
    else { this.lookYaw = THREE.MathUtils.clamp(this.lookYaw - dx * 0.005, -2.4, 2.4); this.lookPitch = THREE.MathUtils.clamp(this.lookPitch - dy * 0.004, -0.8, 0.6); }
  };
  private onPtrUp = () => { this.dragging = false; };

  setCamera(c: CameraMode) { this.camMode = c; this.lookYaw = 0; this.lookPitch = 0; this.cin.t = 0; this.cb.notice(`📷 ${c === 'driver' ? 'Driver view' : c === 'chase' ? 'Third-person view' : c === 'interior' ? 'Bus interior' : c === 'cinematic' ? 'Cinematic camera' : 'Rear camera'}`, 'info'); }

  action(a: string) {
    audio.init();
    switch (a) {
      case 'horn-down': this.horn = true; audio.horn(true, this.spec.style); this.onHorn(); break;
      case 'horn-up': this.horn = false; audio.horn(false); break;
      case 'musical': audio.musicalHorn(); this.onHorn(); break;
      case 'door':
        if (!this.door && Math.abs(this.speed) > 1.2) { this.cb.notice('Stop the bus before opening the door', 'warn'); break; }
        this.door = !this.door; audio.door(this.door); break;
      case 'lights': this.lights = ((this.lights + 1) % 3) as 0 | 1 | 2; this.cb.notice(['💡 Headlights OFF', '💡 Low beam ON', '💡 High beam ON'][this.lights], 'info'); break;
      case 'ind-left': this.indicator = this.indicator === 'left' ? 'none' : 'left'; audio.click(true); break;
      case 'ind-right': this.indicator = this.indicator === 'right' ? 'none' : 'right'; audio.click(true); break;
      case 'hazard': this.indicator = this.indicator === 'hazard' ? 'none' : 'hazard'; audio.click(true); break;
      case 'wipers': this.wipers = !this.wipers; break;
      case 'camera': this.setCamera(CAMS[(CAMS.indexOf(this.camMode) + 1) % CAMS.length]); break;
      case 'radio': { const n = audio.setStation(audio.station + 1); this.cb.notice(`📻 ${n}`, 'info'); break; }
      case 'gear-up': if (store.settings.transmission === 'manual' && this.gear < 5) { this.gear++; this.shiftT = 0.25; audio.click(false); } break;
      case 'gear-down': if (store.settings.transmission === 'manual' && this.gear > -1) { if (this.gear === 0 && this.speed > 1) break; this.gear--; this.shiftT = 0.25; audio.click(false); } break;
      case 'refuel': this.refuel(); break;
      case 'tow': this.tow(); break;
      case 'map': this.cb.ui('map'); break;
      case 'pause': this.cb.ui('pause'); break;
    }
  }

  private onHorn() {
    const nearHospital = Math.hypot(this.x - stopById('hospital').sx, this.z - stopById('hospital').sz) < 70;
    if (nearHospital && this.hornCool <= 0 && this.mode === 'drive') { this.hornCool = 30; this.violation('Honking in hospital silent zone', 300); }
  }

  private refuel() {
    const p = this.world.pump;
    if (Math.hypot(this.x - p.x, this.z - p.z) > p.r || Math.abs(this.speed) > 0.5) { this.cb.notice('Stop at a petrol pump (Bharat Fuels on NH-48) to refuel', 'warn'); return; }
    const litres = this.spec.tank - this.fuel;
    if (litres < 1) { this.cb.notice('Tank is already full', 'info'); return; }
    const cost = litres * FUEL_PRICE;
    this.fuel = this.spec.tank; this.fuelSpent += cost; audio.coin();
    this.cb.notice(`⛽ Refuelled ${litres.toFixed(0)} L diesel – ₹${Math.round(cost).toLocaleString('en-IN')}`, 'info');
  }

  private tow() {
    if (this.fuel <= 0.5) {
      const p = this.world.pump; this.x = p.x; this.z = 56; this.heading = Math.PI / 2; this.fuel = 40; this.fuelSpent += 2500; this.speed = 0;
      this.cb.notice('🚛 Towed to Bharat Fuels with 40 L – ₹2,500', 'warn');
    } else {
      const h = nearestRoadBrute(this.x, this.z);
      this.x = h.x + h.dz * 2; this.z = h.z - h.dx * 2; this.heading = Math.atan2(h.dx, h.dz); this.speed = 0; this.fuelSpent += 500;
      this.cb.notice('🔧 Recovery van reset your bus to the road – ₹500', 'warn');
    }
    this.y = roadSurface(this.x, this.z).y; this.gpsRoute = null; this.traffic.clear();
  }

  private readInput(dt: number) {
    const k = this.keys;
    const kThr = k.has('KeyW') || k.has('ArrowUp') ? 1 : 0;
    const kBrk = k.has('KeyS') || k.has('ArrowDown') ? 1 : 0;
    this.throttle = Math.max(kThr, this.touch.throttle);
    this.brake = Math.max(kBrk, this.touch.brake);
    this.handbrake = k.has('Space');
    const sens = store.settings.steering;
    if (this.touch.steer !== null) this.steerIn = this.touch.steer;
    else {
      const l = k.has('KeyA') || k.has('ArrowLeft'), r = k.has('KeyD') || k.has('ArrowRight');
      const rate = 1.6 * sens;
      if (l && !r) this.steerIn = Math.min(1, this.steerIn + rate * dt * (this.steerIn < 0 ? 2.5 : 1));
      else if (r && !l) this.steerIn = Math.max(-1, this.steerIn - rate * dt * (this.steerIn > 0 ? 2.5 : 1));
      else this.steerIn -= Math.sign(this.steerIn) * Math.min(Math.abs(this.steerIn), dt * 2.6);
    }
    if (this.door && this.doorAmt > 0.2) this.throttle *= 0.15;
  }

  // ---------------- physics ----------------
  private groundY(x: number, z: number) { const s = roadSurface(x, z); return s.on ? s.y : 0; }
  private isPaved(x: number, z: number) { return this.world.paved.some(p => x > p.x0 && x < p.x1 && z > p.z0 && z < p.z1) || (Math.abs(x) < 250 && Math.abs(z) < 250); }

  private physics(dt: number) {
    const s = this.spec, up = this.up;
    const top = (s.topSpeed + up.engine * 6) / 3.6;
    const power = s.power * (1 + 0.12 * up.engine) * (1 - this.damage / 100 * 0.45);
    const brakeMax = s.brake * (1 + 0.12 * up.brakes);
    const surf = roadSurface(this.x, this.z);
    const paved = surf.on || this.isPaved(this.x, this.z);
    const grip = (paved ? 1 : 0.72) * (1 - this.env.rain * 0.28 * (1 - up.brakes * 0.1));
    const fuelOk = this.fuel > 0 && this.engineOn;
    const ratios = [0.2, 0.38, 0.58, 0.8, 1.0], tfs = [1.7, 1.35, 1.08, 0.86, 0.7];
    const idle = 650, red = 2700;
    const v = this.speed;
    let thr = this.throttle, brk = this.brake;
    const auto = store.settings.transmission === 'auto';
    if (auto) {
      if (this.gear > 0 && v < 0.3 && brk > 0.2 && thr < 0.05) { this.revHold += dt; if (this.revHold > 0.4) { this.gear = -1; this.revHold = 0; } } else if (this.gear > 0) this.revHold = 0;
      if (this.gear === -1 && v > -0.3 && thr > 0.2 && brk < 0.05) this.gear = 1;
      if (this.gear === 0) this.gear = 1;
      if (this.gear === -1) { const t = thr; thr = brk; brk = t; }
      if (this.gear > 0 && this.shiftT <= 0) {
        if (this.rpm > 2350 && this.gear < 5) { this.gear++; this.shiftT = 0.35; }
        else if (this.rpm < 1050 && this.gear > 1) { this.gear--; this.shiftT = 0.25; }
      }
    }
    this.shiftT -= dt;
    let drive = 0;
    if (this.gear > 0) {
      const gt = top * ratios[this.gear - 1];
      const target = idle + Math.max(0, v) / gt * (red - idle);
      this.rpm += (Math.max(idle + (this.shiftT > 0 ? thr * 400 : 0), Math.min(red + 80, target)) - this.rpm) * Math.min(1, dt * 8);
      const lug = target < 850 && this.gear > 2 ? 0.3 : 1;
      const lim = target >= red ? 0 : 1;
      drive = this.shiftT > 0 ? 0 : thr * power * tfs[this.gear - 1] * lug * lim;
      if (v < -0.5) drive = thr * power * 1.2; // rolling back, pushing forward
    } else if (this.gear === -1) {
      this.rpm += (idle + Math.abs(v) / (top * 0.2) * (red - idle) - this.rpm) * Math.min(1, dt * 8);
      drive = v > -18 / 3.6 ? -thr * power * 1.4 : 0;
    } else {
      this.rpm += (idle + thr * (red - idle) - this.rpm) * Math.min(1, dt * 5);
    }
    if (!fuelOk) { drive = 0; this.rpm += (0 - this.rpm) * Math.min(1, dt * 2); }
    const c = (power * 0.7 - 0.12) / (top * top);
    const roll = paved ? 0.12 : 0.85;
    let nv = v + (drive - Math.sign(v) * (c * v * v + (Math.abs(v) > 0.05 ? roll : 0))) * dt;
    const bForce = brk * brakeMax * grip + (this.handbrake ? 3.5 : 0);
    if (bForce > 0) { const dec = bForce * dt; if (Math.abs(nv) <= dec) nv = 0; else nv -= Math.sign(nv) * dec; }
    if (Math.abs(nv) < 0.04 && Math.abs(drive) < 0.01) nv = 0;
    if (!paved && Math.abs(nv) > 11) nv -= Math.sign(nv) * 2 * dt;
    this.longAcc = (nv - v) / dt;
    this.speed = nv;
    if (brk > 0.7 && Math.abs(v) > 6 && Math.random() < dt * 0.6) audio.brakeHiss();
    // steering (bicycle model)
    const maxSteer = 0.6 / (1 + Math.abs(nv) / 13);
    this.steer += (this.steerIn * maxSteer - this.steer) * Math.min(1, dt * 5);
    let yawRate = nv * Math.tan(this.steer) / this.bus.wheelbase;
    const maxLat = 6.5 * grip;
    if (Math.abs(nv * yawRate) > maxLat && Math.abs(nv) > 1) { yawRate = Math.sign(yawRate) * maxLat / Math.abs(nv); this.speed *= 1 - 0.25 * dt; }
    this.latAcc = nv * yawRate;
    this.heading += yawRate * dt;
    this.x += Math.sin(this.heading) * this.speed * dt; this.z += Math.cos(this.heading) * this.speed * dt;
    this.x = THREE.MathUtils.clamp(this.x, WORLD_BOUNDS.minX, WORLD_BOUNDS.maxX); this.z = THREE.MathUtils.clamp(this.z, WORLD_BOUNDS.minZ, WORLD_BOUNDS.maxZ);
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading), hw = this.bus.wheelbase / 2;
    const hf = this.groundY(this.x + fx * hw, this.z + fz * hw), hb = this.groundY(this.x - fx * hw, this.z - fz * hw);
    this.y += ((hf + hb) / 2 - this.y) * Math.min(1, dt * 12);
    this.rampPitch = Math.atan2(hf - hb, hw * 2);
    // fuel & temp
    if (fuelOk) this.fuel = Math.max(0, this.fuel - (0.004 + thr * (this.rpm / red) * 0.05) * s.efficiency * (1 - up.engine * 0.03) * dt);
    if (this.fuel <= 0 && this.engineOn) { this.cb.notice('⛽ Out of diesel! Press T to call a tow truck', 'bad'); this.engineOn = false; }
    if (this.fuel > 0) this.engineOn = true;
    this.temp += ((72 + (this.rpm / red) * 18 + this.damage * 0.15 + thr * 6) - this.temp) * dt * 0.05;
    this.distance += Math.abs(this.speed) * dt;
    // comfort
    const susp = (1 - s.comfort * 0.35) * (1 - up.suspension * 0.1);
    const rough = surf.hit && surf.on ? (1 - surf.hit.edge.condition) * Math.min(1, Math.abs(nv) / 12) * 18 : paved ? 0 : Math.min(1, Math.abs(nv) / 8) * 30;
    const ci = 100 - (Math.max(0, Math.abs(this.longAcc) - 1.6) * 16 + Math.max(0, Math.abs(this.latAcc) - 1.8) * 14 + rough) * susp - (this.door && Math.abs(nv) > 2 ? 30 : 0);
    this.comfort += (THREE.MathUtils.clamp(ci, 0, 100) - this.comfort) * Math.min(1, dt * 2);
    this.comfortSum += this.comfort * dt; this.comfortN += dt;
    if (this.comfort < 65) this.pax.hit((65 - this.comfort) * 0.03 * dt * (1 - up.comfort * 0.12));
    if (!paved && Math.abs(nv) > 3) audio.offroadRumble(Math.min(1, Math.abs(nv) / 12));
  }

  private circles() {
    const L = this.bus.length, fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    return [-L / 2 + 1.3, -L / 6, L / 6, L / 2 - 1.3].map(o => ({ x: this.x + fx * o, z: this.z + fz * o }));
  }

  private doCollisions(dt: number) {
    this.collideCool -= dt;
    const R = 1.32;
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    const circ = this.circles();
    // static
    for (const c of circ) {
      const seen = new Set<object>();
      for (const [ox, oz] of [[-R, -R], [R, -R], [-R, R], [R, R]]) {
        for (const col of this.world.queryColliders(c.x + ox, c.z + oz)) {
          if (seen.has(col)) continue; seen.add(col);
          if (col.kind === 'rail' && this.y < 1.5) continue;
          const px = THREE.MathUtils.clamp(c.x, col.x0, col.x1), pz = THREE.MathUtils.clamp(c.z, col.z0, col.z1);
          let dx = c.x - px, dz = c.z - pz; let d = Math.hypot(dx, dz);
          if (d >= R) continue;
          if (d < 1e-4) { const l = c.x - col.x0, r = col.x1 - c.x, t = c.z - col.z0, b = col.z1 - c.z; const m = Math.min(l, r, t, b); dx = m === l ? -1 : m === r ? 1 : 0; dz = m === t ? -1 : m === b ? 1 : 0; d = 0; }
          const L = Math.hypot(dx, dz) || 1; const nx = dx / L, nz = dz / L;
          const pen = R - d;
          this.x += nx * pen; this.z += nz * pen; c.x += nx * pen; c.z += nz * pen;
          const impact = -(fx * nx + fz * nz) * this.speed;
          if (impact > 0) {
            const head = Math.abs(fx * nx + fz * nz);
            this.speed *= head > 0.5 ? 0.15 : 0.85;
            if (impact > 1.8) this.crashEvent(impact, col.kind === 'toll' ? 'toll booth' : col.kind === 'rail' ? 'bridge railing' : col.kind === 'barricade' ? 'police barricade' : col.kind === 'median' ? 'highway divider' : col.kind === 'tree' ? 'a tree' : 'building');
          }
        }
      }
    }
    // vehicles
    for (const v of this.traffic.vehicles) {
      if (!v.active || Math.abs(v.x - this.x) > 20 || Math.abs(v.z - this.z) > 20) continue;
      const n = Math.max(1, Math.round(v.length / Math.max(1.2, v.width)));
      const vr = v.width / 2 + 0.1;
      for (let i = 0; i < n; i++) {
        const o = n === 1 ? 0 : -v.length / 2 + vr + (v.length - 2 * vr) * i / (n - 1);
        const vx = v.x + v.hx * o, vz = v.z + v.hz * o;
        for (const c of circ) {
          const dx = c.x - vx, dz = c.z - vz, d = Math.hypot(dx, dz);
          if (d >= R + vr || d < 1e-4) continue;
          const nx = dx / d, nz = dz / d, pen = R + vr - d;
          this.x += nx * pen * 0.35; this.z += nz * pen * 0.35; v.x -= nx * pen * 0.65; v.z -= nz * pen * 0.65;
          const rel = (fx * this.speed - v.hx * v.speed) * -nx + (fz * this.speed - v.hz * v.speed) * -nz;
          if (rel > 1.5) {
            v.crashed = 6; v.speed = 0; this.speed *= 0.55;
            this.crashEvent(rel, v.type === 'bike' ? 'motorcycle' : v.type === 'auto' ? 'auto-rickshaw' : v.type);
          }
        }
      }
    }
    // pedestrians & animals
    const obs: Obstacle[] = []; this.peds.obstacles(obs);
    for (const o of obs) {
      if (Math.abs(o.x - this.x) > 10 || Math.abs(o.z - this.z) > 10) continue;
      for (const c of circ) {
        const dx = o.x - c.x, dz = o.z - c.z, d = Math.hypot(dx, dz);
        if (d >= R + o.r) continue;
        if (Math.abs(this.speed) > 1.6) {
          this.peds.knock(o, fx * Math.sign(this.speed), fz * Math.sign(this.speed));
          this.speed *= o.kind === 'animal' ? 0.6 : 0.85;
          if (o.kind === 'ped') { this.violation('Hit a pedestrian! Drive carefully', 5000); this.crashEvent(3, 'pedestrian', true); }
          else { this.violation('Hit an animal on the road', 1500); this.crashEvent(Math.abs(this.speed) * 0.6, 'animal', true); }
        } else {
          const ref = o.ref as { x: number; z: number }; const L = d || 1; ref.x += dx / L * (R + o.r - d); ref.z += dz / L * (R + o.r - d);
        }
        break;
      }
    }
    // train
    const span = this.train.span();
    if (span) for (const c of circ) {
      if (Math.abs(c.z - RAIL_Z) < 2.3 && c.x > span[0] - 1.5 && c.x < span[1] + 1.5) {
        this.z += (this.z > RAIL_Z ? 1 : -1) * 5; this.speed = 0;
        this.damage = Math.min(100, this.damage + 55); this.collisions++; this.pax.hit(50);
        audio.crash(1); this.cb.notice('🚂 HIT BY A TRAIN! Never cross a closed railway gate!', 'bad');
        break;
      }
    }
    // river
    if (Math.abs(this.z - RIVER_Z) < 25 && this.y < 1) {
      this.damage = Math.min(100, this.damage + 30); this.collisions++;
      this.x = this.lastSafe.x; this.z = this.lastSafe.z; this.heading = this.lastSafe.h; this.speed = 0; this.y = this.groundY(this.x, this.z);
      audio.crash(0.6); this.cb.notice('🌊 The bus drove into the river! Recovered by crane (+30% damage)', 'bad');
    }
  }

  private crashEvent(impact: number, what: string, silentFine = false) {
    if (this.collideCool > 0) return;
    this.collideCool = 0.8;
    const dmg = Math.min(30, impact * 1.7);
    this.damage = Math.min(100, this.damage + dmg);
    this.collisions++;
    this.pax.hit(Math.min(25, impact * 3));
    audio.crash(impact / 8);
    if (!silentFine) {
      const fine = what === 'building' || what.includes('divider') || what.includes('railing') || what.includes('tree') ? 0 : Math.round(impact * 150);
      this.fines += fine;
      this.cb.notice(`💥 Collided with ${what}! Damage +${dmg.toFixed(0)}%${fine ? ` • Compensation ₹${fine}` : ''}`, 'bad');
    }
    if (this.mission?.maxCollisions !== undefined && this.collisions > this.mission.maxCollisions) this.finish(false, 'Mission failed – you had a collision');
    if (this.damage >= 100) this.finish(false, 'Your bus broke down due to heavy damage');
  }

  violation(text: string, fine: number) {
    const police = this.world.police.some(p => Math.hypot(p.x - this.x, p.z - this.z) < 150);
    const f = Math.round(fine * (police ? 1.5 : 1));
    this.violations++; this.fines += f; this.pax.hit(6);
    this.cb.notice(`🚨 ${police ? 'Traffic Police Challan' : 'Violation'}: ${text} – ₹${f.toLocaleString('en-IN')}`, 'bad');
    audio.whistle();
    if (this.mission?.maxViolations !== undefined && this.violations > this.mission.maxViolations) this.finish(false, 'Mission failed – traffic rule broken');
  }
  private warn(key: string, text: string, cool = 12) {
    const t = this.warnCool.get(key) ?? 0;
    if (this.time < t) return;
    this.warnCool.set(key, this.time + cool); this.cb.notice(text, 'warn');
  }

  // ---------------- rules ----------------
  private rules(dt: number) {
    const surf = roadSurface(this.x, this.z);
    const hit = surf.hit;
    if (hit && hit.dist < hit.edge.width / 2 + 3) this.curEdge = hit.edge;
    this.limit = this.curEdge?.limit ?? 50;
    const school = stopById('school'), hosp = stopById('hospital');
    if (Math.hypot(this.x - school.sx, this.z - school.sz) < 80 || Math.hypot(this.x - hosp.sx, this.z - hosp.sz) < 80) this.limit = Math.min(this.limit, 25);
    const kmh = Math.abs(this.speed) * 3.6;
    this.speedCool -= dt; this.wrongCool -= dt; this.tollCool -= dt; this.hornCool -= dt; this.nightCool -= dt;
    if (kmh > this.limit + 7) { this.overT += dt; if (this.overT > 1.2) this.warn('speed', `⚠️ Speed limit ${this.limit} km/h – slow down!`, 8); } else this.overT = Math.max(0, this.overT - dt * 2);
    if (this.overT > 3.5 && this.speedCool <= 0) { this.speedCool = 15; this.overT = 0; this.violation(`Over-speeding (${kmh.toFixed(0)} in ${this.limit} zone)`, 500); }
    // wrong side
    if (hit && surf.on && Math.abs(this.speed) > 4) {
      const along = Math.sign(Math.sin(this.heading) * hit.dx + Math.cos(this.heading) * hit.dz) * Math.sign(this.speed);
      const lt = hit.lateral * along;
      if (lt < -0.9 && !this.junctionNear()) this.wrongT += dt; else this.wrongT = Math.max(0, this.wrongT - dt * 2);
      const lim = hit.edge.median > 0 ? 1.5 : 7;
      if (this.wrongT > lim * 0.5) this.warn('wrong', '⚠️ Keep LEFT! You are on the wrong side of the road', 8);
      if (this.wrongT > lim && this.wrongCool <= 0) { this.wrongCool = 20; this.wrongT = 0; this.violation('Wrong-side driving', 500); }
    }
    // indicators & junctions
    if (this.indicator === 'left' || this.indicator === 'hazard') this.lastIndL = this.time;
    if (this.indicator === 'right' || this.indicator === 'hazard') this.lastIndR = this.time;
    if (this.indicator === 'hazard') this.usedHazard += dt;
    let inNode: string | null = null;
    for (const n of nodes.values()) {
      if (n.edges.length < 3) continue;
      const w = Math.max(...n.edges.map(i => edges[i].width)) / 2 + 1;
      if (Math.abs(n.x - this.x) < w && Math.abs(n.z - this.z) < w) { inNode = n.id; break; }
    }
    if (inNode && (!this.junction || this.junction.id !== inNode)) {
      this.junction = { id: inNode, heading: this.heading };
      const n = nodes.get(inNode)!;
      if (n.signal && Math.abs(this.speed) > 1.5) {
        const axis = Math.abs(Math.sin(this.heading)) > Math.abs(Math.cos(this.heading)) ? 'x' : 'z';
        if (signalColor(n, axis, this.signalTime) === 'red') this.violation('Jumped a red light', 1000);
      }
    } else if (!inNode && this.junction) {
      const n = nodes.get(this.junction.id)!;
      if (Math.hypot(n.x - this.x, n.z - this.z) > 14) {
        let d = this.heading - this.junction.heading; d = Math.atan2(Math.sin(d), Math.cos(d));
        if (Math.abs(d) > 0.75 && Math.abs(this.speed) > 1) {
          const ok = d > 0 ? this.time - this.lastIndL < 8 : this.time - this.lastIndR < 8;
          if (!ok) this.violation(`Turned ${d > 0 ? 'left' : 'right'} without indicator`, 200);
          else if (this.indicator !== 'hazard') this.indicator = 'none';
        }
        this.junction = null;
      }
    }
    // police checkpoint
    const cp = this.world.checkpoint; const dcp = Math.hypot(this.x - cp.x, this.z - cp.z);
    if (dcp < 90 && dcp > 20 && !this.cpInside) this.warn('cp', '👮 Police checkpoint ahead – slow down below 20 km/h', 20);
    if (dcp < 16) { if (!this.cpInside) { this.cpInside = true; this.cpMin = 99; } this.cpMin = Math.min(this.cpMin, kmh); }
    else if (this.cpInside && dcp > 18) { this.cpInside = false; if (this.cpMin > 20) this.violation('Did not slow down at police checkpoint', 2000); else this.cb.notice('👮 Police: "Documents OK. Shubh yatra!"', 'good'); }
    // toll
    const tl = this.world.toll;
    if (Math.abs(this.x - tl.x) < 4.5 && Math.abs(this.z - tl.z) < 10 && this.tollCool <= 0) {
      this.tollCool = 25; this.tolls += TOLL_FEE; audio.coin();
      this.cb.notice(`🛣️ FASTag: ₹${TOLL_FEE} toll paid at NH-48 Toll Plaza`, 'info');
      if (kmh > 25) { this.violation('Rammed the toll barrier', 1000); this.damage = Math.min(100, this.damage + 3); audio.crash(0.3); }
    }
    // railway
    if (Math.abs(this.z - RAIL_Z) < 5) {
      const cx = this.world.crossings.find(c => Math.abs(c.x - this.x) < 12);
      if (cx && this.train.gateClosed(cx.x) && !this.railFlag) { this.railFlag = true; this.violation('Crossed a closed railway gate', 3000); }
    } else if (Math.abs(this.z - RAIL_Z) > 12) this.railFlag = false;
    if (Math.abs(this.z - RAIL_Z) < 80 && this.world.crossings.some(c => Math.abs(c.x - this.x) < 15 && this.train.gateClosed(c.x))) this.warn('rail', '🚂 Railway gate closed – wait for the train to pass', 15);
    // headlights at night
    if (this.env.night > 0.6 && this.lights === 0 && kmh > 10) { this.nightT += dt; if (this.nightT > 4) this.warn('lights', '💡 It is dark – turn on headlights (L)', 15); if (this.nightT > 25 && this.nightCool <= 0) { this.nightCool = 60; this.violation('Driving without headlights at night', 500); } } else this.nightT = 0;
    if (this.env.rain > 0.4 && !this.wipers) this.warn('wipers', '🌧️ Turn on wipers (K) for visibility', 25);
    if (this.door && kmh > 8) this.warn('door', '🚪 Door open while moving – passengers are unsafe! (O)', 6);
    // safe position tracking
    this.safeT -= dt;
    if (surf.on && this.safeT < 0 && Math.abs(this.z - RIVER_Z) > 40) { this.safeT = 2; this.lastSafe = { x: this.x, z: this.z, h: this.heading }; }
  }
  private junctionNear() { for (const n of nodes.values()) if (Math.abs(n.x - this.x) < 18 && Math.abs(n.z - this.z) < 18) return true; return false; }

  // ---------------- stops & passengers ----------------
  private doorWorld() { return this.bus.body.localToWorld(this.bus.doorPos.clone()); }

  private chooseDest(st: Stop, w: Waiting): string {
    if (w.dest) return w.dest;
    if (this.routeStops.length) {
      const remaining = this.routeStops.slice(this.stopIdx + 1).filter(id => id !== st.id);
      if (!remaining.length) return this.routeStops[this.routeStops.length - 1];
      return Math.random() < 0.4 ? remaining[remaining.length - 1] : remaining[Math.floor(Math.random() * remaining.length)];
    }
    const others = stops.filter(s => s.id !== st.id).map(s => ({ s, d: Math.hypot(s.sx - st.sx, s.sz - st.sz) })).sort((a, b) => a.d - b.d);
    const pool = this.mission?.paxTarget ? others.slice(0, 3) : others.slice(0, 6);
    return pool[Math.floor(Math.random() * pool.length)].s.id;
  }

  private updateStops(dt: number) {
    const door = this.doorWorld();
    let st: Stop | null = null; let best = 15;
    for (const s of stops) { const d = Math.hypot(door.x - s.sx, door.z - s.sz); if (d < best) { best = d; st = s; } }
    const stopped = Math.abs(this.speed) < 0.4;
    if (st && stopped && this.doorAmt > 0.85) {
      if (this.stopActive !== st) {
        this.stopActive = st; this.served = false; this.boardT = 0.5;
        this.exitQ = this.pax.onboard.filter(p => p.dest === st.id).map(p => String(p.id));
        if (st.id === 'central' && Math.random() < 0.5) audio.announce('Passengers for City Local please board now.', 'सिटी लोकल के यात्री कृपया बस में बैठें।');
      }
      this.boardT -= dt;
      if (this.boardT <= 0) {
        const canBoard = !this.routeStops.length || (this.routeStops.indexOf(st.id, this.stopIdx) >= 0 && this.routeStops.indexOf(st.id, this.stopIdx) < this.routeStops.length - 1) || (this.routeStops[this.stopIdx] === st.id && this.stopIdx < this.routeStops.length - 1);
        const waiting = this.pax.waiting.get(st.id)!;
        if (this.exitQ.length) {
          const id = Number(this.exitQ.shift());
          const i = this.pax.onboard.findIndex(p => p.id === id);
          if (i >= 0) { const p = this.pax.onboard.splice(i, 1)[0]; this.payFare(p, st); this.pax.walkFromDoor(door, st); }
          this.boardT = 0.75;
        } else if (canBoard && waiting.length && this.pax.onboard.length + this.inFlight < this.spec.seats) {
          const w = waiting.shift()!; this.inFlight++;
          const stopRef = st;
          this.pax.walkToDoor(w, door, () => {
            this.inFlight--;
            const dest = this.chooseDest(stopRef, w);
            const waited = this.pax.time - w.since;
            const sat = THREE.MathUtils.clamp(68 + this.spec.comfort * 22 + this.up.comfort * 4 + this.clean * 6 - Math.min(25, waited / 8), 20, 100);
            this.pax.onboard.push({ id: w.id, from: stopRef.id, dest, sat, board: this.time, dist: stopDistance(stopRef, stopById(dest)), emergency: w.emergency, waited });
            audio.coin();
            if (w.emergency) this.cb.notice('🚑 Patient on board! Rush to City Hospital – drive smooth & use hazards (X)', 'warn');
          });
          this.boardT = 0.85;
        } else if (canBoard && waiting.length && !this.served) {
          this.warn('full', '🚌 Bus is full! Remaining passengers will wait.', 10);
          if (this.inFlight === 0) { this.served = true; this.onServed(st); }
        } else if (this.inFlight === 0 && !this.served) { this.served = true; this.onServed(st); }
      }
    } else if (this.stopActive && (!st || !stopped)) {
      if (!this.served && this.routeStops[this.stopIdx] === this.stopActive.id) this.warn('left', 'You left before boarding finished!', 5);
      this.stopActive = null;
    }
    // refill waiting passengers (free ride)
    this.refillT -= dt;
    if (!this.routeStops.length && this.refillT < 0) {
      this.refillT = 25;
      for (const s of stops) { const arr = this.pax.waiting.get(s.id)!; if (arr.length < 7 && Math.hypot(s.sx - this.x, s.sz - this.z) > 120) this.pax.addWaiting(s.id, 1 + Math.floor(Math.random() * 2)); }
    }
    // satisfaction drift
    for (const p of this.pax.onboard) {
      const expected = p.dist / 7 + 30;
      if (this.time - p.board > expected * 1.5) p.sat = Math.max(0, p.sat - dt * 0.4);
      if (p.emergency && this.indicator !== 'hazard') p.sat = Math.max(0, p.sat - dt * 0.2);
    }
    // bus station announcements
    this.annT -= dt;
    if (this.annT < 0) { this.annT = 70 + Math.random() * 60; const c = stopById('central'); if (Math.hypot(c.sx - this.x, c.sz - this.z) < 120) { const dests = ['Sitapur', 'Rampur', 'Himgiri']; const hi = ['सीतापुर', 'रामपुर', 'हिमगिरि']; const k = Math.floor(Math.random() * 3); audio.announce(`Attention please. The bus to ${dests[k]} will depart from platform ${k + 2}.`, `यात्रीगण कृपया ध्यान दें। ${hi[k]} जाने वाली बस प्लेटफ़ॉर्म नंबर ${k + 2} से जाएगी।`); } }
  }

  private payFare(p: { sat: number; dist: number; emergency?: boolean }, st: Stop) {
    const r = this.route;
    const base = r ? r.baseFare : 15, perKm = r ? r.perKm : 14;
    const fare = Math.round((base + perKm * (p.dist / 1000) * 1.6) * 8 * this.spec.fareMul * (0.5 + p.sat / 100 * 0.7) * (p.emergency ? 3 : 1));
    this.fares += fare; this.pax.delivered++;
    this.satSum += p.sat; this.satN++;
    const face = p.sat > 75 ? '😊' : p.sat > 50 ? '😐' : '😠';
    this.cb.notice(`${face} Passenger reached ${st.name} • +₹${fare}`, p.sat > 50 ? 'good' : 'warn');
    audio.coin();
    this.clean = Math.max(0, this.clean - 0.004);
    if (this.mission?.paxTarget && this.pax.delivered >= this.mission.paxTarget) this.finish(true);
  }

  private onServed(st: Stop) {
    audio.bell();
    if (this.routeStops.length && this.routeStops[this.stopIdx] === st.id) {
      this.stopIdx++;
      if (this.stopIdx >= this.routeStops.length) { this.finish(true); return; }
      const nx = stopById(this.routeStops[this.stopIdx]);
      this.cb.notice(`🔔 Ting-ting! Close the door (O) – next stop: ${nx.name}`, 'good');
      if (store.settings.voiceGuidance) audio.speak(`Next stop, ${nx.name}`, `अगला स्टॉप, ${nx.hindi}`);
    } else {
      this.cb.notice(`🔔 Ting-ting! Boarding complete at ${st.name}`, 'good');
    }
  }

  // ---------------- GPS ----------------
  private gps(dt: number) {
    const target = this.currentTarget();
    this.marker.visible = !!target && this.mode === 'drive';
    if (!target) { this.gpsRoute = null; this.ribbon.visible = false; return; }
    this.marker.position.set(target.rx + (target.sx - target.rx) * 0.45, this.groundY(target.rx, target.rz), target.rz + (target.sz - target.rz) * 0.45);
    const pulse = 1 + Math.sin(this.time * 4) * 0.08; this.marker.children[0].scale.set(pulse, 1, pulse);
    this.gpsTimer -= dt;
    if (!this.gpsRoute || this.gpsTargetId !== target.id) {
      this.gpsRoute = planRoute(this.x, this.z, this.heading, { edge: target.edge, s: target.s }, this.gpsOption);
      this.gpsTargetId = target.id; this.gpsIdx = 0; this.spoken.clear(); this.gpsTimer = 3;
    }
    const r = this.gpsRoute; if (!r || r.pts.length < 2) return;
    let bestD = 1e9, bestI = this.gpsIdx, bestT = 0;
    const i0 = Math.max(0, this.gpsIdx - 4), i1 = Math.min(r.pts.length - 2, this.gpsIdx + 60);
    for (let i = i0; i <= i1; i++) {
      const a = r.pts[i], b = r.pts[i + 1]; const vx = b.x - a.x, vz = b.z - a.z; const L2 = vx * vx + vz * vz || 1;
      const t = THREE.MathUtils.clamp(((this.x - a.x) * vx + (this.z - a.z) * vz) / L2, 0, 1);
      const d = Math.hypot(this.x - (a.x + vx * t), this.z - (a.z + vz * t));
      if (d < bestD) { bestD = d; bestI = i; bestT = t; }
    }
    this.gpsIdx = bestI; this.gpsProg = r.cum[bestI] + (r.cum[bestI + 1] - r.cum[bestI]) * bestT;
    if (bestD > 26 && this.gpsTimer < 0) { this.gpsRoute = null; this.gpsTimer = 3; this.warn('reroute', '🧭 Recalculating route…', 6); return; }
    // voice guidance
    const mi = r.maneuvers.findIndex(m => m.along > this.gpsProg + 1);
    if (mi >= 0 && store.settings.voiceGuidance) {
      const m = r.maneuvers[mi]; const d = m.along - this.gpsProg;
      const words = m.type === 'arrive' ? `your stop ${target.name} is ahead` : m.type === 'straight' ? 'continue straight' : m.type === 'uturn' ? 'make a U-turn' : `turn ${m.type.replace('slight-', 'slightly ')}`;
      if (d < 320 && d > 150 && !this.spoken.has(mi + 'f')) { this.spoken.add(mi + 'f'); audio.gpsSay(`In ${Math.round(d / 50) * 50} metres, ${words}${m.road ? ' onto ' + m.road : ''}`); }
      if (d < 60 && !this.spoken.has(mi + 'n')) { this.spoken.add(mi + 'n'); this.spoken.add(mi + 'f'); audio.gpsSay(m.type === 'arrive' ? `Arriving at ${target.name}` : `Now ${words}`); }
    }
    // 3D route ribbon
    this.ribbonT -= dt;
    this.ribbonTex.offset.y -= dt * 1.2;
    if (this.ribbonT < 0) {
      this.ribbonT = 0.25;
      const pts: { x: number; z: number }[] = [];
      const sp = this.gpsProg + 6, ep = this.gpsProg + 160;
      for (let i = 0; i < r.pts.length - 1; i++) {
        const c0 = r.cum[i], c1 = r.cum[i + 1];
        if (c1 < sp || c0 > ep) continue;
        const a = r.pts[i], b = r.pts[i + 1]; const L = c1 - c0 || 1;
        for (let s = Math.max(sp, c0); s <= Math.min(ep, c1); s += 4) { const t = (s - c0) / L; pts.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t }); }
      }
      const show = this.mode === 'drive' && pts.length > 1 && store.settings.voiceGuidance !== undefined;
      this.ribbon.visible = show;
      if (show) {
        const pos: number[] = [], uv: number[] = [], idx: number[] = [];
        let acc = 0;
        for (let i = 0; i < pts.length; i++) {
          const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
          let dx = b.x - a.x, dz = b.z - a.z; const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
          const lx = dz, lz = -dx; const off = 1.9, w = 0.9;
          const cx = pts[i].x + lx * off, cz = pts[i].z + lz * off; const y = this.groundY(cx, cz) + 0.09;
          if (i > 0) acc += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
          pos.push(cx + lx * w, y, cz + lz * w, cx - lx * w, y, cz - lz * w);
          uv.push(0, acc / 3, 1, acc / 3);
          if (i < pts.length - 1) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
        }
        const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
        this.ribbon.geometry.dispose(); this.ribbon.geometry = g;
      }
    }
  }

  // ---------------- finish ----------------
  finish(success: boolean, reason?: string) {
    if (this.mode !== 'drive') return;
    this.mode = 'finished';
    audio.horn(false);
    const m = this.mission;
    const km = this.distance / 1000;
    let bonus = 0;
    const onTime = !!m?.timeLimit && this.timerLeft !== null && this.timerLeft > 0;
    if (success && (this.route || m)) {
      bonus += Math.round(1200 + km * 1800);
      if (this.collisions === 0) bonus += 1500;
      if (this.violations === 0) bonus += 1000;
      if (onTime) bonus += 2000;
      if (m?.emergency && this.usedHazard > 20) bonus += 2500;
    }
    const sat = this.satN ? this.satSum / this.satN : this.pax.avgSatisfaction();
    let missionReward = 0;
    if (success && m) {
      let ok = true;
      if (m.maxCollisions !== undefined && this.collisions > m.maxCollisions) ok = false;
      if (m.maxViolations !== undefined && this.violations > m.maxViolations) ok = false;
      if (m.timeLimit && (this.timerLeft ?? 0) <= 0) ok = false;
      if (ok) missionReward = store.save.missionsDone.includes(m.id) ? Math.round(m.reward * 0.25) : m.reward;
      else { success = false; reason = 'Mission conditions not met'; }
    }
    let stars = success ? 5 - Math.min(3, this.collisions) * 0.8 - Math.min(4, this.violations) * 0.4 - (sat < 60 ? 1 : sat < 75 ? 0.5 : 0) : 0;
    stars = Math.max(success ? 1 : 0, Math.min(5, Math.round(stars)));
    const total = this.fares + bonus + missionReward - this.fines - this.tolls - this.fuelSpent;
    const busId = this.spec.id;
    const result: RouteResult = {
      title: m ? m.title : this.route ? this.route.name : 'Free Ride', success, reason, fares: this.fares, bonus, fines: this.fines, repairs: this.tolls + this.fuelSpent, total,
      passengers: this.pax.delivered, satisfaction: Math.round(sat), collisions: this.collisions, violations: this.violations, distanceKm: km, timeSec: this.time, stars, missionReward,
      missionId: m?.id, routeId: this.route?.id,
    };
    store.updateSave(s => {
      s.money = Math.max(0, s.money + total);
      s.damage[busId] = this.damage; s.fuel[busId] = this.fuel / this.spec.tank; s.cleanliness[busId] = this.clean;
      s.stats.passengers += this.pax.delivered; s.stats.distanceKm += km; s.stats.earnings += Math.max(0, this.fares + bonus + missionReward); s.stats.accidents += this.collisions; s.stats.violations += this.violations; s.stats.fines += this.fines;
      if (success && this.route) { s.stats.routes++; s.routeRuns[this.route.id] = (s.routeRuns[this.route.id] || 0) + 1; s.routeBest[this.route.id] = Math.max(s.routeBest[this.route.id] || 0, stars); }
      if (success && m && missionReward > 0 && !s.missionsDone.includes(m.id)) s.missionsDone.push(m.id);
      s.reputation = Math.max(0, Math.min(100, s.reputation + (success ? stars * 0.8 + (m ? 2 : 0) : -1) - this.collisions * 0.5));
      // fleet passive income: other owned buses run routes while you drive
      const fleet = s.ownedBuses.length - 1;
      if (fleet > 0 && success) s.money += fleet * 1500;
    });
    this.marker.visible = false; this.ribbon.visible = false;
    setTimeout(() => this.cb.finish(result), 300);
  }

  quit() { if (this.mode === 'drive') this.finish(!this.route && !this.mission, this.route || this.mission ? 'Route abandoned' : undefined); }

  // ---------------- per-frame ----------------
  private resize = () => {
    const w = this.canvas.clientWidth || window.innerWidth, h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  };

  private loop = (t: number) => {
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.05, Math.max(0.001, (t - this.last) / 1000)); this.last = t;
    this.frames++; this.fpsT += dt; if (this.fpsT > 0.5) { this.fps = Math.round(this.frames / this.fpsT); this.frames = 0; this.fpsT = 0; }
    if (!this.paused) this.update(dt);
    this.render();
  };

  private update(dt: number) {
    this.signalTime += dt; this.traffic.time = this.signalTime;
    if (this.mode === 'drive') {
      this.time += dt;
      this.readInput(dt);
      const steps = dt > 0.025 ? 2 : 1;
      for (let i = 0; i < steps; i++) this.physics(dt / steps);
      this.doCollisions(dt);
      if (this.mode === 'drive') this.rules(dt);
      if (this.mode === 'drive') this.updateStops(dt);
      if (this.mode === 'drive') this.gps(dt);
      if (this.timerLeft !== null && this.mode === 'drive') { this.timerLeft -= dt; if (this.timerLeft <= 0) { this.timerLeft = 0; this.finish(false, 'Time is up!'); } }
    } else if (this.mode === 'finished') {
      this.speed *= 0.95; this.throttle = 0;
    }
    this.syncBus(dt);
    const zone = zoneAt(this.x, this.z);
    this.env.update(dt, store.settings.dayLength, this.camera.position, this.tmpV.set(this.x, this.y, this.z), zone === 'mountain' ? 0.18 : zone === 'hill' ? 0.3 : 0);
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    const obs: Obstacle[] = []; this.peds.obstacles(obs);
    const roadObs = obs.filter(o => Math.abs(o.x - this.x) < 120 && Math.abs(o.z - this.z) < 120);
    this.traffic.update(dt, { x: this.x, z: this.z, r: this.bus.width / 2, len: this.bus.length, hx: fx, hz: fz, speed: Math.abs(this.speed), kind: 'player' }, roadObs, true);
    this.peds.update(dt, this.x, this.z, Math.abs(this.speed), this.horn, fx, fz);
    this.train.update(dt, this.world.crossings.map(c => c.x), this.x);
    this.pax.update(dt);
    this.pax.syncVisuals(this.x, this.z);
    this.updateWorldVisuals(dt);
    this.updateCamera(dt);
    const interior = this.mode === 'drive' && (this.camMode === 'driver' || this.camMode === 'interior');
    let near = 0; for (const v of this.traffic.vehicles) if (v.active && Math.abs(v.x - this.x) < 80 && Math.abs(v.z - this.z) < 80) near++;
    audio.update(dt, { rpm: this.rpm, throttle: this.mode === 'drive' ? this.throttle : 0, engineOn: this.engineOn && this.fuel > 0, speed: Math.abs(this.speed), rain: this.env.rain, interior, passengers: this.pax.onboard.length, traffic: near / 12, city: zone === 'city' || zone === 'town' ? 1 : zone === 'highway' ? 0.4 : 0.15, style: this.spec.style });
    this.hudT -= dt;
    if (this.hudT < 0 && this.mode === 'drive') { this.hudT = 0.08; this.emitHud(); }
    this.mmT -= dt;
    if (this.mmT < 0 && this.minimap && this.mode === 'drive') { this.mmT = 0.05; this.drawMinimap(); }
  }

  private syncBus(dt: number) {
    const b = this.bus;
    b.group.position.set(this.x, this.y, this.z);
    b.group.rotation.set(0, this.heading, 0);
    const k = (1 - this.up.suspension * 0.2) * (this.spec.style === 'volvo' ? 0.6 : 1);
    const tRoll = THREE.MathUtils.clamp(this.latAcc * 0.014 * k, -0.07, 0.07), tPitch = THREE.MathUtils.clamp(-this.longAcc * 0.007 * k, -0.04, 0.04);
    this.roll += (tRoll - this.roll) * Math.min(1, dt * 4); this.pitch += (tPitch - this.pitch) * Math.min(1, dt * 4);
    const surf = this.curEdge; const rough = surf ? (1 - surf.condition) : 0.4;
    const bump = Math.sin(this.distance * 1.9) * 0.012 * rough * Math.min(1, Math.abs(this.speed) / 8) * k + (this.engineOn ? Math.sin(this.time * 47) * 0.002 : 0);
    b.body.rotation.set(this.pitch - this.rampPitch, 0, this.roll);
    b.body.position.y = bump;
    for (const w of b.wheels) w.rotation.x += this.speed * dt / 0.52;
    for (const p of b.frontPivots) p.rotation.y = this.steer;
    b.steering.rotation.y = -this.steer * 9;
    this.doorAmt += ((this.door ? 1 : 0) - this.doorAmt) * Math.min(1, dt * 3);
    b.door.position.x = b.width / 2 + 0.01 + Math.min(1, this.doorAmt * 3) * 0.12;
    b.door.position.z = b.doorZ - Math.max(0, this.doorAmt - 0.15) * 1.25;
    const kmh = Math.abs(this.speed) * 3.6;
    b.needles.speed.rotation.z = THREE.MathUtils.degToRad(135 - Math.min(120, kmh) / 120 * 270);
    b.needles.rpm.rotation.z = THREE.MathUtils.degToRad(135 - Math.min(3000, this.rpm) / 3000 * 270);
    b.needles.fuel.rotation.z = THREE.MathUtils.degToRad(60 - (this.fuel / this.spec.tank) * 120);
    b.needles.temp.rotation.z = THREE.MathUtils.degToRad(60 - THREE.MathUtils.clamp((this.temp - 50) / 70, 0, 1) * 120);
    if (this.wipers) { const a = (Math.sin(this.time * 4.2) * 0.5 + 0.5); b.wipers.forEach(w => w.rotation.z = 1.4 - a * 1.6); } else b.wipers.forEach(w => w.rotation.z += (1.4 - w.rotation.z) * Math.min(1, dt * 4));
    this.blinkT += dt; const blink = this.blinkT % 0.7 < 0.35;
    if (blink !== this.blinkOn) { this.blinkOn = blink; if (this.indicator !== 'none' && this.mode === 'drive') audio.click(blink); }
    const l = (this.indicator === 'left' || this.indicator === 'hazard') && blink, r = (this.indicator === 'right' || this.indicator === 'hazard') && blink;
    b.mats.indL.emissiveIntensity = l ? 3 : 0; b.mats.indR.emissiveIntensity = r ? 3 : 0;
    const braking = this.brake > 0.1 && this.gear !== -1 || (this.gear === -1 && this.throttle > 0.1);
    b.mats.brake.emissiveIntensity = braking ? 3 : this.lights ? 0.9 : 0.1;
    b.mats.reverse.emissiveIntensity = this.gear === -1 ? 2.5 : 0;
    b.mats.head.emissiveIntensity = this.lights ? 3 : 0.1;
    b.spot.intensity = this.lights === 0 ? 0 : this.lights === 1 ? 260 : 650;
    b.spot.angle = this.lights === 2 ? 0.45 : 0.65;
    b.spotTarget.position.set(0, 0, this.lights === 2 ? 60 : 22);
    const nightInt = this.env.night > 0.4 ? 1 : 0;
    b.mats.interior.emissiveIntensity = nightInt ? 1.6 : 0.25;
    this.interiorLight.intensity = nightInt ? 4 : 0;
    const n = this.pax.onboard.length;
    b.seated.forEach((s, i) => s.visible = i < n);
    b.group.updateMatrixWorld(true);
  }

  private updateWorldVisuals(dt: number) {
    const w = this.world, env = this.env;
    this.sigT -= dt;
    if (this.sigT < 0) {
      this.sigT = 0.2;
      const cols = [new THREE.Color('#ff2020'), new THREE.Color('#ffb000'), new THREE.Color('#20ff60')], dim = new THREE.Color('#2a2a2a');
      const map = { red: 0, yellow: 1, green: 2 } as const;
      w.signalInfo.forEach((s, i) => { const c = map[signalColor(s.node, s.axis, this.signalTime)]; w.signalLamps.setColorAt(i, c === s.color ? cols[s.color] : dim); });
      if (w.signalLamps.instanceColor) w.signalLamps.instanceColor.needsUpdate = true;
    }
    for (const c of w.crossings) {
      const closed = this.train.gateClosed(c.x);
      c.gates.forEach((g, i) => { const s = i === 0 ? -1 : 1; const target = closed ? 0 : s * 1.4; g.rotation.z += (target - g.rotation.z) * Math.min(1, dt * 1.5); });
    }
    for (const b of w.toll.barriers) {
      const sgn = Math.sign(b.z - 60);
      let open = Math.hypot(this.x - b.x, this.z - b.z) < 22 && Math.abs(this.speed) < 25 / 3.6;
      if (!open) for (const v of this.traffic.vehicles) if (v.active && Math.abs(v.x - b.x) < 14 && Math.abs(v.z - b.z) < 2.5) { open = true; break; }
      const target = open ? -sgn * 1.35 : 0;
      b.obj.rotation.x += (target - b.obj.rotation.x) * Math.min(1, dt * 3);
    }
    const night = env.night;
    w.windowMat.emissiveIntensity = night * 1.1;
    w.lampMat.emissiveIntensity = night > 0.35 || env.fog > 0.6 ? 3 : 0.05;
    vehicleHeadMat.emissiveIntensity = 0.1 + Math.max(night, env.fog * 0.8, env.rain * 0.6) * 3;
    vehicleTailMat.emissiveIntensity = 0.2 + night * 1.6;
    const wet = env.rain;
    for (const m of w.roadMats) { m.roughness = 0.88 - wet * 0.5; m.metalness = wet * 0.18; m.color.setScalar(1 - wet * 0.3); }
    w.waterMat.color.set(night > 0.5 ? '#0e2430' : '#2f7086');
  }

  private updateCamera(dt: number) {
    const cam = this.camera, b = this.bus;
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    const busQ = b.body.getWorldQuaternion(this.tmpQ);
    if (this.mode !== 'drive') {
      this.menuAngle += dt * (this.mode === 'garage' ? 0.25 : 0.08);
      const a = this.menuAngle + this.chaseYaw;
      const r = this.mode === 'garage' ? 16 : 26, hgt = this.mode === 'garage' ? 4.2 : 10;
      cam.position.set(this.x + Math.cos(a) * r, this.y + hgt, this.z + Math.sin(a) * r);
      cam.lookAt(this.x, this.y + 1.8, this.z);
      cam.fov = 50; cam.near = 0.6; cam.updateProjectionMatrix();
      return;
    }
    let fov = 62;
    if (this.camMode === 'driver' || this.camMode === 'interior') {
      const eye = b.body.localToWorld((this.camMode === 'driver' ? b.driverEye : b.interiorEye).clone());
      cam.position.copy(eye);
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.lookPitch - (this.camMode === 'driver' ? 0.06 : 0.04), Math.PI + this.lookYaw, 0, 'YXZ'));
      cam.quaternion.copy(busQ).multiply(q);
      fov = this.camMode === 'driver' ? 72 : 78;
      if (!this.dragging) { this.lookYaw *= 1 - Math.min(1, dt * 0.6) * (Math.abs(this.speed) > 3 ? 1 : 0); }
    } else if (this.camMode === 'chase') {
      const dist = b.length * 0.75 + 7 + Math.min(4, Math.abs(this.speed) * 0.15);
      const ang = this.heading + this.chaseYaw + (this.gear === -1 && store.settings.transmission === 'auto' ? 0 : 0);
      const target = this.tmpV.set(this.x - Math.sin(ang) * dist, this.y + 5.2, this.z - Math.cos(ang) * dist);
      cam.position.lerp(target, Math.min(1, dt * 4));
      if (cam.position.distanceTo(target) > 40) cam.position.copy(target);
      cam.position.y = Math.max(cam.position.y, this.groundY(cam.position.x, cam.position.z) + 1.2);
      cam.lookAt(this.x + fx * 4, this.y + 2.2, this.z + fz * 4);
      if (!this.dragging) this.chaseYaw *= 1 - Math.min(1, dt * 0.8);
      fov = 60 + Math.min(10, Math.abs(this.speed) * 0.3);
    } else if (this.camMode === 'rear') {
      const eye = b.body.localToWorld(new THREE.Vector3(0, 2.7, -b.length / 2 - 0.4));
      cam.position.copy(eye);
      cam.quaternion.copy(busQ).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.22, 0, 0)));
      fov = 80;
    } else {
      this.cin.t -= dt;
      const d = this.cin.pos.distanceTo(this.tmpV.set(this.x, this.y, this.z));
      if (this.cin.t < 0 || d > 75) {
        const side = Math.random() < 0.5 ? 1 : -1;
        const ahead = 25 + Math.abs(this.speed) * 2.5;
        this.cin.pos.set(this.x + fx * ahead + fz * side * (7 + Math.random() * 8), this.y + 1.4 + Math.random() * 6, this.z + fz * ahead - fx * side * (7 + Math.random() * 8));
        this.cin.t = 7 + Math.random() * 4;
      }
      cam.position.copy(this.cin.pos);
      cam.lookAt(this.x, this.y + 1.8, this.z);
      fov = Math.max(28, Math.min(60, 1400 / Math.max(10, d)));
    }
    const near = this.camMode === 'driver' || this.camMode === 'interior' ? 0.12 : this.camMode === 'rear' ? 0.3 : 0.6;
    if (cam.near !== near) { cam.near = near; cam.updateProjectionMatrix(); }
    if (Math.abs(cam.fov - fov) > 0.1) { cam.fov += (fov - cam.fov) * Math.min(1, dt * 5); cam.updateProjectionMatrix(); }
  }

  private render() {
    const r = this.renderer;
    const w = r.domElement.width, h = r.domElement.height;
    r.setScissorTest(false); r.setViewport(0, 0, w / r.getPixelRatio(), h / r.getPixelRatio());
    r.render(this.scene, this.camera);
    if (this.mode === 'drive' && this.camMode === 'driver' && store.settings.mirrors && this.quality !== 'low' && Math.abs(this.lookYaw) < 0.6) {
      const pr = r.getPixelRatio(); const cw = w / pr, ch = h / pr;
      r.setScissorTest(true);
      const b = this.bus; const busQ = b.body.getWorldQuaternion(this.tmpQ);
      MIRROR_RECTS.forEach((m, i) => {
        const x = m.x * cw, ww = m.w * cw, hh = m.h * ch, y = ch - (m.y * ch + hh);
        this.mirrorCam.position.copy(b.body.localToWorld((i === 0 ? b.mirrorL : b.mirrorR).clone()));
        this.mirrorCam.quaternion.copy(busQ).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.05, i === 0 ? -0.12 : 0.12, 0)));
        this.mirrorCam.aspect = ww / hh; this.mirrorCam.updateProjectionMatrix();
        r.setViewport(x, y, ww, hh); r.setScissor(x, y, ww, hh);
        r.render(this.scene, this.mirrorCam);
      });
      r.setScissorTest(false); r.setViewport(0, 0, cw, ch);
    }
  }

  private emitHud() {
    const target = this.currentTarget();
    const r = this.gpsRoute;
    let gps: HudState['gps'] = null;
    if (r && target) {
      const m = r.maneuvers.find(mm => mm.along > this.gpsProg + 1) || r.maneuvers[r.maneuvers.length - 1];
      const remaining = Math.max(0, r.length - this.gpsProg);
      gps = { type: m.type, dist: Math.max(0, m.along - this.gpsProg), road: m.road, eta: remaining / Math.max(6, Math.abs(this.speed)), remaining, option: this.gpsOption };
    }
    const atStop = this.nearStop();
    let prompt: string | null = null;
    const pump = this.world.pump;
    if (this.fuel <= 0.5) prompt = 'Out of diesel – press T for a tow truck (₹2,500)';
    else if (atStop && Math.abs(this.speed) < 0.4 && !this.door) prompt = `At ${atStop.name} – press O to open the door`;
    else if (atStop && this.door && this.served && this.stopActive === atStop) prompt = 'Boarding complete – close door (O) and depart';
    else if (Math.hypot(this.x - pump.x, this.z - pump.z) < pump.r && this.fuel < this.spec.tank - 1) prompt = Math.abs(this.speed) < 0.5 ? 'Press Enter / ⛽ to refuel' : 'Stop at the pump to refuel';
    else if (atStop && Math.abs(this.speed) > 0.4 && Math.abs(this.speed) < 6) prompt = `Stop here for ${atStop.name}`;
    let boarding: string | null = null;
    if (this.stopActive && !this.served) boarding = this.exitQ.length ? `Passengers getting off… (${this.exitQ.length})` : `Boarding… ${this.pax.waiting.get(this.stopActive.id)?.length ?? 0} waiting`;
    let signal: HudState['signal'] = null;
    for (const n of nodes.values()) {
      if (!n.signal) continue;
      const dx = n.x - this.x, dz = n.z - this.z; const d = Math.hypot(dx, dz);
      if (d < 60 && d > 6 && (dx * Math.sin(this.heading) + dz * Math.cos(this.heading)) / d > 0.85) { signal = signalColor(n, Math.abs(Math.sin(this.heading)) > Math.abs(Math.cos(this.heading)) ? 'x' : 'z', this.signalTime); break; }
    }
    const kmh = Math.abs(this.speed) * 3.6;
    const h: HudState = {
      speed: kmh, rpm: this.rpm, gear: this.gear === -1 ? 'R' : this.gear === 0 ? 'N' : (store.settings.transmission === 'auto' ? 'D' : '') + this.gear, fuel: this.fuel / this.spec.tank, fuelL: this.fuel, temp: this.temp, damage: this.damage,
      limit: this.limit, overLimit: kmh > this.limit + 5,
      money: store.save.money + this.fares - this.fines - this.tolls - this.fuelSpent, sessionEarn: this.fares - this.fines - this.tolls - this.fuelSpent, hour: this.env.hour, weather: this.env.weather,
      passengers: this.pax.onboard.length, seats: this.spec.seats, comfort: this.comfort, satisfaction: this.pax.avgSatisfaction(), cleanliness: this.clean,
      violations: this.violations, collisions: this.collisions,
      indicator: this.indicator, blink: this.blinkOn, lights: this.lights, wipers: this.wipers, door: this.door, handbrake: this.handbrake,
      camera: this.camMode, transmission: store.settings.transmission, engineOn: this.engineOn,
      routeName: this.mission ? this.mission.title : this.route ? this.route.name : 'Free Ride',
      nextStop: target?.name ?? (this.routeStops.length ? '—' : 'Pick passengers at any stop'), nextStopHindi: target?.hindi ?? '',
      stopIndex: this.stopIdx, stopCount: this.routeStops.length, distToStop: gps ? gps.remaining : target ? Math.hypot(target.sx - this.x, target.sz - this.z) : 0,
      gps, prompt, timer: this.timerLeft,
      missionText: this.mission ? (this.mission.paxTarget ? `Delivered ${this.pax.delivered}/${this.mission.paxTarget}` : this.mission.desc) : null,
      radio: RADIO_STATIONS[audio.station], roadName: this.curEdge?.name ?? 'Off-road', zone: zoneAt(this.x, this.z), signal, boarding, fps: this.fps,
    };
    this.cb.hud(h);
  }
  private nearStop(): Stop | null {
    const door = this.doorWorld(); let best: Stop | null = null; let bd = 15;
    for (const s of stops) { const d = Math.hypot(door.x - s.sx, door.z - s.sz); if (d < bd) { bd = d; best = s; } }
    return best;
  }

  private drawMinimap() {
    const c = this.minimap!; const g = c.getContext('2d'); if (!g) return;
    const W = c.width, H = c.height, R = W / 2;
    const scale = W / 260;
    g.save(); g.clearRect(0, 0, W, H);
    g.beginPath(); g.arc(R, R, R - 2, 0, Math.PI * 2); g.clip();
    g.fillStyle = '#1d2b1c'; g.fillRect(0, 0, W, H);
    const phi = -Math.PI / 2 - Math.atan2(Math.cos(this.heading), Math.sin(this.heading));
    g.translate(R, R + R * 0.25); g.rotate(phi);
    const vw = 200;
    // river & rail
    g.fillStyle = '#2b6a86'; g.fillRect((-3000 - this.x) * scale, (RIVER_Z - 26 - this.z) * scale, 6000 * scale, 52 * scale);
    g.strokeStyle = '#8d8d8d'; g.lineWidth = 3 * scale; g.setLineDash([4, 3]); g.beginPath(); g.moveTo((-3000 - this.x) * scale, (RAIL_Z - this.z) * scale); g.lineTo((3000 - this.x) * scale, (RAIL_Z - this.z) * scale); g.stroke(); g.setLineDash([]);
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (const pass of [0, 1]) for (const e of edges) {
      const p0 = e.pts[0], p1 = e.pts[e.pts.length - 1];
      if (Math.min(p0.x, p1.x) - vw > this.x && Math.min(p0.x, p1.x) > this.x + vw * 4) continue;
      g.strokeStyle = pass === 0 ? '#0d120d' : e.type === 'highway' ? '#f2c14e' : e.type === 'city' || e.type === 'town' ? '#d8d8d8' : e.type === 'mountain' ? '#c9a27a' : '#a8a8a8';
      g.lineWidth = (e.width + (pass === 0 ? 3 : 0)) * scale;
      g.beginPath();
      let started = false;
      for (let i = 0; i < e.pts.length; i += 2) {
        const p = e.pts[i]; const X = (p.x - this.x) * scale, Y = (p.z - this.z) * scale;
        if (!started) { g.moveTo(X, Y); started = true; } else g.lineTo(X, Y);
      }
      g.lineTo((p1.x - this.x) * scale, (p1.z - this.z) * scale);
      g.stroke();
    }
    if (this.gpsRoute) {
      g.strokeStyle = '#00e5ff'; g.lineWidth = 4 * scale + 1.5; g.beginPath();
      const r = this.gpsRoute;
      for (let i = this.gpsIdx; i < r.pts.length; i++) { const p = r.pts[i]; const X = (p.x - this.x) * scale, Y = (p.z - this.z) * scale; if (i === this.gpsIdx) g.moveTo(0, 0); g.lineTo(X, Y); }
      g.stroke();
    }
    for (const v of this.traffic.vehicles) { if (!v.active) continue; g.fillStyle = v.type === 'bus' ? '#ff9800' : v.type === 'truck' ? '#ef5350' : '#e0e0e0'; g.fillRect((v.x - this.x) * scale - 1.5, (v.z - this.z) * scale - 1.5, 3, 3); }
    const target = this.currentTarget();
    for (const s of stops) {
      const X = (s.sx - this.x) * scale, Y = (s.sz - this.z) * scale;
      const isT = target?.id === s.id;
      g.fillStyle = isT ? '#22ff88' : '#42a5f5'; g.beginPath(); g.arc(X, Y, isT ? 5 + Math.sin(this.time * 5) * 1.5 : 3.5, 0, 7); g.fill();
      const wn = this.pax.waiting.get(s.id)?.length ?? 0;
      if (wn && Math.hypot(X, Y) < R) { g.save(); g.translate(X, Y); g.rotate(-phi); g.fillStyle = '#fff'; g.font = 'bold 10px sans-serif'; g.fillText(String(wn), 5, -4); g.restore(); }
    }
    const pump = this.world.pump; g.save(); g.translate((pump.x - this.x) * scale, (pump.z - this.z) * scale); g.rotate(-phi); g.font = '12px sans-serif'; g.fillText('⛽', -6, 4); g.restore();
    // north marker
    g.restore();
    g.save();
    g.translate(R, R + R * 0.25);
    const nAng = phi - Math.PI / 2; const nx = Math.cos(nAng) * (R - 12), ny = Math.sin(nAng) * (R - 12);
    g.fillStyle = '#ff5252'; g.font = 'bold 12px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    const ny2 = Math.max(-R - R * 0.25 + 10, Math.min(R * 0.75 - 10, ny));
    g.fillText('N', nx, ny2);
    // player arrow
    g.fillStyle = '#ffeb3b'; g.strokeStyle = '#000'; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(0, -9); g.lineTo(6.5, 7); g.lineTo(0, 3.5); g.lineTo(-6.5, 7); g.closePath(); g.fill(); g.stroke();
    g.restore();
  }
}
