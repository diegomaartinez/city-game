// Grafo de calles: nodos, aristas, búsqueda de rutas (A*) y edición (trazar y demoler tramos).
import type { Pt, RoadClass, RoadWay } from '../data/types.ts';
import { pointSegment } from '../data/geo.ts';

export interface GNode { x: number; y: number; adj: number[] }
export interface GEdge {
  a: number; b: number; cls: RoadClass; oneway: boolean; len: number; name?: string;
  removed: boolean; origin: 'osm' | 'built';
  /** Coches en el tramo ahora mismo. */
  load: number;
  /** Capacidad aproximada (coches) antes de saturarse. */
  capacity: number;
}

export const ROAD_WIDTH: Record<RoadClass, number> = { motorway: 20, primary: 15, secondary: 12, tertiary: 10, residential: 8, service: 5, pedestrian: 4.5 };
export const ROAD_SPEED: Record<RoadClass, number> = { motorway: 26, primary: 14, secondary: 12, tertiary: 11, residential: 9, service: 6, pedestrian: 0 }; // m/s
export const ROAD_LANES: Record<RoadClass, number> = { motorway: 3, primary: 2, secondary: 2, tertiary: 1, residential: 1, service: 1, pedestrian: 0 };
export const DRIVABLE = (cls: RoadClass) => cls !== 'pedestrian';

const HASH = 60; // metros por celda del índice espacial

class MinHeap {
  private a: Array<[number, number]> = [];
  get size() { return this.a.length; }
  push(k: number, v: number) {
    const a = this.a; a.push([k, v]);
    let i = a.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; }
  }
  pop(): [number, number] | undefined {
    const a = this.a; if (!a.length) return undefined;
    const top = a[0]; const last = a.pop()!;
    if (a.length) {
      a[0] = last; let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m;
      }
    }
    return top;
  }
}

export class RoadGraph {
  nodes: GNode[] = [];
  edges: GEdge[] = [];
  private nodeHash = new Map<number, number[]>();
  private edgeHash = new Map<number, number[]>();
  /** Cambia cada vez que se edita el grafo (para invalidar rutas y redibujar). */
  version = 0;

  private hkey(x: number, y: number): number { return (Math.floor(x / HASH) + 32768) * 65536 + (Math.floor(y / HASH) + 32768); }

  addNode(x: number, y: number): number {
    const i = this.nodes.length;
    this.nodes.push({ x, y, adj: [] });
    const k = this.hkey(x, y);
    let l = this.nodeHash.get(k); if (!l) this.nodeHash.set(k, (l = [])); l.push(i);
    return i;
  }

  addEdge(a: number, b: number, cls: RoadClass, oneway: boolean, origin: 'osm' | 'built', name?: string): number {
    const na = this.nodes[a], nb = this.nodes[b];
    const len = Math.hypot(na.x - nb.x, na.y - nb.y);
    const i = this.edges.length;
    this.edges.push({ a, b, cls, oneway, len, name, removed: false, origin, load: 0, capacity: Math.max(2, (len / 7) * ROAD_LANES[cls]) });
    na.adj.push(i); nb.adj.push(i);
    this.indexEdge(i);
    this.version++;
    return i;
  }

