// HUD: barra de estado, herramientas, panel de líneas, resumen (demanda, oferta, finanzas, préstamos,
// precios, barrios, hitos), fichas de barrio sobre el mapa, mensajes, informe diario, menú y ayuda.
import { GAME_MODES, type DayReport, type Game, type Milestone } from '../sim/game.ts';
import { LINE_COLORS, MODE, PEOPLE_PER_PASSENGER, type Line, type Mode, type Stop } from '../sim/transit.ts';
import { MAP_STYLES, type MapStyle } from '../render/palette.ts';
import { OVERLAYS, type Overlay } from '../render/transitRenderer.ts';
import type { World } from '../render/world.ts';
import type { Hover, Tool, Tools } from './tools.ts';

const ICONS: Record<string, string> = {
  pan: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3"/></svg>',
  'stop:bus': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="4" y="4" width="16" height="14" rx="3" fill="#f4f1ea"/><path d="M4 10h16" /><rect x="7" y="7" width="4" height="2" fill="currentColor"/><rect x="13" y="7" width="4" height="2" fill="currentColor"/><circle cx="8" cy="19" r="1.6" fill="currentColor"/><circle cx="16" cy="19" r="1.6" fill="currentColor"/><path d="M9 13h6" stroke="#d23b33" stroke-width="2.5"/></svg>',
  'stop:metro': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="8" fill="#ffffff"/><path d="M8 16V8l4 5 4-5v8" stroke="#2f6fc4" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  'line:bus': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M4 18c4 0 4-12 8-12s4 12 8 12" stroke="#d23b33" stroke-width="3"/><circle cx="4" cy="18" r="2.5" fill="#fff"/><circle cx="12" cy="6" r="2.5" fill="#fff"/><circle cx="20" cy="18" r="2.5" fill="#fff"/></svg>',
  'line:metro': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M4 18L12 6l8 12" stroke="#2f6fc4" stroke-width="3.5"/><circle cx="4" cy="18" r="2.8" fill="#ffffff"/><circle cx="12" cy="6" r="2.8" fill="#ffffff"/><circle cx="20" cy="18" r="2.8" fill="#ffffff"/></svg>',
  remove: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="7" fill="#fff"/><path d="M8 8l8 8M16 8l-8 8" stroke="#d23b33"/></svg>',
  'line:train': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="5" y="3" width="14" height="14" rx="3" fill="#fff"/><path d="M5 10h14" stroke="#3c8d4f" stroke-width="2.6"/><circle cx="9" cy="14" r="1.3" fill="currentColor"/><circle cx="15" cy="14" r="1.3" fill="currentColor"/><path d="M8 17l-2 4M16 17l2 4" stroke-linecap="round"/></svg>',
  'line:plane': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M3 13l8-1 4-8 2 1-2 7 6 2v2l-6-1-1 5 2 1-1 2-3-1-3 1-1-2 2-1-1-5-6 1z" fill="#fff"/></svg>',
  'line:ship': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"><path d="M3 14l2 5h14l2-5-9-3z" fill="#fff"/><path d="M8 11V6h8v5" fill="#fff"/><path d="M12 3v3" stroke="#2f6fc4" stroke-width="2.6"/><path d="M2 21c2 1 4 1 6 0s4-1 6 0 4 1 6 0" stroke="#2f6fc4"/></svg>',
  overlay: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3l7.8 4.5v9L12 21l-7.8-4.5v-9z" fill="#e88a82" opacity=".55"/><path d="M12 8l3.5 2v4L12 16l-3.5-2v-4z" fill="#d23b33"/></svg>',
  fichas: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="5" width="18" height="11" rx="2.5" fill="#fff"/><path d="M7 9h10M7 12.5h6"/><path d="M12 16v4"/></svg>',
  summary: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M4 20V10M10 20V4M16 20v-8M22 20H2"/></svg>',
  menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
  help: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7M12 17h.01"/></svg>',
  lock: '<svg viewBox="0 0 24 24" fill="#fff" stroke="#2b3440" stroke-width="2"><rect x="5" y="10" width="14" height="11" rx="2.5"/><path d="M8 10V7a4 4 0 0 1 8 0v3" fill="none"/></svg>',
};

const fmt = (n: number) => Math.round(n).toLocaleString('es-ES');
const eur = (n: number) => (Number.isFinite(n) ? fmt(n) + ' €' : '∞');
const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');
const people = (dots: number) => fmt(dots * PEOPLE_PER_PASSENGER);
const signed = (n: number) => (n >= 0 ? '+' : '') + eur(n);
/** Dinero abreviado para cifras grandes (12,5 M€). */
const money = (n: number) => (Math.abs(n) >= 1e6 ? (n / 1e6).toLocaleString('es-ES', { maximumFractionDigits: 1 }) + ' M€' : eur(n));
const vehName = (m: Mode, singular = false) => ({ bus: singular ? 'bus' : 'Buses', metro: singular ? 'tren' : 'Trenes', train: singular ? 'tren' : 'Trenes', plane: singular ? 'avión' : 'Aviones', ship: singular ? 'barco' : 'Barcos', hub: '' })[m];

export class Hud {
  readonly root = document.createElement('div');
  speed = 1;
  onSpeed: (s: number) => void = () => undefined;
  onMenu: (action: 'save' | 'exit' | 'creative') => void = () => undefined;
  onOverlay: (mode: Overlay) => void = () => undefined;
  onStyle: (style: MapStyle) => void = () => undefined;
  style: MapStyle = 'plano';
  private overlay: Overlay = 'none';
  private fichasOn = true;
  private els: Record<string, HTMLElement> = {};
  private toolButtons = new Map<string, HTMLButtonElement>();
  private fichas = new Map<number, HTMLElement>();
  private panelStop: Stop | null = null;
  private summaryOpen = false;
  private goalTop = -1;

