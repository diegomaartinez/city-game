# Little Cities

**Construye sobre ciudades de verdad, sin prisas.** Busca una ciudad (Madrid, Lugo, Lisboa…), el juego descarga sus calles y edificios reales de OpenStreetMap y, a partir de ahí, la ciudad es tuya: recalifica terrenos, traza calles, coloca servicios y mira cómo crece y cómo se mueve el tráfico.

Estética *cozy* de maqueta, con la misma paleta que [Little Drives](https://littledrives.com/): arena, tinta, crema y coral.

## Cómo se juega

- **Elige una ciudad** y un radio (0,5–3 km). Los edificios existentes ya están habitados: el juego infiere si son viviendas, comercios, industria o equipamientos a partir de las etiquetas del mapa.
- **Zonifica** terreno libre junto a una calle como residencial, comercial o industrial. Cuando hay demanda (barras R/C/I), se construyen edificios, que crecen en altura si se llenan.
- **Recalifica**: pinta una zona sobre edificios existentes y, cuando haya demanda del nuevo uso, se irán derribando y reconstruyendo.
- Las zonas nuevas necesitan **luz y agua** (central eléctrica y depuradora). Comisarías, bomberos, centros de salud, colegios y parques suben la **felicidad**, y con ella la ocupación.
- **Traza calles** (calle, avenida o vía principal) y **demuele** lo que estorbe, edificio a edificio o por áreas.
- **Tráfico**: los coches van de casa al trabajo por las calles reales; los tramos saturados se ven con la capa de tráfico (`G`).
- Cada mes cobras impuestos y pagas mantenimiento. La partida se guarda sola en el navegador.

| Acción | Tecla |
|---|---|
| Mover / ver detalles | `1` (o botón derecho / central del ratón en cualquier herramienta) |
| Zona residencial / comercial / industrial | `R` `C` `I` |
| Quitar zona | `X` |
| Trazar calle | `T` |
| Demoler | `D` |
| Servicios | `S` |
| Capa de tráfico | `G` |
| Pausa · rápido · muy rápido | `Espacio` · `2` · `3` |
| Menú / cancelar | `Esc` |

## Desarrollo

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # comprueba tipos y genera dist/
```

- **Vite + TypeScript + PixiJS 8** (WebGL). Sin motor de juego: el mundo se dibuja con `Graphics` por capas y los edificios por teselas de 256 m.
- **Datos**: [Nominatim](https://nominatim.org/) para buscar la ciudad y la [API Overpass](https://overpass-api.de/) para calles, edificios, parques y agua (`src/data/overpass.ts`, con varios servidores de respaldo). Todo se proyecta a metros alrededor del centro (`src/data/geo.ts`) y se guarda en IndexedDB (`src/data/cache.ts`).
- **Simulación** (`src/sim/`): rejilla de celdas de 12 m (`grid.ts`), grafo de calles con A* (`graph.ts`), reglas de crecimiento, servicios y economía (`city.ts`, parámetros en `defs.ts`) y tráfico (`traffic.ts`).
- **Render** (`src/render/`) e **interfaz** (`src/ui/`, DOM encima del canvas).

Datos del mapa © colaboradores de [OpenStreetMap](https://www.openstreetmap.org/copyright), licencia ODbL.
