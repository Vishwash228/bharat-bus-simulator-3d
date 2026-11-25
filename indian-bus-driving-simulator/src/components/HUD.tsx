import { useMemo, type RefObject } from 'react';
import type { HudState, Notice } from '../game/types';
import { WEATHER_LABEL, CAMERA_LABELS } from '../game/types';
import { MIRROR_RECTS } from '../game/engine';
import { fmtMoney } from '../game/save';
import { ROUTE_OPTION_LABEL } from '../game/roads';

export const fmtDist = (m: number) => (m < 1000 ? `${Math.max(0, Math.round(m / 10) * 10)} m` : `${(m / 1000).toFixed(1)} km`);
export const fmtClock = (h: number) => { const hh = Math.floor(h) % 24, mm = Math.floor((h % 1) * 60); const ap = hh >= 12 ? 'PM' : 'AM'; return `${((hh + 11) % 12) + 1}:${String(mm).padStart(2, '0')} ${ap}`; };
export const weatherIcon = (w: string, h: number) => (w === 'storm' ? '⛈️' : w === 'rain' ? '🌧️' : w === 'fog' ? '🌫️' : w === 'cloudy' ? '☁️' : h > 6 && h < 18.5 ? '☀️' : '🌙');

export function GpsArrow({ type, size = 54 }: { type: string; size?: number }) {
  if (type === 'arrive') return <div style={{ fontSize: size * 0.8 }}>🏁</div>;
  const rot = type === 'left' ? -90 : type === 'right' ? 90 : type === 'slight-left' ? -45 : type === 'slight-right' ? 45 : 0;
  if (type === 'uturn') return (
    <svg width={size} height={size} viewBox="0 0 48 48"><path d="M30 42V18a8 8 0 0 0-16 0v10" stroke="white" strokeWidth="6" fill="none" strokeLinecap="round" /><path d="M6 26l8 10 8-10z" fill="white" /></svg>
  );
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" style={{ transform: `rotate(${rot}deg)` }}>
      <path d="M24 4L40 22H30V44H18V22H8Z" fill="white" />
    </svg>
  );
}
const gpsText = (t: string) => (t === 'arrive' ? 'Arrive at stop' : t === 'straight' ? 'Continue straight' : t === 'uturn' ? 'Make a U-turn' : t === 'left' ? 'Turn left' : t === 'right' ? 'Turn right' : t === 'slight-left' ? 'Keep left' : 'Keep right');

function Speedo({ h }: { h: HudState }) {
  const R = 78, C = 2 * Math.PI * R, arc = C * 0.75;
  const sp = Math.min(1, h.speed / 120), rp = Math.min(1, h.rpm / 3000);
  return (
    <div className="relative w-[190px] h-[190px] select-none">
      <svg viewBox="0 0 200 200" className="absolute inset-0 w-full h-full -rotate-[225deg]">
        <circle cx="100" cy="100" r={R} stroke="rgba(255,255,255,0.12)" strokeWidth="12" fill="none" strokeDasharray={`${arc} ${C}`} strokeLinecap="round" />
        <circle cx="100" cy="100" r={R} stroke={h.overLimit ? '#ef4444' : 'url(#sg)'} strokeWidth="12" fill="none" strokeDasharray={`${arc * sp} ${C}`} strokeLinecap="round" style={{ transition: 'stroke-dasharray .1s' }} />
        <circle cx="100" cy="100" r={62} stroke="rgba(255,255,255,0.08)" strokeWidth="5" fill="none" strokeDasharray={`${2 * Math.PI * 62 * 0.75} ${2 * Math.PI * 62}`} />
        <circle cx="100" cy="100" r={62} stroke={rp > 0.88 ? '#f97316' : '#a78bfa'} strokeWidth="5" fill="none" strokeDasharray={`${2 * Math.PI * 62 * 0.75 * rp} ${2 * Math.PI * 62}`} />
        <defs><linearGradient id="sg"><stop offset="0" stopColor="#22d3ee" /><stop offset="1" stopColor="#4ade80" /></linearGradient></defs>
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="text-5xl font-black text-white tabular-nums leading-none drop-shadow">{Math.round(h.speed)}</div>
        <div className="text-[11px] text-white/60 tracking-widest">KM/H</div>
        <div className="mt-1 px-2 py-0.5 rounded bg-white/10 text-amber-300 font-bold text-lg leading-none">{h.gear}</div>
        <div className="text-[10px] text-white/50 mt-1">{Math.round(h.rpm)} rpm</div>
      </div>
    </div>
  );
}

