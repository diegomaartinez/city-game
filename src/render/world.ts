// Escena Pixi: capas del mundo, cámara (desplazar y ampliar) y utilidades de coordenadas.
import { Application, Container, Graphics } from 'pixi.js';
import type { Pt } from '../data/types.ts';
import { rng } from '../data/geo.ts';
import { SAND, SAND_DARK, SAND_LIGHT } from './palette.ts';

export class World {
  readonly app = new Application();
  readonly root = new Container();
  readonly ground = new Graphics();
  readonly areas = new Container();
  readonly zones = new Container();
  readonly roads = new Container();
  readonly traffic = new Container();
  readonly shadows = new Container();
  readonly buildings = new Container();
  readonly services = new Container();
  readonly cars = new Container();
  readonly overlay = new Container();
  zoom = 0.4;
  minZoom = 0.06;
  maxZoom = 8;

  async init(parent: HTMLElement): Promise<void> {
    await this.app.init({ background: SAND, resizeTo: window, antialias: true, resolution: Math.min(2, window.devicePixelRatio || 1), autoDensity: true, preference: 'webgl' });
    parent.appendChild(this.app.canvas);
    this.app.canvas.id = 'world';
    this.root.addChild(this.ground, this.areas, this.zones, this.roads, this.shadows, this.traffic, this.buildings, this.services, this.cars, this.overlay);
    this.app.stage.addChild(this.root);
    this.app.canvas.style.touchAction = 'none';
  }

  drawGround(radius: number): void {
    const g = this.ground;
    g.clear();
    const half = radius + 600;
    g.rect(-half, -half, half * 2, half * 2).fill(SAND);
    const r = rng(7);
    for (let i = 0; i < 140; i++) {
      const x = (r() * 2 - 1) * half, y = (r() * 2 - 1) * half;
      const w = 40 + r() * 260, h = w * (0.4 + r() * 0.5);
      g.ellipse(x, y, w, h).fill({ color: r() < 0.7 ? SAND_LIGHT : SAND_DARK, alpha: 0.35 + r() * 0.3 });
    }
    // fuera del radio cargado la arena se oscurece un poco
    g.rect(-half, -half, half * 2, half * 2).fill({ color: SAND_DARK, alpha: 0.35 });
    g.circle(0, 0, radius).cut();
    g.circle(0, 0, radius).stroke({ color: SAND_DARK, width: 3, alpha: 0.7 });
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
    const lim = radius + 300;
    const cx = Math.max(-lim, Math.min(lim, c.x)), cy = Math.max(-lim, Math.min(lim, c.y));
    if (cx !== c.x || cy !== c.y) this.centerOn({ x: cx, y: cy });
  }
}
