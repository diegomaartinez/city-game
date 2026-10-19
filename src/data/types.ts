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
  /** Huella; los niveles afinados la quitan (se dibujan manzanas) y dejan solo centro y área. */
  poly?: Pt[];
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

/** Manzana: edificios contiguos del mismo uso fundidos en un solo polígono (anillo exterior y patios). Solo para dibujar. */
export interface Block { use: BuildingUse; rings: Pt[][] }

export type AreaKind = 'sea' | 'land' | 'park' | 'water' | 'wood' | 'grass' | 'cemetery' | 'plaza';

export interface Area { id: number; kind: AreaKind; poly: Pt[] }

export type LanduseKind = 'residential' | 'commercial' | 'industrial';

export interface Landuse { kind: LanduseKind; poly: Pt[]; bbox: [number, number, number, number] }

/** Zona de uso del suelo (fuera del núcleo detallado hace de "edificios": población y empleos por hectárea). */
export interface Zone { id: number; kind: LanduseKind; poly: Pt[]; area: number; cx: number; cy: number }

/** Barrio o distrito con nombre (nodo place de OSM), para dar nombre a los barrios del juego. */
export interface PlaceNode { name: string; kind: 'neighbourhood' | 'quarter' | 'suburb' | 'town' | 'village'; x: number; y: number }

export type LevelKind = 'city' | 'country';

/** Ciudad de un nivel de país: nodo entre el que se tienden las líneas. */
export interface City {
  id: number;
  name: string;
  /** Posición dibujada (metros locales); las ciudades del recuadro de Canarias van desplazadas. */
  x: number;
  y: number;
  lat: number;
  lon: number;
  pop: number;
  airport: boolean;
  coastal: boolean;
  /** Código de país (ES, PT, AD, GI). */
  country: string;
  /** Está en el recuadro aparte (Canarias). */
  inset?: boolean;
}

/** Geometría de un nivel de país. */
export interface CountryMap {
  /** Polígonos de tierra jugable (España, Portugal, Andorra, Gibraltar). */
  land: Pt[][];
  /** Tierra de países vecinos, solo decorativa. */
  foreign: Pt[][];
  /** Fronteras terrestres. */
  borders: Pt[][];
  /** Recuadro del inset (Canarias) en metros locales, y su etiqueta. */
  inset?: { x0: number; y0: number; x1: number; y1: number; label: string };
  /** Rejilla de tierra/mar para que los barcos bordeen la costa. */
  sea?: { cell: number; x0: number; y0: number; cols: number; rows: number; land: string };
}

export interface CityData {
  name: string;
  /** Tipo de nivel: ciudad (calles y edificios) o país (ciudades y grandes infraestructuras). */
  kind?: LevelKind;
  /** Mitad del ancho y del alto del rectángulo jugable (niveles de país); en ciudades es `radius`. */
  halfW?: number;
  halfH?: number;
  cities?: City[];
  map?: CountryMap;
  lat: number;
  lon: number;
  /** Radio cargado en metros (lado del cuadrado jugable / 2, menos el margen). */
  radius: number;
  /** Radio del núcleo con edificios; más allá solo hay zonas de uso del suelo y calles principales. */
  core: number;
  /** Núcleo rectangular explícito [x0, y0, x1, y1] en metros (niveles prediseñados); si existe, sustituye a `core`. */
  coreBox?: [number, number, number, number];
  roads: RoadWay[];
  buildings: Building[];
  /** Manzanas para dibujar (edificios contiguos fundidos); si faltan, se dibujan los edificios uno a uno. */
  blocks?: Block[];
  areas: Area[];
  zones: Zone[];
  /** Barrios con nombre (nodos place). */
  places?: PlaceNode[];
  /** Factor que ajusta la población estimada a la real (niveles calibrados); 1 si no se conoce. */
  peopleScale?: number;
  /** Momento de descarga (ms). */
  fetchedAt: number;
  /** Versión del formato; si cambia, la ciudad se vuelve a descargar. */
  version?: number;
}

export const CITY_VERSION = 4;
/** Radio máximo con edificios detallados. */
export const CORE_RADIUS = 3000;
/** Margen (m) que se añade al radio para formar la isla jugable. */
export const MARGIN = 60;
