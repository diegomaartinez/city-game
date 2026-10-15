// Estado de la partida: reloj, dinero, red, demanda, estadísticas diarias y guardado.
import type { CityData } from '../data/types.ts';
import { RoadGraph } from './graph.ts';
import { Demand } from './demand.ts';
import { MODE, Network, type Line, type Mode, type NetworkStats, type Stop } from './transit.ts';

export const START_MONEY = 60000;
export const FARE = 3;
/** Minutos de reloj que pasan por cada segundo de juego. */
export const MINUTES_PER_SECOND = 2;
export const DAY_MINUTES = 24 * 60;

export interface DayReport { day: number; delivered: number; lost: number; unserved: number; income: number; upkeep: number; avgTrip: number; satisfaction: number }

export interface SaveData {
  v: 2;
  minute: number;
  money: number;
  growth: number;
  stops: Array<{ id: number; mode: Mode; x: number; y: number; name: string }>;
  lines: Array<{ id: number; mode: Mode; color: number; name: string; stops: number[]; loop: boolean; vehicles: number }>;
  totals: NetworkStats;
  days: DayReport[];
  savedAt: number;
}

type Events = {
  network: () => void;
  money: (m: number) => void;
  message: (text: string, kind: 'info' | 'warn' | 'good') => void;
  day: (r: DayReport) => void;
};

export class Game {
  readonly graph: RoadGraph;
  readonly net: Network;
  readonly demand: Demand;
  money = START_MONEY;
  /** Minuto de reloj desde el inicio (día 1 empieza a las 6:00). */
  minute = 6 * 60;
  /** Segundos de juego transcurridos (a velocidad normal). */
  now = 0;
  growth = 1;
  days: DayReport[] = [];
  private dayStart: NetworkStats;
  private dayIncome = 0;
  private listeners: { [K in keyof Events]?: Events[K][] } = {};
  private lastDay = 0;

  constructor(public readonly data: CityData) {
    this.graph = RoadGraph.fromRoads(data.roads);
    this.net = new Network(this.graph);
    this.demand = new Demand(data, this.net);
    this.dayStart = { ...this.net.stats };
    this.net.onDelivered = () => { this.money += FARE; this.dayIncome += FARE; };
  }

  on<K extends keyof Events>(ev: K, fn: Events[K]): void { (this.listeners[ev] ??= []).push(fn as never); }
  private emit<K extends keyof Events>(ev: K, ...args: Parameters<Events[K]>): void { for (const fn of this.listeners[ev] ?? []) (fn as (...a: unknown[]) => void)(...args); }

