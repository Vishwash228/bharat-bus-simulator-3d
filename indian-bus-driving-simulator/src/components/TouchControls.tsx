import { useRef, useState, type ReactNode } from 'react';
import type { Game } from '../game/engine';
import type { HudState } from '../game/types';

function HoldBtn({ onDown, onUp, className, children }: { onDown: () => void; onUp: () => void; className?: string; children: ReactNode }) {
  const [on, setOn] = useState(false);
  return (
    <div
      className={`select-none touch-none flex items-center justify-center ${className} ${on ? 'scale-95 brightness-125' : ''} transition-transform`}
      onPointerDown={e => { (e.target as HTMLElement).setPointerCapture(e.pointerId); setOn(true); onDown(); }}
      onPointerUp={() => { setOn(false); onUp(); }}
      onPointerCancel={() => { setOn(false); onUp(); }}
      onContextMenu={e => e.preventDefault()}
    >{children}</div>
  );
}

function Btn({ onPress, active, children, wide }: { onPress: () => void; active?: boolean; children: ReactNode; wide?: boolean }) {
  return (
    <button
      onPointerDown={e => { e.preventDefault(); onPress(); }}
      className={`${wide ? 'px-3' : 'w-11'} h-11 rounded-xl text-lg flex items-center justify-center border backdrop-blur ${active ? 'bg-amber-400/80 text-black border-amber-200' : 'bg-black/45 border-white/15 text-white'}`}
    >{children}</button>
  );
}

export default function TouchControls({ game, h }: { game: Game; h: HudState | null }) {
  const wheelRef = useRef<HTMLDivElement>(null);
  const st = useRef<{ id: number | null; start: number; base: number }>({ id: null, start: 0, base: 0 });
  const [angle, setAngle] = useState(0);
  const angleAt = (e: React.PointerEvent) => {
    const r = wheelRef.current!.getBoundingClientRect();
    return Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)) * 180 / Math.PI;
  };
  const onDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    st.current = { id: e.pointerId, start: angleAt(e), base: angle };
  };
  const onMove = (e: React.PointerEvent) => {
    if (st.current.id !== e.pointerId) return;
    let d = angleAt(e) - st.current.start; if (d > 180) d -= 360; if (d < -180) d += 360;
    const a = Math.max(-135, Math.min(135, st.current.base + d));
    setAngle(a); game.setTouch({ steer: -a / 135 });
  };
  const onUp = () => { st.current.id = null; setAngle(0); game.setTouch({ steer: null }); };

  return (
    <div className="absolute inset-x-0 bottom-0 h-[190px] pointer-events-none">
      {/* steering wheel */}
      <div className="absolute left-4 bottom-4 pointer-events-auto">
        <div ref={wheelRef} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
          className="w-40 h-40 rounded-full touch-none select-none" style={{ transform: `rotate(${angle}deg)`, transition: st.current.id === null ? 'transform .25s' : 'none' }}>
          <svg viewBox="0 0 100 100" className="w-full h-full drop-shadow-2xl">
            <circle cx="50" cy="50" r="44" fill="none" stroke="#1a1a1a" strokeWidth="9" />
            <circle cx="50" cy="50" r="44" fill="none" stroke="rgba(255,255,255,.25)" strokeWidth="1" />
            <circle cx="50" cy="50" r="13" fill="#222" stroke="#c9a400" strokeWidth="2" />
            <path d="M50 37 L50 7 M38 54 L10 62 M62 54 L90 62" stroke="#2a2a2a" strokeWidth="7" strokeLinecap="round" />
            <circle cx="50" cy="7" r="3" fill="#f59e0b" />
          </svg>
        </div>
      </div>
      {/* pedals */}
      <div className="absolute right-4 bottom-4 flex items-end gap-3 pointer-events-auto">
        <HoldBtn onDown={() => game.setTouch({ brake: 1 })} onUp={() => game.setTouch({ brake: 0 })} className="w-24 h-20 rounded-2xl bg-gradient-to-b from-zinc-600 to-zinc-800 border-2 border-zinc-400/40 text-white font-bold shadow-xl">BRAKE</HoldBtn>
        <HoldBtn onDown={() => game.setTouch({ throttle: 1 })} onUp={() => game.setTouch({ throttle: 0 })} className="w-16 h-32 rounded-2xl bg-gradient-to-b from-emerald-600 to-emerald-900 border-2 border-emerald-300/40 text-white font-bold shadow-xl text-sm">GAS</HoldBtn>
      </div>
      {/* button rows */}
      <div className="absolute left-1/2 -translate-x-1/2 bottom-3 flex flex-col items-center gap-2 pointer-events-auto">
        <div className="flex gap-1.5">
          <Btn onPress={() => game.action('ind-left')} active={h?.indicator === 'left' && h.blink}>◀</Btn>
          <Btn onPress={() => game.action('hazard')} active={h?.indicator === 'hazard'}>⚠️</Btn>
          <Btn onPress={() => game.action('ind-right')} active={h?.indicator === 'right' && h.blink}>▶</Btn>
          <Btn onPress={() => game.action('lights')} active={!!h?.lights}>💡</Btn>
          <Btn onPress={() => game.action('wipers')} active={h?.wipers}>🌧</Btn>
          <Btn onPress={() => game.action('radio')}>📻</Btn>
        </div>
        <div className="flex gap-1.5">
          <HoldBtn onDown={() => game.action('horn-down')} onUp={() => game.action('horn-up')} className="w-14 h-11 rounded-xl bg-red-600/80 border border-red-300/40 text-white text-lg">📯</HoldBtn>
          <Btn onPress={() => game.action('musical')}>🎵</Btn>
          <Btn onPress={() => game.action('door')} active={h?.door}>🚪</Btn>
          <Btn onPress={() => game.action('camera')}>🎥</Btn>
          <Btn onPress={() => game.action('refuel')}>⛽</Btn>
          {h?.transmission === 'manual' && <><Btn onPress={() => game.action('gear-down')}>−</Btn><Btn onPress={() => game.action('gear-up')}>+</Btn></>}
          <Btn onPress={() => game.action('tow')}>🛠</Btn>
        </div>
      </div>
    </div>
  );
}