  constructor(private game: Game, private tools: Tools, private world: World) {
    this.root.id = 'hud';
    const creative = game.creative;
    this.root.innerHTML = `
      <div id="districts"></div>
      <div id="topbar" class="card">
        <span class="city" id="cityName"></span>
        <div class="stat"><b id="clock"></b><small id="dayLabel">día 1</small></div>
        <div class="stat ${creative ? 'hidden' : ''}"><b id="money"></b><small>dinero</small></div>
        <div class="stat ${creative ? 'hidden' : ''}"><b id="net"></b><small>balance hoy</small></div>
        <div class="stat"><b id="delivered"></b><small>viajeros hoy</small></div>
        <div class="stat"><b id="total"></b><small>en total</small></div>
        <div class="stat opt"><b id="riding"></b><small>a bordo</small></div>
        <div class="stat opt"><b id="waiting"></b><small>esperando</small></div>
        <div class="stat opt"><b id="satis"></b><small>llegan</small></div>
        <div id="speed">
          <button class="btn" data-speed="0" title="Pausa (espacio)">⏸</button>
          <button class="btn active" data-speed="1" title="Velocidad normal">▶</button>
          <button class="btn" data-speed="2" title="Rápido (2)">▶▶</button>
          <button class="btn" data-speed="4" title="Muy rápido (3)">▶▶▶</button>
        </div>
      </div>
      <div id="goal" class="card ${creative ? 'hidden' : ''}"><span id="goalText"></span><div class="bar"><div id="goalBar"></div></div></div>
      <div id="topright">
        <button class="btn tool" id="summaryBtn" title="Resumen (R)">${ICONS.summary}</button>
        <button class="btn tool active" id="fichasBtn" title="Fichas de barrio (F)">${ICONS.fichas}</button>
        <button class="btn tool" id="overlayBtn" title="Capas: demanda sin cubrir / población (G)">${ICONS.overlay}</button>
        <button class="btn tool" id="helpBtn" title="Ayuda (H)">${ICONS.help}</button>
        <button class="btn tool" id="menuBtn" title="Menú (Esc)">${ICONS.menu}</button>
      </div>
      <div id="toolbar" class="card"></div>
      <div id="panel" class="card hidden"></div>
      <div id="summary" class="card hidden"></div>
      <div id="actions" class="hidden">
        <button class="btn primary" id="finishLine">Terminar línea</button>
        <button class="btn" id="cancelLine">Quitar última</button>
      </div>
      <div id="hint" class="card"></div>
      <div id="info" class="card hidden"></div>
      <div id="toasts"></div>`;
    document.body.appendChild(this.root);
    for (const id of ['districts', 'cityName', 'clock', 'dayLabel', 'money', 'net', 'delivered', 'total', 'riding', 'waiting', 'satis', 'goal', 'goalText', 'goalBar', 'hint', 'info', 'toasts', 'panel', 'summary']) this.els[id] = this.root.querySelector('#' + id)!;
    this.els.cityName.textContent = game.data.name;
    this.buildToolbar();
    this.buildFichas();
    this.fichasOn = !game.country;
    try { const v = localStorage.getItem(game.country ? 'lt-fichas-pais' : 'lt-fichas'); if (v !== null) this.fichasOn = v === '1'; } catch { /* sin almacenamiento */ }
    this.applyFichas();

    this.root.querySelectorAll<HTMLButtonElement>('#speed .btn').forEach(b => { b.onclick = () => this.setSpeed(+b.dataset.speed!); });
    (this.root.querySelector('#menuBtn') as HTMLButtonElement).onclick = () => this.openMenu();
    (this.root.querySelector('#helpBtn') as HTMLButtonElement).onclick = () => this.openHelp();
    (this.root.querySelector('#summaryBtn') as HTMLButtonElement).onclick = () => this.toggleSummary();
    (this.root.querySelector('#overlayBtn') as HTMLButtonElement).onclick = () => this.cycleOverlay();
    (this.root.querySelector('#fichasBtn') as HTMLButtonElement).onclick = () => this.toggleFichas();
    this.els.goal.onclick = () => { if (!this.summaryOpen) this.toggleSummary(); };

    game.on('money', m => { this.els.money.textContent = game.country ? money(m) : eur(m); this.els.money.classList.toggle('neg', m < 0); });
    game.on('message', (t, k) => this.toast(t, k));
    game.on('network', () => { this.renderPanel(); this.updateLocks(); if (this.summaryOpen) this.renderSummary(); });
    game.on('day', r => this.dayReport(r));
    game.on('milestone', m => this.milestone(m));
    game.on('gameover', reason => this.gameOver(reason));
    tools.onToolChange = t => { this.markTool(t); this.root.querySelector('#actions')!.classList.toggle('hidden', t !== 'line'); };
    (this.root.querySelector('#finishLine') as HTMLButtonElement).onclick = () => { tools.finishLine(); tools.setTool('pan'); };
    (this.root.querySelector('#cancelLine') as HTMLButtonElement).onclick = () => {
      const l = tools.editing;
      if (!l) return;
      const last = l.stops[l.stops.length - 1];
      if (last !== undefined) { game.removeStopFromLine(l, last); if (!game.net.lines.has(l.id)) { tools.editing = null; tools.setTool('pan'); return; } }
      tools.onHint(tools.hintFor('line'));
    };
    tools.onHint = t => { this.els.hint.textContent = t; };
    tools.onHover = h => this.showHover(h);
    tools.onSelect = (line, stop) => { this.panelStop = stop; this.renderPanel(line); };
    this.els.money.textContent = game.country ? money(game.money) : eur(game.money);
    this.markTool('pan');
    this.updateLocks();
    this.els.hint.textContent = tools.hintFor('pan');
    this.refresh();
    window.addEventListener('keydown', e => this.key(e));
  }

