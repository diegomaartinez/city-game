// Herramientas: mover la cámara, poner paradas, trazar líneas y quitar paradas.
import { Graphics } from 'pixi.js';
import type { Pt } from '../data/types.ts';
import { pointSegment } from '../data/geo.ts';
import type { Game } from '../sim/game.ts';
import { MODE, PEOPLE_PER_PASSENGER, type Line, type Mode, type Stop } from '../sim/transit.ts';
import type { MapRenderer } from '../render/mapRenderer.ts';
import type { TransitRenderer } from '../render/transitRenderer.ts';
import type { World } from '../render/world.ts';

export type Tool = 'pan' | 'stop:bus' | 'stop:metro' | 'line' | 'remove';

export interface Hover { text: string; sub?: string }

export class Tools {
  tool: Tool = 'pan';
  /** Línea que se está trazando o ampliando. */
  editing: Line | null = null;
  /** Línea seleccionada en el panel. */
  selected: Line | null = null;
  onToolChange: (t: Tool) => void = () => undefined;
  onHover: (h: Hover | null) => void = () => undefined;
  onHint: (text: string) => void = () => undefined;
  onSelect: (line: Line | null, stop: Stop | null) => void = () => undefined;
  private preview = new Graphics();
  private pointers = new Map<number, Pt>();
  private panStart: { x: number; y: number; rx: number; ry: number; moved: boolean } | null = null;
  private lastPinch = 0;
  private lastPinchCenter: Pt | null = null;
  private hoverStop: Stop | undefined;
  private cursor: Pt = { x: 0, y: 0 };
  /** Arrastre de un punto de paso de la línea seleccionada. */
  private viaDrag: { line: Line; seg: number; idx: number; vias: Pt[] } | null = null;