  private indexEdge(i: number) {
    const e = this.edges[i], na = this.nodes[e.a], nb = this.nodes[e.b];
    const x0 = Math.floor(Math.min(na.x, nb.x) / HASH), x1 = Math.floor(Math.max(na.x, nb.x) / HASH);
    const y0 = Math.floor(Math.min(na.y, nb.y) / HASH), y1 = Math.floor(Math.max(na.y, nb.y) / HASH);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
      const k = (x + 32768) * 65536 + (y + 32768);
      let l = this.edgeHash.get(k); if (!l) this.edgeHash.set(k, (l = [])); l.push(i);
    }
  }

  removeEdge(i: number): void {
    const e = this.edges[i];
    if (e.removed) return;
    e.removed = true;
    for (const n of [e.a, e.b]) { const adj = this.nodes[n].adj; const j = adj.indexOf(i); if (j >= 0) adj.splice(j, 1); }
    this.version++;
  }

  static fromRoads(roads: RoadWay[]): RoadGraph {
    const g = new RoadGraph();
    const byOsm = new Map<number, number>();
    for (const r of roads) {
      let prev = -1;
      for (let i = 0; i < r.pts.length; i++) {
        const osmId = r.nodes[i];
        let n = byOsm.get(osmId);
        if (n === undefined) { n = g.addNode(r.pts[i].x, r.pts[i].y); byOsm.set(osmId, n); }
        if (prev >= 0 && prev !== n) g.addEdge(prev, n, r.cls, r.oneway, 'osm', r.name);
        prev = n;
      }
    }
    g.version = 1;
    return g;
  }

  /** Nodo más cercano a (x, y) dentro de `maxDist`, opcionalmente solo con calles transitables. */
  nearestNode(x: number, y: number, maxDist: number, drivableOnly = false): number {
    const r = Math.ceil(maxDist / HASH);
    const cx = Math.floor(x / HASH), cy = Math.floor(y / HASH);
    let best = -1, bd = maxDist * maxDist;
    for (let i = cx - r; i <= cx + r; i++) for (let j = cy - r; j <= cy + r; j++) {
      const l = this.nodeHash.get((i + 32768) * 65536 + (j + 32768));
      if (!l) continue;
      for (const n of l) {
        const nd = this.nodes[n];
        if (!nd.adj.length) continue;
        if (drivableOnly && !nd.adj.some(e => !this.edges[e].removed && DRIVABLE(this.edges[e].cls))) continue;
        const d = (nd.x - x) ** 2 + (nd.y - y) ** 2;
        if (d < bd) { bd = d; best = n; }
      }
    }
    return best;
  }

  /** Arista más cercana a (x, y) dentro de `maxDist`. */
  nearestEdge(x: number, y: number, maxDist: number): { edge: number; t: number; d: number } | null {
    const r = Math.ceil(maxDist / HASH);
    const cx = Math.floor(x / HASH), cy = Math.floor(y / HASH);
    let best: { edge: number; t: number; d: number } | null = null;
    const seen = new Set<number>();
    for (let i = cx - r; i <= cx + r; i++) for (let j = cy - r; j <= cy + r; j++) {
      const l = this.edgeHash.get((i + 32768) * 65536 + (j + 32768));
      if (!l) continue;
      for (const ei of l) {
        if (seen.has(ei)) continue; seen.add(ei);
        const e = this.edges[ei];
        if (e.removed) continue;
        const a = this.nodes[e.a], b = this.nodes[e.b];
        const { d, t } = pointSegment(x, y, a.x, a.y, b.x, b.y);
        if (d <= maxDist && (!best || d < best.d)) best = { edge: ei, t, d };
      }
    }
    return best;
  }

  /** Parte una arista en el punto t, devolviendo el índice del nuevo nodo. */
  splitEdge(ei: number, t: number): number {
    const e = this.edges[ei];
    const a = this.nodes[e.a], b = this.nodes[e.b];
    if (t < 0.02) return e.a;
    if (t > 0.98) return e.b;
    const n = this.addNode(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
    this.removeEdge(ei);
    this.addEdge(e.a, n, e.cls, e.oneway, e.origin, e.name);
    this.addEdge(n, e.b, e.cls, e.oneway, e.origin, e.name);
    return n;
  }

  /** Nodo para un punto: se ajusta a un nodo o arista cercanos, o crea uno nuevo. */
  snapOrCreate(x: number, y: number): { node: number; snapped: boolean } {
    const n = this.nearestNode(x, y, 9);
    if (n >= 0) return { node: n, snapped: true };
    const e = this.nearestEdge(x, y, 7);
    if (e) return { node: this.splitEdge(e.edge, e.t), snapped: true };
    return { node: this.addNode(x, y), snapped: false };
  }

  /** Traza una calle recta entre dos puntos. Devuelve las aristas creadas. */
  buildRoad(p1: Pt, p2: Pt, cls: RoadClass): number[] {
    const s = this.snapOrCreate(p1.x, p1.y);
    const e = this.snapOrCreate(p2.x, p2.y);
    if (s.node === e.node) return [];
    // Si la recta cruza otras calles, pártela en los cruces para que el tráfico pueda girar.
    const crossings: Array<{ t: number; node: number }> = [];
    const a = this.nodes[s.node], b = this.nodes[e.node];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const steps = Math.max(1, Math.round(len / 6));
    const checked = new Set<number>();
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const px = a.x + (b.x - a.x) * t, py = a.y + (b.y - a.y) * t;
      const ne = this.nearestEdge(px, py, 3.5);
      if (!ne || checked.has(ne.edge)) continue;
      const ed = this.edges[ne.edge];
      if (ed.a === s.node || ed.b === s.node || ed.a === e.node || ed.b === e.node) continue;
      checked.add(ne.edge);
      const node = this.splitEdge(ne.edge, ne.t);
      crossings.push({ t, node });
    }
    crossings.sort((p, q) => p.t - q.t);
    const chain = [s.node, ...crossings.map(c => c.node), e.node];
    const out: number[] = [];
    for (let i = 0; i + 1 < chain.length; i++) if (chain[i] !== chain[i + 1]) out.push(this.addEdge(chain[i], chain[i + 1], cls, false, 'built'));
    return out;
  }

  /** Ruta de nodo a nodo (lista de aristas) para coches. null si no hay camino. */
  route(from: number, to: number, maxExpand = 60000): number[] | null {
    if (from === to) return [];
    const { nodes, edges } = this;
    const goal = nodes[to];
    const h = (n: number) => Math.hypot(nodes[n].x - goal.x, nodes[n].y - goal.y) / 26;
    const dist = new Map<number, number>();
    const via = new Map<number, number>();
    const heap = new MinHeap();
    dist.set(from, 0); heap.push(h(from), from);
    let expanded = 0;
    while (heap.size) {
      const [, n] = heap.pop()!;
      if (n === to) break;
      if (++expanded > maxExpand) return null;
      const dn = dist.get(n)!;
      for (const ei of nodes[n].adj) {
        const e = edges[ei];
        if (e.removed || !DRIVABLE(e.cls)) continue;
        if (e.oneway && e.a !== n) continue;
        const m = e.a === n ? e.b : e.a;
        const congestion = 1 + Math.min(3, e.load / e.capacity);
        const cost = (e.len / ROAD_SPEED[e.cls]) * congestion;
        const nd = dn + cost;
        if (nd < (dist.get(m) ?? Infinity)) { dist.set(m, nd); via.set(m, ei); heap.push(nd + h(m), m); }
      }
    }
    if (!dist.has(to)) return null;
    const path: number[] = [];
    let cur = to;
    while (cur !== from) { const ei = via.get(cur)!; path.push(ei); const e = edges[ei]; cur = e.a === cur ? e.b : e.a; }
    return path.reverse();
  }
}
