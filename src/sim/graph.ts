// Grafo de calles: nodos, aristas, búsqueda de rutas (A*) y edición (trazar y demoler tramos).
import type { RoadClass, RoadWay } from '../data/types.ts';
import { pointSegment } from '../data/geo.ts';

export interface GNode { x: number; y: number; adj: number[] }
export interface GEdge {
  a: number; b: number; cls: RoadClass; oneway: boolean; len: number; name?: string;
  removed: boolean;
  /** <0 túnel, 0 suelo, >0 puente. */
  layer: number;
}

export const ROAD_WIDTH: Record<RoadClass, number> = { motorway: 20, primary: 15, secondary: 12, tertiary: 10, residential: 8, service: 5, pedestrian: 4.5 };
/** Velocidad relativa de cada clase de vía para elegir rutas (los buses prefieren avenidas). */
/** Velocidad relativa por clase de calle para elegir ruta: las calles principales apenas se prefieren
 * a las residenciales, para que el bus vaya por el camino corto de verdad y no dé rodeos por avenidas. */
export const ROAD_SPEED: Record<RoadClass, number> = { motorway: 20, primary: 11.5, secondary: 11, tertiary: 10.5, residential: 9, service: 6.5, pedestrian: 0 };
/** Penalización por circular en contra de un sentido único (solo compensa en tramos muy cortos, p. ej. junto a una parada). */
export const WRONG_WAY = 6;
/** Radio (m) alrededor de origen y destino donde ir a contramano apenas penaliza. */
export const NEAR_STOP = 90;
export const DRIVABLE = (cls: RoadClass) => cls !== 'pedestrian' && cls !== 'motorway';

export const HASH = 60; // metros por celda del índice espacial

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

  /** Aristas indexadas en la celda (i, j) del índice espacial. */
  edgesInCell(i: number, j: number): number[] | undefined { return this.edgeHash.get((i + 32768) * 65536 + (j + 32768)); }

  private hkey(x: number, y: number): number { return (Math.floor(x / HASH) + 32768) * 65536 + (Math.floor(y / HASH) + 32768); }

  addNode(x: number, y: number): number {
    const i = this.nodes.length;
    this.nodes.push({ x, y, adj: [] });
    const k = this.hkey(x, y);
    let l = this.nodeHash.get(k); if (!l) this.nodeHash.set(k, (l = [])); l.push(i);
    return i;
  }

  addEdge(a: number, b: number, cls: RoadClass, oneway: boolean, layer: number, name?: string): number {
    const na = this.nodes[a], nb = this.nodes[b];
    const len = Math.hypot(na.x - nb.x, na.y - nb.y);
    const i = this.edges.length;
    this.edges.push({ a, b, cls, oneway, len, name, removed: false, layer });
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
        if (prev >= 0 && prev !== n) g.addEdge(prev, n, r.cls, r.oneway, r.layer ?? 0, r.name);
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
    this.addEdge(e.a, n, e.cls, e.oneway, e.layer, e.name);
    this.addEdge(n, e.b, e.cls, e.oneway, e.layer, e.name);
    return n;
  }

  /** Ruta de nodo a nodo (lista de aristas) por calles transitables. null si no hay camino. */
  route(from: number, to: number, maxExpand = 60000, ignoreOneway = false): number[] | null {
    if (from === to) return [];
    const { nodes, edges } = this;
    const goal = nodes[to], start = nodes[from];
    const h = (n: number) => Math.hypot(nodes[n].x - goal.x, nodes[n].y - goal.y) / 11.5;
    // junto a las paradas (origen y destino) se puede ir a contramano casi sin castigo: el bus "cruza"
    // a la calzada contraria o usa la parada de enfrente, en vez de dar la vuelta a la manzana
    const nearEnds = (n: number) => Math.hypot(nodes[n].x - start.x, nodes[n].y - start.y) < NEAR_STOP || Math.hypot(nodes[n].x - goal.x, nodes[n].y - goal.y) < NEAR_STOP;
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
        const m = e.a === n ? e.b : e.a;
        // a contramano: permitido con una penalización fuerte (y suave si ya se ha renunciado a los sentidos)
        const wrong = e.oneway && e.a !== n;
        const cost = (e.len / ROAD_SPEED[e.cls]) * (wrong ? (ignoreOneway ? 3 : nearEnds(n) && nearEnds(m) ? 1.3 : WRONG_WAY) : 1);
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
