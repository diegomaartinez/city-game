// Dibuja un nivel de país: mar de fondo, tierra propia y vecina, costa, fronteras, autopistas,
// ciudades (círculo según población, etiqueta) y el recuadro aparte de Canarias.
import { Container, Graphics, Text } from 'pixi.js';
import type { City, CityData } from '../data/types.ts';
import { STYLES, type MapStyle } from './palette.ts';
import type { World } from './world.ts';
import type { RoadGraph } from '../sim/graph.ts';

const LABEL_STYLE = { fontFamily: 'Rubik Variable, system-ui, sans-serif', fontWeight: '700' } as const;

export class CountryRenderer {
  private landG = new Graphics();
  private roadsG = new Graphics();
  private citiesG = new Graphics();
  private labels: Array<{ text: Text; city: City }> = [];
  private labelLayer = new Container();
  private insetG = new Graphics();
  private insetLabel: Text | null = null;
  style: MapStyle = 'plano';
  private drawnZoom = -1;

  constructor(private world: World, private data: CityData, _graph: RoadGraph) {
    world.areas.addChild(this.landG, this.insetG);
    world.roads.addChild(this.roadsG);
    world.buildings.addChild(this.citiesG, this.labelLayer);
  }

  drawAll(style: MapStyle = this.style): void {
    this.style = style;
    const d = STYLES[style];
    const halfW = this.data.halfW ?? this.data.radius, halfH = this.data.halfH ?? this.data.radius;
    // el "suelo" es el mar; la tierra va encima
    this.world.drawGround(this.data.radius, d.sea, null, d.backdrop, halfW, halfH);
    const g = this.landG;
    g.clear();
    const map = this.data.map;
    if (!map) return;
    const poly = (p: { x: number; y: number }[]) => { g.poly(p.map(q => [q.x, q.y]).flat(), true); };
    for (const p of map.foreign) { poly(p); g.fill({ color: d.bg, alpha: 0.85 }); g.stroke({ color: d.seaEdge, width: 700, alpha: 0.5, join: 'bevel' }); }
    for (const p of map.land) { poly(p); g.fill(d.bg); g.stroke({ color: d.seaEdge, width: 900, alpha: 0.9, join: 'bevel' }); }
    for (const b of map.borders) { g.moveTo(b[0].x, b[0].y); for (let i = 1; i < b.length; i++) g.lineTo(b[i].x, b[i].y); g.stroke({ color: d.ink, width: 700, alpha: 0.35, join: 'bevel', cap: 'butt' }); }
    // recuadro de Canarias
    const ig = this.insetG;
    ig.clear();
    this.insetLabel?.destroy(); this.insetLabel = null;
    if (map.inset) {
      const { x0, y0, x1, y1, label } = map.inset;
      ig.rect(x0, y0, x1 - x0, y1 - y0).fill({ color: d.sea }).stroke({ color: d.ink, width: 1200, alpha: 0.6 });
      // la tierra de las islas se dibuja encima (ya está en `land`, pero el recuadro la tapa: se repite dentro)
      for (const p of map.land) { if (p.every(q => q.x >= x0 && q.x <= x1 && q.y >= y0 && q.y <= y1)) { ig.poly(p.map(q => [q.x, q.y]).flat(), true); ig.fill(d.bg); ig.stroke({ color: d.seaEdge, width: 900, alpha: 0.9, join: 'bevel' }); } }
      const t = new Text({ text: label, style: { ...LABEL_STYLE, fontSize: 12, fill: d.label } });
      t.anchor.set(0, 1);
      t.position.set(x0 + 4000, y1 - 3000);
      this.insetLabel = t;
      this.world.areas.addChild(t);
    }
    // autopistas: sin remates ni uniones redondas, que en coordenadas de metros Pixi teselaría con cientos de
    // segmentos por vértice (la rejilla de Iberia tiene ~150.000 puntos y la tarjeta se quedaba sin memoria)
    const r = this.roadsG;
    r.clear();
    for (const w of this.data.roads) {
      r.moveTo(w.pts[0].x, w.pts[0].y);
      for (let i = 1; i < w.pts.length; i++) r.lineTo(w.pts[i].x, w.pts[i].y);
    }
    r.stroke({ color: d.ink, width: 900, alpha: 0.22, cap: 'butt', join: 'bevel' });
    this.drawCities();
    this.drawnZoom = -1;
    this.cull();
  }

  private drawCities(): void {
    const d = STYLES[this.style];
    const g = this.citiesG;
    g.clear();
    for (const l of this.labels) l.text.destroy();
    this.labels = [];
    for (const c of this.data.cities ?? []) {
      const r = this.cityRadius(c);
      g.circle(c.x, c.y, r + 700).fill({ color: 0xffffff, alpha: 0.8 });
      g.circle(c.x, c.y, r).fill(0xfff4e0).stroke({ color: d.ink, width: 900, alpha: 0.9 });
      if (c.airport) g.poly([c.x + r + 1200, c.y - r - 2200, c.x + r + 3400, c.y - r - 900, c.x + r + 600, c.y - r - 300], true).fill({ color: 0x2f6fc4, alpha: 0.9 });
      const t = new Text({ text: c.name, style: { ...LABEL_STYLE, fontSize: c.pop >= 300_000 ? 13 : 11, fill: d.label, stroke: { color: 0xffffff, width: 3 } } });
      t.anchor.set(0, 0.5);
      this.labelLayer.addChild(t);
      this.labels.push({ text: t, city: c });
    }
  }

  /** Radio del círculo de una ciudad (m): crece con la población. */
  cityRadius(c: City): number { return 2200 + Math.sqrt(c.pop) * 3.2; }

  /** Etiquetas con tamaño constante en pantalla; las ciudades pequeñas solo se nombran al acercarse. */
  cull(): void {
    const z = this.world.zoom;
    if (this.drawnZoom > 0 && Math.abs(z - this.drawnZoom) / this.drawnZoom < 0.05) return;
    this.drawnZoom = z;
    const sc = 1 / z;
    const minPop = z < 0.0012 ? 250_000 : z < 0.002 ? 120_000 : z < 0.0035 ? 60_000 : 0;
    for (const l of this.labels) {
      l.text.scale.set(sc);
      l.text.visible = l.city.pop >= minPop;
      // a la derecha del círculo, dejando sitio al anillo de la estación (que mide ~14 px en pantalla)
      l.text.position.set(l.city.x + Math.max(this.cityRadius(l.city) + 1500, 16 * sc), l.city.y);
    }
    if (this.insetLabel) this.insetLabel.scale.set(sc);
  }

  /** Qué hay bajo el cursor: la ciudad más cercana (a menos de un radio razonable). */
  describe(x: number, y: number): { text: string; sub?: string } | null {
    let best: City | null = null, bd = Math.max(12000, 14 / this.world.zoom);
    for (const c of this.data.cities ?? []) { const dd = Math.hypot(c.x - x, c.y - y); if (dd < bd) { bd = dd; best = c; } }
    if (!best) return null;
    const extras = [best.airport ? 'aeropuerto' : '', best.coastal ? 'puerto' : '', best.inset ? 'Canarias' : ''].filter(Boolean).join(' · ');
    return { text: best.name, sub: `${best.pop.toLocaleString('es-ES')} habitantes${extras ? ' · ' + extras : ''}` };
  }
}
