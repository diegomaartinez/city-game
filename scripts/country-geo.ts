// Geometría del nivel de país: marco, proyección, recuadro de Canarias y costa/fronteras de Natural Earth.
import { createRequire } from 'node:module';
import * as topojson from 'topojson-client';
import type { Topology, GeometryCollection } from 'topojson-specification';
import { Projection } from '../src/data/geo.ts';
import { simplify } from '../src/data/compact.ts';
import { CITY_VERSION, type City, type CityData, type Pt, type RoadWay } from '../src/data/types.ts';
import { SeaGrid } from '../src/sim/sea.ts';

const require = createRequire(import.meta.url);

// ───────────── marco ─────────────
export const LAT0 = 39.55, LON0 = -2.6;
export const FRAME = { west: -9.8, east: 4.6, south: 35.0, north: 44.1 };
export const CANARIAS = { west: -18.3, east: -13.3, south: 27.5, north: 29.5 };
// recuadro de Canarias abajo a la derecha del marco
export const INSET = { west: 0.25, east: 4.5, south: 35.05, north: 36.95 };
export const OWN = new Set(['Spain', 'Portugal', 'Andorra', 'Gibraltar']);
const FOREIGN = new Set(['France', 'Morocco', 'Algeria']);
export const COUNTRY_CODE: Record<string, string> = { Spain: 'ES', Portugal: 'PT', Andorra: 'AD', Gibraltar: 'GI' };
/** Capitales de provincia/distrito y plazas que entran aunque no lleguen a 50.000 habitantes. */
export const ALWAYS = ['Soria', 'Teruel', 'Huesca', 'Segovia', 'Ávila', 'Cuenca', 'Zamora', 'Palencia', 'Bragança', 'Portalegre', 'Beja', 'Guarda', 'Évora', 'Castelo Branco', 'Vila Real', 'Viseu', 'Andorra la Vella', 'Ceuta', 'Melilla', 'Mérida', 'Gibraltar', 'Puerto del Rosario', 'Arrecife', 'Santa Cruz de la Palma', 'San Sebastián de La Gomera', 'Valverde', 'Ibiza', 'Eivissa', 'Maó', 'Mahón', 'Ciutadella de Menorca', 'Faro', 'Santander', 'Logroño'];
export const MIN_POP = 50_000;

export const proj = new Projection(LAT0, LON0);
export const toXY = (lon: number, lat: number): Pt => { const p = proj.toXY(lat, lon); return { x: Math.round(p.x), y: Math.round(p.y) }; };
export const inFrame = (lon: number, lat: number) => lon >= FRAME.west && lon <= FRAME.east && lat >= FRAME.south && lat <= FRAME.north;
export const inCanarias = (lon: number, lat: number) => lon >= CANARIAS.west && lon <= CANARIAS.east && lat >= CANARIAS.south && lat <= CANARIAS.north;
// Canarias → recuadro: misma escala en grados que el marco, desplazadas
export const insetScale = Math.min((INSET.east - INSET.west) / (CANARIAS.east - CANARIAS.west), (INSET.north - INSET.south) / (CANARIAS.north - CANARIAS.south));
export const insetLonLat = (lon: number, lat: number): [number, number] => [INSET.west + (lon - CANARIAS.west) * insetScale, INSET.south + (lat - CANARIAS.south) * insetScale];
export const place = (lon: number, lat: number): Pt | null => {
  if (inFrame(lon, lat)) return toXY(lon, lat);
  if (inCanarias(lon, lat)) { const [a, b] = insetLonLat(lon, lat); return toXY(a, b); }
  return null;
};

