// Barrios: la ciudad se divide en zonas con nombre para que la demanda se entienda de un vistazo.
// Si OSM tiene barrios con nombre (nodos place), cada uno es el centro de un barrio (Voronoi);
// si no, se agrupan los edificios por cercanía (k-medias) y el barrio toma el nombre de una calle.
import type { PlaceNode, Pt } from '../data/types.ts';
import { rng } from '../data/geo.ts';
import type { RoadGraph } from './graph.ts';

export interface District {
  id: number;
  name: string;
  x: number;
  y: number;
  color: number;
  residents: number;
  jobs: number;
  /** Vecinos (grupos) esperando transporte sin tener parada cerca: se acumulan y se van yendo. */
  waiting: number;
  /** Fracción de habitantes y empleos a distancia andable de alguna parada. */
  coverage: number;
  /** Viajes de hoy que empezaron o querían acabar aquí, y los que no pudieron hacerse. */
  tripsToday: number;
  unservedToday: number;
}

export interface WeightedPoint { x: number; y: number; w: number; kind: 'home' | 'job' }

/** Máximo de barrios (por legibilidad de las fichas). */
export const MAX_DISTRICTS = 42;

export class Districts {
  list: District[] = [];
  /** Viajes de hoy entre barrios (origen × destino), con los de ayer a la mitad. */
  flows: Float32Array;
  /** Viajes sin servicio entre barrios, igual que `flows`. */
  flowsUnserved: Float32Array;
  readonly k: number;

  constructor(points: WeightedPoint[], places: PlaceNode[] | undefined, radius: number, graph: RoadGraph) {
    const centers = places && places.length >= 6 ? this.fromPlaces(points, places) : this.kmeans(points, radius, graph);
    this.list = centers;
    this.k = centers.length;
    this.flows = new Float32Array(this.k * this.k);
    this.flowsUnserved = new Float32Array(this.k * this.k);
    // población y empleos por barrio
    for (const p of points) { const d = this.list[this.nearest(p.x, p.y)]; if (p.kind === 'home') d.residents += p.w; else d.jobs += p.w; }
    for (const d of this.list) { d.residents = Math.round(d.residents); d.jobs = Math.round(d.jobs); }
  }

  /** Índice del barrio más cercano a un punto. */
  nearest(x: number, y: number): number {
    let best = 0, bd = Infinity;
    for (let i = 0; i < this.list.length; i++) {
      const d = this.list[i];
      const dd = (d.x - x) * (d.x - x) + (d.y - y) * (d.y - y);
      if (dd < bd) { bd = dd; best = i; }
    }
    return best;
  }

  flow(o: number, d: number): number { return this.flows[o * this.k + d]; }
  addFlow(o: number, d: number, unserved: boolean): void {
    this.flows[o * this.k + d] += 1;
    if (unserved) this.flowsUnserved[o * this.k + d] += 1;
  }

  /** Cierre del día: los flujos se atenúan y los contadores diarios vuelven a cero. */
  closeDay(): void {
    for (let i = 0; i < this.flows.length; i++) { this.flows[i] *= 0.5; this.flowsUnserved[i] *= 0.5; }
    for (const d of this.list) { d.tripsToday = 0; d.unservedToday = 0; }
  }

  /** Flujos principales entre barrios, de mayor a menor. */
  topFlows(max = 60): Array<{ from: District; to: District; trips: number; unserved: number }> {
    const out: Array<{ from: District; to: District; trips: number; unserved: number }> = [];
    for (let o = 0; o < this.k; o++) for (let d = 0; d < this.k; d++) {
      if (o === d) continue;
      // se juntan ida y vuelta en un solo arco
      if (d < o) continue;
      const t = this.flows[o * this.k + d] + this.flows[d * this.k + o];
      if (t < 1) continue;
      out.push({ from: this.list[o], to: this.list[d], trips: t, unserved: this.flowsUnserved[o * this.k + d] + this.flowsUnserved[d * this.k + o] });
    }
    out.sort((a, b) => b.trips - a.trips);
    return out.slice(0, max);
  }

  // ───────────── construcción ─────────────

  private make(id: number, name: string, x: number, y: number): District {
    return { id, name, x, y, color: districtColor(id), residents: 0, jobs: 0, waiting: 0, coverage: 0, tripsToday: 0, unservedToday: 0 };
  }

