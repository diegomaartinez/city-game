// Arranque: pantalla de inicio → ciudad → bucle de juego.
import '@fontsource-variable/rubik';
import './ui/ui.css';
import { cache } from './data/cache.ts';
import { Game, type SaveData } from './sim/game.ts';
import { World } from './render/world.ts';
import { MapRenderer } from './render/mapRenderer.ts';
import { TransitRenderer } from './render/transitRenderer.ts';
import { Tools } from './ui/tools.ts';
import { Hud } from './ui/hud.ts';
import { showStart, type StartResult } from './ui/start.ts';
import { loadStyle, saveStyle } from './render/palette.ts';

async function play(start: StartResult): Promise<void> {
  const world = new World();
  await world.init(document.body);

  const game = new Game(start.city);
  const style = loadStyle();
  const map = new MapRenderer(world, start.city, game.graph);
  map.drawAll(style);
  const transit = new TransitRenderer(world, game);
  transit.setStyle(style);
  const tools = new Tools(world, game, map, transit);
  const hud = new Hud(game, tools);
  hud.style = style;
  hud.onStyle = s => { saveStyle(s); map.drawAll(s); transit.setStyle(s); };
  if (start.save) game.loadSave(start.save as SaveData);
  transit.drawNetwork();
  world.centerOn({ x: 0, y: 0 }, Math.min(1.2, Math.min(world.width, world.height) / (start.city.radius * 1.9)));
  if (import.meta.env.DEV) Object.assign(window, { __game: { game, world, tools, hud, transit } });

  let speed = 1;
  hud.onSpeed = s => { speed = s; };
  hud.onOverlay = mode => { transit.overlay = mode; };

  const save = async () => { try { await cache.putSave(start.key, game.toSave()); } catch { /* sin espacio o modo privado */ } };
  let running = true;
  hud.onMenu = async action => {
    if (action === 'save') { await save(); hud.toast('Partida guardada', 'good'); }
    if (action === 'exit') {
      running = false;
      world.app.ticker.stop();
      hud.destroy();
      world.app.destroy(true, { children: true });
      void main();
    }
  };

  if (!start.save) {
    hud.toast(`Bienvenido a ${start.city.name}: ${game.demand.population.toLocaleString('es-ES')} vecinos esperan transporte. Pulsa H para ver cómo se juega.`, 'info');
    setTimeout(() => hud.toast('Empieza con B (parada de bus) junto a las calles y traza una línea con L.', 'info'), 5000);
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
