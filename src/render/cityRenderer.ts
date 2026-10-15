// Dibuja la ciudad (zonas verdes, calles, edificios, zonas, servicios, coches) sobre la escena.
import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import type { Area, Pt, ServiceKind } from '../data/types.ts';
import type { City, Lot, ServiceSite } from '../sim/city.ts';
import { tileKey } from '../sim/city.ts';
import { CELL, Kind } from '../sim/grid.ts';
import { DRIVABLE, ROAD_WIDTH } from '../sim/graph.ts';
import { SERVICE_DEF } from '../sim/defs.ts';
import type { Traffic } from '../sim/traffic.ts';
import type { World } from './world.ts';
import { ASPHALT_NEW, CEMETERY, CREAM, GRASS, INK, PARK, PARK_DARK, ROAD_FILL, SHADOW, SHADOW_ALPHA, SHADOW_DIR, WATER, WATER_EDGE, WOOD, ZONE_COLOR, buildingColor } from './palette.ts';

const flat = (poly: Pt[]) => { const a = new Array<number>(poly.length * 2); for (let i = 0; i < poly.length; i++) { a[i * 2] = poly[i].x; a[i * 2 + 1] = poly[i].y; } return a; };

export class CityRenderer {
  private tiles = new Map<string, { shadow: Graphics; body: Graphics }>();
  private roadsG = new Graphics();
  private dashesG = new Graphics();
  private trafficG = new Graphics();
  private zonesG = new Graphics();
  private servicesG = new Graphics();
  private carSprites: Sprite[] = [];
  private carTexture: Texture;
  showTraffic = false;
  private trafficTimer = 0;

  constructor(private world: World, private city: City, private traffic: Traffic) {
    world.roads.addChild(this.roadsG, this.dashesG);
    world.traffic.addChild(this.trafficG);
    world.zones.addChild(this.zonesG);
    world.services.addChild(this.servicesG);
    this.carTexture = this.makeCarTexture();
    city.on('buildings', tiles => { for (const t of tiles) this.rebuildTile(t); });
    city.on('roads', () => { this.drawRoads(); this.trafficG.clear(); });
    city.on('zones', () => this.drawZones());
    city.on('services', () => this.drawServices());
  }

