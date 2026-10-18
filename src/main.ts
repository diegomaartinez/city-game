// Arranque: pantalla de inicio → ciudad → bucle de juego.
import '@fontsource-variable/rubik';
import './ui/ui.css';
import { cache } from './data/cache.ts';
import { Game, type SaveData } from './sim/game.ts';
import { World } from './render/world.ts';
import { MapRenderer } from './render/mapRenderer.ts';
import { CountryRenderer } from './render/countryRenderer.ts';
import { TransitRenderer } from './render/transitRenderer.ts';
import { Tools } from './ui/tools.ts';
import { Hud } from './ui/hud.ts';
import { showStart, type StartResult } from './ui/start.ts';
import { loadStyle, saveStyle } from './render/palette.ts';

async function play(start: StartResult): Promise<void> {
  const world = new World();
  await world.init(document.body);

  const game = new Game(start.city, start.mode);
  const style = loadStyle();
  const map = game.country ? new CountryRenderer(world, start.city, game.graph) : new MapRenderer(world, start.city, game.graph);
  map.drawAll(style);
  const transit = new TransitRenderer(world, game);
  transit.setStyle(style);
  const tools = new Tools(world, game, map, transit);
  const hud = new Hud(game, tools, world);
  hud.style = style;
  hud.onStyle = s => { saveStyle(s); map.drawAll(s); transit.setStyle(s); };
  if (start.save) game.loadSave(start.save as SaveData);
  transit.drawNetwork();
  const halfW = start.city.halfW ?? start.city.radius, halfH = start.city.halfH ?? start.city.radius;
  const fit = Math.min(world.width / (halfW * 2.1), world.height / (halfH * 2.1));
  if (game.country) { world.minZoom = fit * 0.8; world.maxZoom = fit * 40; }
  world.centerOn({ x: 0, y: 0 }, Math.min(1.2, fit));
  if (import.meta.env.DEV) Object.assign(window, { __game: { game, world, tools, hud, transit } });

  let speed = 1;
  hud.onSpeed = s => { speed = s; };
  hud.onOverlay = mode => { transit.overlay = mode; };

  const save = async () => { try { await cache.putSave(start.key, game.toSave()); } catch { /* sin espacio o modo privado */ } };
  let running = true;
  const teardown = () => {
    running = false;
    world.app.ticker.stop();
    hud.destroy();
    world.app.destroy(true, { children: true });
  };
  hud.onMenu = async action => {
    if (action === 'save') { await save(); hud.toast('Partida guardada', 'good'); }
    if (action === 'exit') { teardown(); void main(); }
    if (action === 'creative') {
      // misma red, mismo día, pero sin límite de dinero
      const s = game.toSave();
      s.mode = 'creativo'; s.over = false; s.debt = 0; s.redDays = 0;
      teardown();
      await cache.putSave(start.key, s).catch(() => undefined);
      void play({ ...start, mode: 'creativo', save: s });
    }
  };

  if (!start.save) {
    hud.toast(`Bienvenido a ${start.city.name}: ${game.demand.population.toLocaleString('es-ES')} ${game.country ? 'personas quieren viajar entre sus ciudades' : 'vecinos esperan transporte'}. El botón «?» explica cómo se juega.`, 'info');
    setTimeout(() => hud.toast(game.country ? 'Empieza con una línea de tren (T) o de bus (B): haz clic en las ciudades que quieras unir.' : 'Empieza poniendo paradas de bus junto a las calles y traza una línea que las una.', 'info'), 5000);
  }

  let saveTimer = 0, hudTimer = 0;
  world.app.ticker.add(ticker => {
    if (!running) return;
    const dt = Math.min(0.1, ticker.deltaMS / 1000);
    if (speed > 0) {
      // en varios pasos cortos para que a velocidad alta los vehículos no se salten paradas
      const steps = Math.max(1, Math.ceil(speed));
      for (let i = 0; i < steps; i++) game.tick((dt * speed) / steps);
    }
    transit.update(dt, game.now);
    hud.placeFichas();
    map.cull();
    hudTimer += dt;
    if (hudTimer > 0.25) { hudTimer = 0; hud.refresh(); }
    saveTimer += dt;
    if (saveTimer > 30) { saveTimer = 0; void save(); }
  });
  window.addEventListener('beforeunload', () => { void save(); });
}

async function main(): Promise<void> {
  const start = await showStart();
  await play(start);
}

void main();
