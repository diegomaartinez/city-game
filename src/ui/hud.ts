// HUD: barra de estado, herramientas, panel de líneas, resumen (demanda, oferta, finanzas, precios),
// mensajes, informe diario, menú (con estilo de mapa) y ayuda.
import type { DayReport, Game } from '../sim/game.ts';
import { LINE_COLORS, MODE, PEOPLE_PER_PASSENGER, type Line, type Mode, type Stop } from '../sim/transit.ts';
import { MAP_STYLES, type MapStyle } from '../render/palette.ts';
import type { Hover, Tool, Tools } from './tools.ts';

const ICONS: Record<string, string> = {
  pan: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3"/></svg>',
  'stop:bus': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="4" y="4" width="16" height="14" rx="3" fill="#f4f1ea"/><path d="M4 10h16" /><rect x="7" y="7" width="4" height="2" fill="currentColor"/><rect x="13" y="7" width="4" height="2" fill="currentColor"/><circle cx="8" cy="19" r="1.6" fill="currentColor"/><circle cx="16" cy="19" r="1.6" fill="currentColor"/><path d="M9 13h6" stroke="#d23b33" stroke-width="2.5"/></svg>',
  'stop:metro': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="8" fill="#ffffff"/><path d="M8 16V8l4 5 4-5v8" stroke="#2f6fc4" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  'line:bus': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M4 18c4 0 4-12 8-12s4 12 8 12" stroke="#d23b33" stroke-width="3"/><circle cx="4" cy="18" r="2.5" fill="#fff"/><circle cx="12" cy="6" r="2.5" fill="#fff"/><circle cx="20" cy="18" r="2.5" fill="#fff"/></svg>',
  'line:metro': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M4 18L12 6l8 12" stroke="#2f6fc4" stroke-width="3.5"/><circle cx="4" cy="18" r="2.8" fill="#ffffff"/><circle cx="12" cy="6" r="2.8" fill="#ffffff"/><circle cx="20" cy="18" r="2.8" fill="#ffffff"/></svg>',
  remove: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="7" fill="#fff"/><path d="M8 8l8 8M16 8l-8 8" stroke="#d23b33"/></svg>',
  overlay: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="8" fill="#e88a82" opacity=".5"/><circle cx="12" cy="12" r="4" fill="#d23b33"/></svg>',
  summary: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M4 20V10M10 20V4M16 20v-8M22 20H2"/></svg>',
  menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
  help: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7M12 17h.01"/></svg>',
};

const fmt = (n: number) => Math.round(n).toLocaleString('es-ES');
const eur = (n: number) => fmt(n) + ' €';
const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');
const people = (dots: number) => fmt(dots * PEOPLE_PER_PASSENGER);

export class Hud {
  readonly root = document.createElement('div');
  speed = 1;
  onSpeed: (s: number) => void = () => undefined;
  onMenu: (action: 'save' | 'exit') => void = () => undefined;
  onOverlay: (mode: 'none' | 'demand' | 'population') => void = () => undefined;
  onStyle: (style: MapStyle) => void = () => undefined;
  style: MapStyle = 'plano';
  private overlay: 'none' | 'demand' | 'population' = 'none';
  private els: Record<string, HTMLElement> = {};
  private toolButtons = new Map<string, HTMLButtonElement>();
  private panelStop: Stop | null = null;
  private summaryOpen = false;

