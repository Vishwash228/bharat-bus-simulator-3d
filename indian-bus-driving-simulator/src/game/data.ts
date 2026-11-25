import type { UpgradeLevels, Weather } from './types';

export type BusStyle = 'ordinary' | 'city' | 'express' | 'volvo';
export interface BusSpec {
  id: string; name: string; operator: string; style: BusStyle; price: number; seats: number;
  topSpeed: number; power: number; brake: number; comfort: number; tank: number; efficiency: number; fareMul: number;
  body: string; stripe: string; stripe2: string; roof: string; seatColor: string; length: number; axles: number;
  description: string;
}

export const BUSES: BusSpec[] = [
  {
    id: 'gramin', name: 'Gramin Seva', operator: 'BHARAT ROADWAYS', style: 'ordinary', price: 0, seats: 32,
    topSpeed: 72, power: 1.55, brake: 5.6, comfort: 0.35, tank: 120, efficiency: 1.15, fareMul: 1,
    body: '#c62828', stripe: '#f5e6c8', stripe2: '#ffb300', roof: '#e8dcc0', seatColor: '#1e4fa3', length: 11, axles: 2,
    description: 'The trusty red state-transport bus. Rugged, noisy and loved by every village.',
  },
  {
    id: 'city', name: 'Nagar Shuttle', operator: 'NAGAR PARIVAHAN', style: 'city', price: 65000, seats: 40,
    topSpeed: 80, power: 1.8, brake: 6.4, comfort: 0.5, tank: 140, efficiency: 1.0, fareMul: 1.15,
    body: '#1565c0', stripe: '#ffffff', stripe2: '#4fc3f7', roof: '#eceff1', seatColor: '#c62828', length: 11.5, axles: 2,
    description: 'Low-floor city bus with wide doors and smoother suspension.',
  },
  {
    id: 'express', name: 'Shatabdi Express', operator: 'SHATABDI TRAVELS', style: 'express', price: 150000, seats: 44,
    topSpeed: 95, power: 2.05, brake: 7.0, comfort: 0.68, tank: 180, efficiency: 0.92, fareMul: 1.4,
    body: '#2e7d32', stripe: '#fdd835', stripe2: '#ffffff', roof: '#f1f8e9', seatColor: '#6d4c41', length: 12, axles: 2,
    description: 'Push-back seats, tinted glass and a punchy engine for intercity runs.',
  },
  {
    id: 'volvo', name: 'Rajdhani Volvo AC', operator: 'RAJDHANI VOLVO', style: 'volvo', price: 340000, seats: 48,
    topSpeed: 110, power: 2.4, brake: 7.8, comfort: 0.9, tank: 260, efficiency: 0.85, fareMul: 1.9,
    body: '#f5f5f5', stripe: '#6a1b9a', stripe2: '#ab47bc', roof: '#ffffff', seatColor: '#880e4f', length: 13.5, axles: 3,
    description: 'Multi-axle luxury coach with air suspension and climate control. The king of the highway.',
  },
];
export const busById = (id: string) => BUSES.find(b => b.id === id) || BUSES[0];

export type UpgradeKey = keyof UpgradeLevels;
export const UPGRADES: { key: UpgradeKey; name: string; icon: string; desc: string; costs: number[] }[] = [
  { key: 'engine', name: 'Engine Tuning', icon: '⚙️', desc: '+12% power & +6 km/h top speed per level', costs: [18000, 40000, 85000] },
  { key: 'brakes', name: 'Air Brakes', icon: '🛑', desc: '+12% braking force, better in rain', costs: [12000, 28000, 60000] },
  { key: 'suspension', name: 'Suspension', icon: '🛞', desc: 'Less body roll, smoother ride on bad roads', costs: [15000, 32000, 70000] },
  { key: 'comfort', name: 'Comfort Kit', icon: '💺', desc: 'Better seats, fans/AC, music. Happier passengers', costs: [10000, 25000, 55000] },
];

export interface RouteDef {
  id: string; name: string; hindi: string; stops: string[]; unlockCost: number; repReq: number;
  region: string; description: string; baseFare: number; perKm: number; color: string;
}

