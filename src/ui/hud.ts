// HUD: barra de estado, herramientas, panel de líneas, mensajes, informe diario, menú y ayuda.
import type { DayReport, Game } from '../sim/game.ts';
import { LINE_COLORS, MODE, type Line, type Stop } from '../sim/transit.ts';
import type { Hover, Tool, Tools } from './tools.ts';

const ICONS: Record<string, string> = {
  pan: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3"/></svg>',
  'stop:bus': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="4" y="4" width="16" height="14" rx="3" fill="#f7e8d2"/><path d="M4 10h16" /><rect x="7" y="7" width="4" height="2" fill="#2a2522"/><rect x="13" y="7" width="4" height="2" fill="#2a2522"/><circle cx="8" cy="19" r="1.6" fill="#2a2522"/><circle cx="16" cy="19" r="1.6" fill="#2a2522"/><path d="M9 13h6" stroke="#e88a82" stroke-width="2.5"/></svg>',
  'stop:metro': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="8" fill="#ffffff"/><path d="M8 16V8l4 5 4-5v8" stroke="#2f6fc4" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  'line:bus': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M4 18c4 0 4-12 8-12s4 12 8 12" stroke="#d23b33" stroke-width="3"/><circle cx="4" cy="18" r="2.5" fill="#f7e8d2"/><circle cx="12" cy="6" r="2.5" fill="#f7e8d2"/><circle cx="20" cy="18" r="2.5" fill="#f7e8d2"/></svg>',
  'line:metro': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M4 18L12 6l8 12" stroke="#2f6fc4" stroke-width="3.5"/><circle cx="4" cy="18" r="2.8" fill="#ffffff"/><circle cx="12" cy="6" r="2.8" fill="#ffffff"/><circle cx="20" cy="18" r="2.8" fill="#ffffff"/></svg>',
  remove: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="7" fill="#f7e8d2"/><path d="M8 8l8 8M16 8l-8 8" stroke="#d23b33"/></svg>',
  heat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="8" fill="#e88a82" opacity=".5"/><circle cx="12" cy="12" r="4" fill="#d23b33"/></svg>',
  menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
  help: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7M12 17h.01"/></svg>',
};

const fmt = (n: number) => Math.round(n).toLocaleString('es-ES');
const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');

export class Hud {
  readonly root = document.createElement('div');
  speed = 1;
  onSpeed: (s: number) => void = () => undefined;
  onMenu: (action: 'save' | 'exit') => void = () => undefined;
  onHeat: (on: boolean) => void = () => undefined;
  private els: Record<string, HTMLElement> = {};
  private toolButtons = new Map<string, HTMLButtonElement>();
  private panelStop: Stop | null = null;

  constructor(private game: Game, private tools: Tools) {
    this.root.id = 'hud';
    this.root.innerHTML = `
      <div id="topbar" class="card">
        <span class="city" id="cityName"></span>
        <div class="stat"><b id="clock"></b><small id="dayLabel">día 1</small></div>
        <div class="stat"><b id="money"></b><small>dinero</small></div>
        <div class="stat"><b id="delivered"></b><small>viajes hoy</small></div>
        <div class="stat"><b id="riding"></b><small>a bordo</small></div>
        <div class="stat"><b id="waiting"></b><small>esperando</small></div>
        <div class="stat"><b id="satis"></b><small>satisfacción</small></div>
        <div id="speed">
          <button class="btn" data-speed="0" title="Pausa (espacio)">⏸</button>
          <button class="btn active" data-speed="1" title="Velocidad normal">▶</button>
          <button class="btn" data-speed="2" title="Rápido (2)">▶▶</button>
          <button class="btn" data-speed="4" title="Muy rápido (3)">▶▶▶</button>
        </div>
      </div>
      <div id="topright">
        <button class="btn tool" id="heatBtn" title="Demanda sin cubrir (G)">${ICONS.heat}</button>
        <button class="btn tool" id="helpBtn" title="Ayuda (H)">${ICONS.help}</button>
        <button class="btn tool" id="menuBtn" title="Menú (Esc)">${ICONS.menu}</button>
      </div>
      <div id="toolbar" class="card"></div>
      <div id="panel" class="card hidden"></div>
      <div id="hint" class="card"></div>
      <div id="info" class="card hidden"></div>
      <div id="toasts"></div>`;
    document.body.appendChild(this.root);
    for (const id of ['cityName', 'clock', 'dayLabel', 'money', 'delivered', 'riding', 'waiting', 'satis', 'hint', 'info', 'toasts', 'panel']) this.els[id] = this.root.querySelector('#' + id)!;
    this.els.cityName.textContent = game.data.name;
    this.buildToolbar();

    this.root.querySelectorAll<HTMLButtonElement>('#speed .btn').forEach(b => { b.onclick = () => this.setSpeed(+b.dataset.speed!); });
    (this.root.querySelector('#menuBtn') as HTMLButtonElement).onclick = () => this.openMenu();
    (this.root.querySelector('#helpBtn') as HTMLButtonElement).onclick = () => this.openHelp();
    const heatBtn = this.root.querySelector('#heatBtn') as HTMLButtonElement;
    heatBtn.onclick = () => { heatBtn.classList.toggle('active'); this.onHeat(heatBtn.classList.contains('active')); };

    game.on('money', m => { this.els.money.textContent = fmt(m) + ' €'; });
    game.on('message', (t, k) => this.toast(t, k));
    game.on('network', () => this.renderPanel());
    game.on('day', r => this.dayReport(r));
    tools.onToolChange = t => this.markTool(t);
    tools.onHint = t => { this.els.hint.textContent = t; };
    tools.onHover = h => this.showHover(h);
    tools.onSelect = (line, stop) => { this.panelStop = stop; this.renderPanel(line); };
    this.els.money.textContent = fmt(game.money) + ' €';
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
    if (k === 'g') { (this.root.querySelector('#heatBtn') as HTMLButtonElement).click(); return; }
    if (k === 'h') { this.openHelp(); return; }
    if (k === '2') this.setSpeed(2); else if (k === '3') this.setSpeed(4);
  }

