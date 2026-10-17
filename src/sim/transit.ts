// Red de transporte: paradas, líneas, vehículos y viajeros, con búsqueda de rutas por la red.
import type { Pt } from '../data/types.ts';
import { DRIVABLE, HASH, NEAR_STOP, ROAD_WIDTH, RoadGraph } from './graph.ts';

export type Mode = 'bus' | 'metro';

export interface ModeDef {
  name: string;
  stopName: string;
  capacity: number;
  /** m/s en tiempo de juego a velocidad normal. */
  speed: number;
  /** Segundos parado en cada parada. */
  dwell: number;
  /** Hasta qué distancia camina un viajero hasta la parada (m). */
  walk: number;
  stopCost: number;
  vehicleCost: number;
  /** Coste por vehículo y día. */
  upkeep: number;
  /** Coste por metro de túnel (solo metro). */
  trackCost: number;
}

/** Personas que representa cada viajero dibujado. */
export const PEOPLE_PER_PASSENGER = 10;

export const MODE: Record<Mode, ModeDef> = {
  bus:   { name: 'Bus',   stopName: 'Parada de bus',    capacity: 8,  speed: 40, dwell: 2.5, walk: 330, stopCost: 3000,   vehicleCost: 120000, upkeep: 600,  trackCost: 0 },
  metro: { name: 'Metro', stopName: 'Estación de metro', capacity: 80, speed: 90, dwell: 4,   walk: 500, stopCost: 150000, vehicleCost: 500000, upkeep: 2000, trackCost: 800 },
};

/** Precio del billete por modo (editable en el juego). */
export const FARES: Record<Mode, number> = { bus: 1.5, metro: 2 };

/** Probabilidad de que un viajero acepte el precio. */
export function fareAcceptance(fare: number): number {
  return Math.max(0.35, Math.min(1, 1.15 - 0.15 * fare));
}

export const LINE_COLORS = [0xd23b33, 0x2f6fc4, 0xf0bf3c, 0x3c8d4f, 0xe57a2e, 0x8e5bb5, 0x1fa3a3, 0xe88a82, 0x6b4f2a, 0x3b3b40];

export const PATIENCE = 80;        // segundos de espera antes de rendirse
export const TRANSFER_COST = 35;   // penalización de transbordo (s) al planificar
export const BOARD_COST = 20;      // espera estimada al subir (s)

export interface Leg { line: number; from: number; to: number }

export interface Passenger {
  id: number;
  from: number;
  to: number;
  legs: Leg[];
  leg: number;
  born: number;
  waitSince: number;
  /** Barrio de destino (índice en Demand.districts), para colorear al viajero. */
  dest: number;
}

export interface Stop {
  id: number;
  mode: Mode;
  x: number;
  y: number;
  /** Nodo del grafo de calles (bus) o -1 (metro). */
  node: number;
  /** Punto sobre la calle donde se detiene el vehículo (bus). */
  rx: number;
  ry: number;
  name: string;
  lines: number[];
  queue: Passenger[];
  /** Viajeros que se rindieron aquí recientemente (para el dibujo). */
  frustrated: number;
}

export interface Segment { pts: Pt[]; cum: number[]; len: number; straight: boolean }

export interface Vehicle {
  line: Line;
  dir: 1 | -1;
  seg: number;
  s: number;
  passengers: Passenger[];
  dwell: number;
  x: number; y: number; angle: number;
  /** Índice de parada en la que está detenido, o -1 en marcha. */
  atStop: number;
}

export interface Line {
  id: number;
  mode: Mode;
  color: number;
  name: string;
  stops: number[];
  /** Puntos de paso entre cada parada y la siguiente (vias[i] va de stops[i] a stops[i+1]; el último cierra el bucle). */
  vias: Pt[][];
  loop: boolean;
  fwd: Segment[];
  back: Segment[];
  length: number;
  vehicles: Vehicle[];
  /** Tramos sin ruta por calles (se dibujan rectos). */
  warnings: number;
  boarded: number;
  boardedToday: number;
  incomeToday: number;
}

export interface NetworkStats { delivered: number; lost: number; spawned: number; unserved: number; tripTime: number; trips: number }