  constructor(private game: Game, private tools: Tools) {
    this.root.id = 'hud';
    this.root.innerHTML = `
      <div id="topbar" class="card">
        <span class="city" id="cityName"></span>
        <div class="stat"><b id="clock"></b><small id="dayLabel">día 1</small></div>
        <div class="stat"><b id="money"></b><small>dinero</small></div>
        <div class="stat"><b id="delivered"></b><small>viajeros hoy</small></div>
        <div class="stat"><b id="riding"></b><small>a bordo</small></div>
        <div class="stat"><b id="waiting"></b><small>esperando</small></div>
        <div class="stat"><b id="satis"></b><small>llegan</small></div>
        <div id="speed">
          <button class="btn" data-speed="0" title="Pausa (espacio)">⏸</button>
          <button class="btn active" data-speed="1" title="Velocidad normal">▶</button>
          <button class="btn" data-speed="2" title="Rápido (2)">▶▶</button>
          <button class="btn" data-speed="4" title="Muy rápido (3)">▶▶▶</button>
        </div>
      </div>
      <div id="topright">
        <button class="btn tool" id="summaryBtn" title="Resumen (R)">${ICONS.summary}</button>
        <button class="btn tool" id="overlayBtn" title="Capas: demanda sin cubrir / población (G)">${ICONS.overlay}</button>
        <button class="btn tool" id="helpBtn" title="Ayuda (H)">${ICONS.help}</button>
        <button class="btn tool" id="menuBtn" title="Menú (Esc)">${ICONS.menu}</button>
      </div>
      <div id="toolbar" class="card"></div>
      <div id="panel" class="card hidden"></div>
      <div id="summary" class="card hidden"></div>
      <div id="hint" class="card"></div>
      <div id="info" class="card hidden"></div>
      <div id="toasts"></div>`;
    document.body.appendChild(this.root);
    for (const id of ['cityName', 'clock', 'dayLabel', 'money', 'delivered', 'riding', 'waiting', 'satis', 'hint', 'info', 'toasts', 'panel', 'summary']) this.els[id] = this.root.querySelector('#' + id)!;
    this.els.cityName.textContent = game.data.name;
    this.buildToolbar();

    this.root.querySelectorAll<HTMLButtonElement>('#speed .btn').forEach(b => { b.onclick = () => this.setSpeed(+b.dataset.speed!); });
    (this.root.querySelector('#menuBtn') as HTMLButtonElement).onclick = () => this.openMenu();
    (this.root.querySelector('#helpBtn') as HTMLButtonElement).onclick = () => this.openHelp();
    (this.root.querySelector('#summaryBtn') as HTMLButtonElement).onclick = () => this.toggleSummary();
    (this.root.querySelector('#overlayBtn') as HTMLButtonElement).onclick = () => this.cycleOverlay();

    game.on('money', m => { this.els.money.textContent = eur(m); });
    game.on('message', (t, k) => this.toast(t, k));
    game.on('network', () => { this.renderPanel(); if (this.summaryOpen) this.renderSummary(); });
    game.on('day', r => this.dayReport(r));
    tools.onToolChange = t => this.markTool(t);
    tools.onHint = t => { this.els.hint.textContent = t; };
    tools.onHover = h => this.showHover(h);
    tools.onSelect = (line, stop) => { this.panelStop = stop; this.renderPanel(line); };
    this.els.money.textContent = eur(game.money);
    this.markTool('pan');
    this.els.hint.textContent = tools.hintFor('pan');
    this.refresh();
    window.addEventListener('keydown', e => this.key(e));
  }

  private buildToolbar(): void {
    const bar = this.root.querySelector('#toolbar')!;
    const items: Array<[string, string, string] | 'sep'> = [
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
      b.innerHTML = `${ICONS[id]}<span class="key">${key}</span>`;
      b.onclick = () => this.pick(id);
      bar.appendChild(b);
      this.toolButtons.set(id, b);
    }
  }

  pick(id: string): void {
    if (id === 'line:bus') this.tools.startLine('bus');
    else if (id === 'line:metro') this.tools.startLine('metro');
    else this.tools.setTool(id as Tool);
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
    this.overlay = this.overlay === 'none' ? 'demand' : this.overlay === 'demand' ? 'population' : 'none';
    const b = this.root.querySelector('#overlayBtn') as HTMLButtonElement;
    b.classList.toggle('active', this.overlay !== 'none');
    this.onOverlay(this.overlay);
    if (this.overlay === 'demand') this.toast('Capa: demanda sin cubrir (rojo = vecinos sin parada cerca)', 'info');
    else if (this.overlay === 'population') this.toast('Capa: población estimada por edificio', 'info');
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
    const map: Record<string, string> = { '1': 'pan', b: 'stop:bus', m: 'stop:metro', l: 'line:bus', k: 'line:metro', d: 'remove' };
    if (map[k]) { this.pick(map[k]); return; }
    if (k === ' ') { e.preventDefault(); this.setSpeed(this.speed === 0 ? 1 : 0); return; }
    if (k === 'g') { this.cycleOverlay(); return; }
    if (k === 'r') { this.toggleSummary(); return; }
    if (k === 'h') { this.openHelp(); return; }
    if (k === '2') this.setSpeed(2); else if (k === '3') this.setSpeed(4);
  }