// ───────────── Natural Earth ─────────────
const topo = require('world-atlas/countries-10m.json') as Topology<{ countries: GeometryCollection<{ name: string }> }>;
const countries = topojson.feature(topo, topo.objects.countries);
export const land: Pt[][] = [], foreign: Pt[][] = [];
const polysOf = (g: GeoJSON.Geometry): number[][][][] => g.type === 'Polygon' ? [g.coordinates as number[][][]] : g.type === 'MultiPolygon' ? (g.coordinates as number[][][][]) : [];
for (const f of countries.features) {
  const name = f.properties?.name ?? '';
  if (!OWN.has(name) && !FOREIGN.has(name)) continue;
  for (const poly of polysOf(f.geometry)) {
    const ring = poly[0]; // anillo exterior (sin lagos)
    const lons = ring.map(p => p[0]), lats = ring.map(p => p[1]);
    const cx = (Math.min(...lons) + Math.max(...lons)) / 2, cy = (Math.min(...lats) + Math.max(...lats)) / 2;
    const touches = ring.some(([lo, la]) => inFrame(lo, la)) || inCanarias(cx, cy);
    if (!touches) continue;
    if (inCanarias(cx, cy) && !OWN.has(name)) continue;
    const pts = ring.map(([lo, la]) => inCanarias(cx, cy) ? toXY(...insetLonLat(lo, la)) : toXY(lo, la));
    const simp = simplify(pts, 150);
    if (simp.length < 4) continue;
    (OWN.has(name) ? land : foreign).push(simp);
  }
}
// fronteras terrestres entre países (arcos compartidos) y costa (arcos no compartidos)
type G = { properties?: { name: string } };
const nameOf = (g: G) => g.properties?.name ?? '';
const borderMesh = topojson.mesh(topo, topo.objects.countries, (a, b) => a !== b && (OWN.has(nameOf(a as G)) || OWN.has(nameOf(b as G))));
const coastMesh = topojson.mesh(topo, topo.objects.countries, (a, b) => a === b && OWN.has(nameOf(a as G)));
const lines = (m: GeoJSON.MultiLineString, inset: boolean) => m.coordinates.map(l => l.filter(([lo, la]) => inset ? inCanarias(lo, la) : inFrame(lo, la)).map(([lo, la]) => inset ? toXY(...insetLonLat(lo, la)) : toXY(lo, la))).filter(l => l.length >= 2);
export const borders = lines(borderMesh, false).map(l => simplify([...l, l[0]], 150).slice(0, -1)).filter(l => l.length >= 2);
export const coast = [...lines(coastMesh, false), ...lines(coastMesh, true)];
console.log(`tierra: ${land.length} polígonos propios, ${foreign.length} vecinos, ${borders.length} fronteras, ${coast.length} tramos de costa`);


export function segDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

/** Ciudades: elimina duplicados, asigna aeropuertos y marca las costeras. */
export function finishCities(cities: City[], airportPts: Pt[]): City[] {
  cities.sort((a, b) => b.pop - a.pop);
  const kept: City[] = [];
  for (const c of cities) if (!kept.some(k => k.name === c.name || Math.hypot(k.x - c.x, k.y - c.y) < 8000)) kept.push(c);
  for (const p of airportPts) {
    let best: City | null = null, bd = 35_000;
    for (const c of kept) { const d = Math.hypot(c.x - p.x, c.y - p.y) / (c.inset ? insetScale : 1); if (d < bd) { bd = d; best = c; } }
    if (best) best.airport = true;
  }
  for (const c of kept) {
    let md = Infinity;
    for (const l of coast) for (let i = 0; i + 1 < l.length; i++) { const d = segDist(c, l[i], l[i + 1]); if (d < md) md = d; }
    c.coastal = md < 15000 * (c.inset ? insetScale : 1);
  }
  return kept;
}

/** Monta el nivel con la geometría y las ciudades y autopistas dadas. */
export function makeLevel(cities: City[], roads: RoadWay[]): CityData {
  const nw = toXY(FRAME.west, FRAME.north), se = toXY(FRAME.east, FRAME.south);
  const halfW = Math.round((se.x - nw.x) / 2), halfH = Math.round((se.y - nw.y) / 2);
  const i0 = toXY(INSET.west, INSET.north), i1 = toXY(INSET.east, INSET.south);
  const sea = SeaGrid.build([...land, ...foreign], -halfW, -halfH, halfW, halfH, 4000);
  return {
    name: 'España y Portugal', kind: 'country', lat: LAT0, lon: LON0, radius: Math.max(halfW, halfH), halfW, halfH, core: 0,
    roads, buildings: [], areas: [], zones: [], places: [], cities,
    map: { land, foreign, borders, inset: { x0: i0.x, y0: i0.y, x1: i1.x, y1: i1.y, label: 'Canarias' }, sea },
    fetchedAt: Date.now(), version: CITY_VERSION,
  };
}
