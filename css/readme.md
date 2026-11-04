# Carpeta css/

- `default.css`  → estilo por defecto (Clásico Oscuro).
- `editorial.css` → estilo "Ruta de Papel" (claro/oscuro verde-bosque).
- `themes.js`    → **manifest de estilos**: cada archivo .css de esta carpeta es un estilo; añade una línea en `themes.js` para que aparezca en el selector (icons 🎨 del header).

## Cómo crear un estilo nuevo

1. Copia p.ej. `default.css` a `mitema.css` y modifícalo.
2. En `themes.js`, añade:
   ```js
   { id: 'mitema', name: 'Mi Tema', file: 'mitema.css' },
   ```
3. ¡Listo! Aparecerá automáticamente en el desplegable 🎨 de la app.

Los estilos deben definir el mismo set de clases (copia entero un CSS existente como base) y opcionalmente un tema claro/oscuro vía `[data-theme="light"]` / `[data-theme="dark"]`.
