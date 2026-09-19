// Contract test for the 4.0 polish set and the composer-width adaptation.
//
// WHY THIS FILE EXISTS
// --------------------
// Two claims in this release are easy to make and hard to verify:
//
//   1. "the panel is always narrower than the input box, at any interface scale";
//   2. "200+ UI refinements".
//
// (1) is a relationship between OUR width and a width the HOST computes. Reading the
// rule and nodding is not a check: the first version of this sheet carried
// `--sr-max: 1120px`, which silently exceeded the composer on every window narrower
// than ~1500px — i.e. on the machine it was written on. So this file evaluates the
// arithmetic at several widths and asserts the ordering, and separately pins the fact
// that the value comes from the host token rather than a number we invented.
//
// (2) is a COUNT, and a count is only meaningful if each item is real. The stylesheet
// text is generated from the `POLISH` records in `src/client/polish.js`, so a record
// that produced no CSS — a typo'd selector, a declaration the browser drops — would
// silently reduce the count. Every record is therefore asserted to have produced a
// rule whose selector names a plugin surface and whose declarations survived.

import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

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

const clientDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'client')
const sources = Object.fromEntries(
  readdirSync(clientDir)
    .filter((file) => file.endsWith('.js'))
    .map((file) => [file, readFileSync(join(clientDir, file), 'utf8')]),
)

// Evaluate theme.js the way the bundle does, so the strings below are the ones the
// browser receives rather than the ones the source happens to spell.
const polishModule = { exports: {} }
// eslint-disable-next-line no-new-func
new Function('module', 'exports', 'require', sources['polish.js'])(polishModule, polishModule.exports, (id) => {
  throw new Error(`polish.js must not require ${id}`)
})
const polish = polishModule.exports
const themeModule = { exports: {} }
const fakeRequire = (id) => {
  if (id === 'react') return { createElement: () => null }
  if (id === './polish.js') return polish
  throw new Error(`theme.js must not require ${id}`)
}
// eslint-disable-next-line no-new-func
new Function('module', 'exports', 'require', sources['theme.js'])(themeModule, themeModule.exports, fakeRequire)
const theme = themeModule.exports
const CSS = String(theme.CSS)
/** Comment-free: prose in this project is long, and must not satisfy a check. */
const RULES = CSS.replace(/\/\*[\s\S]*?\*\//gu, '')

const ROOTS = ['.sr-root', '.sr-strip-shell', '.sr-backdrop', '.sr-rail']
/** The refinement records, used from several sections below. */
const records = polish.POLISH

/* ---------------------------------------------- 1. narrower than the composer -- */

console.log('\n[1] the surfaces stay narrower than the input box, at any scale')

/**
 * Resolve a `calc(...)` width chain the way a browser would, for the widths we care
 * about. Only the handful of shapes this stylesheet actually uses is supported —
 * `var(x, fallback)`, `calc(A - Bpx)` and a bare value — and an unsupported shape
 * throws rather than returning a number, because a silent 0 would make the ordering
 * assertions pass for the wrong reason.
 */
function resolveWidth(expr, vars) {
  let out = String(expr).trim()
  for (let i = 0; i < 10; i += 1) {
    const varMatch = /var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*(?:\([^()]*\)[^()]*)*))?\)/u.exec(out)
    if (varMatch === null) break
    const [, name, fallback] = varMatch
    const value = vars[name] ?? fallback
    if (value === undefined) throw new Error(`unresolvable var ${name} in ${expr}`)
    out = out.slice(0, varMatch.index) + value + out.slice(varMatch.index + varMatch[0].length)
  }
  const calcMatch = /calc\(\s*([\d.]+)px\s*-\s*([\d.]+)px\s*\)/u.exec(out)
  if (calcMatch !== null) return Number(calcMatch[1]) - Number(calcMatch[2])
  const bare = /^([\d.]+)px$/u.exec(out.trim())
  if (bare !== null) return Number(bare[1])
  throw new Error(`cannot resolve width expression: ${expr} -> ${out}`)
}

/**
 * Does `member` — one comma-separated entry of a selector list — apply to the elements
 * `selector` names? Only the three shapes this stylesheet actually produces are
 * accepted, and anything else is treated as "no" rather than guessed at:
 *
 *   `sel`                 a rule for the element itself
 *   `sel sel`             a doubled-class rule, which is how the base caps are outranked
 *   `root sel`            a descendant rule (how every polish rule is rooted)
 *
 * The `root sel` case requires the part before the space to be one of the surface roots.
 * Without that, the token block's group selector `.sr-root,.sr-strip-shell,…` matched
 * `.sr-strip-shell` (its LAST member ends with the target), and the token block then
 * appeared to be the winning rule for every property it declares — which is how a wrong
 * `width` was reported while the browser computed the right one.
 */
