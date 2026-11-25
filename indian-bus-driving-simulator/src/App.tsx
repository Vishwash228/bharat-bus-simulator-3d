import { useCallback, useEffect, useRef, useState } from 'react';
import { audio, Game } from './game/engine';
import { store, useSave, useSettings } from './game/save';
import type { HudState, LaunchConfig, Notice, RouteResult, Settings } from './game/types';
import HUD from './components/HUD';
import TouchControls from './components/TouchControls';
import { CareerScreen, MainMenu, MissionsScreen, PauseMenu, ResultScreen } from './components/Screens';
import Garage from './components/Garage';
import SettingsPanel from './components/SettingsPanel';
import MapScreen from './components/MapScreen';

type Screen = 'loading' | 'menu' | 'career' | 'garage' | 'missions' | 'settings' | 'map' | 'drive' | 'result';

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const minimapRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<Game | null>(null);
  const [screen, setScreen] = useState<Screen>('loading');
  const [hud, setHud] = useState<HudState | null>(null);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [overlay, setOverlay] = useState<null | 'pause' | 'map' | 'settings'>(null);
  const [result, setResult] = useState<RouteResult | null>(null);
  const [lastCfg, setLastCfg] = useState<LaunchConfig | null>(null);
  const [gameKey, setGameKey] = useState(0);
  const [progress, setProgress] = useState('Preparing roads…');
  const settings = useSettings();
  useSave();
  const screenRef = useRef(screen); screenRef.current = screen;
  const overlayRef = useRef(overlay); overlayRef.current = overlay;
  const noticeId = useRef(0);

  const pushNotice = useCallback((text: string, kind: Notice['kind']) => {
    const id = ++noticeId.current;
    setNotices(n => [...n.slice(-5), { id, text, kind, t: Date.now() }]);
    setTimeout(() => setNotices(n => n.filter(x => x.id !== id)), kind === 'bad' ? 5000 : 4000);
  }, []);

  const openOverlay = useCallback((o: null | 'pause' | 'map' | 'settings') => {
    setOverlay(o);
    gameRef.current?.setPaused(o !== null);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    setScreen('loading'); setProgress('Building Bharat… roads, villages & mountains');
    let game: Game | null = null;
    const t = setTimeout(() => {
      try {
        game = new Game(canvas, {
          hud: h => setHud(h),
          notice: pushNotice,
          finish: r => { setResult(r); setScreen('result'); setOverlay(null); },
          ui: w => {
            if (screenRef.current !== 'drive') return;
            if (w === 'pause') openOverlay(overlayRef.current ? null : 'pause');
            else openOverlay(overlayRef.current === 'map' ? null : 'map');
          },
        });
        gameRef.current = game;
        setScreen('menu');
      } catch (e) {
        console.error(e); setProgress('WebGL failed to start. Please use a modern browser with hardware acceleration.');
      }
    }, 60);
    return () => { clearTimeout(t); game?.dispose(); gameRef.current = null; };
  }, [gameKey, pushNotice, openOverlay]);

  useEffect(() => { if (gameRef.current) gameRef.current.minimap = minimapRef.current; });

  useEffect(() => {
    const onVis = () => { if (document.hidden && screenRef.current === 'drive' && !overlayRef.current) openOverlay('pause'); };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [openOverlay]);

  const start = (cfg: LaunchConfig) => {
    const g = gameRef.current; if (!g) return;
    audio.init();
    setLastCfg(cfg); setResult(null); setHud(null); setNotices([]);
    g.start(cfg); setOverlay(null); g.setPaused(false); setScreen('drive');
  };
  const toMenu = (s: Screen = 'menu') => { gameRef.current?.showMenu(); setOverlay(null); setScreen(s); };
  const nav = (s: string) => {
    audio.init();
    if (s === 'start') setScreen('career');
    else if (s === 'free') start({ mode: 'free', weather: 'dynamic' });
    else setScreen(s as Screen);
  };
  const applySettings = (p: Partial<Settings>) => {
    gameRef.current?.applySettings();
    if (p.quality) setGameKey(k => k + 1);
  };
  const preview = useCallback((id: string) => gameRef.current?.showGarage(id), []);

  const touch = settings.touchControls === 'on' || (settings.touchControls === 'auto' && typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0));
  const g = gameRef.current;
  const free = !!g && !g.routeStops.length;

  return (
    <div className="fixed inset-0 bg-black overflow-hidden select-none">
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full block" />

      {screen === 'loading' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-b from-[#0b1020] to-black text-white">
          <div className="text-6xl floaty">🚌</div>
          <div className="text-4xl font-black mt-4 font-display"><span className="tricolor-text">BHARAT</span> BUS SIM</div>
          <div className="text-white/60 mt-2">{progress}</div>
          <div className="w-64 h-1.5 rounded-full bg-white/10 mt-5 overflow-hidden"><div className="h-full w-1/2 bg-gradient-to-r from-orange-400 via-white to-green-500 animate-pulse" /></div>
        </div>
      )}

      {screen === 'menu' && <MainMenu onNav={nav} />}
      {screen === 'career' && <CareerScreen onBack={() => setScreen('menu')} onStart={start} />}
      {screen === 'missions' && <MissionsScreen onBack={() => setScreen('menu')} onStart={start} />}
      {screen === 'garage' && <Garage onBack={() => toMenu('menu')} onPreview={preview} />}
      {screen === 'settings' && <SettingsPanel onBack={() => setScreen('menu')} inDrive={false} onApply={applySettings} />}
      {screen === 'map' && <MapScreen game={g} inDrive={false} free={false} onClose={() => setScreen('menu')} />}

      {screen === 'drive' && g && (
        <>
          <HUD h={hud ? { ...hud, fps: settings.showFps ? hud.fps : 0 } : null} notices={notices} minimapRef={minimapRef} mirrors={settings.mirrors && settings.quality !== 'low'} compact={touch}
            onPause={() => openOverlay('pause')} onMap={() => openOverlay('map')} />
          {touch && !overlay && <TouchControls game={g} h={hud} />}
          {overlay === 'pause' && (
            <PauseMenu free={free} onResume={() => openOverlay(null)} onMap={() => openOverlay('map')} onSettings={() => openOverlay('settings')}
              onRestart={() => lastCfg && start(lastCfg)} onQuit={() => { g.setPaused(false); setOverlay(null); g.quit(); }}
              onWeather={w => g.setWeather(w)} onHour={h => g.setHour(h)} />
          )}
          {overlay === 'map' && <MapScreen game={g} inDrive free={free} onClose={() => openOverlay(null)} />}
          {overlay === 'settings' && <div className="absolute inset-0 pointer-events-auto"><SettingsPanel onBack={() => openOverlay('pause')} inDrive onApply={applySettings} /></div>}
        </>
      )}

      {screen === 'result' && result && <ResultScreen r={result} onRetry={() => lastCfg && start(lastCfg)} onContinue={() => toMenu(result.missionId ? 'missions' : lastCfg?.mode === 'career' ? 'career' : 'menu')} />}

      {screen !== 'drive' && screen !== 'loading' && (
        <div className="absolute bottom-2 right-3 text-[10px] text-white/30 pointer-events-none">v1.0 · {store.settings.quality} quality</div>
      )}
    </div>
  );
}