  /** Datos que cambian cada frame (se llama unas pocas veces por segundo). */
  refresh(): void {
    const g = this.game;
    this.els.clock.textContent = g.clock;
    this.els.dayLabel.textContent = `día ${g.day}`;
    this.els.delivered.textContent = people(g.today.delivered);
    this.els.waiting.textContent = people(g.net.waiting);
    this.els.riding.textContent = people(g.net.riding);
    this.els.satis.textContent = g.satisfaction + '%';
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
    const s = this.game.summary();
    const el = this.els.summary;
    const demandTotal = s.today.delivered + s.today.lost + s.today.unserved + s.today.rejected;
    const pct = (n: number) => (demandTotal ? Math.round((100 * n) / demandTotal) : 0);
    const net = s.incomeToday - s.upkeepDaily;
    if (numbersOnly && el.children.length) {
      // actualiza solo los números para no romper los deslizadores mientras se usan
      const set = (id: string, v: string) => { const n = el.querySelector(`[data-v="${id}"]`); if (n) n.textContent = v; };
      set('delivered', people(s.today.delivered)); set('lost', people(s.today.lost)); set('unserved', people(s.today.unserved)); set('rejected', people(s.today.rejected));
      set('waiting', people(s.waiting)); set('riding', people(s.riding)); set('income', eur(s.incomeToday)); set('net', (net >= 0 ? '+' : '') + eur(net));
      set('avgTrip', s.today.avgTrip ? `${Math.round(s.today.avgTrip)} s` : '–');
      const m = el.querySelector('.meter');
      if (m) { const kids = m.children; [s.today.delivered, s.today.lost, s.today.rejected, s.today.unserved].forEach((v, i) => { (kids[i] as HTMLElement).style.width = pct(v) + '%'; }); }
      return;
    }
    const linesRows = s.lines.map(l => `<tr><td><span class="dot" style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${hex(l.line.color)};margin-right:5px"></span>${l.line.name}</td><td>${l.line.vehicles.length}</td><td>${people(l.boarded)}</td><td>${eur(l.income)}</td><td>${eur(l.cost)}</td></tr>`).join('');
    el.innerHTML = `
      <h3>Ciudad</h3>
      <div class="grid"><span>Población estimada</span><b>${fmt(s.population)}</b><span>Empleos estimados</span><b>${fmt(s.jobs)}</b><span>Viajes potenciales al día</span><b>${fmt(s.potentialPeople)}</b><span>Vecinos con parada cerca</span><b>${Math.round(s.coverage * 100)}%</b></div>
      <h3>Demanda de hoy</h3>
      <div class="meter"><div style="background:var(--green);width:${pct(s.today.delivered)}%"></div><div style="background:var(--red);width:${pct(s.today.lost)}%"></div><div style="background:#8e5bb5;width:${pct(s.today.rejected)}%"></div><div style="background:var(--border);width:${pct(s.today.unserved)}%"></div></div>
      <div class="legend"><span><i style="background:var(--green)"></i>llegan</span><span><i style="background:var(--red)"></i>se cansan</span><span><i style="background:#8e5bb5"></i>precio</span><span><i style="background:var(--border)"></i>sin parada</span></div>
      <div class="grid" style="margin-top:6px"><span>Llegaron</span><b data-v="delivered">${people(s.today.delivered)}</b><span>Se cansaron de esperar</span><b data-v="lost">${people(s.today.lost)}</b><span>Rechazan el precio</span><b data-v="rejected">${people(s.today.rejected)}</b><span>Sin parada o sin ruta</span><b data-v="unserved">${people(s.today.unserved)}</b><span>Viaje medio</span><b data-v="avgTrip">${s.today.avgTrip ? `${Math.round(s.today.avgTrip)} s` : '–'}</b></div>
      <h3>Oferta</h3>
      <div class="grid"><span>Paradas bus / estaciones</span><b>${s.stops.bus} / ${s.stops.metro}</b><span>Buses / trenes</span><b>${s.vehicles.bus} / ${s.vehicles.metro}</b><span>Plazas en circulación</span><b>${fmt(s.capacity * PEOPLE_PER_PASSENGER)}</b><span>Esperando ahora</span><b data-v="waiting">${people(s.waiting)}</b><span>A bordo ahora</span><b data-v="riding">${people(s.riding)}</b></div>
      <h3>Finanzas</h3>
      <div class="grid"><span>Billetes hoy</span><b data-v="income">${eur(s.incomeToday)}</b><span>Mantenimiento al día</span><b>${eur(s.upkeepDaily)}</b><span>Balance del día</span><b data-v="net" class="${net >= 0 ? 'pos' : 'neg'}">${(net >= 0 ? '+' : '') + eur(net)}</b></div>
      <div class="fare"><label>Bus</label><input type="range" min="0.5" max="4" step="0.1" value="${this.game.fares.bus}" data-fare="bus"><b>${this.game.fares.bus.toFixed(2)} €</b></div>
      <div class="fare"><label>Metro</label><input type="range" min="0.5" max="4" step="0.1" value="${this.game.fares.metro}" data-fare="metro"><b>${this.game.fares.metro.toFixed(2)} €</b></div>
      <div class="muted" style="font-size:11px;margin-top:2px">Cuanto más caro el billete, más vecinos deciden no viajar.</div>
      <h3>Costes</h3>
      <div class="grid"><span>Parada de bus · bus</span><b>${eur(MODE.bus.stopCost)} · ${eur(MODE.bus.vehicleCost)} (+${eur(MODE.bus.upkeep)}/día)</b><span>Estación · tren</span><b>${eur(MODE.metro.stopCost)} · ${eur(MODE.metro.vehicleCost)} (+${eur(MODE.metro.upkeep)}/día)</b><span>Túnel de metro</span><b>${eur(MODE.metro.trackCost)}/m</b></div>
      ${linesRows ? `<h3>Líneas hoy</h3><table><tr><th>línea</th><th>veh</th><th>viajeros</th><th>billetes</th><th>coste/día</th></tr>${linesRows}</table>` : ''}`;
    el.querySelectorAll<HTMLInputElement>('input[data-fare]').forEach(inp => {
      inp.oninput = () => { const mode = inp.dataset.fare as Mode; this.game.setFare(mode, +inp.value); (inp.nextElementSibling as HTMLElement).textContent = this.game.fares[mode].toFixed(2) + ' €'; };
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
    html += `<div class="ptitle">Líneas</div>`;
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
          ${l.warnings ? `<div class="warn small">${l.warnings} tramo(s) a contramano o sin calle</div>` : ''}
          <div class="prow">
            <span>Vehículos</span>
            <button class="btn small" data-act="veh-">−</button><b>${l.vehicles.length}</b><button class="btn small" data-act="veh+" title="${eur(def.vehicleCost)} + ${eur(def.upkeep)}/día">+</button>
            <span class="muted small">${eur(def.vehicleCost)}</span>
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

  toast(text: string, kind: 'info' | 'warn' | 'good' = 'info'): void {
    const t = document.createElement('div');
    t.className = `toast card ${kind}`;
    t.textContent = text;
    this.els.toasts.appendChild(t);
    while (this.els.toasts.children.length > 4) this.els.toasts.firstElementChild!.remove();
    setTimeout(() => t.remove(), 4500);
  }

  private dayReport(r: DayReport): void {
    const net = r.income - r.upkeep;
    this.toast(`Día ${r.day}: ${people(r.delivered)} viajeros, ${r.satisfaction}% llegaron, ${people(r.unserved)} sin parada cerca · ${net >= 0 ? '+' : ''}${eur(net)} (billetes ${eur(r.income)}, mantenimiento ${eur(r.upkeep)})`, net >= 0 ? 'good' : 'warn');
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
    const rows = days.map(d => `<tr><td>Día ${d.day}</td><td>${people(d.delivered)}</td><td>${d.satisfaction}%</td><td>${Math.round(d.coverage * 100)}%</td><td class="${d.income - d.upkeep >= 0 ? 'pos' : 'neg'}">${eur(d.income - d.upkeep)}</td></tr>`).join('');
    const styles = MAP_STYLES.map(s => `<button class="btn ${s.id === this.style ? 'active' : ''}" data-style="${s.id}">${s.name}<small>${s.desc}</small></button>`).join('');
    const m = this.modal(`<h2>Little Transit</h2><div class="stack">
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
    const m = this.modal(`<h2>Cómo se juega</h2>
      <p>La ciudad es de verdad. Cada punto que ves esperando representa a ${PEOPLE_PER_PASSENGER} personas; cuántas salen de cada edificio depende de su tamaño y sus plantas. Van de casa al trabajo, las tiendas y los equipamientos, y vuelven por la tarde.</p>
      <ul>
        <li><b>Paradas</b>: <kbd>B</kbd> pone una parada de bus junto a una calle; <kbd>M</kbd> una estación de metro donde quieras. Cada parada atrae a los vecinos que viven a unos minutos a pie.</li>
        <li><b>Líneas</b>: <kbd>L</kbd> (bus) o <kbd>K</kbd> (metro) y haz clic en las paradas por orden. El bus sigue las calles reales; el metro va en línea recta por túnel. Clic en la primera parada para cerrar un bucle; <kbd>Enter</kbd> para terminar.</li>
        <li>En el panel de la derecha añades <b>vehículos</b> a cada línea, la amplías, cambias su color o la borras.</li>
        <li><kbd>R</kbd> abre el <b>resumen</b>: demanda, oferta, finanzas y el precio del billete de cada modo. <kbd>G</kbd> alterna las capas de demanda sin cubrir y de población.</li>
        <li>Los viajeros hacen <b>transbordo</b> si hace falta y se van si esperan demasiado. Los puntos de colores sobre los edificios son viajes que no pudiste atender (coral: sin parada; amarillo: sin ruta; morado: precio).</li>
        <li>Cada viaje completado paga billete; cada vehículo cuesta mantenimiento diario. Al final del día recibes el informe.</li>
        <li><kbd>Espacio</kbd> pausa; <kbd>2</kbd> y <kbd>3</kbd> aceleran. Hay horas punta por la mañana y por la tarde, y la demanda crece un poco cada día.</li>
      </ul>
      <div class="stack"><button class="btn primary" id="ok">¡Entendido!</button></div>`);
    (m.querySelector('#ok') as HTMLButtonElement).onclick = () => m.remove();
  }

  destroy(): void { this.root.remove(); document.querySelector('.modal')?.remove(); }
}