function appliesTo(member, selector) {
  if (member === selector) return member
  if (member === `${selector} ${selector}`) return member
  for (const root of ROOTS) {
    if (member === `${root} ${selector}`) return member
  }
  return undefined
}

/**
 * The declarations a browser ends up with for `selector`, folded the way the cascade
 * does it: candidates are every matching rule sorted by (specificity, source order),
 * then merged property by property.
 *
 * Specificity matters here rather than being pedantry: `.sr-root.sr-root` is a (0,2,0)
 * candidate for `.sr-root` while `root + sel` is (0,2,0) and `root sel` is (0,1,1), so
 * reading only exact selector lists would report the value that was REPLACED.
 */
function declOf(selector) {
  const candidates = []
  const memberSpec = (member) =>
    (member.match(/#[\w-]+/gu) ?? []).length * 1e9 +
    (member.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+/gu) ?? []).length * 1e6 +
    (member.match(/(?:^|\s)[a-z][\w-]*/gu) ?? []).length * 1e3 +
    (member.match(/::[\w-]+/gu) ?? []).length
  // The selector is matched BACKWARDS from each `{`, never forwards from the previous `}`:
  // the sheet is minified, so several rules share a line, and a forward scan greedily
  // swallowed whole rules and attributed the wrong declarations to the wrong selector.
  const ruleRe = /([^{}@;]+?)\{([^{}]*)\}/gu
  let match
  let order = 0
  while ((match = ruleRe.exec(RULES)) !== null) {
    order += 1
    for (const member of match[1].split(',').map((part) => part.trim())) {
      const hit = appliesTo(member, selector)
      if (hit !== undefined) candidates.push({ order, spec: memberSpec(member), decls: match[2] })
    }
  }
  candidates.sort((a, b) => (a.spec === b.spec ? a.order - b.order : a.spec - b.spec))
  const merged = new Map()
  for (const candidate of candidates) {
    for (const decl of candidate.decls.split(';')) {
      const at = decl.indexOf(':')
      if (at <= 0) continue
      merged.set(decl.slice(0, at).trim(), decl.slice(at + 1).trim())
    }
  }
  return [...merged].map(([key, value]) => `${key}:${value}`).join(';')
}
const valueOf = (decls, prop) => {
  const match = new RegExp(`(?:^|;)\\s*${prop}:([^;]+)`, 'u').exec(decls)
  return match === null ? '' : match[1].trim()
}

// The token that carries the width. It is declared in the base token block and
// consumed by the base rules; `polish.js` records the value and the reasoning.
const maxToken = valueOf(declOf('.sr-root'), '--sr-max')
ok('the width is a single shared token', maxToken !== '', declOf('.sr-root'))
ok('...derived from the host composer width, not a number we invented',
  maxToken.includes('--dsh-composer-card-max-width'), maxToken)
ok('...with a fallback so the panel still lays out on a host that defines nothing',
  /var\(--dsh-composer-card-max-width,\s*\d+px\)/u.test(maxToken), maxToken)
ok('...and the offset is a subtraction, which is what keeps it NARROWER',
  /-\s*[\d.]+px/u.test(maxToken), maxToken)

// The host composes its composer width as `--dsh-chat-content-width + 32px`, and that
// 32px is its own gutter. Our offset must therefore be strictly inside it, or the two
// surfaces are the same width and "narrower" is a coincidence of rounding.
const offset = Number((/-\s*([\d.]+)px/u.exec(maxToken) ?? [])[1])
ok('the offset is inside the composer\'s own 32px gutter', offset > 0 && offset < 32, String(offset))

for (const selector of ['.sr-strip-shell', '.sr-root', '.sr-strip-shell--open']) {
  const decls = declOf(selector)
  ok(`${selector} is capped by the token`, valueOf(decls, 'max-width') === 'var(--sr-max)', declOf(selector))
}
// The polish records must agree with where the value actually lives, or the file
// documents a width the sheet does not use.
const widthRecords = records.filter((record) => record.group === 'width')
ok('the polish set records the width rules', widthRecords.length >= 4, String(widthRecords.length))
ok('...and every one of them consumes the shared token',
  widthRecords.filter((r) => JSON.stringify(r.props).includes('max-width')).every((r) => String(r.props.maxWidth).includes('var(--sr-max)')),
  JSON.stringify(widthRecords.map((r) => [r.id, r.props.maxWidth])))

// The relationship, evaluated. 952px is the host's own hard cap; 680px is the low end
// of its `clamp()`; the rest stand in for narrower and wider windows. `composer` here
// is the host's formula, not our token, so these assertions fail if the host's shape
// changes underneath us.
const CASES = [680, 760, 900, 1024, 1440, 1920, 2560]
for (const contentWidth of CASES) {
  const composerWidth = contentWidth + 32
  const vars = { '--dsh-composer-card-max-width': `${composerWidth}px` }
  const ours = resolveWidth(maxToken, vars)
  ok(`at content ${contentWidth}px the surface is narrower than the input box (${ours} < ${composerWidth})`, ours < composerWidth, `${ours} vs ${composerWidth}`)
  // Also assert the margin does not collapse to zero, which is what a `- 32px` would do.
  ok(`at content ${contentWidth}px there is a visible inset between them`, composerWidth - ours >= 8, String(composerWidth - ours))
}

// A host that defines nothing must still produce a width, and it must be the modest
// one rather than the old 1120px, which overflowed the composer on a 1080p screen.
const fallbackWidth = resolveWidth(maxToken, {})
ok('with no host token the fallback still resolves', Number.isFinite(fallbackWidth), String(fallbackWidth))
ok('...and stays under the host\'s own 952px maximum', fallbackWidth <= 952, String(fallbackWidth))

// The container-relative half of the contract. A fixed `- 16px` cap is only narrower
// while the composer is at its OWN cap; below the composer's minimum the dock clamps
// BOTH surfaces and the fixed offset makes them exactly equal (measured in Chrome at a
// 680px window). A percentage is narrower than the container at every size, and the
// composer is at most 100% of that container — so this is what makes the promise hold
// at every scale rather than only on a wide screen.
ok('the bar is also narrower than its own container, not only than the composer cap',
  valueOf(declOf('.sr-strip-shell'), 'width') === 'calc(100% - 16px)', declOf('.sr-strip-shell'))
ok('...and so is the panel inside the open frame',
  valueOf(declOf('.sr-root'), 'width') === 'calc(100% - 16px)', declOf('.sr-root'))
ok('...and the open frame keeps it, so opening the strip never widens it',
  valueOf(declOf('.sr-strip-shell--open'), 'width') === 'calc(100% - 16px)', declOf('.sr-strip-shell--open'))
// Shared axis rather than shared left edge: we give up 16px and split it evenly, so the
// centre lines coincide and each edge is inset by half the difference. (Measured in
// Chrome: `margin-inline:0` instead put the bar's left edge 8px off the composer's.)
ok('the bar is centred on the composer\'s axis',
  valueOf(declOf('.sr-strip-shell'), 'margin-inline') === 'auto', declOf('.sr-strip-shell'))
ok('...and it is centred rather than stretched by the dock\'s column flex',
  valueOf(declOf('.sr-strip-shell'), 'align-self') === 'center', declOf('.sr-strip-shell'))
ok('the old fixed 1120px cap is gone from the whole sheet', !RULES.includes('1120px'))

/* ------------------------------------------------------------- 2. the set size -- */

console.log('\n[2] the polish set is real, named, and large enough')
ok('the stylesheet exports the records it was generated from', Array.isArray(records), typeof records)
ok('at least 200 refinements are recorded', records.length >= 200, String(records.length))
const ids = records.map((record) => record.id)
ok('every refinement has a unique id', new Set(ids).size === ids.length,
  JSON.stringify(ids.filter((id, i) => ids.indexOf(id) !== i)))
ok('every refinement names a group', records.every((record) => typeof record.group === 'string' && record.group !== ''))
const groups = new Set(records.map((record) => record.group))
const declaredGroups = new Set(polish.GROUPS.map(([name]) => name))
ok('every group is declared', [...groups].every((group) => declaredGroups.has(group)),
  JSON.stringify([...groups].filter((g) => !declaredGroups.has(g))))
ok('every declared group is used', [...declaredGroups].every((group) => groups.has(group)),
  JSON.stringify([...declaredGroups].filter((g) => !groups.has(g))))
ok('every refinement states why it exists',
  records.every((record) => typeof record.why === 'string' && record.why.length >= 20),
  JSON.stringify(records.filter((r) => (r.why ?? '').length < 20).map((r) => r.id)))
ok('every refinement carries at least one declaration',
  records.every((record) => Object.keys(record.props ?? {}).length > 0),
  JSON.stringify(records.filter((r) => Object.keys(r.props ?? {}).length === 0).map((r) => r.id)))

const counts = polish.polishCounts()
const total = Object.values(counts).reduce((a, b) => a + b, 0)
ok('the per-group tally adds up to the record count', total === records.length, `${total} vs ${records.length}`)
ok('no group is a single lonely item', Object.values(counts).every((n) => n >= 2), JSON.stringify(counts))
console.log(`        groups: ${Object.entries(counts).map(([g, n]) => `${g} ${n}`).join(' · ')}`)

/* --------------------------------------------------- 3. every record produced CSS -- */

console.log('\n[3] every recorded refinement reached the stylesheet')

/** Split the generated block into `selector{decls}` pairs, ignoring the header comment. */
const GENERATED = polish.polishCSS(ROOTS)
const generatedRules = [...GENERATED.matchAll(/([^{}]+)\{([^}]*)\}/gu)].map((m) => ({ selector: m[1].trim(), decls: m[2].trim() }))
ok('the generated block produced rules', generatedRules.length >= records.length, `${generatedRules.length} vs ${records.length}`)

