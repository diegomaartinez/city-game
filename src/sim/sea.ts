// Rejilla de mar para que los barcos bordeen la costa solos: cada celda sabe si es tierra o agua
// (se calcula al construir el nivel) y las rutas se buscan con A* y se suavizan después.
import type { Pt } from '../data/types.ts';
import { pointInPoly } from '../data/geo.ts';

export interface SeaGridData { cell: number; x0: number; y0: number; cols: number; rows: number; /** Bits de tierra, en base64, fila a fila. */ land: string }

export class SeaGrid {
  readonly cell: number;
  readonly x0: number;
  readonly y0: number;
  readonly cols: number;
  readonly rows: number;
  private land: Uint8Array;

  constructor(d: SeaGridData) {
    this.cell = d.cell; this.x0 = d.x0; this.y0 = d.y0; this.cols = d.cols; this.rows = d.rows;
    const bin = atob(d.land); // disponible en navegadores y en Node ≥ 16
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    this.land = new Uint8Array(this.cols * this.rows);
    for (let i = 0; i < this.land.length; i++) this.land[i] = (bytes[i >> 3] >> (i & 7)) & 1;
    this.label();
  }

  /** Componentes conexas del mar; la mayor es el mar abierto (las rías y estuarios cerrados son bolsas aparte). */
  private comp!: Int32Array;
  private mainComp = 0;
  private label(): void {
    const N = this.cols * this.rows;
    this.comp = new Int32Array(N).fill(-1);
    const sizes: number[] = [];
    const stack: number[] = [];
    for (let i = 0; i < N; i++) {
      if (this.land[i] || this.comp[i] >= 0) continue;
      const id = sizes.length; sizes.push(0);
      stack.push(i); this.comp[i] = id;
      while (stack.length) {
        const n = stack.pop()!; sizes[id]++;
        const c = n % this.cols, r = (n / this.cols) | 0;
        for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nc = c + dc, nr = r + dr;
          if (nc < 0 || nr < 0 || nc >= this.cols || nr >= this.rows) continue;
          const m = nr * this.cols + nc;
          if (!this.land[m] && this.comp[m] < 0) { this.comp[m] = id; stack.push(m); }
        }
      }
    }
    this.mainComp = sizes.indexOf(Math.max(...sizes, 0));
  }

  /** Calcula la rejilla a partir de los polígonos de tierra (al construir el nivel). */
  static build(polys: Pt[][], x0: number, y0: number, x1: number, y1: number, cell: number): SeaGridData {
    const cols = Math.ceil((x1 - x0) / cell), rows = Math.ceil((y1 - y0) / cell);
    const bytes = new Uint8Array(Math.ceil((cols * rows) / 8));
    // cajas de cada polígono para descartar rápido
    const boxes = polys.map(p => { let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity; for (const q of p) { if (q.x < a) a = q.x; if (q.y < b) b = q.y; if (q.x > c) c = q.x; if (q.y > d) d = q.y; } return [a, b, c, d]; });
    const inLand = (x: number, y: number) => { for (let i = 0; i < polys.length; i++) { const [a, b, cc, d] = boxes[i]; if (x >= a && x <= cc && y >= b && y <= d && pointInPoly(x, y, polys[i])) return true; } return false; };
    // una celda es tierra si lo es su centro o cualquiera de sus cuartos: los barcos se mantienen algo alejados de la costa
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const x = x0 + (c + 0.5) * cell, y = y0 + (r + 0.5) * cell, q = cell / 4;
      const onLand = inLand(x, y) || inLand(x - q, y - q) || inLand(x + q, y - q) || inLand(x - q, y + q) || inLand(x + q, y + q);
      if (onLand) { const k = r * cols + c; bytes[k >> 3] |= 1 << (k & 7); }
    }
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    const land = btoa(bin);
    return { cell, x0, y0, cols, rows, land };
  }

  isLand(x: number, y: number): boolean {
    const c = Math.floor((x - this.x0) / this.cell), r = Math.floor((y - this.y0) / this.cell);
    if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return false;
    return this.land[r * this.cols + c] === 1;
  }

  /** ¿Cruza tierra un tramo recto? (muestreo a media celda, saltando las orillas de los extremos) */
  crosses(a: Pt, b: Pt, margin = 0): boolean {
    const len = Math.hypot(b.x - a.x, b.y - a.y), step = this.cell / 4;
    for (let d = margin; d <= len - margin; d += step) {
      const t = len ? d / len : 0;
      if (this.isLand(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)) return true;
    }
    return false;
  }

  /** Ruta por el mar entre dos puntos (los extremos pueden estar en tierra: puertos). Null si no hay forma. */
  route(a: Pt, b: Pt): Pt[] | null {
    const toCell = (p: Pt) => [Math.max(0, Math.min(this.cols - 1, Math.floor((p.x - this.x0) / this.cell))), Math.max(0, Math.min(this.rows - 1, Math.floor((p.y - this.y0) / this.cell)))] as const;
    const [ca, ra] = toCell(a), [cb, rb] = toCell(b);
    // varias celdas de mar candidatas por extremo: la más cercana puede ser una ría o un estuario cerrado
    const starts = this.nearestSea(ca, ra), goals = this.nearestSea(cb, rb);
    for (const start of starts) for (const goal of goals) {
      const cells = this.astar(start, goal);
      if (cells) return this.smooth([a, ...cells, b]);
    }
    return null;
  }

  private astar(start: number, goal: number): Pt[] | null {
    const N = this.cols * this.rows;
    const g = new Float64Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1);
    const closed = new Uint8Array(N);
    const gc = goal % this.cols, gr = (goal / this.cols) | 0;
    const h = (i: number) => { const c = i % this.cols, r = (i / this.cols) | 0; return Math.hypot(c - gc, r - gr); };
    const open: Array<[number, number]> = [[h(start), start]];
    g[start] = 0;
    const dirs = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
    let found = false, expanded = 0;
    while (open.length) {
      let bi = 0;
      for (let i = 1; i < open.length; i++) if (open[i][0] < open[bi][0]) bi = i;
      const [, n] = open[bi]; open[bi] = open[open.length - 1]; open.pop();
      if (closed[n]) continue;
      closed[n] = 1;
      if (n === goal) { found = true; break; }
      if (++expanded > 80000) break;
      const c = n % this.cols, r = (n / this.cols) | 0;
      for (const [dc, dr, w] of dirs) {
        const nc = c + dc, nr = r + dr;
        if (nc < 0 || nr < 0 || nc >= this.cols || nr >= this.rows) continue;
        const m = nr * this.cols + nc;
        if (this.land[m] || closed[m]) continue;
        // en diagonal no se cortan esquinas de tierra
        if (dc && dr && (this.land[r * this.cols + nc] || this.land[nr * this.cols + c])) continue;
        const ng = g[n] + w;
        if (ng < g[m]) { g[m] = ng; prev[m] = n; open.push([ng + h(m), m]); }
      }
    }
    if (!found) return null;
    const cells: Pt[] = [];
    for (let n = goal; n >= 0; n = prev[n]) cells.push({ x: this.x0 + ((n % this.cols) + 0.5) * this.cell, y: this.y0 + (((n / this.cols) | 0) + 0.5) * this.cell });
    return cells.reverse();
  }

  /** Celdas de mar más cercanas a una celda (para puertos, que están en tierra), de cerca a lejos. */
  private nearestSea(c: number, r: number, max = 6): number[] {
    const out: Array<[number, number]> = [];
    for (let d = 0; d < 20 && out.length < max * 3; d++) for (let dr = -d; dr <= d; dr++) for (let dc = -d; dc <= d; dc++) {
      if (Math.max(Math.abs(dr), Math.abs(dc)) !== d) continue;
      const nc = c + dc, nr = r + dr;
      if (nc < 0 || nr < 0 || nc >= this.cols || nr >= this.rows) continue;
      const m = nr * this.cols + nc;
      // solo mar abierto: una bolsa cerrada (estuario) no lleva a ninguna parte
      if (!this.land[m] && this.comp[m] === this.mainComp) out.push([Math.hypot(dc, dr), m]);
    }
    return out.sort((u, v) => u[0] - v[0]).slice(0, max).map(x => x[1]);
  }

  /** Quita puntos intermedios mientras el tramo directo siga por el mar. */
  private smooth(pts: Pt[]): Pt[] {
    const out: Pt[] = [pts[0]];
    let i = 0;
    while (i < pts.length - 1) {
      let j = pts.length - 1;
      // los tramos que tocan un extremo (puerto en tierra) se permiten hasta una celda de orilla
      while (j > i + 1 && this.crosses(pts[i], pts[j], i === 0 || j === pts.length - 1 ? this.cell * 1.5 : 0)) j--;
      out.push(pts[j]);
      i = j;
    }
    return out;
  }
}