  /** Datos que cambian cada frame (se llama unas pocas veces por segundo). */
  refresh(): void {
    const g = this.game;
    this.els.clock.textContent = g.clock;
    this.els.dayLabel.textContent = `día ${g.day}`;
    this.els.delivered.textContent = fmt(g.today.delivered);
    this.els.waiting.textContent = fmt(g.net.waiting);
    this.els.riding.textContent = fmt(g.net.riding);
    this.els.satis.textContent = g.satisfaction + '%';
    if (this.tools.selected && !this.els.panel.classList.contains('hidden')) {
      const l = this.tools.selected;
      const rid = this.els.panel.querySelector('#riding');
      if (rid) rid.textContent = `${l.vehicles.reduce((a, v) => a + v.passengers.length, 0)} a bordo · ${fmt(l.boarded)} viajes`;
    }
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
      html += `<div class="ptitle">${stop.name}</div><div class="muted">${MODE[stop.mode].stopName} · ${stop.queue.length} esperando</div>
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
          ${l.warnings ? `<div class="warn small">${l.warnings} tramo(s) sin ruta por calles</div>` : ''}
          <div class="prow">
            <span>Vehículos</span>
            <button class="btn small" data-act="veh-">−</button><b>${l.vehicles.length}</b><button class="btn small" data-act="veh+" title="${fmt(def.vehicleCost)} € + ${fmt(def.upkeep)} €/día">+</button>
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
    this.toast(`Día ${r.day}: ${fmt(r.delivered)} viajes, ${r.satisfaction}% satisfechos · ${net >= 0 ? '+' : ''}${fmt(net)} € (billetes ${fmt(r.income)}, mantenimiento ${fmt(r.upkeep)})`, net >= 0 ? 'good' : 'warn');
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
    const rows = days.map(d => `<tr><td>Día ${d.day}</td><td>${fmt(d.delivered)}</td><td>${d.satisfaction}%</td><td>${fmt(d.income - d.upkeep)} €</td></tr>`).join('');
    const m = this.modal(`<h2>Little Transit</h2><div class="stack">
      <button class="btn primary" id="resume">Seguir jugando</button>
      <button class="btn" id="save">Guardar partida</button>
      <button class="btn" id="help">Cómo se juega</button>
      <button class="btn" id="exit">Cambiar de ciudad</button></div>
      ${rows ? `<table class="report"><tr><th></th><th>viajes</th><th>satisf.</th><th>balance</th></tr>${rows}</table>` : ''}
      <p class="muted" style="font-size:12px;opacity:.7">La partida se guarda sola cada medio minuto en este navegador.</p>`);
    const close = () => { m.remove(); this.setSpeed(was || 1); };
    (m.querySelector('#resume') as HTMLButtonElement).onclick = close;
    (m.querySelector('#save') as HTMLButtonElement).onclick = () => { this.onMenu('save'); close(); };
    (m.querySelector('#help') as HTMLButtonElement).onclick = () => { close(); this.openHelp(); };
    (m.querySelector('#exit') as HTMLButtonElement).onclick = () => { this.onMenu('save'); this.onMenu('exit'); };
  }

  openHelp(): void {
    const m = this.modal(`<h2>Cómo se juega</h2>
      <p>La ciudad es de verdad. Sus vecinos quieren ir de casa (edificios crema) al trabajo, las tiendas y los equipamientos (azules, oliva y coral), y vuelven por la tarde. Tu trabajo es moverlos.</p>
      <ul>
        <li><b>Paradas</b>: <kbd>B</kbd> pone una parada de bus junto a una calle; <kbd>M</kbd> una estación de metro donde quieras. Cada parada atrae a los vecinos que viven a unos minutos a pie.</li>
        <li><b>Líneas</b>: <kbd>L</kbd> (bus) o <kbd>K</kbd> (metro) y haz clic en las paradas por orden. El bus sigue las calles reales; el metro va en línea recta por túnel. Clic en la primera parada para cerrar un bucle; <kbd>Enter</kbd> para terminar.</li>
        <li>En el panel de la derecha añades <b>vehículos</b> a cada línea, la amplías, cambias su color o la borras.</li>
        <li>Los viajeros esperan en las paradas (puntitos) y hacen <b>transbordo</b> si hace falta. Si esperan demasiado se van, y si no tienen parada cerca aparecen como puntos coral: pulsa <kbd>G</kbd> para ver dónde falta servicio.</li>
        <li>Cada viaje completado paga billete; cada vehículo cuesta mantenimiento diario. Al final del día recibes el informe.</li>
        <li><kbd>Espacio</kbd> pausa; <kbd>2</kbd> y <kbd>3</kbd> aceleran. Hay horas punta por la mañana y por la tarde, y la demanda crece un poco cada día.</li>
      </ul>
      <div class="stack"><button class="btn primary" id="ok">¡Entendido!</button></div>`);
    (m.querySelector('#ok') as HTMLButtonElement).onclick = () => m.remove();
  }

  destroy(): void { this.root.remove(); document.querySelector('.modal')?.remove(); }
}