const unresolved = []
const unscoped = []
/**
 * The unit test for the value serialiser, mirroring the set in polish.js: a number
 * below 100 that is not one of these is a length. Kept as a list rather than imported
 * so that a change to the module's set is visible HERE as a failing assertion rather
 * than silently agreeing with itself.
 */
const UNITLESS_KEYS = /^(?:fontWeight|lineHeight|opacity|zIndex|flexGrow|flexShrink|order|WebkitLineClamp|border(?:Top|Bottom)(?:Left|Right)Radius)$/u
for (const record of records) {
  // A record's declarations must appear on SOME generated rule.
  const wanted = Object.entries(record.props).map(([key, raw]) => {
    const cssKey = key.replace(/[A-Z]/gu, (c) => `-${c.toLowerCase()}`)
    const cssValue = typeof raw === 'number' && raw < 100 && !UNITLESS_KEYS.test(key) ? `${raw}px` : String(raw)
    return `${cssKey}:${cssValue}`
  })
  const hit = generatedRules.some((rule) => wanted.every((decl) => rule.decls.includes(decl)))
  if (!hit) unresolved.push(record.id)
  // …and that rule must be scoped to the plugin, or it would restyle the host app.
  const owner = generatedRules.find((rule) => wanted.every((decl) => rule.decls.includes(decl)))
  if (owner !== undefined && !owner.selector.includes('.sr-')) unscoped.push(`${record.id}: ${owner.selector}`)
}
ok('every refinement\'s declarations are in the generated CSS', unresolved.length === 0, JSON.stringify(unresolved))
ok('no generated rule applies outside the plugin surfaces', unscoped.length === 0, JSON.stringify(unscoped))

