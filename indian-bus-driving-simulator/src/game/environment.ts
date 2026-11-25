import * as THREE from 'three';
import type { Quality, Weather } from './types';

const SKY_KEYS: [number, string, string][] = [
  [0, '#03060f', '#0a1228'], [4.8, '#060b1c', '#141a36'], [5.8, '#2a3c6a', '#e07a4a'], [6.6, '#4778b5', '#f6b07a'],
  [8, '#3f7fcf', '#cfe2f0'], [12, '#2b6fc9', '#b4d6f2'], [16.5, '#3a78c4', '#e2d6b8'], [17.8, '#3c5590', '#ff9a52'],
  [18.6, '#1d2650', '#d0603a'], [19.6, '#0a1130', '#2a1e3c'], [21, '#04070f', '#0a1228'], [24, '#03060f', '#0a1228'],
];
const WEATHER_PARAMS: Record<Weather, { cloud: number; rain: number; fog: number }> = {
  clear: { cloud: 0.12, rain: 0, fog: 0 }, cloudy: { cloud: 0.7, rain: 0, fog: 0.08 }, rain: { cloud: 0.88, rain: 0.75, fog: 0.25 },
  fog: { cloud: 0.45, rain: 0, fog: 1 }, storm: { cloud: 1, rain: 1, fog: 0.35 },
};

const vert = `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w; }`;
const frag = `
uniform vec3 topColor; uniform vec3 horizonColor; uniform vec3 sunDir; uniform vec3 sunColor; uniform float cloud; uniform float time; uniform float night; uniform float flash;
varying vec3 vDir;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
float noise(vec2 p){ vec2 i=floor(p); vec2 f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
float fbm(vec2 p){ float v=0.0; float a=0.5; for(int i=0;i<5;i++){ v+=a*noise(p); p*=2.03; a*=0.5; } return v; }
void main(){
  vec3 d = normalize(vDir);
  float h = clamp(d.y, -1.0, 1.0);
  vec3 col = mix(horizonColor, topColor, pow(max(h,0.0), 0.55));
  if (h < 0.0) col = mix(horizonColor, horizonColor*0.55, clamp(-h*4.0,0.0,1.0));
  float s = max(dot(d, normalize(sunDir)), 0.0);
  float sunVis = 1.0 - cloud*0.85;
  col += sunColor * (pow(s, 900.0)*6.0*sunVis + pow(s, 12.0)*0.25 + pow(s,3.0)*0.08) * step(-0.05, sunDir.y);
  // moon
  float m = max(dot(d, normalize(-sunDir)), 0.0);
  col += vec3(0.85,0.9,1.0) * pow(m, 2500.0) * 3.0 * night * sunVis;
  // stars
  vec2 sp = floor(d.xz / (abs(d.y)+0.3) * 220.0);
  float st = step(0.9965, hash(sp)) * night * (1.0 - cloud) * smoothstep(0.05, 0.3, h);
  col += vec3(st);
  // clouds
  if (h > 0.0) {
    vec2 uv = d.xz / (h + 0.12) * 1.6 + vec2(time*0.006, time*0.002);
    float n = fbm(uv);
    float c = smoothstep(0.62 - cloud*0.55, 0.95 - cloud*0.35, n) * smoothstep(0.0, 0.18, h);
    float lum = max(dot(horizonColor, vec3(0.33)), dot(topColor, vec3(0.33)));
    vec3 cc = mix(vec3(1.0), vec3(0.42,0.44,0.48), cloud) * (0.25 + lum*1.4);
    cc += sunColor * pow(s, 6.0) * 0.4 * sunVis;
    col = mix(col, cc, c * (0.6 + cloud*0.4));
  }
  col += vec3(0.75,0.8,1.0) * flash;
  gl_FragColor = vec4(col, 1.0);
}`;

export class Environment {
  hour = 9;
  weather: Weather = 'clear';
  dynamicWeather = true;
  cloud = 0.12; rain = 0; fog = 0; flash = 0;
  daylight = 1; night = 0;
  sun: THREE.DirectionalLight; hemi: THREE.HemisphereLight; sky: THREE.Mesh; skyMat: THREE.ShaderMaterial;
  fogObj: THREE.FogExp2;
  rainMesh: THREE.LineSegments; rainPos: Float32Array; rainCount: number;
  private weatherTimer = 200;
  private lightningTimer = 6;
  private time = 0;
  onThunder: ((delay: number) => void) | null = null;
  horizon = new THREE.Color(); top = new THREE.Color();