  constructor(private world: World, private game: Game, private map: MapRenderer, private transit: TransitRenderer) {
    world.overlay.addChild(this.preview);
    const c = world.app.canvas;
    c.addEventListener('pointerdown', e => this.down(e));
    c.addEventListener('pointermove', e => this.move(e));
    c.addEventListener('pointerup', e => this.up(e));
    c.addEventListener('pointercancel', e => this.up(e));
    c.addEventListener('wheel', e => { e.preventDefault(); world.zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0012)); }, { passive: false });
    c.addEventListener('contextmenu', e => e.preventDefault());
    game.on('network', () => { this.hoverStop = game.net.stopAt(this.cursor.x, this.cursor.y, 14 * Math.max(1, 1.5 / world.zoom)); this.onHover(this.describe(this.cursor)); });
  }

  setTool(t: Tool): void {
    if (this.tool === 'line' && t !== 'line') this.finishLine();
    this.tool = t;
    this.preview.clear();
    this.onToolChange(t);
    this.onHint(this.hintFor(t));
    this.world.app.canvas.style.cursor = t === 'pan' ? 'grab' : 'crosshair';
  }

  hintFor(t: Tool): string {
    switch (t) {
      case 'pan': return this.selected ? 'Arrastra la línea seleccionada para cambiar su recorrido · arrastra sus puntos de paso para moverlos · Esc deselecciona' : 'Arrastra para moverte · rueda para ampliar · clic en una línea o parada para ver sus detalles';
      case 'stop:bus': return `Clic junto a una calle para poner una parada de bus (${MODE.bus.stopCost.toLocaleString('es-ES')} €) · los vecinos caminan hasta ${MODE.bus.walk} m`;
      case 'stop:metro': return `Clic para poner una estación de metro (${MODE.metro.stopCost.toLocaleString('es-ES')} €) · atrae viajeros a ${MODE.metro.walk} m`;
      case 'line': {
        const l = this.editing;
        if (!l) return '';
        const n = l.stops.length;
        if (n === 0) return `${l.name}: haz clic en la primera ${MODE[l.mode].stopName.toLowerCase()}`;
        const extra = l.mode === 'metro' ? ` · túnel ${MODE.metro.trackCost} €/m` : '';
        return `${l.name}: ${n} parada${n === 1 ? '' : 's'} · clic en la siguiente${n >= 3 ? ', en la primera para cerrar el bucle' : ''} · Enter o Esc para terminar${extra}`;
      }
      case 'remove': return 'Clic sobre una parada para quitarla (se devuelve la mitad del coste)';
    }
  }

  /** Empieza a trazar una línea nueva. */
  startLine(mode: Mode): void {
    if (this.tool === 'line') this.finishLine();
    const l = this.game.createLine(mode);
    if (!l) return;
    this.editing = l;
    this.selected = this.editing;
    this.transit.highlight = this.editing;
    this.transit.drawNetwork();
    this.tool = 'line';
    this.onToolChange('line');
    this.onHint(this.hintFor('line'));
    this.onSelect(this.editing, null);
    this.world.app.canvas.style.cursor = 'crosshair';
  }

  /** Sigue añadiendo paradas al final de una línea existente. */
  extendLine(line: Line): void {
    if (line.loop) return;
    if (this.tool === 'line') this.finishLine();
    this.editing = line;
    this.selected = line;
    this.transit.highlight = line;
    this.transit.drawNetwork();
    this.tool = 'line';
    this.onToolChange('line');
    this.onHint(this.hintFor('line'));
    this.world.app.canvas.style.cursor = 'crosshair';
  }

  finishLine(): void {
    const l = this.editing;
    this.editing = null;
    this.preview.clear();
    if (!l) return;
    if (l.stops.length < 2) { this.game.removeLine(l); this.selected = null; this.transit.highlight = null; this.onSelect(null, null); }
    else {
      if (!l.vehicles.length) this.game.addVehicle(l);
      this.transit.highlight = l;
      this.onSelect(l, null);
    }
    this.transit.drawNetwork();
  }

  select(line: Line | null, stop: Stop | null = null): void {
    this.selected = line;
    this.transit.highlight = line;
    this.transit.drawNetwork();
    this.onSelect(line, stop);
    if (this.tool === 'pan') this.onHint(this.hintFor('pan'));
  }

  private lineAt(x: number, y: number, maxDist = 7): Line | null {
    let best: Line | null = null, bd = maxDist * Math.max(1, 1.5 / this.world.zoom);
    for (const line of this.game.net.lines.values()) {
      for (const seg of [...line.fwd, ...line.back]) {
        for (let i = 0; i + 1 < seg.pts.length; i++) {
          const a = seg.pts[i], b = seg.pts[i + 1];
          const d = pointSegment(x, y, a.x, a.y, b.x, b.y).d;
          if (d < bd) { bd = d; best = line; }
        }
      }
    }
    return best;
  }

  private get hitK(): number { return Math.max(1, 1.5 / this.world.zoom); }

  /** Punto de paso de la línea bajo el cursor. */
  private viaAt(line: Line, x: number, y: number): { seg: number; idx: number } | null {
    const r = 9 * this.hitK;
    for (let seg = 0; seg < line.vias.length; seg++) {
      const list = line.vias[seg] ?? [];
      for (let idx = 0; idx < list.length; idx++) if (Math.hypot(list[idx].x - x, list[idx].y - y) <= r) return { seg, idx };
    }
    return null;
  }

  private down(e: PointerEvent): void {
    const c = this.world.app.canvas;
    c.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 2) {
      // segundo dedo: cancela lo que estuviera haciendo el primero y pasa a mover/ampliar
      this.lastPinch = this.pinchDist();
      const [a, b] = [...this.pointers.values()];
      this.lastPinchCenter = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      this.panStart = null; this.viaDrag = null; this.preview.clear();
      return;
    }
    // arrastrar la línea seleccionada para ajustar su recorrido (sin añadir paradas)
    if (this.tool === 'pan' && e.button === 0 && this.selected && this.selected.fwd.length) {
      const w = this.world.toWorld(e.clientX, e.clientY);
      const line = this.selected;
      if (!this.game.net.stopAt(w.x, w.y, 14 * this.hitK)) {
        const hit = this.viaAt(line, w.x, w.y);
        if (hit) { this.viaDrag = { line, seg: hit.seg, idx: hit.idx, vias: line.vias[hit.seg].slice() }; return; }
        const near = this.game.net.nearestSegment(line, w.x, w.y, 7 * this.hitK);
        if (near) {
          const vias = (line.vias[near.seg] ?? []).slice();
          // se inserta en orden según la posición a lo largo del tramo
          let idx = 0;
          while (idx < vias.length && this.game.net.viaPosition(line, near.seg, vias[idx]) < near.t) idx++;
          vias.splice(idx, 0, { x: w.x, y: w.y });
          this.viaDrag = { line, seg: near.seg, idx, vias };
          this.onHint('Arrastra para llevar la línea por donde quieras · suelta sobre una calle');
          return;
        }
      }
    }
    const pan = this.tool === 'pan' || e.button === 1 || e.button === 2;
    if (pan) {
      this.panStart = { x: e.clientX, y: e.clientY, rx: this.world.root.x, ry: this.world.root.y, moved: false };
      c.style.cursor = 'grabbing';
      return;
    }
    if (e.button !== 0) return;
    const w = this.world.toWorld(e.clientX, e.clientY);
    switch (this.tool) {
      case 'stop:bus': case 'stop:metro': {
        const mode = this.tool.slice(5) as Mode;
        const s = this.game.addStop(mode, w.x, w.y);
        if (s) { this.transit.drawNetwork(); this.onHint(`${s.name} · ${this.hintFor(this.tool)}`); }
        break;
      }
      case 'line': {
        const l = this.editing;
        if (!l) break;
        const s = this.game.net.stopAt(w.x, w.y, 14 * Math.max(1, 1.5 / this.world.zoom));
        if (!s) { this.onHint('Haz clic sobre una parada. Si no hay, pon una primero (B o M).'); break; }
        const r = this.game.appendStop(l, s.id);
        if (r === 'closed') { this.finishLine(); this.setTool('pan'); }
        else if (r === 'added') { this.transit.drawNetwork(); this.onHint(this.hintFor('line')); this.onSelect(l, null); }
        break;
      }
      case 'remove': {
        const s = this.game.net.stopAt(w.x, w.y, 14 * Math.max(1, 1.5 / this.world.zoom));
        if (s) { this.game.removeStop(s.id); this.transit.drawNetwork(); if (this.selected && !this.game.net.lines.has(this.selected.id)) this.select(null); else this.onSelect(this.selected, null); break; }
        if (this.selected) {
          const hit = this.viaAt(this.selected, w.x, w.y);
          if (hit) { const vias = this.selected.vias[hit.seg].slice(); vias.splice(hit.idx, 1); this.game.setVias(this.selected, hit.seg, vias); this.transit.drawNetwork(); }
        }
        break;
      }
    }
  }

  private pinchDist(): number { const [a, b] = [...this.pointers.values()]; return Math.hypot(a.x - b.x, a.y - b.y); }

  private move(e: PointerEvent): void {
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 2) {
      const d = this.pinchDist();
      const [a, b] = [...this.pointers.values()];
      const c = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      if (this.lastPinch > 0) this.world.zoomAt(c.x, c.y, d / this.lastPinch);
      if (this.lastPinchCenter) this.world.panBy(c.x - this.lastPinchCenter.x, c.y - this.lastPinchCenter.y);
      this.lastPinch = d; this.lastPinchCenter = c;
      return;
    }
    if (this.viaDrag) {
      const w = this.world.toWorld(e.clientX, e.clientY);
      const { line, seg, idx, vias } = this.viaDrag;
      vias[idx] = { x: w.x, y: w.y };
      this.transit.previewVias(this.preview, line, seg, vias, idx);
      return;
    }
    if (this.panStart) {
      const dx = e.clientX - this.panStart.x, dy = e.clientY - this.panStart.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) this.panStart.moved = true;
      this.world.root.x = this.panStart.rx + dx;
      this.world.root.y = this.panStart.ry + dy;
      return;
    }
    const w = this.world.toWorld(e.clientX, e.clientY);
    this.cursor = w;
    this.hoverStop = this.game.net.stopAt(w.x, w.y, 14 * Math.max(1, 1.5 / this.world.zoom));
    this.drawPreview(w);
    this.onHover(this.describe(w));
  }

  private up(e: PointerEvent): void {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) { this.lastPinch = 0; this.lastPinchCenter = null; }
    if (this.pointers.size === 1) return; // queda un dedo: no interpretar su levantamiento como clic
    if (this.viaDrag) {
      const { line, seg, idx, vias } = this.viaDrag;
      this.viaDrag = null;
      this.preview.clear();
      const w = this.world.toWorld(e.clientX, e.clientY);
      const snapped = this.game.net.snapVia(line, w);
      if (!snapped) { this.onHint('Suelta el punto de paso sobre una calle transitable'); return; }
      vias[idx] = snapped;
      this.game.setVias(line, seg, vias);
      this.transit.drawNetwork();
      this.onHint('Recorrido ajustado · arrastra el punto para moverlo, o quítalo con la herramienta D');
      return;
    }
    if (this.panStart) {
      const moved = this.panStart.moved;
      this.panStart = null;
      this.world.app.canvas.style.cursor = this.tool === 'pan' ? 'grab' : 'crosshair';
      this.world.clamp(this.game.data.radius);
      if (!moved && this.tool === 'pan' && e.button === 0) {
        // clic simple: selecciona parada o línea
        const w = this.world.toWorld(e.clientX, e.clientY);
        const s = this.game.net.stopAt(w.x, w.y, 14 * Math.max(1, 1.5 / this.world.zoom));
        if (s) { this.select(s.lines.length ? this.game.net.lines.get(s.lines[0]) ?? null : null, s); return; }
        const l = this.lineAt(w.x, w.y);
        this.select(l);
      }
    }
  }

  private drawPreview(w: Pt): void {
    const p = this.preview;
    switch (this.tool) {
      case 'stop:bus': case 'stop:metro': {
        const mode = this.tool.slice(5) as Mode;
        const pl = this.game.net.placement(mode, w.x, w.y);
        this.transit.previewStop(p, mode, pl.x, pl.y, pl.ok);
        if (!pl.ok && pl.reason) this.onHint(pl.reason); else this.onHint(this.hintFor(this.tool));
        break;
      }
      case 'line':
        if (this.editing) this.transit.previewLineExtension(p, this.editing, w, this.hoverStop);
        break;
      case 'remove': {
        p.clear();
        const k = this.hitK;
        if (this.hoverStop) p.circle(this.hoverStop.x, this.hoverStop.y, 12 * k).stroke({ color: 0xd23b33, width: 2.5 * k });
        else if (this.selected) { const hit = this.viaAt(this.selected, w.x, w.y); if (hit) { const v = this.selected.vias[hit.seg][hit.idx]; p.circle(v.x, v.y, 8 * k).stroke({ color: 0xd23b33, width: 2.5 * k }); } }
        break;
      }
      default:
        p.clear();
    }
  }

  cancel(): void {
    if (this.tool === 'line') { this.finishLine(); this.setTool('pan'); return; }
    if (this.tool !== 'pan') { this.setTool('pan'); return; }
    if (this.selected) { this.select(null); }
  }

  describe(w: Pt): Hover | null {
    const s = this.hoverStop;
    const D = this.game.demand.districts;
    if (s) {
      const lines = s.lines.map(id => this.game.net.lines.get(id)?.name).filter(Boolean).join(', ');
      // a qué barrios quieren ir los que esperan
      const dest = new Map<number, number>();
      for (const p of s.queue) dest.set(p.dest, (dest.get(p.dest) ?? 0) + 1);
      const top = [...dest.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([d, n]) => `${D.list[d]?.name ?? '?'} ${n * PEOPLE_PER_PASSENGER}`).join(', ');
      return { text: s.name, sub: `${MODE[s.mode].stopName} · ${s.queue.length * PEOPLE_PER_PASSENGER} esperando${lines ? ' · ' + lines : ' · sin línea'}${top ? `<br>Van a: ${top}` : ''}` };
    }
    const l = this.tool === 'pan' ? this.lineAt(w.x, w.y) : null;
    if (l) return { text: l.name, sub: `${MODE[l.mode].name} · ${l.stops.length} paradas · ${l.vehicles.length} vehículos · ${l.vehicles.reduce((a, v) => a + v.passengers.length, 0) * PEOPLE_PER_PASSENGER} a bordo` };
    const half = this.game.data.radius + 60;
    if (Math.abs(w.x) > half || Math.abs(w.y) > half) return null;
    const d = D.list[D.nearest(w.x, w.y)];
    const base = this.map.describe(w.x, w.y);
    const dtxt = `${d.name} · ${d.residents.toLocaleString('es-ES')} hab · ${d.jobs.toLocaleString('es-ES')} empleos${d.waiting >= 1 ? ` · ${Math.round(d.waiting) * PEOPLE_PER_PASSENGER} esperan sin parada` : ''}`;
    if (!base) return { text: d.name, sub: dtxt.slice(d.name.length + 3) };
    return { text: base.text, sub: (base.sub ? base.sub + '<br>' : '') + dtxt };
  }

  get pointerWorld(): Pt { return this.cursor; }
}
