// Dibuja la red de transporte: líneas, paradas con sus colas, vehículos y demanda sin cubrir.
import { Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import type { Pt } from '../data/types.ts';
import type { Game } from '../sim/game.ts';
import { MODE, type Line, type Mode, type Stop, type Vehicle } from '../sim/transit.ts';
import type { World } from './world.ts';
import { INK, STYLES, type MapStyle } from './palette.ts';

const LINE_WIDTH: Record<Mode, number> = { bus: 3.6, metro: 5.5 };

export class TransitRenderer {
  private linesG = new Graphics();
  private stopsG = new Graphics();
  private queuesG = new Graphics();
  private markersG = new Graphics();
  private heatG = new Graphics();
  private labels = new Map<number, Text>();
  private labelLayer = new Container();
  private vehicleSprites = new Map<Vehicle, { body: Sprite; full: Sprite }>();
  private busTex: Texture;
  private metroTex: Texture;
  private dotTex: Texture;
  /** Línea resaltada (en edición o seleccionada); las demás se atenúan. */
  highlight: Line | null = null;
  overlay: 'none' | 'demand' | 'population' = 'none';
  private heatTimer = 0;
  private drawnZoom = -1;
  private ink = INK;
  private casing = 0xffffff;
  private stopFill = 0xffffff;
  private populationG: Graphics | null = null;

  /** Factor para que paradas y líneas no desaparezcan al alejar la cámara (mínimo en píxeles). */
  private get k(): number { return Math.max(1, 1.5 / this.world.zoom); }

  constructor(private world: World, private game: Game) {
    world.lines.addChild(this.linesG);
    world.stops.addChild(this.stopsG, this.queuesG, this.labelLayer);
    world.markers.addChild(this.markersG);
    world.heat.addChild(this.heatG);
    this.busTex = this.makeVehicleTexture(11, 3.2, false);
    this.metroTex = this.makeVehicleTexture(30, 3.6, true);
    this.dotTex = this.makeDotTexture();
    game.on('network', () => this.drawNetwork());
  }

  /** Adapta tinta y contornos al estilo de mapa. */
  setStyle(style: MapStyle): void {
    const d = STYLES[style];
    this.ink = d.ink;
    this.casing = style === 'maqueta' ? INK : 0xffffff;
    this.stopFill = style === 'maqueta' ? 0xf7e8d2 : 0xffffff;
    this.busTex.destroy(true); this.metroTex.destroy(true);
    this.busTex = this.makeVehicleTexture(11, 3.2, false);
    this.metroTex = this.makeVehicleTexture(30, 3.6, true);
    for (const [, sp] of this.vehicleSprites) { sp.body.destroy(); sp.full.destroy(); }
    this.vehicleSprites.clear();
    this.populationG?.destroy(); this.populationG = null;
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
    if (s.mode === 'metro') {
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

  // ───────────── por frame ─────────────
  update(dt: number, now: number): void {
    const z = this.world.zoom;
    if (this.drawnZoom > 0 && Math.abs(z - this.drawnZoom) / this.drawnZoom > 0.2) this.drawNetwork();
    this.drawQueues();
    this.updateVehicles();
    this.drawMarkers(now);
    this.heatTimer += dt;
    if (this.overlay === 'demand' && this.heatTimer > 1) { this.heatTimer = 0; this.drawHeat(); }
    if (this.overlay !== 'demand') this.heatG.clear();
    if (this.overlay === 'population') { if (!this.populationG) this.drawPopulation(); this.populationG!.visible = true; }
    else if (this.populationG) this.populationG.visible = false;
  }

  private drawPopulation(): void {
    const g = new Graphics();
    for (const p of this.game.demand.populationPoints()) {
      const r = 2 + Math.sqrt(p.people) * 0.9;
      g.circle(p.x, p.y, r).fill({ color: 0x2f6fc4, alpha: Math.min(0.35, 0.06 + p.people / 600) });
    }
    this.world.heat.addChild(g);
    this.populationG = g;
  }

  private drawQueues(): void {
    const g = this.queuesG;
    g.clear();
    const zoom = this.world.zoom;
    const k = this.k;
    const r = Math.max(1.1, 1.6 / zoom);
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
      const crowded = n > 25;
      for (let i = 0; i < shown; i++) {
        const col = i % 6, row = Math.floor(i / 6);
        const x = s.x + 8 * k + col * (r * 2.4), y = s.y + 5 * k - row * (r * 2.4);
        g.circle(x, y, r).fill(crowded ? 0xd23b33 : this.ink);
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
    const grow = Math.max(1, 2.2 / (zoom * 3.2));
    for (const line of this.game.net.lines.values()) {
      for (const v of line.vehicles) {
        seen.add(v);
        let sp = this.vehicleSprites.get(v);
        if (!sp) {
          const body = new Sprite(line.mode === 'bus' ? this.busTex : this.metroTex);
          body.anchor.set(0.5);
          const full = new Sprite(this.dotTex); full.anchor.set(0.5); full.visible = false;
          this.world.vehicles.addChild(body, full);
          sp = { body, full };
          this.vehicleSprites.set(v, sp);
        }
        if (sp.body.texture !== (line.mode === 'bus' ? this.busTex : this.metroTex)) sp.body.texture = line.mode === 'bus' ? this.busTex : this.metroTex;
        sp.body.position.set(v.x, v.y);
        sp.body.rotation = v.angle;
        sp.body.tint = line.color;
        sp.body.scale.set(grow / 8);
        sp.body.alpha = this.highlight && this.highlight !== line ? 0.45 : 1;
        const cap = MODE[line.mode].capacity;
        const fullness = v.passengers.length / cap;
        sp.full.visible = fullness >= 0.9;
        sp.full.position.set(v.x, v.y - 5 * grow);
        sp.full.scale.set((0.35 * grow) / 1);
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
      g.circle(u.x, u.y - (1 - a) * 6, r).fill({ color, alpha: a * 0.9 }).stroke({ color: this.ink, width: 0.6, alpha: a });
    }
  }

  private drawHeat(): void {
    const g = this.heatG;
    g.clear();
    const pts = this.game.demand.heatPoints(this.game.data);
    for (const p of pts) {
      const v = Math.min(1, p.v / 6);
      g.circle(p.x, p.y, 25 + v * 40).fill({ color: 0xd23b33, alpha: 0.08 + v * 0.25 });
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
