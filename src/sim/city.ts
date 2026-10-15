// Estado del juego y reglas de la simulación: zonas, crecimiento, servicios, economía y felicidad.
import type { Building, BuildingUse, CityData, Pt, RoadClass, ServiceKind } from '../data/types.ts';
import { centroid, orientedRect, polygonArea, rng } from '../data/geo.ts';
import { CELL, Grid, Kind, SERVICE_KINDS, Zone } from './grid.ts';
import { ROAD_WIDTH, RoadGraph } from './graph.ts';
import { DEMOLISH_COST, MAX_LEVELS, ROAD_COST, ROAD_UPKEEP_PER_KM, SERVICE_DEF, START_MONEY, TAX_JOB, TAX_RESIDENT, ZONE_COST, capacityOf } from './defs.ts';

export interface Lot extends Building {
  /** Ocupación 0..1 (habitantes o empleos respecto a la capacidad). */
  occ: number;
  cap: number;
}

export interface ServiceSite {
  id: number;
  kind: ServiceKind;
  x: number;
  y: number;
  angle: number;
  origin: 'osm' | 'placed';
  /** Celdas que ocupa (solo los colocados por el jugador). */
  cells: number[];
}

export interface Stats {
  population: number;
  jobs: number;
  jobsCap: number;
  happiness: number;
  demand: { R: number; C: number; I: number };
  congestion: number;
  income: number;
  upkeep: number;
  buildings: number;
}

export interface SaveData {
  v: 1;
  day: number;
  money: number;
  zone: Uint8Array;
  built: Lot[];
  removedOsm: number[];
  osmOcc: Array<[number, number]>;
  services: Array<{ kind: ServiceKind; x: number; y: number }>;
  roadsBuilt: Array<{ a: Pt; b: Pt; cls: RoadClass }>;
  roadsRemoved: Array<{ a: Pt; b: Pt }>;
  savedAt: number;
}

export function zoneOfUse(use: BuildingUse): Zone {
  return use === 'residential' ? Zone.R : use === 'commercial' ? Zone.C : use === 'industrial' ? Zone.I : Zone.None;
}

export const TILE = 256; // metros; los edificios se dibujan por teselas
export function tileKey(x: number, y: number): string { return `${Math.floor(x / TILE)},${Math.floor(y / TILE)}`; }

type Events = {
  buildings: (tiles: Set<string>) => void;
  roads: () => void;
  zones: () => void;
  services: () => void;
  stats: (s: Stats) => void;
  money: (m: number) => void;
  message: (text: string, kind: 'info' | 'warn' | 'good') => void;
};

export type ZoneId = Zone;

export class City {
  readonly grid: Grid;
  readonly graph: RoadGraph;
  readonly lots = new Map<number, Lot>();
  readonly services: ServiceSite[] = [];
  money = START_MONEY;
  /** Día de juego (fraccional). */
  day = 0;
  stats: Stats = { population: 0, jobs: 0, jobsCap: 0, happiness: 60, demand: { R: 0.3, C: 0.1, I: 0.1 }, congestion: 0, income: 0, upkeep: 0, buildings: 0 };
  /** Lo rellena el tráfico cada frame: 0 fluido … 1 colapsado. */
  congestion = 0;
  private nextId = 1_000_000_000;
  private nextServiceId = 1;
  private lastWholeDay = 0;
  private listeners: { [K in keyof Events]?: Events[K][] } = {};
  private random = rng(12345);
  private removedOsm = new Set<number>();
  private roadsBuilt: SaveData['roadsBuilt'] = [];
  private roadsRemoved: SaveData['roadsRemoved'] = [];
  /** Celdas zonificadas y libres por tipo, para muestrear candidatos de crecimiento. */
  private zonedFree: Record<number, number[]> = { 1: [], 2: [], 3: [] };
  private zonedDirty = true;

  constructor(public readonly data: CityData) {
    this.grid = new Grid(data.radius);
    this.graph = RoadGraph.fromRoads(data.roads);
    this.initFromData();
  }

