// Pantalla de inicio: elegir un nivel (ciudad ya preparada), el modo de juego y continuar o empezar.
import { gunzipSync } from 'fflate';
import { cache } from '../data/cache.ts';
import type { CityData } from '../data/types.ts';
import { GAME_MODES, GAME_MODE_LIST, type GameMode, type SaveData } from '../sim/game.ts';

export interface StartResult {
  city: CityData; key: string; mode: GameMode; save?: SaveData;
  /** Cambia el texto de la pantalla de carga (sigue visible mientras se prepara y dibuja la ciudad). */
  status: (text: string) => void;
  /** Quita la pantalla de carga: se llama cuando el mapa ya está en pantalla. */
  done: () => void;
}

/** Entrada del índice de niveles (public/levels/index.json, generado por scripts/build-levels.ts). */
export interface LevelInfo { id: string; kind?: 'city' | 'country'; name: string; subtitle: string; radius: number; population: number; jobs: number; buildings: number; cities?: number; districts: number; file: string; bytes: number; version: number }

const GAME_NAME = 'Little Transit';
const LEVELS_URL = `${import.meta.env.BASE_URL}levels/`;

const fmt = (n: number) => Math.round(n).toLocaleString('es-ES');

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

/** Descarga y descomprime un nivel (.json.gz). */
export async function loadLevel(info: LevelInfo, onProgress?: (bytes: number) => void, signal?: AbortSignal): Promise<CityData> {
  const r = await fetch(LEVELS_URL + info.file, { signal });
  if (!r.ok || !r.body) throw new Error(`No se pudo cargar el nivel (HTTP ${r.status})`);
  // cuenta los bytes que llegan para la barra de progreso
  let got = 0;
  const counted = r.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({ transform(chunk, ctrl) { got += chunk.byteLength; onProgress?.(got); ctrl.enqueue(chunk); } }));
  // algunos servidores (el de desarrollo, por ejemplo) ya descomprimen el .gz por el camino: se mira la cabecera gzip
  const reader = counted.getReader();
  const first = await reader.read();
  const head = first.value ?? new Uint8Array();
  const gzipped = head.length >= 2 && head[0] === 0x1f && head[1] === 0x8b;
  const rest = new ReadableStream<Uint8Array>({
    start(ctrl) { if (head.length) ctrl.enqueue(head); if (first.done) ctrl.close(); },
    async pull(ctrl) { const { value, done } = await reader.read(); if (done) ctrl.close(); else ctrl.enqueue(value); },
  });
  let city: CityData;
  if (gzipped && typeof DecompressionStream !== 'function') {
    // navegadores sin DecompressionStream (Safari antiguo): se descomprime en memoria
    const bytes = new Uint8Array(await new Response(rest).arrayBuffer());
    city = JSON.parse(new TextDecoder().decode(gunzipSync(bytes))) as CityData;
  } else {
    const stream = gzipped ? rest.pipeThrough(new DecompressionStream('gzip') as unknown as ReadableWritablePair<Uint8Array, Uint8Array>) : rest;
    city = (await new Response(stream).json()) as CityData;
  }
  if (!city.roads?.length && !city.cities?.length) throw new Error('El nivel está vacío o dañado');
  return city;
}

