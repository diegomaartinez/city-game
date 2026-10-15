// Rejilla de celdas sobre la ciudad: zonificación, ocupación y cobertura de servicios.
import type { Pt, ServiceKind } from '../data/types.ts';
import { bbox, pointInPoly, pointSegment } from '../data/geo.ts';

export const CELL = 12; // metros por celda

export const enum Zone { None = 0, R = 1, C = 2, I = 3 }
export const enum Kind { Free = 0, Road = 1, Building = 2, Water = 3, Park = 4, Service = 5 }

export const SERVICE_KINDS: ServiceKind[] = ['power', 'water', 'police', 'fire', 'health', 'school', 'park'];

export class Grid {
  readonly w: number;
  readonly h: number;
  /** Esquina superior izquierda del mundo cubierto por la rejilla (metros). */
  readonly x0: number;
  readonly y0: number;
  readonly zone: Uint8Array;
  readonly kind: Uint8Array;
  /** Id del edificio que ocupa la celda (0 = ninguno). */
  readonly building: Int32Array;
  /** Distancia en celdas a la calle más cercana (255 = lejos). */
  readonly roadDist: Uint8Array;
  /** Cobertura por servicio: número de equipamientos que alcanzan la celda. */
  readonly coverage: Record<ServiceKind, Uint8Array>;
  /** Id del tramo de calle que pasa por la celda (índice de arista, -1 si no). */
  readonly roadEdge: Int32Array;

  constructor(public readonly radius: number) {
    const half = radius + 200;
    this.x0 = -half; this.y0 = -half;
    this.w = Math.ceil((half * 2) / CELL);
    this.h = this.w;
    const n = this.w * this.h;
    this.zone = new Uint8Array(n);
    this.kind = new Uint8Array(n);
    this.building = new Int32Array(n);
    this.roadDist = new Uint8Array(n).fill(255);
    this.roadEdge = new Int32Array(n).fill(-1);
    this.coverage = {} as Record<ServiceKind, Uint8Array>;
    for (const k of SERVICE_KINDS) this.coverage[k] = new Uint8Array(n);
  }

  idx(cx: number, cy: number): number { return cy * this.w + cx; }
  inBounds(cx: number, cy: number): boolean { return cx >= 0 && cy >= 0 && cx < this.w && cy < this.h; }
  cellOf(x: number, y: number): [number, number] {
    return [Math.floor((x - this.x0) / CELL), Math.floor((y - this.y0) / CELL)];
  }
  /** Centro de la celda en metros. */
  center(cx: number, cy: number): Pt {
    return { x: this.x0 + (cx + 0.5) * CELL, y: this.y0 + (cy + 0.5) * CELL };
  }

  /** Celdas cuyo centro cae dentro del polígono (y si es muy pequeño, al menos la del centroide). */
  cellsInPoly(poly: Pt[], fallback?: Pt): number[] {
    const [bx0, by0, bx1, by1] = bbox(poly);
    const [c0, r0] = this.cellOf(bx0, by0);
    const [c1, r1] = this.cellOf(bx1, by1);
    const out: number[] = [];
    for (let cy = Math.max(0, r0); cy <= Math.min(this.h - 1, r1); cy++) {
      for (let cx = Math.max(0, c0); cx <= Math.min(this.w - 1, c1); cx++) {
        const c = this.center(cx, cy);
        if (pointInPoly(c.x, c.y, poly)) out.push(this.idx(cx, cy));
      }
    }
    if (!out.length && fallback) {
      const [cx, cy] = this.cellOf(fallback.x, fallback.y);
      if (this.inBounds(cx, cy)) out.push(this.idx(cx, cy));
    }
    return out;
  }

  /** Celdas a menos de `halfWidth` metros de la polilínea. */
  cellsAlong(pts: Pt[], halfWidth: number): number[] {
    const out = new Set<number>();
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i], b = pts[i + 1];
      const [c0, r0] = this.cellOf(Math.min(a.x, b.x) - halfWidth, Math.min(a.y, b.y) - halfWidth);
      const [c1, r1] = this.cellOf(Math.max(a.x, b.x) + halfWidth, Math.max(a.y, b.y) + halfWidth);
      for (let cy = Math.max(0, r0); cy <= Math.min(this.h - 1, r1); cy++) {
        for (let cx = Math.max(0, c0); cx <= Math.min(this.w - 1, c1); cx++) {
          const c = this.center(cx, cy);
          if (pointSegment(c.x, c.y, a.x, a.y, b.x, b.y).d <= halfWidth) out.add(this.idx(cx, cy));
        }
      }
    }
    return [...out];
  }

  /** Celdas dentro de un círculo. */
  cellsInCircle(x: number, y: number, r: number): number[] {
    const [c0, r0] = this.cellOf(x - r, y - r);
    const [c1, r1] = this.cellOf(x + r, y + r);
    const out: number[] = [];
    const r2 = r * r;
    for (let cy = Math.max(0, r0); cy <= Math.min(this.h - 1, r1); cy++) {
      for (let cx = Math.max(0, c0); cx <= Math.min(this.w - 1, c1); cx++) {
        const c = this.center(cx, cy);
        const dx = c.x - x, dy = c.y - y;
        if (dx * dx + dy * dy <= r2) out.push(this.idx(cx, cy));
      }
    }
    return out;
  }

  /** Recalcula la distancia a calle de todas las celdas (BFS desde las celdas de calle, hasta 3). */
  recomputeRoadDist(): void {
    const { w, h, kind, roadDist } = this;
    roadDist.fill(255);
    let frontier: number[] = [];
    for (let i = 0; i < kind.length; i++) if (kind[i] === Kind.Road) { roadDist[i] = 0; frontier.push(i); }
    for (let d = 1; d <= 3 && frontier.length; d++) {
      const next: number[] = [];
      for (const i of frontier) {
        const cx = i % w, cy = (i / w) | 0;
        if (cx > 0 && roadDist[i - 1] === 255) { roadDist[i - 1] = d; next.push(i - 1); }
        if (cx < w - 1 && roadDist[i + 1] === 255) { roadDist[i + 1] = d; next.push(i + 1); }
        if (cy > 0 && roadDist[i - w] === 255) { roadDist[i - w] = d; next.push(i - w); }
        if (cy < h - 1 && roadDist[i + w] === 255) { roadDist[i + w] = d; next.push(i + w); }
      }
      frontier = next;
    }
  }

  addCoverage(kind: ServiceKind, x: number, y: number, r: number, delta: 1 | -1): void {
    const cov = this.coverage[kind];
    for (const i of this.cellsInCircle(x, y, r)) {
      const v = cov[i] + delta;
      cov[i] = v < 0 ? 0 : v > 250 ? 250 : v;
    }
  }
}