  on<K extends keyof Events>(ev: K, fn: Events[K]): void {
    (this.listeners[ev] ??= []).push(fn as never);
  }
  private emit<K extends keyof Events>(ev: K, ...args: Parameters<Events[K]>): void {
    for (const fn of this.listeners[ev] ?? []) (fn as (...a: unknown[]) => void)(...args);
  }

  // ───────────────────────── inicialización ─────────────────────────

  private initFromData(): void {
    const { grid, data } = this;
    for (const a of data.areas) {
      const k = a.kind === 'water' ? Kind.Water : Kind.Park;
      for (const i of grid.cellsInPoly(a.poly)) if (grid.kind[i] === Kind.Free) grid.kind[i] = k;
    }
    this.markRoadCells();
    for (const b of data.buildings) this.addLot({ ...b, occ: 0.85, cap: capacityOf(b.use, b.area, b.levels) }, false);
    for (const b of data.buildings) if (b.service) this.addServiceSite(b.service, b.cx, b.cy, 0, 'osm', []);
    this.recomputeStats();
  }

  /** Marca en la rejilla las celdas de calle a partir del grafo. */
  private markRoadCells(): void {
    const { grid, graph } = this;
    for (let i = 0; i < grid.kind.length; i++) if (grid.kind[i] === Kind.Road) { grid.kind[i] = Kind.Free; grid.roadEdge[i] = -1; }
    graph.edges.forEach((e, ei) => {
      if (e.removed) return;
      const a = graph.nodes[e.a], b = graph.nodes[e.b];
      for (const i of grid.cellsAlong([a, b], ROAD_WIDTH[e.cls] / 2 + 1)) {
        if (grid.kind[i] === Kind.Free || grid.kind[i] === Kind.Park) { grid.kind[i] = Kind.Road; grid.roadEdge[i] = ei; }
      }
    });
    grid.recomputeRoadDist();
    this.zonedDirty = true;
  }

  private addLot(lot: Lot, notify: boolean): void {
    this.lots.set(lot.id, lot);
    const cells = this.grid.cellsInPoly(lot.poly, { x: lot.cx, y: lot.cy });
    for (const i of cells) { this.grid.kind[i] = Kind.Building; this.grid.building[i] = lot.id; }
    if (notify) this.emit('buildings', new Set([tileKey(lot.cx, lot.cy)]));
  }

  private removeLot(id: number): void {
    const lot = this.lots.get(id);
    if (!lot) return;
    this.lots.delete(id);
    const { grid } = this;
    const keep = zoneOfUse(lot.use);
    for (const i of grid.cellsInPoly(lot.poly, { x: lot.cx, y: lot.cy })) {
      if (grid.building[i] !== id) continue;
      grid.building[i] = 0; grid.kind[i] = Kind.Free;
      if (!grid.zone[i]) grid.zone[i] = keep; // el solar conserva el uso que tenía
    }
    if (lot.origin === 'osm') this.removedOsm.add(id);
    if (lot.service) {
      const si = this.services.findIndex(s => s.origin === 'osm' && s.kind === lot.service && Math.abs(s.x - lot.cx) < 1 && Math.abs(s.y - lot.cy) < 1);
      if (si >= 0) this.removeServiceSite(this.services[si].id, false);
    }
    this.zonedDirty = true;
    this.emit('buildings', new Set([tileKey(lot.cx, lot.cy)]));
  }

  private addServiceSite(kind: ServiceKind, x: number, y: number, angle: number, origin: 'osm' | 'placed', cells: number[]): ServiceSite {
    const s: ServiceSite = { id: this.nextServiceId++, kind, x, y, angle, origin, cells };
    this.services.push(s);
    this.grid.addCoverage(kind, x, y, SERVICE_DEF[kind].radius, 1);
    for (const i of cells) this.grid.kind[i] = kind === 'park' ? Kind.Park : Kind.Service;
    return s;
  }