  get day(): number { return Math.floor(this.minute / DAY_MINUTES) + 1; }
  get clock(): string {
    const m = this.minute % DAY_MINUTES;
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(Math.floor(m % 60)).padStart(2, '0')}`;
  }
  get today(): NetworkStats {
    const s = this.net.stats, d = this.dayStart;
    return { delivered: s.delivered - d.delivered, lost: s.lost - d.lost, spawned: s.spawned - d.spawned, unserved: s.unserved - d.unserved, tripTime: s.tripTime - d.tripTime, trips: s.trips - d.trips };
  }
  get satisfaction(): number {
    const t = this.today;
    const total = t.delivered + t.lost + t.unserved;
    return total < 5 ? 100 : Math.round((100 * t.delivered) / total);
  }
  get dailyUpkeep(): number {
    let u = 0;
    for (const l of this.net.lines.values()) u += l.vehicles.length * MODE[l.mode].upkeep;
    return u;
  }

  private spend(amount: number, what: string): boolean {
    if (amount > this.money) { this.emit('message', `No hay dinero para ${what} (${Math.round(amount).toLocaleString('es-ES')} €)`, 'warn'); return false; }
    this.money -= amount;
    this.emit('money', this.money);
    return true;
  }

  // ───────────── acciones ─────────────

  addStop(mode: Mode, x: number, y: number): Stop | null {
    const p = this.net.placement(mode, x, y);
    if (!p.ok) { if (p.reason) this.emit('message', p.reason, 'warn'); return null; }
    if (!this.spend(MODE[mode].stopCost, MODE[mode].stopName.toLowerCase())) return null;
    const s = this.net.addStop(mode, x, y);
    if (s) this.emit('network');
    return s;
  }

  removeStop(id: number): void {
    const s = this.net.stops.get(id);
    if (!s) return;
    this.net.removeStop(id);
    this.money += Math.round(MODE[s.mode].stopCost * 0.5);
    this.emit('money', this.money);
    this.emit('network');
  }

  createLine(mode: Mode): Line {
    const l = this.net.createLine(mode);
    this.emit('network');
    return l;
  }

  extendCost(line: Line, stopId: number): number {
    return line.mode === 'metro' ? Math.round(this.net.extensionLength(line, stopId) * MODE.metro.trackCost) : 0;
  }

  appendStop(line: Line, stopId: number): 'added' | 'closed' | 'invalid' {
    const cost = this.extendCost(line, stopId);
    const s = this.net.stops.get(stopId);
    if (!s || s.mode !== line.mode) { this.emit('message', `Esa parada no es de ${MODE[line.mode].name.toLowerCase()}`, 'warn'); return 'invalid'; }
    if (cost && !this.spend(cost, 'el túnel')) return 'invalid';
    const r = this.net.appendStop(line, stopId);
    if (r === 'invalid' && cost) { this.money += cost; this.emit('money', this.money); }
    if (r !== 'invalid') this.emit('network');
    return r;
  }

  removeStopFromLine(line: Line, stopId: number): void {
    this.net.removeStopFromLine(line.id, stopId);
    if (line.stops.length === 0) this.net.removeLine(line.id);
    this.emit('network');
  }

  removeLine(line: Line): void {
    this.money += line.vehicles.length * Math.round(MODE[line.mode].vehicleCost * 0.5);
    this.net.removeLine(line.id);
    this.emit('money', this.money);
    this.emit('network');
  }

  addVehicle(line: Line): boolean {
    if (line.stops.length < 2) { this.emit('message', 'La línea necesita al menos dos paradas', 'warn'); return false; }
    if (!this.spend(MODE[line.mode].vehicleCost, 'otro vehículo')) return false;
    this.net.addVehicle(line);
    this.emit('network');
    return true;
  }

  removeVehicle(line: Line): void {
    if (!this.net.removeVehicle(line)) return;
    this.money += Math.round(MODE[line.mode].vehicleCost * 0.5);
    this.emit('money', this.money);
    this.emit('network');
  }

  // ───────────── simulación ─────────────

  tick(dt: number): void {
    this.now += dt;
    this.minute += dt * MINUTES_PER_SECOND;
    this.demand.tick(dt, this.minute, this.growth, this.now);
    this.net.update(dt, this.now);
    this.net.expire(this.now);
    const day = Math.floor(this.minute / DAY_MINUTES);
    if (day !== this.lastDay) { this.lastDay = day; this.closeDay(); }
  }

  private closeDay(): void {
    const t = this.today;
    const upkeep = this.dailyUpkeep;
    this.money -= upkeep;
    const report: DayReport = {
      day: this.day - 1, delivered: t.delivered, lost: t.lost, unserved: t.unserved, income: Math.round(this.dayIncome), upkeep,
      avgTrip: t.trips ? t.tripTime / t.trips : 0, satisfaction: this.satisfaction,
    };
    this.days.push(report);
    this.dayStart = { ...this.net.stats };
    this.dayIncome = 0;
    this.growth *= 1.04;
    this.demand.decayHeat();
    this.emit('money', this.money);
    this.emit('day', report);
  }

  // ───────────── guardado ─────────────

  toSave(): SaveData {
    return {
      v: 2, minute: this.minute, money: this.money, growth: this.growth,
      stops: [...this.net.stops.values()].map(s => ({ id: s.id, mode: s.mode, x: s.x, y: s.y, name: s.name })),
      lines: [...this.net.lines.values()].map(l => ({ id: l.id, mode: l.mode, color: l.color, name: l.name, stops: l.stops, loop: l.loop, vehicles: l.vehicles.length })),
      totals: { ...this.net.stats }, days: this.days.slice(), savedAt: Date.now(),
    };
  }

  loadSave(s: SaveData): void {
    this.minute = s.minute; this.lastDay = Math.floor(s.minute / DAY_MINUTES); this.money = s.money; this.growth = s.growth; this.days = s.days.slice();
    this.net.stats = { ...s.totals }; this.dayStart = { ...s.totals };
    const idMap = new Map<number, number>();
    for (const st of s.stops) {
      // las paradas de bus se vuelven a ajustar a la calle desde la marquesina guardada
      const created = this.net.addStop(st.mode, st.x, st.y);
      if (created) { created.name = st.name; idMap.set(st.id, created.id); }
    }
    for (const ln of s.lines) {
      const line = this.net.createLine(ln.mode);
      line.color = ln.color; line.name = ln.name;
      for (const sid of ln.stops) { const nid = idMap.get(sid); if (nid !== undefined) this.net.appendStop(line, nid); }
      if (ln.loop && line.stops.length >= 3) this.net.appendStop(line, line.stops[0]);
      for (let i = 0; i < ln.vehicles; i++) this.net.addVehicle(line);
    }
    this.emit('network');
    this.emit('money', this.money);
  }
}