  private buildToolbar(): void {
    const bar = this.root.querySelector('#toolbar')!;
    const items: Array<[string, string, string] | 'sep'> = this.game.country ? [
      ['pan', 'Mover y ver', '1'], 'sep',
      ['line:train', 'Nueva línea de tren', 'T'], ['line:bus', 'Nueva línea de bus', 'B'], 'sep',
      ['line:plane', 'Nueva ruta aérea', 'P'], ['line:ship', 'Nueva línea marítima', 'S'], 'sep',
      ['remove', 'Quitar ciudad de la red', 'D'],
    ] : [
      ['pan', 'Mover y ver', '1'], 'sep',
      ['stop:bus', 'Parada de bus', 'B'], ['line:bus', 'Nueva línea de bus', 'L'], 'sep',
      ['stop:metro', 'Estación de metro', 'M'], ['line:metro', 'Nueva línea de metro', 'K'], 'sep',
      ['remove', 'Quitar parada', 'D'],
    ];
    for (const it of items) {
      if (it === 'sep') { const s = document.createElement('div'); s.className = 'sep'; bar.appendChild(s); continue; }
      const [id, label, key] = it;
      const b = document.createElement('button');
      b.className = 'btn tool';
      b.title = `${label} (${key})`;
      b.innerHTML = `${ICONS[id]}<span class="key">${key}</span><span class="lock">${ICONS.lock}</span>`;
      b.onclick = () => this.pick(id);
      bar.appendChild(b);
      this.toolButtons.set(id, b);
    }
  }

  /** Candados en las herramientas aún no desbloqueadas por los hitos. */
  private updateLocks(): void {
    const g = this.game;
    const full = g.net.lines.size >= g.maxLines;
    for (const [id, b] of this.toolButtons) {
      const [kind, mode] = id.split(':') as [string, Mode | undefined];
      if (!mode) continue;
      b.classList.toggle('locked', !g.unlocked(mode) || (kind === 'line' && full));
    }
  }

  pick(id: string): void {
    const g = this.game;
    const [kind, mode] = id.split(':') as [string, Mode | undefined];
    if (mode && !g.unlocked(mode)) { this.toast(g.lockText(mode), 'warn'); return; }
    if (kind === 'line' && mode) {
      const why = g.canCreateLine(mode);
      if (why) { this.toast(why, 'warn'); return; }
      this.tools.startLine(mode);
    } else this.tools.setTool(id as Tool);
  }

  private markTool(t: Tool): void {
    for (const [id, b] of this.toolButtons) {
      const active = id === t || (t === 'line' && this.tools.editing && id === `line:${this.tools.editing.mode}`);
      b.classList.toggle('active', !!active);
    }
  }

  setSpeed(s: number): void {
    this.speed = s;
    this.root.querySelectorAll<HTMLButtonElement>('#speed .btn').forEach(b => b.classList.toggle('active', +b.dataset.speed! === s));
    this.onSpeed(s);
  }

  private cycleOverlay(): void {
    this.overlay = OVERLAYS[(OVERLAYS.indexOf(this.overlay) + 1) % OVERLAYS.length];
    const b = this.root.querySelector('#overlayBtn') as HTMLButtonElement;
    b.classList.toggle('active', this.overlay !== 'none');
    this.onOverlay(this.overlay);
    const tips: Record<Overlay, string> = {
      none: 'Capa: ninguna',
      hexDemand: 'Capa: demanda sin cubrir por zona (vecinos que hoy no tuvieron parada o ruta)',
      hexPop: 'Capa: población y empleos por zona',
    };
    this.toast(tips[this.overlay], 'info');
  }

  private toggleFichas(): void {
    this.fichasOn = !this.fichasOn;
    try { localStorage.setItem(this.game.country ? 'lt-fichas-pais' : 'lt-fichas', this.fichasOn ? '1' : '0'); } catch { /* sin almacenamiento */ }
    this.applyFichas();
  }

  private applyFichas(): void {
    this.els.districts.classList.toggle('hidden', !this.fichasOn);
    (this.root.querySelector('#fichasBtn') as HTMLButtonElement).classList.toggle('active', this.fichasOn);
  }

  private key(e: KeyboardEvent): void {
    if ((e.target as HTMLElement).tagName === 'INPUT') return;
    const k = e.key.toLowerCase();
    if (k === 'escape') {
      const m = document.querySelector('.modal');
      if (m) { m.remove(); return; }
      if (this.tools.tool !== 'pan' || this.tools.selected) this.tools.cancel(); else this.openMenu();
      return;
    }
    if (k === 'enter' && this.tools.tool === 'line') { this.tools.finishLine(); this.tools.setTool('pan'); return; }
    const map: Record<string, string> = this.game.country
      ? { '1': 'pan', t: 'line:train', b: 'line:bus', p: 'line:plane', s: 'line:ship', d: 'remove' }
      : { '1': 'pan', b: 'stop:bus', m: 'stop:metro', l: 'line:bus', k: 'line:metro', d: 'remove' };
    if (map[k]) { this.pick(map[k]); return; }
    if (k === ' ') { e.preventDefault(); this.setSpeed(this.speed === 0 ? 1 : 0); return; }
    if (k === 'g') { this.cycleOverlay(); return; }
    if (k === 'f') { this.toggleFichas(); return; }
    if (k === 'r') { this.toggleSummary(); return; }
    if (k === 'h') { this.openHelp(); return; }
    if (k === '2') this.setSpeed(2); else if (k === '3') this.setSpeed(4);
  }

  // ───────────── fichas de barrio ─────────────
  private buildFichas(): void {
    const box = this.els.districts;
    for (const d of this.game.demand.districts.list) {
      const el = document.createElement('div');
      el.className = 'ficha';
      el.style.setProperty('--c', hex(d.color));
      el.innerHTML = `<div class="fname"><i></i>${d.name}</div><div class="fnums">${fmt(d.residents)} hab · ${fmt(d.jobs)} empl</div><div class="fwait hidden"></div>`;
      box.appendChild(el);
      this.fichas.set(d.id, el);
    }
  }