export function showStart(): Promise<StartResult> {
  return new Promise(resolve => {
    const root = el('div');
    root.id = 'start';
    root.innerHTML = `
      <div class="panel card">
        <h1>Little <span>Transit</span></h1>
        <p class="tagline">Diseña la red de bus y metro de una ciudad real. Sin prisas.</p>
        <h3 class="label">Ciudad</h3>
        <div class="levels" id="levels"><div class="muted">Cargando ciudades…</div></div>
        <h3 class="label">Modo de juego</h3>
        <div class="modes" id="modes">${GAME_MODE_LIST.map(m => `<button class="btn mode" data-mode="${m}"><b>${GAME_MODES[m].name}</b><small>${GAME_MODES[m].desc}</small></button>`).join('')}</div>
        <div class="row">
          <button class="btn primary" id="go" disabled>Jugar</button>
          <button class="btn" id="restart" hidden>Empezar de nuevo</button>
        </div>
        <div class="progress" id="progress"></div>
        <div class="bar hidden" id="bar"><div></div></div>
        <p class="footnote">Datos del mapa © colaboradores de OpenStreetMap (ODbL). La partida se guarda en este navegador.</p>
      </div>`;
    document.body.appendChild(root);

    const levelsBox = root.querySelector<HTMLDivElement>('#levels')!;
    const modeButtons = [...root.querySelectorAll<HTMLButtonElement>('#modes .mode')];
    const go = root.querySelector<HTMLButtonElement>('#go')!;
    const restart = root.querySelector<HTMLButtonElement>('#restart')!;
    const progress = root.querySelector<HTMLDivElement>('#progress')!;
    const bar = root.querySelector<HTMLDivElement>('#bar')!;
    const barFill = bar.firstElementChild as HTMLDivElement;

    let levels: LevelInfo[] = [];
    let level: LevelInfo | null = null;
    let save: SaveData | undefined;
    const keyOf = (l: LevelInfo) => `level:${l.id}`;

    // modo (se recuerda el último)
    let mode: GameMode = 'facil';
    try { const m = localStorage.getItem('lt-mode') as GameMode | null; if (m && GAME_MODES[m]) mode = m; } catch { /* sin almacenamiento */ }
    const setMode = (m: GameMode) => {
      mode = m;
      for (const b of modeButtons) b.classList.toggle('active', b.dataset.mode === m);
      try { localStorage.setItem('lt-mode', m); } catch { /* sin almacenamiento */ }
    };
    setMode(mode);
    for (const b of modeButtons) b.onclick = () => { if (save) return; setMode(b.dataset.mode as GameMode); };

    const renderLevels = () => {
      levelsBox.innerHTML = '';
      for (const l of levels) {
        const card = el('button', `btn level ${l === level ? 'active' : ''}`);
        const meta = l.kind === 'country' ? `${fmt(l.population)} habitantes · ${l.cities ?? 0} ciudades · tren, bus, avión y barco` : `${fmt(l.population)} habitantes · ${fmt(l.jobs)} empleos · ${(l.radius * 2 / 1000).toFixed(0)} km de lado · ${l.districts} barrios`;
        card.innerHTML = `<b>${l.name}</b><small>${l.subtitle}</small><span class="meta">${meta}</span><span class="state" data-state></span>`;
        card.onclick = () => void selectLevel(l);
        levelsBox.appendChild(card);
      }
    };

    const selectLevel = async (l: LevelInfo) => {
      level = l;
      try { localStorage.setItem('lt-level', l.id); } catch { /* sin almacenamiento */ }
      save = await cache.getSave<SaveData>(keyOf(l)).catch(() => undefined);
      renderLevels();
      const state = levelsBox.querySelector<HTMLElement>('.level.active [data-state]');
      if (state) state.textContent = save ? `Partida guardada: día ${Math.floor(save.minute / 1440) + 1} · modo ${GAME_MODES[save.mode ?? 'facil'].name.toLowerCase()}` : 'Sin empezar';
      go.disabled = false;
      go.textContent = save ? 'Continuar' : 'Jugar';
      restart.hidden = !save;
      // con partida guardada el modo es el de la partida
      if (save) setMode(save.mode ?? 'facil');
      for (const b of modeButtons) b.disabled = !!save;
    };

    const finish = (r: Omit<StartResult, 'status' | 'done'>) => resolve({ ...r, status: t => { if (root.isConnected) progress.textContent = t; }, done: () => root.remove() });

    const play = async () => {
      if (!level) return;
      const l = level;
      go.disabled = true; restart.disabled = true;
      bar.classList.remove('hidden');
      barFill.style.width = '3%';
      progress.textContent = 'Cargando el mapa…';
      try {
        const city = await loadLevel(l, bytes => { barFill.style.width = `${Math.min(90, 3 + (90 * bytes) / l.bytes)}%`; });
        barFill.style.width = '100%';
        progress.textContent = 'Preparando la ciudad…';
        finish({ city, key: keyOf(l), mode: save?.mode ?? mode, save });
      } catch (e) {
        progress.innerHTML = `<span class="error">${(e as Error).message}</span>`;
        bar.classList.add('hidden');
        go.disabled = false; restart.disabled = false;
      }
    };
    go.onclick = play;
    restart.onclick = async () => {
      if (!level || !save) return;
      if (!confirm(`¿Borrar la partida guardada de ${level.name} y empezar de nuevo?`)) return;
      await cache.deleteSave(keyOf(level)).catch(() => undefined);
      await selectLevel(level);
    };

    fetch(LEVELS_URL + 'index.json').then(r => r.json()).then(async (list: LevelInfo[]) => {
      levels = list;
      if (!levels.length) { levelsBox.innerHTML = '<div class="error">Aún no hay ciudades preparadas.</div>'; return; }
      let last = levels[0];
      try { const id = localStorage.getItem('lt-level'); const f = levels.find(l => l.id === id); if (f) last = f; } catch { /* sin almacenamiento */ }
      await selectLevel(last);
    }).catch(() => { levelsBox.innerHTML = '<div class="error">No se pudo cargar la lista de ciudades. ¿Hay conexión?</div>'; });

    document.title = GAME_NAME;
  });
}
