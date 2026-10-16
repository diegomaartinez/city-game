// Construye los polígonos de mar a partir de las líneas de costa de OSM (natural=coastline).
// En OSM la tierra queda a la izquierda de cada tramo y el agua a la derecha. Recortamos las
// líneas al cuadrado cargado y cerramos cada trozo por el borde del cuadrado, siempre con el
// mar a la derecha (en coordenadas de pantalla eso es recorrer el borde en sentido horario).
import type { Pt } from './types.ts';

/** Une tramos abiertos por sus extremos en cadenas lo más largas posible. */
export function chainPolylines(parts: Pt[][], eps = 0.5): Pt[][] {
  const pool = parts.filter(p => p.length >= 2).map(p => p.slice());
  const same = (a: Pt, b: Pt) => Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps;
  const chains: Pt[][] = [];
  while (pool.length) {
    const c = pool.shift()!;
    let grew = true;
    while (grew) {
      grew = false;
      for (let i = 0; i < pool.length; i++) {
        const p = pool[i];
        if (same(c[c.length - 1], p[0])) { c.push(...p.slice(1)); pool.splice(i, 1); grew = true; break; }
        if (same(p[p.length - 1], c[0])) { c.unshift(...p.slice(0, -1)); pool.splice(i, 1); grew = true; break; }
      }
    }
    chains.push(c);
  }
  return chains;
}

const inside = (p: Pt, h: number) => p.x >= -h && p.x <= h && p.y >= -h && p.y <= h;

/** Punto donde el segmento a→b cruza el borde del cuadrado [-h, h]², el más cercano a `a`. */
function crossing(a: Pt, b: Pt, h: number): Pt | null {
  const dx = b.x - a.x, dy = b.y - a.y;
  let best: Pt | null = null, bt = Infinity;
  const consider = (t: number) => {
    if (t <= 1e-6 || t >= 1 - 1e-9) return;
    const p = { x: a.x + dx * t, y: a.y + dy * t };
    if (p.x < -h - 1e-6 || p.x > h + 1e-6 || p.y < -h - 1e-6 || p.y > h + 1e-6) return;
    if (t < bt) { bt = t; best = { x: Math.max(-h, Math.min(h, p.x)), y: Math.max(-h, Math.min(h, p.y)) }; }
  };
  if (dx !== 0) { consider((-h - a.x) / dx); consider((h - a.x) / dx); }
  if (dy !== 0) { consider((-h - a.y) / dy); consider((h - a.y) / dy); }
  return best;
}

/** Recorta una cadena al cuadrado: devuelve trozos que empiezan y terminan en el borde, y bucles cerrados interiores. */
function clipChain(chain: Pt[], h: number): { pieces: Pt[][]; loops: Pt[][] } {
  const pieces: Pt[][] = [];
  const closed = chain.length > 3 && Math.abs(chain[0].x - chain[chain.length - 1].x) < 0.5 && Math.abs(chain[0].y - chain[chain.length - 1].y) < 0.5;
  if (closed && chain.every(p => inside(p, h))) return { pieces: [], loops: [chain.slice(0, -1)] };
  let cur: Pt[] | null = null;
  for (let i = 0; i + 1 < chain.length; i++) {
    let a = chain[i];
    const b = chain[i + 1];
    let ia = inside(a, h);
    if (ia && cur === null) cur = [a];
    for (let guard = 0; guard < 4; guard++) {
      const x = crossing(a, b, h);
      if (ia) {
        if (x && !inside(b, h)) { cur!.push(x); pieces.push(cur!); cur = null; a = x; ia = false; continue; }
        cur!.push(b);
        break;
      }
      if (x && (inside(b, h) || crossing(x, b, h))) { cur = [x]; a = x; ia = true; continue; }
      break;
    }
  }
  // si termina dentro del cuadrado sin salir, los datos están cortados: se descarta ese trozo
  return { pieces: pieces.filter(p => p.length >= 2), loops: [] };
}