  /** Coloca las fichas sobre el mapa (y el hito bajo la barra superior); se llama cada frame. */
  placeFichas(): void {
    const tb = this.root.querySelector('#topbar') as HTMLElement;
    const top = tb.offsetTop + tb.offsetHeight + 6;
    if (this.goalTop !== top) {
      this.goalTop = top;
      this.els.goal.style.top = top + 'px';
      // en móvil, la pista y los avisos van debajo del hito
      const goalH = this.els.goal.classList.contains('hidden') ? 0 : this.els.goal.offsetHeight + 6;
      this.root.style.setProperty('--hud-top', `${top + goalH}px`);
    }
    if (!this.fichasOn) return;
    const z = this.world.zoom;
    const s = Math.max(0.7, Math.min(1, z * 6));
    const W = this.world.width, H = this.world.height;
    for (const d of this.game.demand.districts.list) {
      const el = this.fichas.get(d.id)!;
      const p = this.world.toScreen(d);
      if (p.x < -80 || p.x > W + 80 || p.y < 0 || p.y > H + 60) { el.style.display = 'none'; continue; }
      el.style.display = '';
      el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) translate(-50%, -100%) scale(${s.toFixed(3)})`;
    }
  }

  private refreshFichas(): void {
    for (const d of this.game.demand.districts.list) {
      const el = this.fichas.get(d.id)!;
      const w = el.querySelector('.fwait')!;
      if (d.unservedToday > 0) { w.classList.remove('hidden'); w.textContent = `${people(d.unservedToday)} sin servicio hoy`; } else w.classList.add('hidden');
    }
  }

  /** Datos que cambian cada frame (se llama unas pocas veces por segundo). */
  refresh(): void {
    const g = this.game;
    this.els.clock.textContent = g.clock;
    this.els.dayLabel.textContent = `día ${g.day}`;
    this.els.delivered.textContent = people(g.today.delivered);
    this.els.total.textContent = people(g.net.stats.delivered);
    this.els.waiting.textContent = people(g.net.waiting);
    this.els.riding.textContent = people(g.net.riding);
    this.els.satis.textContent = g.satisfaction + '%';
    const net = g.netToday;
    this.els.net.textContent = g.country ? (net >= 0 ? '+' : '') + money(net) : signed(net);
    this.els.net.className = net >= 0 ? 'pos' : 'neg';
    const m = g.nextMilestone;
    if (m && !g.creative) {
      const prog = g.milestoneProgress(m);
      this.els.goalText.innerHTML = `<b>Hito:</b> ${m.title} · ${people(Math.min(prog, m.target))} / ${people(m.target)} viajeros ${m.kind === 'daily' ? 'hoy' : 'en total'}`;
      this.els.goalBar.style.width = `${Math.min(100, (100 * prog) / m.target)}%`;
    } else if (!g.creative) { this.els.goalText.innerHTML = '<b>Todos los hitos conseguidos</b>'; this.els.goalBar.style.width = '100%'; }
    if (this.fichasOn) this.refreshFichas();
    if (this.tools.selected && !this.els.panel.classList.contains('hidden')) {
      const l = this.tools.selected;
      const rid = this.els.panel.querySelector('#riding');
      if (rid) rid.textContent = `${people(l.vehicles.reduce((a, v) => a + v.passengers.length, 0))} a bordo · ${people(l.boardedToday)} hoy`;
    }
    if (this.summaryOpen) this.renderSummary(true);
  }

  // ───────────── resumen ─────────────
  toggleSummary(): void {
    this.summaryOpen = !this.summaryOpen;
    this.els.summary.classList.toggle('hidden', !this.summaryOpen);
    (this.root.querySelector('#summaryBtn') as HTMLButtonElement).classList.toggle('active', this.summaryOpen);
    if (this.summaryOpen) this.renderSummary();
  }

  private renderSummary(numbersOnly = false): void {
    const g = this.game;
    const s = g.summary();
    const el = this.els.summary;
    const demandTotal = s.today.delivered + s.today.lost + s.today.unserved + s.today.rejected;
    const pct = (n: number) => (demandTotal ? Math.round((100 * n) / demandTotal) : 0);
    const net = s.netToday;
    if (numbersOnly && el.children.length) {
      // actualiza solo los números para no romper los deslizadores mientras se usan
      const set = (id: string, v: string) => { const n = el.querySelector(`[data-v="${id}"]`); if (n) n.textContent = v; };
      set('delivered', people(s.today.delivered)); set('lost', people(s.today.lost)); set('unserved', people(s.today.unserved)); set('rejected', people(s.today.rejected));
      set('waiting', people(s.waiting)); set('riding', people(s.riding)); set('income', eur(s.incomeToday)); set('net', signed(net));
      set('avgTrip', s.today.avgTrip ? `${Math.round(s.today.avgTrip)} s` : '–');
      const m = el.querySelector('.meter');
      if (m) { const kids = m.children; [s.today.delivered, s.today.lost, s.today.rejected, s.today.unserved].forEach((v, i) => { (kids[i] as HTMLElement).style.width = pct(v) + '%'; }); }
      return;
    }
    const linesRows = s.lines.map(l => `<tr><td><span class="dot" style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${hex(l.line.color)};margin-right:5px"></span>${l.line.name}</td><td>${l.line.vehicles.length}</td><td>${people(l.boarded)}</td><td>${eur(l.income)}</td><td>${eur(l.cost)}</td></tr>`).join('');
    const districts = g.demand.districts.list.slice().sort((a, b) => (b.unservedToday + b.waiting) - (a.unservedToday + a.waiting)).slice(0, 8);
    const districtRows = districts.map(d => `<tr><td><span class="dot" style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${hex(d.color)};margin-right:5px"></span>${d.name}</td><td>${fmt(d.residents)}</td><td>${Math.round(d.coverage * 100)}%</td><td class="${d.unservedToday ? 'neg' : ''}">${people(d.unservedToday)}</td></tr>`).join('');
    const dot = (c: number) => `<span class="dot" style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${hex(c)};margin-right:5px"></span>`;
    const flowRows = g.demand.districts.topFlows(12).map(f => { const lost = f.trips ? Math.round((100 * f.unserved) / f.trips) : 0; return `<tr><td>${dot(f.from.color)}${f.from.name}</td><td>${dot(f.to.color)}${f.to.name}</td><td>${people(f.trips)}</td><td class="${lost >= 50 ? 'neg' : lost >= 20 ? '' : 'pos'}">${lost}%</td></tr>`; }).join('');
    const milestones = g.milestones.map(m => {
      const prog = g.milestoneProgress(m);
      const reward = [m.money ? `+${eur(m.money)}` : '', m.metro ? 'metro' : '', m.lines >= 99 ? 'líneas ilimitadas' : m.lines ? `+${m.lines} línea${m.lines > 1 ? 's' : ''}` : ''].filter(Boolean).join(', ');
      return `<div class="ms ${m.done ? 'done' : ''}"><span class="chk">${m.done ? '✓' : '○'}</span><span class="mt"><b>${m.title}</b><small>${people(m.target)} viajeros ${m.kind === 'daily' ? 'en un día' : 'en total'} · ${reward}</small></span><span class="mp">${m.done ? '' : `${Math.min(100, Math.round((100 * prog) / m.target))}%`}</span></div>`;
    }).join('');
    const finance = g.creative
      ? `<div class="grid"><span>Billetes hoy</span><b data-v="income">${eur(s.incomeToday)}</b><span>Mantenimiento al día</span><b>${eur(s.upkeepDaily)}</b></div><div class="muted" style="font-size:11px;margin-top:2px">Modo creativo: el dinero no se acaba. El objetivo es mover al máximo de viajeros.</div>`
      : `<div class="grid"><span>Billetes hoy</span><b data-v="income">${eur(s.incomeToday)}</b>${s.subsidyDaily ? `<span>Subvención municipal</span><b class="pos">+${eur(s.subsidyDaily)}</b>` : ''}<span>Mantenimiento al día</span><b>−${eur(s.upkeepDaily)}</b>${s.debt ? `<span>Intereses del préstamo</span><b>−${eur(s.interestDaily)}</b>` : ''}<span>Balance previsto del día</span><b data-v="net" class="${net >= 0 ? 'pos' : 'neg'}">${signed(net)}</b></div>
        ${g.def.loans ? `<div class="prow loans"><span>Deuda: <b>${eur(s.debt)}</b></span><button class="btn small" data-loan="borrow" ${s.debt + g.loanStep > g.maxDebt ? 'disabled' : ''}>Pedir ${money(g.loanStep)}</button><button class="btn small" data-loan="repay" ${s.debt <= 0 ? 'disabled' : ''}>Devolver</button></div><div class="muted" style="font-size:11px">0,4 % de interés al día, hasta ${eur(g.maxDebt)}.${g.def.bankruptDays ? ` Cinco días seguidos en negativo y pierdes la concesión.` : ' En modo fácil el ayuntamiento cubre los descubiertos.'}</div>` : ''}`;
    el.innerHTML = `
      <button class="btn small close" id="closeSummary" title="Cerrar (R)">✕</button>
      <h3>Ciudad</h3>
      <div class="grid"><span>Población estimada</span><b>${fmt(s.population)}</b><span>Empleos estimados</span><b>${fmt(s.jobs)}</b><span>Viajes potenciales al día</span><b>${fmt(s.potentialPeople)}</b><span>Vecinos con parada cerca</span><b>${Math.round(s.coverage * 100)}%</b></div>
      <h3>Demanda de hoy</h3>
      <div class="meter"><div style="background:var(--green);width:${pct(s.today.delivered)}%"></div><div style="background:var(--red);width:${pct(s.today.lost)}%"></div><div style="background:#8e5bb5;width:${pct(s.today.rejected)}%"></div><div style="background:var(--border);width:${pct(s.today.unserved)}%"></div></div>
      <div class="legend"><span><i style="background:var(--green)"></i>llegan</span><span><i style="background:var(--red)"></i>se cansan</span><span><i style="background:#8e5bb5"></i>precio</span><span><i style="background:var(--border)"></i>sin parada</span></div>
      <div class="grid" style="margin-top:6px"><span>Llegaron</span><b data-v="delivered">${people(s.today.delivered)}</b><span>Se cansaron de esperar</span><b data-v="lost">${people(s.today.lost)}</b><span>Rechazan el precio</span><b data-v="rejected">${people(s.today.rejected)}</b><span>Sin parada o sin ruta</span><b data-v="unserved">${people(s.today.unserved)}</b><span>Viaje medio</span><b data-v="avgTrip">${s.today.avgTrip ? `${Math.round(s.today.avgTrip)} s` : '–'}</b></div>
      <h3>Barrios con más demanda sin cubrir</h3>
      <table><tr><th>barrio</th><th>hab</th><th>cobertura</th><th>sin servicio</th></tr>${districtRows}</table>
      ${flowRows ? `<h3>Dónde quiere ir la gente</h3><table class="flows"><tr><th>entre</th><th>y</th><th>viajes</th><th>sin servicio</th></tr>${flowRows}</table><div class="muted" style="font-size:11px">Viajes de hoy entre barrios (ida y vuelta juntos, con los de ayer a la mitad).</div>` : ''}
      <h3>Oferta</h3>
      <div class="grid">${g.country ? `<span>Ciudades en la red</span><b>${s.stops.hub ?? 0}</b>` : `<span>Paradas bus / estaciones</span><b>${s.stops.bus} / ${s.stops.metro}</b>`}<span>${g.modes.map(m => vehName(m)).join(' / ')}</span><b>${g.modes.map(m => s.vehicles[m] ?? 0).join(' / ')}</b><span>Plazas en circulación</span><b>${fmt(s.capacity * PEOPLE_PER_PASSENGER)}</b><span>Esperando ahora</span><b data-v="waiting">${people(s.waiting)}</b><span>A bordo ahora</span><b data-v="riding">${people(s.riding)}</b></div>
      <h3>Finanzas · modo ${GAME_MODES[g.mode].name.toLowerCase()}</h3>
      ${finance}
      <h3>Precio del billete</h3>
      ${g.modes.map(m => `<div class="fare"><label>${MODE[m].name}</label><input type="range" min="${g.country ? 5 : 0.5}" max="${g.country ? (m === 'plane' ? 250 : 120) : 4}" step="${g.country ? 1 : 0.1}" value="${g.fares[m]}" data-fare="${m}"><b>${g.fares[m].toFixed(g.country ? 0 : 2)} €</b></div>`).join('')}
      <div class="muted" style="font-size:11px;margin-top:2px">Cuanto más caro el billete, más ${g.country ? 'viajeros' : 'vecinos'} deciden no viajar.</div>
      <h3>Costes</h3>
      <div class="grid">${g.modes.map(m => `<span>${MODE[m].stopName} · ${vehName(m, true)}</span><b>${money(MODE[m].stopCost)} · ${money(MODE[m].vehicleCost)} (+${money(MODE[m].upkeep)}/día)</b>${MODE[m].trackCost ? `<span>${m === 'metro' ? 'Túnel de metro' : 'Vía de tren'}</span><b>${g.country ? `${(MODE[m].trackCost / 1000).toFixed(1)} M€/km` : `${eur(MODE[m].trackCost)}/m`}</b>` : ''}`).join('')}${g.country ? '<span class="muted">Aeropuerto ya existente</span><b>10 % del coste</b>' : ''}</div>
      ${g.creative ? '' : `<h3>Hitos</h3><div class="milestones">${milestones}</div>`}
      ${linesRows ? `<h3>Líneas hoy</h3><table><tr><th>línea</th><th>veh</th><th>viajeros</th><th>billetes</th><th>coste/día</th></tr>${linesRows}</table>` : ''}`;
    (el.querySelector('#closeSummary') as HTMLButtonElement).onclick = () => this.toggleSummary();
    el.querySelectorAll<HTMLInputElement>('input[data-fare]').forEach(inp => {
      inp.oninput = () => { const mode = inp.dataset.fare as Mode; g.setFare(mode, +inp.value); (inp.nextElementSibling as HTMLElement).textContent = g.fares[mode].toFixed(g.country ? 0 : 2) + ' €'; };
    });
    el.querySelectorAll<HTMLButtonElement>('[data-loan]').forEach(b => {
      b.onclick = () => { if (b.dataset.loan === 'borrow') g.borrow(); else g.repay(); this.renderSummary(); };
    });
  }

