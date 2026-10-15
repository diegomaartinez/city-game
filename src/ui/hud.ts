// HUD: barra de estado, barra de herramientas, demanda, mensajes, menú y ayuda.
import type { ServiceKind } from '../data/types.ts';
import type { City, Stats } from '../sim/city.ts';
import { SERVICE_DEF } from '../sim/defs.ts';
import type { Hover, Tool, Tools } from './tools.ts';

const ICONS: Record<string, string> = {
  pan: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3"/></svg>',
  zoneR: '<svg viewBox="0 0 24 24" fill="#7fc47c" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M4 11l8-7 8 7v9H4z"/><path d="M10 20v-6h4v6" fill="#f7e8d2"/></svg>',
  zoneC: '<svg viewBox="0 0 24 24" fill="#5a9be8" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 8h3v3H8zM13 8h3v3h-3zM8 13h3v3H8zM13 13h3v3h-3z" fill="#f7e8d2"/></svg>',
  zoneI: '<svg viewBox="0 0 24 24" fill="#e8b23c" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M3 20V9l6 4V9l6 4V9l6 4v7z"/><rect x="4" y="3" width="3" height="7" fill="#3b3b40"/></svg>',
  dezone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><rect x="4" y="4" width="16" height="16" rx="2" stroke-dasharray="3 3"/><path d="M8 8l8 8M16 8l-8 8" stroke="#d23b33"/></svg>',
  road: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 21L10 3M18 21L14 3" /><path d="M12 6v3M12 12v3M12 18v3" stroke="#e88a82"/></svg>',
  bulldoze: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h16M6 20V9h8v11M14 13h5v7" fill="#f3d6af"/><path d="M8 20v-4" /><path d="M16 4l4 4M20 4l-4 4" stroke="#d23b33"/></svg>',
  services: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l2.5 5 5.5.8-4 3.9.9 5.5L12 15.6 7.1 18.2l.9-5.5-4-3.9L9.5 8z" fill="#f0bf3c"/></svg>',
  traffic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="9" width="18" height="8" rx="3" fill="#e88a82"/><circle cx="7" cy="18" r="2" fill="#3b3b40"/><circle cx="17" cy="18" r="2" fill="#3b3b40"/><path d="M6 9l2-4h8l2 4"/></svg>',
  menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
  help: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7M12 17h.01"/></svg>',
};

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

const fmt = (n: number) => Math.round(n).toLocaleString('es-ES');

export class Hud {
  readonly root = document.createElement('div');
  speed = 1;
  onSpeed: (s: number) => void = () => undefined;
  onMenu: (action: 'save' | 'exit') => void = () => undefined;
  onTraffic: (on: boolean) => void = () => undefined;
  private els: Record<string, HTMLElement> = {};
  private toolButtons = new Map<string, HTMLButtonElement>();
  private submenu!: HTMLElement;
  private roadmenu!: HTMLElement;

  constructor(private city: City, private tools: Tools) {
    this.root.id = 'hud';
    this.root.innerHTML = `
      <div id="topbar" class="card">
        <span class="city" id="cityName"></span>
        <div class="stat"><b id="date"></b><small>fecha</small></div>
        <div class="stat"><b id="money"></b><small>dinero</small></div>
        <div class="stat"><b id="pop"></b><small>habitantes</small></div>
        <div class="stat"><b id="jobs"></b><small>empleos</small></div>
        <div class="stat"><b id="happy"></b><small>felicidad</small></div>
        <div id="speed">
          <button class="btn" data-speed="0" title="Pausa (espacio)">⏸</button>
          <button class="btn active" data-speed="1" title="Velocidad normal">▶</button>
          <button class="btn" data-speed="2" title="Rápido">▶▶</button>
          <button class="btn" data-speed="4" title="Muy rápido">▶▶▶</button>
        </div>
      </div>
      <div id="topright">
        <button class="btn tool" id="trafficBtn" title="Ver tráfico (G)">${ICONS.traffic}</button>
        <button class="btn tool" id="helpBtn" title="Ayuda (H)">${ICONS.help}</button>
        <button class="btn tool" id="menuBtn" title="Menú (Esc)">${ICONS.menu}</button>
      </div>
      <div id="toolbar" class="card"></div>
      <div id="submenu" class="card hidden"></div>
      <div id="roadmenu" class="card hidden"></div>
      <div id="hint" class="card"></div>
      <div id="info" class="card hidden"></div>
      <div id="demand" class="card" title="Demanda de zonas: residencial, comercial e industrial">
        <div class="d"><div class="track r"><div></div></div>R</div>
        <div class="d"><div class="track c"><div></div></div>C</div>
        <div class="d"><div class="track i"><div></div></div>I</div>
      </div>
      <div id="toasts"></div>`;
    document.body.appendChild(this.root);
    for (const id of ['cityName', 'date', 'money', 'pop', 'jobs', 'happy', 'hint', 'info', 'toasts', 'demand']) this.els[id] = this.root.querySelector('#' + id)!;
    this.els.cityName.textContent = city.data.name;
    this.submenu = this.root.querySelector('#submenu')!;
    this.roadmenu = this.root.querySelector('#roadmenu')!;
    this.buildToolbar();
    this.buildSubmenus();

    this.root.querySelectorAll<HTMLButtonElement>('#speed .btn').forEach(b => {
      b.onclick = () => this.setSpeed(+b.dataset.speed!);
    });
    (this.root.querySelector('#menuBtn') as HTMLButtonElement).onclick = () => this.openMenu();
    (this.root.querySelector('#helpBtn') as HTMLButtonElement).onclick = () => this.openHelp();
    const trafficBtn = this.root.querySelector('#trafficBtn') as HTMLButtonElement;
    trafficBtn.onclick = () => { trafficBtn.classList.toggle('active'); this.onTraffic(trafficBtn.classList.contains('active')); };

    city.on('stats', s => this.updateStats(s));
    city.on('money', m => { this.els.money.textContent = fmt(m) + ' €'; });
    city.on('message', (t, k) => this.toast(t, k));
    tools.onToolChange = t => this.markTool(t);
    tools.onHint = t => { this.els.hint.textContent = t; };
    tools.onHover = h => this.showHover(h);
    this.updateStats(city.stats);
    this.els.money.textContent = fmt(city.money) + ' €';
    this.updateDate();
    this.markTool('pan');
    this.els.hint.textContent = tools.hintFor('pan');

    window.addEventListener('keydown', e => this.key(e));
  }

