# 🚗 Consulta de Precios de Carburantes — MITECO

Aplicación web estática (HTML + CSS + JS puro, sin frameworks ni backend) que descarga y muestra en tiempo real los precios oficiales de todas las gasolineras de España, según los datos publicados por el **Ministerio para la Transición Ecológica y el Reto Demográfico (MITECO)**.

## 🎨 Sistema de estilos intercambiables

El proyecto incluye varios estilos visuales completos. El selector 🎨 del header permite cambiar entre ellos y **la elección se guarda en el navegador** (igual que el modo claro/oscuro).

- Añadir un estilo nuevo = copiar un `.css` en `css/` + añadir una línea en `css/themes.js` (ver [css/readme.md](css/readme.md)).
- Estilos incluidos: **Clásico Oscuro** (`default.css`) y **Ruta de Papel** (`editorial.css`).

---

## ¿Qué hace?

- Descarga automáticamente la base de datos oficial con **más de 11.000 estaciones de servicio** de toda España.
- Permite buscar, filtrar y comparar precios de gasolina 95, diésel, 98, GLP, GNC, AdBlue y combustibles renovables.
- Muestra las gasolineras en un **mapa interactivo** con marcadores de colores según el precio (verde = barata, amarillo = media, rojo = cara).
- Calcula estadísticas: precio mínimo, precio medio, precio máximo y **ahorro potencial** por llenar un depósito de 50L comparado con la media.
- Permite ordenar y agrupar resultados por municipio, marca o provincia.
- Guarda gasolineras favoritas en el navegador (sin necesidad de cuenta ni login).
- Genera un enlace compartible con todos los filtros aplicados.

---

## Cómo funciona por dentro

### Descarga de datos (`js/api.js`)

Al abrir la aplicación, intenta descargar el JSON oficial del MITECO (~12 MB) de estas formas en orden:

1. **Petición directa** a `https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/...`
2. Si falla (por CORS u otras restricciones de red), prueba con **proxies públicos de respaldo**:
   - `https://api.allorigins.win/raw?url=...`
   - `https://corsproxy.io/?...`
   - `https://api.codetabs.com/v1/proxy?quest=...`
3. Si ninguno funciona, usa la **caché guardada localmente** (IndexedDB del navegador).

Los datos descargados se guardan en **IndexedDB** con una caducidad de 30 minutos. La próxima vez que abras la app, los datos se cargan instantáneamente desde la caché sin hacer ninguna petición nueva.

Los precios del JSON del MITECO vienen con coma decimal española (`"1,589"`). La app los convierte a número (`1.589`) para poder operar con ellos. Las coordenadas también vienen con coma (`"41,38879"`) y se convierten igual.

### Filtros y búsqueda en vivo (`js/app.js`)

Todos los filtros se aplican **en memoria** sobre los 11.000+ registros ya descargados. No hay ninguna petición adicional al filtrar. El campo de búsqueda funciona sobre un índice de texto que combina rótulo + municipio + provincia + dirección + código postal, todo normalizado sin tildes y en minúsculas para que, por ejemplo, buscar "Manlleu" también encuentre "MANLLEU".

Los filtros disponibles son:
- **Campo de búsqueda libre**: busca en rótulo, municipio, dirección y código postal.
- **Lista de resultados paginada**: debajo de las tarjetas hay una barra con selector de **cuántas estaciones cargar por página (10 / 30 / 50)** y botones ▶ ◀ para saltar entre páginas. Con la opción **"♾️ Todas (cargan al bajar)"**, modo lazy: se muestra el primer bloque y al llegar al final del scroll se cargan automáticamente los siguientes, sin límite de estaciones.
- **Selector de provincia (multiselección)**: pulsándolo se despliega un panel con casillas y un **buscador** — escribe "barcelona" (incluso sin tildes) y filtra al instante; útil en móvil, donde las listas largas cuesten hacer scroll. Puedes dejar **varias provincias seleccionadas a la vez**.
- **Selector de municipio (multiselección)**: mismo formato de panel con buscador. Puedes elegir **varios municipios, incluso de provincias distintas** (aunque para verlos hay que seleccionar también sus provincias). Si no hay provincias elegidas, se listan todos los de España (usa el buscador: hay unos 8.000). Ideal combinado con la agrupación por municipio: agrupa y compara los municipios elegidos.
- **Tipo de combustible** (barra superior con pestañas).
- **Modo GPS en tiempo real**: al pulsar "Mi ubicación", la app sigue tu posición continuamente (`watchPosition`) y muestra solo las gasolineras dentro del radio que configures (1–50 km, con deslizador o escribiendo el número directamente), actualizándose en tiempo real — pensado para usarlo mientras conduces. Mientras está activo, los filtros de provincia, municipio y búsqueda se bloquean y quedan en gris; pulsa de nuevo el botón para volver a los filtros manuales. Las estaciones con coordenadas rotas en los datos oficiales se excluyen automáticamente en este modo.
- **Ordenación**: más barato primero, más caro primero, por distancia (requiere activar ubicación GPS), por nombre, por municipio.
- **Agrupación**: sin agrupar, por municipio, por rótulo/marca, por provincia. Con las selecciones múltiples de provincia/municipio ahora sí tiene sentido: agrupar por municipio muestra un grupo por cada municipio seleccionado (ordenados por su precio mínimo).
- **Solo favoritas**: muestra únicamente las gasolineras que hayas marcado como favoritas.

