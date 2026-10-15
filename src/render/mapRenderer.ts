// Dibuja la ciudad real (zonas verdes, agua, calles con puentes y túneles, edificios). Es estática:
// se construye una vez por teselas y solo se muestran las teselas que están en pantalla.
import { Graphics } from 'pixi.js';
import type { Area, Building, CityData, Pt, ServiceKind } from '../data/types.ts';
import { pointInPoly } from '../data/geo.ts';
import { DRIVABLE, ROAD_WIDTH, type RoadGraph } from '../sim/graph.ts';
import type { World } from './world.ts';
import { CEMETERY, CREAM, GRASS, INK, PARK, PARK_DARK, ROAD_FILL, SHADOW, SHADOW_ALPHA, SHADOW_DIR, WATER, WATER_EDGE, WOOD, buildingColor } from './palette.ts';

const TILE = 256;
const flat = (poly: Pt[]) => { const a = new Array<number>(poly.length * 2); for (let i = 0; i < poly.length; i++) { a[i * 2] = poly[i].x; a[i * 2 + 1] = poly[i].y; } return a; };

interface Tile { x0: number; y0: number; shadow: Graphics; body: Graphics }

export class MapRenderer {
  private tiles: Tile[] = [];

  constructor(private world: World, private data: CityData, private graph: RoadGraph) {}

  drawAll(): void {
    this.world.drawGround(this.data.radius);
    this.drawAreas(this.data.areas);
    this.drawRoads();
    this.drawBuildings(this.data.buildings);
  }

