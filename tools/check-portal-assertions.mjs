// Prove the new portal-host assertions FAIL on the buggy stylesheet.
//
// An assertion that cannot fail is decoration. The 4.0.1 bug shipped with a green 135-assertion
// suite because the assertion guarding this rule checked that a DECLARATION existed — and the
// broken selector `.sr-root .sr-portal-host{…display:contents}` satisfied it. So: run the two new
// assertions against a sheet in which the rule is rooted the way it was in 4.0.1, and confirm
// they report FAIL.
//
// Run: node tools/check-portal-assertions.mjs

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const pkgRoot = join(here, '..')

/** The real stylesheet, evaluated out of the shipped artifact. */
function renderStylesheet() {
  const bundled = readFileSync(join(pkgRoot, 'lib', 'client.js'), 'utf8')
  const header = /^\t\t\t"(\.[^"]+)": function \(module, exports, require\) \{$/gmu
  const marks = []
  let match
  while ((match = header.exec(bundled)) !== null) marks.push({ id: match[1], end: header.lastIndex, at: match.index })
  const modules = new Map()
  for (let i = 0; i < marks.length; i += 1) {
    const stop = i + 1 < marks.length ? marks[i + 1].at : bundled.length
    modules.set(marks[i].id, bundled.slice(marks[i].end, stop).replace(/\},?\s*$/u, ''))
  }
  const cache = new Map()
  const load = (id) => {
    const key = id.startsWith('./') ? id : `./${id}`
    if (cache.has(key)) return cache.get(key)
    const module = { exports: {} }
    cache.set(key, module.exports)
    // eslint-disable-next-line no-new-func
    new Function('module', 'exports', 'require', modules.get(key))(module, module.exports, (spec) => {
      if (spec === 'react') {
        return { createElement: () => null, useSyncExternalStore: () => null, useState: () => [], useEffect: () => {}, useCallback: (f) => f, useMemo: (f) => f(), useRef: () => ({ current: null }) }
      }
      if (spec === 'react-dom') return {}
      if (spec.startsWith('./')) return load(spec)
      throw new Error(`unexpected require(${spec})`)
    })
    cache.set(key, module.exports)
    return module.exports
  }
  return String(load('./theme.js').CSS)
}

let pass = 0
let fail = 0
const check = (label, condition, detail = '') => {
  if (condition) {
    pass += 1
    console.log(`  PASS  ${label}`)
  } else {
    fail += 1
    console.log(`  FAIL  ${label}${detail === '' ? '' : `  <- ${detail}`}`)
  }
}

const GOOD = renderStylesheet()
// The exact regression: rooted as a descendant of a surface, which can never match a host that
// lives on `document.body` and IS a `.sr-root` rather than being inside one.
const BUGGY = GOOD.replace(
  /\.sr-portal-host,\.sr-root\.sr-portal-host\{position:static;display:contents\}/u,
  '.sr-root .sr-portal-host,.sr-strip-shell .sr-portal-host,.sr-backdrop .sr-portal-host,.sr-rail .sr-portal-host{position:static;display:contents}',
)

const MATCHES_ITSELF = /(?:^|,)\s*(?:\.sr-root\.sr-portal-host|\.sr-portal-host)\{[^}]*display:contents/mu
const ROOTED_DESCENDANT = /\.sr-(?:root|strip-shell|backdrop|rail)\s+\.sr-portal-host/u
// The assertion as it existed in 4.0.1 — kept here to demonstrate why it was worthless.
const WEAK = /\.sr-portal-host\{[^}]*display:contents/u

console.log('\n[1] the sheet was actually transformed (otherwise this proves nothing)')
check('the buggy variant differs from the shipped one', GOOD !== BUGGY)
check('...and contains no self-matching form', !MATCHES_ITSELF.test(BUGGY))

console.log('\n[2] the SHIPPED sheet passes the new assertions')
check('matches the host itself', MATCHES_ITSELF.test(GOOD))
check('no rooted-descendant form', !ROOTED_DESCENDANT.test(GOOD))

console.log('\n[3] the BUGGY sheet fails them (this is the whole point)')
check('matches-the-host FAILS on the buggy sheet', !MATCHES_ITSELF.test(BUGGY))
check('rooted-descendant is DETECTED on the buggy sheet', ROOTED_DESCENDANT.test(BUGGY))

console.log('\n[4] and the OLD assertion passes on BOTH — which is why 135 assertions stayed green')
check('the weak 4.0.1 assertion passes on the good sheet', WEAK.test(GOOD))
check('the weak 4.0.1 assertion ALSO passes on the buggy sheet', WEAK.test(BUGGY), 'this is the bug in the test')

console.log(`\nRESULT: ${pass}/${pass + fail} passed`)
if (fail > 0) process.exitCode = 1
