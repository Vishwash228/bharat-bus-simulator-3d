import type { RouteOption } from './roads';

export type CameraMode = 'driver' | 'chase' | 'interior' | 'cinematic' | 'rear';
export const CAMERA_LABELS: Record<CameraMode, string> = { driver: 'Driver View', chase: 'Third Person', interior: 'Bus Interior', cinematic: 'Cinematic', rear: 'Rear Camera' };
export type Weather = 'clear' | 'cloudy' | 'rain' | 'fog' | 'storm';
export const WEATHER_LABEL: Record<Weather, string> = { clear: 'Clear', cloudy: 'Cloudy', rain: 'Rain', fog: 'Fog', storm: 'Thunderstorm' };
export type Quality = 'low' | 'medium' | 'high';

export interface Settings {
  quality: Quality;
  transmission: 'auto' | 'manual';
  masterVolume: number;
  musicVolume: number;
  sfxVolume: number;
  mirrors: boolean;
  touchControls: 'auto' | 'on' | 'off';
  voiceGuidance: boolean;
  trafficDensity: number;
  dayLength: number; // real minutes per game day
  steering: number;
  showFps: boolean;
  speechVoices: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  quality: 'medium', transmission: 'auto', masterVolume: 0.8, musicVolume: 0.5, sfxVolume: 0.9,
  mirrors: true, touchControls: 'auto', voiceGuidance: true, trafficDensity: 1, dayLength: 24, steering: 1, showFps: false, speechVoices: true,
};

export interface UpgradeLevels { engine: number; brakes: number; suspension: number; comfort: number }

export interface SaveData {
  version: number;
  companyName: string;
  money: number;
  ownedBuses: string[];
  currentBus: string;
  upgrades: Record<string, UpgradeLevels>;
  damage: Record<string, number>;
  fuel: Record<string, number>;
  cleanliness: Record<string, number>;
  unlockedRoutes: string[];
  routeBest: Record<string, number>;
  routeRuns: Record<string, number>;
  missionsDone: string[];
  reputation: number;
  stats: { passengers: number; distanceKm: number; earnings: number; accidents: number; violations: number; routes: number; fines: number };
}

export type GameMode = 'career' | 'free' | 'mission';
export interface LaunchConfig {
  mode: GameMode;
  routeId?: string;
  missionId?: string;
  weather?: Weather | 'dynamic';
  hour?: number;
}

export interface Notice { id: number; text: string; kind: 'good' | 'bad' | 'info' | 'warn'; t: number }

export interface HudState {
  speed: number; rpm: number; gear: string; fuel: number; fuelL: number; temp: number; damage: number;
  limit: number; overLimit: boolean;
  money: number; sessionEarn: number; hour: number; weather: Weather;
  passengers: number; seats: number; comfort: number; satisfaction: number; cleanliness: number;
  violations: number; collisions: number;
  indicator: 'none' | 'left' | 'right' | 'hazard'; blink: boolean; lights: 0 | 1 | 2; wipers: boolean; door: boolean; handbrake: boolean;
  camera: CameraMode; transmission: 'auto' | 'manual'; engineOn: boolean;
  routeName: string; nextStop: string; nextStopHindi: string; stopIndex: number; stopCount: number; distToStop: number;
  gps: { type: string; dist: number; road: string; eta: number; remaining: number; option: RouteOption } | null;
  prompt: string | null;
  timer: number | null; // seconds left
  missionText: string | null;
  radio: string;
  roadName: string;
  zone: string;
  signal: 'red' | 'yellow' | 'green' | null;
  boarding: string | null;
  fps: number;
}

export interface RouteResult {
  title: string;
  success: boolean;
  reason?: string;
  fares: number;
  bonus: number;
  fines: number;
  repairs: number;
  total: number;
  passengers: number;
  satisfaction: number;
  collisions: number;
  violations: number;
  distanceKm: number;
  timeSec: number;
  stars: number;
  missionReward: number;
  missionId?: string;
  routeId?: string;
}