  // ───────────── panel de líneas ─────────────
  private renderPanel(selected: Line | null = this.tools.selected): void {
    const panel = this.els.panel;
    const lines = [...this.game.net.lines.values()];
    const stop = this.panelStop;
    if (!lines.length && !stop) { panel.classList.add('hidden'); return; }
    panel.classList.remove('hidden');
    let html = '';
    if (stop && this.game.net.stops.has(stop.id)) {
      html += `<div class="ptitle">${stop.name}</div><div class="muted">${MODE[stop.mode].stopName} · ${people(stop.queue.length)} esperando</div>
        <div class="prow"><button class="btn small" data-act="removeStop">Quitar parada</button></div><div class="sep"></div>`;
    }
    const max = this.game.maxLines;
    html += `<div class="ptitle">Líneas${Number.isFinite(max) ? ` <span class="muted small">${lines.length} de ${max}</span>` : ''}</div>`;
    if (!lines.length) html += `<div class="muted">Aún no hay líneas. Pon paradas y traza una con L o K.</div>`;
    for (const l of lines) {
      const sel = l === selected;
      html += `<div class="line ${sel ? 'sel' : ''}" data-line="${l.id}">
        <span class="dot" style="background:${hex(l.color)}"></span>
        <span class="lname">${l.name}</span>
        <span class="muted">${l.stops.length} par · ${l.vehicles.length} veh</span>
      </div>`;
      if (sel) {
        const def = MODE[l.mode];
        const names = l.stops.map(id => this.game.net.stops.get(id)?.name ?? '?').join(' → ') + (l.loop ? ' ↻' : '');
        html += `<div class="ldetail">
          <div class="muted small">${names || 'sin paradas'}</div>
          <div class="muted small" id="riding"></div>
          ${l.warnings ? `<div class="warn small">${l.warnings} tramo(s) ${l.mode === 'ship' ? 'cruzan tierra: arrastra la línea para rodear la costa' : l.mode === 'bus' && this.game.country ? 'sin autopista' : 'a contramano o sin calle'}</div>` : ''}
          <div class="prow">
            <span>Vehículos</span>
            <button class="btn small" data-act="veh-">−</button><b>${l.vehicles.length}</b><button class="btn small" data-act="veh+" title="${money(def.vehicleCost)} + ${money(def.upkeep)}/día">+</button>
            <span class="muted small">${money(def.vehicleCost)}</span>
          </div>
          <div class="prow">
            ${l.loop ? '' : '<button class="btn small" data-act="extend">Ampliar</button>'}
            <button class="btn small" data-act="dropLast">Quitar última</button>
            <button class="btn small" data-act="delete">Borrar</button>
          </div>
          <div class="prow colors">${LINE_COLORS.map(c => `<span class="sw ${c === l.color ? 'on' : ''}" data-color="${c}" style="background:${hex(c)}"></span>`).join('')}</div>
        </div>`;
      }
    }
    panel.innerHTML = html;
    panel.querySelectorAll<HTMLElement>('.line').forEach(el => { el.onclick = () => { const l = this.game.net.lines.get(+el.dataset.line!); this.panelStop = null; this.tools.select(l === this.tools.selected ? null : l ?? null); }; });
    panel.querySelectorAll<HTMLElement>('.sw').forEach(el => { el.onclick = () => { if (selected) { selected.color = +el.dataset.color!; this.tools.select(selected); } }; });
    panel.querySelectorAll<HTMLButtonElement>('[data-act]').forEach(b => {
      b.onclick = () => {
        const act = b.dataset.act!;
        if (act === 'removeStop' && stop) { this.game.removeStop(stop.id); this.panelStop = null; this.tools.select(this.game.net.lines.has(selected?.id ?? -1) ? selected : null); return; }
        if (!selected) return;
        switch (act) {
          case 'veh+': this.game.addVehicle(selected); break;
          case 'veh-': this.game.removeVehicle(selected); break;
          case 'extend': this.tools.extendLine(selected); break;
          case 'dropLast': { const last = selected.stops[selected.stops.length - 1]; if (last !== undefined) this.game.removeStopFromLine(selected, last); if (!this.game.net.lines.has(selected.id)) this.tools.select(null); else this.tools.select(selected); break; }
          case 'delete': this.game.removeLine(selected); this.tools.select(null); break;
        }
      };
    });
    this.refresh();
  }

