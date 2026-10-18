# Little Transit

**Diseña el transporte de ciudades de verdad, sin prisas.** Elige un nivel: una ciudad (A Coruña y su área metropolitana) con sus calles y edificios reales de OpenStreetMap, o el **modo país** (España, Portugal y Andorra, con Baleares, Canarias, Ceuta y Melilla) donde unes ciudades en tren, bus, avión y barco. En la ciudad, a partir de ahí, los vecinos quieren moverse: pon paradas, traza líneas de bus y metro, añade vehículos y consigue que lleguen a tiempo. Al estilo de *Mini Metro*, pero sobre el plano real.

**Juega en el navegador:** https://diegomaartinez.github.io/city-game/ (se publica solo desde `main` con GitHub Actions).

Estilo propio de plano de transporte: ciudad discreta sobre papel claro y las líneas como protagonistas. En el menú se puede cambiar a *Sencillo*, *Realista* (tipo mapa web) o *Maqueta* (la paleta de [Little Drives](https://littledrives.com/)).

## Cómo se juega

- **La ciudad genera viajeros**: cada punto representa a 10 personas; cuántos salen de cada edificio depende de su superficie y sus plantas (población estimada por edificio). Van de casa al trabajo, las tiendas y los equipamientos por la mañana, y a la inversa por la tarde. La demanda crece un poco cada día.
- **Mar y ríos**: la costa se construye a partir de `natural=coastline`, así que el mar, los puertos y las playas se distinguen del resto del agua.
- **Paradas**: una parada de bus se pega a la calle más cercana; una estación de metro va donde quieras. Cada una atrae a quien vive a unos minutos a pie (330 m el bus, 500 m el metro).
- **Líneas**: elige bus o metro y haz clic en las paradas por orden. El **bus** recorre las calles reales (respeta los sentidos únicos cuando puede); el **metro** une estaciones en línea recta por túnel, que se paga por metro. Clic en la primera parada para cerrar un bucle; si no, la línea va y vuelve.
- **Recorrido**: con una línea seleccionada, arrástrala para llevarla por donde quieras sin añadir paradas (puntos de paso que se mueven y se quitan con `D`).
- **Vehículos**: cada línea arranca con uno; añade más desde el panel. Tienen capacidad y velocidad distintas y cuestan mantenimiento diario.
- **Ciudades (niveles)**: cada ciudad viene ya preparada en `public/levels/` (un `.json.gz` por nivel más `index.json`), así que carga al instante sin depender de Overpass. El núcleo urbano tiene todos sus edificios; en el resto del área metropolitana hay calles principales y zonas de uso del suelo (residencial, comercial, industrial) que generan viajeros según su superficie. El mapa jugable es un cuadrado que flota sobre el fondo.
- **Barrios**: la ciudad se divide en barrios (los de OSM si tienen nombre; si no, por cercanía) y cada uno lleva una ficha con habitantes, empleos y vecinos sin servicio hoy (`F` las oculta). Los vecinos que quieren viajar y no tienen parada cerca se acumulan como siluetas en su barrio: ahí hace falta una parada. Cada viajero que espera lleva el color del barrio al que va.
- **Viajeros**: esperan en las paradas, hacen transbordo si hace falta y se van si esperan demasiado. `G` alterna las capas: flujos entre barrios (arcos; rojo = no pueden viajar), demanda sin cubrir por hexágono y población/empleos por hexágono.
- **Modos de juego**: *Fácil* (subvención municipal diaria y el ayuntamiento cubre los descubiertos), *Normal* (balance real: cinco días seguidos en negativo y pierdes la concesión; hay préstamos al 0,4 % diario) y *Creativo* (dinero infinito y todo desbloqueado; el objetivo es mover al máximo de viajeros).
- **Hitos**: en fácil y normal empiezas con dos líneas de bus. Al alcanzar cierta cantidad de viajeros (en un día o acumulados, proporcional a la población) desbloqueas más líneas, el metro y premios en dinero. La barra bajo el reloj muestra el siguiente hito.
- **Dinero**: cada viaje completado paga billete (precio ajustable por modo: cuanto más caro, más vecinos renuncian); cada vehículo cuesta mantenimiento diario. La barra superior muestra el balance previsto del día. `R` abre el **resumen** con población, demanda, barrios con más demanda sin cubrir, oferta, finanzas (subvención, intereses, préstamos), precios, costes, hitos y una tabla por línea. Al final del día recibes el informe.

| Acción | Tecla |
|---|---|
| Mover / seleccionar | `1` (botón derecho o central del ratón en cualquier herramienta) |
| Parada de bus / estación de metro | `B` / `M` |
| Nueva línea de bus / de metro | `L` / `K` (clic en las paradas; `Enter` termina) |
| Quitar parada | `D` |
| Resumen (demanda, oferta, finanzas, precios) | `R` |
| Capas: flujos entre barrios / demanda sin cubrir / población | `G` |
| Fichas de barrio | `F` |
| Pausa · rápido · muy rápido | `Espacio` · `2` · `3` |
| Menú / cancelar | `Esc` |

## Modo país

- Todas las ciudades de más de 50.000 habitantes de España, Portugal y Andorra (más capitales de provincia menores, Ceuta, Melilla y Gibraltar), con su población real. La demanda entre dos ciudades sigue un modelo de gravedad: población × población / distancia^1,6.
- **Tren**: vía nueva pagada por kilómetro, rápido y de gran capacidad. **Bus**: barato y lento, circula por las autopistas reales (OSM). **Avión**: solo entre ciudades con aeropuerto (dato de OSM), muy rápido. **Barco**: solo entre ciudades costeras; si el trazado cruza tierra avisa y se arrastra para rodear la costa. Transbordos entre modos en la misma ciudad.
- Canarias va en un recuadro abajo a la derecha, pero los tiempos de viaje usan la distancia real.
- Cada punto son 100 personas y el dinero va en millones; los mismos modos de juego, préstamos e hitos (empiezas con tren y bus; el avión y el barco se desbloquean).
- Se construye con `scripts/build-country.ts`: costa y fronteras de Natural Earth (paquete `world-atlas`), ciudades, aeropuertos y autopistas de Overpass.

## Desarrollo

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # comprueba tipos y genera dist/
```

- **Vite + TypeScript + PixiJS 8** (WebGL). Sin motor de juego: el mapa se dibuja con `Graphics` por capas y teselas, y solo se renderizan las teselas visibles.
- **Datos** (`src/data/`): la [API Overpass](https://overpass-api.de/) para calles (con puentes y túneles), edificios, parques, agua, línea de costa y barrios. Todo se proyecta a metros alrededor del centro (`geo.ts`) y el mar se cierra a partir de la costa (`coast.ts`). Las partidas se guardan en IndexedDB (`cache.ts`).
- **Niveles**: `levels/levels.json` define cada ciudad (centro, lado del cuadrado y rectángulo del núcleo con edificios). `scripts/build-levels.ts` la descarga y empaqueta en `public/levels/`; el workflow *Construir niveles* lo ejecuta en GitHub Actions (a mano desde la pestaña Actions, o al cambiar `levels.json`) y sube el resultado al repo. Para añadir una ciudad basta con añadirla a `levels.json`.
- **Simulación** (`src/sim/`): grafo de calles con A* (`graph.ts`), red de transporte con paradas, líneas, vehículos y planificación de viajes con transbordos (`transit.ts`), generación de demanda a partir de los edificios, con cuentas por barrio y por hexágono (`demand.ts`), barrios por nodos `place` de OSM o k-medias (`districts.ts`) y estado de la partida, modos, hitos, préstamos e informes (`game.ts`).
- **Render** (`src/render/`) e **interfaz** (`src/ui/`, DOM encima del canvas).

Datos del mapa © colaboradores de [OpenStreetMap](https://www.openstreetmap.org/copyright), licencia ODbL.
