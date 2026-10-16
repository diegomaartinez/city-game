// Convierte la respuesta de Overpass en la ciudad del juego: calles, edificios (con su uso inferido),
// zonas verdes y agua, todo proyectado a metros alrededor del centro.
import type { OsmElement, OsmResponse } from './overpass.ts';
import { CITY_VERSION, CORE_RADIUS, MARGIN, type Area, type AreaKind, type Building, type BuildingUse, type CityData, type Landuse, type PlaceNode, type Pt, type RoadClass, type RoadWay, type ServiceKind, type Zone } from './types.ts';
import { Projection, bbox, centroid, hashInt, pointInPoly, polygonArea } from './geo.ts';
import { seaPolygons } from './coast.ts';

type Tags = Record<string, string>;
type LatLon = { lat: number; lon: number };

const ROAD_CLASS: Record<string, RoadClass> = {
  motorway: 'motorway', trunk: 'motorway', motorway_link: 'primary', trunk_link: 'primary',
  primary: 'primary', primary_link: 'primary',
  secondary: 'secondary', secondary_link: 'secondary',
  tertiary: 'tertiary', tertiary_link: 'tertiary',
  unclassified: 'residential', residential: 'residential', living_street: 'residential',
  service: 'service', pedestrian: 'pedestrian',
};

const RESIDENTIAL = new Set(['residential', 'apartments', 'house', 'detached', 'terrace', 'semidetached_house', 'dormitory', 'bungalow', 'hut', 'garage', 'garages', 'shed', 'cabin', 'farm', 'static_caravan']);
const COMMERCIAL = new Set(['commercial', 'retail', 'office', 'supermarket', 'hotel', 'kiosk', 'mall', 'shop', 'bank', 'restaurant']);
const INDUSTRIAL = new Set(['industrial', 'warehouse', 'factory', 'manufacture', 'depot', 'hangar', 'storage_tank', 'service', 'transformer_tower', 'barn', 'greenhouse', 'silo']);
const PUBLIC = new Set(['church', 'cathedral', 'chapel', 'mosque', 'synagogue', 'temple', 'religious', 'public', 'civic', 'government', 'train_station', 'transportation', 'museum', 'library', 'stadium', 'sports_hall', 'sports_centre', 'parking', 'theatre', 'castle', 'palace', 'monastery', 'convent', 'townhall', 'courthouse', 'pavilion', 'grandstand', 'toilets', 'bridge']);
const SKIP = new Set(['roof', 'carport', 'construction', 'ruins', 'no', 'collapsed', 'proposed']);
const COMMERCIAL_AMENITY = new Set(['restaurant', 'cafe', 'bar', 'pub', 'fast_food', 'bank', 'marketplace', 'cinema', 'nightclub', 'pharmacy', 'fuel', 'food_court', 'ice_cream', 'casino']);
const PUBLIC_AMENITY = new Set(['place_of_worship', 'townhall', 'library', 'theatre', 'community_centre', 'courthouse', 'museum', 'arts_centre', 'public_building', 'social_facility', 'bus_station', 'post_office', 'embassy', 'prison']);

function serviceFromTags(t: Tags): ServiceKind | undefined {
  const a = t.amenity, b = t.building, h = t.healthcare;
  if (a === 'hospital' || b === 'hospital' || h === 'hospital' || a === 'clinic') return 'health';
  if (a === 'school' || a === 'kindergarten' || a === 'college' || a === 'university' || b === 'school' || b === 'university' || b === 'college' || b === 'kindergarten') return 'school';
  if (a === 'police' || b === 'police') return 'police';
  if (a === 'fire_station' || b === 'fire_station') return 'fire';
  return undefined;
}

