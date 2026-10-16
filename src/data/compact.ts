// Compacta una ciudad ya convertida para publicarla como nivel: coordenadas a decímetros y polígonos simplificados.
import type { CityData, Pt } from './types.ts';

/** Reduce el tamaño del nivel: coordenadas a decímetros y polígonos grandes simplificados. */
export function compact(city: CityData): void {
  const r1 = (v: number) => Math.round(v * 10) / 10;
  const rp = (p: { x: number; y: number }) => { p.x = r1(p.x); p.y = r1(p.y); };
  for (const r of city.roads) r.pts.forEach(rp);
  for (const b of city.buildings) { b.poly.forEach(rp); b.cx = r1(b.cx); b.cy = r1(b.cy); b.area = Math.round(b.area); }
  for (const a of city.areas) { a.poly = simplify(a.poly, a.kind === 'sea' ? 1 : 2); a.poly.forEach(rp); }
  for (const z of city.zones) { z.poly = simplify(z.poly, 3); z.poly.forEach(rp); z.cx = r1(z.cx); z.cy = r1(z.cy); z.area = Math.round(z.area); }
  for (const p of city.places ?? []) rp(p);
  if (city.coreBox) city.coreBox = city.coreBox.map(Math.round) as [number, number, number, number];
}

/** Douglas-Peucker sobre un polígono cerrado (se mantiene el primer vértice). */
export function simplify(poly: Pt[], tol: number): Pt[] {
  if (poly.length <= 8) return poly;
  const keep = new Uint8Array(poly.length);
  keep[0] = 1; keep[poly.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, poly.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let best = -1, bd = tol;
    const A = poly[a], B = poly[b];
    const dx = B.x - A.x, dy = B.y - A.y, l2 = dx * dx + dy * dy;
    for (let i = a + 1; i < b; i++) {
      const P = poly[i];
      const t = l2 ? Math.max(0, Math.min(1, ((P.x - A.x) * dx + (P.y - A.y) * dy) / l2)) : 0;
      const d = Math.hypot(P.x - (A.x + dx * t), P.y - (A.y + dy * t));
      if (d > bd) { bd = d; best = i; }
    }
    if (best >= 0) { keep[best] = 1; stack.push([a, best], [best, b]); }
  }
  const out = poly.filter((_, i) => keep[i]);
  return out.length >= 3 ? out : poly;
}