  /** Barrios reales de OSM: cada nodo place es un centro; los que apenas tienen población se funden con el vecino. */
  private fromPlaces(points: WeightedPoint[], places: PlaceNode[]): District[] {
    // sin duplicados ni nombres repetidos; los barrios (neighbourhood) tienen prioridad sobre distritos (suburb)
    const order = { neighbourhood: 0, quarter: 1, suburb: 2 };
    const sorted = places.slice().sort((a, b) => order[a.kind] - order[b.kind]);
    const centers: Array<{ name: string; x: number; y: number }> = [];
    for (const p of sorted) {
      if (centers.some(c => c.name === p.name || Math.hypot(c.x - p.x, c.y - p.y) < 180)) continue;
      centers.push({ name: p.name, x: p.x, y: p.y });
    }
    const total = points.reduce((a, p) => a + p.w, 0);
    // pesos por centro (Voronoi); se eliminan los centros con menos del 0,7 % de la ciudad, por rondas
    for (let round = 0; round < 6 && centers.length > 6; round++) {
      const w = new Float64Array(centers.length);
      for (const p of points) w[nearestIdx(centers, p.x, p.y)] += p.w;
      const small = [...w.keys()].filter(i => w[i] < total * 0.007).sort((a, b) => w[a] - w[b]);
      if (!small.length) break;
      // se quitan como mucho un tercio por ronda, de menor a mayor, para no vaciar barrios de golpe
      const drop = new Set(small.slice(0, Math.max(1, Math.ceil(small.length / 3))));
      for (let i = centers.length - 1; i >= 0; i--) if (drop.has(i)) centers.splice(i, 1);
    }
    if (centers.length > MAX_DISTRICTS) {
      const w = new Float64Array(centers.length);
      for (const p of points) w[nearestIdx(centers, p.x, p.y)] += p.w;
      const keep = [...w.keys()].sort((a, b) => w[b] - w[a]).slice(0, MAX_DISTRICTS).sort((a, b) => a - b);
      const kept = keep.map(i => centers[i]);
      centers.length = 0; centers.push(...kept);
    }
    return centers.map((c, i) => this.make(i, c.name, c.x, c.y));
  }

  /** Sin barrios en OSM: agrupación por cercanía ponderada por población y empleos. */
  private kmeans(points: WeightedPoint[], radius: number, graph: RoadGraph): District[] {
    const areaKm2 = (radius * 2) ** 2 / 1e6;
    let k = Math.round(areaKm2 / 1.4);
    k = Math.max(6, Math.min(MAX_DISTRICTS, k, Math.floor(points.length / 15) || 1));
    if (!points.length) return [this.make(0, 'Centro', 0, 0)];
    const r = rng(11);
    // k-medias++: semillas alejadas entre sí
    const centers: Pt[] = [];
    const first = points[Math.floor(r() * points.length)];
    centers.push({ x: first.x, y: first.y });
    const d2 = new Float64Array(points.length).fill(Infinity);
    while (centers.length < k) {
      const c = centers[centers.length - 1];
      let sum = 0;
      for (let i = 0; i < points.length; i++) {
        const p = points[i];
        const dd = (p.x - c.x) ** 2 + (p.y - c.y) ** 2;
        if (dd < d2[i]) d2[i] = dd;
        sum += d2[i] * p.w;
      }
      let t = r() * sum, pick = points.length - 1;
      for (let i = 0; i < points.length; i++) { t -= d2[i] * points[i].w; if (t <= 0) { pick = i; break; } }
      centers.push({ x: points[pick].x, y: points[pick].y });
    }
    // iteraciones de Lloyd
    for (let it = 0; it < 14; it++) {
      const sx = new Float64Array(k), sy = new Float64Array(k), sw = new Float64Array(k);
      for (const p of points) { const i = nearestIdx(centers, p.x, p.y); sx[i] += p.x * p.w; sy[i] += p.y * p.w; sw[i] += p.w; }
      let moved = 0;
      for (let i = 0; i < k; i++) {
        if (!sw[i]) continue;
        const nx = sx[i] / sw[i], ny = sy[i] / sw[i];
        moved += Math.hypot(nx - centers[i].x, ny - centers[i].y);
        centers[i] = { x: nx, y: ny };
      }
      if (moved < 1) break;
    }
    // sin puntos asignados → fuera
    const used = new Set<number>();
    for (const p of points) used.add(nearestIdx(centers, p.x, p.y));
    const kept = centers.filter((_, i) => used.has(i));
    // nombre: la calle más cercana al centro
    const names = new Set<string>();
    return kept.map((c, i) => {
      let base = streetNear(graph, c.x, c.y) ?? `Barrio ${i + 1}`;
      let name = base, n = 2;
      while (names.has(name)) name = `${base} ${n++}`;
      names.add(name);
      return this.make(i, name, c.x, c.y);
    });
  }
}

function nearestIdx(centers: Pt[], x: number, y: number): number {
  let best = 0, bd = Infinity;
  for (let i = 0; i < centers.length; i++) {
    const dd = (centers[i].x - x) ** 2 + (centers[i].y - y) ** 2;
    if (dd < bd) { bd = dd; best = i; }
  }
  return best;
}

function streetNear(graph: RoadGraph, x: number, y: number): string | undefined {
  for (const r of [80, 160, 320]) {
    const hit = graph.nearestEdge(x, y, r);
    if (hit) { const n = graph.edges[hit.edge].name; if (n) return n; }
  }
  return undefined;
}

/** Colores distinguibles para los barrios (tono por ángulo áureo, saturación media). */
export function districtColor(i: number): number {
  const h = (i * 137.508 + 25) % 360;
  const s = 0.58 + 0.12 * ((i * 7) % 3) / 2, l = 0.5 + 0.08 * ((i * 5) % 3) / 2;
  return hslToHex(h, s, l);
}

export function hslToHex(h: number, s: number, l: number): number {
  const c = (1 - Math.abs(2 * l - 1)) * s, hp = h / 60, x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0, g = 0, b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0]; else if (hp < 2) [r, g, b] = [x, c, 0]; else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c]; else if (hp < 5) [r, g, b] = [x, 0, c]; else [r, g, b] = [c, 0, x];
  const m = l - c / 2;
  const to = (v: number) => Math.round((v + m) * 255);
  return (to(r) << 16) | (to(g) << 8) | to(b);
}