  private showHover(h: Hover | null): void {
    const info = this.els.info;
    if (!h || !h.text) { info.classList.add('hidden'); return; }
    info.classList.remove('hidden');
    info.innerHTML = `<b>${h.text}</b>${h.sub ? `<div class="muted">${h.sub}</div>` : ''}`;
  }

  toast(text: string, kind: 'info' | 'warn' | 'good' = 'info', ms = 4500): void {
    const t = document.createElement('div');
    t.className = `toast card ${kind}`;
    t.textContent = text;
    t.style.animationDuration = `${ms}ms`;
    this.els.toasts.appendChild(t);
    while (this.els.toasts.children.length > 4) this.els.toasts.firstElementChild!.remove();
    setTimeout(() => t.remove(), ms);
  }

  private dayReport(r: DayReport): void {
    const net = r.income + r.subsidy - r.upkeep - r.interest;
    const extra = [r.subsidy ? `subvención ${eur(r.subsidy)}` : '', r.interest ? `intereses ${eur(r.interest)}` : ''].filter(Boolean).join(', ');
    this.toast(`Día ${r.day}: ${people(r.delivered)} viajeros, ${r.satisfaction}% llegaron, ${people(r.unserved)} sin parada cerca · ${signed(net)} (billetes ${eur(r.income)}, mantenimiento ${eur(r.upkeep)}${extra ? ', ' + extra : ''})`, net >= 0 ? 'good' : 'warn', 7000);
  }

