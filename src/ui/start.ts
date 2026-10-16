// Pantalla de inicio: buscar una ciudad, elegir el radio y descargar el mapa (o continuar una partida).
import { cache, cityKey } from '../data/cache.ts';
import { searchPlaces, type Place } from '../data/nominatim.ts';
import { fetchCity } from '../data/overpass.ts';
import { parseOsm } from '../data/parse.ts';
import { CITY_VERSION, CORE_RADIUS, type CityData } from '../data/types.ts';
import type { SaveData } from '../sim/game.ts';

export interface StartResult { city: CityData; key: string; save?: SaveData }

const GAME_NAME = 'Little Transit';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

export function showStart(): Promise<StartResult> {
  return new Promise(resolve => {
    const root = el('div');
    root.id = 'start';
    root.innerHTML = `
      <div class="panel card">
        <h1>Little <span>Transit</span></h1>
        <p class="tagline">Elige una ciudad real y diseña su red de bus y metro. Sin prisas.</p>
        <div class="search">
          <input id="q" type="text" placeholder="Busca una ciudad… (Madrid, Lugo, Lisboa)" autocomplete="off" />
          <ul class="results card hidden" id="results"></ul>
        </div>
        <div class="chosen" id="chosen">Escribe el nombre de una ciudad y elige un resultado.</div>
        <div class="row">
          <label for="radius">Radio</label>
          <input id="radius" type="range" min="500" max="10000" step="500" value="1500" />
          <b id="radiusLabel">1,5 km</b>
        </div>
        <div class="muted" id="radiusNote" style="font-size:12px;margin-top:4px"></div>
        <div class="row">
          <button class="btn primary" id="go" disabled>Cargar ciudad</button>
          <button class="btn small hidden" id="cancel">Cancelar</button>
        </div>
        <div class="progress" id="progress"></div>
        <div class="bar hidden" id="bar"><div></div></div>
        <div class="saved hidden" id="saved"><h3>Tus ciudades</h3><ul></ul></div>
        <p class="footnote">Datos del mapa © colaboradores de OpenStreetMap (ODbL). Se descargan una vez y se guardan en tu navegador.</p>
      </div>`;
    document.body.appendChild(root);

    const q = root.querySelector<HTMLInputElement>('#q')!;
    const results = root.querySelector<HTMLUListElement>('#results')!;
    const chosen = root.querySelector<HTMLDivElement>('#chosen')!;
    const radius = root.querySelector<HTMLInputElement>('#radius')!;
    const radiusLabel = root.querySelector<HTMLElement>('#radiusLabel')!;
    const go = root.querySelector<HTMLButtonElement>('#go')!;
    const cancel = root.querySelector<HTMLButtonElement>('#cancel')!;
    const progress = root.querySelector<HTMLDivElement>('#progress')!;
    const bar = root.querySelector<HTMLDivElement>('#bar')!;
    const barFill = bar.firstElementChild as HTMLDivElement;
    const saved = root.querySelector<HTMLDivElement>('#saved')!;
    const savedList = saved.querySelector('ul')!;

    let place: Place | null = null;
    let timer = 0;
    let abort: AbortController | null = null;
    let searchAbort: AbortController | null = null;

    const fmtKm = (m: number) => (m / 1000).toLocaleString('es-ES', { maximumFractionDigits: 2 }) + ' km';
    const radiusNote = root.querySelector<HTMLElement>('#radiusNote')!;
    const updateRadius = () => {
      const r = +radius.value;
      radiusLabel.textContent = fmtKm(r);
      radiusNote.textContent = r > CORE_RADIUS ? `Hasta ${fmtKm(CORE_RADIUS)} del centro con todos los edificios; más allá, calles principales y zonas de uso del suelo (área metropolitana). Descarga más larga.` : 'Todas las calles y edificios. Más radio, más descarga.';
    };
    radius.oninput = updateRadius;
    updateRadius();

    const setPlace = (p: Place) => {
      place = p;
      chosen.innerHTML = `<b>${p.name}</b> · ${p.displayName}`;
      go.disabled = false;
      results.classList.add('hidden');
      q.value = p.name;
    };

    q.oninput = () => {
      clearTimeout(timer);
      place = null; go.disabled = true;
      const text = q.value.trim();
      if (text.length < 2) { results.classList.add('hidden'); return; }
      timer = window.setTimeout(async () => {
        searchAbort?.abort();
        searchAbort = new AbortController();
        results.innerHTML = '<li class="muted">Buscando…</li>';
        results.classList.remove('hidden');
        try {
          const list = await searchPlaces(text, 'es', searchAbort.signal);
          results.innerHTML = '';
          if (!list.length) { results.innerHTML = '<li>Sin resultados</li>'; return; }
          for (const p of list) {
            const li = el('li', '', `${p.name}<small>${p.displayName}</small>`);
            li.onclick = () => setPlace(p);
            results.appendChild(li);
          }
        } catch (e) {
          if ((e as Error).name !== 'AbortError') results.innerHTML = '<li class="error">No se pudo buscar. ¿Hay conexión?</li>';
        }
      }, 450);
    };
    q.onkeydown = e => {
      if (e.key === 'Enter') { const first = results.querySelector('li'); if (first && !results.classList.contains('hidden')) first.click(); }
      if (e.key === 'Escape') results.classList.add('hidden');
    };

    const finish = (r: StartResult) => { root.remove(); resolve(r); };

    const loadNew = async () => {
      if (!place) return;
      const p = place;
      const rad = +radius.value;
      const key = cityKey(p.lat, p.lon, rad);
      go.disabled = true; q.disabled = true; radius.disabled = true;
      cancel.classList.remove('hidden');
      bar.classList.remove('hidden');
      barFill.style.width = '2%';
      abort = new AbortController();
      try {
        const cached = await cache.getCity(key);
        if (cached && cached.version === CITY_VERSION) {
          progress.textContent = 'Ya tenías este mapa guardado.';
          const save = await cache.getSave<SaveData>(key);
          finish({ city: cached, key, save });
          return;
        }
        progress.textContent = 'Conectando con OpenStreetMap…';
        const res = await fetchCity(p.lat, p.lon, rad, CORE_RADIUS, pr => {
          const what = pr.parts === 2 ? (pr.part === 1 ? 'el centro (calles y edificios)' : 'el área metropolitana (calles principales y zonas)') : 'calles y edificios';
          const base = pr.parts === 2 && pr.part === 2 ? 50 : 0;
          if (pr.phase === 'connecting') progress.textContent = `Conectando con ${pr.server}${pr.attempt ? ' (reintento)' : ''} para ${what}… puede tardar un minuto`;
          else if (pr.phase === 'downloading') {
            const mb = pr.bytes / 1e6;
            progress.textContent = `Descargando ${what}… ${mb.toFixed(1)} MB`;
            barFill.style.width = `${Math.min(base + 40, base + 5 + mb * 4)}%`;
          } else progress.textContent = 'Leyendo el mapa…';
        }, abort.signal);
        barFill.style.width = '95%';
        await new Promise(r => setTimeout(r, 30));
        const { city, stats } = parseOsm(res, p.name, p.lat, p.lon, rad);
        if (!stats.roads) throw new Error('No hay calles en esa zona. Prueba con otro sitio.');
        progress.textContent = `${stats.roads} calles, ${stats.buildings} edificios y ${stats.areas} zonas verdes. ¡Vamos!`;
        barFill.style.width = '100%';
        await cache.putCity(key, city).catch(() => undefined);
        const save = await cache.getSave<SaveData>(key).catch(() => undefined);
        finish({ city, key, save });
      } catch (e) {
        const msg = (e as Error).message;
        progress.innerHTML = `<span class="error">${msg === 'cancelado' ? 'Cancelado.' : msg}</span>`;
        bar.classList.add('hidden');
        go.disabled = false; q.disabled = false; radius.disabled = false;
        cancel.classList.add('hidden');
      }
    };
    go.onclick = loadNew;
    cancel.onclick = () => abort?.abort();

    // ciudades ya descargadas
    cache.listCities().then(async cities => {
      if (!cities.length) return;
      cities.sort((a, b) => b.fetchedAt - a.fetchedAt);
      saved.classList.remove('hidden');
      for (const c of cities) {
        const key = cityKey(c.lat, c.lon, c.radius);
        const save = await cache.getSave<SaveData>(key);
        const li = el('li');
        const info = save ? `día ${Math.floor(save.minute / 1440) + 1}` : 'sin empezar';
        li.innerHTML = `<span><b>${c.name}</b> · ${fmtKm(c.radius)} · <small>${info}</small></span>`;
        const play = el('button', 'btn small', save ? 'Continuar' : 'Jugar');
        play.onclick = () => {
          if (c.version === CITY_VERSION) { finish({ city: c, key, save }); return; }
          // mapa guardado con un formato antiguo: se vuelve a descargar conservando la partida
          place = { name: c.name, displayName: c.name, lat: c.lat, lon: c.lon, type: 'city' };
          radius.value = String(c.radius); radiusLabel.textContent = fmtKm(c.radius);
          chosen.innerHTML = `<b>${c.name}</b> · el mapa se actualizará al cargar`;
          void loadNew();
        };
        const del = el('button', 'btn small', '✕');
        del.title = 'Borrar';
        del.onclick = async () => { await cache.deleteCity(key); await cache.deleteSave(key); li.remove(); if (!savedList.children.length) saved.classList.add('hidden'); };
        li.append(play, del);
        savedList.appendChild(li);
      }
    }).catch(() => undefined);

    document.title = GAME_NAME;
    q.focus();
  });
}
