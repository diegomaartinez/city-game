# Little Transit

**Diseña el transporte de ciudades de verdad, sin prisas.** Busca una ciudad (Madrid, Lugo, Lisboa…), el juego descarga sus calles y edificios reales de OpenStreetMap y, a partir de ahí, los vecinos quieren moverse: pon paradas, traza líneas de bus y metro, añade vehículos y consigue que lleguen a tiempo. Al estilo de *Mini Metro*, pero sobre el plano real.

Estética *cozy* de maqueta, con la misma paleta que [Little Drives](https://littledrives.com/): arena, tinta, crema y coral.

## Cómo se juega

- **La ciudad genera viajeros**: las viviendas (crema) emiten viajes hacia comercios (azul), industria (oliva) y equipamientos (coral) por la mañana, y a la inversa por la tarde. La demanda crece un poco cada día.
- **Paradas**: una parada de bus se pega a la calle más cercana; una estación de metro va donde quieras. Cada una atrae a quien vive a unos minutos a pie (330 m el bus, 500 m el metro).
- **Líneas**: elige bus o metro y haz clic en las paradas por orden. El **bus** recorre las calles reales (respeta los sentidos únicos cuando puede); el **metro** une estaciones en línea recta por túnel, que se paga por metro. Clic en la primera parada para cerrar un bucle; si no, la línea va y vuelve.
- **Vehículos**: cada línea arranca con uno; añade más desde el panel. Tienen capacidad y velocidad distintas y cuestan mantenimiento diario.
- **Viajeros**: esperan en las paradas (puntitos), hacen transbordo si hace falta y se van si esperan demasiado. Los que no tienen parada cerca aparecen como puntos coral; `G` muestra el mapa de demanda sin cubrir.
- **Dinero**: cada viaje completado paga billete; al final del día recibes el informe (viajes, satisfacción, balance).

| Acción | Tecla |
|---|---|
| Mover / seleccionar | `1` (botón derecho o central del ratón en cualquier herramienta) |
| Parada de bus / estación de metro | `B` / `M` |
| Nueva línea de bus / de metro | `L` / `K` (clic en las paradas; `Enter` termina) |
| Quitar parada | `D` |
| Demanda sin cubrir | `G` |
| Pausa · rápido · muy rápido | `Espacio` · `2` · `3` |
| Menú / cancelar | `Esc` |

## Desarrollo

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # comprueba tipos y genera dist/
```

- **Vite + TypeScript + PixiJS 8** (WebGL). Sin motor de juego: el mapa se dibuja con `Graphics` por capas y teselas, y solo se renderizan las teselas visibles.
- **Datos** (`src/data/`): [Nominatim](https://nominatim.org/) para buscar la ciudad y la [API Overpass](https://overpass-api.de/) para calles (con puentes y túneles), edificios, parques y agua, con varios servidores de respaldo. Todo se proyecta a metros alrededor del centro (`geo.ts`) y se guarda en IndexedDB (`cache.ts`).
- **Simulación** (`src/sim/`): grafo de calles con A* (`graph.ts`), red de transporte con paradas, líneas, vehículos y planificación de viajes con transbordos (`transit.ts`), generación de demanda a partir de los edificios (`demand.ts`) y estado de la partida, economía e informes (`game.ts`).
- **Render** (`src/render/`) e **interfaz** (`src/ui/`, DOM encima del canvas).

Datos del mapa © colaboradores de [OpenStreetMap](https://www.openstreetmap.org/copyright), licencia ODbL.