  private milestone(m: Milestone): void {
    const reward = [m.money ? `+${eur(m.money)}` : '', m.metro ? 'metro desbloqueado' : '', m.lines >= 99 ? 'líneas ilimitadas' : m.lines ? `+${m.lines} línea${m.lines > 1 ? 's' : ''}` : ''].filter(Boolean).join(' · ');
    this.toast(`🏆 Hito conseguido: ${m.title} · ${reward}`, 'good', 8000);
    this.updateLocks();
    if (this.summaryOpen) this.renderSummary();
  }

  private gameOver(reason: string): void {
    this.setSpeed(0);
    const m = this.modal(`<h2>Fin de la concesión</h2><p>${reason}</p>
      <p class="muted" style="font-size:13px">Puedes seguir con esta misma red en modo creativo (dinero infinito) o volver al inicio.</p>
      <div class="stack"><button class="btn primary" id="creative">Seguir en modo creativo</button><button class="btn" id="exit">Volver al inicio</button></div>`);
    m.onclick = null;
    (m.querySelector('#creative') as HTMLButtonElement).onclick = () => { m.remove(); this.onMenu('creative'); };
    (m.querySelector('#exit') as HTMLButtonElement).onclick = () => { m.remove(); this.onMenu('exit'); };
  }

  private modal(html: string): HTMLElement {
    document.querySelector('.modal')?.remove();
    const m = document.createElement('div');
    m.className = 'modal';
    m.innerHTML = `<div class="panel card">${html}</div>`;
    m.onclick = e => { if (e.target === m) m.remove(); };
    document.body.appendChild(m);
    return m;
  }

  openMenu(): void {
    const was = this.speed;
    this.setSpeed(0);
    const days = this.game.days.slice(-7).reverse();
    const rows = days.map(d => { const n = d.income + (d.subsidy ?? 0) - d.upkeep - (d.interest ?? 0); return `<tr><td>Día ${d.day}</td><td>${people(d.delivered)}</td><td>${d.satisfaction}%</td><td>${Math.round(d.coverage * 100)}%</td><td class="${n >= 0 ? 'pos' : 'neg'}">${signed(n)}</td></tr>`; }).join('');
    const styles = MAP_STYLES.map(s => `<button class="btn ${s.id === this.style ? 'active' : ''}" data-style="${s.id}">${s.name}<small>${s.desc}</small></button>`).join('');
    const m = this.modal(`<h2>Little Transit <small class="muted" style="font-size:13px;font-weight:600">· modo ${GAME_MODES[this.game.mode].name.toLowerCase()}</small></h2><div class="stack">
      <button class="btn primary" id="resume">Seguir jugando</button>
      <button class="btn" id="save">Guardar partida</button>
      <button class="btn" id="help">Cómo se juega</button>
      <button class="btn" id="exit">Cambiar de ciudad</button></div>
      <h3 style="margin:14px 0 4px;font-size:13px">Estilo del mapa</h3>
      <div class="styles">${styles}</div>
      ${rows ? `<table class="report"><tr><th></th><th>viajeros</th><th>llegan</th><th>cobertura</th><th>balance</th></tr>${rows}</table>` : ''}
      <p class="muted" style="font-size:12px">La partida se guarda sola cada medio minuto en este navegador.</p>`);
    const close = () => { m.remove(); this.setSpeed(was || 1); };
    (m.querySelector('#resume') as HTMLButtonElement).onclick = close;
    (m.querySelector('#save') as HTMLButtonElement).onclick = () => { this.onMenu('save'); close(); };
    (m.querySelector('#help') as HTMLButtonElement).onclick = () => { close(); this.openHelp(); };
    (m.querySelector('#exit') as HTMLButtonElement).onclick = () => { this.onMenu('save'); this.onMenu('exit'); };
    m.querySelectorAll<HTMLButtonElement>('[data-style]').forEach(b => {
      b.onclick = () => { this.style = b.dataset.style as MapStyle; m.querySelectorAll('[data-style]').forEach(x => x.classList.remove('active')); b.classList.add('active'); this.onStyle(this.style); };
    });
  }

