// Tipos de la ciudad una vez convertida desde OSM a geometría local (metros).

export interface Pt { x: number; y: number }

export type RoadClass = 'motorway' | 'primary' | 'secondary' | 'tertiary' | 'residential' | 'service' | 'pedestrian';

export type BuildingUse = 'residential' | 'commercial' | 'industrial' | 'public';

/** Equipamientos reconocidos en el mapa. */
export type ServiceKind = 'police' | 'fire' | 'health' | 'school';

export interface RoadWay {
  id: number;
  cls: RoadClass;
  name?: string;
  oneway: boolean;
  /** Puntos en metros. */
  pts: Pt[];
  /** Ids de nodo OSM, uno por punto. */
  nodes: number[];
  /** Nivel: <0 túnel, 0 a ras de suelo, >0 puente. */
  layer: number;
}

export interface Building {
  id: number;
  use: BuildingUse;
  poly: Pt[];
  levels: number;
  /** Área de la huella en m². */
  area: number;
  /** Centroide. */
  cx: number;
  cy: number;
  /** Si el edificio es un equipamiento, de qué tipo. */
  service?: ServiceKind;
  name?: string;
}

export type AreaKind = 'park' | 'water' | 'wood' | 'grass' | 'cemetery' | 'plaza';

export interface Area { id: number; kind: AreaKind; poly: Pt[] }

export type LanduseKind = 'residential' | 'commercial' | 'industrial';

export interface Landuse { kind: LanduseKind; poly: Pt[]; bbox: [number, number, number, number] }

export interface CityData {
  name: string;
  lat: number;
  lon: number;
  /** Radio cargado en metros. */
  radius: number;
  roads: RoadWay[];
  buildings: Building[];
  areas: Area[];
  /** Momento de descarga (ms). */
  fetchedAt: number;
}
