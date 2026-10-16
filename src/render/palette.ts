// Paletas y estilos de mapa. "Maqueta" usa la familia de colores de Little Drives (arena, tinta,
// crema, coral); "sencillo" es un plano apagado para que resalte la red; "realista" imita un mapa web.
import type { BuildingUse, LanduseKind, RoadClass } from '../data/types.ts';

export type MapStyle = 'plano' | 'sencillo' | 'realista' | 'maqueta';
export const MAP_STYLES: Array<{ id: MapStyle; name: string; desc: string }> = [
  { id: 'plano', name: 'Plano', desc: 'Papel claro y ciudad discreta: la red de transporte es la protagonista.' },
  { id: 'sencillo', name: 'Sencillo', desc: 'Aún más limpio: sin calles menores ni detalles.' },
  { id: 'realista', name: 'Realista', desc: 'Como un mapa web: calles claras, edificios grises, agua azul.' },
  { id: 'maqueta', name: 'Maqueta', desc: 'Colores cálidos y contornos de tinta, al estilo Little Drives.' },
];

/** Color de texto y contornos de la red en los estilos claros. */
export const SLATE = 0x2b3440;

export const INK = 0x2a2522;
export const CREAM = 0xf7e8d2;
export const CORAL = 0xe88a82;

export interface RoadStyle {
  /** Contorno exterior (null = sin contorno). */
  casing: number | null;
  casingAlpha: number;
  /** Franja de acera entre contorno y asfalto (null = ninguna). */
  sidewalk: number | null;
  fill: Record<RoadClass, number>;
  widthScale: number;
  dashes: boolean;
  dashColor: number;
  showPedestrian: boolean;
  showService: boolean;
}

export interface StyleDef {
  bg: number;
  bgPatches: [number, number] | null;
  /** Fondo fuera de la isla jugable. */
  backdrop: number;
  /** Zonas de uso del suelo (área metropolitana, sin edificios). */
  zone: Record<LanduseKind, number>;
  zoneEdge: number;
  sea: number;
  seaEdge: number;
  water: number;
  waterEdge: number;
  park: number;
  parkEdge: number;
  wood: number;
  grass: number;
  cemetery: number;
  plaza: number;
  plazaEdge: number;
  trees: boolean;
  building: (use: BuildingUse, id: number) => number;
  buildingStroke: { color: number; width: number; alpha: number } | null;
  road: RoadStyle;
  ink: number;
  label: number;
}

function pick(p: number[], id: number): number {
  let h = (id ^ 0x5bd1e995) >>> 0; h = Math.imul(h ^ (h >>> 13), 0x9e3779b1) >>> 0;
  return p[h % p.length];
}

const MAQUETA_BUILDINGS: Record<BuildingUse, number[]> = {
  residential: [0xf3d6af, 0xecc9a2, 0xf0c6a6, 0xe6b89e, 0xf5e1c4, 0xe9bf96, 0xf1cfb0],
  commercial: [0xa9c6e4, 0x8fb4d9, 0xbfd3ea, 0x9cbcd0, 0xb3c9df],
  industrial: [0xb9b48f, 0xadab75, 0xc2bf7c, 0xb5ad92, 0xa8a98a],
  public: [0xe88a82, 0xf0a69a, 0xeea089, 0xe79a90],
};
const PLANO_BUILDINGS: Record<BuildingUse, number> = { residential: 0xe6dfd4, commercial: 0xd6dce3, industrial: 0xdedacc, public: 0xe4d6d2 };
const SENCILLO_BUILDINGS: Record<BuildingUse, number> = { residential: 0xebe6dd, commercial: 0xe1e4e8, industrial: 0xe6e3d9, public: 0xe9e0dd };
const REALISTA_BUILDINGS: Record<BuildingUse, number> = { residential: 0xd9d0c9, commercial: 0xd1cfd6, industrial: 0xd6d4c6, public: 0xdcc9c4 };

