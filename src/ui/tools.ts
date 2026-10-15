// Herramientas del jugador: mover la cámara, zonificar, trazar calles, demoler y colocar servicios.
import { Graphics } from 'pixi.js';
import type { Pt, RoadClass, ServiceKind } from '../data/types.ts';
import type { City } from '../sim/city.ts';
import { CELL, Kind, Zone } from '../sim/grid.ts';
import { ROAD_WIDTH } from '../sim/graph.ts';
import { SERVICE_DEF } from '../sim/defs.ts';
import type { CityRenderer } from '../render/cityRenderer.ts';
import type { World } from '../render/world.ts';
import { INK, ZONE_COLOR, ZONE_NAME } from '../render/palette.ts';

export type Tool = 'pan' | 'zoneR' | 'zoneC' | 'zoneI' | 'dezone' | 'road' | 'bulldoze' | `service:${ServiceKind}`;

export interface Hover { kind: 'lot' | 'road' | 'zone' | 'service' | 'none'; text: string; sub?: string }

export class Tools {
  tool: Tool = 'pan';
  roadClass: RoadClass = 'residential';
  onToolChange: (t: Tool) => void = () => undefined;
  onHover: (h: Hover) => void = () => undefined;
  onHint: (text: string) => void = () => undefined;
  private preview = new Graphics();
  private pointers = new Map<number, Pt>();
  private dragStart: Pt | null = null;
  private dragging = false;
  private panStart: { x: number; y: number; rx: number; ry: number } | null = null;
  private roadStart: Pt | null = null;
  private lastPinch = 0;
  private lastWorld: Pt = { x: 0, y: 0 };

  constructor(private world: World, private city: City, private renderer: CityRenderer) {
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
    this.tool = t;
    this.roadStart = null;
    this.preview.clear();
    this.world.overlay.removeChildren();
    this.world.overlay.addChild(this.preview);
    this.onToolChange(t);
    this.onHint(this.hintFor(t));
    const c = this.world.app.canvas;
    c.style.cursor = t === 'pan' ? 'grab' : 'crosshair';
  }

  hintFor(t: Tool): string {
    switch (t) {
      case 'pan': return 'Arrastra para moverte · rueda para ampliar · pasa el ratón por encima para ver detalles';
      case 'zoneR': case 'zoneC': case 'zoneI': return 'Arrastra sobre terreno libre junto a una calle, o sobre edificios para recalificarlos · botón derecho para moverte';
      case 'dezone': return 'Arrastra para quitar la zona';
      case 'road': return `Clic para empezar la calle (${this.roadClass === 'residential' ? 'calle' : this.roadClass === 'secondary' ? 'avenida' : 'vía principal'}), clic para terminar · Esc cancela`;
      case 'bulldoze': return 'Clic sobre un edificio, servicio o tramo de calle para demolerlo, o arrastra para despejar una zona (200 € cada uno)';
      default: {
        const kind = t.slice(8) as ServiceKind;
        const d = SERVICE_DEF[kind];
        return `${d.name}: ${d.cost.toLocaleString('es-ES')} € · cobertura ${d.radius} m · ${d.upkeep.toLocaleString('es-ES')} €/mes · clic para colocar`;
      }
    }
  }

  private zoneOf(t: Tool): Zone {
    return t === 'zoneR' ? Zone.R : t === 'zoneC' ? Zone.C : t === 'zoneI' ? Zone.I : Zone.None;
  }

