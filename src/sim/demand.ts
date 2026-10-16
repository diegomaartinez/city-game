// Generación de viajeros a partir de los edificios reales: las viviendas emiten viajes hacia
// comercios, industria y equipamientos (y a la inversa por la tarde).
import type { CityData, Pt, Zone } from '../data/types.ts';
import { pointInPoly } from '../data/geo.ts';
import { MODE, PEOPLE_PER_PASSENGER, fareAcceptance, type Leg, type Network, type Stop } from './transit.ts';

export interface Unserved { x: number; y: number; t: number; reason: 'origin' | 'dest' | 'route' | 'fare' }

/** Viajes al día por persona que harían en transporte público si existiera. */
export const TRIPS_PER_PERSON = 0.35;

export interface TripCandidate { from: Stop; to: Stop; legs: Leg[]; time: number }

const DAY = 24 * 60; // minutos de reloj por día

/** Densidades de las zonas de uso del suelo fuera del núcleo (personas o empleos por m²). */
const ZONE_DENSITY = { residential: 0.0065, commercial: 0.004, industrial: 0.0022 };

/** Origen o destino de viajes: un edificio o una zona (con puntos de muestra repartidos por su superficie). */
export interface Source { x: number; y: number; id: number; poly?: Pt[]; samples?: Pt[] }

export class Demand {
  private homes: Source[] = [];
  private homeW: Float64Array;
  private jobs: Source[] = [];
  private jobW: Float64Array;
  readonly population: number;
  readonly jobCount: number;
  /** Viajes recientes sin servicio, para dibujarlos. */
  unserved: Unserved[] = [];
  /** Demanda acumulada por edificio origen sin servicio (para el mapa de calor). */
  heat = new Map<number, number>();
  private acc = 0;
  private rnd = Math.random;

  constructor(data: CityData, private net: Network) {
    let pop = 0, jobs = 0;
    const hw: number[] = [], jw: number[] = [];
    for (const b of data.buildings) {
      const floor = b.area * b.levels;
      const src: Source = { x: b.cx, y: b.cy, id: b.id };
      if (b.use === 'residential') { const w = Math.max(2, floor / 35); this.homes.push(src); hw.push(w); pop += w; }
      else { const w = Math.max(2, floor / (b.use === 'industrial' ? 60 : b.use === 'public' ? 50 : 25)); this.jobs.push(src); jw.push(w); jobs += w; }
    }
    for (const z of data.zones ?? []) {
      const w = z.area * ZONE_DENSITY[z.kind];
      if (w < 5) continue;
      const src: Source = { x: z.cx, y: z.cy, id: -z.id, poly: z.poly, samples: zoneSamples(z) };
      if (z.kind === 'residential') { this.homes.push(src); hw.push(w); pop += w; }
      else { this.jobs.push(src); jw.push(w); jobs += w; }
    }
    this.homeW = cumulative(hw); this.jobW = cumulative(jw);
    this.population = Math.round(pop); this.jobCount = Math.round(jobs);
  }

  /** Factor de demanda según la hora (minutos del día). */
  static timeOfDay(minute: number): number {
    const h = (minute % DAY) / 60;
    const peak = (c: number, w: number) => Math.exp(-((h - c) ** 2) / (2 * w * w));
    return 0.25 + 1.1 * peak(8, 1.2) + 1.0 * peak(18, 1.5) + 0.35 * peak(13, 1.5);
  }

  /** Viajeros (grupos) potenciales al día. */
  dailyPotential(growth: number): number {
    return (this.population * TRIPS_PER_PERSON * growth) / PEOPLE_PER_PASSENGER;
  }

  /** Viajeros por segundo de juego a esta hora (el día dura 720 s; la media del factor horario es ~0,7). */
  rate(minute: number, growth: number): number {
    return (this.dailyPotential(growth) / 720 / 0.7) * Demand.timeOfDay(minute);
  }

  rejected = 0;

  /** Qué parte de la población vive a distancia andable de alguna parada. */
  coverage(): number {
    if (!this.homes.length) return 0;
    const stops = [...this.net.stops.values()];
    if (!stops.length) return 0;
    let covered = 0, total = 0;
    for (let i = 0; i < this.homes.length; i++) {
      const b = this.homes[i];
      const w = this.homeW[i] - (i ? this.homeW[i - 1] : 0);
      total += w;
      if (b.samples && b.samples.length) {
        // zona: cubierta en proporción a los puntos de muestra que quedan a distancia andable
        let n = 0;
        for (const p of b.samples) for (const s of stops) { if (Math.hypot(s.x - p.x, s.y - p.y) <= MODE[s.mode].walk) { n++; break; } }
        covered += (w * n) / b.samples.length;
        continue;
      }
      for (const s of stops) { if (Math.hypot(s.x - b.x, s.y - b.y) <= MODE[s.mode].walk) { covered += w; break; } }
    }
    return total ? covered / total : 0;
  }

  /** Genera los viajes que tocan en `dt` segundos. */
  tick(dt: number, minute: number, growth: number, now: number): void {
    if (!this.homes.length || !this.jobs.length) return;
    this.acc += this.rate(minute, growth) * dt;
    let n = 0;
    while (this.acc >= 1 && n < 8) { this.acc -= 1; n++; this.trip(minute, now); }
    const cutoff = now - 25;
    if (this.unserved.length && this.unserved[0].t < cutoff) this.unserved = this.unserved.filter(u => u.t >= cutoff);
  }