  drawAll(): void {
    this.world.drawGround(this.city.data.radius);
    this.drawAreas(this.city.data.areas);
    this.drawRoads();
    const keys = new Set<string>();
    for (const l of this.city.lots.values()) keys.add(tileKey(l.cx, l.cy));
    for (const k of keys) this.rebuildTile(k);
    this.drawZones();
    this.drawServices();
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
    // arbolitos en los parques grandes
    const trees = new Graphics();
    let seed = 11;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (const a of areas) {
      if (a.kind !== 'park' && a.kind !== 'wood') continue;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const p of a.poly) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
      const area = (x1 - x0) * (y1 - y0);
      const n = Math.min(400, Math.floor(area / 900));
      for (let i = 0; i < n; i++) {
        const x = x0 + rnd() * (x1 - x0), y = y0 + rnd() * (y1 - y0);
        if (!inPoly(x, y, a.poly)) continue;
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
  drawRoads(): void {
    const g = this.roadsG, d = this.dashesG;
    g.clear(); d.clear();
    const { nodes, edges } = this.city.graph;
    const byClass = new Map<string, number[]>();
    for (let i = 0; i < edges.length; i++) {
      const e = edges[i];
      if (e.removed) continue;
      const key = e.cls + (e.origin === 'built' ? '+' : '');
      let l = byClass.get(key); if (!l) byClass.set(key, (l = [])); l.push(i);
    }
    const order = ['pedestrian', 'service', 'residential', 'tertiary', 'secondary', 'primary', 'motorway'];
    // contorno de tinta, acera crema y asfalto, en tres pasadas
    for (const cls of order) for (const suffix of ['', '+']) {
      const list = byClass.get(cls + suffix); if (!list) continue;
      const w = ROAD_WIDTH[cls as keyof typeof ROAD_WIDTH];
      for (const i of list) { const e = edges[i]; g.moveTo(nodes[e.a].x, nodes[e.a].y).lineTo(nodes[e.b].x, nodes[e.b].y); }
      g.stroke({ color: INK, width: w + (DRIVABLE(cls as never) ? 3.2 : 1.4), cap: 'round', join: 'round', alpha: 0.9 });
    }
    for (const cls of order) for (const suffix of ['', '+']) {
      if (!DRIVABLE(cls as never)) continue;
      const list = byClass.get(cls + suffix); if (!list) continue;
      const w = ROAD_WIDTH[cls as keyof typeof ROAD_WIDTH];
      for (const i of list) { const e = edges[i]; g.moveTo(nodes[e.a].x, nodes[e.a].y).lineTo(nodes[e.b].x, nodes[e.b].y); }
      g.stroke({ color: CREAM, width: w + 2.0, cap: 'round', join: 'round' });
    }
    for (const cls of order) for (const suffix of ['', '+']) {
      const list = byClass.get(cls + suffix); if (!list) continue;
      const w = ROAD_WIDTH[cls as keyof typeof ROAD_WIDTH];
      for (const i of list) { const e = edges[i]; g.moveTo(nodes[e.a].x, nodes[e.a].y).lineTo(nodes[e.b].x, nodes[e.b].y); }
      g.stroke({ color: suffix ? ASPHALT_NEW : ROAD_FILL[cls as keyof typeof ROAD_FILL], width: w, cap: 'round', join: 'round' });
    }
    // línea central discontinua en las vías principales
    for (const cls of ['primary', 'motorway', 'secondary']) for (const suffix of ['', '+']) {
      const list = byClass.get(cls + suffix); if (!list) continue;
      for (const i of list) {
        const e = edges[i]; const a = nodes[e.a], b = nodes[e.b];
        const len = e.len; if (len < 6) continue;
        const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;
        for (let s = 2; s < len - 2; s += 9) {
          const t = Math.min(len - 2, s + 4.5);
          d.moveTo(a.x + ux * s, a.y + uy * s).lineTo(a.x + ux * t, a.y + uy * t);
        }
      }
    }
    d.stroke({ color: CREAM, width: 0.7, alpha: 0.85, cap: 'round' });
  }

  /** Capa de tráfico: colorea cada tramo según lo cargado que va. */
  private drawTraffic(): void {
    const g = this.trafficG;
    g.clear();
    if (!this.showTraffic) return;
    const { nodes, edges } = this.city.graph;
    const buckets: Array<{ color: number; items: number[] }> = [
      { color: 0x7fc47c, items: [] }, { color: 0xe8b23c, items: [] }, { color: 0xe57a2e, items: [] }, { color: 0xd23b33, items: [] },
    ];
    for (let i = 0; i < edges.length; i++) {
      const e = edges[i];
      if (e.removed || !DRIVABLE(e.cls) || e.load === 0) continue;
      const r = e.load / e.capacity;
      buckets[r < 0.3 ? 0 : r < 0.6 ? 1 : r < 0.9 ? 2 : 3].items.push(i);
    }
    for (const b of buckets) {
      if (!b.items.length) continue;
      for (const i of b.items) { const e = edges[i]; g.moveTo(nodes[e.a].x, nodes[e.a].y).lineTo(nodes[e.b].x, nodes[e.b].y); }
      g.stroke({ color: b.color, width: 3.5, alpha: 0.75, cap: 'round' });
    }
  }

  // ───────────── edificios por teselas ─────────────
  private rebuildTile(key: string): void {
    let t = this.tiles.get(key);
    if (!t) {
      t = { shadow: new Graphics(), body: new Graphics() };
      this.tiles.set(key, t);
      this.world.shadows.addChild(t.shadow);
      this.world.buildings.addChild(t.body);
    }
    const { shadow, body } = t;
    shadow.clear(); body.clear();
    const lots: Lot[] = [];
    for (const l of this.city.lots.values()) if (tileKey(l.cx, l.cy) === key) lots.push(l);
    for (const l of lots) {
      const h = l.levels * 3 + 1;
      const ox = SHADOW_DIR.x * h, oy = SHADOW_DIR.y * h;
      const pts = new Array<number>(l.poly.length * 2);
      for (let i = 0; i < l.poly.length; i++) { pts[i * 2] = l.poly[i].x + ox; pts[i * 2 + 1] = l.poly[i].y + oy; }
      shadow.poly(pts, true).fill({ color: SHADOW, alpha: SHADOW_ALPHA });
    }
    for (const l of lots) {
      const color = buildingColor(l.use, l.id);
      body.poly(flat(l.poly), true).fill(color).stroke({ color: INK, width: 0.9, alpha: 0.9, join: 'round' });
      const pending = this.city.pendingZone(l);
      if (pending) body.poly(flat(l.poly), true).stroke({ color: ZONE_COLOR[pending], width: 2.2, alpha: 0.95, join: 'round' });
      if (l.service) this.drawServiceMark(body, l.service, l.cx, l.cy, 3.2);
      else if (l.origin === 'built' && l.levels > 1) {
        // azotea: un rectángulo más claro en lo alto para que se note la altura
        const k = 0.55 + 0.1 * Math.min(4, l.levels);
        const cx = l.cx, cy = l.cy;
        const inner = l.poly.map(p => ({ x: cx + (p.x - cx) * k, y: cy + (p.y - cy) * k }));
        body.poly(flat(inner), true).fill({ color: 0xffffff, alpha: 0.18 }).stroke({ color: INK, width: 0.5, alpha: 0.35 });
      }
    }
  }

  private drawServiceMark(g: Graphics, kind: ServiceKind, x: number, y: number, r: number): void {
    g.circle(x, y, r + 1).fill(CREAM).stroke({ color: INK, width: 0.6 });
    switch (kind) {
      case 'health': g.rect(x - r * 0.25, y - r * 0.75, r * 0.5, r * 1.5).fill(0xd23b33); g.rect(x - r * 0.75, y - r * 0.25, r * 1.5, r * 0.5).fill(0xd23b33); break;
      case 'school': g.circle(x, y, r * 0.55).fill(0xf0bf3c); break;
      case 'police': g.circle(x, y, r * 0.55).fill(0x2f6fc4); break;
      case 'fire': g.circle(x, y, r * 0.55).fill(0xd23b33); break;
      case 'power': g.circle(x, y, r * 0.55).fill(0x3b3b40); break;
      case 'water': g.circle(x, y, r * 0.55).fill(0x64a2ea); break;
      case 'park': g.circle(x, y, r * 0.55).fill(0x7fa85e); break;
    }
  }

  // ───────────── zonas ─────────────
  private drawZones(): void {
    const g = this.zonesG;
    g.clear();
    const { grid } = this.city;
    for (let z = 1; z <= 3; z++) {
      let any = false;
      for (let i = 0; i < grid.zone.length; i++) {
        if (grid.zone[i] !== z || grid.kind[i] !== Kind.Free) continue;
        const cx = i % grid.w, cy = (i / grid.w) | 0;
        g.rect(grid.x0 + cx * CELL + 0.6, grid.y0 + cy * CELL + 0.6, CELL - 1.2, CELL - 1.2);
        any = true;
      }
      if (any) g.fill({ color: ZONE_COLOR[z], alpha: 0.38 });
    }
  }

  // ───────────── servicios colocados ─────────────
  private drawServices(): void {
    const g = this.servicesG;
    g.clear();
    for (const s of this.city.services) if (s.origin === 'placed') this.drawService(g, s);
  }

  drawService(g: Graphics, s: ServiceSite): void {
    const def = SERVICE_DEF[s.kind];
    const h = s.kind === 'park' ? 1 : 7;
    const half = def.size / 2;
    const c = Math.cos(s.angle), sn = Math.sin(s.angle);
    const corner = (x: number, y: number) => [s.x + x * c - y * sn, s.y + x * sn + y * c];
    const rect = [...corner(-half, -half), ...corner(half, -half), ...corner(half, half), ...corner(-half, half)];
    if (h > 1) g.poly(rect.map((v, i) => v + (i % 2 === 0 ? SHADOW_DIR.x * h : SHADOW_DIR.y * h)), true).fill({ color: SHADOW, alpha: SHADOW_ALPHA });
    const color = parseInt(def.color.slice(1), 16);
    g.poly(rect, true).fill(color).stroke({ color: INK, width: 1, join: 'round' });
    switch (s.kind) {
      case 'power': { const [x, y] = corner(half * 0.45, -half * 0.4); g.circle(x, y, 4).fill(0x3b3b40).stroke({ color: INK, width: 0.6 }); g.circle(x, y, 2).fill(0x6b6b70); break; }
      case 'water': g.circle(s.x, s.y, half * 0.55).fill(0x2f6fc4).stroke({ color: INK, width: 0.7 }); g.circle(s.x - 2, s.y - 2, half * 0.2).fill({ color: 0xffffff, alpha: 0.5 }); break;
      case 'park': {
        g.poly(rect, true).fill(PARK);
        let seed = s.id * 7919 + 3;
        const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
        for (let i = 0; i < 7; i++) {
          const [x, y] = corner((rnd() * 2 - 1) * half * 0.7, (rnd() * 2 - 1) * half * 0.7);
          const r = 2.2 + rnd() * 1.8;
          g.circle(x - 1, y + 1, r).fill({ color: SHADOW, alpha: 0.2 });
          g.circle(x, y, r).fill(0x6f9a52).stroke({ color: INK, width: 0.5, alpha: 0.7 });
        }
        break;
      }
      default: this.drawServiceMark(g, s.kind, s.x, s.y, half * 0.38);
    }
  }

  // ───────────── coches ─────────────
  private makeCarTexture(): Texture {
    const c = document.createElement('canvas');
    const S = 10; // px por metro
    c.width = Math.ceil(4.4 * S) + 4; c.height = Math.ceil(2.1 * S) + 4;
    const ctx = c.getContext('2d')!;
    ctx.translate(2, 2);
    ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#2a2522'; ctx.lineWidth = 2; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.roundRect(0, 0, 4.4 * S, 2.1 * S, 5); ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(40,45,60,.75)';
    ctx.beginPath(); ctx.roundRect(1.5 * S, 0.25 * S, 1.3 * S, 1.6 * S, 3); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,.18)';
    ctx.fillRect(0, 1.6 * S, 4.4 * S, 0.5 * S);
    return Texture.from(c);
  }

  updateCars(dt: number): void {
    const cars = this.traffic.cars;
    const container = this.world.cars;
    while (this.carSprites.length < cars.length) {
      const s = new Sprite(this.carTexture);
      s.anchor.set(0.5);
      container.addChild(s);
      this.carSprites.push(s);
    }
    while (this.carSprites.length > cars.length) { const s = this.carSprites.pop()!; container.removeChild(s); s.destroy(); }
    const base = 1 / 10; // la textura está a 10 px/m
    const scale = base * Math.max(1, 2.6 / (this.world.zoom * 2.1));
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i], s = this.carSprites[i];
      s.position.set(c.x, c.y);
      s.rotation = c.angle;
      s.tint = c.color;
      s.scale.set(scale);
    }
    this.trafficTimer += dt;
    if (this.showTraffic && this.trafficTimer > 0.6) { this.trafficTimer = 0; this.drawTraffic(); }
    if (!this.showTraffic && this.trafficG.visible) this.trafficG.clear();
  }

  /** Dibuja una silueta de servicio como previsualización. */
  previewService(target: Container, kind: ServiceKind, x: number, y: number, angle: number, ok: boolean): void {
    target.removeChildren();
    const g = new Graphics();
    const def = SERVICE_DEF[kind];
    g.circle(x, y, def.radius).fill({ color: ok ? 0x7fc47c : 0xd23b33, alpha: 0.08 }).stroke({ color: ok ? 0x7fa85e : 0xd23b33, width: 1.5, alpha: 0.6 });
    this.drawService(g, { id: 0, kind, x, y, angle, origin: 'placed', cells: [] });
    g.alpha = ok ? 0.85 : 0.5;
    target.addChild(g);
  }
}

function inPoly(x: number, y: number, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