  openHelp(): void {
    if (this.game.country) { this.openCountryHelp(); return; }
    const m = this.modal(`<h2>Cómo se juega</h2>
      <p>La ciudad es de verdad. Cada punto que ves esperando representa a ${PEOPLE_PER_PASSENGER} personas; cuántas salen de cada edificio depende de su tamaño y sus plantas. Van de casa al trabajo, las tiendas y los equipamientos, y vuelven por la tarde.</p>
      <ul>
        <li><b>Barrios</b>: cada ficha muestra sus habitantes, empleos y cuántos vecinos se quedaron hoy sin servicio. Los puntos coral que aparecen sobre los edificios son vecinos que querían viajar y no tienen parada cerca: ahí hace falta una. Cada viajero que espera en una parada lleva el <b>color del barrio</b> al que va (pasa el ratón por la parada para verlo).</li>
        <li><b>Paradas</b>: <kbd>B</kbd> pone una parada de bus junto a una calle; <kbd>M</kbd> una estación de metro donde quieras. Cada parada atrae a los vecinos que viven a unos minutos a pie.</li>
        <li><b>Líneas</b>: <kbd>L</kbd> (bus) o <kbd>K</kbd> (metro) y haz clic en las paradas por orden. El bus sigue las calles reales; el metro va en línea recta por túnel. Clic en la primera parada para cerrar un bucle; <kbd>Enter</kbd> para terminar.</li>
        <li>En el panel de la derecha añades <b>vehículos</b> a cada línea, la amplías, cambias su color o la borras. Con una línea seleccionada, <b>arrástrala</b> para llevarla por otra calle sin añadir paradas; sus puntos de paso se mueven arrastrándolos y se quitan con <kbd>D</kbd>.</li>
        <li><kbd>G</kbd> alterna las <b>capas</b>: demanda sin cubrir por zona y población. En el resumen (<kbd>R</kbd>) hay una tabla con los trayectos entre barrios que más gente quiere hacer. <kbd>F</kbd> oculta o muestra las fichas de barrio.</li>
        <li><kbd>R</kbd> abre el <b>resumen</b>: demanda, barrios, oferta, finanzas, préstamos, precio del billete e hitos.</li>
        <li><b>Hitos</b>: empiezas con dos líneas de bus; al alcanzar cierta cantidad de viajeros desbloqueas más líneas, el metro y premios en dinero. En modo creativo todo está disponible desde el principio.</li>
        <li><b>Dinero</b>: cada viaje paga billete; cada vehículo cuesta mantenimiento diario. En modo fácil el ayuntamiento te subvenciona; en normal, cinco días seguidos en negativo y pierdes la concesión (hay préstamos).</li>
        <li><kbd>Espacio</kbd> pausa; <kbd>2</kbd> y <kbd>3</kbd> aceleran. Hay horas punta por la mañana y por la tarde, y la demanda crece un poco cada día.</li>
      </ul>
      <div class="stack"><button class="btn primary" id="ok">¡Entendido!</button></div>`);
    (m.querySelector('#ok') as HTMLButtonElement).onclick = () => m.remove();
  }

  private openCountryHelp(): void {
    const m = this.modal(`<h2>Cómo se juega</h2>
      <p>Toda la península, Baleares, Canarias, Ceuta y Melilla. Cada punto que ves esperando representa a ${PEOPLE_PER_PASSENGER} personas que quieren viajar de una ciudad a otra: cuanto más grandes y cercanas son dos ciudades, más gente quiere moverse entre ellas.</p>
      <ul>
        <li><b>Líneas</b>: elige un modo (<kbd>T</kbd> tren, <kbd>B</kbd> bus, <kbd>P</kbd> avión, <kbd>S</kbd> barco) y haz clic en las ciudades por orden; la ciudad entra en la red con el primer clic. Clic en la primera para cerrar un bucle; <kbd>Enter</kbd> para terminar.</li>
        <li><b>Tren</b>: vía nueva que se paga por kilómetro; rápido y de gran capacidad. <b>Bus</b>: barato y lento, va por las autopistas reales. <b>Avión</b>: solo entre ciudades con aeropuerto (triángulo azul), muy rápido y caro. <b>Barco</b>: solo entre ciudades costeras, sin cruzar tierra; junto con el avión, el único modo que llega a las islas, Ceuta y Melilla.</li>
        <li>Los viajeros hacen <b>transbordo</b> entre modos en la misma ciudad. Con una línea seleccionada, <b>arrástrala</b> para ajustar su trazado (tren, avión y barco); sus puntos de paso se mueven arrastrándolos y se quitan con <kbd>D</kbd>.</li>
        <li><kbd>R</kbd> abre el <b>resumen</b>: demanda, trayectos más pedidos, oferta, finanzas, préstamos, precio del billete e hitos. <kbd>G</kbd> alterna las capas de demanda sin cubrir y población.</li>
        <li><b>Hitos</b>: empiezas con dos líneas (tren y bus); al mover viajeros desbloqueas más líneas, el avión, el barco y premios en dinero. En modo creativo todo está disponible.</li>
        <li><b>Dinero</b> (en millones): cada viaje paga billete; cada vehículo cuesta mantenimiento diario. En fácil hay subvención; en normal, cinco días seguidos en negativo y pierdes la concesión (hay préstamos).</li>
        <li><kbd>Espacio</kbd> pausa; <kbd>2</kbd> y <kbd>3</kbd> aceleran. El recuadro de abajo a la derecha es Canarias: las distancias reales se respetan en los tiempos de viaje.</li>
      </ul>
      <div class="stack"><button class="btn primary" id="ok">¡Entendido!</button></div>`);
    (m.querySelector('#ok') as HTMLButtonElement).onclick = () => m.remove();
  }

  destroy(): void { this.root.remove(); document.querySelector('.modal')?.remove(); }
}