export class Network {
  stops = new Map<number, Stop>();
  lines = new Map<number, Line>();
  version = 0;
  private nextStop = 1;
  private nextLine = 1;
  private nextPassenger = 1;
  private planCache = new Map<string, Leg[] | null>();
  private planVersion = -1;
  stats: NetworkStats = { delivered: 0, lost: 0, spawned: 0, unserved: 0, tripTime: 0, trips: 0 };
  onDelivered: (p: Passenger, t: number) => void = () => undefined;

  constructor(public graph: RoadGraph) {}

  // ───────────── paradas ─────────────

  /** Dónde quedaría una parada: para el bus se ajusta a la calle transitable más cercana. */
  placement(mode: Mode, x: number, y: number): { ok: boolean; x: number; y: number; rx: number; ry: number; edge: number; t: number; reason?: string; name?: string } {
    if (mode === 'metro') {
      for (const s of this.stops.values()) if (s.mode === 'metro' && Math.hypot(s.x - x, s.y - y) < 120) return { ok: false, x, y, rx: x, ry: y, edge: -1, t: 0, reason: 'Demasiado cerca de otra estación' };
      return { ok: true, x, y, rx: x, ry: y, edge: -1, t: 0, name: this.nearestStreetName(x, y) };
    }
    const hit = this.nearestDrivableEdge(x, y, 28);
    if (!hit) return { ok: false, x, y, rx: x, ry: y, edge: -1, t: 0, reason: 'Pon la parada junto a una calle' };
    const e = this.graph.edges[hit.edge];
    const a = this.graph.nodes[e.a], b = this.graph.nodes[e.b];
    const rx = a.x + (b.x - a.x) * hit.t, ry = a.y + (b.y - a.y) * hit.t;
    // la marquesina queda a un lado de la calle, del lado donde se hizo clic
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const nx = -(b.y - a.y) / len, ny = (b.x - a.x) / len;
    const side = (x - rx) * nx + (y - ry) * ny >= 0 ? 1 : -1;
    const off = ROAD_WIDTH[e.cls] / 2 + 3;
    for (const s of this.stops.values()) if (s.mode === 'bus' && Math.hypot(s.rx - rx, s.ry - ry) < 40) return { ok: false, x, y, rx, ry, edge: hit.edge, t: hit.t, reason: 'Demasiado cerca de otra parada' };
    return { ok: true, x: rx + nx * off * side, y: ry + ny * off * side, rx, ry, edge: hit.edge, t: hit.t, name: e.name ?? this.nearestStreetName(x, y) };
  }

  private nearestDrivableEdge(x: number, y: number, maxDist: number): { edge: number; t: number; d: number } | null {
    // nearestEdge devuelve la más cercana de cualquier clase; filtra probando radios crecientes
    const g = this.graph;
    let best: { edge: number; t: number; d: number } | null = null;
    const r = Math.ceil(maxDist / HASH);
    const cx = Math.floor(x / HASH), cy = Math.floor(y / HASH);
    const seen = new Set<number>();
    for (let i = cx - r; i <= cx + r; i++) for (let j = cy - r; j <= cy + r; j++) {
      const l = g.edgesInCell(i, j);
      if (!l) continue;
      for (const ei of l) {
        if (seen.has(ei)) continue; seen.add(ei);
        const e = g.edges[ei];
        if (e.removed || !DRIVABLE(e.cls) || e.layer !== 0) continue;
        const a = g.nodes[e.a], b = g.nodes[e.b];
        const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
        let t = l2 > 0 ? ((x - a.x) * dx + (y - a.y) * dy) / l2 : 0;
        t = Math.max(0, Math.min(1, t));
        const d = Math.hypot(x - (a.x + dx * t), y - (a.y + dy * t));
        if (d <= maxDist && (!best || d < best.d)) best = { edge: ei, t, d };
      }
    }
    return best;
  }

  nearestStreetName(x: number, y: number): string {
    const hit = this.graph.nearestEdge(x, y, 80);
    if (hit) { const n = this.graph.edges[hit.edge].name; if (n) return n; }
    return 'Parada';
  }

  addStop(mode: Mode, x: number, y: number): Stop | null {
    const p = this.placement(mode, x, y);
    if (!p.ok) return null;
    let node = -1;
    if (mode === 'bus') node = this.graph.splitEdge(p.edge, p.t);
    const stop: Stop = { id: this.nextStop++, mode, x: p.x, y: p.y, rx: p.rx, ry: p.ry, node, name: this.uniqueName(p.name ?? 'Parada'), lines: [], queue: [], frustrated: 0 };
    this.stops.set(stop.id, stop);
    this.version++;
    return stop;
  }