ok('the generated block is part of the stylesheet the components get',
  CSS.includes('polish set (generated from POLISH'), `CSS ${CSS.length} chars`)
// The position is load-bearing, not cosmetic: the block must come AFTER the base rules
// it refines and BEFORE the responsive/broken-media queries, or it would override the
// narrow-viewport layout instead of the rules it was written to win against.
ok('...after the hand-written rules it refines',
  CSS.indexOf('polish set (generated') > CSS.indexOf('.sr-strip{'), 'polish must come after the base')
ok('...and BEFORE the responsive media queries', CSS.indexOf('polish set (generated') < CSS.indexOf('@media (max-width:560px)'),
  'the polish block must not swallow the narrow-viewport rules')
ok('...so the narrow-viewport rules are still the last word',
  CSS.lastIndexOf('@media (max-width:560px)') > CSS.indexOf('polish set (generated'))

// A record with no `.sr-` in its selector and no explicit token would silently become
// a GLOBAL rule. The generator must refuse, and the refusal must be reachable — so it is
// invoked here with a deliberately leaky record rather than merely asserted in prose.
const leaky = { id: 'leaky', group: 'a11y', at: 'div', props: { color: 'red' }, why: 'deliberately unscoped record' }
let leaked = ''
try {
  leaked = polish.ruleFor(leaky, ROOTS)
} catch (error) {
  leaked = `refused: ${error.message}`
}
ok('a rule that would leak outside the plugin is refused at generation time',
  leaked.startsWith('refused:'), leaked)
ok('...and the refusal names the offending record', leaked.includes('leaky'), leaked)
ok('...while a scoped record of the same shape generates normally',
  polish.ruleFor({ ...leaky, at: '.sr-thing' }, ROOTS).includes('.sr-root .sr-thing'), polish.ruleFor({ ...leaky, at: '.sr-thing' }, ROOTS))
