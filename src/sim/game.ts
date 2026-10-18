// Estado de la partida: reloj, dinero, red, demanda, modos de juego (subvenciones, préstamos,
// quiebra), hitos que desbloquean líneas y metro, estadísticas diarias y guardado.
import { MARGIN, type CityData } from '../data/types.ts';
import { pointInPoly } from '../data/geo.ts';
import { RoadGraph } from './graph.ts';
import { Demand } from './demand.ts';
import { CITY_MODES, COUNTRY_MODES, FARES, MODE, Network, PEOPLE_PER_PASSENGER, applyLevelKind, type Line, type Mode, type NetworkStats, type Stop } from './transit.ts';

/** Minutos de reloj que pasan por cada segundo de juego. */
export const MINUTES_PER_SECOND = 2;
export const DAY_MINUTES = 24 * 60;

// ───────────── modos de juego ─────────────

export type GameMode = 'facil' | 'normal' | 'creativo';

export interface ModeDef {
  name: string;
  desc: string;
  start: number;
  /** Subvención diaria: euros por habitante y fracción del mantenimiento que cubre el ayuntamiento. */
  subsidyPerResident: number;
  subsidyUpkeep: number;
  loans: boolean;
  /** Días seguidos con saldo negativo antes de perder (0 = nunca). */
  bankruptDays: number;
  /** El ayuntamiento cubre el descubierto al cerrar el día. */
  bailout: boolean;
  milestones: boolean;
}

export const GAME_MODES: Record<GameMode, ModeDef> = {
  facil:    { name: 'Fácil',    desc: 'Subvención municipal diaria y sin quiebra: ideal para aprender.', start: 2_500_000, subsidyPerResident: 0.03, subsidyUpkeep: 0.6, loans: true, bankruptDays: 0, bailout: true, milestones: true },
  normal:   { name: 'Normal',   desc: 'Balance real: si pasas cinco días en números rojos pierdes la concesión. Hay préstamos.', start: 2_000_000, subsidyPerResident: 0, subsidyUpkeep: 0, loans: true, bankruptDays: 5, bailout: false, milestones: true },
  creativo: { name: 'Creativo', desc: 'Dinero infinito y todo desbloqueado: el objetivo es mover al máximo de viajeros.', start: Infinity, subsidyPerResident: 0, subsidyUpkeep: 0, loans: false, bankruptDays: 0, bailout: false, milestones: false },
};
export const GAME_MODE_LIST: GameMode[] = ['facil', 'normal', 'creativo'];

export const LOAN_STEP = 500_000;
export const MAX_DEBT = 4_000_000;
/** En los niveles de país el dinero va en millones: todas las cifras de la economía se multiplican por esto. */
export const COUNTRY_MONEY = 1000;
/** Interés diario sobre la deuda. */
export const LOAN_INTEREST = 0.004;

// ───────────── hitos ─────────────

export interface MilestoneDef { id: string; title: string; kind: 'daily' | 'total'; share: number; money: number; lines: number; metro?: boolean; /** Modo que desbloquea en un nivel de país. */ country?: Mode }
/** `unlocks`: modos que quedan disponibles al cumplirlo. */
export interface Milestone extends MilestoneDef { target: number; done: boolean; unlocks: Mode[] }

/** Objetivos en orden; `share` es la fracción de la población (viajeros al día o acumulados). */
export const MILESTONES: MilestoneDef[] = [
  { id: 'arranque', title: 'Primeros viajeros', kind: 'daily', share: 0.006, money: 100_000, lines: 1 },
  { id: 'metro', title: 'Llega el metro', kind: 'total', share: 0.06, money: 400_000, lines: 1, metro: true, country: 'plane' },
  { id: 'red', title: 'Una red de verdad', kind: 'daily', share: 0.04, money: 200_000, lines: 1, country: 'ship' },
  { id: 'barrios', title: 'Toda la ciudad se mueve', kind: 'daily', share: 0.08, money: 400_000, lines: 2 },
  { id: 'veterano', title: 'Un millón de viajes', kind: 'total', share: 0.6, money: 800_000, lines: 2 },
  { id: 'leyenda', title: 'Transporte de referencia', kind: 'daily', share: 0.15, money: 1_500_000, lines: 99 },
];
export const BASE_LINES = 2;