/** Posición de un punto del borde recorrida en sentido horario desde la esquina superior izquierda. */
function perimeterPos(p: Pt, h: number): number {
  const side = 2 * h;
  if (Math.abs(p.y + h) < 1e-3) return p.x + h;                       // arriba, de izquierda a derecha
  if (Math.abs(p.x - h) < 1e-3) return side + (p.y + h);              // derecha, de arriba abajo
  if (Math.abs(p.y - h) < 1e-3) return 2 * side + (h - p.x);          // abajo, de derecha a izquierda
  return 3 * side + (h - p.y);                                         // izquierda, de abajo arriba
}

function perimeterPoint(pos: number, h: number): Pt {
  const side = 2 * h;
  pos = ((pos % (4 * side)) + 4 * side) % (4 * side);
  if (pos < side) return { x: -h + pos, y: -h };
  if (pos < 2 * side) return { x: h, y: -h + (pos - side) };
  if (pos < 3 * side) return { x: h - (pos - 2 * side), y: h };
  return { x: -h, y: h - (pos - 3 * side) };
}

/** Puntos del borde (esquinas) entre dos posiciones recorridas en sentido horario. */
function cornersBetween(from: number, to: number, h: number): Pt[] {
  const side = 2 * h, total = 4 * side;
  const out: Pt[] = [];
  let d = ((to - from) % total + total) % total;
  if (d === 0) d = total;
  for (let k = 1; k <= 4; k++) {
    const cpos = k * side;
    const rel = ((cpos - from) % total + total) % total;
    if (rel > 0 && rel < d) out.push({ pos: rel, pt: perimeterPoint(cpos, h) } as never);
  }
  return (out as unknown as Array<{ pos: number; pt: Pt }>).sort((a, b) => a.pos - b.pos).map(c => c.pt);
}

/**
 * Polígonos de mar dentro del cuadrado [-h, h]². `coastlines` son las líneas de costa ya proyectadas
 * (tierra a la izquierda). Devuelve también las islas (bucles cerrados de costa dentro del cuadrado).
 */
export function seaPolygons(coastlines: Pt[][], h: number): { sea: Pt[][]; islands: Pt[][] } {
  const chains = chainPolylines(coastlines);
  const pieces: Pt[][] = [];
  const islands: Pt[][] = [];
  for (const c of chains) {
    const r = clipChain(c, h);
    pieces.push(...r.pieces);
    for (const loop of r.loops) {
      // sentido: con el agua a la derecha, un bucle horario (en pantalla) encierra agua; antihorario, tierra
      let area = 0;
      for (let i = 0; i < loop.length; i++) { const p = loop[i], q = loop[(i + 1) % loop.length]; area += p.x * q.y - q.x * p.y; }
      if (area > 0) pieces.push(loop); else islands.push(loop);
    }
  }
  if (!pieces.length) return { sea: [], islands };
  // cada trozo empieza en A (borde) y termina en B (borde); desde B seguimos el borde en sentido horario
  const starts = pieces.map((p, i) => ({ i, pos: perimeterPos(p[0], h) })).sort((a, b) => a.pos - b.pos);
  const used = new Set<number>();
  const sea: Pt[][] = [];
  for (let k = 0; k < pieces.length; k++) {
    if (used.has(k)) continue;
    const poly: Pt[] = [];
    let cur = k;
    for (let guard = 0; guard < pieces.length + 1; guard++) {
      used.add(cur);
      const piece = pieces[cur];
      poly.push(...piece);
      const endPos = perimeterPos(piece[piece.length - 1], h);
      // siguiente inicio de trozo en sentido horario
      let next = starts.find(s => s.pos > endPos + 1e-6) ?? starts[0];
      const nextPos = next.pos;
      poly.push(...cornersBetween(endPos, nextPos, h));
      if (next.i === k) break;
      if (used.has(next.i)) break; // datos inconsistentes: cerramos lo que hay
      cur = next.i;
    }
    if (poly.length >= 3) sea.push(poly);
  }
  // bucles de mar interiores (lagunas marinas) ya añadidos como trozos: si no eran trozos de borde se incluyen tal cual
  return { sea, islands };
}