export const STYLES: Record<MapStyle, StyleDef> = {
  plano: {
    bg: 0xf4f1ea, bgPatches: null, backdrop: 0xd4dde4, zone: { residential: 0xe8e1d6, commercial: 0xdbe1e8, industrial: 0xe2dfd1 }, zoneEdge: 0xd6cfc3,
    sea: 0xa9cde2, seaEdge: 0xffffff, water: 0xc6ddea, waterEdge: 0xaccbdc,
    park: 0xd5e5c6, parkEdge: 0xc5d9b3, wood: 0xcbdebc, grass: 0xe0eacf, cemetery: 0xdbe0d2, plaza: 0xece8df, plazaEdge: 0xdfd9cd,
    trees: false,
    building: use => PLANO_BUILDINGS[use],
    buildingStroke: { color: 0xd3cbbf, width: 0.5, alpha: 0.9 },
    road: {
      casing: 0xd9d3c8, casingAlpha: 1, sidewalk: null,
      fill: { motorway: 0xe9e3d9, primary: 0xfdfcf9, secondary: 0xfdfcf9, tertiary: 0xffffff, residential: 0xfbfaf6, service: 0xf7f4ee, pedestrian: 0xefebe3 },
      widthScale: 0.9, dashes: false, dashColor: 0, showPedestrian: true, showService: true,
    },
    ink: SLATE, label: SLATE,
  },
  sencillo: {
    bg: 0xf6f3ed, bgPatches: null, backdrop: 0xd8dfe5, zone: { residential: 0xece7df, commercial: 0xe3e7ec, industrial: 0xe8e5dc }, zoneEdge: 0xe2dcd2,
    sea: 0xc6dce9, seaEdge: 0xffffff, water: 0xd0e3ee, waterEdge: 0xbdd3e0,
    park: 0xdde9d1, parkEdge: 0xd0dfc2, wood: 0xd4e3c6, grass: 0xe5edd8, cemetery: 0xe0e4d8, plaza: 0xf0ece4, plazaEdge: 0xe6e0d5,
    trees: false,
    building: use => SENCILLO_BUILDINGS[use],
    buildingStroke: null,
    road: {
      casing: null, casingAlpha: 0, sidewalk: null,
      fill: { motorway: 0xd9d3c9, primary: 0xdcd6cc, secondary: 0xe2ddd3, tertiary: 0xe8e3da, residential: 0xeee9e0, service: 0xf1ede5, pedestrian: 0xf1ede5 },
      widthScale: 0.75, dashes: false, dashColor: 0, showPedestrian: false, showService: false,
    },
    ink: 0x4a5058, label: 0x4a5058,
  },
  maqueta: {
    bg: 0xe8b98c, bgPatches: [0xf3d6af, 0xd9a574], backdrop: 0xb98f67, zone: { residential: 0xf0cfa8, commercial: 0xb9cde2, industrial: 0xc6c3a0 }, zoneEdge: 0xc9a074,
    sea: 0x6aa6cf, seaEdge: 0xf7e8d2, water: 0x7fb3d8, waterEdge: 0x5a93bd,
    park: 0x9fc27a, parkEdge: 0x7fa85e, wood: 0x86ac64, grass: 0xb6cc86, cemetery: 0xb8bf9a, plaza: 0xf7e8d2, plazaEdge: INK,
    trees: true,
    building: (use, id) => pick(MAQUETA_BUILDINGS[use], id),
    buildingStroke: { color: INK, width: 0.9, alpha: 0.9 },
    road: {
      casing: INK, casingAlpha: 0.9, sidewalk: CREAM,
      fill: { motorway: 0x45454a, primary: 0x4b4b4e, secondary: 0x56545a, tertiary: 0x615e62, residential: 0x6c696b, service: 0x7b7673, pedestrian: CREAM },
      widthScale: 1, dashes: true, dashColor: CREAM, showPedestrian: true, showService: true,
    },
    ink: INK, label: INK,
  },
  realista: {
    bg: 0xf2efe9, bgPatches: null, backdrop: 0xcfd6dc, zone: { residential: 0xe0dfdf, commercial: 0xf2dad9, industrial: 0xebdbe8 }, zoneEdge: 0xd6d2cc,
    sea: 0xaad3df, seaEdge: 0xaad3df, water: 0xaad3df, waterEdge: 0x9cc4d1,
    park: 0xc8facc, parkEdge: 0xb5e6b9, wood: 0xadd19e, grass: 0xcdebb0, cemetery: 0xaacbaf, plaza: 0xdddde8, plazaEdge: 0xc9c9d6,
    trees: false,
    building: use => REALISTA_BUILDINGS[use],
    buildingStroke: { color: 0xc4b9ad, width: 0.6, alpha: 1 },
    road: {
      casing: 0xb9b3aa, casingAlpha: 1, sidewalk: null,
      fill: { motorway: 0xe892a2, primary: 0xfcd6a4, secondary: 0xf7fabf, tertiary: 0xffffff, residential: 0xffffff, service: 0xffffff, pedestrian: 0xdddde8 },
      widthScale: 1, dashes: false, dashColor: 0, showPedestrian: true, showService: true,
    },
    ink: 0x4a4a4a, label: 0x4a4a4a,
  },
};

/** CSS: colores reutilizados en la interfaz. */
export const CSS = {
  ink: '#2a2522', sand: '#e8b98c', sandLight: '#f3d6af', cream: '#f7e8d2', coral: '#e88a82', blue: '#2f6fc4', olive: '#7f8f58', gold: '#f0bf3c',
};

const KEY = 'little-transit-style';
export function loadStyle(): MapStyle {
  try { const v = localStorage.getItem(KEY) as MapStyle | null; if (v && STYLES[v]) return v; } catch { /* sin almacenamiento */ }
  return 'plano';
}
export function saveStyle(s: MapStyle): void { try { localStorage.setItem(KEY, s); } catch { /* sin almacenamiento */ } }
