import { BUSES } from './data';
import { DEFAULT_SETTINGS, type SaveData, type Settings } from './types';

const SAVE_KEY = 'bharat-bus-sim-save-v1';
const SET_KEY = 'bharat-bus-sim-settings-v1';

export function defaultSave(): SaveData {
  const upgrades: SaveData['upgrades'] = {};
  const damage: Record<string, number> = {}, fuel: Record<string, number> = {}, clean: Record<string, number> = {};
  for (const b of BUSES) { upgrades[b.id] = { engine: 0, brakes: 0, suspension: 0, comfort: 0 }; damage[b.id] = 0; fuel[b.id] = 1; clean[b.id] = 1; }
  return {
    version: 1, companyName: 'Bharat Roadways', money: 25000, ownedBuses: ['gramin'], currentBus: 'gramin', upgrades, damage, fuel, cleanliness: clean,
    unlockedRoutes: ['city_local', 'village'], routeBest: {}, routeRuns: {}, missionsDone: [], reputation: 0,
    stats: { passengers: 0, distanceKm: 0, earnings: 0, accidents: 0, violations: 0, routes: 0, fines: 0 },
  };
}

function load<T>(key: string, def: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return def;
    const v = JSON.parse(raw);
    if (typeof def === 'object' && def && !Array.isArray(def)) {
      const merged = { ...def, ...v } as Record<string, unknown>;
      for (const k of Object.keys(def as object)) {
        const dv = (def as Record<string, unknown>)[k];
        if (dv && typeof dv === 'object' && !Array.isArray(dv)) merged[k] = { ...(dv as object), ...((v as Record<string, object>)[k] || {}) };
      }
      return merged as T;
    }
    return v;
  } catch { return def; }
}

type Listener = () => void;
class Store {
  save: SaveData = load(SAVE_KEY, defaultSave());
  settings: Settings = (() => {
    let fresh = true;
    try { fresh = !localStorage.getItem(SET_KEY); } catch { /* ignore */ }
    const s = load(SET_KEY, DEFAULT_SETTINGS);
    const touch = typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0);
    if (fresh && touch) return { ...s, quality: 'low' as const, mirrors: false, trafficDensity: 0.8 };
    return s;
  })();
  private ls = new Set<Listener>();
  subscribe = (l: Listener) => { this.ls.add(l); return () => { this.ls.delete(l); }; };
  private emit() { this.ls.forEach(l => l()); }
  updateSave(fn: (s: SaveData) => void) {
    const s = structuredClone(this.save); fn(s); this.save = s;
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(s)); } catch { /* ignore */ }
    this.emit();
  }
  updateSettings(p: Partial<Settings>) {
    this.settings = { ...this.settings, ...p };
    try { localStorage.setItem(SET_KEY, JSON.stringify(this.settings)); } catch { /* ignore */ }
    this.emit();
  }
  reset() { this.save = defaultSave(); try { localStorage.setItem(SAVE_KEY, JSON.stringify(this.save)); } catch { /* ignore */ } this.emit(); }
}
export const store = new Store();

import { useSyncExternalStore } from 'react';
export function useSave() { return useSyncExternalStore(store.subscribe, () => store.save); }
export function useSettings() { return useSyncExternalStore(store.subscribe, () => store.settings); }

export const fmtMoney = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');
