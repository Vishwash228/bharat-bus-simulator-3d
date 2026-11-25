import { store, useSettings } from '../game/save';
import type { Settings } from '../game/types';
import { Panel } from './Screens';

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5 border-b border-white/5">
      <div><div className="text-sm font-semibold">{label}</div>{hint && <div className="text-[11px] text-white/50">{hint}</div>}</div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}
function Seg<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return <div className="flex rounded-xl bg-white/10 p-0.5">{options.map(([v, l]) => <button key={v} onClick={() => onChange(v)} className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${value === v ? 'bg-amber-400 text-black' : 'text-white/80'}`}>{l}</button>)}</div>;
}
function Slider({ value, min, max, step, onChange, fmt }: { value: number; min: number; max: number; step: number; onChange: (v: number) => void; fmt?: (v: number) => string }) {
  return <div className="flex items-center gap-2"><input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(parseFloat(e.target.value))} className="w-32 sm:w-44 accent-amber-400" /><span className="text-xs w-12 text-right tabular-nums">{fmt ? fmt(value) : value}</span></div>;
}
function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return <button onClick={() => onChange(!value)} className={`w-12 h-7 rounded-full relative transition ${value ? 'bg-emerald-500' : 'bg-white/20'}`}><span className={`absolute top-1 w-5 h-5 rounded-full bg-white transition-all ${value ? 'left-6' : 'left-1'}`} /></button>;
}

export default function SettingsPanel({ onBack, inDrive, onApply }: { onBack: () => void; inDrive: boolean; onApply: (p: Partial<Settings>) => void }) {
  const s = useSettings();
  const set = (p: Partial<Settings>) => { store.updateSettings(p); onApply(p); };
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  return (
    <Panel title="Settings" sub="Graphics · Audio · Controls" onBack={onBack}>
      <div className="grid md:grid-cols-2 gap-x-8">
        <div>
          <div className="text-xs text-amber-300 font-bold tracking-wider mt-1">GRAPHICS</div>
          {!inDrive && <Row label="Graphics quality" hint="Low is best for Android phones (reloads world)"><Seg value={s.quality} options={[['low', 'Low'], ['medium', 'Medium'], ['high', 'High']]} onChange={v => set({ quality: v })} /></Row>}
          <Row label="Side mirrors" hint="Live rear-view mirrors in driver view"><Toggle value={s.mirrors} onChange={v => set({ mirrors: v })} /></Row>
          <Row label="Traffic density"><Slider value={s.trafficDensity} min={0.3} max={1.6} step={0.1} onChange={v => set({ trafficDensity: v })} fmt={pct} /></Row>
          <Row label="Day length" hint="Real minutes per game day"><Slider value={s.dayLength} min={6} max={120} step={2} onChange={v => set({ dayLength: v })} fmt={v => `${v} min`} /></Row>
          <Row label="Show FPS"><Toggle value={s.showFps} onChange={v => set({ showFps: v })} /></Row>
          <div className="text-xs text-amber-300 font-bold tracking-wider mt-5">CONTROLS</div>
          <Row label="Transmission"><Seg value={s.transmission} options={[['auto', 'Automatic'], ['manual', 'Manual']]} onChange={v => set({ transmission: v })} /></Row>
          <Row label="Steering sensitivity"><Slider value={s.steering} min={0.5} max={2} step={0.1} onChange={v => set({ steering: v })} fmt={v => `${v.toFixed(1)}x`} /></Row>
          <Row label="Touch controls" hint="Steering wheel & pedals for phones/tablets"><Seg value={s.touchControls} options={[['auto', 'Auto'], ['on', 'On'], ['off', 'Off']]} onChange={v => set({ touchControls: v })} /></Row>
        </div>
        <div>
          <div className="text-xs text-amber-300 font-bold tracking-wider mt-1">AUDIO</div>
          <Row label="Master volume"><Slider value={s.masterVolume} min={0} max={1} step={0.05} onChange={v => set({ masterVolume: v })} fmt={pct} /></Row>
          <Row label="Radio / music"><Slider value={s.musicVolume} min={0} max={1} step={0.05} onChange={v => set({ musicVolume: v })} fmt={pct} /></Row>
          <Row label="Effects & engine"><Slider value={s.sfxVolume} min={0} max={1} step={0.05} onChange={v => set({ sfxVolume: v })} fmt={pct} /></Row>
          <Row label="GPS voice guidance"><Toggle value={s.voiceGuidance} onChange={v => set({ voiceGuidance: v })} /></Row>
          <Row label="Voice announcements" hint="Bus stand & passenger speech (Hindi if available)"><Toggle value={s.speechVoices} onChange={v => set({ speechVoices: v })} /></Row>
          <div className="text-xs text-amber-300 font-bold tracking-wider mt-5">KEYBOARD</div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[12px] text-white/75 mt-2">
            {[['W / ↑', 'Accelerate'], ['S / ↓', 'Brake / reverse'], ['A D / ← →', 'Steer'], ['Space', 'Handbrake'], ['H', 'Horn (hold)'], ['J', 'Musical horn'], ['O', 'Open/close door'], ['Q / E', 'Indicators'], ['X', 'Hazard lights'], ['L', 'Headlights'], ['K', 'Wipers'], ['C, 1-5', 'Cameras'], ['R', 'Radio station'], ['M', 'Map & GPS'], ['Enter', 'Refuel at pump'], ['T', 'Tow / reset'], ['Shift / Z', 'Gear up/down'], ['Esc / P', 'Pause']].map(([k, v]) => (
              <div key={k} className="flex gap-2"><span className="px-1.5 rounded bg-white/10 font-mono text-[11px] whitespace-nowrap">{k}</span><span>{v}</span></div>
            ))}
          </div>
          {!inDrive && <button onClick={() => { if (confirm('Reset all career progress?')) store.reset(); }} className="mt-6 w-full py-2 rounded-xl bg-red-600/60 hover:bg-red-600 text-sm font-semibold">Reset career progress</button>}
        </div>
      </div>
    </Panel>
  );
}
