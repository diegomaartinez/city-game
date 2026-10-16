// Descarga de calles, edificios y zonas verdes de OpenStreetMap con la API Overpass.
// Se prueban varios servidores por orden; el oficial se satura a menudo.

export interface OsmElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  tags?: Record<string, string>;
  // way con `out geom`
  nodes?: number[];
  geometry?: Array<{ lat: number; lon: number }>;
  // relation con `out geom`
  members?: Array<{ type: 'node' | 'way' | 'relation'; ref: number; role: string; geometry?: Array<{ lat: number; lon: number }> }>;
  lat?: number;
  lon?: number;
}

export interface OsmResponse { elements: OsmElement[] }

export const OVERPASS_SERVERS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

export const HIGHWAY_CLASSES = [
  'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street',
  'service', 'pedestrian', 'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link',
];

export const MAJOR_CLASSES = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link'];

/** Cuadrado de lado 2·radius alrededor del centro, como filtro bbox de Overpass (sur,oeste,norte,este). */
export function bboxFilter(lat: number, lon: number, radius: number): string {
  const dLat = radius / 110574;
  const dLon = radius / (111320 * Math.cos((lat * Math.PI) / 180));
  return `(${(lat - dLat).toFixed(6)},${(lon - dLon).toFixed(6)},${(lat + dLat).toFixed(6)},${(lon + dLon).toFixed(6)})`;
}

/** Consulta del núcleo detallado: todas las calles, edificios, parques y agua. */
export function buildQuery(lat: number, lon: number, radius: number, coastRadius = radius): string {
  const a = bboxFilter(lat, lon, radius);
  return `[out:json][timeout:180];
(
  way["highway"~"^(${HIGHWAY_CLASSES.join('|')})$"]${a};
  way["building"]${a};
  relation["building"]["type"="multipolygon"]${a};
  way["leisure"~"^(park|garden|playground|pitch|dog_park)$"]${a};
  relation["leisure"="park"]${a};
  way["landuse"~"^(grass|forest|meadow|residential|commercial|industrial|retail|cemetery|village_green)$"]${a};
  way["natural"~"^(water|wood|scrub)$"]${a};
  relation["natural"="water"]${a};
  way["waterway"="riverbank"]${a};
  way["amenity"~"^(hospital|school|police|fire_station|university|college)$"]${a};
  way["natural"="coastline"]${bboxFilter(lat, lon, coastRadius * 1.15 + 300)};
  node["place"~"^(neighbourhood|quarter|suburb)$"]${a};
);
out geom;`;
}

/** Consulta del anillo exterior (área metropolitana): calles principales, zonas de uso del suelo, parques y agua. */
export function buildRingQuery(lat: number, lon: number, radius: number): string {
  const a = bboxFilter(lat, lon, radius);
  return `[out:json][timeout:240];
(
  way["highway"~"^(${MAJOR_CLASSES.join('|')})$"]${a};
  way["landuse"~"^(residential|commercial|industrial|retail|forest|cemetery)$"]${a};
  relation["landuse"~"^(residential|commercial|industrial|retail)$"]["type"="multipolygon"]${a};
  way["leisure"="park"]${a};
  relation["leisure"="park"]${a};
  way["natural"~"^(water|wood)$"]${a};
  relation["natural"="water"]${a};
  way["waterway"="riverbank"]${a};
  node["place"~"^(neighbourhood|quarter|suburb)$"]${a};
);
out geom;`;
}

export interface FetchProgress { phase: 'connecting' | 'downloading' | 'parsing'; bytes: number; server: string; attempt: number; part: 1 | 2; parts: 1 | 2 }

/** Descarga el núcleo y, si el radio es mayor que `core`, también el anillo exterior; devuelve todo junto. */
export async function fetchCity(
  lat: number, lon: number, radius: number, core: number,
  onProgress?: (p: FetchProgress) => void,
  signal?: AbortSignal,
): Promise<OsmResponse> {
  const parts: 1 | 2 = radius > core ? 2 : 1;
  const main = await fetchOsm(buildQuery(lat, lon, Math.min(radius, core), radius), p => onProgress?.({ ...p, part: 1, parts }), signal);
  if (parts === 1) return main;
  const ring = await fetchOsm(buildRingQuery(lat, lon, radius), p => onProgress?.({ ...p, part: 2, parts }), signal);
  const seen = new Set(main.elements.map(e => e.type + e.id));
  for (const e of ring.elements) if (!seen.has(e.type + e.id)) main.elements.push(e);
  return main;
}

export async function fetchOsm(
  query: string,
  onProgress?: (p: Omit<FetchProgress, 'part' | 'parts'>) => void,
  signal?: AbortSignal,
): Promise<OsmResponse> {
  const body = 'data=' + encodeURIComponent(query);
  const errors: string[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    for (const server of OVERPASS_SERVERS) {
      if (signal?.aborted) throw new Error('cancelado');
      const host = new URL(server).host;
      onProgress?.({ phase: 'connecting', bytes: 0, server: host, attempt });
      const ctrl = new AbortController();
      const onAbort = () => ctrl.abort();
      signal?.addEventListener('abort', onAbort);
      const timer = setTimeout(() => ctrl.abort(), 300_000);
      try {
        const r = await fetch(server, { method: 'POST', body, signal: ctrl.signal, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
        if (!r.ok || !r.body) { errors.push(`${host}: HTTP ${r.status}`); continue; }
        const reader = r.body.getReader();
        const chunks: Uint8Array[] = [];
        let bytes = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value); bytes += value.byteLength;
          onProgress?.({ phase: 'downloading', bytes, server: host, attempt });
        }
        onProgress?.({ phase: 'parsing', bytes, server: host, attempt });
        const all = new Uint8Array(bytes);
        let off = 0;
        for (const c of chunks) { all.set(c, off); off += c.byteLength; }
        const text = new TextDecoder().decode(all);
        if (!text.startsWith('{')) { errors.push(`${host}: respuesta no válida`); continue; }
        const json = JSON.parse(text) as OsmResponse & { remark?: string };
        if (json.remark && /timed out|runtime error/i.test(json.remark) && json.elements.length === 0) {
          errors.push(`${host}: ${json.remark}`); continue;
        }
        return json;
      } catch (e) {
        if (signal?.aborted) throw new Error('cancelado');
        errors.push(`${host}: ${(e as Error).message}`);
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
      }
    }
    // breve pausa antes de la segunda vuelta
    await new Promise(res => setTimeout(res, 3000));
  }
  throw new Error('No se pudo descargar el mapa. ' + errors.join(' · '));
}
