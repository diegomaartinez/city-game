// Afinado de un nivel de ciudad antes de empaquetarlo:
//  - calles sin sentido: todas son de doble sentido (el bus va por donde haga falta y la parada vale para ambos sentidos);
//  - avenidas con dos calzadas (dos vías de sentido único paralelas en OSM) se funden en una sola línea central;
//  - manzanas: los edificios contiguos del mismo uso se unen en un polígono (los edificios siguen existiendo
//    para la población y los empleos, pero el mapa dibuja manzanas y no un lío de rectángulos).
import polygonClipping from 'polygon-clipping';
import type { Block, Building, BuildingUse, CityData, Pt, RoadWay } from '../src/data/types.ts';
import { simplifyKeep } from '../src/data/compact.ts';

const DUAL_CLASSES = new Set(['motorway', 'primary', 'secondary', 'tertiary', 'residential']);

export function refine(city: CityData): { merged: number; blocks: number; pts: [number, number] } {
  const merged = collapseDualCarriageways(city.roads);
  for (const r of city.roads) r.oneway = false;
  const pts = simplifyRoadGeometry(city.roads, 0.35);
  city.blocks = makeBlocks(city.buildings);
  // la huella ya no hace falta: el mapa dibuja las manzanas y la población sale del área y las plantas
  for (const b of city.buildings) delete b.poly;
  return { merged, blocks: city.blocks.length, pts };
}

// ───────────── calzadas dobles ─────────────

interface Seg { way: number; i: number }

/** Mueve los puntos de las vías de sentido único hacia la mediana de su calzada paralela (ambas acaban en la misma línea). */
export function collapseDualCarriageways(roads: RoadWay[]): number {
  const CELL = 50, MAX = 45, MIN = 3, MAX_NONAME = 28;
  const closed = (r: RoadWay) => r.nodes.length > 2 && r.nodes[0] === r.nodes[r.nodes.length - 1];
  const cand = roads.map((r, i) => (r.oneway && DUAL_CLASSES.has(r.cls) && !closed(r) ? i : -1)).filter(i => i >= 0);
  const hash = new Map<number, Seg[]>();
  const key = (x: number, y: number) => (Math.floor(x / CELL) + 32768) * 65536 + (Math.floor(y / CELL) + 32768);
  for (const w of cand) {
    const r = roads[w];
    for (let i = 0; i + 1 < r.pts.length; i++) {
      const a = r.pts[i], b = r.pts[i + 1];
      const x0 = Math.floor(Math.min(a.x, b.x) / CELL), x1 = Math.floor(Math.max(a.x, b.x) / CELL);
      const y0 = Math.floor(Math.min(a.y, b.y) / CELL), y1 = Math.floor(Math.max(a.y, b.y) / CELL);
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) { const k = (x + 32768) * 65536 + (y + 32768); let l = hash.get(k); if (!l) hash.set(k, (l = [])); l.push({ way: w, i }); }
    }
  }
  const norm = (s?: string) => (s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
  const moves = new Map<number, { x: number; y: number; d: number }>();
  for (const w of cand) {
    const r = roads[w];
    const nodesOfWay = new Set(r.nodes);
    for (let i = 0; i < r.pts.length; i++) {
      const p = r.pts[i];
      // dirección en el punto: media de los tramos vecinos
      const q0 = r.pts[Math.max(0, i - 1)], q1 = r.pts[Math.min(r.pts.length - 1, i + 1)];
      let dx = q1.x - q0.x, dy = q1.y - q0.y;
      const dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;
      let best: { x: number; y: number; d: number } | null = null;
      const rr = Math.ceil(MAX / CELL);
      const cx = Math.floor(p.x / CELL), cy = Math.floor(p.y / CELL);
      for (let gx = cx - rr; gx <= cx + rr; gx++) for (let gy = cy - rr; gy <= cy + rr; gy++) {
        const l = hash.get((gx + 32768) * 65536 + (gy + 32768));
        if (!l) continue;
        for (const s of l) {
          if (s.way === w) continue;
          const o = roads[s.way];
          if (o.layer !== r.layer) continue;
          // no son la misma calle partida en trozos: no comparten nodos
          if (o.nodes[s.i] !== undefined && (nodesOfWay.has(o.nodes[s.i]) || nodesOfWay.has(o.nodes[s.i + 1]))) continue;
          const a = o.pts[s.i], b = o.pts[s.i + 1];
          let ex = b.x - a.x, ey = b.y - a.y;
          const el = Math.hypot(ex, ey) || 1; ex /= el; ey /= el;
          if (dx * ex + dy * ey > -0.8) continue; // tiene que ir en sentido contrario
          const t = ((p.x - a.x) * ex + (p.y - a.y) * ey) / el;
          if (t < -0.05 || t > 1.05) continue;
          const px = a.x + ex * el * Math.max(0, Math.min(1, t)), py = a.y + ey * el * Math.max(0, Math.min(1, t));
          const d = Math.hypot(p.x - px, p.y - py);
          const sameName = norm(r.name) && norm(r.name) === norm(o.name);
          const limit = sameName ? MAX : (!norm(r.name) || !norm(o.name)) && r.cls === o.cls ? MAX_NONAME : 0;
          if (d < MIN || d > limit) continue;
          if (!best || d < best.d) best = { x: (p.x + px) / 2, y: (p.y + py) / 2, d };
        }
      }
      if (best) {
        const id = r.nodes[i];
        const prev = moves.get(id);
        if (!prev || best.d < prev.d) moves.set(id, best);
      }
    }
  }
  // se aplican por id de nodo, así las calles que cruzan la avenida siguen enganchadas
  let n = 0;
  for (const r of roads) for (let i = 0; i < r.pts.length; i++) {
    const m = moves.get(r.nodes[i]);
    if (m) { r.pts[i] = { x: Math.round(m.x * 10) / 10, y: Math.round(m.y * 10) / 10 }; n++; }
  }
  return n;
}