  private uniqueName(base: string): string {
    const names = new Set([...this.stops.values()].map(s => s.name));
    if (!names.has(base)) return base;
    for (let i = 2; ; i++) if (!names.has(`${base} ${i}`)) return `${base} ${i}`;
  }

  removeStop(id: number): boolean {
    const s = this.stops.get(id);
    if (!s) return false;
    for (const lid of s.lines.slice()) this.removeStopFromLine(lid, id);
    this.stats.lost += s.queue.length;
    this.stops.delete(id);
    this.version++;
    return true;
  }

  stopAt(x: number, y: number, r = 14): Stop | undefined {
    let best: Stop | undefined, bd = r;
    for (const s of this.stops.values()) { const d = Math.hypot(s.x - x, s.y - y); if (d < bd) { bd = d; best = s; } }
    return best;
  }

  // ───────────── líneas ─────────────

  createLine(mode: Mode): Line {
    const used = new Set([...this.lines.values()].map(l => l.color));
    const color = LINE_COLORS.find(c => !used.has(c)) ?? LINE_COLORS[this.lines.size % LINE_COLORS.length];
    const line: Line = { id: this.nextLine++, mode, color, name: `${mode === 'bus' ? 'Línea' : 'Metro'} ${this.nextLine - 1}`, stops: [], vias: [], loop: false, fwd: [], back: [], length: 0, vehicles: [], warnings: 0, boarded: 0, boardedToday: 0, incomeToday: 0 };
    this.lines.set(line.id, line);
    this.version++;
    return line;
  }

  removeLine(id: number): void {
    const line = this.lines.get(id);
    if (!line) return;
    for (const v of line.vehicles) this.stats.lost += v.passengers.length;
    for (const sid of line.stops) { const s = this.stops.get(sid); if (s) s.lines = s.lines.filter(l => l !== id); }
    this.lines.delete(id);
    this.dropPlansUsing(id);
    this.version++;
  }

  /** Añade una parada al final de la línea. Si es la primera parada, cierra el bucle. */
  appendStop(line: Line, stopId: number): 'added' | 'closed' | 'invalid' {
    const s = this.stops.get(stopId);
    if (!s || s.mode !== line.mode) return 'invalid';
    if (line.loop) return 'invalid';
    if (line.stops.length >= 3 && stopId === line.stops[0]) { line.loop = true; line.vias[line.stops.length - 1] = []; this.rebuild(line); return 'closed'; }
    if (line.stops.includes(stopId)) return 'invalid';
    line.stops.push(stopId);
    line.vias = line.stops.map((_, i) => line.vias[i] ?? []);
    if (!s.lines.includes(line.id)) s.lines.push(line.id);
    this.rebuild(line);
    return 'added';
  }

  removeStopFromLine(lineId: number, stopId: number): void {
    const line = this.lines.get(lineId);
    if (!line) return;
    const idx = line.stops.indexOf(stopId);
    line.stops = line.stops.filter(s => s !== stopId);
    if (idx >= 0) {
      // los puntos de paso del tramo anterior y el siguiente se unen
      const before = idx > 0 ? line.vias[idx - 1] ?? [] : [];
      const after = line.vias[idx] ?? [];
      line.vias.splice(idx, 1);
      if (idx > 0) line.vias[idx - 1] = [...before, ...after]; else line.vias[0] = [];
    }
    line.vias = line.stops.map((_, i) => line.vias[i] ?? []);
    const s = this.stops.get(stopId);
    if (s) s.lines = s.lines.filter(l => l !== lineId);
    if (line.stops.length < 3) line.loop = false;
    this.dropPlansUsing(lineId);
    this.rebuild(line);
  }

