// Escena Pixi: capas del mundo, cámara (desplazar y ampliar) y utilidades de coordenadas.
import { Application, Container, Graphics } from 'pixi.js';
import type { Pt } from '../data/types.ts';
import { rng } from '../data/geo.ts';
import { MARGIN } from '../data/types.ts';


export class World {
  readonly app = new Application();
  readonly root = new Container();
  /** Todo lo jugable va dentro de la "isla": un cuadrado recortado que flota sobre el fondo. */
  readonly island = new Container();
  private islandMask = new Graphics();
  private islandShadow = new Graphics();
  readonly ground = new Graphics();
  readonly areas = new Container();
  readonly roads = new Container();
  readonly buildings = new Container();
  readonly heat = new Container();
  readonly lines = new Container();
  readonly stops = new Container();
  readonly vehicles = new Container();
  readonly markers = new Container();
  readonly overlay = new Container();
  zoom = 0.4;
  minZoom = 0.06;
  maxZoom = 8;

  async init(parent: HTMLElement): Promise<void> {
    await this.app.init({ background: 0xe8b98c, resizeTo: window, antialias: true, resolution: Math.min(2, window.devicePixelRatio || 1), autoDensity: true, preference: 'webgl' });
    parent.appendChild(this.app.canvas);
    this.app.canvas.id = 'world';
    this.island.addChild(this.ground, this.areas, this.roads, this.buildings, this.heat, this.lines, this.stops, this.vehicles, this.markers);
    this.island.mask = this.islandMask;
    this.root.addChild(this.islandShadow, this.islandMask, this.island, this.overlay);
    this.app.stage.addChild(this.root);
    this.app.canvas.style.touchAction = 'none';
  }

  /** Mitad del ancho y del alto del rectángulo jugable (la isla). */
  half = 0;
  halfW = 0;
  halfH = 0;

  drawGround(radius: number, bg: number, patches: [number, number] | null, backdrop: number, halfW = radius, halfH = radius, island = true): void {
    const g = this.ground;
    g.clear();
    this.app.renderer.background.color = backdrop;
    const half = radius + MARGIN;
    this.half = half;
    this.halfW = halfW + MARGIN; this.halfH = halfH + MARGIN;
    const W = this.halfW, H = this.halfH;
    g.rect(-W, -H, W * 2, H * 2).fill(bg);
    if (patches) {
      const r = rng(7);
      for (let i = 0; i < 140; i++) {
        const x = (r() * 2 - 1) * W, y = (r() * 2 - 1) * H;
        const w = 40 + r() * 260, h = w * (0.4 + r() * 0.5);
        g.ellipse(x, y, w, h).fill({ color: r() < 0.7 ? patches[0] : patches[1], alpha: 0.35 + r() * 0.3 });
      }
    }
    this.islandMask.clear();
    this.islandMask.rect(-W, -H, W * 2, H * 2).fill(0xffffff);
    // sombra suave bajo la isla
    const sh = this.islandShadow;
    sh.clear();
    const d = Math.max(10, Math.max(W, H) * 0.012);
    if (island) {
      sh.rect(-W + d * 0.6, -H + d, W * 2, H * 2).fill({ color: 0x000000, alpha: 0.10 });
      sh.rect(-W + d * 1.4, -H + d * 2.2, W * 2, H * 2).fill({ color: 0x000000, alpha: 0.05 });
    }
    // el borde jugable siempre se marca, aunque sea con un filo fino sobre el mar
    sh.rect(-W, -H, W * 2, H * 2).stroke({ color: 0xffffff, width: Math.max(2, Math.max(W, H) * 0.002), alpha: island ? 0.7 : 0.45 });
  }

  get width(): number { return this.app.renderer.width / this.app.renderer.resolution; }
  get height(): number { return this.app.renderer.height / this.app.renderer.resolution; }

  toWorld(sx: number, sy: number): Pt {
    return { x: (sx - this.root.x) / this.zoom, y: (sy - this.root.y) / this.zoom };
  }
  toScreen(p: Pt): Pt {
    return { x: p.x * this.zoom + this.root.x, y: p.y * this.zoom + this.root.y };
  }

  centerOn(p: Pt, zoom?: number): void {
    if (zoom !== undefined) this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, zoom));
    this.root.scale.set(this.zoom);
    this.root.position.set(this.width / 2 - p.x * this.zoom, this.height / 2 - p.y * this.zoom);
  }

  panBy(dx: number, dy: number): void {
    this.root.x += dx; this.root.y += dy;
  }

  /** Amplía alrededor de un punto de pantalla. */
  zoomAt(sx: number, sy: number, factor: number): void {
    const before = this.toWorld(sx, sy);
    this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom * factor));
    this.root.scale.set(this.zoom);
    const after = this.toScreen(before);
    this.root.x += sx - after.x; this.root.y += sy - after.y;
  }

  /** Limita la cámara para no perderse lejos de la ciudad. */
  clamp(radius: number): void {
    const c = this.toWorld(this.width / 2, this.height / 2);
    const lw = this.halfW || radius + MARGIN, lh = this.halfH || radius + MARGIN;
    const cx = Math.max(-lw, Math.min(lw, c.x)), cy = Math.max(-lh, Math.min(lh, c.y));
    if (cx !== c.x || cy !== c.y) this.centerOn({ x: cx, y: cy });
  }
}