  private down(e: PointerEvent): void {
    const c = this.world.app.canvas;
    c.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 2) { this.lastPinch = this.pinchDist(); this.dragStart = null; return; }
    const w = this.world.toWorld(e.clientX, e.clientY);
    const pan = this.tool === 'pan' || e.button === 1 || e.button === 2;
    if (pan) {
      this.panStart = { x: e.clientX, y: e.clientY, rx: this.world.root.x, ry: this.world.root.y };
      c.style.cursor = 'grabbing';
      return;
    }
    if (e.button !== 0) return;
    switch (this.tool) {
      case 'zoneR': case 'zoneC': case 'zoneI': case 'dezone': case 'bulldoze':
        this.dragStart = w; this.dragging = true; break;
      case 'road':
        if (!this.roadStart) { this.roadStart = this.snap(w); }
        else {
          const end = this.snap(w);
          if (this.city.buildRoad(this.roadStart, end, this.roadClass)) this.roadStart = end; // encadena tramos
          this.preview.clear();
        }
        break;
      default:
        if (this.tool.startsWith('service:')) this.city.placeService(this.tool.slice(8) as ServiceKind, w.x, w.y);
    }
  }

  private snap(p: Pt): Pt {
    const g = this.city.graph;
    const n = g.nearestNode(p.x, p.y, 9);
    if (n >= 0) return { x: g.nodes[n].x, y: g.nodes[n].y };
    const e = g.nearestEdge(p.x, p.y, 7);
    if (e) { const ed = g.edges[e.edge]; const a = g.nodes[ed.a], b = g.nodes[ed.b]; return { x: a.x + (b.x - a.x) * e.t, y: a.y + (b.y - a.y) * e.t }; }
    return p;
  }

  private pinchDist(): number {
    const [a, b] = [...this.pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

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
      this.world.root.x = this.panStart.rx + (e.clientX - this.panStart.x);
      this.world.root.y = this.panStart.ry + (e.clientY - this.panStart.y);
      return;
    }
    const w = this.world.toWorld(e.clientX, e.clientY);
    this.lastWorld = w;
    this.drawPreview(w);
    if (!this.dragging) this.onHover(this.describe(w));
  }

  private up(e: PointerEvent): void {
    this.pointers.delete(e.pointerId);
    if (this.panStart) { this.panStart = null; this.world.app.canvas.style.cursor = this.tool === 'pan' ? 'grab' : 'crosshair'; this.world.clamp(this.city.data.radius); return; }
    if (this.dragging && this.dragStart) {
      const w = this.world.toWorld(e.clientX, e.clientY);
      const s = this.dragStart;
      this.dragStart = null; this.dragging = false;
      this.preview.clear();
      if (this.tool === 'bulldoze') {
        const moved = Math.hypot(w.x - s.x, w.y - s.y) > CELL;
        if (moved) this.city.demolishCells(this.cellsInRect(s, w)); else this.city.demolishAt(w.x, w.y);
        return;
      }
      const cells = this.cellsInRect(s, w);
      const z = this.zoneOf(this.tool);
      const n = this.city.zoneCells(cells, z);
      if (n && z !== Zone.None) this.onHint(`${n} celdas zonificadas · se construirá cuando haya demanda, luz y agua`);
    }
  }

  private cellsInRect(a: Pt, b: Pt): number[] {
    const g = this.city.grid;
    const [c0, r0] = g.cellOf(Math.min(a.x, b.x), Math.min(a.y, b.y));
    const [c1, r1] = g.cellOf(Math.max(a.x, b.x), Math.max(a.y, b.y));
    const out: number[] = [];
    for (let cy = Math.max(0, r0); cy <= Math.min(g.h - 1, r1); cy++) for (let cx = Math.max(0, c0); cx <= Math.min(g.w - 1, c1); cx++) out.push(g.idx(cx, cy));
    return out;
  }

  private drawPreview(w: Pt): void {
    const p = this.preview;
    p.clear();
    const g = this.city.grid;
    switch (this.tool) {
      case 'zoneR': case 'zoneC': case 'zoneI': case 'dezone': {
        const z = this.zoneOf(this.tool);
        const color = z ? ZONE_COLOR[z] : 0xd23b33;
        const a = this.dragging && this.dragStart ? this.dragStart : w;
        const cells = this.cellsInRect(a, w);
        for (const i of cells) {
          if (!this.city.canZone(i, z)) continue;
          p.rect(g.x0 + (i % g.w) * CELL + 1, g.y0 + ((i / g.w) | 0) * CELL + 1, CELL - 2, CELL - 2);
        }
        p.fill({ color, alpha: 0.5 });
        const [c0, r0] = g.cellOf(Math.min(a.x, w.x), Math.min(a.y, w.y));
        const [c1, r1] = g.cellOf(Math.max(a.x, w.x), Math.max(a.y, w.y));
        p.rect(g.x0 + c0 * CELL, g.y0 + r0 * CELL, (c1 - c0 + 1) * CELL, (r1 - r0 + 1) * CELL).stroke({ color: INK, width: 1, alpha: 0.6 });
        break;
      }
      case 'road': {
        const s = this.snap(w);
        p.circle(s.x, s.y, 3).fill({ color: 0xffffff, alpha: 0.8 }).stroke({ color: INK, width: 0.8 });
        if (this.roadStart) {
          const blocked = this.city.roadBlocked(this.roadStart, s, this.roadClass);
          const cost = this.city.roadCost(this.roadStart, s, this.roadClass);
          p.moveTo(this.roadStart.x, this.roadStart.y).lineTo(s.x, s.y).stroke({ color: blocked ? 0xd23b33 : 0x4b4b4e, width: ROAD_WIDTH[this.roadClass], alpha: 0.6, cap: 'round' });
          this.onHint(blocked ?? `${Math.round(Math.hypot(s.x - this.roadStart.x, s.y - this.roadStart.y))} m · ${Math.round(cost).toLocaleString('es-ES')} € · clic para construir, Esc para cancelar`);
        }
        break;
      }
      case 'bulldoze': {
        if (this.dragging && this.dragStart) {
          const a = this.dragStart;
          const [c0, r0] = g.cellOf(Math.min(a.x, w.x), Math.min(a.y, w.y));
          const [c1, r1] = g.cellOf(Math.max(a.x, w.x), Math.max(a.y, w.y));
          p.rect(g.x0 + c0 * CELL, g.y0 + r0 * CELL, (c1 - c0 + 1) * CELL, (r1 - r0 + 1) * CELL).fill({ color: 0xd23b33, alpha: 0.25 }).stroke({ color: 0xd23b33, width: 1 });
          break;
        }
        const lot = this.city.lotAt(w.x, w.y);
        if (lot) { p.poly(lot.poly.flatMap(q => [q.x, q.y]), true).fill({ color: 0xd23b33, alpha: 0.35 }); break; }
        const hit = this.city.graph.nearestEdge(w.x, w.y, 7);
        if (hit) { const e = this.city.graph.edges[hit.edge]; const a = this.city.graph.nodes[e.a], b = this.city.graph.nodes[e.b]; p.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ color: 0xd23b33, width: ROAD_WIDTH[e.cls] + 2, alpha: 0.5, cap: 'round' }); }
        break;
      }
      default:
        if (this.tool.startsWith('service:')) {
          const kind = this.tool.slice(8) as ServiceKind;
          const pl = this.city.servicePlacement(kind, w.x, w.y);
          this.renderer.previewService(this.world.overlay, kind, w.x, w.y, pl.angle, pl.ok);
          this.world.overlay.addChild(this.preview);
        }
    }
  }

  cancel(): void {
    if (this.roadStart) { this.roadStart = null; this.preview.clear(); this.onHint(this.hintFor('road')); return; }
    this.setTool('pan');
  }

  /** Describe lo que hay bajo el puntero. */
  describe(w: Pt): Hover {
    const lot = this.city.lotAt(w.x, w.y);
    if (lot) {
      const useName = { residential: 'Residencial', commercial: 'Comercial', industrial: 'Industrial', public: 'Equipamiento' }[lot.use];
      const n = Math.round(lot.cap * lot.occ);
      const what = lot.use === 'residential' ? `${n} habitantes` : `${n} empleos`;
      const svc = lot.service ? ` · ${SERVICE_DEF[lot.service].name}` : '';
      const pz = this.city.pendingZone(lot);
      const pend = pz ? ` · se renovará como ${ZONE_NAME[pz].toLowerCase()}` : '';
      return { kind: 'lot', text: lot.name ?? useName, sub: `${lot.name ? useName + ' · ' : ''}${lot.levels} plantas · ${what}${svc}${lot.origin === 'built' ? ' · nuevo' : ''}${pend}` };
    }
    const s = this.city.serviceAt(w.x, w.y);
    if (s) return { kind: 'service', text: SERVICE_DEF[s.kind].name, sub: `Cobertura ${SERVICE_DEF[s.kind].radius} m` };
    const hit = this.city.graph.nearestEdge(w.x, w.y, 8);
    if (hit) {
      const e = this.city.graph.edges[hit.edge];
      const cls = { motorway: 'Autovía', primary: 'Vía principal', secondary: 'Avenida', tertiary: 'Calle principal', residential: 'Calle', service: 'Vía de servicio', pedestrian: 'Peatonal' }[e.cls];
      const load = e.load ? ` · ${e.load} coches` : '';
      return { kind: 'road', text: e.name ?? cls, sub: `${e.name ? cls + ' · ' : ''}${e.oneway ? 'sentido único' : 'doble sentido'}${load}` };
    }
    const [cx, cy] = this.city.grid.cellOf(w.x, w.y);
    if (this.city.grid.inBounds(cx, cy)) {
      const i = this.city.grid.idx(cx, cy);
      const g = this.city.grid;
      if (g.zone[i]) {
        const name = { 1: 'Zona residencial', 2: 'Zona comercial', 3: 'Zona industrial' }[g.zone[i]]!;
        const needs: string[] = [];
        if (!g.coverage.power[i]) needs.push('luz');
        if (!g.coverage.water[i]) needs.push('agua');
        if (g.roadDist[i] > 2) needs.push('calle cerca');
        return { kind: 'zone', text: name, sub: needs.length ? `Falta: ${needs.join(', ')}` : 'Lista para construir' };
      }
      if (g.kind[i] === Kind.Water) return { kind: 'none', text: 'Agua' };
      if (g.kind[i] === Kind.Park) return { kind: 'none', text: 'Plaza o zona verde' };
    }
    return { kind: 'none', text: '' };
  }

  get pointerWorld(): Pt { return this.lastWorld; }
}
