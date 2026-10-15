// Generación de viajeros a partir de los edificios reales: las viviendas emiten viajes hacia
// comercios, industria y equipamientos (y a la inversa por la tarde).
import type { Building, CityData, Pt } from '../data/types.ts';
import { MODE, type Leg, type Network, type Stop } from './transit.ts';

export interface Unserved { x: number; y: number; t: number; reason: 'origin' | 'dest' | 'route' }

export interface TripCandidate { from: Stop; to: Stop; legs: Leg[]; time: number }

const DAY = 24 * 60; // minutos de reloj por día

export class Demand {
  private homes: Building[] = [];
  private homeW: Float64Array;
  private jobs: Building[] = [];
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
      if (b.use === 'residential') { const w = Math.max(2, floor / 110); this.homes.push(b); hw.push(w); pop += w; }
      else { const w = Math.max(2, floor / (b.use === 'industrial' ? 150 : b.use === 'public' ? 160 : 80)); this.jobs.push(b); jw.push(w); jobs += w; }
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

  /** Viajes por segundo de juego a esta hora. */
  rate(minute: number, growth: number): number {
    const base = Math.min(2.2, Math.max(0.25, this.population / 40000));
    return base * Demand.timeOfDay(minute) * growth;
  }

  /** Genera los viajes que tocan en `dt` segundos. */
  tick(dt: number, minute: number, growth: number, now: number): void {
    if (!this.homes.length || !this.jobs.length) return;
    this.acc += this.rate(minute, growth) * dt;
    let n = 0;
    while (this.acc >= 1 && n < 6) { this.acc -= 1; n++; this.trip(minute, now); }
    const cutoff = now - 25;
    if (this.unserved.length && this.unserved[0].t < cutoff) this.unserved = this.unserved.filter(u => u.t >= cutoff);
  }

  private pick(list: Building[], w: Float64Array): Building {
    const r = this.rnd() * w[w.length - 1];
    let lo = 0, hi = w.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (w[m] < r) lo = m + 1; else hi = m; }
    return list[lo];
  }

  private trip(minute: number, now: number): void {
    const h = (minute % DAY) / 60;
    const homeToWork = h < 12 ? 0.75 : h < 15 ? 0.5 : 0.25;
    const a = this.pick(this.homes, this.homeW), b = this.pick(this.jobs, this.jobW);
    const [o, d] = this.rnd() < homeToWork ? [a, b] : [b, a];
    const res = this.bestTrip({ x: o.cx, y: o.cy }, { x: d.cx, y: d.cy });
    if (typeof res === 'string') {
      const at = res === 'dest' ? d : o;
      this.unserved.push({ x: at.cx, y: at.cy, t: now, reason: res });
      this.heat.set(at.id, (this.heat.get(at.id) ?? 0) + 1);
      this.net.stats.unserved++;
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
    const byId = new Map(data.buildings.map(b => [b.id, b] as const));
    for (const [id, v] of this.heat) { const b = byId.get(id); if (b) out.push({ x: b.cx, y: b.cy, v }); }
    return out;
  }

  decayHeat(): void {
    for (const [id, v] of this.heat) { const nv = v * 0.6; if (nv < 0.5) this.heat.delete(id); else this.heat.set(id, nv); }
  }
}

function cumulative(w: number[]): Float64Array {
  const out = new Float64Array(w.length);
  let acc = 0;
  for (let i = 0; i < w.length; i++) { acc += w[i]; out[i] = acc; }
  return out;
}