  private removeServiceSite(id: number, notify: boolean): void {
    const i = this.services.findIndex(s => s.id === id);
    if (i < 0) return;
    const s = this.services[i];
    this.services.splice(i, 1);
    this.grid.addCoverage(s.kind, s.x, s.y, SERVICE_DEF[s.kind].radius, -1);
    for (const c of s.cells) this.grid.kind[c] = Kind.Free;
    if (notify) this.emit('services');
  }

  // ───────────────────────── acciones del jugador ─────────────────────────

  private spend(amount: number, what: string): boolean {
    if (amount > this.money) { this.emit('message', `No hay dinero suficiente para ${what} (${Math.round(amount).toLocaleString('es-ES')} €)`, 'warn'); return false; }
    this.money -= amount;
    this.emit('money', this.money);
    return true;
  }

  /** ¿Se puede pintar esta zona en la celda? Terreno libre junto a una calle, o un edificio (para recalificarlo). */
  canZone(i: number, zone: Zone): boolean {
    const { grid } = this;
    if (grid.zone[i] === zone) return false;
    if (zone === Zone.None) return grid.zone[i] !== 0;
    const k = grid.kind[i];
    if (k === Kind.Free) return grid.roadDist[i] <= 3;
    if (k === Kind.Building) { const l = this.lots.get(grid.building[i]); return !!l && !l.service && zoneOfUse(l.use) !== zone; }
    return false;
  }

  /** Zonifica (o quita la zona, zone = 0) las celdas indicadas. Sobre edificios, los marca para renovarse. */
  zoneCells(cells: number[], zone: Zone): number {
    const { grid } = this;
    const target = cells.filter(i => this.canZone(i, zone));
    if (!target.length) return 0;
    const cost = zone === Zone.None ? 0 : target.length * ZONE_COST;
    if (cost && !this.spend(cost, 'zonificar')) return 0;
    const tiles = new Set<string>();
    for (const i of target) {
      grid.zone[i] = zone;
      if (grid.kind[i] === Kind.Building) { const l = this.lots.get(grid.building[i]); if (l) tiles.add(tileKey(l.cx, l.cy)); }
    }
    this.zonedDirty = true;
    this.emit('zones');
    if (tiles.size) this.emit('buildings', tiles);
    return target.length;
  }

  /** Zona pendiente de un edificio: la que tiene pintada su celda central si no coincide con su uso. */
  pendingZone(lot: Lot): Zone {
    const [cx, cy] = this.grid.cellOf(lot.cx, lot.cy);
    if (!this.grid.inBounds(cx, cy)) return Zone.None;
    const z = this.grid.zone[this.grid.idx(cx, cy)] as Zone;
    return z && z !== zoneOfUse(lot.use) ? z : Zone.None;
  }

  /** Demuele todos los edificios y servicios colocados dentro de un rectángulo de celdas. */
  demolishCells(cells: number[]): number {
    const ids = new Set<number>();
    for (const i of cells) if (this.grid.building[i]) ids.add(this.grid.building[i]);
    const svc = this.services.filter(s => s.origin === 'placed' && s.cells.some(c => cells.includes(c)));
    const total = ids.size + svc.length;
    if (!total) return 0;
    if (!this.spend(total * DEMOLISH_COST, `demoler ${total} edificios`)) return 0;
    for (const id of ids) this.removeLot(id);
    for (const s of svc) this.removeServiceSite(s.id, true);
    this.recomputeStats();
    return total;
  }

  roadCost(p1: Pt, p2: Pt, cls: RoadClass): number {
    return Math.hypot(p2.x - p1.x, p2.y - p1.y) * ROAD_COST[cls];
  }

