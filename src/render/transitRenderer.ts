// Dibuja la red de transporte: líneas, paradas con sus colas, vehículos y demanda sin cubrir.
import { Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import type { Pt } from '../data/types.ts';
import type { Game } from '../sim/game.ts';
import { MODE, PEOPLE_PER_PASSENGER, type Line, type Mode, type Stop, type Vehicle } from '../sim/transit.ts';
import type { World } from './world.ts';
import { INK, STYLES, type MapStyle } from './palette.ts';

const LINE_WIDTH: Record<Mode, number> = { bus: 3.6, metro: 5.5, hub: 4, train: 5.5, plane: 3, ship: 4.5 };

/** Capas de demanda: hexágonos de demanda sin cubrir y hexágonos de población. */
export type Overlay = 'none' | 'hexDemand' | 'hexPop';
export const OVERLAYS: Overlay[] = ['none', 'hexDemand', 'hexPop'];

const LABEL_STYLE = { fontFamily: 'Rubik Variable, system-ui, sans-serif', fontSize: 11, fontWeight: '800' } as const;

export class TransitRenderer {
  private linesG = new Graphics();
  private stopsG = new Graphics();
  private queuesG = new Graphics();
  private markersG = new Graphics();
  private hexG = new Graphics();
  private hexLabels = new Map<number, Text>();
  private hexLayer = new Container();
  private labels = new Map<number, Text>();
  private labelLayer = new Container();
  private vehicleSprites = new Map<Vehicle, { body: Sprite; full: Sprite }>();
  private busTex: Texture;
  private metroTex: Texture;
  private planeTex: Texture;
  private shipTex: Texture;
  private dotTex: Texture;
  /** Línea resaltada (en edición o seleccionada); las demás se atenúan. */
  highlight: Line | null = null;
  overlay: Overlay = 'none';
  private overlayTimer = 9;
  private drawnOverlay: Overlay = 'none';
  private drawnZoom = -1;
  private ink = INK;
  private casing = 0xffffff;
  private stopFill = 0xffffff;

  /** Factor para que paradas y líneas no desaparezcan al alejar la cámara (mínimo en píxeles). */
  private get k(): number { return Math.max(1, 2.2 / this.world.zoom); }

  constructor(private world: World, private game: Game) {
    world.lines.addChild(this.linesG);
    world.stops.addChild(this.stopsG, this.queuesG, this.labelLayer);
    world.markers.addChild(this.markersG);
    world.heat.addChild(this.hexLayer);
    this.hexLayer.addChild(this.hexG);
    this.busTex = this.makeVehicleTexture(11, 3.2, false);
    this.metroTex = this.makeVehicleTexture(30, 3.6, true);
    this.planeTex = this.makePlaneTexture();
    this.shipTex = this.makeShipTexture();
    this.dotTex = this.makeDotTexture();
    game.on('network', () => this.drawNetwork());
  }

  /** Adapta tinta y contornos al estilo de mapa. */
  setStyle(style: MapStyle): void {
    const d = STYLES[style];
    this.ink = d.ink;
    this.casing = style === 'maqueta' ? INK : 0xffffff;
    this.stopFill = style === 'maqueta' ? 0xf7e8d2 : 0xffffff;
    this.busTex.destroy(true); this.metroTex.destroy(true); this.planeTex.destroy(true); this.shipTex.destroy(true);
    this.busTex = this.makeVehicleTexture(11, 3.2, false);
    this.metroTex = this.makeVehicleTexture(30, 3.6, true);
    this.planeTex = this.makePlaneTexture();
    this.shipTex = this.makeShipTexture();
    for (const [, sp] of this.vehicleSprites) { sp.body.destroy(); sp.full.destroy(); }
    this.vehicleSprites.clear();
    this.overlayTimer = 9;
    this.drawNetwork();
  }

  // ───────────── líneas y paradas (cambian solo al editar) ─────────────
  drawNetwork(): void {
    const g = this.linesG;
    g.clear();
    const net = this.game.net;
    const lines = [...net.lines.values()];
    // las líneas que comparten calle se separan un poco para que se vean todas
    const offsets = new Map<number, number>();
    lines.forEach((l, i) => offsets.set(l.id, (i % 3) - 1));
    this.drawnZoom = this.world.zoom;
    const k = this.k;
    for (const line of lines) {
      const dim = this.highlight && this.highlight !== line;
      const w = LINE_WIDTH[line.mode] * k;
      const off = (offsets.get(line.id) ?? 0) * (w * 0.55);
      const segs = line.fwd;
      const draw = (width: number, color: number, alpha: number) => {
        for (const s of segs) {
          const pts = offsetPolyline(s.pts, off);
          g.moveTo(pts[0].x, pts[0].y);
          for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
        }
        g.stroke({ color, width, alpha, cap: 'round', join: 'round' });
      };
      if (!segs.length) continue;
      draw(w + 2.4, this.casing, dim ? 0.3 : 0.9);
      draw(w, line.color, dim ? 0.3 : 0.95);
      if (line.mode === 'metro') draw(w * 0.28, 0xffffff, dim ? 0.1 : 0.4);
    }
    // puntos de paso de la línea resaltada
    const hl = this.highlight;
    if (hl) {
      const k = this.k;
      for (const list of hl.vias) for (const v of list ?? []) g.circle(v.x, v.y, 4.5 * k).fill(0xffffff).stroke({ color: hl.color, width: 2 * k });
    }
    this.drawStops();
  }

  /** Previsualiza el tramo mientras se arrastra un punto de paso. */
  previewVias(target: Graphics, line: Line, seg: number, vias: Pt[], active: number): void {
    target.clear();
    const n = line.stops.length;
    const a = this.game.net.stops.get(line.stops[seg]), b = this.game.net.stops.get(line.stops[(seg + 1) % n]);
    if (!a || !b) return;
    const k = this.k;
    const pts = [{ x: a.x, y: a.y }, ...vias, { x: b.x, y: b.y }];
    target.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) target.lineTo(pts[i].x, pts[i].y);
    target.stroke({ color: line.color, width: LINE_WIDTH[line.mode] * k, alpha: 0.55, cap: 'round', join: 'round' });
    vias.forEach((v, i) => target.circle(v.x, v.y, (i === active ? 6 : 4.5) * k).fill(0xffffff).stroke({ color: line.color, width: 2 * k }));
  }

  private drawStops(): void {
    const g = this.stopsG;
    g.clear();
    for (const s of this.game.net.stops.values()) this.drawStop(g, s, 1);
  }

  drawStop(g: Graphics, s: Stop, alpha: number): void {
    const colors = s.lines.map(id => this.game.net.lines.get(id)?.color ?? this.ink);
    const k = this.k;
    const ink = this.ink;
    if (s.mode === 'metro' || s.mode === 'hub') {
      const r = (6 + Math.min(3, colors.length)) * k;
      g.circle(s.x, s.y, r + 1.5 * k).fill({ color: 0xffffff, alpha: 0.6 * alpha });
      g.circle(s.x, s.y, r).fill({ color: 0xffffff, alpha }).stroke({ color: ink, width: 2 * k, alpha });
      if (colors.length) {
        const step = (Math.PI * 2) / colors.length;
        colors.forEach((c, i) => { g.moveTo(s.x, s.y); g.arc(s.x, s.y, r * 0.62, i * step - Math.PI / 2, (i + 1) * step - Math.PI / 2); g.fill({ color: c, alpha }); });
      }
      g.rect(s.x - 1.1 * k, s.y - r * 0.5, 2.2 * k, r).fill({ color: colors.length ? 0xffffff : ink, alpha: alpha * 0.9 });
    } else {
      // marquesina: rectángulo con una franja por cada línea que pasa
      const w = 9 * k, h = 6.4 * k;
      g.roundRect(s.x - w / 2 - k, s.y - h / 2 - k, w + 2 * k, h + 2 * k, 2.5 * k).fill({ color: 0xffffff, alpha: 0.6 * alpha });
      g.roundRect(s.x - w / 2, s.y - h / 2, w, h, 1.5 * k).fill({ color: this.stopFill, alpha }).stroke({ color: ink, width: 1.1 * k, alpha });
      if (colors.length) {
        const sw = w / colors.length;
        colors.forEach((c, i) => g.rect(s.x - w / 2 + i * sw + 0.6 * k, s.y - 1.5 * k, Math.max(0.5, sw - 1.2 * k), 3 * k).fill({ color: c, alpha }));
      }
    }
  }

  /** Vuelve a dibujar la capa activa en el siguiente frame. */
  refreshOverlay(): void { this.overlayTimer = 9; }

  // ───────────── por frame ─────────────
  update(dt: number, now: number): void {
    const z = this.world.zoom;
    if (this.drawnZoom > 0 && Math.abs(z - this.drawnZoom) / this.drawnZoom > 0.2) this.drawNetwork();
    this.drawQueues();
    this.updateVehicles();
    this.drawMarkers(now);
    this.overlayTimer += dt;
    if (this.overlay !== this.drawnOverlay) { this.overlayTimer = 9; this.drawnOverlay = this.overlay; this.hexG.clear(); for (const l of this.hexLabels.values()) l.visible = false; }
    if (this.overlayTimer > 1) {
      this.overlayTimer = 0;
      if (this.overlay === 'hexDemand' || this.overlay === 'hexPop') this.drawHexes(this.overlay);
    }
    if (this.overlay === 'hexDemand' || this.overlay === 'hexPop') {
      const sc = Math.max(0.5, 1 / z);
      const show = this.game.demand.hexR * z * 1.7 > 34;
      for (const l of this.hexLabels.values()) { if (l.visible) l.scale.set(sc); l.renderable = show; }
    }
  }

  // ───────────── capa: hexágonos ─────────────
  private drawHexes(mode: 'hexDemand' | 'hexPop'): void {
    const g = this.hexG;
    g.clear();
    const dm = this.game.demand;
    let max = 0;
    for (const h of dm.hexes.values()) { const v = mode === 'hexPop' ? h.residents + h.jobs : h.unserved; if (v > max) max = v; }
    if (!max) { for (const l of this.hexLabels.values()) l.visible = false; return; }
    const seen = new Set<number>();
    for (const [key, h] of dm.hexes) {
      const v = mode === 'hexPop' ? h.residents + h.jobs : h.unserved;
      if (v < (mode === 'hexPop' ? 20 : 0.5)) continue;
      seen.add(key);
      const t = Math.sqrt(v / max);
      const c = dm.hexCorners(h);
      g.poly(c.map(p => [p.x, p.y]).flat(), true);
      if (mode === 'hexPop') g.fill({ color: lerpColor(0x8fb5e6, 0x1f4e9c, t), alpha: 0.1 + 0.4 * t });
      else g.fill({ color: lerpColor(0xf3b9a8, 0xc62828, t), alpha: 0.12 + 0.38 * t });
      g.stroke({ color: 0xffffff, width: 1.2, alpha: 0.6 });
      let label = this.hexLabels.get(key);
      if (!label) { label = new Text({ text: '', style: { ...LABEL_STYLE, fill: this.ink } }); label.anchor.set(0.5); this.hexLayer.addChild(label); this.hexLabels.set(key, label); }
      const people = mode === 'hexPop' ? Math.round(h.residents + h.jobs) : Math.round(h.unserved * PEOPLE_PER_PASSENGER);
      label.text = people >= 1000 ? `${(people / 1000).toFixed(people >= 10000 ? 0 : 1)}k` : String(people);
      label.position.set(h.x, h.y);
      label.visible = true;
    }
    for (const [key, l] of this.hexLabels) if (!seen.has(key)) l.visible = false;
  }

  private drawQueues(): void {
    const g = this.queuesG;
    g.clear();
    const zoom = this.world.zoom;
    const k = this.k;
    const r = Math.max(1.4, 2.4 / zoom);
    for (const s of this.game.net.stops.values()) {
      const n = s.queue.length;
      let label = this.labels.get(s.id);
      if (n > 18) {
        if (!label) { label = new Text({ text: '', style: { fontFamily: 'Rubik Variable, system-ui, sans-serif', fontSize: 11, fontWeight: '800', fill: this.ink } }); label.anchor.set(0, 0.5); this.labelLayer.addChild(label); this.labels.set(s.id, label); }
        label.text = String(n);
        label.position.set(s.x + 9 * k, s.y - 6 * k);
        label.scale.set(Math.max(0.5, 1 / zoom));
        label.visible = true;
      } else if (label) label.visible = false;
      const shown = Math.min(n, 18);
      const D = this.game.demand.districts.list;
      for (let i = 0; i < shown; i++) {
        const col = i % 6, row = Math.floor(i / 6);
        const x = s.x + 8 * k + col * (r * 2.3), y = s.y + 5 * k - row * (r * 2.3);
        // cada viajero lleva el color del barrio al que va
        g.circle(x, y, r).fill(D[s.queue[i].dest]?.color ?? this.ink).stroke({ color: this.ink, width: Math.max(0.4, r * 0.3), alpha: 0.8 });
      }
      if (s.frustrated > 0.5) g.circle(s.x, s.y, (9 + s.frustrated * 0.6) * k).stroke({ color: 0xd23b33, width: 1.5 * k, alpha: Math.min(0.8, s.frustrated * 0.15) });
    }
    for (const [id, l] of this.labels) if (!this.game.net.stops.has(id)) { l.destroy(); this.labels.delete(id); }
  }

  private makeVehicleTexture(len: number, wid: number, train: boolean): Texture {
    const S = 8;
    const c = document.createElement('canvas');
    c.width = Math.ceil(len * S) + 4; c.height = Math.ceil(wid * S) + 4;
    const ctx = c.getContext('2d')!;
    ctx.translate(2, 2);
    const ink = '#' + this.ink.toString(16).padStart(6, '0');
    ctx.fillStyle = '#ffffff'; ctx.strokeStyle = ink; ctx.lineWidth = 2; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.roundRect(0, 0, len * S, wid * S, train ? 4 : 6); ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(40,45,60,.7)';
    if (train) {
      for (let i = 0; i < 3; i++) { ctx.fillRect((i * len / 3 + 1.2) * S, 0.6 * S, (len / 3 - 2.4) * S, 0.8 * S); }
      ctx.strokeStyle = ink; ctx.globalAlpha = 0.5; ctx.lineWidth = 1.5;
      for (let i = 1; i < 3; i++) { ctx.beginPath(); ctx.moveTo((i * len / 3) * S, 0); ctx.lineTo((i * len / 3) * S, wid * S); ctx.stroke(); }
      ctx.globalAlpha = 1;
    } else {
      ctx.fillRect(1.5 * S, 0.5 * S, (len - 3) * S, 0.8 * S);
      ctx.fillRect((len - 1.4) * S, 0.5 * S, 0.9 * S, (wid - 1) * S);
    }
    ctx.fillStyle = 'rgba(0,0,0,.15)'; ctx.fillRect(0, (wid - 0.6) * S, len * S, 0.6 * S);
    return Texture.from(c);
  }

  private texFor(mode: Mode): Texture {
    return mode === 'bus' ? this.busTex : mode === 'plane' ? this.planeTex : mode === 'ship' ? this.shipTex : this.metroTex;
  }

  /** Avión visto desde arriba (apunta a +x). */
  private makePlaneTexture(): Texture {
    const S = 8, len = 16, wid = 14;
    const c = document.createElement('canvas');
    c.width = len * S + 4; c.height = wid * S + 4;
    const ctx = c.getContext('2d')!;
    ctx.translate(2, 2);
    const ink = '#' + this.ink.toString(16).padStart(6, '0');
    ctx.fillStyle = '#ffffff'; ctx.strokeStyle = ink; ctx.lineWidth = 2; ctx.lineJoin = 'round';
    const P = (pts: number[][]) => { ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x * S, y * S) : ctx.moveTo(x * S, y * S))); ctx.closePath(); ctx.fill(); ctx.stroke(); };
    // alas, cola y fuselaje
    P([[6, 7], [9, 0.5], [10.5, 0.5], [9.5, 7], [10.5, 13.5], [9, 13.5]]);
    P([[1, 7], [0.5, 4], [2, 4], [3.5, 7], [2, 10], [0.5, 10]]);
    P([[0.5, 6], [14, 5.5], [16, 7], [14, 8.5], [0.5, 8]]);
    return Texture.from(c);
  }

  /** Barco visto desde arriba (proa a +x). */
  private makeShipTexture(): Texture {
    const S = 8, len = 22, wid = 6;
    const c = document.createElement('canvas');
    c.width = len * S + 4; c.height = wid * S + 4;
    const ctx = c.getContext('2d')!;
    ctx.translate(2, 2);
    const ink = '#' + this.ink.toString(16).padStart(6, '0');
    ctx.fillStyle = '#ffffff'; ctx.strokeStyle = ink; ctx.lineWidth = 2; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(0, 0.5 * S); ctx.lineTo(16 * S, 0.5 * S); ctx.quadraticCurveTo(22 * S, 3 * S, 16 * S, 5.5 * S); ctx.lineTo(0, 5.5 * S); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(40,45,60,.7)'; ctx.fillRect(3 * S, 1.6 * S, 9 * S, 2.8 * S);
    return Texture.from(c);
  }

  private makeDotTexture(): Texture {
    const c = document.createElement('canvas'); c.width = c.height = 16;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#e88a82'; ctx.strokeStyle = '#2a2522'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(8, 8, 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    return Texture.from(c);
  }

  private updateVehicles(): void {
    const seen = new Set<Vehicle>();
    const zoom = this.world.zoom;
    // los vehículos nunca bajan de ~24 px de largo (bus) para que se vean al alejar la cámara
    const grow = Math.max(1, 2.2 / zoom);
    for (const line of this.game.net.lines.values()) {
      for (const v of line.vehicles) {
        seen.add(v);
        let sp = this.vehicleSprites.get(v);
        if (!sp) {
          const body = new Sprite(this.texFor(line.mode));
          body.anchor.set(0.5);
          const full = new Sprite(this.dotTex); full.anchor.set(0.5); full.visible = false;
          this.world.vehicles.addChild(body, full);
          sp = { body, full };
          this.vehicleSprites.set(v, sp);
        }
        if (sp.body.texture !== this.texFor(line.mode)) sp.body.texture = this.texFor(line.mode);
        sp.body.position.set(v.x, v.y);
        sp.body.rotation = v.angle;
        sp.body.tint = line.color;
        sp.body.scale.set(grow / 8);
        sp.body.alpha = this.highlight && this.highlight !== line ? 0.45 : 1;
        const cap = MODE[line.mode].capacity;
        const fullness = v.passengers.length / cap;
        sp.full.visible = fullness >= 0.9;
        sp.full.position.set(v.x, v.y - 5 * grow);
        sp.full.scale.set(0.4 * grow);
      }
    }
    for (const [v, sp] of this.vehicleSprites) if (!seen.has(v)) { sp.body.destroy(); sp.full.destroy(); this.vehicleSprites.delete(v); }
  }

  private drawMarkers(now: number): void {
    const g = this.markersG;
    g.clear();
    const zoom = this.world.zoom;
    const r = Math.max(2.2, 3 / zoom);
    for (const u of this.game.demand.unserved) {
      const age = (now - u.t) / 25;
      const a = Math.max(0, 1 - age);
      const color = u.reason === 'route' ? 0xf0bf3c : u.reason === 'fare' ? 0x8e5bb5 : 0xe88a82;
      g.circle(u.x, u.y - (1 - a) * 6, r).fill({ color, alpha: a * 0.9 });
    }
  }

  // ───────────── previsualizaciones ─────────────
  previewStop(target: Graphics, mode: Mode, x: number, y: number, ok: boolean): void {
    target.clear();
    const def = MODE[mode];
    target.circle(x, y, def.walk).fill({ color: ok ? 0x7fc47c : 0xd23b33, alpha: 0.07 }).stroke({ color: ok ? 0x7fa85e : 0xd23b33, width: 1.2, alpha: 0.55 });
    const fake: Stop = { id: 0, mode, x, y, rx: x, ry: y, node: -1, name: '', lines: [], queue: [], frustrated: 0 };
    this.drawStop(target, fake, ok ? 0.9 : 0.5);
  }

  previewLineExtension(target: Graphics, line: Line, cursor: Pt, hover: Stop | undefined): void {
    target.clear();
    if (!line.stops.length) {
      if (hover) target.circle(hover.x, hover.y, 11 * this.k).stroke({ color: line.color, width: 2.5 * this.k });
      return;
    }
    const last = this.game.net.stops.get(line.stops[line.stops.length - 1])!;
    const to = hover ?? cursor;
    const valid = !hover || (hover.mode === line.mode && (!line.stops.includes(hover.id) || (hover.id === line.stops[0] && line.stops.length >= 3)));
    const k = this.k;
    target.moveTo(last.x, last.y).lineTo(to.x, to.y).stroke({ color: valid ? line.color : 0xd23b33, width: LINE_WIDTH[line.mode] * k, alpha: 0.6, cap: 'round' });
    if (hover) target.circle(hover.x, hover.y, 11 * k).stroke({ color: valid ? line.color : 0xd23b33, width: 2.5 * k });
    for (const sid of line.stops) { const s = this.game.net.stops.get(sid)!; target.circle(s.x, s.y, 10 * k).stroke({ color: line.color, width: 1.5 * k, alpha: 0.7 }); }
  }
}

function lerpColor(a: number, b: number, t: number): number {
  t = Math.max(0, Math.min(1, t));
  const ch = (sh: number) => Math.round(((a >> sh) & 255) + (((b >> sh) & 255) - ((a >> sh) & 255)) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/** Desplaza una polilínea lateralmente (para que varias líneas por la misma calle no se tapen). */
function offsetPolyline(pts: Pt[], off: number): Pt[] {
  if (!off || pts.length < 2) return pts;
  const out: Pt[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1;
    out.push({ x: pts[i].x - (dy / l) * off, y: pts[i].y + (dx / l) * off });
  }
  return out;
}
