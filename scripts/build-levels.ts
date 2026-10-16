// Descarga de OpenStreetMap las ciudades de levels/levels.json y las deja empaquetadas en public/levels/
// (un .json.gz por nivel más un índice). Se ejecuta en GitHub Actions (node --experimental-transform-types).
//   node --experimental-transform-types scripts/build-levels.ts [--force] [id ...]
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { buildQuery, buildRingQuery, bboxFilter, bboxOf, fetchOsm, type OsmResponse } from '../src/data/overpass.ts';
import { parseOsm } from '../src/data/parse.ts';
import { Projection } from '../src/data/geo.ts';
import { CITY_VERSION } from '../src/data/types.ts';
import { Game } from '../src/sim/game.ts';

interface LevelDef { id: string; name: string; subtitle: string; lat: number; lon: number; radius: number; core: { south: number; west: number; north: number; east: number } }
interface LevelInfo { id: string; name: string; subtitle: string; radius: number; population: number; jobs: number; buildings: number; districts: number; file: string; bytes: number; version: number; builtAt: string }

const root = path.resolve(new URL('..', import.meta.url).pathname);
const outDir = path.join(root, 'public', 'levels');
const indexPath = path.join(outDir, 'index.json');
const args = process.argv.slice(2);
const force = args.includes('--force');
const only = args.filter(a => !a.startsWith('--'));
const defs: LevelDef[] = JSON.parse(fs.readFileSync(path.join(root, 'levels', 'levels.json'), 'utf8'));
fs.mkdirSync(outDir, { recursive: true });
const index: LevelInfo[] = fs.existsSync(indexPath) ? JSON.parse(fs.readFileSync(indexPath, 'utf8')) : [];

for (const def of defs) {
  if (only.length && !only.includes(def.id)) continue;
  const existing = index.find(l => l.id === def.id);
  if (existing && !force && existing.version === CITY_VERSION && fs.existsSync(path.join(outDir, existing.file))) { console.log(`${def.id}: ya construido`); continue; }
  console.log(`${def.id}: descargando núcleo…`);
  const progress = (p: { phase: string; bytes: number; server: string }) => { if (p.phase === 'downloading' && p.bytes % 5_000_000 < 200_000) console.log(`  ${p.server} ${(p.bytes / 1e6).toFixed(1)} MB`); };
  const c = def.core;
  const coreQuery = buildQuery(def.lat, def.lon, def.radius, def.radius, bboxOf(c.south, c.west, c.north, c.east));
  const main: OsmResponse = await fetchOsm(coreQuery, progress);
  console.log(`  núcleo: ${main.elements.length} elementos`);
  console.log(`${def.id}: descargando área metropolitana…`);
  const ring = await fetchOsm(buildRingQuery(def.lat, def.lon, def.radius), progress);
  const seen = new Set(main.elements.map(e => e.type + e.id));
  for (const e of ring.elements) if (!seen.has(e.type + e.id)) main.elements.push(e);
  console.log(`  total: ${main.elements.length} elementos (bbox ${bboxFilter(def.lat, def.lon, def.radius)})`);
  // núcleo en metros locales
  const proj = new Projection(def.lat, def.lon);
  const a = proj.toXY(c.north, c.west), b = proj.toXY(c.south, c.east);
  const coreBox: [number, number, number, number] = [Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y)];
  const { city, stats } = parseOsm(main, def.name, def.lat, def.lon, def.radius, coreBox);
  console.log(`  ${stats.roads} calles, ${stats.buildings} edificios, ${stats.areas} áreas, ${city.zones.length} zonas, ${city.places?.length ?? 0} barrios`);
  const game = new Game(city, 'creativo');
  const json = JSON.stringify(city);
  const gz = zlib.gzipSync(Buffer.from(json), { level: 9 });
  const file = `${def.id}.json.gz`;
  fs.writeFileSync(path.join(outDir, file), gz);
  const info: LevelInfo = { id: def.id, name: def.name, subtitle: def.subtitle, radius: def.radius, population: game.demand.population, jobs: game.demand.jobCount, buildings: stats.buildings, districts: game.demand.districts.k, file, bytes: gz.length, version: CITY_VERSION, builtAt: new Date().toISOString() };
  const i = index.findIndex(l => l.id === def.id);
  if (i >= 0) index[i] = info; else index.push(info);
  console.log(`  ${(json.length / 1e6).toFixed(1)} MB → ${(gz.length / 1e6).toFixed(2)} MB gz · ${info.population.toLocaleString('es-ES')} hab · ${info.districts} barrios`);
}
// el índice respeta el orden de levels.json
index.sort((x, y) => defs.findIndex(d => d.id === x.id) - defs.findIndex(d => d.id === y.id));
fs.writeFileSync(indexPath, JSON.stringify(index, null, 2) + '\n');
console.log('índice:', index.map(l => l.id).join(', '));
