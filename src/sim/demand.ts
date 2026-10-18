// Generación de viajeros a partir de los edificios reales: las viviendas emiten viajes hacia
// comercios, industria y equipamientos (y a la inversa por la tarde). Lleva además las cuentas
// por barrio (vecinos esperando sin parada, flujos entre barrios) y por hexágono (mapa de demanda).
import type { CityData, Pt, Zone } from '../data/types.ts';
import { pointInPoly } from '../data/geo.ts';
import { MODE, PEOPLE_PER_PASSENGER, fareAcceptance, haversine, type Leg, type Network, type Stop } from './transit.ts';
import { Districts, type WeightedPoint } from './districts.ts';
import type { RoadGraph } from './graph.ts';

export interface Unserved { x: number; y: number; t: number; reason: 'origin' | 'dest' | 'route' | 'fare' }

/** Viajes al día por persona que harían en transporte público si existiera (ciudad); entre ciudades, muchos menos. */
export const TRIPS_PER_PERSON = 0.35;
export const TRIPS_PER_PERSON_COUNTRY = 0.012;
/** Segundos que un vecino sin parada se queda esperando en su barrio antes de irse (vida media). */
export const DISTRICT_WAIT = 90;

export interface TripCandidate { from: Stop; to: Stop; legs: Leg[]; time: number }

const DAY = 24 * 60; // minutos de reloj por día

/** Densidades de las zonas de uso del suelo fuera del núcleo (personas o empleos por m²). */
const ZONE_DENSITY = { residential: 0.0065, commercial: 0.004, industrial: 0.0022 };

/** Origen o destino de viajes: un edificio o una zona (con puntos de muestra repartidos por su superficie). */
export interface Source { x: number; y: number; id: number; poly?: Pt[]; samples?: Pt[]; district: number }

/** Celda hexagonal del mapa de demanda. */
export interface Hex { q: number; r: number; x: number; y: number; residents: number; jobs: number; unserved: number }

export class Demand {
  private homes: Source[] = [];
  private homeW: Float64Array;
  private jobs: Source[] = [];
  private jobW: Float64Array;
  readonly population: number;
  readonly jobCount: number;
  readonly districts: Districts;
  /** Radio (circunscrito) de los hexágonos del mapa de demanda, en metros. */
  readonly hexR: number;
  readonly hexes = new Map<number, Hex>();
  /** Viajes recientes sin servicio, para dibujarlos. */
  unserved: Unserved[] = [];
  private acc = 0;
  private rnd = Math.random;
  readonly country: boolean;
  /** País: destino por gravedad (población / distancia^1.6), acumulado por ciudad origen. */
  private gravity: Float64Array[] = [];
  private tripsPerPerson: number;

  constructor(data: CityData, private net: Network, graph: RoadGraph) {
    let pop = 0, jobs = 0;
    const hw: number[] = [], jw: number[] = [];
    const points: WeightedPoint[] = [];
    const k = data.peopleScale ?? 1;
    this.country = data.kind === 'country';
    this.tripsPerPerson = this.country ? TRIPS_PER_PERSON_COUNTRY : TRIPS_PER_PERSON;
    if (this.country && data.cities) {
      // cada ciudad es origen y destino con el peso de su población
      data.cities.forEach((c, i) => {
        const src: Source = { x: c.x, y: c.y, id: i, district: 0 };
        this.homes.push(src); hw.push(c.pop); pop += c.pop;
        this.jobs.push({ ...src }); jw.push(c.pop); jobs += c.pop;
        points.push({ x: c.x, y: c.y, w: c.pop, kind: 'home' });
      });
      const C = data.cities;
      this.gravity = C.map((a) => {
        const cum = new Float64Array(C.length);
        let acc = 0;
        C.forEach((b, j) => { if (b !== a) { const d = Math.max(30, haversine(a.lat, a.lon, b.lat, b.lon) / 1000); acc += b.pop / Math.pow(d, 1.6); } cum[j] = acc; });
        return cum;
      });
    }
    for (const b of data.buildings) {
      const floor = b.area * b.levels;
      const src: Source = { x: b.cx, y: b.cy, id: b.id, district: 0 };
      if (b.use === 'residential') { const w = Math.max(1, floor / 35) * k; this.homes.push(src); hw.push(w); pop += w; points.push({ x: b.cx, y: b.cy, w, kind: 'home' }); }
      else { const w = Math.max(1, floor / (b.use === 'industrial' ? 60 : b.use === 'public' ? 50 : 25)) * k; this.jobs.push(src); jw.push(w); jobs += w; points.push({ x: b.cx, y: b.cy, w, kind: 'job' }); }
    }
    for (const z of data.zones ?? []) {
      const w = z.area * ZONE_DENSITY[z.kind] * k;
      if (w < 5) continue;
      const samples = zoneSamples(z);
      const src: Source = { x: z.cx, y: z.cy, id: -z.id, poly: z.poly, samples, district: 0 };
      const kind = z.kind === 'residential' ? 'home' : 'job';
      for (const p of samples) points.push({ x: p.x, y: p.y, w: w / samples.length, kind });
      if (kind === 'home') { this.homes.push(src); hw.push(w); pop += w; }
      else { this.jobs.push(src); jw.push(w); jobs += w; }
    }
    this.homeW = cumulative(hw); this.jobW = cumulative(jw);
    this.population = Math.round(pop); this.jobCount = Math.round(jobs);
    const places = this.country && data.cities ? data.cities.map(c => ({ name: c.name, kind: 'town' as const, x: c.x, y: c.y })) : data.places;
    this.districts = new Districts(points, places, data.radius, graph);
    for (const s of this.homes) s.district = this.districts.nearest(s.x, s.y);
    for (const s of this.jobs) s.district = this.districts.nearest(s.x, s.y);
    // hexágonos: unos 220 m en el centro, 500 m en el área metropolitana
    this.hexR = this.country ? 30000 : data.radius > 4000 ? 500 : data.radius > 1500 ? 220 : 120;
    for (const p of points) { const h = this.hexAt(p.x, p.y); if (p.kind === 'home') h.residents += p.w; else h.jobs += p.w; }
  }

