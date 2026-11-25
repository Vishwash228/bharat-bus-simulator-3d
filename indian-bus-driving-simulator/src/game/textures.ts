import * as THREE from 'three';
import type { RoadType } from './roads';

function canvas(w: number, h: number) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')!] as const; }
function tex(c: HTMLCanvasElement, repeat = false, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
function noise(ctx: CanvasRenderingContext2D, w: number, h: number, amt: number, n = 4000, size = 2) {
  for (let i = 0; i < n; i++) {
    const v = Math.random() * amt - amt / 2;
    ctx.fillStyle = v > 0 ? `rgba(255,255,255,${v})` : `rgba(0,0,0,${-v})`;
    ctx.fillRect(Math.random() * w, Math.random() * h, size, size);
  }
}

const cache = new Map<string, THREE.Texture>();
function cached(key: string, fn: () => THREE.Texture) { let t = cache.get(key); if (!t) { t = fn(); cache.set(key, t); } return t; }

/** Road textures: u across width, v along road (1 repeat = 12m) */
export function roadTexture(type: RoadType, lanesPerDir: number, median: number, width: number) {
  return cached('road-' + type, () => {
    const W = 256, Hh = 512;
    const [c, x] = canvas(W, Hh);
    const base = type === 'highway' ? '#4a4c50' : type === 'village' ? '#6e6152' : type === 'rural' || type === 'mountain' ? '#545454' : '#505257';
    x.fillStyle = base; x.fillRect(0, 0, W, Hh);
    noise(x, W, Hh, 0.12, 9000, 2);
    const px = (m: number) => (m / width) * W;
    if (type === 'village') {
      // dirt edges, no markings
      const g = x.createLinearGradient(0, 0, W, 0);
      g.addColorStop(0, 'rgba(140,110,70,0.9)'); g.addColorStop(0.15, 'rgba(140,110,70,0)'); g.addColorStop(0.85, 'rgba(140,110,70,0)'); g.addColorStop(1, 'rgba(140,110,70,0.9)');
      x.fillStyle = g; x.fillRect(0, 0, W, Hh);
      noise(x, W, Hh, 0.2, 3000, 3);
      return tex(c, true);
    }
    // tyre wear
    x.fillStyle = 'rgba(0,0,0,0.08)';
    const half = width / 2;
    for (let l = 0; l < lanesPerDir * 2; l++) {
      const laneW = (width - median - 1.2) / (lanesPerDir * 2);
      const c0 = 0.6 + l * laneW + (l >= lanesPerDir ? median : 0);
      x.fillRect(px(c0 + laneW * 0.2), 0, px(0.7), Hh); x.fillRect(px(c0 + laneW * 0.7), 0, px(0.7), Hh);
    }
    if (type === 'rural' || type === 'mountain') {
      // patches & potholes
      for (let i = 0; i < 6; i++) { x.fillStyle = `rgba(30,30,30,${0.2 + Math.random() * 0.2})`; x.beginPath(); x.ellipse(Math.random() * W, Math.random() * Hh, 6 + Math.random() * 18, 4 + Math.random() * 14, Math.random() * 3, 0, 7); x.fill(); }
      // broken edges
      x.fillStyle = 'rgba(120,100,70,0.6)';
      for (let i = 0; i < 30; i++) { x.fillRect(Math.random() < 0.5 ? 0 : W - 8, Math.random() * Hh, 4 + Math.random() * 8, 6 + Math.random() * 20); }
    }
    // edge lines
    x.fillStyle = type === 'highway' ? '#f5f5f5' : '#e8e8e8';
    x.fillRect(px(0.35), 0, px(0.18), Hh); x.fillRect(W - px(0.53), 0, px(0.18), Hh);
    if (type === 'highway') {
      // median
      x.fillStyle = '#8d8d86'; x.fillRect(px(half - median / 2), 0, px(median), Hh);
      x.fillStyle = '#e0c040'; x.fillRect(px(half - median / 2 - 0.25), 0, px(0.15), Hh); x.fillRect(px(half + median / 2 + 0.1), 0, px(0.15), Hh);
      // lane dashes
      x.fillStyle = '#f5f5f5';
      const laneW = (width - median - 1.2) / 4;
      const d1 = 0.6 + laneW, d2 = width - 0.6 - laneW;
      for (let v = 0; v < Hh; v += 128) { x.fillRect(px(d1) - 2, v, 4, 64); x.fillRect(px(d2) - 2, v, 4, 64); }
    } else {
      x.fillStyle = type === 'mountain' ? '#f2c94c' : '#f0f0f0';
      if (type === 'mountain') { x.fillRect(W / 2 - 5, 0, 3, Hh); x.fillRect(W / 2 + 2, 0, 3, Hh); }
      else for (let v = 0; v < Hh; v += 128) x.fillRect(W / 2 - 3, v, 6, 70);
    }
    return tex(c, true);
  });
}

export function junctionTexture() {
  return cached('junction', () => {
    const [c, x] = canvas(128, 128);
    x.fillStyle = '#505257'; x.fillRect(0, 0, 128, 128); noise(x, 128, 128, 0.12, 2000, 2);
    return tex(c, true);
  });
}

export function zebraTexture() {
  return cached('zebra', () => {
    const [c, x] = canvas(128, 32);
    x.clearRect(0, 0, 128, 32);
    x.fillStyle = 'rgba(240,240,240,0.92)';
    for (let i = 0; i < 8; i++) x.fillRect(i * 16 + 3, 0, 9, 32);
    return tex(c, false);
  });
}

export function groundDetailTexture() {
  return cached('ground', () => {
    const [c, x] = canvas(256, 256);
    x.fillStyle = '#d8d8d8'; x.fillRect(0, 0, 256, 256);
    noise(x, 256, 256, 0.35, 14000, 2);
    for (let i = 0; i < 300; i++) { x.fillStyle = `rgba(${Math.random() < 0.5 ? '255,255,255' : '0,0,0'},0.08)`; x.beginPath(); x.arc(Math.random() * 256, Math.random() * 256, 2 + Math.random() * 6, 0, 7); x.fill(); }
    const t = tex(c, true); return t;
  });
}

export function cropTexture(color: string) {
  return cached('crop' + color, () => {
    const [c, x] = canvas(64, 64);
    x.fillStyle = '#6b5a3a'; x.fillRect(0, 0, 64, 64);
    for (let i = 0; i < 8; i++) { x.fillStyle = color; x.fillRect(0, i * 8 + 1, 64, 5); }
    noise(x, 64, 64, 0.3, 800, 1);
    return tex(c, true);
  });
}

export function windowTexture(lit: boolean) {
  return cached('win' + lit, () => {
    const [c, x] = canvas(256, 256);
    x.fillStyle = lit ? '#000' : '#f2f2f2'; x.fillRect(0, 0, 256, 256);
    if (!lit) noise(x, 256, 256, 0.15, 3000, 2);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
      const wx = i * 64 + 16, wy = j * 64 + 14;
      if (lit) {
        if (Math.random() < 0.45) { x.fillStyle = Math.random() < 0.7 ? '#ffd27a' : '#cfe8ff'; x.fillRect(wx, wy, 32, 34); }
      } else {
        x.fillStyle = '#d0d0d0'; x.fillRect(wx - 3, wy - 3, 38, 40);
        x.fillStyle = Math.random() < 0.3 ? '#3a4a5a' : '#25313d'; x.fillRect(wx, wy, 32, 34);
        x.fillStyle = 'rgba(255,255,255,0.15)'; x.fillRect(wx, wy, 32, 6);
        x.fillStyle = '#555'; x.fillRect(wx + 15, wy, 2, 34);
        // AC unit or balcony
        if (Math.random() < 0.25) { x.fillStyle = '#e8e8e8'; x.fillRect(wx + 30, wy + 22, 14, 10); }
      }
    }
    return tex(c, true);
  });
}