  private buildToolbar(): void {
    const bar = this.root.querySelector('#toolbar')!;
    const items: Array<[string, string, string] | 'sep'> = [
      ['pan', 'Mover y ver', '1'], 'sep',
      ['zoneR', 'Zona residencial', 'R'], ['zoneC', 'Zona comercial', 'C'], ['zoneI', 'Zona industrial', 'I'], ['dezone', 'Quitar zona', 'X'], 'sep',
      ['road', 'Trazar calle', 'T'], ['bulldoze', 'Demoler', 'D'], 'sep',
      ['services', 'Servicios', 'S'],
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

  private buildSubmenus(): void {
    const kinds: ServiceKind[] = ['power', 'water', 'police', 'fire', 'health', 'school', 'park'];
    for (const k of kinds) {
      const d = SERVICE_DEF[k];
      const b = document.createElement('button');
      b.className = 'btn';
      b.innerHTML = `<span><span style="display:inline-block;width:10px;height:10px;border:1.5px solid var(--ink);border-radius:3px;background:${d.color};margin-right:6px"></span>${d.name}</span><small>${fmt(d.cost)} €</small>`;
      b.onclick = () => { this.tools.setTool(`service:${k}`); this.markSub(b); };
      this.submenu.appendChild(b);
    }
    const roads: Array<[string, string]> = [['residential', 'Calle · 60 €/m'], ['secondary', 'Avenida · 120 €/m'], ['primary', 'Vía principal · 200 €/m']];
    for (const [cls, label] of roads) {
      const b = document.createElement('button');
      b.className = 'btn' + (cls === 'residential' ? ' active' : '');
      b.textContent = label;
      b.onclick = () => { this.tools.roadClass = cls as never; this.roadmenu.querySelectorAll('.btn').forEach(x => x.classList.remove('active')); b.classList.add('active'); this.tools.setTool('road'); };
      this.roadmenu.appendChild(b);
    }
  }

  private markSub(b: HTMLButtonElement): void {
    this.submenu.querySelectorAll('.btn').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
  }

  pick(id: string): void {
    if (id === 'services') {
      const open = this.submenu.classList.toggle('hidden');
      this.roadmenu.classList.add('hidden');
      if (!open) this.tools.setTool(this.tools.tool.startsWith('service:') ? this.tools.tool : 'service:power');
      return;
    }
    this.submenu.classList.add('hidden');
    if (id === 'road') this.roadmenu.classList.toggle('hidden'); else this.roadmenu.classList.add('hidden');
    this.tools.setTool(id as Tool);
  }

  private markTool(t: Tool): void {
    for (const [id, b] of this.toolButtons) b.classList.toggle('active', id === t || (id === 'services' && t.startsWith('service:')));
    if (!t.startsWith('service:')) this.submenu.classList.add('hidden');
    if (t !== 'road') this.roadmenu.classList.add('hidden');
  }

  setSpeed(s: number): void {
    this.speed = s;
    this.root.querySelectorAll<HTMLButtonElement>('#speed .btn').forEach(b => b.classList.toggle('active', +b.dataset.speed! === s));
    this.onSpeed(s);
  }

  private key(e: KeyboardEvent): void {
    if ((e.target as HTMLElement).tagName === 'INPUT') return;
    const k = e.key.toLowerCase();
    if (k === 'escape') { if (document.querySelector('.modal')) { document.querySelector('.modal')?.remove(); return; } if (this.tools.tool !== 'pan') this.tools.cancel(); else this.openMenu(); return; }
    const map: Record<string, string> = { '1': 'pan', r: 'zoneR', c: 'zoneC', i: 'zoneI', x: 'dezone', t: 'road', d: 'bulldoze', s: 'services' };
    if (map[k]) { this.pick(map[k]); return; }
    if (k === ' ') { e.preventDefault(); this.setSpeed(this.speed === 0 ? 1 : 0); return; }
    if (k === 'g') { (this.root.querySelector('#trafficBtn') as HTMLButtonElement).click(); return; }
    if (k === 'h') { this.openHelp(); return; }
    if (k === '2') this.setSpeed(2); else if (k === '3') this.setSpeed(4);
  }

  updateDate(): void {
    const d = Math.floor(this.city.day);
    const day = (d % 30) + 1, month = Math.floor(d / 30) % 12, year = Math.floor(d / 360) + 1;
    this.els.date.textContent = `${day} ${MONTHS[month].slice(0, 3)} · año ${year}`;
  }

  private updateStats(s: Stats): void {
    this.els.pop.textContent = fmt(s.population);
    this.els.jobs.textContent = fmt(s.jobs);
    this.els.happy.textContent = Math.round(s.happiness) + '%';
    const tracks = this.els.demand.querySelectorAll<HTMLElement>('.track');
    const vals = [s.demand.R, s.demand.C, s.demand.I];
    tracks.forEach((t, i) => {
      const v = vals[i];
      t.classList.toggle('neg', v < 0);
      (t.firstElementChild as HTMLElement).style.height = `${Math.min(50, Math.abs(v) * 50)}%`;
    });
  }

  private showHover(h: Hover): void {
    const info = this.els.info;
    if (!h.text) { info.classList.add('hidden'); return; }
    info.classList.remove('hidden');
    info.innerHTML = `<b>${h.text}</b>${h.sub ? `<div class="muted">${h.sub}</div>` : ''}`;
  }

  toast(text: string, kind: 'info' | 'warn' | 'good' = 'info'): void {
    const t = document.createElement('div');
    t.className = `toast card ${kind}`;
    t.textContent = text;
    this.els.toasts.appendChild(t);
    while (this.els.toasts.children.length > 4) this.els.toasts.firstElementChild!.remove();
    setTimeout(() => t.remove(), 4000);
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
    const m = this.modal(`<h2>Little Cities</h2><div class="stack">
      <button class="btn primary" id="resume">Seguir jugando</button>
      <button class="btn" id="save">Guardar partida</button>
      <button class="btn" id="help">Cómo se juega</button>
      <button class="btn" id="exit">Cambiar de ciudad</button></div>
      <p class="muted" style="font-size:12px;opacity:.7">La partida se guarda sola cada medio minuto en este navegador.</p>`);
    const close = () => { m.remove(); this.setSpeed(was || 1); };
    (m.querySelector('#resume') as HTMLButtonElement).onclick = close;
    (m.querySelector('#save') as HTMLButtonElement).onclick = () => { this.onMenu('save'); close(); };
    (m.querySelector('#help') as HTMLButtonElement).onclick = () => { close(); this.openHelp(); };
    (m.querySelector('#exit') as HTMLButtonElement).onclick = () => { this.onMenu('save'); this.onMenu('exit'); };
  }

  openHelp(): void {
    const m = this.modal(`<h2>Cómo se juega</h2>
      <p>Esta es una ciudad de verdad: sus calles y edificios vienen de OpenStreetMap. Tú decides cómo crece.</p>
      <ul>
        <li><b>Zonifica</b> terreno libre junto a una calle como residencial <kbd>R</kbd>, comercial <kbd>C</kbd> o industrial <kbd>I</kbd>. Cuando haya demanda (barras de abajo a la derecha), se construirán edificios.</li>
        <li>Las zonas nuevas necesitan <b>luz y agua</b>: coloca una central eléctrica y una depuradora desde <b>Servicios</b> <kbd>S</kbd>. Los edificios que ya existían funcionan sin ellas.</li>
        <li><b>Traza calles</b> <kbd>T</kbd> para abrir terreno nuevo y aliviar el tráfico; <b>demuele</b> <kbd>D</kbd> lo que te estorbe.</li>
        <li>Comisarías, bomberos, centros de salud, colegios y parques suben la <b>felicidad</b>, y con ella llegan más vecinos.</li>
        <li>Los coches van de casa al trabajo. Pulsa <kbd>G</kbd> para ver qué calles se atascan.</li>
        <li>Cada mes cobras impuestos y pagas el mantenimiento. <kbd>Espacio</kbd> pausa; <kbd>2</kbd> y <kbd>3</kbd> aceleran el tiempo.</li>
      </ul>
      <div class="stack"><button class="btn primary" id="ok">¡Entendido!</button></div>`);
    (m.querySelector('#ok') as HTMLButtonElement).onclick = () => m.remove();
  }

  destroy(): void { this.root.remove(); document.querySelector('.modal')?.remove(); }
}