export interface DayReport {
  day: number; delivered: number; lost: number; unserved: number; rejected: number;
  income: number; upkeep: number; subsidy: number; interest: number; avgTrip: number; satisfaction: number; coverage: number;
}

export interface SaveData {
  v: 3 | 4;
  mode?: GameMode;
  minute: number;
  money: number;
  growth: number;
  fares: Record<Mode, number>;
  stops: Array<{ id: number; mode: Mode; x: number; y: number; name: string }>;
  lines: Array<{ id: number; mode: Mode; color: number; name: string; stops: number[]; loop: boolean; vehicles: number; vias?: Array<Array<{ x: number; y: number }>> }>;
  totals: NetworkStats;
  rejected: number;
  days: DayReport[];
  debt?: number;
  redDays?: number;
  milestonesDone?: number;
  over?: boolean;
  savedAt: number;
}

export interface Summary {
  population: number;
  jobs: number;
  potentialPeople: number;
  coverage: number;
  today: { delivered: number; lost: number; unserved: number; rejected: number; avgTrip: number };
  stops: Partial<Record<Mode, number>>;
  vehicles: Partial<Record<Mode, number>>;
  capacity: number;
  waiting: number;
  riding: number;
  incomeToday: number;
  upkeepDaily: number;
  subsidyDaily: number;
  interestDaily: number;
  netToday: number;
  debt: number;
  lines: Array<{ line: Line; boarded: number; income: number; cost: number }>;
}

type Events = {
  network: () => void;
  money: (m: number) => void;
  message: (text: string, kind: 'info' | 'warn' | 'good') => void;
  day: (r: DayReport) => void;
  milestone: (m: Milestone) => void;
  gameover: (reason: string) => void;
};

export class Game {
  readonly graph: RoadGraph;
  readonly net: Network;
  readonly demand: Demand;
  readonly def: ModeDef;
  readonly milestones: Milestone[];
  /** Nivel de país (ciudades unidas por tren, bus, avión y barco). */
  readonly country: boolean;
  /** Modos con los que se trazan líneas en este nivel. */
  readonly modes: Mode[];
  /** Factor de la economía (1 en ciudad, 1000 en país). */
  readonly moneyScale: number;
  money: number;
  debt = 0;
  /** Días seguidos cerrados con saldo negativo. */
  redDays = 0;
  over = false;
  /** Minuto de reloj desde el inicio (día 1 empieza a las 6:00). */
  minute = 6 * 60;
  /** Segundos de juego transcurridos (a velocidad normal). */
  now = 0;
  growth = 1;
  days: DayReport[] = [];
  private dayStart: NetworkStats;
  private dayStartRejected = 0;
  private dayIncome = 0;
  private listeners: { [K in keyof Events]?: Events[K][] } = {};
  private lastDay = 0;
  private coverageCache = { version: -1, value: 0 };
  private milestoneTimer = 0;

  constructor(public readonly data: CityData, public readonly mode: GameMode = 'normal') {
    this.def = GAME_MODES[mode];
    this.country = data.kind === 'country';
    this.modes = this.country ? COUNTRY_MODES : CITY_MODES;
    this.moneyScale = this.country ? COUNTRY_MONEY : 1;
    applyLevelKind(this.country);
    this.money = this.def.start * this.moneyScale;
    this.graph = RoadGraph.fromRoads(data.roads, this.country ? 3000 : undefined);
    this.net = new Network(this.graph);
    if (this.country) { this.net.cities = data.cities ?? []; this.net.landCheck = pts => this.crossesLand(pts); }
    this.demand = new Demand(data, this.net, this.graph);
    this.dayStart = { ...this.net.stats };
    // los objetivos van en proporción a los viajes potenciales diarios (la cuota de población se definió para la ciudad)
    const potential = Math.max(5, this.demand.dailyPotential(1));
    const perPop = this.country ? potential / 0.35 : Math.max(50, this.demand.population) / PEOPLE_PER_PASSENGER;
    void potential;
    this.milestones = MILESTONES.map(m => ({
      ...m, money: m.money * this.moneyScale,
      target: Math.max(5, Math.ceil(perPop * m.share)), done: !this.def.milestones,
      unlocks: this.country ? (m.country ? [m.country] : []) : (m.metro ? ['metro'] : []),
    }));
    this.net.onDelivered = p => {
      const fare = this.net.planFare(p.legs) * PEOPLE_PER_PASSENGER;
      this.money += fare; this.dayIncome += fare;
      const first = this.net.lines.get(p.legs[0]?.line);
      if (first) first.incomeToday += fare;
    };
  }

