/**
 * ⚠️ MANIFEST DE ESTILOS VISUALES
 * =====================================================
 * Cada archivo .css dentro de esta carpeta "css/" es un estilo
 * completo de la interfaz (debe definir TODAS las clases usadas
 * por la app; toma el más cercano como base y cópialo).
 *
 * Para añadir un estilo nuevo, haz 2 cosas:
 *   1. Copia un CSS existente en esta carpeta (p.ej. "midi.css")
 *      y modifícalo a tu gusto.
 *   2. Añade una línea aquí abajo:
 *        { id: 'midi', name: 'Mi Estilo', file: 'midi.css' },
 *
 * El primero de la lista se usa por defecto si el visitante
 * todavía no ha elegido ninguno. La elección y el modo
 * claro/oscuro se guardan en el navegador (localStorage).
 *
 * Nota: es un archivo estático, no hay forma fiable de listar
 * la carpeta solos: este manifest es la lista oficial.
 */

window.AVAILABLE_THEMES = [
  { id: 'default',   name: 'Clásico Oscuro', file: 'default.css' },
  { id: 'editorial', name: 'Ruta de Papel',  file: 'editorial.css' }
  // , { id: 'mitema', name: 'Mi Tema', file: 'mitema.css' }
];