  private pick(list: Source[], w: Float64Array): Source {
    const r = this.rnd() * w[w.length - 1];
    let lo = 0, hi = w.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (w[m] < r) lo = m + 1; else hi = m; }
    return list[lo];
  }

  /** Punto concreto de un origen: el propio edificio, o uno de los puntos de muestra de la zona. */
  private pointOf(s: Source): Pt {
    if (!s.samples || !s.samples.length) return { x: s.x, y: s.y };
    const p = s.samples[Math.floor(this.rnd() * s.samples.length)];
    return { x: p.x + (this.rnd() - 0.5) * 60, y: p.y + (this.rnd() - 0.5) * 60 };
  }

  private trip(minute: number, now: number): void {
    const h = (minute % DAY) / 60;
    const homeToWork = h < 12 ? 0.75 : h < 15 ? 0.5 : 0.25;
    const a = this.pick(this.homes, this.homeW), b = this.pick(this.jobs, this.jobW);
    const [o, d] = this.rnd() < homeToWork ? [a, b] : [b, a];
    const op = this.pointOf(o), dp = this.pointOf(d);
    const res = this.bestTrip(op, dp);
    if (typeof res === 'string') {
      const at = res === 'dest' ? dp : op;
      const src = res === 'dest' ? d : o;
      this.unserved.push({ x: at.x, y: at.y, t: now, reason: res });
      this.heat.set(src.id, (this.heat.get(src.id) ?? 0) + 1);
      this.net.stats.unserved++;
      return;
    }
    if (this.rnd() > fareAcceptance(this.net.planFare(res.legs))) {
      this.rejected++;
      this.unserved.push({ x: op.x, y: op.y, t: now, reason: 'fare' });
      return;
    }
    this.net.spawn(res.from.id, res.to.id, res.legs, now);
  }

  /** Paradas a distancia andable de un punto, de más cercana a más lejana. */
  private near(p: Pt, max = 3): Array<{ stop: Stop; walk: number }> {
    const out: Array<{ stop: Stop; walk: number }> = [];
    for (const s of this.net.stops.values()) {
      const d = Math.hypot(s.x - p.x, s.y - p.y);
      if (d <= MODE[s.mode].walk) out.push({ stop: s, walk: d });
    }
    out.sort((u, v) => u.walk - v.walk);
    return out.slice(0, max);
  }

  bestTrip(o: Pt, d: Pt): TripCandidate | 'origin' | 'dest' | 'route' {
    const from = this.near(o), to = this.near(d);
    if (!from.length) return 'origin';
    if (!to.length) return 'dest';
    let best: TripCandidate | null = null;
    for (const f of from) for (const t of to) {
      if (f.stop.id === t.stop.id) continue;
      const legs = this.net.plan(f.stop.id, t.stop.id);
      if (!legs || !legs.length) continue;
      const time = (f.walk + t.walk) / 1.3 + this.net.planTime(legs);
      if (!best || time < best.time) best = { from: f.stop, to: t.stop, legs, time };
    }
    return best ?? 'route';
  }

  /** Edificios de origen con demanda sin cubrir, para el mapa de calor. */
  heatPoints(data: CityData): Array<{ x: number; y: number; v: number }> {
    const out: Array<{ x: number; y: number; v: number }> = [];
    const byId = new Map<number, Pt>();
    for (const b of data.buildings) byId.set(b.id, { x: b.cx, y: b.cy });
    for (const z of data.zones ?? []) byId.set(-z.id, { x: z.cx, y: z.cy });
    for (const [id, v] of this.heat) { const b = byId.get(id); if (b) out.push({ x: b.x, y: b.y, v }); }
    return out;
  }

  /** Viviendas con su población estimada, para el mapa de población. */
  populationPoints(): Array<{ x: number; y: number; people: number; poly?: Pt[] }> {
    return this.homes.map((b, i) => ({ x: b.x, y: b.y, people: this.homeW[i] - (i ? this.homeW[i - 1] : 0), poly: b.poly }));
  }

  decayHeat(): void {
    for (const [id, v] of this.heat) { const nv = v * 0.6; if (nv < 0.5) this.heat.delete(id); else this.heat.set(id, nv); }
  }
}

/** Puntos repartidos en rejilla dentro de una zona (como máximo unas decenas). */
function zoneSamples(z: Zone): Pt[] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of z.poly) { if (p.x < x0) x0 = p.x; if (p.y < y0) y0 = p.y; if (p.x > x1) x1 = p.x; if (p.y > y1) y1 = p.y; }
  const step = Math.max(120, Math.sqrt(((x1 - x0) * (y1 - y0)) / 40));
  const out: Pt[] = [];
  for (let y = y0 + step / 2; y < y1; y += step) for (let x = x0 + step / 2; x < x1; x += step) if (pointInPoly(x, y, z.poly)) out.push({ x, y });
  if (!out.length) out.push({ x: z.cx, y: z.cy });
  return out;
}

function cumulative(w: number[]): Float64Array {
  const out = new Float64Array(w.length);
  let acc = 0;
  for (let i = 0; i < w.length; i++) { acc += w[i]; out[i] = acc; }
  return out;
}
