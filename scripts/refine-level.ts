// Vuelve a afinar un nivel ya empaquetado (sin descargar nada de OpenStreetMap):
//   node --experimental-transform-types scripts/refine-level.ts coruna
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import type { CityData } from '../src/data/types.ts';
import { refine } from './refine.ts';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const outDir = path.join(root, 'public', 'levels');
const indexPath = path.join(outDir, 'index.json');
const index: Array<Record<string, unknown>> = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
for (const id of process.argv.slice(2)) {
  const info = index.find(l => l.id === id);
  if (!info) { console.error(`${id}: no está en el índice`); process.exitCode = 1; continue; }
  const file = path.join(outDir, info.file as string);
  const city = JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString('utf8')) as CityData;
  const t0 = Date.now();
  const ref = refine(city);
  const json = JSON.stringify(city);
  const gz = zlib.gzipSync(Buffer.from(json), { level: 9 });
  fs.writeFileSync(file, gz);
  info.bytes = gz.length;
  console.log(`${id}: ${ref.merged} puntos de calzadas dobles fundidos, ${ref.blocks} manzanas (de ${city.buildings.length} edificios), puntos de calle ${ref.pts[0]} → ${ref.pts[1]} · ${(json.length / 1e6).toFixed(1)} MB → ${(gz.length / 1e6).toFixed(2)} MB gz · ${Date.now() - t0} ms`);
}
fs.writeFileSync(indexPath, JSON.stringify(index, null, 2) + '\n');
