// Geometría del nivel de país: marco, proyección, recuadro de Canarias y costa/fronteras de Natural Earth.
import { createRequire } from 'node:module';
import * as topojson from 'topojson-client';
import type { Topology, GeometryCollection } from 'topojson-specification';
import { Projection } from '../src/data/geo.ts';
import { simplify } from '../src/data/compact.ts';
import { pointInPoly } from '../src/data/geo.ts';
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
/** País (código) de cada polígono de `land`, en el mismo orden. */
export const landCountry: string[] = [];
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
    if (OWN.has(name)) { land.push(simp); landCountry.push(COUNTRY_CODE[name] ?? 'ES'); } else foreign.push(simp);
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


/** Código de país de un punto según los polígonos de Natural Earth: propio, 'XX' si es vecino, null si cae en el mar. */
export function countryAt(p: Pt): string | null {
  for (let i = 0; i < land.length; i++) if (pointInPoly(p.x, p.y, land[i])) return landCountry[i];
  for (const f of foreign) if (pointInPoly(p.x, p.y, f)) return 'XX';
  return null;
}

/** País del polígono propio más cercano a un punto y a qué distancia está (m). */
export function nearestOwn(p: Pt): { country: string; dist: number } {
  let best = 'ES', bd = Infinity;
  for (let i = 0; i < land.length; i++) {
    const l = land[i];
    for (let j = 0; j < l.length; j++) { const d = segDist(p, l[j], l[(j + 1) % l.length]); if (d < bd) { bd = d; best = landCountry[i]; } }
  }
  return { country: best, dist: bd };
}

/** Distancia de un punto a la costa propia (m). */
export function coastDist(p: Pt): number {
  let md = Infinity;
  for (const l of coast) for (let i = 0; i + 1 < l.length; i++) { const d = segDist(p, l[i], l[i + 1]); if (d < md) md = d; }
  return md;
}

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
  // un aeropuerto es de la ciudad más grande a menos de 35 km (Barajas es de Madrid, no de Torrejón) y de las que tiene al lado
  for (const p of airportPts) {
    const near = kept.filter(c => Math.hypot(c.x - p.x, c.y - p.y) / (c.inset ? insetScale : 1) < 35_000);
    if (!near.length) continue;
    near.reduce((a, b) => (b.pop > a.pop ? b : a)).airport = true;
    for (const c of near) if (Math.hypot(c.x - p.x, c.y - p.y) / (c.inset ? insetScale : 1) < 10_000) c.airport = true;
  }
  for (const c of kept) c.coastal = coastDist(c) < 15000 * (c.inset ? insetScale : 1);
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

/** Une los tramos consecutivos iguales (OSM parte las autopistas en trozos cortos) y simplifica la geometría sin tocar los cruces. */
export function simplifyRoads(raw: RoadWay[], nodeUses: Map<number, number>, tol: number): RoadWay[] {
  const same = (a: RoadWay, b: RoadWay) => a.cls === b.cls && a.oneway === b.oneway && a.name === b.name;
  const startAt = new Map<number, RoadWay[]>();
  for (const w of raw) { const n = w.nodes[0]; const l = startAt.get(n); if (l) l.push(w); else startAt.set(n, [w]); }
  const used = new Set<RoadWay>();
  const joined = new Set<number>(); // nodos que eran unión de dos tramos y ya no son cruce
  const merged: RoadWay[] = [];
  for (const w of raw) {
    if (used.has(w)) continue;
    used.add(w);
    const pts = w.pts.slice(), nodes = w.nodes.slice();
    for (;;) {
      const end = nodes[nodes.length - 1];
      // el nodo final solo lo usan este tramo y el que empieza ahí
      if ((nodeUses.get(end) ?? 0) !== 2) break;
      const next = (startAt.get(end) ?? []).find(x => !used.has(x) && x !== w && same(w, x));
      if (!next) break;
      used.add(next); joined.add(end);
      pts.push(...next.pts.slice(1)); nodes.push(...next.nodes.slice(1));
    }
    merged.push({ ...w, pts, nodes });
  }
  return merged.map(w => {
    const keep = simplifyKeep(w.pts, tol, i => i === 0 || i === w.pts.length - 1 || (nodeUses.get(w.nodes[i]) ?? 0) > 1 && !joined.has(w.nodes[i]));
    return { ...w, pts: w.pts.filter((_, i) => keep[i]), nodes: w.nodes.filter((_, i) => keep[i]) };
  });
}

/** Douglas-Peucker por tramos entre puntos obligatorios (cruces): devuelve qué puntos se conservan. */
export function simplifyKeep(pts: Pt[], tol: number, forced: (i: number) => boolean): Uint8Array {
  const keep = new Uint8Array(pts.length);
  for (let i = 0; i < pts.length; i++) if (forced(i)) keep[i] = 1;
  const stack: Array<[number, number]> = [];
  let last = 0;
  for (let i = 1; i < pts.length; i++) if (keep[i]) { stack.push([last, i]); last = i; }
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const A = pts[a], B = pts[b], dx = B.x - A.x, dy = B.y - A.y, l2 = dx * dx + dy * dy;
    let best = -1, bd = tol;
    for (let i = a + 1; i < b; i++) {
      const P = pts[i], u = l2 ? Math.max(0, Math.min(1, ((P.x - A.x) * dx + (P.y - A.y) * dy) / l2)) : 0;
      const d = Math.hypot(P.x - (A.x + dx * u), P.y - (A.y + dy * u));
      if (d > bd) { bd = d; best = i; }
    }
    if (best >= 0) { keep[best] = 1; stack.push([a, best], [best, b]); }
  }
  return keep;
}
