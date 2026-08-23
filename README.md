# ⛽ Consulta de Precios de Carburantes — MITECO

Aplicación web estática (HTML + CSS + JS puro, sin frameworks ni backend) que descarga y muestra en tiempo real los precios oficiales de todas las gasolineras de España, según los datos publicados por el **Ministerio para la Transición Ecológica y el Reto Demográfico (MITECO)**.

Compatible con **GitHub Pages** y cualquier servidor de archivos estáticos.

---

## ¿Qué hace?

- Descarga automáticamente la base de datos oficial con **más de 11.000 estaciones de servicio** de toda España.
- Permite buscar, filtrar y comparar precios de gasolina 95, diésel, 98, GLP, GNC, AdBlue y combustibles renovables.
- Muestra las gasolineras en un **mapa interactivo** con marcadores de colores según el precio (verde = barata, amarillo = media, rojo = cara).
- Calcula estadísticas: precio mínimo, precio medio, precio máximo y **ahorro potencial** por llenar un depósito de 50L comparado con la media.
- Permite ordenar y agrupar resultados por municipio, marca o provincia.
- Guarda gasolineras favoritas en el navegador (sin necesidad de cuenta ni login).
- Exporta los resultados filtrados a **CSV** o **JSON**.
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
- **Chips de marcas rápidas**: GM OIL, Esclatoil/Bonpreu, Plenoil, Ballenoil, Petroprix, Repsol, Cepsa, BP, Galp, Shell, Alcampo, Carrefour.
- **Selector de provincia** y luego **selector de municipio** (se rellena automáticamente según la provincia elegida).
- **Tipo de combustible** (barra superior con pestañas).
- **Ordenación**: más barato primero, más caro primero, por distancia (requiere activar ubicación GPS), por nombre, por municipio.
- **Agrupación**: sin agrupar, por municipio, por rótulo/marca, por provincia.
- **Solo favoritas**: muestra únicamente las gasolineras que hayas marcado como favoritas.

### Mapa interactivo (`js/map.js`)

Usa **Leaflet** con tiles de CartoDB Voyager. Los marcadores se agrupan automáticamente con **MarkerCluster** — cuando hay muchos, aparecen como burbujas con el número de gasolineras. Al acercar el zoom se despliegan individualmente.

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
| `provincia` | Nombre exacto en mayúsculas, ej: `BARCELONA` | Filtra por provincia |
| `municipio` | Nombre exacto, ej: `Manlleu` | Filtra por municipio |
| `orden` | `price_asc`, `price_desc`, `rotulo_asc`, `municipio_asc`, `distance_asc` | Criterio de ordenación |
| `agrupar` | `none`, `municipio`, `rotulo`, `provincia` | Agrupa los resultados |
| `vista` | `split`, `list`, `tabla`, `map` | Vista inicial al abrir |
| `format` | `json` | Activa el modo desarrollador: muestra el JSON en bruto sin la interfaz visual |

### Ejemplos de enlaces directos

**Gasolineras más baratas de Manlleu ordenadas por precio:**
```
https://tu-usuario.github.io/miteco-carburantes/?municipio=Manlleu&combustible=gasolina95
```

**Todas las estaciones GM OIL de España con diésel:**
```
https://tu-usuario.github.io/miteco-carburantes/?rotulo=GM+OIL&combustible=gasoleoA
```

**Estaciones Esclatoil y Bonpreu en Gasolina 95:**
```
https://tu-usuario.github.io/miteco-carburantes/?rotulo=ESCLATOIL|BONPREU&combustible=gasolina95
```

**Vista tabla, agrupada por municipio, provincia de Girona:**
```
https://tu-usuario.github.io/miteco-carburantes/?provincia=GIRONA&agrupar=municipio&vista=tabla
```

**Las 10 más baratas de Barcelona ciudad (diésel), vista mapa:**
```
https://tu-usuario.github.io/miteco-carburantes/?municipio=Barcelona&combustible=gasoleoA&vista=map
```

**Obtener los datos en formato JSON puro (para usar desde otra app o script):**
```
https://tu-usuario.github.io/miteco-carburantes/?municipio=Manlleu&combustible=gasolina95&format=json
```

---

## Cómo publicar en GitHub Pages

1. Crea un repositorio en GitHub (puede ser público o privado con GitHub Pro).
2. Sube todos los archivos del proyecto:
   ```
   index.html
   css/styles.css
   js/api.js
   js/map.js
   js/chart.js
   js/app.js
   ```
3. Ve a **Settings → Pages** en tu repositorio.
4. En "Source", selecciona la rama `main` (o `master`) y la carpeta raíz `/`.
5. Guarda. En unos segundos la app estará disponible en:
   ```
   https://tu-usuario.github.io/nombre-del-repositorio/
   ```

> **Nota importante sobre geolocalización:** La función "Mi ubicación" solo funciona en conexiones **HTTPS**. GitHub Pages sirve siempre con HTTPS, así que en producción funcionará correctamente. En local con `python -m http.server` puede fallar porque es HTTP.

---

## Archivos del proyecto

```
miteco-carburantes/
├── index.html          → Estructura HTML de la aplicación (única página)
├── css/
│   └── styles.css      → Todo el diseño visual (temas claro/oscuro, mapa, tabla, modales)
└── js/
    ├── api.js          → Descarga de datos, caché, filtros y motor de búsqueda
    ├── map.js          → Mapa Leaflet, marcadores y popups
    ├── chart.js        → Gráfica de distribución de precios y estadísticas
    └── app.js          → Controlador principal: UI, eventos, tabla, exportación, URL
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
