import { useEffect, useMemo, useRef, useState } from 'react';
import type { Game } from '../game/engine';
import { edges, RAIL_Z, RIVER_Z, ROUTE_OPTION_LABEL, stops, WORLD_BOUNDS, type PlannedRoute, type RouteOption } from '../game/roads';
import { fmtDist } from './HUD';

const LANDMARKS: [string, number, number, string][] = [
  ['🚌', 0, -10, 'Central Bus Stand'], ['🛒', -120, 0, 'Sadar Bazaar'], ['🏥', 120, -128, 'City Hospital'], ['🏫', -140, 140, 'Govt. School'], ['🛕', 120, 120, 'Temple'],
  ['⛽', 320, 30, 'Bharat Fuels'], ['🛣️', 750, 60, 'Toll Plaza'], ['🍲', 955, 22, 'Dhaba'], ['👮', 60, -270, 'Police Check Post'],
  ['🌉', 60, -450, 'Ganga Setu'], ['🌉', 1500, -450, 'Rampur Setu'], ['🚉', -80, 500, 'Rail Crossing'], ['🚉', 1500, 500, 'Rail Crossing'], ['🏨', 360, -1340, 'Hill Resort'], ['🩺', -40, 880, 'Health Centre'],
];
const LABELS: [string, number, number][] = [['NAGAR CITY', 0, -215], ['RAMPUR', 1500, 215], ['SITAPUR', -110, 1070], ['HIMGIRI HILLS', 360, -1490], ['NH-48', 780, 100], ['GANGA RIVER', 650, -425], ['KHETPUR', 700, 980], ['HIMALAYAN GHATS', 820, -1250]];

