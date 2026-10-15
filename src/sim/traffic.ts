// Tráfico: coches que van de casa al trabajo por el grafo de calles. Cuantos más coches en un tramo, más lento.
import type { City, Lot } from './city.ts';
import { DRIVABLE, ROAD_SPEED, ROAD_WIDTH } from './graph.ts';

export interface Car {
  x: number; y: number; angle: number;
  path: number[];
  idx: number;
  /** Metros recorridos en la arista actual. */
  s: number;
  /** +1 si recorre la arista de a→b, -1 si de b→a. */
  dir: 1 | -1;
  color: number;
  /** Factor de velocidad actual (1 = fluido). */
  flow: number;
}

const CAR_COLORS = [0xe88a82, 0xf7e8d2, 0x2f6fc4, 0xf0bf3c, 0x7f8f58, 0xd23b33, 0x64a2ea, 0xece7de, 0x3b3b40, 0xe57a2e];

export class Traffic {
  cars: Car[] = [];
  private resLots: Lot[] = [];
  private jobLots: Lot[] = [];
  private lotsDirty = true;
  private nodeOfLot = new Map<number, number>();
  private graphVersion = -1;
  private rnd = Math.random;

  constructor(private city: City) {
    city.on('buildings', () => { this.lotsDirty = true; });
  }

  get target(): number {
    return Math.min(450, 20 + Math.floor(this.city.stats.population / 350));
  }

  private jobsByNode = new Map<number, Lot[]>();
  private badHomes = new Set<number>();

  private refreshLots(): void {
    const g = this.city.graph;
    if (g.version !== this.graphVersion) { this.nodeOfLot.clear(); this.graphVersion = g.version; this.lotsDirty = true; this.badHomes.clear(); }
    if (!this.lotsDirty) return;
    this.lotsDirty = false;
    this.resLots = []; this.jobLots = [];
    this.jobsByNode.clear();
    for (const l of this.city.lots.values()) {
      if (l.occ < 0.05) continue;
      if (l.use === 'residential') this.resLots.push(l);
      else {
        this.jobLots.push(l);
        const n = this.nodeFor(l);
        if (n >= 0) { let list = this.jobsByNode.get(n); if (!list) this.jobsByNode.set(n, (list = [])); list.push(l); }
      }
    }
  }

  /** Busca, siguiendo las calles desde `from`, nodos con empleos a los que se puede llegar. */
  private reachableJobs(from: number): number[] {
    const g = this.city.graph;
    const seen = new Set<number>([from]);
    const queue = [from];
    const found: number[] = [];
    let qi = 0;
    while (qi < queue.length && found.length < 16 && qi < 4000) {
      const n = queue[qi++];
      if (n !== from && this.jobsByNode.has(n)) found.push(n);
      for (const ei of g.nodes[n].adj) {
        const e = g.edges[ei];
        if (e.removed || !DRIVABLE(e.cls) || (e.oneway && e.a !== n)) continue;
        const m = e.a === n ? e.b : e.a;
        if (!seen.has(m)) { seen.add(m); queue.push(m); }
      }
    }
    return found;
  }

  private nodeFor(lot: Lot): number {
    const g = this.city.graph;
    let n = this.nodeOfLot.get(lot.id);
    if (n === undefined) { n = g.nearestNode(lot.cx, lot.cy, 140, true); this.nodeOfLot.set(lot.id, n); }
    return n;
  }

  private spawn(): boolean {
    this.refreshLots();
    if (!this.resLots.length || !this.jobLots.length) return false;
    const g = this.city.graph;
    const home = this.resLots[Math.floor(this.rnd() * this.resLots.length)];
    const a = this.nodeFor(home);
    if (a < 0 || this.badHomes.has(a)) return false;
    const candidates = this.reachableJobs(a);
    if (!candidates.length) { this.badHomes.add(a); return false; }
    // prefiere destinos lejanos: así se ve el tráfico atravesar la ciudad
    const b = candidates[Math.floor(this.rnd() * candidates.length)];
    const path = g.route(a, b, 25000);
    if (!path || !path.length) return false;
    const e = g.edges[path[0]];
    const dir: 1 | -1 = e.a === a ? 1 : -1;
    const na = g.nodes[a];
    const car: Car = { x: na.x, y: na.y, angle: 0, path, idx: 0, s: 0, dir, color: CAR_COLORS[Math.floor(this.rnd() * CAR_COLORS.length)], flow: 1 };
    e.load++;
    this.cars.push(car);
    return true;
  }

  /** dt en segundos de simulación (ya multiplicado por la velocidad de juego). */
  update(dt: number): void {
    const g = this.city.graph;
    if (g.version !== this.graphVersion) {
      // calles editadas: descarta los coches cuya ruta ya no existe
      this.cars = this.cars.filter(c => c.path.slice(c.idx).every(ei => !g.edges[ei].removed));
      for (const e of g.edges) e.load = 0;
      for (const c of this.cars) g.edges[c.path[c.idx]].load++;
      this.refreshLots();
    }
    const want = this.target;
    for (let k = 0; k < 2 && this.cars.length < want; k++) if (!this.spawn()) break;

    let flowSum = 0;
    const step = Math.min(dt, 0.5);
    for (let i = this.cars.length - 1; i >= 0; i--) {
      const c = this.cars[i];
      let e = g.edges[c.path[c.idx]];
      const flow = Math.max(0.2, 1 - 0.8 * (e.load / e.capacity));
      c.flow = flow;
      flowSum += flow;
      c.s += ROAD_SPEED[e.cls] * flow * step;
      while (c.s >= e.len) {
        c.s -= e.len;
        e.load--;
        c.idx++;
        if (c.idx >= c.path.length) break;
        const next = g.edges[c.path[c.idx]];
        if (next.removed || !DRIVABLE(next.cls)) { c.idx = c.path.length; break; }
        const exitNode = c.dir === 1 ? e.b : e.a;
        c.dir = next.a === exitNode ? 1 : -1;
        e = next; e.load++;
      }
      if (c.idx >= c.path.length) { this.cars.splice(i, 1); continue; }
      const a = g.nodes[c.dir === 1 ? e.a : e.b], b = g.nodes[c.dir === 1 ? e.b : e.a];
      const t = e.len > 0 ? c.s / e.len : 0;
      const dx = b.x - a.x, dy = b.y - a.y;
      const ang = Math.atan2(dy, dx);
      // circula por la derecha
      const off = ROAD_WIDTH[e.cls] * 0.22;
      c.x = a.x + dx * t - Math.sin(ang) * off;
      c.y = a.y + dy * t + Math.cos(ang) * off;
      c.angle = ang;
    }
    const n = this.cars.length;
    const congestion = n ? 1 - flowSum / n : 0;
    this.city.congestion += (congestion - this.city.congestion) * 0.02;
  }
}