  on<K extends keyof Events>(ev: K, fn: Events[K]): void { (this.listeners[ev] ??= []).push(fn as never); }
  private emit<K extends keyof Events>(ev: K, ...args: Parameters<Events[K]>): void { for (const fn of this.listeners[ev] ?? []) (fn as (...a: unknown[]) => void)(...args); }

  get creative(): boolean { return this.mode === 'creativo'; }
  get day(): number { return Math.floor(this.minute / DAY_MINUTES) + 1; }
  get clock(): string {
    const m = this.minute % DAY_MINUTES;
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(Math.floor(m % 60)).padStart(2, '0')}`;
  }
  get today(): NetworkStats & { rejected: number } {
    const s = this.net.stats, d = this.dayStart;
    return { delivered: s.delivered - d.delivered, lost: s.lost - d.lost, spawned: s.spawned - d.spawned, unserved: s.unserved - d.unserved, tripTime: s.tripTime - d.tripTime, trips: s.trips - d.trips, rejected: this.demand.rejected - this.dayStartRejected };
  }
  /** Porcentaje de viajeros atendidos que llegaron (los que no tenían parada cerca se cuentan aparte). */
  get satisfaction(): number {
    const t = this.today;
    const total = t.delivered + t.lost;
    return total < 3 ? 100 : Math.round((100 * t.delivered) / total);
  }
  get dailyUpkeep(): number {
    let u = 0;
    for (const l of this.net.lines.values()) u += l.vehicles.length * MODE[l.mode].upkeep;
    return u;
  }
  /** Subvención municipal del día (modo fácil). */
  get dailySubsidy(): number {
    return Math.round(this.def.subsidyPerResident * this.demand.population + this.def.subsidyUpkeep * this.dailyUpkeep);
  }
  get dailyInterest(): number { return Math.round(this.debt * LOAN_INTEREST); }
  /** Balance previsto del día: billetes hasta ahora + subvención − mantenimiento − intereses. */
  get netToday(): number { return this.dayIncome + this.dailySubsidy - this.dailyUpkeep - this.dailyInterest; }
  get coverage(): number {
    if (this.coverageCache.version !== this.net.version) this.coverageCache = { version: this.net.version, value: this.demand.coverage() };
    return this.coverageCache.value;
  }
  get fares(): Record<Mode, number> { return FARES; }
  setFare(mode: Mode, value: number): void { FARES[mode] = Math.round(value * 10) / 10; }

  // ───────────── hitos ─────────────

  get nextMilestone(): Milestone | undefined { return this.milestones.find(m => !m.done); }
  /** Progreso actual hacia un hito, en viajeros (grupos). */
  milestoneProgress(m: Milestone): number { return m.kind === 'daily' ? this.today.delivered : this.net.stats.delivered; }
  get maxLines(): number {
    if (!this.def.milestones) return Infinity;
    let n = BASE_LINES;
    for (const m of this.milestones) if (m.done) n += m.lines;
    return n >= 99 ? Infinity : n;
  }
  /** ¿Está disponible este modo? (el metro, el avión y el barco llegan con los hitos). */
  unlocked(mode: Mode): boolean {
    if (!this.def.milestones) return true;
    const m = this.milestones.find(x => x.unlocks.includes(mode));
    return !m || m.done;
  }
  /** Qué hace falta para usar un modo (o '' si ya está disponible). */
  lockText(mode: Mode): string {
    if (this.unlocked(mode)) return '';
    const m = this.milestones.find(x => x.unlocks.includes(mode))!;
    return `${MODE[mode].name === 'Avión' ? 'El avión' : MODE[mode].name === 'Barco' ? 'El barco' : 'El metro'} se desbloquea con el hito «${m.title}»: ${(m.target * PEOPLE_PER_PASSENGER).toLocaleString('es-ES')} viajeros ${m.kind === 'daily' ? 'en un día' : 'en total'}`;
  }
  get metroUnlocked(): boolean { return this.unlocked('metro'); }
  get metroLockText(): string { return this.lockText('metro'); }

  private checkMilestones(): void {
    const m = this.nextMilestone;
    if (!m || this.milestoneProgress(m) < m.target) return;
    m.done = true;
    if (Number.isFinite(this.money)) this.money += m.money;
    this.emit('money', this.money);
    this.emit('milestone', m);
  }

  summary(): Summary {
    const t = this.today;
    const stops: Partial<Record<Mode, number>> = {};
    for (const m of this.modes) stops[m] = 0;
    if (this.country) stops.hub = 0;
    for (const s of this.net.stops.values()) stops[s.mode] = (stops[s.mode] ?? 0) + 1;
    const vehicles: Partial<Record<Mode, number>> = {};
    for (const m of this.modes) vehicles[m] = 0;
    let capacity = 0;
    const lines: Summary['lines'] = [];
    for (const l of this.net.lines.values()) {
      vehicles[l.mode] = (vehicles[l.mode] ?? 0) + l.vehicles.length;
      capacity += l.vehicles.length * MODE[l.mode].capacity;
      lines.push({ line: l, boarded: l.boardedToday, income: l.incomeToday, cost: l.vehicles.length * MODE[l.mode].upkeep });
    }
    return {
      population: this.demand.population, jobs: this.demand.jobCount,
      potentialPeople: Math.round(this.demand.dailyPotential(this.growth) * PEOPLE_PER_PASSENGER),
      coverage: this.coverage,
      today: { delivered: t.delivered, lost: t.lost, unserved: t.unserved, rejected: t.rejected, avgTrip: t.trips ? t.tripTime / t.trips : 0 },
      stops, vehicles, capacity, waiting: this.net.waiting, riding: this.net.riding,
      incomeToday: this.dayIncome, upkeepDaily: this.dailyUpkeep, subsidyDaily: this.dailySubsidy, interestDaily: this.dailyInterest, netToday: this.netToday, debt: this.debt, lines,
    };
  }

  private spend(amount: number, what: string): boolean {
    if (amount > this.money) {
      const hint = this.def.loans && this.debt < this.maxDebt ? ' · puedes pedir un préstamo en el resumen (R)' : '';
      this.emit('message', `No hay dinero para ${what} (${Math.round(amount).toLocaleString('es-ES')} €)${hint}`, 'warn');
      return false;
    }
    this.money -= amount;
    this.emit('money', this.money);
    return true;
  }

  private refund(amount: number): void {
    if (Number.isFinite(this.money)) this.money += amount;
    this.emit('money', this.money);
  }

  // ───────────── préstamos ─────────────

  get loanStep(): number { return LOAN_STEP * this.moneyScale; }
  get maxDebt(): number { return MAX_DEBT * this.moneyScale; }

  borrow(amount = this.loanStep): boolean {
    if (!this.def.loans) return false;
    if (this.debt + amount > this.maxDebt) { this.emit('message', `El banco no presta más de ${this.maxDebt.toLocaleString('es-ES')} €`, 'warn'); return false; }
    this.debt += amount; this.money += amount;
    this.emit('message', `Préstamo de ${amount.toLocaleString('es-ES')} € · ${Math.round(LOAN_INTEREST * 1000) / 10} % de interés al día`, 'info');
    this.emit('money', this.money);
    return true;
  }

  repay(amount = this.loanStep): boolean {
    const a = Math.min(amount, this.debt);
    if (a <= 0) return false;
    if (a > this.money) { this.emit('message', 'No hay saldo para devolver el préstamo', 'warn'); return false; }
    this.debt -= a; this.money -= a;
    this.emit('money', this.money);
    return true;
  }

  // ───────────── acciones ─────────────

  /** ¿Queda un punto dentro del mapa jugable? */
  inBounds(x: number, y: number): boolean {
    const w = (this.data.halfW ?? this.data.radius) + MARGIN, h = (this.data.halfH ?? this.data.radius) + MARGIN;
    return Math.abs(x) <= w && Math.abs(y) <= h;
  }

  addStop(mode: Mode, x: number, y: number): Stop | null {
    if (!this.unlocked(mode)) { this.emit('message', this.lockText(mode), 'warn'); return null; }
    if (!this.inBounds(x, y)) { this.emit('message', 'Eso queda fuera del mapa', 'warn'); return null; }
    const p = this.net.placement(mode, x, y);
    if (!p.ok) { if (p.reason) this.emit('message', p.reason, 'warn'); return null; }
    if (!this.spend(MODE[mode].stopCost, MODE[mode].stopName.toLowerCase())) return null;
    const s = this.net.addStop(mode, x, y);
    if (s) this.networkChanged();
    return s;
  }

  removeStop(id: number): void {
    const s = this.net.stops.get(id);
    if (!s) return;
    this.net.removeStop(id);
    this.refund(Math.round(MODE[s.mode].stopCost * 0.5));
    this.networkChanged();
  }

  /** Si se puede crear otra línea (límite por hitos); si no, explica por qué. */
  canCreateLine(mode: Mode): string {
    if (!this.unlocked(mode)) return this.lockText(mode);
    if (this.net.lines.size >= this.maxLines) {
      const m = this.nextMilestone;
      return `Ya tienes ${this.maxLines} líneas: el siguiente hito («${m?.title ?? ''}») te dará más`;
    }
    return '';
  }

  createLine(mode: Mode): Line | null {
    const why = this.canCreateLine(mode);
    if (why) { this.emit('message', why, 'warn'); return null; }
    const l = this.net.createLine(mode);
    this.networkChanged();
    return l;
  }

  /** Coste de llevar la línea hasta una parada: vía o túnel por metro y, en los niveles de país, la infraestructura de la ciudad (estación, aeropuerto, puerto) si es la primera línea de ese modo que llega. */
  extendCost(line: Line, stopId: number): number {
    const def = MODE[line.mode];
    let cost = def.trackCost ? Math.round(this.net.extensionLength(line, stopId) * def.trackCost) : 0;
    if (this.country) {
      const s = this.net.stops.get(stopId);
      const served = s ? s.lines.some(id => this.net.lines.get(id)?.mode === line.mode) : false;
      if (s && !served) {
        const c = s.city !== undefined ? this.net.cities?.[s.city] : undefined;
        // un aeropuerto existente sale casi gratis; construir uno nuevo no se permite
        cost += line.mode === 'plane' && c?.airport ? Math.round(def.stopCost * 0.1) : def.stopCost;
      }
    }
    return cost;
  }

  /** País: ¿puede este modo llegar a la ciudad? Devuelve el motivo si no. */
  private cityCheck(line: Line, s: Stop): string {
    if (!this.country || s.city === undefined) return '';
    const c = this.net.cities![s.city];
    if (line.mode === 'plane' && !c.airport) return `${c.name} no tiene aeropuerto`;
    if (line.mode === 'ship' && !c.coastal) return `${c.name} no tiene puerto: no está en la costa`;
    return '';
  }

  /** ¿Una polilínea (trazado de un barco) atraviesa tierra, más allá de las orillas de salida y llegada? */
  crossesLand(pts: { x: number; y: number }[]): boolean {
    const land = this.data.map?.land ?? [];
    if (!land.length || pts.length < 2) return false;
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
    const len = cum[cum.length - 1], step = 3000, margin = 12000;
    let k = 1;
    for (let d = margin; d < len - margin; d += step) {
      while (k < cum.length - 1 && cum[k] < d) k++;
      const a = pts[k - 1], b = pts[k], t = (d - cum[k - 1]) / ((cum[k] - cum[k - 1]) || 1);
      const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
      for (const poly of land) if (pointInPoly(x, y, poly)) return true;
    }
    return false;
  }

  appendStop(line: Line, stopId: number): 'added' | 'closed' | 'invalid' {
    const s = this.net.stops.get(stopId);
    if (!s || (s.mode !== line.mode && s.mode !== 'hub')) { this.emit('message', `Esa parada no es de ${MODE[line.mode].name.toLowerCase()}`, 'warn'); return 'invalid'; }
    const why = this.cityCheck(line, s);
    if (why) { this.emit('message', why, 'warn'); return 'invalid'; }
    const cost = this.extendCost(line, stopId);
    if (cost && !this.spend(cost, line.mode === 'metro' ? 'el túnel' : line.mode === 'train' ? 'la vía y la estación' : MODE[line.mode].stopName.toLowerCase())) return 'invalid';
    const before = line.warnings;
    const r = this.net.appendStop(line, stopId);
    if (r === 'invalid' && cost) this.refund(cost);
    if (r !== 'invalid') {
      if (line.mode === 'ship' && line.warnings > before) this.emit('message', 'El trazado cruza tierra: arrastra la línea para rodear la costa', 'warn');
      this.networkChanged();
    }
    return r;
  }

  /** Añade, mueve o quita puntos de paso de un tramo de la línea. */
  setVias(line: Line, seg: number, vias: { x: number; y: number }[]): void {
    this.net.setVias(line, seg, vias);
    this.networkChanged();
  }

  removeStopFromLine(line: Line, stopId: number): void {
    this.net.removeStopFromLine(line.id, stopId);
    if (line.stops.length === 0) this.net.removeLine(line.id);
    this.networkChanged();
  }

  removeLine(line: Line): void {
    let back = line.vehicles.length * Math.round(MODE[line.mode].vehicleCost * 0.5);
    if (this.country) {
      // la infraestructura de las ciudades que se quedan sin este modo se recupera (entera si la línea nunca llegó a operar)
      const share = line.stops.length < 2 ? 1 : 0.5;
      for (const sid of line.stops) {
        const s = this.net.stops.get(sid);
        if (!s || s.lines.some(id => id !== line.id && this.net.lines.get(id)?.mode === line.mode)) continue;
        const c = s.city !== undefined ? this.net.cities?.[s.city] : undefined;
        back += Math.round((line.mode === 'plane' && c?.airport ? MODE.plane.stopCost * 0.1 : MODE[line.mode].stopCost) * share);
      }
    }
    this.net.removeLine(line.id);
    this.refund(back);
    this.networkChanged();
  }

  addVehicle(line: Line): boolean {
    if (line.stops.length < 2) { this.emit('message', 'La línea necesita al menos dos paradas', 'warn'); return false; }
    if (!this.spend(MODE[line.mode].vehicleCost, 'otro vehículo')) return false;
    this.net.addVehicle(line);
    this.networkChanged();
    return true;
  }

  removeVehicle(line: Line): void {
    if (!this.net.removeVehicle(line)) return;
    this.refund(Math.round(MODE[line.mode].vehicleCost * 0.5));
    this.networkChanged();
  }

  private networkChanged(): void {
    this.coverageCache = { version: this.net.version, value: this.demand.coverage() };
    for (const d of this.demand.districts.list) d.waiting *= 1 - d.coverage;
    this.emit('network');
  }

  // ───────────── simulación ─────────────

  tick(dt: number): void {
    if (this.over) return;
    this.now += dt;
    this.minute += dt * MINUTES_PER_SECOND;
    this.demand.tick(dt, this.minute, this.growth, this.now);
    this.net.update(dt, this.now);
    this.net.expire(this.now);
    this.milestoneTimer += dt;
    if (this.milestoneTimer > 1) { this.milestoneTimer = 0; this.checkMilestones(); }
    const day = Math.floor(this.minute / DAY_MINUTES);
    if (day !== this.lastDay) { this.lastDay = day; this.closeDay(); }
  }

  private closeDay(): void {
    this.checkMilestones();
    const t = this.today;
    const upkeep = this.dailyUpkeep, subsidy = this.dailySubsidy, interest = this.dailyInterest;
    this.money += subsidy - upkeep - interest;
    const report: DayReport = {
      day: this.day - 1, delivered: t.delivered, lost: t.lost, unserved: t.unserved, rejected: t.rejected, income: Math.round(this.dayIncome), upkeep, subsidy, interest,
      avgTrip: t.trips ? t.tripTime / t.trips : 0, satisfaction: this.satisfaction, coverage: this.coverage,
    };
    this.days.push(report);
    this.dayStart = { ...this.net.stats };
    this.dayStartRejected = this.demand.rejected;
    this.dayIncome = 0;
    for (const l of this.net.lines.values()) { l.boardedToday = 0; l.incomeToday = 0; }
    this.growth *= 1.03;
    this.demand.closeDay();
    this.emit('day', report);
    // números rojos
    if (this.money < 0) {
      if (this.def.bailout) {
        this.emit('message', `El ayuntamiento cubre el descubierto de ${Math.round(-this.money).toLocaleString('es-ES')} €`, 'info');
        this.money = 0;
      } else if (this.def.bankruptDays) {
        this.redDays++;
        const left = this.def.bankruptDays - this.redDays;
        if (left <= 0) { this.over = true; this.emit('money', this.money); this.emit('gameover', `Has cerrado ${this.redDays} días seguidos con saldo negativo y la ciudad retira la concesión.`); return; }
        this.emit('message', `Saldo negativo: ${left} día${left === 1 ? '' : 's'} para perder la concesión · pide un préstamo (R) o recorta vehículos`, 'warn');
      }
    } else this.redDays = 0;
    this.emit('money', this.money);
  }

  // ───────────── guardado ─────────────

  toSave(): SaveData {
    return {
      v: 4, mode: this.mode, minute: this.minute, money: Number.isFinite(this.money) ? this.money : 0, growth: this.growth, fares: { ...FARES },
      stops: [...this.net.stops.values()].map(s => ({ id: s.id, mode: s.mode, x: s.x, y: s.y, name: s.name })),
      lines: [...this.net.lines.values()].map(l => ({ id: l.id, mode: l.mode, color: l.color, name: l.name, stops: l.stops, loop: l.loop, vehicles: l.vehicles.length, vias: l.vias })),
      totals: { ...this.net.stats }, rejected: this.demand.rejected, days: this.days.slice(),
      debt: this.debt, redDays: this.redDays, milestonesDone: this.milestones.filter(m => m.done).length, over: this.over, savedAt: Date.now(),
    };
  }

  loadSave(s: SaveData): void {
    this.minute = s.minute; this.lastDay = Math.floor(s.minute / DAY_MINUTES); this.growth = s.growth; this.days = s.days.slice();
    this.money = this.creative ? Infinity : s.money;
    this.debt = s.debt ?? 0; this.redDays = s.redDays ?? 0; this.over = s.over ?? false;
    if (this.def.milestones) {
      const n = s.milestonesDone ?? 0;
      this.milestones.forEach((m, i) => { m.done = i < n; });
    }
    if (s.fares) Object.assign(FARES, s.fares);
    this.net.stats = { ...s.totals }; this.dayStart = { ...s.totals };
    this.demand.rejected = s.rejected ?? 0; this.dayStartRejected = this.demand.rejected;
    const idMap = new Map<number, number>();
    for (const st of s.stops) {
      const created = this.net.addStop(st.mode, st.x, st.y);
      if (created) { created.name = st.name; idMap.set(st.id, created.id); }
    }
    for (const ln of s.lines) {
      const line = this.net.createLine(ln.mode);
      line.color = ln.color; line.name = ln.name;
      for (const sid of ln.stops) { const nid = idMap.get(sid); if (nid !== undefined) this.net.appendStop(line, nid); }
      if (ln.loop && line.stops.length >= 3) this.net.appendStop(line, line.stops[0]);
      if (ln.vias) ln.vias.forEach((v, i) => { if (v.length) this.net.setVias(line, i, v); });
      for (let i = 0; i < ln.vehicles; i++) this.net.addVehicle(line);
    }
    this.networkChanged();
    this.emit('money', this.money);
  }
}
