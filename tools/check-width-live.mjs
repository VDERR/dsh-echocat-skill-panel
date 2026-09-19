#!/usr/bin/env node
// Live width check: does the panel really stay narrower than the input box?
//
// WHY THIS RUNS A BROWSER
// -----------------------
// `test/ui-polish.mjs` resolves our width arithmetic and compares it against the host's
// composed width. That is a strong check of OUR rule, but it cannot catch the failures
// that actually happened while building this: a `calc()` the browser drops, a `var()`
// that resolves on the wrong node, a rule outranked by the base sheet at equal
// specificity, or a percentage that resolves against a different containing block than
// assumed. Every one of those produces a stylesheet that LOOKS right and a panel that
// sticks out past the composer.
//
// So this measures the real thing: the real stylesheet, the host's real width formula,
// and a DOM shaped the way panel.js renders it, in a real browser engine. It is a tool
// rather than part of `npm test` because it needs Chrome and takes seconds —
// `test/ui-polish.mjs` is the always-on gate, this is the end-to-end confirmation.
//
// Usage:  node tools/check-width-live.mjs
// Exit:   0 when every measured case is narrower and aligned, 1 otherwise.

import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const pkgRoot = join(here, '..')

/** Chrome, wherever this machine keeps it. */
const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
]
const chrome = CHROME_CANDIDATES.find((candidate) => existsSync(candidate))
if (chrome === undefined) {
  console.log('SKIP  no Chrome/Edge binary found — the live width check needs one')
  process.exit(0)
}

/**
 * The stylesheet the browser gets, evaluated through the same CommonJS shim the bundler
 * produces — NOT `require()`, because this package is `type: module` and a require of a
 * `.js` file would hand back an ESM namespace object instead of the module's exports.
 */
const shim = (file) => {
  const module = { exports: {} }
  const cache = {}
  const load = (relative) => {
    if (cache[relative] !== undefined) return cache[relative]
    const exports = { exports: {} }
    cache[relative] = exports.exports
    // eslint-disable-next-line no-new-func
    new Function('module', 'exports', 'require', readFileSync(join(pkgRoot, 'src', 'client', relative), 'utf8'))(exports, exports.exports, (id) => {
      if (id === 'react') return { createElement: () => null }
      if (id.startsWith('./')) return load(id.slice(2))
      throw new Error(`${relative} must not require ${id}`)
    })
    cache[relative] = exports.exports
    return exports.exports
  }
  void file
  return load('theme.js')
}
const theme = shim()

const CASES = [680, 760, 900, 1024, 1280, 1440, 1920, 2560]

/** Build the page: the real CSS, the host's formula, and the measurement script. */
function buildPage() {
  const harness = readFileSync(join(here, 'width-harness.html'), 'utf8')
  // Inject the real stylesheet at the end of <head>, i.e. after the host stub, which is
  // also where theme.js injects it in the real app.
  const style = `<style data-plugin-css="echocat-skill-panel-3.0/panel.css">\n${theme.CSS}\n</style>`
  const measureScript = `<script>
    window.addEventListener('load', () => {
      try {
        const results = []
        for (const width of window.__CASES__) {
          document.body.style.width = width + 'px'
          // The host derives its column width from the conversation column, which here
          // is the viewport; keep them in step the way the real layout does.
          document.body.style.setProperty('--dsh-conversation-column-width', width + 'px')
          results.push(window.__MEASURE__()[0])
        }
        const el = document.createElement('pre')
        el.id = 'results'
        el.textContent = 'WIDTH-RESULTS:' + JSON.stringify(results)
        document.body.appendChild(el)
      } catch (error) {
        const el = document.createElement('pre')
        el.id = 'results'
        el.textContent = 'WIDTH-RESULTS:ERROR ' + (error && error.message)
        document.body.appendChild(el)
      }
    })
  </script>`
  return harness
    .replace('</head>', `${style}\n</head>`)
    .replace('</body>', `${measureScript}\n</body>`)
    .replace('</head>', `<script>window.__CASES__ = ${JSON.stringify(CASES)}</script>\n</head>`)
}

const scratch = mkdtempSync(join(tmpdir(), 'echocat-width-'))
const page = join(scratch, 'harness.html')
writeFileSync(page, buildPage(), 'utf8')