  // ───────────── hexágonos ─────────────

  /** Celda hexagonal (puntas arriba) que contiene un punto; se crea si no existe. */
  hexAt(x: number, y: number): Hex {
    const R = this.hexR;
    const qf = ((Math.sqrt(3) / 3) * x - (1 / 3) * y) / R, rf = ((2 / 3) * y) / R;
    // redondeo a coordenadas cúbicas
    let q = Math.round(qf), r = Math.round(rf);
    const s = Math.round(-qf - rf);
    const dq = Math.abs(q - qf), dr = Math.abs(r - rf), ds = Math.abs(s + qf + rf);
    if (dq > dr && dq > ds) q = -r - s; else if (dr > ds) r = -q - s;
    const key = (q + 2048) * 4096 + (r + 2048);
    let h = this.hexes.get(key);
    if (!h) {
      h = { q, r, x: R * Math.sqrt(3) * (q + r / 2), y: R * 1.5 * r, residents: 0, jobs: 0, unserved: 0 };
      this.hexes.set(key, h);
    }
    return h;
  }

  /** Vértices de un hexágono (puntas arriba). */
  hexCorners(h: Hex): Pt[] {
    const out: Pt[] = [];
    for (let i = 0; i < 6; i++) { const a = (Math.PI / 180) * (60 * i - 30); out.push({ x: h.x + this.hexR * Math.cos(a), y: h.y + this.hexR * Math.sin(a) }); }
    return out;
  }

  // ───────────── ritmo ─────────────

  /** Factor de demanda según la hora (minutos del día). */
  static timeOfDay(minute: number): number {
    const h = (minute % DAY) / 60;
    const peak = (c: number, w: number) => Math.exp(-((h - c) ** 2) / (2 * w * w));
    return 0.25 + 1.1 * peak(8, 1.2) + 1.0 * peak(18, 1.5) + 0.35 * peak(13, 1.5);
  }

  /** Viajeros (grupos) potenciales al día. */
  dailyPotential(growth: number): number {
    return (this.population * this.tripsPerPerson * growth) / PEOPLE_PER_PASSENGER;
  }

  /** Viajeros por segundo de juego a esta hora (el día dura 720 s; la media del factor horario es ~0,7). */
  rate(minute: number, growth: number): number {
    return (this.dailyPotential(growth) / 720 / 0.7) * Demand.timeOfDay(minute);
  }

  rejected = 0;

  // ───────────── cobertura ─────────────

