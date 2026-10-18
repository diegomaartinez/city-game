// Construye el nivel de país (Iberia): costa y fronteras de Natural Earth (paquete world-atlas),
// ciudades, aeropuertos y autopistas de OpenStreetMap. Se ejecuta en GitHub Actions junto con build-levels.
//   node --experimental-transform-types scripts/build-country.ts
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fetchOsm, bboxOf, type OsmResponse } from '../src/data/overpass.ts';
import { CITY_VERSION, type City, type Pt, type RoadWay } from '../src/data/types.ts';
import { Game } from '../src/sim/game.ts';
import { ALWAYS, CANARIAS, FRAME, MIN_POP, borders, coast, finishCities, foreign, inCanarias, land, makeLevel, place } from './country-geo.ts';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const outDir = path.join(root, 'public', 'levels');
const indexPath = path.join(outDir, 'index.json');
console.log(`tierra: ${land.length} polígonos propios, ${foreign.length} vecinos, ${borders.length} fronteras, ${coast.length} tramos de costa`);

// ───────────── OpenStreetMap ─────────────
const frameBox = bboxOf(FRAME.south, FRAME.west, FRAME.north, FRAME.east);
const canBox = bboxOf(CANARIAS.south, CANARIAS.west, CANARIAS.north, CANARIAS.east);
// maxsize solo en la consulta grande (y por debajo del tope de overpass-api.de, que responde 406 si se pasa)
const q = (body: string, timeout = 300, maxsize = 0) => `[out:json][timeout:${timeout}]${maxsize ? `[maxsize:${maxsize}]` : ''};\n(\n${body}\n);\nout geom;`;
const log = (p: { phase: string; bytes: number; server: string }) => { if (p.phase === 'downloading' && p.bytes % 10_000_000 < 300_000) console.log(`  ${p.server} ${(p.bytes / 1e6).toFixed(0)} MB`); };
/** Los servidores públicos limitan por IP y los runners de GitHub van muy usados: se insiste con pausas largas. */
async function fetchPatient(query: string): Promise<OsmResponse> {
  let last: Error | null = null;
  for (let i = 0; i < 4; i++) {
    try { return await fetchOsm(query); } catch (e) { last = e as Error; console.log(`  intento ${i + 1} fallido: ${last.message.slice(0, 200)}`); }
    await new Promise(r => setTimeout(r, 90_000));
  }
  throw last;
}

console.log('ciudades…');
const citiesRes: OsmResponse = await fetchPatient(q(`node["place"~"^(city|town)$"]["population"]${frameBox};\n  node["place"~"^(city|town)$"]["population"]${canBox};\n  node["place"~"^(city|town)$"]["capital"]${frameBox};`));
console.log('aeropuertos…');
const airRes: OsmResponse = await fetchPatient(q(`nwr["aeroway"="aerodrome"]["iata"]${frameBox};\n  nwr["aeroway"="aerodrome"]["iata"]${canBox};`));
console.log('autopistas…');
const roadRes: OsmResponse = await fetchPatient(q(`way["highway"~"^(motorway|trunk)$"]${frameBox};\n  way["highway"~"^(motorway|trunk)$"]${canBox};`, 900, 1_000_000_000));

// ciudades
const cities: City[] = [];
const popOf = (s: string | undefined) => { const n = parseInt((s ?? '').replace(/[^\d]/g, ''), 10); return Number.isFinite(n) ? n : 0; };
for (const el of citiesRes.elements) {
  if (el.type !== 'node' || el.lat === undefined || el.lon === undefined || !el.tags?.name) continue;
  const t = el.tags;
  const name = t['name:es'] && t['name:es'] !== t.name && /ES/.test(t['ISO3166-1'] ?? '') ? t.name : t.name;
  const pop = popOf(t.population);
  const always = ALWAYS.includes(name) || ALWAYS.includes(t['name:es'] ?? '') || ALWAYS.includes(t['name:ca'] ?? '');
  if (pop < MIN_POP && !always) continue;
  const p = place(el.lon, el.lat);
  if (!p) continue;
  const inset = inCanarias(el.lon, el.lat);
  // país por el polígono que lo contiene (aprox. por nombre de país en etiquetas, si no, por posición)
  const cc = t['is_in:country_code'] ?? t['addr:country'] ?? guessCountry(el.lon, el.lat);
  cities.push({ id: el.id, name, x: p.x, y: p.y, lat: el.lat, lon: el.lon, pop: Math.max(pop, 20_000), airport: false, coastal: false, country: cc, inset: inset || undefined });
}