  /** Comprueba si una calle entre dos puntos pasa por encima de edificios o agua. */
  roadBlocked(p1: Pt, p2: Pt, cls: RoadClass): string | null {
    const cells = this.grid.cellsAlong([p1, p2], ROAD_WIDTH[cls] / 2);
    let water = 0;
    for (const i of cells) {
      const k = this.grid.kind[i];
      if (k === Kind.Building || k === Kind.Service) return 'Hay edificios en el camino';
      if (k === Kind.Water) water++;
    }
    if (water > cells.length * 0.5) return 'No se puede construir sobre el agua';
    return null;
  }

  buildRoad(p1: Pt, p2: Pt, cls: RoadClass): boolean {
    const len = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    if (len < 8) return false;
    const blocked = this.roadBlocked(p1, p2, cls);
    if (blocked) { this.emit('message', blocked, 'warn'); return false; }
    if (!this.spend(this.roadCost(p1, p2, cls), 'construir la calle')) return false;
    const edges = this.graph.buildRoad(p1, p2, cls);
    if (!edges.length) return false;
    this.roadsBuilt.push({ a: { ...p1 }, b: { ...p2 }, cls });
    this.markRoadCells();
    this.emit('roads');
    this.emit('zones');
    return true;
  }

  demolishRoadAt(x: number, y: number): boolean {
    const hit = this.graph.nearestEdge(x, y, 7);
    if (!hit) return false;
    const e = this.graph.edges[hit.edge];
    const a = this.graph.nodes[e.a], b = this.graph.nodes[e.b];
    if (!this.spend(DEMOLISH_COST, 'demoler')) return false;
    this.graph.removeEdge(hit.edge);
    this.roadsRemoved.push({ a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y } });
    this.markRoadCells();
    this.emit('roads');
    this.emit('zones');
    return true;
  }

  lotAt(x: number, y: number): Lot | undefined {
    const [cx, cy] = this.grid.cellOf(x, y);
    if (!this.grid.inBounds(cx, cy)) return undefined;
    const id = this.grid.building[this.grid.idx(cx, cy)];
    return id ? this.lots.get(id) : undefined;
  }

  serviceAt(x: number, y: number): ServiceSite | undefined {
    return this.services.find(s => s.origin === 'placed' && Math.abs(s.x - x) < SERVICE_DEF[s.kind].size / 2 + 2 && Math.abs(s.y - y) < SERVICE_DEF[s.kind].size / 2 + 2);
  }

  demolishAt(x: number, y: number): boolean {
    const lot = this.lotAt(x, y);
    if (lot) {
      if (!this.spend(DEMOLISH_COST, 'demoler')) return false;
      this.removeLot(lot.id);
      this.recomputeStats();
      return true;
    }
    const s = this.serviceAt(x, y);
    if (s) {
      if (!this.spend(DEMOLISH_COST, 'demoler')) return false;
      this.removeServiceSite(s.id, true);
      this.zonedDirty = true;
      return true;
    }
    return this.demolishRoadAt(x, y);
  }

  /** Huella y validez de un servicio en un punto. */
  servicePlacement(kind: ServiceKind, x: number, y: number): { poly: Pt[]; angle: number; cells: number[]; ok: boolean; reason?: string } {
    const def = SERVICE_DEF[kind];
    const ne = this.graph.nearestEdge(x, y, 60);
    let angle = 0;
    if (ne) { const e = this.graph.edges[ne.edge]; const a = this.graph.nodes[e.a], b = this.graph.nodes[e.b]; angle = Math.atan2(b.y - a.y, b.x - a.x); }
    const poly = orientedRect(x, y, def.size, def.size, angle);
    const cells = this.grid.cellsInPoly(poly, { x, y });
    let ok = cells.length > 0, reason: string | undefined;
    for (const i of cells) if (this.grid.kind[i] !== Kind.Free) { ok = false; reason = 'El terreno está ocupado'; break; }
    if (ok && def.needsRoad && !cells.some(i => this.grid.roadDist[i] <= 2)) { ok = false; reason = 'Tiene que estar junto a una calle'; }
    return { poly, angle, cells, ok, reason };
  }

  placeService(kind: ServiceKind, x: number, y: number): boolean {
    const p = this.servicePlacement(kind, x, y);
    if (!p.ok) { if (p.reason) this.emit('message', p.reason, 'warn'); return false; }
    if (!this.spend(SERVICE_DEF[kind].cost, `construir ${SERVICE_DEF[kind].name.toLowerCase()}`)) return false;
    this.addServiceSite(kind, x, y, p.angle, 'placed', p.cells);
    this.zonedDirty = true;
    this.emit('services');
    this.emit('message', `${SERVICE_DEF[kind].name} construido`, 'good');
    return true;
  }

  // ───────────────────────── simulación ─────────────────────────

  /** Avanza la simulación `dtDays` días. Las reglas diarias se aplican por día entero. */
  tick(dtDays: number): void {
    this.day += dtDays;
    const whole = Math.floor(this.day);
    while (this.lastWholeDay < whole) {
      this.lastWholeDay++;
      this.dailyStep();
      if (this.lastWholeDay % 30 === 0) this.monthlyBudget();
    }
  }

  private dailyStep(): void {
    this.grow();
    this.updateOccupancy();
    this.recomputeStats();
  }

  private refreshZoned(): void {
    if (!this.zonedDirty) return;
    this.zonedDirty = false;
    const { grid } = this;
    const out: Record<number, number[]> = { 1: [], 2: [], 3: [] };
    for (let i = 0; i < grid.zone.length; i++) {
      const z = grid.zone[i];
      if (z && grid.kind[i] === Kind.Free && grid.roadDist[i] <= 2) out[z].push(i);
    }
    this.zonedFree = out;
  }

  private grow(): void {
    this.refreshZoned();
    const d = this.stats.demand;
    const plan: Array<[Zone, number]> = [[Zone.R, d.R], [Zone.C, d.C], [Zone.I, d.I]];
    const touched = new Set<string>();
    let built = 0;
    for (const [zone, demand] of plan) {
      if (demand <= 0.05) continue;
      const attempts = Math.ceil(demand * 4);
      for (let k = 0; k < attempts && built < 8; k++) {
        const lot = this.tryBuild(zone);
        if (lot) { touched.add(tileKey(lot.cx, lot.cy)); built++; }
      }
    }
    // Edificios recalificados: cuando hay demanda del nuevo uso, se derriban y el solar se vuelve a construir.
    let renewed = 0;
    for (const lot of this.lots.values()) {
      if (renewed >= 3) break;
      const z = this.pendingZone(lot);
      if (!z) continue;
      const dem = z === Zone.R ? d.R : z === Zone.C ? d.C : d.I;
      if (dem > 0 && this.random() < 0.25) { touched.add(tileKey(lot.cx, lot.cy)); this.removeLot(lot.id); renewed++; }
    }
    // Los edificios crecen en altura cuando están llenos y hay demanda.
    for (const lot of this.lots.values()) {
      if (lot.origin !== 'built' || lot.levels >= MAX_LEVELS[lot.use] || lot.occ < 0.85) continue;
      const dem = lot.use === 'residential' ? d.R : lot.use === 'commercial' ? d.C : d.I;
      if (dem > 0.1 && this.random() < 0.08 * dem) {
        lot.levels++;
        lot.cap = capacityOf(lot.use, lot.area, lot.levels);
        lot.occ *= 0.8;
        touched.add(tileKey(lot.cx, lot.cy));
      }
    }
    if (touched.size) this.emit('buildings', touched);
  }

  private tryBuild(zone: Zone): Lot | null {
    const pool = this.zonedFree[zone];
    if (!pool.length) return null;
    const { grid } = this;
    const use: BuildingUse = zone === Zone.R ? 'residential' : zone === Zone.C ? 'commercial' : 'industrial';
    for (let attempt = 0; attempt < 6; attempt++) {
      const pi = Math.floor(this.random() * pool.length);
      const i = pool[pi];
      if (grid.kind[i] !== Kind.Free || grid.zone[i] !== zone) { pool[pi] = pool[pool.length - 1]; pool.pop(); continue; }
      if (!grid.coverage.power[i] || !grid.coverage.water[i]) continue;
      const c = grid.center(i % grid.w, (i / grid.w) | 0);
      // tamaño en celdas según el tipo, intentando primero el grande
      const sizes = zone === Zone.R ? [2, 2, 2, 1] : zone === Zone.C ? [3, 2, 2, 1] : [3, 3, 2];
      for (const n of sizes) {
        const poly = this.footprint(c, n);
        const cells = grid.cellsInPoly(poly, c);
        if (cells.length < n * n * 0.6) continue;
        if (!cells.every(ci => grid.kind[ci] === Kind.Free && grid.zone[ci] === zone)) continue;
        if (!cells.some(ci => grid.roadDist[ci] <= 2)) continue;
        const area = polygonArea(poly);
        const ctr = centroid(poly);
        const lot: Lot = { id: this.nextId++, use, poly, levels: 1, area, cx: ctr.x, cy: ctr.y, origin: 'built', occ: 0.15, cap: capacityOf(use, area, 1) };
        this.addLot(lot, false);
        for (const ci of cells) { const j = pool.indexOf(ci); if (j >= 0) { pool[j] = pool[pool.length - 1]; pool.pop(); } }
        return lot;
      }
    }
    return null;
  }

  /** Rectángulo de n×n celdas orientado según la calle más cercana. */
  private footprint(c: Pt, n: number): Pt[] {
    const ne = this.graph.nearestEdge(c.x, c.y, 50);
    let angle = 0;
    if (ne) { const e = this.graph.edges[ne.edge]; const a = this.graph.nodes[e.a], b = this.graph.nodes[e.b]; angle = Math.atan2(b.y - a.y, b.x - a.x); }
    const size = n * CELL - 3;
    const w = size * (0.85 + this.random() * 0.3), h = size * (0.85 + this.random() * 0.3);
    return orientedRect(c.x, c.y, w, h, angle);
  }

  private updateOccupancy(): void {
    const s = this.stats;
    const jobRatio = Math.min(1, s.jobsCap / Math.max(1, s.population * 0.55));
    const happy = s.happiness / 100;
    for (const lot of this.lots.values()) {
      let target: number;
      if (lot.use === 'residential') target = 0.45 + 0.4 * jobRatio + 0.15 * happy;
      else target = 0.35 + 0.65 * Math.min(1, (s.population * 0.55) / Math.max(1, s.jobsCap));
      const rate = lot.origin === 'built' ? 0.06 : 0.02;
      lot.occ += (target - lot.occ) * rate;
    }
  }

  recomputeStats(): void {
    let pop = 0, jobs = 0, jobsCap = 0, cCap = 0, iCap = 0;
    let resCount = 0, covSum = 0;
    const { grid } = this;
    for (const lot of this.lots.values()) {
      const v = lot.cap * lot.occ;
      if (lot.use === 'residential') {
        pop += v; resCount++;
        const [cx, cy] = grid.cellOf(lot.cx, lot.cy);
        if (grid.inBounds(cx, cy)) {
          const i = grid.idx(cx, cy);
          covSum += 0.2 * +(grid.coverage.police[i] > 0) + 0.2 * +(grid.coverage.fire[i] > 0) + 0.25 * +(grid.coverage.health[i] > 0) + 0.2 * +(grid.coverage.school[i] > 0) + 0.15 * +(grid.coverage.park[i] > 0 || grid.kind[i] === Kind.Park);
        }
      } else {
        jobs += v; jobsCap += lot.cap;
        if (lot.use === 'commercial') cCap += lot.cap; else if (lot.use === 'industrial') iCap += lot.cap;
      }
    }
    const workers = pop * 0.55;
    const clamp = (v: number) => Math.max(-1, Math.min(1, v));
    const demand = {
      R: clamp((jobsCap - workers) / Math.max(workers, 500) + 0.2),
      C: clamp((pop * 0.22 - cCap) / Math.max(cCap, 300) + 0.12),
      I: clamp((pop * 0.18 - iCap) / Math.max(iCap, 300) + 0.1),
    };
    const avgCov = resCount ? covSum / resCount : 0;
    const happiness = Math.max(5, Math.min(100, 35 + 50 * avgCov + 15 * (1 - this.congestion)));
    const builtKm = this.graph.edges.reduce((acc, e) => acc + (!e.removed && e.origin === 'built' ? e.len : 0), 0) / 1000;
    const upkeep = this.services.reduce((acc, s) => acc + (s.origin === 'placed' ? SERVICE_DEF[s.kind].upkeep : 0), 0) + builtKm * ROAD_UPKEEP_PER_KM;
    const income = pop * TAX_RESIDENT + jobs * TAX_JOB;
    this.stats = { population: Math.round(pop), jobs: Math.round(jobs), jobsCap, happiness, demand, congestion: this.congestion, income, upkeep, buildings: this.lots.size };
    this.emit('stats', this.stats);
  }

  private monthlyBudget(): void {
    const net = this.stats.income - this.stats.upkeep;
    this.money += net;
    this.emit('money', this.money);
    this.emit('message', `Balance del mes: ${net >= 0 ? '+' : ''}${Math.round(net).toLocaleString('es-ES')} €`, net >= 0 ? 'good' : 'warn');
  }

  // ───────────────────────── guardado ─────────────────────────

  toSave(): SaveData {
    const built = [...this.lots.values()].filter(l => l.origin === 'built');
    const osmOcc: Array<[number, number]> = [];
    for (const l of this.lots.values()) if (l.origin === 'osm' && Math.abs(l.occ - 0.85) > 0.01) osmOcc.push([l.id, +l.occ.toFixed(3)]);
    return {
      v: 1, day: this.day, money: this.money, zone: this.grid.zone.slice(), built, removedOsm: [...this.removedOsm], osmOcc,
      services: this.services.filter(s => s.origin === 'placed').map(s => ({ kind: s.kind, x: s.x, y: s.y })),
      roadsBuilt: this.roadsBuilt.slice(), roadsRemoved: this.roadsRemoved.slice(), savedAt: Date.now(),
    };
  }

  loadSave(s: SaveData): void {
    this.day = s.day; this.lastWholeDay = Math.floor(s.day); this.money = s.money;
    for (const r of s.roadsRemoved) {
      const mx = (r.a.x + r.b.x) / 2, my = (r.a.y + r.b.y) / 2;
      const hit = this.graph.nearestEdge(mx, my, 3);
      if (hit) this.graph.removeEdge(hit.edge);
    }
    this.roadsRemoved = s.roadsRemoved.slice();
    for (const r of s.roadsBuilt) this.graph.buildRoad(r.a, r.b, r.cls);
    this.roadsBuilt = s.roadsBuilt.slice();
    this.markRoadCells();
    for (const id of s.removedOsm) this.removeLot(id);
    for (const [id, occ] of s.osmOcc) { const l = this.lots.get(id); if (l) l.occ = occ; }
    for (const b of s.built) { this.addLot(b, false); if (b.id >= this.nextId) this.nextId = b.id + 1; }
    if (s.zone.length === this.grid.zone.length) this.grid.zone.set(s.zone);
    for (const sv of s.services) {
      const p = this.servicePlacement(sv.kind, sv.x, sv.y);
      this.addServiceSite(sv.kind, sv.x, sv.y, p.angle, 'placed', p.cells);
    }
    this.zonedDirty = true;
    this.recomputeStats();
    this.emit('roads'); this.emit('zones'); this.emit('services');
    this.emit('buildings', new Set([...this.lots.values()].map(l => tileKey(l.cx, l.cy))));
    this.emit('money', this.money);
  }

  /** Kinds de servicio en orden de menú. */
  static readonly SERVICE_KINDS = SERVICE_KINDS;
}