function Bar({ v, color, label, icon, warn }: { v: number; color: string; label: string; icon: string; warn?: boolean }) {
  return (
    <div className="flex items-center gap-1.5 text-[11px] text-white/80">
      <span className="w-4 text-center">{icon}</span>
      <div className="w-24 h-2 rounded-full bg-white/10 overflow-hidden"><div className={`h-full rounded-full ${warn ? 'blink' : ''}`} style={{ width: `${Math.max(0, Math.min(1, v)) * 100}%`, background: color }} /></div>
      <span className="w-12 tabular-nums">{label}</span>
    </div>
  );
}

const DROPS = Array.from({ length: 70 }, () => ({ x: Math.random() * 100, y: Math.random() * 70, s: 4 + Math.random() * 10 }));

export default function HUD({ h, notices, minimapRef, mirrors, onPause, onMap, compact }: { h: HudState | null; notices: Notice[]; minimapRef: RefObject<HTMLCanvasElement | null>; mirrors: boolean; onPause: () => void; onMap: () => void; compact: boolean }) {
  const glassRain = h && (h.camera === 'driver' || h.camera === 'interior') && (h.weather === 'rain' || h.weather === 'storm');
  const drops = useMemo(() => DROPS, []);
  if (!h) return null;
  const mm = compact ? 150 : 200;
  return (
    <div className="absolute inset-0 pointer-events-none text-white">
      {glassRain && (
        <div className="absolute inset-0 overflow-hidden" style={{ opacity: h.wipers ? 0.25 : 0.75, transition: 'opacity .5s' }}>
          {drops.map((d, i) => <div key={i} className="absolute rounded-full" style={{ left: `${d.x}%`, top: `${d.y}%`, width: d.s, height: d.s * 1.2, background: 'radial-gradient(circle at 35% 30%, rgba(255,255,255,.55), rgba(180,200,220,.12) 60%, transparent 70%)' }} />)}
        </div>
      )}
      {mirrors && h.camera === 'driver' && MIRROR_RECTS.map((m, i) => (
        <div key={i} className="absolute rounded-xl" style={{ left: `${m.x * 100}%`, top: `${m.y * 100}%`, width: `${m.w * 100}%`, height: `${m.h * 100}%`, border: '5px solid #111', boxShadow: '0 4px 18px rgba(0,0,0,.6), inset 0 0 12px rgba(255,255,255,.15)' }} />
      ))}

      {/* top-left route card */}
      <div className="absolute top-3 left-3 glass rounded-2xl p-3 w-[min(320px,42vw)] slide-in">
        <div className="text-[11px] uppercase tracking-wider text-amber-300/90 font-semibold truncate">{h.routeName}</div>
        <div className="flex items-baseline gap-2 mt-0.5">
          <div className="text-base font-bold truncate">🚏 {h.nextStop}</div>
        </div>
        {h.nextStopHindi && <div className="text-xs text-white/60 -mt-0.5">{h.nextStopHindi} • {fmtDist(h.distToStop)}</div>}
        {h.stopCount > 0 && (
          <div className="flex gap-1 mt-2">{Array.from({ length: h.stopCount }).map((_, i) => <div key={i} className={`h-1.5 flex-1 rounded-full ${i < h.stopIndex ? 'bg-emerald-400' : i === h.stopIndex ? 'bg-amber-300 blink' : 'bg-white/15'}`} />)}</div>
        )}
        {h.missionText && <div className="text-[11px] mt-2 text-sky-200/90 leading-snug">🎯 {h.missionText}</div>}
        {h.timer !== null && <div className={`mt-1 text-lg font-black tabular-nums ${h.timer < 60 ? 'text-red-400 blink' : 'text-white'}`}>⏱ {Math.floor(h.timer / 60)}:{String(Math.floor(h.timer % 60)).padStart(2, '0')}</div>}
        <div className="mt-2 text-[11px] text-white/50 truncate">📍 {h.roadName} · {h.zone}</div>
      </div>

      {/* top-right status */}
      <div className="absolute top-3 right-3 flex flex-col items-end gap-2">
        <div className="flex gap-2 pointer-events-auto">
          <button onClick={onMap} className="glass rounded-xl px-3 py-2 text-sm hover:bg-white/10">🗺️ <span className="hidden sm:inline">Map</span></button>
          <button onClick={onPause} className="glass rounded-xl px-3 py-2 text-sm hover:bg-white/10">⏸ <span className="hidden sm:inline">Pause</span></button>
        </div>
        <div className="glass rounded-2xl px-3 py-2 text-right">
          <div className="text-xl font-black text-emerald-300 tabular-nums">{fmtMoney(h.money)}</div>
          <div className={`text-[11px] tabular-nums ${h.sessionEarn >= 0 ? 'text-emerald-200/70' : 'text-red-300'}`}>this trip {h.sessionEarn >= 0 ? '+' : ''}{fmtMoney(h.sessionEarn)}</div>
          <div className="text-sm mt-1">{weatherIcon(h.weather, h.hour)} {fmtClock(h.hour)} <span className="text-white/50 text-xs">{WEATHER_LABEL[h.weather]}</span></div>
          <div className="flex gap-3 justify-end text-xs mt-1">
            <span title="Traffic violations" className={h.violations ? 'text-red-300' : 'text-white/60'}>🚨 {h.violations}</span>
            <span title="Collisions" className={h.collisions ? 'text-orange-300' : 'text-white/60'}>💥 {h.collisions}</span>
          </div>
        </div>
        {h.fps > 0 && <div className="text-[10px] text-white/40">{h.fps} fps · {CAMERA_LABELS[h.camera]}</div>}
      </div>

      {/* GPS card */}
      {h.gps && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 flex items-stretch rounded-2xl overflow-hidden shadow-2xl slide-in" style={{ maxWidth: '44vw' }}>
          <div className="bg-emerald-600 px-3 flex items-center"><GpsArrow type={h.gps.type} size={compact ? 38 : 50} /></div>
          <div className="bg-emerald-800/95 px-3 py-2 min-w-0">
            <div className="text-2xl font-black leading-none tabular-nums">{fmtDist(h.gps.dist)}</div>
            <div className="text-sm font-semibold truncate">{gpsText(h.gps.type)}{h.gps.road ? ` → ${h.gps.road}` : ''}</div>
            <div className="text-[11px] text-emerald-100/70 truncate">{fmtDist(h.gps.remaining)} · ETA {Math.ceil(h.gps.eta / 60)} min · {ROUTE_OPTION_LABEL[h.gps.option]}</div>
          </div>
        </div>
      )}

      {/* notifications */}
      <div className="absolute left-1/2 -translate-x-1/2 flex flex-col items-center gap-1.5" style={{ top: h.gps ? (compact ? 78 : 96) : 16, width: 'min(560px, 90vw)' }}>
        {notices.slice(-4).map(n => (
          <div key={n.id} className={`slide-in px-4 py-1.5 rounded-xl text-sm font-medium shadow-lg backdrop-blur ${n.kind === 'bad' ? 'bg-red-600/85' : n.kind === 'good' ? 'bg-emerald-600/85' : n.kind === 'warn' ? 'bg-amber-500/90 text-black' : 'bg-slate-800/85'}`}>{n.text}</div>
        ))}
      </div>

      {/* prompts */}
      {(h.prompt || h.boarding) && (
        <div className="absolute left-1/2 -translate-x-1/2 flex flex-col items-center gap-2" style={{ bottom: compact ? 200 : 150 }}>
          {h.boarding && <div className="px-4 py-1.5 rounded-full bg-sky-600/90 text-sm font-semibold shadow-lg">🧍 {h.boarding}</div>}
          {h.prompt && <div className="px-5 py-2 rounded-full bg-black/75 border border-amber-300/50 text-amber-200 text-sm font-semibold shadow-lg">{h.prompt}</div>}
        </div>
      )}

      {/* minimap */}
      <div className="absolute" style={{ left: 12, bottom: compact ? 190 : 12 }}>
        <div className="relative rounded-full overflow-hidden border-4 border-black/60 shadow-2xl" style={{ width: mm, height: mm }}>
          <canvas ref={minimapRef} width={mm * 1.5} height={mm * 1.5} style={{ width: mm, height: mm }} />
        </div>
        <div className="absolute -top-1 -right-1 w-12 h-12 rounded-full bg-white border-[5px] border-red-600 flex items-center justify-center text-black font-black text-lg shadow-lg" style={{ animation: h.overLimit ? 'pulse-red .6s steps(2) infinite' : undefined }}>{h.limit}</div>
        {h.signal && <div className="absolute -top-1 left-0 w-7 h-16 rounded-lg bg-black/80 flex flex-col items-center justify-around py-1 shadow-lg">
          {(['red', 'yellow', 'green'] as const).map(c => <div key={c} className="w-4 h-4 rounded-full" style={{ background: h.signal === c ? (c === 'red' ? '#ff3030' : c === 'yellow' ? '#ffb300' : '#22ff66') : '#333', boxShadow: h.signal === c ? `0 0 10px ${c === 'red' ? '#f00' : c === 'yellow' ? '#fb0' : '#0f6'}` : 'none' }} />)}
        </div>}
      </div>

      {/* bottom center dash */}
      {!compact && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 glass rounded-2xl px-4 py-2 flex items-center gap-4 text-sm">
          <span className={`text-2xl ${(h.indicator === 'left' || h.indicator === 'hazard') && h.blink ? 'text-emerald-400' : 'text-white/20'}`}>◀</span>
          <div className="flex gap-3 items-center">
            <span title="Headlights" className={h.lights ? 'text-sky-300' : 'text-white/30'}>{h.lights === 2 ? '🔆' : '💡'}</span>
            <span title="Hazard" className={h.indicator === 'hazard' ? 'text-red-400' : 'text-white/30'}>⚠️</span>
            <span title="Wipers" className={h.wipers ? 'text-sky-300' : 'text-white/30'}>🌧</span>
            <span title="Door" className={h.door ? 'text-amber-300 font-bold' : 'text-white/40'}>🚪{h.door ? ' OPEN' : ''}</span>
            {h.handbrake && <span className="text-red-400 font-bold">(P)</span>}
          </div>
          <div className="h-8 w-px bg-white/15" />
          <div className="flex flex-col leading-tight">
            <span className="font-bold">🧍 {h.passengers}/{h.seats}</span>
            <span className="text-[10px] text-white/60">😊 {Math.round(h.satisfaction)}%</span>
          </div>
          <div className="flex flex-col leading-tight w-24">
            <span className="text-[10px] text-white/60">Ride comfort</span>
            <div className="h-1.5 rounded-full bg-white/10 overflow-hidden"><div className="h-full" style={{ width: `${h.comfort}%`, background: h.comfort > 70 ? '#4ade80' : h.comfort > 45 ? '#facc15' : '#f87171' }} /></div>
          </div>
          <div className="h-8 w-px bg-white/15" />
          <span className="text-xs text-white/70 max-w-[140px] truncate">📻 {h.radio}</span>
          <span className={`text-2xl ${(h.indicator === 'right' || h.indicator === 'hazard') && h.blink ? 'text-emerald-400' : 'text-white/20'}`}>▶</span>
        </div>
      )}

      {/* speedo cluster */}
      <div className="absolute flex items-end gap-2" style={{ right: 12, bottom: compact ? 190 : 12, transform: compact ? 'scale(0.78)' : undefined, transformOrigin: 'bottom right' }}>
        <div className="glass rounded-2xl p-2.5 flex flex-col gap-1.5 mb-2">
          <Bar v={h.fuel} color={h.fuel < 0.15 ? '#ef4444' : '#f59e0b'} label={`${Math.round(h.fuelL)} L`} icon="⛽" warn={h.fuel < 0.12} />
          <Bar v={(h.temp - 50) / 70} color={h.temp > 100 ? '#ef4444' : '#38bdf8'} label={`${Math.round(h.temp)}°C`} icon="🌡️" />
          <Bar v={h.damage / 100} color={h.damage > 60 ? '#ef4444' : '#fb923c'} label={`${Math.round(h.damage)}%`} icon="🔧" warn={h.damage > 75} />
          <Bar v={h.cleanliness} color="#a3e635" label={`${Math.round(h.cleanliness * 100)}%`} icon="🧽" />
          {compact && <div className="text-[11px] text-white/80">🧍 {h.passengers}/{h.seats} · 😊 {Math.round(h.satisfaction)}%</div>}
          <div className="text-[10px] text-white/50">{h.transmission === 'auto' ? 'Automatic' : 'Manual (Shift/Z)'}</div>
        </div>
        <div className="glass rounded-full"><Speedo h={h} /></div>
      </div>
    </div>
  );
}