function inferUse(t: Tags, cx: number, cy: number, landuses: Landuse[]): { use: BuildingUse; service?: ServiceKind } | null {
  const b = t.building ?? 'yes';
  if (SKIP.has(b)) return null;
  const service = serviceFromTags(t);
  if (service) return { use: 'public', service };
  const a = t.amenity;
  if (PUBLIC.has(b) || (a && PUBLIC_AMENITY.has(a)) || t.tourism === 'attraction' || t.historic) return { use: 'public' };
  if (INDUSTRIAL.has(b) || t.industrial || t.craft) return { use: 'industrial' };
  if (COMMERCIAL.has(b) || t.shop || t.office || (a && COMMERCIAL_AMENITY.has(a)) || t.tourism === 'hotel') return { use: 'commercial' };
  if (RESIDENTIAL.has(b)) return { use: 'residential' };
  // building=yes u otro: según el uso del suelo que lo rodea
  for (const lu of landuses) {
    const [x0, y0, x1, y1] = lu.bbox;
    if (cx < x0 || cx > x1 || cy < y0 || cy > y1) continue;
    if (pointInPoly(cx, cy, lu.poly)) return { use: lu.kind };
  }
  return { use: 'residential' };
}

function inferLevels(t: Tags, use: BuildingUse, id: number): number {
  const lv = parseFloat(t['building:levels'] ?? '');
  if (lv > 0 && lv < 80) return Math.max(1, Math.round(lv));
  const h = parseFloat(t.height ?? '');
  if (h > 0 && h < 300) return Math.max(1, Math.round(h / 3.2));
  const r = hashInt(id) % 4;
  switch (use) {
    case 'residential': return 2 + r;          // 2–5
    case 'commercial': return 2 + (r % 3);     // 2–4
    case 'industrial': return 1 + (r % 2);     // 1–2
    case 'public': return 2 + (r % 2);         // 2–3
  }
}

/** Une tramos de un multipolígono en anillos cerrados (los "outer" de parques, ríos y edificios grandes). */
function assembleRings(parts: LatLon[][]): LatLon[][] {
  const rings: LatLon[][] = [];
  const pool = parts.filter(p => p.length >= 2).map(p => p.slice());
  const same = (a: LatLon, b: LatLon) => Math.abs(a.lat - b.lat) < 1e-7 && Math.abs(a.lon - b.lon) < 1e-7;
  while (pool.length) {
    const ring = pool.shift()!;
    let grew = true;
    while (grew && !same(ring[0], ring[ring.length - 1])) {
      grew = false;
      const end = ring[ring.length - 1];
      for (let i = 0; i < pool.length; i++) {
        const p = pool[i];
        if (same(p[0], end)) { ring.push(...p.slice(1)); pool.splice(i, 1); grew = true; break; }
        if (same(p[p.length - 1], end)) { ring.push(...p.slice(0, -1).reverse()); pool.splice(i, 1); grew = true; break; }
      }
    }
    if (ring.length >= 4 && same(ring[0], ring[ring.length - 1])) rings.push(ring);
  }
  return rings;
}

export interface ParseStats { roads: number; buildings: number; areas: number; services: number }

