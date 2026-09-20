// Assert the generated stylesheet contains no UNITLESS length.
//
// Why this exists: the record generators appended `px` only to numbers BELOW 100, on the assumption
// that "a number at or above 100 is always a length". `borderRadius: 999` broke that assumption — the
// sheet emitted `border-radius:999`, which is INVALID CSS, so the browser discarded the declaration
// and fell back to an earlier rule. Every pill in the plugin was silently a rounded rectangle, and the
// stylesheet read as perfectly correct while it happened.
//
// The existing assertions could not catch it either: they check that a DECLARATION EXISTS, and
// `border-radius:999` does exist. Only asking the browser, or validating the value's grammar, tells the
// two apart. This is the cheap half of that — the value's shape — so the mistake cannot come back
// without a test failing.
//
// Run: node tools/check-css-units.mjs   (part of `npm test`)

import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const clientDir = join(here, '..', 'src', 'client')

/** Load a `src/client` module the way the bundler and the browser half do. */
const sources = Object.fromEntries(
  readdirSync(clientDir).filter((f) => f.endsWith('.js')).map((f) => [f, readFileSync(join(clientDir, f), 'utf8')]),
)
const cache = new Map()
const load = (rel) => {
  if (cache.has(rel)) return cache.get(rel)
  const mod = { exports: {} }
  cache.set(rel, mod.exports)
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', 'require', sources[rel])(mod, mod.exports, (id) => {
    if (id === 'react') return { createElement: () => null, useState: () => [], useEffect: () => {}, useCallback: (f) => f, useMemo: (f) => f(), useRef: () => ({ current: null }) }
    if (id === 'react-dom') return {}
    if (id.startsWith('./')) return load(id.slice(2))
    throw new Error(`unexpected require: ${id}`)
  })
  cache.set(rel, mod.exports)
  return mod.exports
}

const CSS = String(load('theme.js').CSS).replace(/\/\*[\s\S]*?\*\//gu, '')

/**
 * Properties whose numeric value is legitimately unitless.
 *
 * Kept as a prefix test because the offenders are whole families — `--sr-*` custom properties,
 * `animation*`/`transition` shorthands and `grid-*` all carry bare numbers inside larger values.
 */
const UNITLESS_PREFIXES = [
  '--', 'font-weight', 'line-height', 'opacity', 'z-index', 'flex', 'flex-grow', 'flex-shrink',
  'order', 'column-count', 'tab-size', 'aspect-ratio', 'animation', 'transition', 'grid',
  'transform', 'scale', 'zoom', 'font-size-adjust', 'counter', 'orphans', 'widows',
  '-webkit-line-clamp', 'stroke-width', 'fill-opacity', 'stroke-opacity', 'border-image',
  'background', 'background-image', 'background-size', 'background-position', 'color', 'mix-blend-mode',
  'scrollbar-width', 'border-image-slice',
]

const offenders = []
for (const rule of CSS.matchAll(/([^{}]+)\{([^{}]*)\}/gu)) {
  const selector = rule[1].trim().replace(/\s+/gu, ' ').slice(0, 60)
  for (const declaration of rule[2].split(';')) {
    const colon = declaration.indexOf(':')
    if (colon < 0) continue
    const property = declaration.slice(0, colon).trim().toLowerCase()
    const value = declaration.slice(colon + 1).trim()
    if (property === '') continue
    if (UNITLESS_PREFIXES.some((prefix) => property.startsWith(prefix))) continue
    // A bare ZERO is valid for every length property, so it is not an offender. This is the whole
    // difference between the real bug and a legitimate reset: `top:0` is correct CSS and
    // `border-radius:999` is not, and a checker that cannot tell them apart is noise.
    if (/^[+-]?(?:0|0?\.0+)$/u.test(value)) continue
    // A bare number, optionally signed or decimal, with nothing after it.
    if (/^-?\d*\.?\d+$/u.test(value)) offenders.push({ selector, property, value })
  }
}

console.log(`  scanned ${CSS.length} chars of generated CSS`)
if (offenders.length === 0) {
  console.log('  OK   every numeric length carries a unit')
  console.log('\nRESULT: clean')
} else {
  console.log(`  FAIL ${offenders.length} numeric value(s) have no unit, so the browser DROPS them:`)
  for (const o of offenders.slice(0, 25)) console.log(`         ${o.selector}  ->  ${o.property}:${o.value}`)
  if (offenders.length > 25) console.log(`         ... and ${offenders.length - 25} more`)
  console.log('\nRESULT: ' + offenders.length + ' unitless length(s)')
  process.exitCode = 1
}
