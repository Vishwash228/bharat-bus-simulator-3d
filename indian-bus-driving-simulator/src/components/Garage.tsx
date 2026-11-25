import { useEffect, useState } from 'react';
import { BUSES, FUEL_PRICE, UPGRADES } from '../game/data';
import { fmtMoney, store, useSave } from '../game/save';

function Stat({ label, v, max, unit }: { label: string; v: number; max: number; unit?: string }) {
  return (
    <div>
      <div className="flex justify-between text-[11px] text-white/60"><span>{label}</span><span className="text-white/90 font-semibold">{unit === '%' ? Math.round(v * 100) + '%' : `${Math.round(v * 10) / 10}${unit ?? ''}`}</span></div>
      <div className="h-1.5 rounded-full bg-white/10 overflow-hidden"><div className="h-full rounded-full bg-gradient-to-r from-sky-400 to-emerald-400" style={{ width: `${Math.min(1, v / max) * 100}%` }} /></div>
    </div>
  );
}

export default function Garage({ onBack, onPreview }: { onBack: () => void; onPreview: (id: string) => void }) {
  const save = useSave();
  const [sel, setSel] = useState(save.currentBus);
  useEffect(() => { onPreview(sel); }, [sel, onPreview]);
  const b = BUSES.find(x => x.id === sel)!;
  const owned = save.ownedBuses.includes(b.id);
  const up = save.upgrades[b.id];
  const dmg = save.damage[b.id] ?? 0, fuel = save.fuel[b.id] ?? 1, clean = save.cleanliness[b.id] ?? 1;
  const repairCost = Math.round(dmg * 160), fuelCost = Math.round((1 - fuel) * b.tank * FUEL_PRICE), cleanCost = clean < 0.99 ? 600 : 0;
  const buy = () => store.updateSave(s => { if (s.money >= b.price && !s.ownedBuses.includes(b.id)) { s.money -= b.price; s.ownedBuses.push(b.id); s.currentBus = b.id; } });
  const pay = (cost: number, fn: (s: typeof save) => void) => store.updateSave(s => { if (s.money >= cost) { s.money -= cost; fn(s); } });

  return (
    <div className="absolute inset-0 flex flex-col sm:flex-row justify-between p-3 sm:p-5 gap-3 pointer-events-none">
      <div className="glass rounded-3xl p-4 w-full sm:w-80 flex flex-col pointer-events-auto max-h-[45vh] sm:max-h-full overflow-hidden slide-in">
        <div className="flex items-center gap-3 mb-3">
          <button onClick={onBack} className="w-10 h-10 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xl">←</button>
          <div><div className="text-xl font-black text-white font-display">Bus Garage</div><div className="text-xs text-emerald-300">{fmtMoney(save.money)}</div></div>
        </div>
        <div className="overflow-y-auto scroll-thin flex flex-col gap-2 pr-1">
          {BUSES.map(x => {
            const o = save.ownedBuses.includes(x.id);
            return (
              <button key={x.id} onClick={() => setSel(x.id)} className={`text-left rounded-2xl p-3 border transition ${sel === x.id ? 'bg-amber-400/20 border-amber-300/60' : 'bg-white/5 border-white/10 hover:bg-white/10'}`}>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-6 rounded" style={{ background: `linear-gradient(180deg, ${x.roof} 0 30%, ${x.body} 30% 70%, ${x.stripe} 70%)` }} />
                  <div className="flex-1">
                    <div className="font-bold text-white text-sm">{x.name}</div>
                    <div className="text-[11px] text-white/50">{x.seats} seats · {x.topSpeed} km/h</div>
                  </div>
                  <div className="text-xs">{save.currentBus === x.id ? <span className="text-emerald-300">● Driving</span> : o ? <span className="text-white/60">Owned</span> : <span className="text-amber-300">{fmtMoney(x.price)}</span>}</div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="glass rounded-3xl p-4 w-full sm:w-96 pointer-events-auto overflow-y-auto scroll-thin max-h-[52vh] sm:max-h-full text-white slide-in">
        <div className="text-2xl font-black font-display">{b.name}</div>
        <div className="text-xs text-amber-300">{b.operator} · {b.style.toUpperCase()}</div>
        <div className="text-xs text-white/65 mt-1">{b.description}</div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 mt-3">
          <Stat label="Top speed" v={b.topSpeed + (up?.engine ?? 0) * 6} max={130} unit=" km/h" />
          <Stat label="Power" v={b.power * (1 + 0.12 * (up?.engine ?? 0))} max={3.4} />
          <Stat label="Brakes" v={b.brake * (1 + 0.12 * (up?.brakes ?? 0))} max={11} />
          <Stat label="Comfort" v={Math.min(1, b.comfort + (up?.comfort ?? 0) * 0.05 + (up?.suspension ?? 0) * 0.03)} max={1} unit="%" />
          <Stat label="Seats" v={b.seats} max={50} />
          <Stat label="Fuel tank" v={b.tank} max={280} unit=" L" />
          <Stat label="Fare multiplier" v={b.fareMul} max={2} unit="x" />
          <Stat label="Efficiency" v={1 / b.efficiency} max={1.3} />
        </div>
        {!owned ? (
          <button onClick={buy} disabled={save.money < b.price} className={`w-full mt-4 py-3 rounded-xl font-bold ${save.money >= b.price ? 'bg-gradient-to-r from-amber-500 to-orange-600 text-black' : 'bg-white/10 text-white/40'}`}>Buy for {fmtMoney(b.price)}</button>
        ) : (
          <>
            {save.currentBus !== b.id && <button onClick={() => store.updateSave(s => { s.currentBus = b.id; })} className="w-full mt-4 py-2.5 rounded-xl font-bold bg-gradient-to-r from-emerald-500 to-emerald-700">Select as active bus</button>}
            <div className="mt-4 font-bold text-sm">⬆️ Upgrades</div>
            <div className="space-y-2 mt-2">
              {UPGRADES.map(u => {
                const lvl = up[u.key]; const cost = u.costs[lvl];
                return (
                  <div key={u.key} className="rounded-xl bg-white/5 p-2.5 flex items-center gap-2">
                    <div className="text-xl">{u.icon}</div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold">{u.name} <span className="text-amber-300 text-xs">{'▮'.repeat(lvl)}<span className="text-white/20">{'▮'.repeat(3 - lvl)}</span></span></div>
                      <div className="text-[10px] text-white/50">{u.desc}</div>
                    </div>
                    {lvl < 3 ? (
                      <button disabled={save.money < cost} onClick={() => pay(cost, s => { s.upgrades[b.id][u.key]++; })} className={`px-2.5 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap ${save.money >= cost ? 'bg-amber-400 text-black' : 'bg-white/10 text-white/40'}`}>{fmtMoney(cost)}</button>
                    ) : <span className="text-xs text-emerald-300">MAX</span>}
                  </div>
                );
              })}
            </div>
            <div className="mt-4 font-bold text-sm">🛠️ Maintenance</div>
            <div className="grid grid-cols-3 gap-2 mt-2 text-xs">
              <button disabled={!repairCost || save.money < repairCost} onClick={() => pay(repairCost, s => { s.damage[b.id] = 0; })} className="rounded-xl bg-white/5 hover:bg-white/10 p-2 disabled:opacity-40">🔧 Repair<br /><b>{Math.round(dmg)}%</b><br />{repairCost ? fmtMoney(repairCost) : 'OK'}</button>
              <button disabled={!fuelCost || save.money < fuelCost} onClick={() => pay(fuelCost, s => { s.fuel[b.id] = 1; })} className="rounded-xl bg-white/5 hover:bg-white/10 p-2 disabled:opacity-40">⛽ Refuel<br /><b>{Math.round(fuel * 100)}%</b><br />{fuelCost ? fmtMoney(fuelCost) : 'Full'}</button>
              <button disabled={!cleanCost || save.money < cleanCost} onClick={() => pay(cleanCost, s => { s.cleanliness[b.id] = 1; })} className="rounded-xl bg-white/5 hover:bg-white/10 p-2 disabled:opacity-40">🧽 Wash<br /><b>{Math.round(clean * 100)}%</b><br />{cleanCost ? fmtMoney(cleanCost) : 'Clean'}</button>
            </div>
          </>
        )}
        <div className="text-[10px] text-white/40 mt-3 text-center">Drag on the screen to rotate the camera</div>
      </div>
    </div>
  );
}