function guessCountry(lon: number, lat: number): string {
  if (lon < -6.2 && lat < 42.15 && lat > 36.9 && !(lat < 37.3 && lon > -7.5)) return 'PT';
  if (lon > 1.4 && lon < 1.8 && lat > 42.4 && lat < 42.7) return 'AD';
  return 'ES';
}

// aeropuertos (centro de la pista) → ciudad más cercana
const airportPts: Pt[] = [];
for (const el of airRes.elements) {
  let lat = el.lat, lon = el.lon;
  if (lat === undefined && el.geometry?.length) { lat = el.geometry.reduce((a, p) => a + p.lat, 0) / el.geometry.length; lon = el.geometry.reduce((a, p) => a + p.lon, 0) / el.geometry.length; }
  if (lat === undefined || lon === undefined) continue;
  const p = place(lon, lat);
  if (p) airportPts.push(p);
}
const kept = finishCities(cities, airportPts);
console.log(`ciudades: ${cities.length} candidatas → ${kept.length} · aeropuertos: ${kept.filter(c => c.airport).length} · costeras: ${kept.filter(c => c.coastal).length}`);

// autopistas → RoadWay (clase 'primary' para que el bus pueda circular; trunk → 'secondary')
const roads: RoadWay[] = [];
for (const el of roadRes.elements) {
  if (el.type !== 'way' || !el.geometry || !el.nodes) continue;
  const t = el.tags ?? {};
  const pts: Pt[] = [], nodes: number[] = [];
  el.geometry.forEach((g, i) => { const p = place(g.lon, g.lat); if (p) { pts.push(p); nodes.push(el.nodes![i]); } });
  if (pts.length < 2) continue;
  roads.push({ id: el.id, cls: t.highway === 'motorway' ? 'primary' : 'secondary', name: t.ref ?? t.name, oneway: t.oneway === 'yes' || t.highway === 'motorway', pts, nodes, layer: 0 });
}
console.log(`autopistas: ${roads.length} tramos, ${roads.reduce((a, r) => a + r.pts.length, 0)} puntos`);

// ───────────── nivel ─────────────
const city = makeLevel(kept, roads);
const game = new Game(city, 'creativo');
const json = JSON.stringify(city);
const gz = zlib.gzipSync(Buffer.from(json), { level: 9 });
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'iberia.json.gz'), gz);
const index: Array<Record<string, unknown>> = fs.existsSync(indexPath) ? JSON.parse(fs.readFileSync(indexPath, 'utf8')) : [];
const info = { id: 'iberia', kind: 'country', name: 'España y Portugal', subtitle: 'Toda la península, Baleares, Canarias, Ceuta y Melilla: une sus ciudades en tren, bus, avión y barco.', radius: city.radius, population: game.demand.population, jobs: game.demand.jobCount, buildings: 0, cities: kept.length, districts: game.demand.districts.k, file: 'iberia.json.gz', bytes: gz.length, version: CITY_VERSION, builtAt: new Date().toISOString(), def: 'iberia-v1' };
const i = index.findIndex(l => l.id === 'iberia');
if (i >= 0) index[i] = info; else index.push(info);
fs.writeFileSync(indexPath, JSON.stringify(index, null, 2) + '\n');
console.log(`iberia: ${(json.length / 1e6).toFixed(1)} MB → ${(gz.length / 1e6).toFixed(2)} MB gz · ${kept.length} ciudades · ${info.population.toLocaleString('es-ES')} hab · ${(city.halfW! * 2 / 1000).toFixed(0)} × ${(city.halfH! * 2 / 1000).toFixed(0)} km`);
