// Inline SVG icon set (polish item 16).
//
// AUTHORING NOTE: bundle source, not a Node module — see panel.js.
//
// Why a dedicated module: both panel.js and install.js draw icons, and a
// panel.js <-> install.js cycle would break under the hand-rolled bundler's
// `__require` (the cached record is published before the module body runs, so a
// top-level destructure of a half-executed sibling yields `undefined`).
//
// No emoji and no text glyphs (decorative triangles, sparkles): those render
// differently per platform, inherit the wrong metrics, and cannot take
// `currentColor` reliably.

const React = require('react')

const h = React.createElement

/** Shared stroke defaults; individual paths override where they need fill. */
const STROKE = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
}

const SOLID = { fill: 'currentColor', stroke: 'none' }

/**
 * Geometry for every glyph, on a 16x16 grid.
 *
 * Values are `[tagName, props]` pairs so the whole set is data — which is what
 * lets the bundle test render each one and prove the table has no broken entry.
 */
const PATHS = {
  search: [
    ['circle', { cx: 6.9, cy: 6.9, r: 4.3 }],
    ['path', { d: 'M10.1 10.1 14 14' }],
  ],
  plus: [
    ['path', { d: 'M8 3.2v9.6' }],
    ['path', { d: 'M3.2 8h9.6' }],
  ],
  minus: [['path', { d: 'M3.2 8h9.6' }]],
  refresh: [
    ['path', { d: 'M13.1 8a5.1 5.1 0 1 1-1.6-3.7' }],
    ['path', { d: 'M13.6 2.9v3.5H10.1' }],
  ],
  close: [
    ['path', { d: 'M4 4l8 8' }],
    ['path', { d: 'M12 4 4 12' }],
  ],
  trash: [
    ['path', { d: 'M2.9 4.6h10.2' }],
    ['path', { d: 'M6.2 4.6V3.2h3.6v1.4' }],
    ['path', { d: 'M4.4 4.6l.7 8.2h5.8l.7-8.2' }],
    ['path', { d: 'M6.8 7v3.6' }],
    ['path', { d: 'M9.2 7v3.6' }],
  ],
  check: [['path', { d: 'M3.4 8.5 6.4 11.5 12.7 4.9' }]],
  warning: [
    ['path', { d: 'M8 2.6 14.5 13.5H1.5z' }],
    ['path', { d: 'M8 6.4v3.3' }],
    ['path', { d: 'M8 11.7h.01' }],
  ],
  link: [
    ['path', { d: 'M6.6 9.4a2.9 2.9 0 0 1 0-4.1l1.5-1.5a2.9 2.9 0 0 1 4.1 4.1l-.8.8' }],
    ['path', { d: 'M9.4 6.6a2.9 2.9 0 0 1 0 4.1l-1.5 1.5a2.9 2.9 0 0 1-4.1-4.1l.8-.8' }],
  ],
  upload: [
    ['path', { d: 'M8 11.2V3.6' }],
    ['path', { d: 'M4.8 6.8 8 3.6l3.2 3.2' }],
    ['path', { d: 'M3 12.6h10' }],
  ],
  download: [
    ['path', { d: 'M8 3.6v7.6' }],
    ['path', { d: 'M4.8 8 8 11.2 11.2 8' }],
    ['path', { d: 'M3 12.6h10' }],
  ],
  git: [
    ['circle', { cx: 4.2, cy: 3.6, r: 1.7 }],
    ['circle', { cx: 4.2, cy: 12.4, r: 1.7 }],
    ['circle', { cx: 11.8, cy: 6.2, r: 1.7 }],
    ['path', { d: 'M4.2 5.3v5.4' }],
    ['path', { d: 'M10.1 6.2H7.4a3.2 3.2 0 0 0-3.2 3.2v1.3' }],
  ],
  copy: [
    ['rect', { x: 3.3, y: 3.3, width: 6.4, height: 6.4, rx: 1.7 }],
    ['path', { d: 'M6.4 12.7h4.6a1.7 1.7 0 0 0 1.7-1.7V6.4' }],
  ],
  spark: [
    ['path', { d: 'M8 2.2 9.4 6.6 13.8 8 9.4 9.4 8 13.8 6.6 9.4 2.2 8 6.6 6.6z' }],
  ],
  caret: [['path', { d: 'M6 3.6 10.4 8 6 12.4' }]],
  caretDown: [['path', { d: 'M3.6 6 8 10.4 12.4 6' }]],
  folder: [
    ['path', { d: 'M2.3 4.4h4.3l1.4 1.8h5.7v6.4H2.3z' }],
  ],
  info: [
    ['circle', { cx: 8, cy: 8, r: 5.9 }],
    ['path', { d: 'M8 7.3v3.9' }],
    ['path', { d: 'M8 5.1h.01' }],
  ],
  dot: [['circle', { cx: 8, cy: 8, r: 2.6 }]],
  ban: [
    ['circle', { cx: 8, cy: 8, r: 5.9 }],
    ['path', { d: 'M4.1 4.1 11.9 11.9' }],
  ],
  file: [
    ['path', { d: 'M4 2.4h5l3 3v8.2H4z' }],
    ['path', { d: 'M9 2.4v3h3' }],
  ],
  layers: [
    ['path', { d: 'M8 2.4 14 5.6 8 8.8 2 5.6z' }],
    ['path', { d: 'M2 8.4 8 11.6l6-3.2' }],
    ['path', { d: 'M2 11 8 14.2 14 11' }],
  ],
  clock: [
    ['circle', { cx: 8, cy: 8, r: 5.9 }],
    ['path', { d: 'M8 4.6V8l2.4 1.6' }],
  ],
  sort: [
    ['path', { d: 'M4.6 3.6v8.8' }],
    ['path', { d: 'M2.4 10.2 4.6 12.4 6.8 10.2' }],
    ['path', { d: 'M9.2 5.2h4.4' }],
    ['path', { d: 'M9.2 8h3' }],
    ['path', { d: 'M9.2 10.8h1.6' }],
  ],
  grid: [
    ['rect', { x: 2.6, y: 2.6, width: 4.4, height: 4.4, rx: 1.3 }],
    ['rect', { x: 9, y: 2.6, width: 4.4, height: 4.4, rx: 1.3 }],
    ['rect', { x: 2.6, y: 9, width: 4.4, height: 4.4, rx: 1.3 }],
    ['rect', { x: 9, y: 9, width: 4.4, height: 4.4, rx: 1.3 }],
  ],
}

const NAMES = Object.keys(PATHS)

/** Fallback geometry so an unknown name renders a neutral mark, never a hole. */
const FALLBACK = PATHS.info

/**
 * One icon.
 *
 * @param props.name - key of PATHS; unknown names fall back to `info`.
 * @param props.size - pixel box; the glyph scales, the 16x16 grid does not.
 * @param props.title - accessible name; omit for a decorative icon (aria-hidden).
 */
function Icon({ name, size = 14, className, style, title }) {
  const geometry = PATHS[name] ?? FALLBACK
  const children = geometry.map(([tag, props], i) => h(tag, { key: i, ...(props.fill === undefined ? STROKE : SOLID), ...props }))
  if (title !== undefined) children.unshift(h('title', { key: 'title' }, title))
  return h(
    'svg',
    {
      className: className === undefined ? 'sr-ic' : className,
      width: size,
      height: size,
      viewBox: '0 0 16 16',
      'aria-hidden': title === undefined ? 'true' : undefined,
      role: title === undefined ? undefined : 'img',
      focusable: 'false',
      style,
    },
    ...children,
  )
}

module.exports = { Icon, PATHS, ICON_NAMES: NAMES }