export const ROUTES: RouteDef[] = [
  { id: 'city_local', name: 'City Local – Route 1', hindi: 'सिटी लोकल', stops: ['central', 'market', 'school', 'hospital', 'central'], unlockCost: 0, repReq: 0, region: 'City', description: 'Short loop through busy city roads, signals and markets.', baseFare: 15, perKm: 14, color: '#38bdf8' },
  { id: 'village', name: 'Gaon Seva – Sitapur', hindi: 'गाँव सेवा', stops: ['central', 'school', 'sitapur'], unlockCost: 0, repReq: 0, region: 'Rural', description: 'Leave the city for the village. Railway crossing, cattle and dusty roads.', baseFare: 20, perKm: 12, color: '#a3e635' },
  { id: 'highway', name: 'Intercity Express – Rampur', hindi: 'इंटरसिटी एक्सप्रेस', stops: ['central', 'dhaba', 'rampur'], unlockCost: 40000, repReq: 10, region: 'Highway', description: 'Fast run on NH-48 with toll plaza, petrol pump and a dhaba halt.', baseFare: 35, perKm: 16, color: '#fbbf24' },
  { id: 'rural_link', name: 'Rampur – Sitapur Rural', hindi: 'ग्रामीण लिंक', stops: ['rampur', 'khetpur', 'sitapur'], unlockCost: 30000, repReq: 15, region: 'Rural', description: 'Long farm roads between villages. Broken patches and a rail crossing.', baseFare: 25, perKm: 13, color: '#84cc16' },
  { id: 'hill', name: 'Ghat Route – Himgiri', hindi: 'घाट रूट', stops: ['central', 'ghat', 'deodar', 'hillstation'], unlockCost: 60000, repReq: 25, region: 'Mountain', description: 'Police checkpoint, river bridge and hairpin mountain bends up to the hills.', baseFare: 40, perKm: 20, color: '#c084fc' },
  { id: 'grand', name: 'Grand Bharat Circuit', hindi: 'ग्रैंड सर्किट', stops: ['central', 'hillstation', 'nadighat', 'rampur', 'khetpur', 'sitapur', 'central'], unlockCost: 110000, repReq: 40, region: 'All', description: 'The ultimate long-distance journey covering every region on the map.', baseFare: 60, perKm: 18, color: '#f472b6' },
];
export const routeById = (id: string) => ROUTES.find(r => r.id === id);

export interface MissionDef {
  id: string; title: string; desc: string; icon: string; reward: number; routeId?: string; weather?: Weather; hour?: number;
  timeLimit?: number; maxCollisions?: number; maxViolations?: number; paxTarget?: number; emergency?: boolean;
}

export const MISSIONS: MissionDef[] = [
  { id: 'm_city_safe', title: 'Safe City Driver', desc: 'Complete the City Local route without a single collision.', icon: '🛡️', reward: 8000, routeId: 'city_local', maxCollisions: 0 },
  { id: 'm_pax30', title: 'Full House', desc: 'Transport 30 passengers in one shift (free ride).', icon: '👥', reward: 15000, paxTarget: 30 },
  { id: 'm_rain', title: 'Monsoon Run', desc: 'Drive the Sitapur village route through heavy monsoon rain.', icon: '🌧️', reward: 12000, routeId: 'village', weather: 'rain', hour: 17 },
  { id: 'm_mountain', title: 'King of the Ghats', desc: 'Complete the Himgiri mountain route in fog.', icon: '⛰️', reward: 18000, routeId: 'hill', weather: 'fog', hour: 7 },
  { id: 'm_timed', title: 'Beat the Clock', desc: 'Reach Rampur on the Intercity Express within 7 minutes.', icon: '⏱️', reward: 16000, routeId: 'highway', timeLimit: 420 },
  { id: 'm_rules', title: 'Model Citizen', desc: 'Complete City Local without breaking any traffic rule.', icon: '🚦', reward: 10000, routeId: 'city_local', maxViolations: 0 },
  { id: 'm_long', title: 'Long Haul Legend', desc: 'Complete the Grand Bharat Circuit at night.', icon: '🛣️', reward: 40000, routeId: 'grand', hour: 20 },
  { id: 'm_emergency', title: 'Emergency Run', desc: 'A patient in Sitapur needs to reach City Hospital in 6 minutes. Use hazard lights!', icon: '🚑', reward: 25000, timeLimit: 360, emergency: true, weather: 'storm', hour: 22 },
];

export const COMPANY_TIERS = [
  { rep: 0, name: 'Local Operator', icon: '🚐' },
  { rep: 20, name: 'District Travels', icon: '🚌' },
  { rep: 45, name: 'Regional Roadways', icon: '🏢' },
  { rep: 75, name: 'State Express Corp.', icon: '🏆' },
  { rep: 100, name: 'Bharat Roadways Empire', icon: '👑' },
];
export const companyTier = (rep: number) => [...COMPANY_TIERS].reverse().find(t => rep >= t.rep) || COMPANY_TIERS[0];

export const FUEL_PRICE = 94;
export const TOLL_FEE = 150;
