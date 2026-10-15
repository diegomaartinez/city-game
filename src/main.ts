// Arranque: pantalla de inicio → ciudad → bucle de juego.
import '@fontsource-variable/rubik';
import './ui/ui.css';
import { cache } from './data/cache.ts';
import { City } from './sim/city.ts';
import { Traffic } from './sim/traffic.ts';
import { World } from './render/world.ts';
import { CityRenderer } from './render/cityRenderer.ts';
import { Tools } from './ui/tools.ts';
import { Hud } from './ui/hud.ts';
import { showStart, type StartResult } from './ui/start.ts';

const DAY_SECONDS = 1.2; // segundos reales por día de juego a velocidad normal

async function play(start: StartResult): Promise<void> {
  const world = new World();
  await world.init(document.body);

  const city = new City(start.city);
  if (start.save) city.loadSave(start.save);
  const traffic = new Traffic(city);
  const renderer = new CityRenderer(world, city, traffic);
  renderer.drawAll();
  const tools = new Tools(world, city, renderer);
  const hud = new Hud(city, tools);
  if (import.meta.env.DEV) Object.assign(window, { __game: { city, world, traffic, tools, hud } });
  world.centerOn({ x: 0, y: 0 }, Math.min(1.2, Math.min(world.width, world.height) / (start.city.radius * 1.9)));

  let speed = 1;
  hud.onSpeed = s => { speed = s; };
  hud.onTraffic = on => { renderer.showTraffic = on; };

  const save = async () => { try { await cache.putSave(start.key, city.toSave()); } catch { /* sin espacio o modo privado */ } };
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

  // Primeros consejos
  if (!start.save) {
    hud.toast(`Bienvenido a ${start.city.name}. Pulsa H para ver cómo se juega.`, 'info');
    setTimeout(() => hud.toast('Para que crezcan zonas nuevas, coloca una central eléctrica y una depuradora (S).', 'info'), 5000);
  }

  let saveTimer = 0, dateTimer = 0;
  world.app.ticker.add(ticker => {
    if (!running) return;
    const dt = Math.min(0.1, ticker.deltaMS / 1000);
    if (speed > 0) {
      const simDt = dt * speed;
      city.tick(simDt / DAY_SECONDS);
      traffic.update(simDt * 6); // los coches van a "escala de maqueta": 6 s simulados por segundo
      dateTimer += dt;
      if (dateTimer > 0.5) { dateTimer = 0; hud.updateDate(); }
    }
    renderer.updateCars(dt);
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