export function parseOsm(res: OsmResponse, name: string, lat: number, lon: number, radius: number, coreBox?: [number, number, number, number]): { city: CityData; stats: ParseStats } {
  const proj = new Projection(lat, lon);
  const core = Math.min(radius, CORE_RADIUS);
  // ¿cae un punto dentro del núcleo con edificios? (rectángulo explícito en los niveles, cuadrado por radio si no)
  const inCore = coreBox
    ? (x: number, y: number) => x > coreBox[0] + 150 && x < coreBox[2] - 150 && y > coreBox[1] + 150 && y < coreBox[3] - 150
    : (x: number, y: number) => Math.max(Math.abs(x), Math.abs(y)) < core * 0.95;
  const toPoly = (g: LatLon[]): Pt[] => {
    const pts = g.map(p => proj.toXY(p.lat, p.lon));
    if (pts.length > 1) {
      const a = pts[0], b = pts[pts.length - 1];
      if (Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6) pts.pop();
    }
    return pts;
  };
  const isClosed = (g: LatLon[]) => g.length >= 4 && Math.abs(g[0].lat - g[g.length - 1].lat) < 1e-9 && Math.abs(g[0].lon - g[g.length - 1].lon) < 1e-9;

  const landuses: Landuse[] = [];
  const roads: RoadWay[] = [];
  const areas: Area[] = [];
  const buildingCandidates: Array<{ id: number; tags: Tags; poly: Pt[] }> = [];
  const serviceAreas: Array<{ kind: ServiceKind; poly: Pt[] }> = [];
  const coastlines: Pt[][] = [];
  const places: PlaceNode[] = [];
  const limit = radius + MARGIN; // la isla jugable

  const inRange = (poly: Pt[]) => poly.some(p => Math.abs(p.x) <= limit && Math.abs(p.y) <= limit);

  const areaKind = (t: Tags): AreaKind | undefined => {
    if (t.natural === 'water' || t.waterway === 'riverbank' || t.landuse === 'reservoir' || t.landuse === 'basin') return 'water';
    if (t.leisure === 'park' || t.leisure === 'garden' || t.leisure === 'playground' || t.leisure === 'pitch' || t.leisure === 'dog_park') return 'park';
    if (t.landuse === 'cemetery') return 'cemetery';
    if (t.landuse === 'forest' || t.natural === 'wood' || t.natural === 'scrub') return 'wood';
    if (t.landuse === 'grass' || t.landuse === 'meadow' || t.landuse === 'village_green') return 'grass';
    if (((t.highway === 'pedestrian' || t.highway === 'footway') && t.area === 'yes') || t.place === 'square') return 'plaza';
    return undefined;
  };

  for (const el of res.elements as OsmElement[]) {
    const t = el.tags ?? {};
    if (el.type === 'node') {
      if (t.name && el.lat !== undefined && el.lon !== undefined && (t.place === 'neighbourhood' || t.place === 'quarter' || t.place === 'suburb' || t.place === 'town' || t.place === 'village')) {
        const p = proj.toXY(el.lat, el.lon);
        if (Math.abs(p.x) <= limit && Math.abs(p.y) <= limit) places.push({ name: t.name, kind: t.place, x: p.x, y: p.y });
      }
      continue;
    }
    if (el.type === 'way' && el.geometry) {
      const g = el.geometry;
      if (t.natural === 'coastline') { coastlines.push(g.map(p => proj.toXY(p.lat, p.lon))); continue; }
      if (t.highway && ROAD_CLASS[t.highway] && t.area !== 'yes') {
        if (t.highway === 'service' && (t.service === 'parking_aisle' || t.service === 'driveway' || t.service === 'drive-through')) continue;
        const pts = g.map(p => proj.toXY(p.lat, p.lon));
        if (pts.length < 2 || !inRange(pts)) continue;
        let nodes = el.nodes ? el.nodes.slice() : pts.map((_, i) => -(el.id * 1000 + i));
        let oneway = t.oneway === 'yes' || t.oneway === 'true' || t.oneway === '1' || t.junction === 'roundabout';
        if (t.oneway === '-1') { pts.reverse(); nodes = nodes.reverse(); oneway = true; }
        let layer = parseInt(t.layer ?? '', 10);
        if (!Number.isFinite(layer)) layer = t.tunnel && t.tunnel !== 'no' ? -1 : t.bridge && t.bridge !== 'no' ? 1 : 0;
        if (layer === 0 && t.tunnel && t.tunnel !== 'no') layer = -1;
        if (layer === 0 && t.bridge && t.bridge !== 'no') layer = 1;
        roads.push({ id: el.id, cls: ROAD_CLASS[t.highway], name: t.name, oneway, pts, nodes, layer });
        continue;
      }
      if (!isClosed(g)) continue;
      const poly = toPoly(g);
      if (poly.length < 3 || !inRange(poly)) continue;
      if (t.building) { buildingCandidates.push({ id: el.id, tags: t, poly }); continue; }
      const lu = t.landuse;
      if (lu === 'residential' || lu === 'commercial' || lu === 'industrial' || lu === 'retail') {
        landuses.push({ kind: lu === 'retail' ? 'commercial' : lu, poly, bbox: bbox(poly) });
        continue;
      }
      const ak = areaKind(t);
      if (ak) { areas.push({ id: el.id, kind: ak, poly }); continue; }
      const sv = serviceFromTags(t);
      if (sv) serviceAreas.push({ kind: sv, poly });
    } else if (el.type === 'relation' && el.members) {
      const outers = el.members.filter(m => m.type === 'way' && m.geometry && (m.role === 'outer' || m.role === '')).map(m => m.geometry!);
      const rings = assembleRings(outers);
      for (const ring of rings) {
        const poly = toPoly(ring);
        if (poly.length < 3 || !inRange(poly)) continue;
        if (t.building) buildingCandidates.push({ id: el.id, tags: t, poly });
        else {
          const ak = areaKind(t);
          if (ak) areas.push({ id: el.id, kind: ak, poly });
          else if (t.landuse === 'residential' || t.landuse === 'commercial' || t.landuse === 'industrial' || t.landuse === 'retail') landuses.push({ kind: t.landuse === 'retail' ? 'commercial' : t.landuse, poly, bbox: bbox(poly) });
        }
      }
    }
  }

  // El agua y los parques grandes al fondo: ordena por área descendente para que los pequeños se vean encima.
  areas.sort((a, b) => polygonArea(b.poly) - polygonArea(a.poly));
  // El mar va primero de todo, y las islas (bucles de costa con tierra dentro) encima del mar.
  if (coastlines.length) {
    const { sea, islands } = seaPolygons(coastlines, limit);
    areas.unshift(...sea.map((poly, i) => ({ id: -1 - i, kind: 'sea' as AreaKind, poly })), ...islands.map((poly, i) => ({ id: -1000 - i, kind: 'land' as AreaKind, poly })));
  }

  const buildings: Building[] = [];
  const seen = new Set<number>();
  let services = 0;
  for (const c of buildingCandidates) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    const area = polygonArea(c.poly);
    if (area < 8) continue;
    const ctr = centroid(c.poly);
    const inf = inferUse(c.tags, ctr.x, ctr.y, landuses);
    if (!inf) continue;
    const levels = inferLevels(c.tags, inf.use, c.id);
    // edificios de equipamiento en recintos (hospital, colegio) que no llevan la etiqueta en el propio edificio
    let service = inf.service;
    if (!service && inf.use !== 'industrial') {
      for (const sa of serviceAreas) if (pointInPoly(ctr.x, ctr.y, sa.poly)) { service = sa.kind; break; }
    }
    if (service) services++;
    buildings.push({ id: c.id, use: service ? 'public' : inf.use, poly: c.poly, levels, area, cx: ctr.x, cy: ctr.y, service, name: c.tags.name });
  }

  // Fuera del núcleo no hay edificios: las zonas de uso del suelo hacen de población y empleos.
  const zones: Zone[] = [];
  for (const lu of landuses) {
    const area = polygonArea(lu.poly);
    if (area < 2000) continue;
    const c = centroid(lu.poly);
    if (inCore(c.x, c.y)) continue; // dentro del núcleo ya hay edificios
    zones.push({ id: zones.length + 1, kind: lu.kind, poly: lu.poly, area, cx: c.x, cy: c.y });
  }

  const city: CityData = { name, lat, lon, radius, core, coreBox, roads, buildings, areas, zones, places, fetchedAt: Date.now(), version: CITY_VERSION };
  return { city, stats: { roads: roads.length, buildings: buildings.length, areas: areas.length, services } };
}