  // ───────────── zonas verdes y agua ─────────────
  private drawAreas(areas: Area[]): void {
    const g = new Graphics();
    for (const a of areas) {
      const pts = flat(a.poly);
      switch (a.kind) {
        case 'water': g.poly(pts, true).fill(WATER).stroke({ color: WATER_EDGE, width: 1.5, alpha: 0.8 }); break;
        case 'park': g.poly(pts, true).fill(PARK).stroke({ color: PARK_DARK, width: 1.2, alpha: 0.9 }); break;
        case 'wood': g.poly(pts, true).fill(WOOD).stroke({ color: PARK_DARK, width: 1.2, alpha: 0.9 }); break;
        case 'grass': g.poly(pts, true).fill(GRASS).stroke({ color: PARK_DARK, width: 1, alpha: 0.6 }); break;
        case 'cemetery': g.poly(pts, true).fill(CEMETERY).stroke({ color: PARK_DARK, width: 1, alpha: 0.6 }); break;
        case 'plaza': g.poly(pts, true).fill(CREAM).stroke({ color: INK, width: 0.8, alpha: 0.5 }); break;
      }
    }
    const trees = new Graphics();
    let seed = 11;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (const a of areas) {
      if (a.kind !== 'park' && a.kind !== 'wood') continue;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const p of a.poly) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
      const n = Math.min(400, Math.floor(((x1 - x0) * (y1 - y0)) / 900));
      for (let i = 0; i < n; i++) {
        const x = x0 + rnd() * (x1 - x0), y = y0 + rnd() * (y1 - y0);
        if (!pointInPoly(x, y, a.poly)) continue;
        const r = 2.5 + rnd() * 3;
        trees.circle(x - r * 0.4, y + r * 0.5, r).fill({ color: SHADOW, alpha: 0.18 });
        trees.circle(x, y, r).fill(rnd() < 0.5 ? 0x7fa85e : 0x6f9a52).stroke({ color: INK, width: 0.6, alpha: 0.7 });
        trees.circle(x - r * 0.3, y - r * 0.3, r * 0.4).fill({ color: 0xa9c97e, alpha: 0.8 });
      }
    }
    this.world.areas.removeChildren();
    this.world.areas.addChild(g, trees);
  }

  // ───────────── calles ─────────────
  private drawRoads(): void {
    const { nodes, edges } = this.graph;
    const order = ['pedestrian', 'service', 'residential', 'tertiary', 'secondary', 'primary', 'motorway'] as const;
    const layers = [...new Set(edges.filter(e => !e.removed).map(e => e.layer))].sort((a, b) => a - b);
    this.world.roads.removeChildren();
    for (const layer of layers) {
      const g = new Graphics();
      const byClass = new Map<string, number[]>();
      for (let i = 0; i < edges.length; i++) {
        const e = edges[i];
        if (e.removed || e.layer !== layer) continue;
        let l = byClass.get(e.cls); if (!l) byClass.set(e.cls, (l = [])); l.push(i);
      }
      const path = (list: number[]) => { for (const i of list) { const e = edges[i]; g.moveTo(nodes[e.a].x, nodes[e.a].y).lineTo(nodes[e.b].x, nodes[e.b].y); } };
      const tunnel = layer < 0, bridge = layer > 0;
      // contorno de tinta
      for (const cls of order) {
        const list = byClass.get(cls); if (!list) continue;
        const w = ROAD_WIDTH[cls];
        path(list);
        if (tunnel) g.stroke({ color: INK, width: w + 1.2, cap: 'butt', alpha: 0.35 });
        else g.stroke({ color: INK, width: w + (DRIVABLE(cls) || cls === 'motorway' ? (bridge ? 4.6 : 3.2) : 1.4), cap: 'round', join: 'round', alpha: 0.9 });
      }
      // acera
      if (!tunnel) for (const cls of order) {
        if (cls === 'pedestrian') continue;
        const list = byClass.get(cls); if (!list) continue;
        path(list);
        g.stroke({ color: bridge ? 0xd9d2c0 : CREAM, width: ROAD_WIDTH[cls] + 2.0, cap: 'round', join: 'round' });
      }
      // asfalto
      for (const cls of order) {
        const list = byClass.get(cls); if (!list) continue;
        path(list);
        g.stroke({ color: tunnel ? 0x9a948e : ROAD_FILL[cls], width: ROAD_WIDTH[cls], cap: tunnel ? 'butt' : 'round', join: 'round', alpha: tunnel ? 0.55 : 1 });
      }
      // línea central discontinua en vías principales (no en túneles)
      if (!tunnel) {
        const d = new Graphics();
        for (const cls of ['primary', 'motorway', 'secondary'] as const) {
          const list = byClass.get(cls); if (!list) continue;
          for (const i of list) {
            const e = edges[i]; const a = nodes[e.a], b = nodes[e.b];
            if (e.len < 6) continue;
            const ux = (b.x - a.x) / e.len, uy = (b.y - a.y) / e.len;
            for (let s = 2; s < e.len - 2; s += 9) { const t = Math.min(e.len - 2, s + 4.5); d.moveTo(a.x + ux * s, a.y + uy * s).lineTo(a.x + ux * t, a.y + uy * t); }
          }
        }
        d.stroke({ color: CREAM, width: 0.7, alpha: 0.85, cap: 'round' });
        this.world.roads.addChild(g, d);
      } else this.world.roads.addChild(g);
    }
  }

  // ───────────── edificios por teselas ─────────────
  private drawBuildings(buildings: Building[]): void {
    const groups = new Map<string, Building[]>();
    for (const b of buildings) {
      const k = `${Math.floor(b.cx / TILE)},${Math.floor(b.cy / TILE)}`;
      let l = groups.get(k); if (!l) groups.set(k, (l = [])); l.push(b);
    }
    for (const [k, list] of groups) {
      const [tx, ty] = k.split(',').map(Number);
      const shadow = new Graphics(), body = new Graphics();
      for (const b of list) {
        const h = b.levels * 3 + 1;
        const ox = SHADOW_DIR.x * h, oy = SHADOW_DIR.y * h;
        const pts = new Array<number>(b.poly.length * 2);
        for (let i = 0; i < b.poly.length; i++) { pts[i * 2] = b.poly[i].x + ox; pts[i * 2 + 1] = b.poly[i].y + oy; }
        shadow.poly(pts, true).fill({ color: SHADOW, alpha: SHADOW_ALPHA });
      }
      for (const b of list) {
        body.poly(flat(b.poly), true).fill(buildingColor(b.use, b.id)).stroke({ color: INK, width: 0.9, alpha: 0.9, join: 'round' });
        if (b.service) MapRenderer.serviceMark(body, b.service, b.cx, b.cy, 3.2);
      }
      this.world.shadows.addChild(shadow);
      this.world.buildings.addChild(body);
      this.tiles.push({ x0: tx * TILE, y0: ty * TILE, shadow, body });
    }
  }

  static serviceMark(g: Graphics, kind: ServiceKind, x: number, y: number, r: number): void {
    g.circle(x, y, r + 1).fill(CREAM).stroke({ color: INK, width: 0.6 });
    switch (kind) {
      case 'health': g.rect(x - r * 0.25, y - r * 0.75, r * 0.5, r * 1.5).fill(0xd23b33); g.rect(x - r * 0.75, y - r * 0.25, r * 1.5, r * 0.5).fill(0xd23b33); break;
      case 'school': g.circle(x, y, r * 0.55).fill(0xf0bf3c); break;
      case 'police': g.circle(x, y, r * 0.55).fill(0x2f6fc4); break;
      case 'fire': g.circle(x, y, r * 0.55).fill(0xd23b33); break;
    }
  }

  /** Oculta las teselas de edificios que quedan fuera de la pantalla. */
  cull(): void {
    const w = this.world;
    const tl = w.toWorld(0, 0), br = w.toWorld(w.width, w.height);
    const margin = 40;
    for (const t of this.tiles) {
      const vis = t.x0 + TILE + margin > tl.x && t.x0 - margin < br.x && t.y0 + TILE + margin > tl.y && t.y0 - margin < br.y;
      t.shadow.visible = vis; t.body.visible = vis;
    }
  }

  /** Nombre de edificio o calle bajo un punto. */
  describe(x: number, y: number): { text: string; sub?: string } | null {
    for (const b of this.data.buildings) {
      if (Math.abs(b.cx - x) > 80 || Math.abs(b.cy - y) > 80) continue;
      if (pointInPoly(x, y, b.poly)) {
        const use = { residential: 'Viviendas', commercial: 'Comercio y oficinas', industrial: 'Industria', public: 'Equipamiento' }[b.use];
        return { text: b.name ?? use, sub: `${b.name ? use + ' · ' : ''}${b.levels} plantas` };
      }
    }
    const hit = this.graph.nearestEdge(x, y, 8);
    if (hit) {
      const e = this.graph.edges[hit.edge];
      const cls = { motorway: 'Autovía', primary: 'Vía principal', secondary: 'Avenida', tertiary: 'Calle principal', residential: 'Calle', service: 'Vía de servicio', pedestrian: 'Peatonal' }[e.cls];
      const lvl = e.layer < 0 ? ' · túnel' : e.layer > 0 ? ' · puente' : '';
      return { text: e.name ?? cls, sub: `${e.name ? cls + ' · ' : ''}${e.oneway ? 'sentido único' : 'doble sentido'}${lvl}` };
    }
    return null;
  }
}