/** Quita los puntos que no aportan nada al trazado (a menos de `tol` m de la recta), sin tocar cruces ni extremos. */
export function simplifyRoadGeometry(roads: RoadWay[], tol: number): [number, number] {
  const uses = new Map<number, number>();
  for (const r of roads) for (const n of r.nodes) uses.set(n, (uses.get(n) ?? 0) + 1);
  let before = 0, after = 0;
  for (const r of roads) {
    before += r.pts.length;
    const keep = simplifyKeep(r.pts, tol, i => i === 0 || i === r.pts.length - 1 || (uses.get(r.nodes[i]) ?? 0) > 1);
    r.pts = r.pts.filter((_, i) => keep[i]); r.nodes = r.nodes.filter((_, i) => keep[i]);
    after += r.pts.length;
  }
  return [before, after];
}

// ───────────── manzanas ─────────────

type Ring = Array<[number, number]>;

/** Une en manzanas los edificios que se tocan (a menos de `gap` metros) y tienen el mismo uso. */
export function makeBlocks(buildings: Building[], gap = 1.2): Block[] {
  const out: Block[] = [];
  const byUse = new Map<BuildingUse, Building[]>();
  for (const b of buildings) { if (!b.poly) continue; let l = byUse.get(b.use); if (!l) byUse.set(b.use, (l = [])); l.push(b); }
  for (const [use, list] of byUse) {
    // agrupación por cajas que se solapan (unión-búsqueda)
    const boxes = list.map(b => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const p of b.poly ?? []) { if (p.x < x0) x0 = p.x; if (p.y < y0) y0 = p.y; if (p.x > x1) x1 = p.x; if (p.y > y1) y1 = p.y; } return [x0 - gap / 2, y0 - gap / 2, x1 + gap / 2, y1 + gap / 2] as const; });
    const parent = list.map((_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const CELL = 40;
    const cells = new Map<number, number[]>();
    boxes.forEach((bx, i) => {
      for (let x = Math.floor(bx[0] / CELL); x <= Math.floor(bx[2] / CELL); x++) for (let y = Math.floor(bx[1] / CELL); y <= Math.floor(bx[3] / CELL); y++) {
        const k = (x + 32768) * 65536 + (y + 32768);
        let l = cells.get(k); if (!l) cells.set(k, (l = [])); l.push(i);
      }
    });
    for (const l of cells.values()) for (let a = 0; a < l.length; a++) for (let b = a + 1; b < l.length; b++) {
      const i = l[a], j = l[b];
      const p = boxes[i], q = boxes[j];
      if (p[0] <= q[2] && q[0] <= p[2] && p[1] <= q[3] && q[1] <= p[3]) { const fi = find(i), fj = find(j); if (fi !== fj) parent[fi] = fj; }
    }
    const groups = new Map<number, Building[]>();
    list.forEach((b, i) => { const r = find(i); let g = groups.get(r); if (!g) groups.set(r, (g = [])); g.push(b); });
    for (const g of groups.values()) {
      if (g.length === 1) { if (g[0].poly) out.push({ use, rings: [g[0].poly.map(round1)] }); continue; }
      const polys = g.filter(b => b.poly).map(b => [closeRing(b.poly!.map(p => [p.x, p.y] as [number, number]))]);
      let result: Ring[][];
      try { result = polygonClipping.union(...(polys as [Ring[], ...Ring[][]])) as Ring[][]; } catch { for (const b of g) if (b.poly) out.push({ use, rings: [b.poly.map(round1)] }); continue; }
      for (const poly of result) {
        const rings = poly.map(r => openRing(r).map(([x, y]) => round1({ x, y }))).filter(r => r.length >= 3);
        if (rings.length) out.push({ use, rings });
      }
    }
  }
  return out;
}

const round1 = (p: Pt): Pt => ({ x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 });
function closeRing(r: Ring): Ring { const a = r[0], b = r[r.length - 1]; return a[0] === b[0] && a[1] === b[1] ? r : [...r, a]; }
function openRing(r: Ring): Ring { const a = r[0], b = r[r.length - 1]; return r.length > 1 && a[0] === b[0] && a[1] === b[1] ? r.slice(0, -1) : r; }
