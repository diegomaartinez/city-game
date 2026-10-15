// Paleta "maqueta": la misma familia de colores que Little Drives (arena, tinta, crema, coral).
import type { BuildingUse, RoadClass } from '../data/types.ts';

export const INK = 0x2a2522;
export const SAND = 0xe8b98c;
export const SAND_LIGHT = 0xf3d6af;
export const SAND_DARK = 0xd9a574;
export const CREAM = 0xf7e8d2;
export const CORAL = 0xe88a82;
export const ASPHALT = 0x4b4b4e;
export const ASPHALT_NEW = 0x5a585c;
export const SHADOW = 0x3a3238;
export const SHADOW_ALPHA = 0.3;
/** Dirección de las sombras por metro de altura (luz desde arriba a la derecha). */
export const SHADOW_DIR = { x: -0.55, y: 0.65 };

export const WATER = 0x7fb3d8;
export const WATER_EDGE = 0x5a93bd;
export const PARK = 0x9fc27a;
export const PARK_DARK = 0x7fa85e;
export const WOOD = 0x86ac64;
export const GRASS = 0xb6cc86;
export const CEMETERY = 0xb8bf9a;

export const ZONE_COLOR: Record<number, number> = { 1: 0x7fc47c, 2: 0x5a9be8, 3: 0xe8b23c };
export const ZONE_NAME: Record<number, string> = { 1: 'Residencial', 2: 'Comercial', 3: 'Industrial' };

const BUILDING_PALETTE: Record<BuildingUse, number[]> = {
  residential: [0xf3d6af, 0xecc9a2, 0xf0c6a6, 0xe6b89e, 0xf5e1c4, 0xe9bf96, 0xf1cfb0],
  commercial: [0xa9c6e4, 0x8fb4d9, 0xbfd3ea, 0x9cbcd0, 0xb3c9df],
  industrial: [0xb9b48f, 0xadab75, 0xc2bf7c, 0xb5ad92, 0xa8a98a],
  public: [0xe88a82, 0xf0a69a, 0xeea089, 0xe79a90],
};

export function buildingColor(use: BuildingUse, id: number): number {
  const p = BUILDING_PALETTE[use];
  let h = (id ^ 0x5bd1e995) >>> 0; h = Math.imul(h ^ (h >>> 13), 0x9e3779b1) >>> 0;
  return p[h % p.length];
}

export const ROAD_FILL: Record<RoadClass, number> = {
  motorway: 0x45454a, primary: ASPHALT, secondary: 0x56545a, tertiary: 0x615e62, residential: 0x6c696b, service: 0x7b7673, pedestrian: CREAM,
};

/** CSS: colores reutilizados en la interfaz. */
export const CSS = {
  ink: '#2a2522', sand: '#e8b98c', sandLight: '#f3d6af', cream: '#f7e8d2', coral: '#e88a82', blue: '#2f6fc4', olive: '#7f8f58', gold: '#f0bf3c',
};
