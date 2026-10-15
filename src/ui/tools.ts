// Herramientas: mover la cámara, poner paradas, trazar líneas y quitar paradas.
import { Graphics } from 'pixi.js';
import type { Pt } from '../data/types.ts';
import { pointSegment } from '../data/geo.ts';
import type { Game } from '../sim/game.ts';
import { MODE, type Line, type Mode, type Stop } from '../sim/transit.ts';
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
  private hoverStop: Stop | undefined;
  private cursor: Pt = { x: 0, y: 0 };

  constructor(private world: World, private game: Game, private map: MapRenderer, private transit: TransitRenderer) {
    world.overlay.addChild(this.preview);
    const c = world.app.canvas;
    c.addEventListener('pointerdown', e => this.down(e));
    c.addEventListener('pointermove', e => this.move(e));
    c.addEventListener('pointerup', e => this.up(e));
    c.addEventListener('pointercancel', e => this.up(e));
    c.addEventListener('wheel', e => { e.preventDefault(); world.zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0012)); }, { passive: false });
    c.addEventListener('contextmenu', e => e.preventDefault());
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
      case 'pan': return 'Arrastra para moverte · rueda para ampliar · clic en una línea o parada para ver sus detalles';
      case 'stop:bus': return `Clic junto a una calle para poner una parada de bus (${MODE.bus.stopCost} €) · los vecinos caminan hasta ${MODE.bus.walk} m`;
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
    this.editing = this.game.createLine(mode);
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

  private down(e: PointerEvent): void {
    const c = this.world.app.canvas;
    c.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 2) { this.lastPinch = this.pinchDist(); return; }
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
        if (s) { this.game.removeStop(s.id); this.transit.drawNetwork(); if (this.selected && !this.game.net.lines.has(this.selected.id)) this.select(null); else this.onSelect(this.selected, null); }
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
      if (this.lastPinch > 0) this.world.zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, d / this.lastPinch);
      this.lastPinch = d;
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
      case 'remove':
        p.clear();
        if (this.hoverStop) p.circle(this.hoverStop.x, this.hoverStop.y, 12).stroke({ color: 0xd23b33, width: 2.5 });
        break;
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
    if (s) {
      const lines = s.lines.map(id => this.game.net.lines.get(id)?.name).filter(Boolean).join(', ');
      return { text: s.name, sub: `${MODE[s.mode].stopName} · ${s.queue.length} esperando${lines ? ' · ' + lines : ' · sin línea'}` };
    }
    const l = this.tool === 'pan' ? this.lineAt(w.x, w.y) : null;
    if (l) return { text: l.name, sub: `${MODE[l.mode].name} · ${l.stops.length} paradas · ${l.vehicles.length} vehículos · ${l.vehicles.reduce((a, v) => a + v.passengers.length, 0)} a bordo` };
    return this.map.describe(w.x, w.y);
  }

  get pointerWorld(): Pt { return this.cursor; }
}