export function signTexture(text: string, sub = '', bg = '#0d47a1', fg = '#ffffff', w = 512, h = 128) {
  return cached('sign' + text + sub + bg + fg + w, () => {
    const [c, x] = canvas(w, h);
    x.fillStyle = bg; x.fillRect(0, 0, w, h);
    x.strokeStyle = fg; x.lineWidth = 6; x.strokeRect(6, 6, w - 12, h - 12);
    x.fillStyle = fg; x.textAlign = 'center'; x.textBaseline = 'middle';
    const fs = sub ? h * 0.36 : h * 0.5;
    x.font = `bold ${fs}px "Trebuchet MS", sans-serif`;
    let s = fs; while (x.measureText(text).width > w - 30 && s > 10) { s -= 2; x.font = `bold ${s}px "Trebuchet MS", sans-serif`; }
    x.fillText(text, w / 2, sub ? h * 0.38 : h / 2);
    if (sub) { x.font = `${h * 0.24}px sans-serif`; x.fillText(sub, w / 2, h * 0.74); }
    return tex(c);
  });
}

export function busSideTexture(body: string, stripe: string, stripe2: string, operator: string, style: string) {
  return cached('busside' + operator + body, () => {
    const [c, x] = canvas(1024, 128);
    x.fillStyle = body; x.fillRect(0, 0, 1024, 128);
    if (style === 'volvo') {
      x.fillStyle = stripe; x.beginPath(); x.moveTo(0, 128); x.lineTo(0, 70); x.bezierCurveTo(300, 40, 600, 110, 1024, 30); x.lineTo(1024, 128); x.fill();
      x.fillStyle = stripe2; x.beginPath(); x.moveTo(0, 70); x.bezierCurveTo(300, 40, 600, 110, 1024, 30); x.lineTo(1024, 44); x.bezierCurveTo(600, 124, 300, 54, 0, 84); x.fill();
    } else {
      x.fillStyle = stripe; x.fillRect(0, 18, 1024, 26);
      x.fillStyle = stripe2; x.fillRect(0, 50, 1024, 8); x.fillRect(0, 100, 1024, 10);
      if (style === 'ordinary') { x.fillStyle = stripe; for (let i = 0; i < 1024; i += 80) { x.beginPath(); x.moveTo(i, 128); x.lineTo(i + 40, 110); x.lineTo(i + 80, 128); x.fill(); } }
    }
    x.font = 'bold 34px "Trebuchet MS", sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillStyle = style === 'volvo' ? '#4a148c' : '#ffffff';
    x.strokeStyle = 'rgba(0,0,0,0.5)'; x.lineWidth = 3;
    x.strokeText(operator, 512, 80); x.fillText(operator, 512, 80);
    noise(x, 1024, 128, 0.05, 1500, 2);
    return tex(c);
  });
}