### Mapa interactivo (`js/map.js`)

Usa **Leaflet** con tiles libres (sin API key ni registro). El botón de capas (abajo a la izquierda) permite elegir entre: **OSM estándar, OSM Francia, Humanitario (HOT), Topográfico (OpenTopoMap), Satélite (Esri) y Minimalista claro (Esri)** — la última elección se recuerda entre visitas. Los marcadores se agrupan automáticamente con **MarkerCluster**; al pulsar un marcador se despliegan individualmente.

En pantallas pequeñas (móvil), el mapa se muestra **siempre al principio** (antes de la lista de precios) e incluye un **botón (arriba a la izquierda) para ocultar/mostrar** el mapa.

Cada marcador tiene un color según el precio relativo a la búsqueda actual:
- 🟢 **Verde**: precio en el 25% más barato de los resultados.
- 🟡 **Amarillo**: precio medio (entre el 25% y el 75%).
- 🔴 **Rojo**: precio en el 25% más caro.

Al pulsar un marcador se abre un popup con todos los combustibles disponibles en esa gasolinera y botones para navegar con **Google Maps** o **Waze**.

### Vista Tabla (`js/app.js` → `renderDataTable`)

Muestra todos los resultados paginados de 50 en 50 en una tabla ordenable. Si se activa la agrupación, los grupos aparecen como filas expandibles/colapsables con las estadísticas de cada grupo (mínimo, media, máximo).

---

## Parámetros GET — enlaces directos y compartibles

La URL de la aplicación acepta parámetros GET para preconfigurar filtros. Esto permite crear **enlaces directos** a cualquier búsqueda sin necesidad de tocar nada en la interfaz.

### Parámetros disponibles

| Parámetro | Valores | Descripción |
|---|---|---|
| `combustible` | `gasolina95`, `gasoleoA`, `gasolina98`, `gasoleoPremium`, `gasoleoB`, `glp`, `gnc`, `adblue`, `dieselRenovable`, `hidrogeno` | Tipo de combustible a mostrar |
| `buscar` | Texto libre | Búsqueda en rótulo, municipio, dirección y CP |
| `rotulo` | Texto libre | Filtro específico por rótulo/marca (puede usar `\|` para OR, ej: `REPSOL\|CAMPSA`) |
| `provincia` | Nombre(s) exacto(s), ej: `BARCELONA` o varios separados por `\|`: `BARCELONA\|GIRONA` | Filtra por provincia (multiselección) |
| `municipio` | Nombre(s) exacto(s), ej: `Manlleu` o varios separados por `\|`: `Manlleu\|Vic` | Filtra por municipio (multiselección, incluso de distintas provincias) |
| `orden` | `price_asc`, `price_desc`, `rotulo_asc`, `municipio_asc`, `distance_asc` | Criterio de ordenación |
| `agrupar` | `none`, `municipio`, `rotulo`, `provincia` | Agrupa los resultados |
| `vista` | `split`, `list`, `tabla`, `map` | Vista inicial al abrir |

### Ejemplos de enlaces directos

**Estaciones Esclatoil y Bonpreu en Gasolina 95:**
```
https://tu-usuario.github.io/miteco-carburantes/?rotulo=ESCLATOIL|BONPREU&combustible=gasolina95
```

**Las 10 más baratas de Barcelona ciudad (diésel), vista mapa:**
```
https://tu-usuario.github.io/miteco-carburantes/?municipio=Barcelona&combustible=gasoleoA&vista=map
```

**Dos municipios (Manlleu y Vic, Barcelona) agrupados por municipio — compara localidades vecinas de un vistazo:**
```
https://tu-usuario.github.io/miteco-carburantes/?provincia=BARCELONA&municipio=Manlleu|Vic&agrupar=municipio&combustible=gasolina95
```

---

## Archivos del proyecto

```
./
├── index.html            → Estructura HTML de la aplicación (única página)
├── css/
│   ├── themes.js         → Manifest de estilos (cada .css de la carpeta = un estilo)
│   ├── default.css       → Estilo "Clásico Oscuro" (por defecto)
│   ├── editorial.css     → Estilo "Ruta de Papel"
│   └── readme.md         → Cómo crear y añadir estilos nuevos
└── js/
    ├── api.js            → Descarga de datos, caché, filtros y motor de búsqueda
    ├── map.js            → Mapa Leaflet (capas libres), marcadores y popups
    ├── chart.js          → Gráfica de distribución de precios y estadísticas
    └── app.js            → Controlador principal: UI, eventos, tabla, selector de estilos, URL
```

---

## Fuente de datos oficial

- **Organismo:** Ministerio para la Transición Ecológica y el Reto Demográfico (MITECO)
- **Endpoint REST:**
  ```
  https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes/EstacionesTerrestres/
  ```
- **Actualización:** Los datos del Ministerio se actualizan varias veces al día.
- **Datos incluidos:** +11.000 estaciones terrestres con precios de todos los combustibles regulados en España.

---

## Limitaciones conocidas

- La aplicación descarga ~12 MB de datos en la primera carga. En conexiones lentas puede tardar varios segundos.
- El JSON del MITECO no tiene CORS habilitado para todos los navegadores. Si la petición directa falla, la app usa proxies públicos de respaldo automáticamente. Si todos los proxies fallan (poco frecuente), se usan los datos guardados de la última sesión.
- La función de distancia GPS requiere permiso explícito del usuario y conexión HTTPS.