  constructor(private scene: THREE.Scene, quality: Quality) {
    this.skyMat = new THREE.ShaderMaterial({
      vertexShader: vert, fragmentShader: frag, side: THREE.BackSide, depthWrite: false,
      uniforms: { topColor: { value: new THREE.Color() }, horizonColor: { value: new THREE.Color() }, sunDir: { value: new THREE.Vector3(0, 1, 0) }, sunColor: { value: new THREE.Color('#fff2d0') }, cloud: { value: 0 }, time: { value: 0 }, night: { value: 0 }, flash: { value: 0 } },
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(2500, 32, 16), this.skyMat);
    this.sky.frustumCulled = false; this.sky.renderOrder = -1;
    scene.add(this.sky);
    this.sun = new THREE.DirectionalLight('#fff4e0', 2.5);
    this.sun.castShadow = quality !== 'low';
    const sm = quality === 'high' ? 2048 : 1024;
    this.sun.shadow.mapSize.set(sm, sm);
    const sc = this.sun.shadow.camera; sc.left = -70; sc.right = 70; sc.top = 70; sc.bottom = -70; sc.near = 10; sc.far = 400;
    this.sun.shadow.bias = -0.0006; this.sun.shadow.normalBias = 0.04;
    scene.add(this.sun); scene.add(this.sun.target);
    this.hemi = new THREE.HemisphereLight('#bcd6ff', '#5a4a30', 0.6);
    scene.add(this.hemi);
    this.fogObj = new THREE.FogExp2('#b4d6f2', 0.0012);
    scene.fog = this.fogObj;
    this.rainCount = quality === 'low' ? 1200 : quality === 'medium' ? 2600 : 4500;
    this.rainPos = new Float32Array(this.rainCount * 6);
    for (let i = 0; i < this.rainCount; i++) { const x = (Math.random() - 0.5) * 70, y = Math.random() * 35, z = (Math.random() - 0.5) * 70; this.rainPos.set([x, y, z, x, y - 0.6, z], i * 6); }
    const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.BufferAttribute(this.rainPos, 3));
    this.rainMesh = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: '#b8c8d8', transparent: true, opacity: 0.5, depthWrite: false }));
    this.rainMesh.frustumCulled = false; this.rainMesh.visible = false;
    scene.add(this.rainMesh);
  }

  setWeather(w: Weather, instant = false) {
    this.weather = w;
    if (instant) { const p = WEATHER_PARAMS[w]; this.cloud = p.cloud; this.rain = p.rain; this.fog = p.fog; }
  }

  private skyAt(h: number) {
    for (let i = 0; i < SKY_KEYS.length - 1; i++) {
      const [h0, t0, z0] = SKY_KEYS[i], [h1, t1, z1] = SKY_KEYS[i + 1];
      if (h >= h0 && h <= h1) {
        const t = (h - h0) / (h1 - h0);
        this.top.set(t0).lerp(new THREE.Color(t1), t); this.horizon.set(z0).lerp(new THREE.Color(z1), t); return;
      }
    }
  }

  update(dt: number, dayLengthMin: number, cam: THREE.Vector3, focus: THREE.Vector3, zoneFog: number) {
    this.time += dt;
    this.hour = (this.hour + dt * 24 / (dayLengthMin * 60)) % 24;
    if (this.dynamicWeather) {
      this.weatherTimer -= dt;
      if (this.weatherTimer < 0) {
        this.weatherTimer = 150 + Math.random() * 200;
        const r = Math.random();
        this.weather = r < 0.38 ? 'clear' : r < 0.6 ? 'cloudy' : r < 0.78 ? 'rain' : r < 0.9 ? 'fog' : 'storm';
      }
    }
    const tp = WEATHER_PARAMS[this.weather];
    const k = Math.min(1, dt * 0.08);
    this.cloud += (tp.cloud - this.cloud) * k; this.rain += (tp.rain - this.rain) * k; this.fog += (tp.fog - this.fog) * k;

    // sun
    const a = (this.hour - 6) / 12 * Math.PI;
    const sunDir = new THREE.Vector3(Math.cos(a), Math.sin(a), 0.38).normalize();
    const elev = sunDir.y;
    this.daylight = THREE.MathUtils.smoothstep(elev, -0.12, 0.25);
    this.night = 1 - THREE.MathUtils.smoothstep(elev, -0.2, 0.05);
    this.skyAt(this.hour);
    const gray = new THREE.Color('#6a7078').multiplyScalar(0.15 + this.daylight * 0.85);
    this.top.lerp(gray, this.cloud * 0.75); this.horizon.lerp(gray.clone().multiplyScalar(1.15), this.cloud * 0.7);
    const fogCol = new THREE.Color('#b9c2c8').multiplyScalar(0.12 + this.daylight * 0.85);
    this.horizon.lerp(fogCol, Math.min(1, this.fog * 0.8));

    // lightning
    if (this.weather === 'storm' && this.rain > 0.5) {
      this.lightningTimer -= dt;
      if (this.lightningTimer < 0) { this.lightningTimer = 4 + Math.random() * 10; this.flash = 1; this.onThunder?.(0.3 + Math.random() * 2); }
    }
    this.flash = Math.max(0, this.flash - dt * (this.flash > 0.5 ? 3 : 1.5));
    const fl = this.flash > 0 ? this.flash * (0.6 + 0.4 * Math.sin(this.time * 60)) : 0;

    const u = this.skyMat.uniforms;
    u.topColor.value.copy(this.top); u.horizonColor.value.copy(this.horizon); u.sunDir.value.copy(sunDir);
    const warm = 1 - THREE.MathUtils.smoothstep(elev, 0.0, 0.35);
    u.sunColor.value.set('#fff3dc').lerp(new THREE.Color('#ff8a3a'), warm);
    u.cloud.value = this.cloud; u.time.value = this.time; u.night.value = this.night; u.flash.value = fl * 0.6;
    this.sky.position.copy(cam);

    // lights
    const sunUp = elev > -0.02;
    const lightDir = sunUp ? sunDir : sunDir.clone().negate();
    this.sun.position.copy(focus).addScaledVector(lightDir, 200);
    this.sun.target.position.copy(focus);
    this.sun.color.copy(sunUp ? u.sunColor.value : new THREE.Color('#9fb4ff'));
    this.sun.intensity = sunUp ? (0.25 + 2.6 * this.daylight) * (1 - this.cloud * 0.62) : 0.35 * (1 - this.cloud * 0.7);
    this.hemi.color.copy(this.top).lerp(new THREE.Color('#ffffff'), 0.4);
    this.hemi.groundColor.set('#5a4a30').multiplyScalar(0.3 + this.daylight * 0.7);
    this.hemi.intensity = 0.32 + this.daylight * 0.75 + fl * 2.5;

    // fog
    const totalFog = this.fog + zoneFog;
    this.fogObj.color.copy(this.horizon);
    this.fogObj.density = 0.00065 + totalFog * 0.0095 + this.rain * 0.0035;

    // rain
    const raining = this.rain > 0.03;
    this.rainMesh.visible = raining;
    if (raining) {
      (this.rainMesh.material as THREE.LineBasicMaterial).opacity = 0.18 + this.rain * 0.4;
      const n = Math.floor(this.rainCount * Math.min(1, this.rain * 1.2));
      const fall = 28 * dt, wind = 4 * dt;
      const P = this.rainPos;
      for (let i = 0; i < this.rainCount; i++) {
        const o = i * 6;
        if (i >= n) { P[o + 1] = -100; P[o + 4] = -100; continue; }
        let x = P[o] + wind, y = P[o + 1] - fall, z = P[o + 2];
        if (y < -2 || y < -50) { x = (Math.random() - 0.5) * 70; y = 25 + Math.random() * 10; z = (Math.random() - 0.5) * 70; }
        if (x > 35) x -= 70;
        P[o] = x; P[o + 1] = y; P[o + 2] = z; P[o + 3] = x - 0.12; P[o + 4] = y - 0.7; P[o + 5] = z;
      }
      this.rainMesh.position.set(cam.x, cam.y - 8, cam.z);
      this.rainMesh.geometry.getAttribute('position').needsUpdate = true;
    }
    return { sunDir, flash: fl };
  }

  dispose() { this.scene.remove(this.sky, this.sun, this.hemi, this.rainMesh); }
}