export function destinationTexture(text: string, hindi: string) {
  const [c, x] = canvas(512, 96);
  x.fillStyle = '#0a0a0a'; x.fillRect(0, 0, 512, 96);
  x.fillStyle = '#ff9a1a'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.shadowColor = '#ff7b00'; x.shadowBlur = 8;
  x.font = 'bold 34px monospace'; x.fillText(text.toUpperCase().slice(0, 22), 256, 32);
  x.font = 'bold 28px sans-serif'; x.fillText(hindi, 256, 70);
  return tex(c);
}

export function truckBackTexture() {
  return cached('truckback', () => {
    const [c, x] = canvas(256, 256);
    const g = x.createLinearGradient(0, 0, 0, 256); g.addColorStop(0, '#ffca28'); g.addColorStop(1, '#ff7043');
    x.fillStyle = g; x.fillRect(0, 0, 256, 256);
    x.fillStyle = '#c2185b'; for (let i = 0; i < 8; i++) { x.beginPath(); x.arc(16 + i * 32, 18, 12, 0, 7); x.fill(); }
    x.fillStyle = '#1a237e'; x.textAlign = 'center'; x.font = 'bold 40px "Trebuchet MS"'; x.fillText('HORN', 128, 90);
    x.fillStyle = '#b71c1c'; x.font = 'bold 34px "Trebuchet MS"'; x.fillText('OK', 128, 130);
    x.fillStyle = '#1b5e20'; x.font = 'bold 36px "Trebuchet MS"'; x.fillText('PLEASE', 128, 170);
    x.fillStyle = '#000'; x.font = 'bold 18px sans-serif'; x.fillText('USE DIPPER AT NIGHT', 128, 215);
    x.fillStyle = '#e53935'; x.fillRect(0, 236, 256, 20);
    return tex(c);
  });
}

export function truckSideTexture(seed: number) {
  return cached('truckside' + seed, () => {
    const [c, x] = canvas(512, 128);
    const cols = ['#ff7043', '#ffca28', '#26a69a', '#ab47bc', '#42a5f5', '#ef5350'];
    x.fillStyle = cols[seed % cols.length]; x.fillRect(0, 0, 512, 128);
    for (let i = 0; i < 16; i++) { x.fillStyle = cols[(i + seed) % cols.length]; x.beginPath(); x.moveTo(i * 32, 0); x.lineTo(i * 32 + 16, 26); x.lineTo(i * 32 + 32, 0); x.fill(); }
    x.fillStyle = '#fff'; x.font = 'bold 30px "Trebuchet MS"'; x.textAlign = 'center'; x.fillText(['JAI MATA DI', 'BURI NAZAR WALE', 'SHUBH YATRA', 'MERA BHARAT MAHAN'][seed % 4], 256, 80);
    x.fillStyle = 'rgba(0,0,0,0.3)'; x.fillRect(0, 110, 512, 18);
    return tex(c);
  });
}