export default function MapScreen({ game, inDrive, free, onClose }: { game: Game | null; inDrive: boolean; free: boolean; onClose: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [view, setView] = useState({ zoom: 1, cx: (WORLD_BOUNDS.minX + WORLD_BOUNDS.maxX) / 2, cz: (WORLD_BOUNDS.minZ + WORLD_BOUNDS.maxZ) / 2 });
  const [dest, setDest] = useState<string | null>(() => game?.currentTarget()?.id ?? null);
  const [opt, setOpt] = useState<RouteOption>(game?.gpsOption ?? 'fastest');
  const drag = useRef<{ x: number; y: number } | null>(null);
  const careerLocked = inDrive && !free && !!game?.routeStops.length;
  const options = useMemo<PlannedRoute[]>(() => (inDrive && game && dest ? game.planOptions(dest) : []), [inDrive, game, dest]);
  const uniq = useMemo(() => { const seen = new Set<string>(); return options.filter(o => { const k = Math.round(o.length / 20).toString(); if (seen.has(k)) return false; seen.add(k); return true; }); }, [options]);
  const chosen = options.find(o => o.option === opt) || options[0];

  useEffect(() => {
    const c = ref.current; if (!c) return;
    let raf = 0;
    const draw = () => {
      const g = c.getContext('2d')!; const W = c.clientWidth * devicePixelRatio, H = c.clientHeight * devicePixelRatio;
      if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
      const ww = WORLD_BOUNDS.maxX - WORLD_BOUNDS.minX, wh = WORLD_BOUNDS.maxZ - WORLD_BOUNDS.minZ;
      const sc = Math.min(W / ww, H / wh) * 0.95 * view.zoom;
      const X = (x: number) => W / 2 + (x - view.cx) * sc, Y = (z: number) => H / 2 + (z - view.cz) * sc;
      g.fillStyle = '#16231a'; g.fillRect(0, 0, W, H);
      // zones
      const zone = (x0: number, z0: number, x1: number, z1: number, col: string) => { g.fillStyle = col; g.fillRect(X(x0), Y(z0), (x1 - x0) * sc, (z1 - z0) * sc); };
      zone(-2000, -2500, 3000, -560, '#1f3324'); zone(-250, -250, 250, 250, '#2c2f2c'); zone(1340, -120, 1680, 240, '#2c2f2c'); zone(-320, 820, 100, 1090, '#3a3524'); zone(160, -1490, 540, -1180, '#24382c');
      g.fillStyle = '#2a6f8f'; g.fillRect(X(-2000), Y(RIVER_Z - 26), 5000 * sc, 52 * sc);
      g.strokeStyle = '#9e9e9e'; g.setLineDash([6 * devicePixelRatio, 4 * devicePixelRatio]); g.lineWidth = 2 * devicePixelRatio; g.beginPath(); g.moveTo(X(-2000), Y(RAIL_Z)); g.lineTo(X(3000), Y(RAIL_Z)); g.stroke(); g.setLineDash([]);
      g.lineCap = 'round'; g.lineJoin = 'round';
      for (const pass of [0, 1]) for (const e of edges) {
        g.strokeStyle = pass === 0 ? '#0a0f0a' : e.type === 'highway' ? '#f2c14e' : e.type === 'city' || e.type === 'town' ? '#e0e0e0' : e.type === 'mountain' ? '#d0a070' : '#b0b0b0';
        g.lineWidth = Math.max(pass === 0 ? 4 : 2, (e.width + (pass === 0 ? 4 : 0)) * sc) * (pass === 0 ? 1 : 1);
        g.beginPath(); e.pts.forEach((p, i) => (i ? g.lineTo(X(p.x), Y(p.z)) : g.moveTo(X(p.x), Y(p.z)))); g.stroke();
      }
      if (chosen) { g.strokeStyle = '#00e5ff'; g.lineWidth = Math.max(4, 6 * sc) ; g.beginPath(); chosen.pts.forEach((p, i) => (i ? g.lineTo(X(p.x), Y(p.z)) : g.moveTo(X(p.x), Y(p.z)))); g.stroke(); }
      const fs = Math.max(11, 13 * devicePixelRatio);
      g.textAlign = 'center'; g.textBaseline = 'middle';
      for (const [t, x, z] of LABELS) { g.font = `bold ${fs}px sans-serif`; g.fillStyle = 'rgba(255,255,255,0.45)'; g.fillText(t, X(x), Y(z)); }
      for (const [i, x, z] of LANDMARKS) { g.font = `${fs * 1.3}px sans-serif`; g.fillText(i, X(x), Y(z)); }
      for (const s of stops) {
        const isD = s.id === dest;
        g.fillStyle = isD ? '#22ff88' : '#42a5f5'; g.beginPath(); g.arc(X(s.sx), Y(s.sz), (isD ? 8 : 6) * devicePixelRatio, 0, 7); g.fill();
        g.strokeStyle = '#000'; g.lineWidth = 2; g.stroke();
        g.font = `bold ${fs * 0.9}px sans-serif`; g.fillStyle = '#fff'; g.strokeStyle = 'rgba(0,0,0,.8)'; g.lineWidth = 3 * devicePixelRatio;
        g.strokeText(s.name, X(s.sx), Y(s.sz) - 14 * devicePixelRatio); g.fillText(s.name, X(s.sx), Y(s.sz) - 14 * devicePixelRatio);
      }
      if (game && inDrive) {
        g.save(); g.translate(X(game.x), Y(game.z)); g.rotate(Math.atan2(Math.cos(game.heading), Math.sin(game.heading)) + Math.PI / 2);
        const k = 1.4 * devicePixelRatio;
        g.fillStyle = '#ffeb3b'; g.strokeStyle = '#000'; g.lineWidth = 2; g.beginPath(); g.moveTo(0, -10 * k); g.lineTo(7 * k, 8 * k); g.lineTo(0, 4 * k); g.lineTo(-7 * k, 8 * k); g.closePath(); g.fill(); g.stroke(); g.restore();
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [view, chosen, dest, game, inDrive]);

  const apply = () => { if (!game) return; if (free) game.setFreeTarget(dest); game.setGpsOption(opt); onClose(); };
  const pickStop = (id: string) => { if (careerLocked) return; setDest(id); };

  return (
    <div className="absolute inset-0 flex flex-col sm:flex-row bg-black/80 p-3 gap-3 pointer-events-auto">
      <div className="relative flex-1 rounded-2xl overflow-hidden border border-white/10 min-h-[45vh]">
        <canvas ref={ref} className="w-full h-full touch-none cursor-grab"
          onPointerDown={e => { drag.current = { x: e.clientX, y: e.clientY }; (e.target as HTMLElement).setPointerCapture(e.pointerId); }}
          onPointerMove={e => { if (!drag.current) return; const c = ref.current!; const ww = WORLD_BOUNDS.maxX - WORLD_BOUNDS.minX, wh = WORLD_BOUNDS.maxZ - WORLD_BOUNDS.minZ; const sc = Math.min(c.clientWidth / ww, c.clientHeight / wh) * 0.95 * view.zoom; const dx = e.clientX - drag.current.x, dy = e.clientY - drag.current.y; drag.current = { x: e.clientX, y: e.clientY }; setView(v => ({ ...v, cx: v.cx - dx / sc, cz: v.cz - dy / sc })); }}
          onPointerUp={() => { drag.current = null; }}
          onWheel={e => setView(v => ({ ...v, zoom: Math.max(0.6, Math.min(8, v.zoom * (e.deltaY < 0 ? 1.15 : 0.87))) }))} />
        <div className="absolute top-3 left-3 flex gap-2">
          <button onClick={onClose} className="glass rounded-xl px-3 py-2 text-white">← Back</button>
          <button onClick={() => setView(v => ({ ...v, zoom: Math.min(8, v.zoom * 1.4) }))} className="glass rounded-xl w-10 text-white text-lg">+</button>
          <button onClick={() => setView(v => ({ ...v, zoom: Math.max(0.6, v.zoom / 1.4) }))} className="glass rounded-xl w-10 text-white text-lg">−</button>
          {game && inDrive && <button onClick={() => setView(v => ({ ...v, cx: game.x, cz: game.z, zoom: 3 }))} className="glass rounded-xl px-3 text-white text-sm">📍 Me</button>}
        </div>
        <div className="absolute bottom-3 left-3 glass rounded-xl p-2 text-[11px] text-white/80 flex flex-wrap gap-x-3 gap-y-1 max-w-[95%]">
          <span><b className="text-yellow-300">━</b> Highway</span><span><b className="text-white">━</b> City/Town</span><span><b className="text-gray-400">━</b> Rural</span><span><b className="text-orange-300">━</b> Mountain</span><span><b className="text-sky-400">●</b> Bus stop</span><span>⛽ Petrol</span><span>🛣️ Toll</span><span>👮 Police</span><span>🚉 Railway</span><span>🌉 Bridge</span>
        </div>
      </div>
      <div className="glass rounded-2xl w-full sm:w-80 p-4 text-white overflow-y-auto scroll-thin max-h-[48vh] sm:max-h-full">
        <div className="text-lg font-black font-display">🧭 GPS Navigation</div>
        {!inDrive && <div className="text-xs text-white/60 mt-1">Start a route or free ride to plan GPS routes. Drag to pan, scroll to zoom.</div>}
        {inDrive && (
          <>
            <div className="text-[11px] text-white/50 mt-3">DESTINATION {careerLocked && '(next route stop)'}</div>
            <div className="flex flex-col gap-1 mt-1 max-h-48 overflow-y-auto scroll-thin pr-1">
              {stops.filter(s => !careerLocked || s.id === dest).map(s => (
                <button key={s.id} onClick={() => pickStop(s.id)} className={`text-left px-3 py-1.5 rounded-lg text-sm ${dest === s.id ? 'bg-emerald-500/30 border border-emerald-300/50' : 'bg-white/5 hover:bg-white/10'}`}>
                  🚏 {s.name} <span className="text-white/40 text-xs">{s.hindi}</span>
                </button>
              ))}
            </div>
            {dest && (
              <>
                <div className="text-[11px] text-white/50 mt-4">ROUTE OPTIONS</div>
                <div className="flex flex-col gap-2 mt-1">
                  {options.map(o => {
                    const dup = !uniq.includes(o);
                    return (
                      <button key={o.option} onClick={() => setOpt(o.option)} className={`text-left rounded-xl p-2.5 border ${opt === o.option ? 'bg-cyan-500/20 border-cyan-300/60' : 'bg-white/5 border-white/10 hover:bg-white/10'} ${dup ? 'opacity-60' : ''}`}>
                        <div className="flex justify-between"><span className="font-bold text-sm">{ROUTE_OPTION_LABEL[o.option]}</span><span className="text-sm tabular-nums">{fmtDist(o.length)}</span></div>
                        <div className="text-[11px] text-white/60 mt-0.5 flex gap-3">
                          <span>⏱ {Math.ceil(o.eta / 60)} min</span>
                          <span>🚗 {o.traffic > 0.6 ? 'Heavy' : o.traffic > 0.35 ? 'Moderate' : 'Light'} traffic</span>
                          <span>🛣 {o.condition > 0.75 ? 'Good' : o.condition > 0.5 ? 'Fair' : 'Poor'} road</span>
                        </div>
                        <div className="text-[10px] text-white/40 mt-0.5 truncate">via {Array.from(new Set(o.legs.map(l => l.edge.name))).slice(0, 4).join(' → ')}</div>
                      </button>
                    );
                  })}
                </div>
                <button onClick={apply} className="w-full mt-4 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-emerald-600 font-bold">Start Navigation</button>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
