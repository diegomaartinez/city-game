// Proyección y utilidades geométricas. El mundo del juego está en metros, con el
// origen en el centro de la ciudad, x hacia el este e y hacia el sur (pantalla).
import type { Pt } from './types.ts';

const M_PER_DEG_LAT = 110574;
const M_PER_DEG_LON_EQ = 111320;

export class Projection {
  private readonly kx: number;
  constructor(public readonly lat0: number, public readonly lon0: number) {
    this.kx = M_PER_DEG_LON_EQ * Math.cos((lat0 * Math.PI) / 180);
  }
  toXY(lat: number, lon: number): Pt {
    return { x: (lon - this.lon0) * this.kx, y: -(lat - this.lat0) * M_PER_DEG_LAT };
  }
  toLatLon(p: Pt): { lat: number; lon: number } {
    return { lat: this.lat0 - p.y / M_PER_DEG_LAT, lon: this.lon0 + p.x / this.kx };
  }
}

export function polygonArea(poly: Pt[]): number {
  let a = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const p = poly[i], q = poly[(i + 1) % n];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

export function centroid(poly: Pt[]): Pt {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const p = poly[i], q = poly[(i + 1) % n];
    const f = p.x * q.y - q.x * p.y;
    a += f; cx += (p.x + q.x) * f; cy += (p.y + q.y) * f;
  }
  if (Math.abs(a) < 1e-9) {
    // degenerado: media de puntos
    let sx = 0, sy = 0;
    for (const p of poly) { sx += p.x; sy += p.y; }
    return { x: sx / poly.length, y: sy / poly.length };
  }
  return { x: cx / (3 * a), y: cy / (3 * a) };
}

export function bbox(poly: Pt[]): [number, number, number, number] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of poly) {
    if (p.x < x0) x0 = p.x; if (p.y < y0) y0 = p.y;
    if (p.x > x1) x1 = p.x; if (p.y > y1) y1 = p.y;
  }
  return [x0, y0, x1, y1];
}

export function pointInPoly(x: number, y: number, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function dist(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Distancia de un punto al segmento ab y parámetro t del punto más cercano. */
export function pointSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): { d: number; t: number } {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  const qx = ax + t * dx, qy = ay + t * dy;
  return { d: Math.hypot(px - qx, py - qy), t };
}

/** Generador pseudoaleatorio determinista (mulberry32). */
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashInt(n: number): number {
  let x = (n ^ 0x9e3779b9) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0;
  return (x ^ (x >>> 16)) >>> 0;
}

/** Rectángulo orientado (centro, tamaño, ángulo) como polígono. */
export function orientedRect(cx: number, cy: number, w: number, h: number, angle: number): Pt[] {
  const c = Math.cos(angle), s = Math.sin(angle);
  const hw = w / 2, hh = h / 2;
  const corners = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]];
  return corners.map(([x, y]) => ({ x: cx + x * c - y * s, y: cy + x * s + y * c }));
}