  /** Longitud de túnel nuevo que supondría añadir una parada (para el coste del metro). */
  extensionLength(line: Line, stopId: number): number {
    if (!line.stops.length) return 0;
    const a = this.stops.get(line.stops[line.stops.length - 1])!, b = this.stops.get(stopId)!;
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  /** Puntos de paso de un tramo: el jugador puede ajustar por dónde va la línea sin añadir paradas. */
  setVias(line: Line, seg: number, vias: Pt[]): void {
    line.vias[seg] = vias;
    this.rebuild(line);
  }

  /** Tramo (índice de fwd) y posición a lo largo de él más cercanos a un punto. */
  nearestSegment(line: Line, x: number, y: number, maxDist: number): { seg: number; t: number; d: number } | null {
    let best: { seg: number; t: number; d: number } | null = null;
    line.fwd.forEach((sg, si) => {
      for (let i = 0; i + 1 < sg.pts.length; i++) {
        const a = sg.pts[i], b = sg.pts[i + 1];
        const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
        let t = l2 > 0 ? ((x - a.x) * dx + (y - a.y) * dy) / l2 : 0;
        t = Math.max(0, Math.min(1, t));
        const d = Math.hypot(x - (a.x + dx * t), y - (a.y + dy * t));
        if (d <= maxDist && (!best || d < best.d)) best = { seg: si, t: (sg.cum[i] + t * (sg.cum[i + 1] - sg.cum[i])) / (sg.len || 1), d };
      }
    });
    return best;
  }

  /** Distancia normalizada a la que cae un punto de paso dentro de su tramo (para ordenarlos). */
  viaPosition(line: Line, seg: number, p: Pt): number {
    const sg = line.fwd[seg];
    if (!sg) return 0;
    let best = 0, bd = Infinity;
    for (let i = 0; i + 1 < sg.pts.length; i++) {
      const a = sg.pts[i], b = sg.pts[i + 1];
      const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
      let t = l2 > 0 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2 : 0;
      t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
      if (d < bd) { bd = d; best = (sg.cum[i] + t * (sg.cum[i + 1] - sg.cum[i])) / (sg.len || 1); }
    }
    return best;
  }

  /** Ajusta un punto de paso a la red: para el bus, al nodo transitable más cercano. */
  snapVia(line: Line, p: Pt): Pt | null {
    if (line.mode === 'metro') return p;
    const n = this.graph.nearestNode(p.x, p.y, 45, true);
    if (n < 0) return null;
    return { x: this.graph.nodes[n].x, y: this.graph.nodes[n].y };
  }

  private rebuild(line: Line): void {
    line.fwd = []; line.back = []; line.warnings = 0;
    const n = line.stops.length;
    line.vias = line.stops.map((_, i) => line.vias[i] ?? []);
    for (let i = 0; i + 1 < n; i++) line.fwd.push(this.segment(line, line.stops[i], line.stops[i + 1], line.vias[i]));
    if (line.loop && n >= 3) line.fwd.push(this.segment(line, line.stops[n - 1], line.stops[0], line.vias[n - 1]));
    if (!line.loop) for (let i = 0; i + 1 < n; i++) line.back.push(this.segment(line, line.stops[i + 1], line.stops[i], line.vias[i].slice().reverse()));
    line.length = line.fwd.reduce((a, s) => a + s.len, 0) + line.back.reduce((a, s) => a + s.len, 0);
    this.spaceVehicles(line);
    this.dropPlansUsing(line.id);
    this.version++;
  }

  private segment(line: Line, fromId: number, toId: number, vias: Pt[] = []): Segment {
    const a = this.stops.get(fromId)!, b = this.stops.get(toId)!;
    const mk = (pts: Pt[], straight: boolean): Segment => {
      const cum = [0];
      for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
      return { pts, cum, len: cum[cum.length - 1], straight };
    };
    if (line.mode === 'metro' || a.node < 0 || b.node < 0) return mk([{ x: a.x, y: a.y }, ...vias.map(v => ({ ...v })), { x: b.x, y: b.y }], true);
    // nodos por los que debe pasar: parada, puntos de paso, parada
    const nodes = [a.node, ...vias.map(v => this.graph.nearestNode(v.x, v.y, 60, true)).filter(n => n >= 0), b.node];
    const pts: Pt[] = [{ x: a.rx, y: a.ry }];
    let straight = false;
    for (let k = 0; k + 1 < nodes.length; k++) {
      const from = nodes[k], to = nodes[k + 1];
      if (from === to) continue;
      // primero respetando los sentidos únicos; si no hay forma, en contra dirección; si tampoco, en recta
      // primero con los sentidos únicos (a contramano solo en tramos cortísimos, penalizado); si no hay forma, sin ellos; si tampoco, en recta
      let path = this.graph.route(from, to, 60000);
      if (!path) path = this.graph.route(from, to, 60000, true);
      if (!path) { line.warnings++; straight = true; const n = this.graph.nodes[to]; pts.push({ x: n.x, y: n.y }); continue; }
      let cur = from, wrong = false;
      const A = this.graph.nodes[from], B = this.graph.nodes[to];
      const farFromStops = (n: number) => { const p = this.graph.nodes[n]; return Math.hypot(p.x - A.x, p.y - A.y) >= NEAR_STOP && Math.hypot(p.x - B.x, p.y - B.y) >= NEAR_STOP; };
      for (const ei of path) {
        const e = this.graph.edges[ei];
        if (e.oneway && e.a !== cur && farFromStops(cur)) wrong = true;
        cur = e.a === cur ? e.b : e.a;
        const n = this.graph.nodes[cur];
        pts.push({ x: n.x, y: n.y });
      }
      if (wrong) line.warnings++;
    }
    pts[pts.length - 1] = { x: b.rx, y: b.ry };
    return mk(pts, straight);
  }

  // ───────────── vehículos ─────────────

  addVehicle(line: Line): Vehicle {
    const v: Vehicle = { line, dir: 1, seg: 0, s: 0, passengers: [], dwell: 0, x: 0, y: 0, angle: 0, atStop: -1 };
    line.vehicles.push(v);
    this.spaceVehicles(line);
    return v;
  }

  removeVehicle(line: Line): Vehicle | undefined {
    const v = line.vehicles.pop();
    if (!v) return undefined;
    // sus viajeros vuelven a esperar en la parada más cercana de la línea
    const sid = line.stops[v.atStop >= 0 ? v.atStop : this.stopIndexAhead(v)];
    const s = this.stops.get(sid);
    for (const p of v.passengers) { if (s) { s.queue.push(p); p.waitSince = 0; } else this.stats.lost++; }
    this.spaceVehicles(line);
    return v;
  }

  private stopIndexAhead(v: Vehicle): number {
    const n = v.line.stops.length;
    return v.dir === 1 ? (v.seg + 1) % n : v.seg;
  }

  /** Reparte los vehículos uniformemente a lo largo del recorrido. */
  private spaceVehicles(line: Line): void {
    const segs = [...line.fwd, ...line.back];
    const total = line.length;
    line.vehicles.forEach((v, i) => {
      this.stats.lost += v.passengers.length;
      v.passengers = []; v.dwell = 0; v.atStop = -1;
      if (!segs.length || total <= 0) { v.dir = 1; v.seg = 0; v.s = 0; const s = this.stops.get(line.stops[0]); if (s) { v.x = s.rx; v.y = s.ry; } return; }
      let d = (i / line.vehicles.length) * total;
      let k = 0;
      while (k < segs.length - 1 && d >= segs[k].len) { d -= segs[k].len; k++; }
      if (k < line.fwd.length) { v.dir = 1; v.seg = k; } else { v.dir = -1; v.seg = line.back.length - 1 - (k - line.fwd.length); }
      v.s = Math.min(d, segs[k].len);
      this.place(v);
    });
  }

  private currentSegment(v: Vehicle): Segment | undefined {
    return v.dir === 1 ? v.line.fwd[v.seg] : v.line.back[v.seg];
  }

  private place(v: Vehicle): void {
    const seg = this.currentSegment(v);
    if (!seg || seg.pts.length < 2) return;
    const { pts, cum } = seg;
    let i = 1;
    while (i < cum.length - 1 && cum[i] < v.s) i++;
    const a = pts[i - 1], b = pts[i];
    const l = cum[i] - cum[i - 1] || 1;
    const t = Math.max(0, Math.min(1, (v.s - cum[i - 1]) / l));
    v.x = a.x + (b.x - a.x) * t; v.y = a.y + (b.y - a.y) * t;
    v.angle = Math.atan2(b.y - a.y, b.x - a.x);
  }

  /** Avanza vehículos y gestiona subidas y bajadas. `now` en segundos de juego. */
  update(dt: number, now: number): void {
    for (const line of this.lines.values()) {
      const def = MODE[line.mode];
      const n = line.stops.length;
      for (const v of line.vehicles) {
        if (n < 2 || !line.fwd.length) continue;
        if (v.dwell > 0) {
          v.dwell -= dt;
          if (v.dwell > 0) continue;
          v.atStop = -1;
          this.advance(v);
          continue;
        }
        const seg = this.currentSegment(v);
        if (!seg) { v.dir = 1; v.seg = 0; v.s = 0; continue; }
        v.s += def.speed * dt;
        if (v.s >= seg.len) {
          v.s = seg.len;
          this.place(v);
          const si = this.stopIndexAhead(v);
          v.atStop = si;
          v.dwell = def.dwell;
          this.exchange(v, si, now);
        } else this.place(v);
      }
    }
  }

  private advance(v: Vehicle): void {
    const line = v.line;
    if (v.dir === 1) {
      if (v.seg + 1 < line.fwd.length) v.seg++;
      else if (line.loop) v.seg = 0;
      else { v.dir = -1; v.seg = line.back.length - 1; }
    } else {
      if (v.seg > 0) v.seg--;
      else { v.dir = 1; v.seg = 0; }
    }
    v.s = 0;
    this.place(v);
  }

  private exchange(v: Vehicle, si: number, now: number): void {
    const line = v.line;
    const stopId = line.stops[si];
    const stop = this.stops.get(stopId);
    if (!stop) return;
    // bajan
    for (let i = v.passengers.length - 1; i >= 0; i--) {
      const p = v.passengers[i];
      const leg = p.legs[p.leg];
      if (leg.to !== stopId) continue;
      v.passengers.splice(i, 1);
      p.leg++;
      if (p.leg >= p.legs.length) {
        this.stats.delivered++; this.stats.tripTime += now - p.born; this.stats.trips++;
        this.onDelivered(p, now - p.born);
      } else { p.waitSince = now; stop.queue.push(p); }
    }
    // suben
    const cap = MODE[line.mode].capacity;
    const n = line.stops.length;
    for (let i = 0; i < stop.queue.length && v.passengers.length < cap;) {
      const p = stop.queue[i];
      const leg = p.legs[p.leg];
      let ok = leg.line === line.id && leg.from === stopId;
      if (ok && !line.loop) {
        const toIdx = line.stops.indexOf(leg.to);
        ok = v.dir === 1 ? toIdx > si : toIdx < si;
      } else if (ok && line.loop) ok = line.stops.includes(leg.to) && n > 1;
      if (ok) { stop.queue.splice(i, 1); v.passengers.push(p); line.boarded++; line.boardedToday++; } else i++;
    }
  }

  /** Los viajeros que llevan demasiado esperando se rinden. */
  expire(now: number): void {
    for (const s of this.stops.values()) {
      const before = s.queue.length;
      s.queue = s.queue.filter(p => now - p.waitSince < PATIENCE);
      const lost = before - s.queue.length;
      if (lost) { this.stats.lost += lost; s.frustrated += lost; }
      s.frustrated *= 0.98;
    }
  }

  // ───────────── viajeros ─────────────

  spawn(from: number, to: number, legs: Leg[], now: number, dest = 0): Passenger {
    const p: Passenger = { id: this.nextPassenger++, from, to, legs, leg: 0, born: now, waitSince: now, dest };
    this.stops.get(from)!.queue.push(p);
    this.stats.spawned++;
    return p;
  }

  private dropPlansUsing(lineId: number): void {
    // al editar una línea, los viajeros que la tenían en su plan vuelven a planificar
    for (const s of this.stops.values()) {
      for (let i = s.queue.length - 1; i >= 0; i--) {
        const p = s.queue[i];
        if (!p.legs.slice(p.leg).some(l => l.line === lineId)) continue;
        const plan = this.plan(s.id, p.to);
        if (plan) { p.legs = plan; p.leg = 0; } else { s.queue.splice(i, 1); this.stats.lost++; }
      }
    }
    for (const line of this.lines.values()) for (const v of line.vehicles) {
      for (let i = v.passengers.length - 1; i >= 0; i--) {
        const p = v.passengers[i];
        if (!p.legs.slice(p.leg + 1).some(l => l.line === lineId)) continue;
        const here = p.legs[p.leg].to;
        const rest = this.plan(here, p.to);
        if (rest) p.legs = [...p.legs.slice(0, p.leg + 1), ...rest]; else { v.passengers.splice(i, 1); this.stats.lost++; }
      }
    }
  }

  /** Tiempo estimado de un tramo de línea entre dos índices consecutivos. */
  private hopTime(line: Line, seg: Segment): number {
    return seg.len / MODE[line.mode].speed + MODE[line.mode].dwell;
  }

  /** Plan de viaje entre dos paradas (lista de tramos), o null si no hay forma de llegar. */
  plan(from: number, to: number): Leg[] | null {
    if (this.planVersion !== this.version) { this.planCache.clear(); this.planVersion = this.version; }
    const key = `${from}-${to}`;
    const cached = this.planCache.get(key);
    if (cached !== undefined) return cached;
    const result = this.dijkstra(from, to);
    this.planCache.set(key, result);
    return result;
  }

  private dijkstra(from: number, to: number): Leg[] | null {
    if (from === to) return [];
    type State = { stop: number; line: number };
    const key = (s: State) => s.stop * 4096 + (s.line + 1);
    const dist = new Map<number, number>();
    const prev = new Map<number, { k: number; leg?: Leg }>();
    const open: Array<[number, State]> = [[0, { stop: from, line: -1 }]];
    dist.set(key(open[0][1]), 0);
    const push = (d: number, s: State, pk: number, leg?: Leg) => {
      const k = key(s);
      if (d < (dist.get(k) ?? Infinity)) { dist.set(k, d); prev.set(k, { k: pk, leg }); open.push([d, s]); }
    };
    let bestKey = -1;
    while (open.length) {
      let bi = 0;
      for (let i = 1; i < open.length; i++) if (open[i][0] < open[bi][0]) bi = i;
      const [d, s] = open[bi]; open[bi] = open[open.length - 1]; open.pop();
      const k = key(s);
      if (d > (dist.get(k) ?? Infinity)) continue;
      if (s.stop === to) { bestKey = k; break; }
      const stop = this.stops.get(s.stop);
      if (!stop) continue;
      if (s.line === -1) {
        for (const lid of stop.lines) push(d + BOARD_COST, { stop: s.stop, line: lid }, k);
      } else {
        const line = this.lines.get(s.line)!;
        push(d + (prev.get(k)?.leg ? TRANSFER_COST : 0), { stop: s.stop, line: -1 }, k);
        const idx = line.stops.indexOf(s.stop);
        if (idx < 0) continue;
        const n = line.stops.length;
        if (idx + 1 < n) push(d + this.hopTime(line, line.fwd[idx]), { stop: line.stops[idx + 1], line: s.line }, k, { line: s.line, from: s.stop, to: line.stops[idx + 1] });
        else if (line.loop && n >= 3) push(d + this.hopTime(line, line.fwd[n - 1]), { stop: line.stops[0], line: s.line }, k, { line: s.line, from: s.stop, to: line.stops[0] });
        if (!line.loop && idx > 0) push(d + this.hopTime(line, line.back[idx - 1]), { stop: line.stops[idx - 1], line: s.line }, k, { line: s.line, from: s.stop, to: line.stops[idx - 1] });
      }
    }
    if (bestKey < 0) return null;
    const hops: Leg[] = [];
    let k = bestKey;
    while (prev.has(k)) { const p = prev.get(k)!; if (p.leg) hops.push(p.leg); k = p.k; }
    hops.reverse();
    // compacta saltos consecutivos de la misma línea en un solo tramo
    const legs: Leg[] = [];
    for (const h of hops) {
      const last = legs[legs.length - 1];
      if (last && last.line === h.line && last.to === h.from) last.to = h.to; else legs.push({ ...h });
    }
    return legs;
  }

  /** Precio de un plan: el billete más caro de los modos que usa. */
  planFare(legs: Leg[]): number {
    let f = 0;
    for (const leg of legs) { const l = this.lines.get(leg.line); if (l) f = Math.max(f, FARES[l.mode]); }
    return f;
  }

  /** Tiempo estimado (s) de un plan, para comparar alternativas. */
  planTime(legs: Leg[]): number {
    let t = 0;
    for (const leg of legs) {
      const line = this.lines.get(leg.line)!;
      t += BOARD_COST;
      let i = line.stops.indexOf(leg.from), j = line.stops.indexOf(leg.to);
      const n = line.stops.length;
      if (line.loop) { while (i !== j) { t += this.hopTime(line, line.fwd[i]); i = (i + 1) % n; } }
      else if (j > i) for (let k = i; k < j; k++) t += this.hopTime(line, line.fwd[k]);
      else for (let k = i; k > j; k--) t += this.hopTime(line, line.back[k - 1]);
    }
    return t;
  }

  get waiting(): number { let n = 0; for (const s of this.stops.values()) n += s.queue.length; return n; }
  get riding(): number { let n = 0; for (const l of this.lines.values()) for (const v of l.vehicles) n += v.passengers.length; return n; }
}
