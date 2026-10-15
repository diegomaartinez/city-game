// Parámetros de juego: costes, radios de cobertura, capacidades. Todo lo "tuneable" está aquí.
import type { BuildingUse, RoadClass, ServiceKind } from '../data/types.ts';

export interface ServiceDef {
  name: string;
  cost: number;
  upkeep: number;      // al mes
  radius: number;      // metros de cobertura
  size: number;        // lado de la huella en metros
  color: string;
  needsRoad: boolean;
}

export const SERVICE_DEF: Record<ServiceKind, ServiceDef> = {
  power:  { name: 'Central eléctrica', cost: 30000, upkeep: 1500, radius: 750, size: 30, color: '#9a9a9c', needsRoad: true },
  water:  { name: 'Depuradora',        cost: 20000, upkeep: 1000, radius: 750, size: 22, color: '#64a2ea', needsRoad: true },
  police: { name: 'Comisaría',         cost: 12000, upkeep: 800,  radius: 450, size: 20, color: '#2f6fc4', needsRoad: true },
  fire:   { name: 'Parque de bomberos', cost: 12000, upkeep: 800, radius: 450, size: 22, color: '#d23b33', needsRoad: true },
  health: { name: 'Centro de salud',   cost: 30000, upkeep: 2000, radius: 600, size: 28, color: '#f7e8d2', needsRoad: true },
  school: { name: 'Colegio',           cost: 15000, upkeep: 1000, radius: 400, size: 26, color: '#f0bf3c', needsRoad: true },
  park:   { name: 'Parque',            cost: 3000,  upkeep: 150,  radius: 260, size: 24, color: '#92b763', needsRoad: false },
};

export const ROAD_COST: Record<RoadClass, number> = { motorway: 400, primary: 200, secondary: 120, tertiary: 90, residential: 60, service: 40, pedestrian: 30 }; // € por metro
export const ROAD_UPKEEP_PER_KM = 200; // € al mes por km de calle construida por el jugador
export const ZONE_COST = 5;            // € por celda
export const DEMOLISH_COST = 200;
export const START_MONEY = 80000;
export const TAX_RESIDENT = 1.0;       // € por habitante y mes
export const TAX_JOB = 0.8;            // € por puesto de trabajo y mes

export const MAX_LEVELS: Record<BuildingUse, number> = { residential: 5, commercial: 4, industrial: 2, public: 3 };

/** Habitantes o empleos por m² de planta. */
export function capacityOf(use: BuildingUse, area: number, levels: number): number {
  const floor = area * levels;
  switch (use) {
    case 'residential': return Math.max(2, Math.round(floor / 110));
    case 'commercial': return Math.max(2, Math.round(floor / 80));
    case 'industrial': return Math.max(3, Math.round(floor / 150));
    case 'public': return Math.max(1, Math.round(floor / 160));
  }
}

export const USE_NAME: Record<BuildingUse, string> = { residential: 'Residencial', commercial: 'Comercial', industrial: 'Industrial', public: 'Equipamiento' };
