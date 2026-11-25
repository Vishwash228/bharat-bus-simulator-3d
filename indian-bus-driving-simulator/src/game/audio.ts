// Fully synthesized audio (WebAudio) – no external assets required
export const RADIO_STATIONS = ['Off', 'Raag FM 92.7', 'Filmy Masti 98.3', 'Bhakti Sangeet 101.1'];

export class AudioManager {
  ctx: AudioContext | null = null;
  private master!: GainNode; private sfx!: GainNode; private music!: GainNode; private amb!: GainNode;
  private noiseBuf!: AudioBuffer;
  private eng: { o1: OscillatorNode; o2: OscillatorNode; o3: OscillatorNode; nf: BiquadFilterNode; ng: GainNode; f: BiquadFilterNode; g: GainNode } | null = null;
  private hornG: GainNode | null = null; private hornOsc: OscillatorNode[] = [];
  private rainG!: GainNode; private rainF!: BiquadFilterNode;
  private trafficG!: GainNode;
  private murmurG!: GainNode; private murmurF!: BiquadFilterNode;
  private radioOut!: GainNode;
  station = 0;
  private beat = 0; private nextBeat = 0; private sched: number | null = null;
  private vol = { master: 0.8, music: 0.5, sfx: 0.9 };
  private honkTimer = 3;
  private hindiVoice: SpeechSynthesisVoice | null = null; private enVoice: SpeechSynthesisVoice | null = null;
  speechEnabled = true;
  private melodyState = { note: 0, phrase: 0 };

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC(); this.ctx = ctx;
    this.master = ctx.createGain(); this.master.connect(ctx.destination);
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
    comp.connect(this.master);
    this.sfx = ctx.createGain(); this.sfx.connect(comp);
    this.amb = ctx.createGain(); this.amb.connect(comp);
    this.music = ctx.createGain(); this.music.connect(comp);
    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // engine
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 3; f.frequency.value = 400;
    const g = ctx.createGain(); g.gain.value = 0; f.connect(g); g.connect(this.sfx);
    const shaper = ctx.createWaveShaper(); const curve = new Float32Array(256); for (let i = 0; i < 256; i++) { const x = i / 128 - 1; curve[i] = Math.tanh(x * 2.5); } shaper.curve = curve; shaper.connect(f);
    const mk = (type: OscillatorType, gain: number) => { const o = ctx.createOscillator(); o.type = type; const og = ctx.createGain(); og.gain.value = gain; o.connect(og); og.connect(shaper); o.start(); return o; };
    const o1 = mk('sawtooth', 0.5), o2 = mk('square', 0.35), o3 = mk('sawtooth', 0.15);
    const ns = ctx.createBufferSource(); ns.buffer = this.noiseBuf; ns.loop = true;
    const nf = ctx.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 500; nf.Q.value = 1.2;
    const ng = ctx.createGain(); ng.gain.value = 0; ns.connect(nf); nf.connect(ng); ng.connect(g); ns.start();
    this.eng = { o1, o2, o3, nf, ng, f, g };
    // rain
    const rs = ctx.createBufferSource(); rs.buffer = this.noiseBuf; rs.loop = true;
    const rh = ctx.createBiquadFilter(); rh.type = 'highpass'; rh.frequency.value = 600;
    this.rainF = ctx.createBiquadFilter(); this.rainF.type = 'lowpass'; this.rainF.frequency.value = 5000;
    this.rainG = ctx.createGain(); this.rainG.gain.value = 0;
    rs.connect(rh); rh.connect(this.rainF); this.rainF.connect(this.rainG); this.rainG.connect(this.amb); rs.start();
    // traffic rumble
    const ts = ctx.createBufferSource(); ts.buffer = this.noiseBuf; ts.loop = true; ts.playbackRate.value = 0.7;
    const tf = ctx.createBiquadFilter(); tf.type = 'lowpass'; tf.frequency.value = 280;
    this.trafficG = ctx.createGain(); this.trafficG.gain.value = 0; ts.connect(tf); tf.connect(this.trafficG); this.trafficG.connect(this.amb); ts.start();
    // passenger murmur
    const ms = ctx.createBufferSource(); ms.buffer = this.noiseBuf; ms.loop = true;
    this.murmurF = ctx.createBiquadFilter(); this.murmurF.type = 'bandpass'; this.murmurF.frequency.value = 600; this.murmurF.Q.value = 4;
    const mf2 = ctx.createBiquadFilter(); mf2.type = 'bandpass'; mf2.frequency.value = 1400; mf2.Q.value = 5;
    this.murmurG = ctx.createGain(); this.murmurG.gain.value = 0;
    ms.connect(this.murmurF); ms.connect(mf2); this.murmurF.connect(this.murmurG); mf2.connect(this.murmurG); this.murmurG.connect(this.amb); ms.start();
    // radio chain
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 120;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 6500;
    this.radioOut = ctx.createGain(); this.radioOut.gain.value = 0.6;
    this.radioOut.connect(hp); hp.connect(lp); lp.connect(this.music);
    this.applyVolumes();
    this.loadVoices();
    if ('speechSynthesis' in window) window.speechSynthesis.onvoiceschanged = () => this.loadVoices();
  }

  private loadVoices() {
    if (!('speechSynthesis' in window)) return;
    const vs = window.speechSynthesis.getVoices();
    this.hindiVoice = vs.find(v => v.lang.toLowerCase().startsWith('hi')) || null;
    this.enVoice = vs.find(v => v.lang === 'en-IN') || vs.find(v => v.lang.startsWith('en')) || null;
  }

  setVolumes(master: number, music: number, sfx: number) { this.vol = { master, music, sfx }; this.applyVolumes(); }
  private applyVolumes() {
    if (!this.ctx) return;
    this.master.gain.value = this.vol.master;
    this.sfx.gain.value = this.vol.sfx;
    this.amb.gain.value = this.vol.sfx;
    this.music.gain.value = this.vol.music * 0.8;
  }
  suspend(on: boolean) { if (!this.ctx) return; if (on) this.ctx.suspend(); else this.ctx.resume(); }

  update(dt: number, p: { rpm: number; throttle: number; engineOn: boolean; speed: number; rain: number; interior: boolean; passengers: number; traffic: number; city: number; style: string }) {
    const ctx = this.ctx; if (!ctx || !this.eng) return;
    const t = ctx.currentTime;
    const e = this.eng;
    const fire = p.rpm / 20;
    const on = p.engineOn ? 1 : 0;
    e.o1.frequency.setTargetAtTime(fire, t, 0.05);
    e.o2.frequency.setTargetAtTime(fire * 0.5, t, 0.05);
    e.o3.frequency.setTargetAtTime(fire * 2.02, t, 0.05);
    const smooth = p.style === 'volvo' ? 0.6 : p.style === 'ordinary' ? 1.25 : 1;
    e.f.frequency.setTargetAtTime((180 + p.throttle * 900 + p.rpm * 0.25) * (p.interior ? 0.75 : 1) / Math.sqrt(smooth), t, 0.08);
    e.g.gain.setTargetAtTime(on * (0.16 + p.throttle * 0.22) * smooth * (p.interior ? 0.8 : 1), t, 0.08);
    e.nf.frequency.setTargetAtTime(350 + p.rpm * 0.4, t, 0.1);
    e.ng.gain.setTargetAtTime(on * (0.05 + p.throttle * 0.12) * smooth, t, 0.1);
    this.rainG.gain.setTargetAtTime(p.rain * (p.interior ? 0.32 : 0.22), t, 0.5);
    this.rainF.frequency.setTargetAtTime(p.interior ? 2500 : 6000, t, 0.3);
    this.trafficG.gain.setTargetAtTime(Math.min(1, p.traffic) * 0.12 + Math.min(p.speed / 25, 1) * 0.06, t, 0.4);
    this.murmurG.gain.setTargetAtTime(Math.min(1, p.passengers / 25) * (p.interior ? 0.05 : 0.012), t, 0.3);
    if (Math.random() < dt * 6) this.murmurF.frequency.setTargetAtTime(280 + Math.random() * 900, t, 0.05);
    this.radioOut.gain.setTargetAtTime(p.interior ? 0.65 : 0.25, t, 0.3);
    // random distant honks – the soul of Indian roads
    this.honkTimer -= dt;
    if (this.honkTimer < 0) {
      this.honkTimer = 1.5 + Math.random() * (6 - p.city * 4);
      if (p.traffic > 0.1) this.carHorn(0.03 + Math.random() * 0.06 * p.city, Math.random());
    }
  }

  private env(g: GainNode, t: number, a: number, peak: number, dur: number, rel: number) {
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.setValueAtTime(peak, t + a + dur); g.gain.exponentialRampToValueAtTime(0.0001, t + a + dur + rel);
  }
  private osc(type: OscillatorType, freq: number, t: number, dur: number, peak: number, dest: AudioNode, a = 0.01, rel = 0.1) {
    const ctx = this.ctx!; const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq;
    const g = ctx.createGain(); this.env(g, t, a, peak, dur, rel); o.connect(g); g.connect(dest); o.start(t); o.stop(t + a + dur + rel + 0.05); return o;
  }
  private noise(t: number, dur: number, peak: number, type: BiquadFilterType, freq: number, dest: AudioNode, q = 1, a = 0.005) {
    const ctx = this.ctx!; const s = ctx.createBufferSource(); s.buffer = this.noiseBuf; s.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); this.env(g, t, a, peak, dur * 0.3, dur * 0.7);
    s.connect(f); f.connect(g); g.connect(dest); s.start(t, Math.random()); s.stop(t + dur + 0.1); return f;
  }

  horn(on: boolean, style = 'ordinary') {
    const ctx = this.ctx; if (!ctx) return;
    const t = ctx.currentTime;
    if (on && !this.hornG) {
      const g = ctx.createGain(); g.gain.value = 0; g.gain.setTargetAtTime(0.32, t, 0.02);
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 0.7;
      bp.connect(g); g.connect(this.sfx);
      const freqs = style === 'volvo' ? [349, 440, 523] : style === 'ordinary' ? [300, 377] : [330, 415];
      this.hornOsc = freqs.map(fq => { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(fq * 0.94, t); o.frequency.linearRampToValueAtTime(fq, t + 0.08); o.connect(bp); o.start(); return o; });
      this.hornG = g;
    } else if (!on && this.hornG) {
      const g = this.hornG; g.gain.setTargetAtTime(0, t, 0.04);
      const os = this.hornOsc; setTimeout(() => { os.forEach(o => { try { o.stop(); } catch { /* */ } }); g.disconnect(); }, 300);
      this.hornG = null; this.hornOsc = [];
    }
  }

  musicalHorn() {
    const ctx = this.ctx; if (!ctx) return;
    const t = ctx.currentTime;
    const n = (s: number) => 440 * Math.pow(2, s / 12);
    const seq: [number, number][] = [[7, .15], [7, .15], [7, .15], [12, .3], [16, .3], [7, .15], [7, .15], [7, .15], [12, .3], [16, .45], [12, .15], [12, .15], [11, .15], [11, .15], [9, .15], [9, .15], [7, .5]];
    let tt = t;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1400; bp.Q.value = 0.6; bp.connect(this.sfx);
    for (const [s, d] of seq) { this.osc('square', n(s), tt, d * 0.8, 0.12, bp, 0.01, 0.04); this.osc('sawtooth', n(s) * 1.005, tt, d * 0.8, 0.08, bp, 0.01, 0.04); tt += d; }
  }

  carHorn(vol: number, kind: number) {
    const ctx = this.ctx; if (!ctx) return; const t = ctx.currentTime;
    const base = kind < 0.4 ? 420 : kind < 0.75 ? 560 : 330;
    const reps = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < reps; i++) { const st = t + i * 0.22; this.osc('square', base, st, 0.13, vol, this.amb, 0.01, 0.03); this.osc('square', base * 1.25, st, 0.13, vol * 0.7, this.amb, 0.01, 0.03); }
  }
  truckHorn(vol = 0.1) { const ctx = this.ctx; if (!ctx) return; const t = ctx.currentTime; this.osc('sawtooth', 233, t, 0.6, vol, this.amb, 0.03, 0.2); this.osc('sawtooth', 294, t, 0.6, vol, this.amb, 0.03, 0.2); }

  click(high: boolean) { const ctx = this.ctx; if (!ctx) return; this.noise(ctx.currentTime, 0.03, 0.2, 'bandpass', high ? 3200 : 2200, this.sfx, 6); }
  brakeHiss() { const ctx = this.ctx; if (!ctx) return; this.noise(ctx.currentTime, 0.9, 0.18, 'highpass', 3000, this.sfx); }
  door(open: boolean) {
    const ctx = this.ctx; if (!ctx) return; const t = ctx.currentTime;
    this.noise(t, 0.6, 0.16, 'bandpass', 1600, this.sfx, 0.8);
    this.osc('sine', open ? 90 : 70, t + 0.55, 0.05, 0.25, this.sfx, 0.005, 0.15);
  }
  bell() {
    const ctx = this.ctx; if (!ctx) return; const t = ctx.currentTime;
    for (const st of [0, 0.28]) { this.osc('sine', 2350, t + st, 0.02, 0.18, this.sfx, 0.002, 0.6); this.osc('sine', 3520, t + st, 0.02, 0.07, this.sfx, 0.002, 0.4); }
  }
  whistle() {
    const ctx = this.ctx; if (!ctx) return; const t = ctx.currentTime;
    for (const st of [0, 0.35]) {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = 2900;
      const lfo = ctx.createOscillator(); lfo.frequency.value = 28; const lg = ctx.createGain(); lg.gain.value = 180; lfo.connect(lg); lg.connect(o.frequency);
      const g = ctx.createGain(); this.env(g, t + st, 0.01, 0.12, 0.22, 0.05); o.connect(g); g.connect(this.sfx);
      o.start(t + st); lfo.start(t + st); o.stop(t + st + 0.35); lfo.stop(t + st + 0.35);
    }
  }
  coin() { const ctx = this.ctx; if (!ctx) return; const t = ctx.currentTime; this.osc('triangle', 1800, t, 0.03, 0.08, this.sfx, 0.002, 0.15); this.osc('triangle', 2700, t + 0.07, 0.03, 0.08, this.sfx, 0.002, 0.25); }
  chime() {
    const ctx = this.ctx; if (!ctx) return; const t = ctx.currentTime;
    [659, 523, 784].forEach((f, i) => this.osc('sine', f, t + i * 0.45, 0.1, 0.12, this.sfx, 0.01, 0.9));
  }
  crash(intensity: number) {
    const ctx = this.ctx; if (!ctx) return; const t = ctx.currentTime;
    const v = Math.min(1, intensity);
    this.noise(t, 0.8, 0.5 * v + 0.1, 'lowpass', 900, this.sfx, 0.5);
    this.noise(t, 0.4, 0.3 * v, 'bandpass', 3000, this.sfx, 2);
    this.osc('square', 140, t, 0.05, 0.2 * v, this.sfx, 0.002, 0.3);
    for (let i = 0; i < 4; i++) this.osc('triangle', 800 + Math.random() * 2500, t + 0.05 + Math.random() * 0.3, 0.02, 0.05 * v, this.sfx, 0.002, 0.25);
  }
  thunder(delay = 0) {
    const ctx = this.ctx; if (!ctx) return; const t = ctx.currentTime + delay;
    this.noise(t, 3.5, 0.55, 'lowpass', 160, this.amb, 0.7, 0.05);
    this.noise(t + 0.1, 1.2, 0.3, 'lowpass', 500, this.amb, 0.5, 0.01);
  }
  trainHorn(vol = 0.2) {
    const ctx = this.ctx; if (!ctx) return; const t = ctx.currentTime;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1600; lp.connect(this.amb);
    for (const f of [220, 277, 330]) this.osc('sawtooth', f, t, 1.6, vol * 0.4, lp, 0.08, 0.4);
  }
  offroadRumble(v: number) { const ctx = this.ctx; if (!ctx || v < 0.05) return; if (Math.random() < 0.3) this.noise(ctx.currentTime, 0.15, 0.08 * v, 'lowpass', 200, this.sfx); }

  speak(text: string, hindi?: string, rate = 1.05, volume = 0.9) {
    if (!this.speechEnabled || !('speechSynthesis' in window)) return;
    const useHindi = !!(hindi && this.hindiVoice);
    const u = new SpeechSynthesisUtterance(useHindi ? hindi : text);
    const v = useHindi ? this.hindiVoice : this.enVoice;
    if (v) { u.voice = v; u.lang = v.lang; } else u.lang = 'en-IN';
    u.rate = rate; u.volume = volume * this.vol.master;
    window.speechSynthesis.speak(u);
  }
  gpsSay(text: string) { if (!('speechSynthesis' in window) || !this.speechEnabled) return; window.speechSynthesis.cancel(); this.speak(text, undefined, 1.05, 0.9); }
  announce(english: string, hindi: string) { this.chime(); setTimeout(() => this.speak(english, hindi, 0.95, 0.8), 1500); }

  // ---------------- procedural radio ----------------
  setStation(i: number) {
    this.station = ((i % RADIO_STATIONS.length) + RADIO_STATIONS.length) % RADIO_STATIONS.length;
    if (this.sched) { clearInterval(this.sched); this.sched = null; }
    if (!this.ctx || this.station === 0) return RADIO_STATIONS[this.station];
    // tuning static
    this.noise(this.ctx.currentTime, 0.4, 0.08, 'bandpass', 2500, this.radioOut, 0.5);
    this.beat = 0; this.nextBeat = this.ctx.currentTime + 0.5;
    this.sched = window.setInterval(() => this.tick(), 60);
    return RADIO_STATIONS[this.station];
  }
  private tick() {
    const ctx = this.ctx; if (!ctx) return;
    const bpm = this.station === 1 ? 84 : this.station === 2 ? 116 : 70;
    const spb = 60 / bpm / 2; // eighth notes
    while (this.nextBeat < ctx.currentTime + 0.25) {
      if (this.station === 1) this.raag(this.nextBeat, this.beat, spb);
      else if (this.station === 2) this.filmy(this.nextBeat, this.beat, spb);
      else this.bhakti(this.nextBeat, this.beat, spb);
      this.nextBeat += spb; this.beat++;
    }
  }
  private tabla(t: number, bol: string, vol = 1) {
    const ctx = this.ctx!; const out = this.radioOut;
    if (bol === 'dha' || bol === 'dhin' || bol === 'ge') {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(70, t + 0.3);
      const g = ctx.createGain(); this.env(g, t, 0.003, 0.35 * vol, 0.02, bol === 'ge' ? 0.4 : 0.25); o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.5);
    }
    if (bol !== 'ge') {
      const hi = bol === 'tin' || bol === 'dhin' ? 520 : 440;
      this.osc('sine', hi, t, 0.01, (bol === 'na' ? 0.12 : 0.16) * vol, out, 0.002, bol === 'ta' || bol === 'na' ? 0.08 : 0.18);
      this.osc('sine', hi * 2.7, t, 0.005, 0.04 * vol, out, 0.001, 0.05);
      this.noise(t, 0.04, 0.05 * vol, 'highpass', 4000, out);
    }
  }
  private pluck(t: number, f: number, dur: number, vol: number, bright = 1800) {
    const ctx = this.ctx!; const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(bright, t); lp.frequency.exponentialRampToValueAtTime(300, t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(lp); lp.connect(g); g.connect(this.radioOut); o.start(t); o.stop(t + dur + 0.05);
  }
  private flute(t: number, f: number, dur: number, vol: number, glideFrom?: number) {
    const ctx = this.ctx!; const o = ctx.createOscillator(); o.type = 'sine';
    if (glideFrom) { o.frequency.setValueAtTime(glideFrom, t); o.frequency.exponentialRampToValueAtTime(f, t + Math.min(0.15, dur * 0.4)); } else o.frequency.value = f;
    const vib = ctx.createOscillator(); vib.frequency.value = 5.5; const vg = ctx.createGain(); vg.gain.value = f * 0.012; vib.connect(vg); vg.connect(o.frequency); vib.start(t); vib.stop(t + dur + 0.2);
    const g = ctx.createGain(); this.env(g, t, 0.06, vol, dur * 0.7, dur * 0.3 + 0.1);
    o.connect(g); g.connect(this.radioOut); o.start(t); o.stop(t + dur + 0.25);
    this.noise(t, dur * 0.6, vol * 0.08, 'bandpass', f * 2, this.radioOut, 3, 0.05);
  }
  private raag(t: number, b: number, spb: number) {
    const SA = 277.18; const scale = [0, 2, 4, 6, 7, 9, 11, 12, 14, 16];
    const f = (s: number) => SA * Math.pow(2, s / 12);
    const bols = ['dha', 'dhin', 'dhin', 'dha', 'dha', 'dhin', 'dhin', 'dha', 'dha', 'tin', 'tin', 'ta', 'ta', 'dhin', 'dhin', 'dha'];
    if (b % 2 === 0) this.tabla(t, bols[(b / 2) % 16], b % 32 === 0 ? 1.3 : 1);
    if (b % 4 === 0) { const tp = [7 - 12, 0, 0, -12][(b / 4) % 4]; this.pluck(t, f(tp), 2.8, 0.07, 1200); this.pluck(t, f(tp) * 2.005, 2.4, 0.03, 2400); }
    const ms = this.melodyState;
    if (b % 2 === 0 && Math.random() < 0.6) {
      const prev = ms.note; ms.note = Math.max(0, Math.min(scale.length - 1, ms.note + Math.floor(Math.random() * 5) - 2));
      const dur = spb * (Math.random() < 0.3 ? 4 : 2);
      this.flute(t, f(scale[ms.note]) * 2, dur, 0.1, Math.random() < 0.4 ? f(scale[prev]) * 2 : undefined);
    }
  }
  private filmy(t: number, b: number, spb: number) {
    const ROOT = 220; const f = (s: number) => ROOT * Math.pow(2, s / 12);
    const bar = Math.floor(b / 8) % 4; const chords = [[0, 3, 7], [-2, 2, 5], [-4, 0, 3], [-2, 2, 5]];
    const pat = ['dha', 'na', 'na', 'dha', 'ge', 'na', 'dha', 'na'];
    this.tabla(t, pat[b % 8], 0.9);
    if (b % 8 === 0) for (const s of chords[bar]) { this.pluck(t, f(s), spb * 8, 0.035, 1400); this.pluck(t, f(s) * 1.003, spb * 8, 0.03, 1400); }
    if (b % 2 === 0) this.pluck(t, f(chords[bar][0]) / 2, spb * 1.6, 0.12, 500);
    const hook = [7, 8, 7, 5, 3, 5, 7, 12, 10, 8, 7, 5, 7, 3, 2, 0];
    const phraseOn = Math.floor(b / 32) % 2 === 0;
    if (phraseOn && b % 2 === 0) {
      const i = (b / 2) % 16; const s = hook[i] + (Math.floor(b / 64) % 2 ? 0 : 12);
      const ctx = this.ctx!; const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = f(s);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2200;
      const g = ctx.createGain(); this.env(g, t, 0.02, 0.05, spb * 1.4, 0.1); o.connect(lp); lp.connect(g); g.connect(this.radioOut); o.start(t); o.stop(t + spb * 2);
    }
    if (b % 4 === 2) this.noise(t, 0.08, 0.04, 'highpass', 7000, this.radioOut);
  }
  private bhakti(t: number, b: number, spb: number) {
    const SA = 261.63; const f = (s: number) => SA * Math.pow(2, s / 12);
    if (b % 16 === 0) { this.osc('sine', 1180, t, 0.05, 0.08, this.radioOut, 0.002, 2.5); this.osc('sine', 1770, t, 0.05, 0.04, this.radioOut, 0.002, 1.8); }
    if (b % 2 === 0) this.noise(t, 0.12, 0.05, 'bandpass', 6500, this.radioOut, 4);
    if (b % 8 === 0) { for (const s of [0, 7, 12]) this.pluck(t, f(s) / 2, spb * 8.5, 0.05, 900); }
    if (b % 4 === 0) this.tabla(t, b % 8 === 0 ? 'ge' : 'na', 0.7);
    const bhajan = [0, 2, 4, 5, 4, 2, 4, 0, 7, 5, 4, 2, 4, 2, 0, 0];
    if (b % 4 === 0) this.flute(t, f(bhajan[(b / 4) % 16]) * 2, spb * 3.6, 0.07);
  }
}