export function coachTexture() {
  return cached('coach', () => {
    const [c, x] = canvas(512, 64);
    x.fillStyle = '#1e3a8a'; x.fillRect(0, 0, 512, 64);
    x.fillStyle = '#fbbf24'; x.fillRect(0, 50, 512, 3);
    for (let i = 0; i < 14; i++) { x.fillStyle = '#0f172a'; x.fillRect(20 + i * 34, 14, 22, 18); x.fillStyle = '#94a3b8'; for (let k = 0; k < 4; k++) x.fillRect(20 + i * 34, 16 + k * 4, 22, 1); }
    x.fillStyle = '#0f172a'; x.fillRect(2, 8, 12, 42); x.fillRect(498, 8, 12, 42);
    return tex(c);
  });
}

export function gaugeTexture(kind: 'speed' | 'rpm') {
  return cached('gauge' + kind, () => {
    const [c, x] = canvas(256, 256);
    x.fillStyle = '#0b0b0b'; x.beginPath(); x.arc(128, 128, 126, 0, 7); x.fill();
    x.strokeStyle = '#999'; x.lineWidth = 4; x.beginPath(); x.arc(128, 128, 120, 0, 7); x.stroke();
    const max = kind === 'speed' ? 120 : 30, step = kind === 'speed' ? 20 : 5;
    x.fillStyle = '#fff'; x.font = 'bold 22px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    for (let v = 0; v <= max; v += step / 2) {
      const a = (-225 + (v / max) * 270) * Math.PI / 180;
      const major = v % step === 0;
      x.strokeStyle = kind === 'rpm' && v >= 25 ? '#ef4444' : '#fff'; x.lineWidth = major ? 4 : 2;
      x.beginPath(); x.moveTo(128 + Math.cos(a) * 112, 128 + Math.sin(a) * 112); x.lineTo(128 + Math.cos(a) * (major ? 92 : 102), 128 + Math.sin(a) * (major ? 92 : 102)); x.stroke();
      if (major) x.fillText(String(v), 128 + Math.cos(a) * 74, 128 + Math.sin(a) * 74);
    }
    x.font = '16px sans-serif'; x.fillStyle = '#ffb74d'; x.fillText(kind === 'speed' ? 'km/h' : 'x100 rpm', 128, 180);
    return tex(c);
  });
}

export function milestoneTexture(text: string, km: number) {
  return cached('mile' + text + km, () => {
    const [c, x] = canvas(128, 160);
    x.fillStyle = '#f5f5f5'; x.fillRect(0, 0, 128, 160);
    x.fillStyle = '#fbc02d'; x.beginPath(); x.ellipse(64, 40, 64, 40, 0, Math.PI, 0); x.fill(); x.fillRect(0, 38, 128, 20);
    x.fillStyle = '#111'; x.textAlign = 'center'; x.font = 'bold 22px sans-serif'; x.fillText(text, 64, 90); x.font = 'bold 30px sans-serif'; x.fillText(String(km), 64, 130);
    return tex(c);
  });
}

export function billboardTexture(i: number) {
  return cached('bb' + i, () => {
    const [c, x] = canvas(512, 256);
    const ads = [
      ['CHAI TIME', 'Asli Masala Chai ☕', '#e65100', '#fff3e0'],
      ['DESI CINEMA', 'Now Showing – Blockbuster', '#4a148c', '#fce4ec'],
      ['SAFE DRIVING', 'Speed thrills but kills', '#b71c1c', '#ffffff'],
      ['MOBILE 5G', 'Fastest network in Bharat', '#0d47a1', '#e3f2fd'],
      ['KRISHI TRACTORS', 'Sabse Mazboot', '#1b5e20', '#f1f8e9'],
      ['INCREDIBLE INDIA', 'Visit Himgiri Hills', '#006064', '#e0f7fa'],
    ][i % 6];
    const g = x.createLinearGradient(0, 0, 512, 256); g.addColorStop(0, ads[2]); g.addColorStop(1, '#000');
    x.fillStyle = g; x.fillRect(0, 0, 512, 256);
    x.fillStyle = ads[3]; x.textAlign = 'center'; x.font = 'bold 64px "Trebuchet MS"'; x.fillText(ads[0], 256, 120);
    x.font = '30px sans-serif'; x.fillText(ads[1], 256, 180);
    return tex(c);
  });
}

export function personFaceless() { return null; }