  /** Qué parte de la población vive a distancia andable de alguna parada; de paso, la cobertura de cada barrio. */
  coverage(): number {
    const stops = [...this.net.stops.values()];
    const k = this.districts.k;
    const cov = new Float64Array(k), tot = new Float64Array(k);
    let covered = 0, total = 0;
    const near = (p: Pt) => { for (const s of stops) if (Math.hypot(s.x - p.x, s.y - p.y) <= MODE[s.mode].walk) return true; return false; };
    const visit = (list: Source[], W: Float64Array, counts: boolean) => {
      for (let i = 0; i < list.length; i++) {
        const b = list[i];
        const w = W[i] - (i ? W[i - 1] : 0);
        let c = 0;
        if (b.samples && b.samples.length) {
          let n = 0;
          for (const p of b.samples) if (near(p)) n++;
          c = (w * n) / b.samples.length;
        } else if (stops.length && near(b)) c = w;
        cov[b.district] += c; tot[b.district] += w;
        if (counts) { covered += c; total += w; }
      }
    };
    visit(this.homes, this.homeW, true);
    visit(this.jobs, this.jobW, false);
    for (let i = 0; i < k; i++) this.districts.list[i].coverage = tot[i] ? cov[i] / tot[i] : 0;
    return total ? covered / total : 0;
  }

  // ───────────── generación ─────────────

  /** Genera los viajes que tocan en `dt` segundos. */
  tick(dt: number, minute: number, growth: number, now: number): void {
    if (!this.homes.length || !this.jobs.length) return;
    this.acc += this.rate(minute, growth) * dt;
    let n = 0;
    while (this.acc >= 1 && n < 8) { this.acc -= 1; n++; this.trip(minute, now); }
    const cutoff = now - 25;
    if (this.unserved.length && this.unserved[0].t < cutoff) this.unserved = this.unserved.filter(u => u.t >= cutoff);
    if (this.unserved.length > 160) this.unserved.splice(0, this.unserved.length - 160);
    const decay = Math.exp(-dt / DISTRICT_WAIT);
    for (const d of this.districts.list) if (d.waiting > 0) d.waiting = d.waiting < 0.05 ? 0 : d.waiting * decay;
  }

  private pick(list: Source[], w: Float64Array): Source {
    const r = this.rnd() * w[w.length - 1];
    let lo = 0, hi = w.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (w[m] < r) lo = m + 1; else hi = m; }
    return list[lo];
  }

  /** País: ciudad de destino según gravedad desde la ciudad `from`. */
  private pickGravity(from: number): number {
    const cum = this.gravity[from];
    const r = this.rnd() * cum[cum.length - 1];
    let lo = 0, hi = cum.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m] < r) lo = m + 1; else hi = m; }
    return lo;
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
    const a = this.pick(this.homes, this.homeW);
    const b = this.country ? this.jobs[this.pickGravity(a.id)] : this.pick(this.jobs, this.jobW);
    const [o, d] = this.rnd() < homeToWork ? [a, b] : [b, a];
    const op = this.pointOf(o), dp = this.pointOf(d);
    const od = o.samples ? this.districts.nearest(op.x, op.y) : o.district;
    const dd = d.samples ? this.districts.nearest(dp.x, dp.y) : d.district;
    const D = this.districts.list;
    D[od].tripsToday++;
    const res = this.bestTrip(op, dp);
    if (typeof res === 'string') {
      const atDest = res === 'dest';
      const at = atDest ? dp : op;
      this.unserved.push({ x: at.x, y: at.y, t: now, reason: res });
      this.hexAt(at.x, at.y).unserved += 1;
      this.districts.addFlow(od, dd, true);
      const where = D[atDest ? dd : od];
      where.unservedToday++;
      // sin parada cerca: el vecino se queda esperando en su barrio (se ve en el mapa)
      if (res !== 'route') where.waiting = Math.min(600, where.waiting + 1);
      this.net.stats.unserved++;
      return;
    }
    if (this.rnd() > fareAcceptance(this.net.planFare(res.legs))) {
      this.rejected++;
      this.unserved.push({ x: op.x, y: op.y, t: now, reason: 'fare' });
      this.districts.addFlow(od, dd, true);
      D[od].unservedToday++;
      return;
    }
    this.districts.addFlow(od, dd, false);
    this.net.spawn(res.from.id, res.to.id, res.legs, now, dd);
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

  /** Viviendas con su población estimada, para el mapa de población. */
  populationPoints(): Array<{ x: number; y: number; people: number; poly?: Pt[] }> {
    return this.homes.map((b, i) => ({ x: b.x, y: b.y, people: this.homeW[i] - (i ? this.homeW[i - 1] : 0), poly: b.poly }));
  }

  /** Cierre del día: la demanda sin cubrir de los hexágonos se atenúa, los barrios cierran cuentas. */
  closeDay(): void {
    for (const h of this.hexes.values()) h.unserved *= 0.5;
    this.districts.closeDay();
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