let dom = ''
try {
  dom = execFileSync(chrome, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--hide-scrollbars',
    // A fresh profile per run: a locked default profile makes headless Chrome exit 0
    // while producing no DOM at all, which would read as "all checks passed".
    `--user-data-dir=${join(scratch, 'profile')}`,
    // Virtual time makes the load handler run and the DOM settle before the dump.
    '--virtual-time-budget=4000',
    '--dump-dom',
    pathToFileURL(page).href,
  ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })
} catch (error) {
  console.log(`FAIL  chrome could not run the harness: ${error?.message ?? error}`)
  rmSync(scratch, { recursive: true, force: true })
  process.exit(1)
}

// Anchored on the ELEMENT, not on the marker text: the marker also appears inside the
// injected script's own source, and matching that reported the script as its own error.
const match = /<pre id="results">([\s\S]*?)<\/pre>/u.exec(dom)
if (match === null) {
  // Never a pass: no results means the measurement did not run, which is exactly the
  // "looks fine" outcome this tool exists to rule out.
  console.log('FAIL  the harness produced no measurements — chrome dumped a DOM without them')
  console.log(`      (dom ${dom.length} chars; page ${page})`)
  rmSync(scratch, { recursive: true, force: true })
  process.exit(1)
}
const payload = match[1].trim()
if (!payload.startsWith('WIDTH-RESULTS:')) {
  console.log(`FAIL  the harness produced an unexpected payload: ${payload.slice(0, 200)}`)
  rmSync(scratch, { recursive: true, force: true })
  process.exit(1)
}
const body = payload.slice('WIDTH-RESULTS:'.length)
if (body.startsWith('ERROR')) {
  console.log(`FAIL  the harness threw: ${body}`)
  rmSync(scratch, { recursive: true, force: true })
  process.exit(1)
}

const results = JSON.parse(body)
rmSync(scratch, { recursive: true, force: true })

let pass = 0
let fail = 0
const ok = (label, cond, extra = '') => {
  if (cond) {
    pass += 1
    console.log(`  PASS  ${label}`)
  } else {
    fail += 1
    console.log(`  FAIL  ${label}${extra === '' ? '' : `  <- ${extra}`}`)
  }
}

console.log(`\nchrome: ${chrome}`)
console.log(`stylesheet: ${theme.CSS.length} chars, ${theme.POLISH.length} polish records\n`)
ok('the harness measured every case', results.length === CASES.length, `${results.length} of ${CASES.length}`)

for (const result of results) {
  const column = result.column
  const composer = result.composer.w
  const bar = result.closed.w
  const open = result.open.w
  const panel = result.panel.w
  console.log(`  window ${column}px → composer ${composer} · bar ${bar} · open frame ${open} · panel ${panel}`)
  ok(`window ${column}px: the closed bar is narrower than the input box`, bar < result.composerClosed.w, `${bar} vs ${result.composerClosed.w}`)
  ok(`window ${column}px: the open frame is narrower than the input box`, open < composer, `${open} vs ${composer}`)
  ok(`window ${column}px: the panel inside it is narrower than the input box`, panel < composer, `${panel} vs ${composer}`)
  // "Somewhat narrower", not narrower by a rounding error — and not so narrow that the
  // panel stops looking like the composer's sibling.
  const inset = composer - open
  ok(`window ${column}px: the inset is visible but small (${inset.toFixed(1)}px)`, inset >= 8 && inset <= 64, String(inset))
  // SHARED AXIS, not shared left edge. We give up 16px of width and split it evenly, so
  // both surfaces are centred on the same line and each edge is inset by half the
  // difference. Asserting equal `x` would demand the whole shortfall come off one side.
  const tolerance = inset / 2 + 1
  const centre = (rect) => rect.x + rect.w / 2
  ok(`window ${column}px: the bar shares the composer's centre line`,
    Math.abs(centre(result.closed) - centre(result.composerClosed)) <= tolerance,
    `bar centre ${centre(result.closed)} composer centre ${centre(result.composerClosed)} ±${tolerance}`)
  ok(`window ${column}px: so does the open frame`,
    Math.abs(centre(result.open) - centre(result.composer)) <= tolerance,
    `open centre ${centre(result.open)} composer centre ${centre(result.composer)} ±${tolerance}`)
  ok(`window ${column}px: nothing overflows the viewport`, bar <= column && composer <= column, `bar ${bar} composer ${composer} window ${column}`)
}

console.log(`\nRESULT: ${pass}/${pass + fail} passed`)
if (fail > 0) process.exitCode = 1
