import { useMemo, useState, type ReactNode } from 'react';
import { BUSES, COMPANY_TIERS, companyTier, MISSIONS, ROUTES, busById } from '../game/data';
import { stopById, stopDistance } from '../game/roads';
import { fmtMoney, store, useSave } from '../game/save';
import type { LaunchConfig, RouteResult, Weather } from '../game/types';

export function Panel({ title, sub, onBack, children, wide }: { title: string; sub?: string; onBack: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center p-3 sm:p-6 bg-gradient-to-br from-black/70 via-black/50 to-black/30">
      <div className={`glass rounded-3xl w-full ${wide ? 'max-w-6xl' : 'max-w-4xl'} max-h-full flex flex-col overflow-hidden slide-in`}>
        <div className="flex items-center gap-3 px-5 py-4 border-b border-white/10">
          <button onClick={onBack} className="w-10 h-10 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xl">←</button>
          <div>
            <div className="text-xl sm:text-2xl font-black text-white font-display">{title}</div>
            {sub && <div className="text-xs text-white/60">{sub}</div>}
          </div>
        </div>
        <div className="overflow-y-auto scroll-thin p-4 sm:p-5 text-white">{children}</div>
      </div>
    </div>
  );
}

export function MainMenu({ onNav }: { onNav: (s: string) => void }) {
  const save = useSave();
  const tier = companyTier(save.reputation);
  const items: [string, string, string, string][] = [
    ['start', '▶', 'Start Game', 'Continue your career'],
    ['career', '💼', 'Career', 'Routes & company'],
    ['free', '🛣️', 'Free Ride', 'Drive anywhere'],
    ['garage', '🔧', 'Bus Garage', 'Buy & upgrade'],
    ['map', '🗺️', 'Map', 'Explore the world'],
    ['missions', '🏆', 'Missions', `${save.missionsDone.length}/${MISSIONS.length} completed`],
    ['settings', '⚙️', 'Settings', 'Graphics, audio, controls'],
  ];
  return (
    <div className="absolute inset-0 flex flex-col sm:flex-row bg-gradient-to-r from-black/85 via-black/45 to-transparent">
      <div className="flex flex-col justify-center px-6 sm:px-12 py-6 gap-5 sm:w-[460px]">
        <div className="slide-in">
          <div className="text-xs tracking-[0.35em] text-amber-300/80 font-semibold">PREMIUM DRIVING SIMULATOR</div>
          <h1 className="text-4xl sm:text-6xl font-black leading-[0.95] font-display mt-1">
            <span className="tricolor-text">BHARAT</span><br /><span className="text-white">BUS SIM</span>
          </h1>
          <div className="text-white/70 text-lg mt-1">भारत बस सिम्युलेटर</div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-1 gap-2">
          {items.map(([id, icon, label, sub], i) => (
            <button key={id} onClick={() => onNav(id)}
              className={`group text-left flex items-center gap-3 rounded-2xl px-4 py-2.5 transition-all border ${i === 0 ? 'bg-gradient-to-r from-amber-500 to-orange-600 border-amber-300/60 text-black shadow-lg shadow-orange-900/40 col-span-2 sm:col-span-1' : 'bg-white/5 hover:bg-white/15 border-white/10 text-white'} hover:translate-x-1`}>
              <span className="text-2xl w-8 text-center">{icon}</span>
              <span className="flex flex-col"><span className="font-bold text-base leading-tight">{label}</span><span className={`text-[11px] ${i === 0 ? 'text-black/70' : 'text-white/50'}`}>{sub}</span></span>
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1" />
      <div className="sm:self-end m-4 sm:m-8 glass rounded-2xl p-4 text-white w-auto sm:w-80 slide-in">
        <div className="flex items-center gap-3">
          <div className="text-4xl">{tier.icon}</div>
          <div>
            <div className="font-bold">{save.companyName}</div>
            <div className="text-xs text-amber-300">{tier.name}</div>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
          <div className="bg-white/5 rounded-xl p-2"><div className="text-[10px] text-white/50">BALANCE</div><div className="font-bold text-emerald-300">{fmtMoney(save.money)}</div></div>
          <div className="bg-white/5 rounded-xl p-2"><div className="text-[10px] text-white/50">FLEET</div><div className="font-bold">{save.ownedBuses.length} bus{save.ownedBuses.length > 1 ? 'es' : ''}</div></div>
          <div className="bg-white/5 rounded-xl p-2"><div className="text-[10px] text-white/50">PASSENGERS</div><div className="font-bold">{save.stats.passengers}</div></div>
          <div className="bg-white/5 rounded-xl p-2"><div className="text-[10px] text-white/50">DRIVING</div><div className="font-bold">{busById(save.currentBus).name}</div></div>
        </div>
        <div className="mt-3 text-[10px] text-white/50">REPUTATION {Math.round(save.reputation)}/100</div>
        <div className="h-2 rounded-full bg-white/10 overflow-hidden"><div className="h-full bg-gradient-to-r from-amber-400 to-emerald-400" style={{ width: `${save.reputation}%` }} /></div>
        <div className="mt-3 text-[10px] text-white/40 leading-relaxed hidden sm:block">W/S throttle·brake · A/D steer · H horn · J musical horn · O door · Q/E indicators · C camera · M map · L lights · K wipers · R radio</div>
      </div>
    </div>
  );
}

const WEATHERS: (Weather | 'dynamic')[] = ['dynamic', 'clear', 'cloudy', 'rain', 'fog', 'storm'];
const TIMES: [string, number | undefined][] = [['Current', undefined], ['Dawn', 6], ['Morning', 9], ['Noon', 13], ['Sunset', 17.8], ['Night', 21.5]];

export function TripOptions({ weather, setWeather, hour, setHour }: { weather: Weather | 'dynamic'; setWeather: (w: Weather | 'dynamic') => void; hour: number | undefined; setHour: (h: number | undefined) => void }) {
  return (
    <div className="flex flex-wrap gap-4 mb-4">
      <div>
        <div className="text-[11px] text-white/50 mb-1">WEATHER</div>
        <div className="flex flex-wrap gap-1">{WEATHERS.map(w => <button key={w} onClick={() => setWeather(w)} className={`px-2.5 py-1 rounded-lg text-xs capitalize ${weather === w ? 'bg-amber-400 text-black font-bold' : 'bg-white/10'}`}>{w === 'dynamic' ? '🔄 Dynamic' : w}</button>)}</div>
      </div>
      <div>
        <div className="text-[11px] text-white/50 mb-1">TIME OF DAY</div>
        <div className="flex flex-wrap gap-1">{TIMES.map(([l, h]) => <button key={l} onClick={() => setHour(h)} className={`px-2.5 py-1 rounded-lg text-xs ${hour === h ? 'bg-amber-400 text-black font-bold' : 'bg-white/10'}`}>{l}</button>)}</div>
      </div>
    </div>
  );
}

export function CareerScreen({ onBack, onStart }: { onBack: () => void; onStart: (c: LaunchConfig) => void }) {
  const save = useSave();
  const [weather, setWeather] = useState<Weather | 'dynamic'>('dynamic');
  const [hour, setHour] = useState<number | undefined>(undefined);
  const dists = useMemo(() => Object.fromEntries(ROUTES.map(r => { let d = 0; for (let i = 0; i < r.stops.length - 1; i++) d += stopDistance(stopById(r.stops[i]), stopById(r.stops[i + 1])); return [r.id, d]; })), []);
  const tier = companyTier(save.reputation);
  const nextTier = COMPANY_TIERS.find(t => t.rep > save.reputation);
  const unlock = (id: string, cost: number) => store.updateSave(s => { if (s.money >= cost && !s.unlockedRoutes.includes(id)) { s.money -= cost; s.unlockedRoutes.push(id); } });
  return (
    <Panel title="Career Mode" sub="Complete routes · earn money · grow your bus company" onBack={onBack} wide>
      <div className="grid lg:grid-cols-[1fr_280px] gap-5">
        <div>
          <TripOptions weather={weather} setWeather={setWeather} hour={hour} setHour={setHour} />
          <div className="grid sm:grid-cols-2 gap-3">
            {ROUTES.map(r => {
              const unlocked = save.unlockedRoutes.includes(r.id);
              const canUnlock = save.money >= r.unlockCost && save.reputation >= r.repReq;
              const km = dists[r.id] / 1000;
              const best = save.routeBest[r.id] || 0;
              return (
                <div key={r.id} className={`rounded-2xl p-4 border ${unlocked ? 'bg-white/5 border-white/10' : 'bg-black/30 border-white/5'}`} style={{ borderLeft: `4px solid ${r.color}` }}>
                  <div className="flex justify-between items-start gap-2">
                    <div>
                      <div className="font-bold">{r.name}</div>
                      <div className="text-xs text-white/50">{r.hindi} · {r.region}</div>
                    </div>
                    <div className="text-amber-300 text-sm whitespace-nowrap">{'★'.repeat(best)}<span className="text-white/20">{'★'.repeat(5 - best)}</span></div>
                  </div>
                  <div className="text-xs text-white/70 mt-2 leading-snug">{r.description}</div>
                  <div className="text-[11px] text-white/50 mt-2 leading-snug">{r.stops.map(s => stopById(s).name).join(' → ')}</div>
                  <div className="flex gap-3 text-xs mt-2 text-white/80">
                    <span>📏 {km.toFixed(1)} km</span><span>🚏 {r.stops.length} stops</span><span>💰 ~{fmtMoney(1200 + km * 1800 + km * 900)}</span>
                  </div>
                  <div className="mt-3">
                    {unlocked ? (
                      <button onClick={() => onStart({ mode: 'career', routeId: r.id, weather, hour })} className="w-full py-2 rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-700 font-bold hover:brightness-110">▶ Drive Route {save.routeRuns[r.id] ? `(${save.routeRuns[r.id]} runs)` : ''}</button>
                    ) : (
                      <button disabled={!canUnlock} onClick={() => unlock(r.id, r.unlockCost)} className={`w-full py-2 rounded-xl font-bold ${canUnlock ? 'bg-amber-500 text-black hover:brightness-110' : 'bg-white/10 text-white/40'}`}>
                        🔒 Unlock {fmtMoney(r.unlockCost)} {save.reputation < r.repReq ? `· needs ${r.repReq} rep` : ''}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div className="space-y-3">
          <div className="rounded-2xl bg-gradient-to-br from-amber-500/20 to-orange-700/20 border border-amber-400/30 p-4">
            <div className="text-4xl">{tier.icon}</div>
            <div className="font-black text-lg mt-1">{save.companyName}</div>
            <div className="text-amber-300 text-sm">{tier.name}</div>
            <div className="mt-3 text-[10px] text-white/50">REPUTATION {Math.round(save.reputation)}/100 {nextTier && `· next: ${nextTier.name} at ${nextTier.rep}`}</div>
            <div className="h-2 rounded-full bg-white/10 overflow-hidden"><div className="h-full bg-gradient-to-r from-amber-400 to-emerald-400" style={{ width: `${save.reputation}%` }} /></div>
          </div>
          <div className="rounded-2xl bg-white/5 p-4 text-sm space-y-1.5">
            <div className="font-bold mb-2">📊 Company Stats</div>
            {[['Balance', fmtMoney(save.money)], ['Total earnings', fmtMoney(save.stats.earnings)], ['Routes completed', save.stats.routes], ['Passengers carried', save.stats.passengers], ['Distance driven', `${save.stats.distanceKm.toFixed(1)} km`], ['Accidents', save.stats.accidents], ['Violations', save.stats.violations], ['Fines paid', fmtMoney(save.stats.fines)]].map(([k, v]) => (
              <div key={String(k)} className="flex justify-between"><span className="text-white/60">{k}</span><span className="font-semibold">{v}</span></div>
            ))}
          </div>
          <div className="rounded-2xl bg-white/5 p-4 text-sm">
            <div className="font-bold mb-1">🚌 Fleet ({save.ownedBuses.length}/{BUSES.length})</div>
            {save.ownedBuses.map(b => <div key={b} className="text-white/70 text-xs">• {busById(b).name}{b === save.currentBus ? ' (driving)' : ''}</div>)}
            <div className="text-[11px] text-white/50 mt-2">Each extra bus in your fleet earns ₹1,500 passive income per completed route.</div>
          </div>
        </div>
      </div>
    </Panel>
  );
}

export function MissionsScreen({ onBack, onStart }: { onBack: () => void; onStart: (c: LaunchConfig) => void }) {
  const save = useSave();
  return (
    <Panel title="Missions" sub="Special challenges with big rewards" onBack={onBack} wide>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {MISSIONS.map((m, i) => {
          const done = save.missionsDone.includes(m.id);
          return (
            <div key={m.id} className={`rounded-2xl p-4 border flex flex-col ${done ? 'bg-emerald-900/30 border-emerald-400/30' : 'bg-white/5 border-white/10'}`}>
              <div className="flex justify-between"><div className="text-3xl">{m.icon}</div><div className="text-xs text-white/40">#{i + 1}</div></div>
              <div className="font-bold mt-2">{m.title}</div>
              <div className="text-xs text-white/65 mt-1 flex-1 leading-snug">{m.desc}</div>
              <div className="flex flex-wrap gap-1 mt-2 text-[10px]">
                {m.weather && <span className="px-1.5 py-0.5 rounded bg-sky-500/20 capitalize">{m.weather}</span>}
                {m.timeLimit && <span className="px-1.5 py-0.5 rounded bg-red-500/20">{Math.round(m.timeLimit / 60)} min</span>}
                {m.maxCollisions === 0 && <span className="px-1.5 py-0.5 rounded bg-orange-500/20">No crash</span>}
                {m.maxViolations === 0 && <span className="px-1.5 py-0.5 rounded bg-yellow-500/20">No violations</span>}
              </div>
              <div className="flex items-center justify-between mt-3">
                <div className="text-emerald-300 font-bold text-sm">{fmtMoney(m.reward)}</div>
                {done && <div className="text-emerald-300 text-xs">✓ Completed</div>}
              </div>
              <button onClick={() => onStart({ mode: m.paxTarget ? 'free' : 'mission', missionId: m.id })} className="mt-2 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 text-black font-bold hover:brightness-110">{done ? 'Replay' : 'Start'}</button>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

export function ResultScreen({ r, onContinue, onRetry }: { r: RouteResult; onContinue: () => void; onRetry: () => void }) {
  const rows: [string, number, string][] = [
    ['Passenger fares', r.fares, 'text-emerald-300'], ['Route bonuses', r.bonus, 'text-emerald-300'], ['Mission reward', r.missionReward, 'text-amber-300'],
    ['Fines & compensation', -r.fines, 'text-red-300'], ['Fuel, tolls & recovery', -r.repairs, 'text-red-300'],
  ];
  return (
    <div className="absolute inset-0 flex items-center justify-center p-4 bg-black/60">
      <div className="glass rounded-3xl w-full max-w-lg p-6 text-white slide-in">
        <div className="text-center">
          <div className="text-5xl">{r.success ? '🏆' : '😞'}</div>
          <div className="text-2xl font-black mt-2 font-display">{r.success ? 'Journey Complete!' : 'Journey Ended'}</div>
          <div className="text-white/60 text-sm">{r.title}{r.reason ? ` — ${r.reason}` : ''}</div>
          <div className="text-4xl text-amber-300 mt-3 tracking-widest">{'★'.repeat(r.stars)}<span className="text-white/15">{'★'.repeat(5 - r.stars)}</span></div>
        </div>
        <div className="grid grid-cols-4 gap-2 mt-5 text-center">
          {[['🧍', r.passengers, 'passengers'], ['😊', `${r.satisfaction}%`, 'satisfaction'], ['💥', r.collisions, 'collisions'], ['🚨', r.violations, 'violations']].map(([i, v, l]) => (
            <div key={String(l)} className="bg-white/5 rounded-xl p-2"><div className="text-lg">{i}</div><div className="font-bold">{v}</div><div className="text-[10px] text-white/50">{l}</div></div>
          ))}
        </div>
        <div className="mt-4 space-y-1.5 text-sm">
          {rows.filter(x => x[1] !== 0).map(([k, v, c]) => <div key={k} className="flex justify-between"><span className="text-white/70">{k}</span><span className={`font-semibold tabular-nums ${c}`}>{v >= 0 ? '+' : '−'}{fmtMoney(Math.abs(v))}</span></div>)}
          <div className="border-t border-white/10 pt-2 flex justify-between text-lg font-black"><span>Total</span><span className={r.total >= 0 ? 'text-emerald-300' : 'text-red-300'}>{r.total >= 0 ? '+' : '−'}{fmtMoney(Math.abs(r.total))}</span></div>
          <div className="text-[11px] text-white/50 text-center">{r.distanceKm.toFixed(2)} km in {Math.floor(r.timeSec / 60)}m {Math.floor(r.timeSec % 60)}s</div>
        </div>
        <div className="flex gap-2 mt-5">
          <button onClick={onRetry} className="flex-1 py-3 rounded-xl bg-white/10 hover:bg-white/20 font-bold">↻ Drive Again</button>
          <button onClick={onContinue} className="flex-1 py-3 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 text-black font-bold">Continue</button>
        </div>
      </div>
    </div>
  );
}

export function PauseMenu({ onResume, onMap, onSettings, onRestart, onQuit, free, onWeather, onHour }: { onResume: () => void; onMap: () => void; onSettings: () => void; onRestart: () => void; onQuit: () => void; free: boolean; onWeather: (w: Weather | 'dynamic') => void; onHour: (h: number) => void }) {
  const [w, setW] = useState<Weather | 'dynamic'>('dynamic');
  const [h, setH] = useState<number | undefined>(undefined);
  return (
    <div className="absolute inset-0 flex items-center justify-center p-4 bg-black/60 pointer-events-auto">
      <div className="glass rounded-3xl w-full max-w-md p-6 text-white slide-in">
        <div className="text-2xl font-black text-center font-display">⏸ Paused</div>
        <div className="flex flex-col gap-2 mt-5">
          <button onClick={onResume} className="py-3 rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-700 font-bold">▶ Resume</button>
          <button onClick={onMap} className="py-2.5 rounded-xl bg-white/10 hover:bg-white/20 font-semibold">🗺️ Map & GPS Routes</button>
          <button onClick={onSettings} className="py-2.5 rounded-xl bg-white/10 hover:bg-white/20 font-semibold">⚙️ Settings</button>
          <button onClick={onRestart} className="py-2.5 rounded-xl bg-white/10 hover:bg-white/20 font-semibold">↻ Restart</button>
          <button onClick={onQuit} className="py-2.5 rounded-xl bg-red-600/70 hover:bg-red-600 font-semibold">{free ? '🏁 End Free Ride' : '✖ Abandon Route'}</button>
        </div>
        {free && <div className="mt-5"><TripOptions weather={w} setWeather={x => { setW(x); onWeather(x); }} hour={h} setHour={x => { setH(x); if (x !== undefined) onHour(x); }} /></div>}
        <div className="mt-3 text-[11px] text-white/50 leading-relaxed">
          <b className="text-white/70">Controls:</b> W/↑ accelerate · S/↓ brake & reverse · A/D steer · Space handbrake · H horn · J musical horn · O door · Q/E indicators · X hazard · L headlights · K wipers · C or 1-5 cameras · R radio · M map · Enter refuel · T tow/reset · Shift/Z gears (manual) · drag mouse to look around
        </div>
      </div>
    </div>
  );
}