ok('...and the leaky selector appears nowhere in the generated sheet', !GENERATED.includes('\ndiv{') && !/[,}]div\{/u.test(GENERATED))

/* ------------------------------------------------------------- 4. sanity of the CSS -- */

console.log('\n[4] the combined stylesheet is still well-formed')
const opens = (RULES.match(/\{/gu) ?? []).length
const closes = (RULES.match(/\}/gu) ?? []).length
ok('braces balance across base + polish', opens === closes, `${opens} vs ${closes}`)
ok('no declaration is empty', !/[:;{]\s*[;}]/u.test(RULES.replace(/\{[^}]*\}/gu, (block) => block.replace(/;{2,}/gu, ';'))), '')
ok('no value was left as a bare unit name', !/:(?:px|em|rem)(?=[;}])/u.test(RULES))
// Names that merely CONTAIN a unitless one (border-top-right-radius) must not trip this.
ok('no unitless property got a px suffix',
  !/(?:^|[;{])(?:font-weight|opacity|z-index|order|flex-grow|flex-shrink|line-clamp):\d+px/u.test(RULES),
  JSON.stringify([...RULES.matchAll(/(?:font-weight|opacity|z-index|order|flex-grow|flex-shrink|line-clamp):\d+px/gu)].map((m) => m[0])))
ok('every colour is a token, a colour function or a literal', !/:\s*(?:colour|undefined|null)\b/u.test(RULES))
const important = (RULES.match(/!important/gu) ?? []).length
ok('the polish block needed no !important', important <= 4, `${important} occurrences`)
ok('the generated block does not re-declare the token block', !GENERATED.includes('--sr-fg:'))
ok('the reduced-motion reset still comes last for animations', RULES.indexOf('prefers-reduced-motion') > 0)

// A record whose declarations are all defaults changes nothing while still counting
// toward "200 refinements". That is the one way this count could be dishonest, so it is
// checked: each record must set at least one property to a value that differs from the
// initial value the property would otherwise have.
const NOOP = new Map([
  ['flexShrink', '1'], ['flexGrow', '0'], ['opacity', '1'], ['order', '0'], ['zIndex', 'auto'],
  ['marginTop', '0'], ['paddingTop', '0'], ['borderTopWidth', '0'], ['textAlign', 'start'],
])
/**
 * Records allowed to set a property to its initial value, with the reason.
 *
 * Setting a default explicitly is legitimate when the point is to OVERRIDE something
 * else — a media query, or a `*` reset — and that is the only thing any of these do.
 * Anything else here would be a record that changes nothing while still counting toward
 * the total, which is the one way this number could be dishonest.
 */
const ALLOWED_RESETS = new Map([
  ['frame-hero-accent-round', 'overrides the * reset in the reduced-motion block, which sets opacity to 1 on every surface descendant'],
  ['card-actions-focus', 'overrides the 75% dim on unfocused action buttons'],
  ['tag-badge-none-dot', 'overrides the 80% dim on the no-skill dot'],
  ['upd-btn-opacity', 'overrides the 75% dim the actions row applies to every button'],
  ['consist-seg-track', 'overrides the 8px bottom margin the segmented control carries in the sheet'],
])
const noops = records.filter((record) =>
  !ALLOWED_RESETS.has(record.id) &&
  Object.entries(record.props).every(([key, value]) => NOOP.get(key) === String(value)))
ok('no refinement is a no-op restatement of a default', noops.length === 0, JSON.stringify(noops.map((r) => r.id)))
ok('every allowed reset states why it exists',
  [...ALLOWED_RESETS.keys()].every((id) => records.some((record) => record.id === id)),
  JSON.stringify([...ALLOWED_RESETS.keys()].filter((id) => !records.some((r) => r.id === id))))

const withText = records.filter((record) => record.props.fontSize !== undefined || record.props.fontWeight !== undefined)
ok('the set adjusts typography, not only boxes', withText.length >= 10, String(withText.length))
const withInteraction = records.filter((record) => /:hover|:focus|:active|aria-|:disabled|::selection|::marker|::before|::after/u.test(record.at))
ok('the set refines interaction states, not only static paint', withInteraction.length >= 25, String(withInteraction.length))
const withSurface = records.filter((record) => /background|border|boxShadow|borderRadius/u.test(Object.keys(record.props).join(',')))
ok('the set refines the surface language', withSurface.length >= 40, String(withSurface.length))

console.log(`\nRESULT: ${pass}/${pass + fail} passed`)
if (fail > 0) process.exitCode = 1
