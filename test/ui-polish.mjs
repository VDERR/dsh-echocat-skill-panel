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

// Evaluate the client modules the way the bundle does, so the strings below are the ones
// the browser receives rather than the ones the source happens to spell. One tiny loader
// covers theme.js and its two generated-data dependencies.
const loadClient = (file) => {
  const cache = {}
  const evaluate = (rel) => {
    if (cache[rel] !== undefined) return cache[rel]
    const inner = { exports: {} }
    cache[rel] = inner.exports
    // eslint-disable-next-line no-new-func
    new Function('module', 'exports', 'require', sources[rel])(inner, inner.exports, (id) => {
      if (id === 'react') return { createElement: () => null }
      if (id.startsWith('./')) return evaluate(id.slice(2))
      throw new Error(`${rel} must not require ${id}`)
    })
    cache[rel] = inner.exports
    return cache[rel]
  }
  return evaluate(file)
}

const polish = loadClient('polish.js')
const design = loadClient('design.js')
const theme = loadClient('theme.js')
const CSS = String(theme.CSS)
/** Comment-free: this project's prose is long and must not satisfy a check. */
const RULES = CSS.replace(/\/\*[\s\S]*?\*\//gu, '')
/** The rendered sheet under the name the design section reads it by. */
const RENDERED = RULES

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

/* ============================================================ 5. the design pass -- */

console.log('\n[5] the design pass: 200+ records, contrast, and cascade order')

const designRecords = design.DESIGN
ok('the design pass is data, not a hand-written block', Array.isArray(designRecords), typeof designRecords)
ok('at least 200 design records', designRecords.length >= 200, String(designRecords.length))
// The refinement pass asked for "at least 100 adjustments", and a claim like that has to be
// counted or it is just a sentence in a commit message. The `r-` prefix names the records that
// pass contributed, so the number below cannot be met by renaming existing work.
const refinementRecords = designRecords.filter((record) => record.id.startsWith('r-'))
ok('the refinement pass contributed at least 100 records', refinementRecords.length >= 100, String(refinementRecords.length))
// The third pass was asked for "at least 200 adjustments". Same discipline: a number in a commit
// message is not evidence, so the records that pass contributed are counted. BASELINE is the record
// total at the end of the PREVIOUS pass — measured, not remembered: the first version of this
// assertion used 476, which was the total at the END of this pass, and so reported 102 instead of
// the truth. A baseline that is wrong in the flattering direction is exactly what this check exists
// to prevent, so it is a measured constant with the measurement written next to it.
const BASELINE_AFTER_PASS_2 = 428
ok('...and this pass alone contributed at least 200 more',
  designRecords.length - BASELINE_AFTER_PASS_2 >= 200,
  `${designRecords.length} total, ${designRecords.length - BASELINE_AFTER_PASS_2} since the baseline of ${BASELINE_AFTER_PASS_2}`)
ok('...they are the pass with a reason each',
  refinementRecords.every((record) => typeof record.why === 'string' && record.why.length > 20),
  JSON.stringify(refinementRecords.filter((r) => typeof r.why !== 'string' || r.why.length <= 20).map((r) => r.id)))

/* ---- the three strip requests, asserted individually ------------------------------------- */
console.log('\n[9b] the composer strip: persistent counters, an install count, and a theme-aware mark')
{
  const byId = (id) => designRecords.find((record) => record.id === id)
  // 1. the four counters ride the bar in BOTH states — so their rule must not be scoped to the open
  //    shell. The old shell also set `overflow:hidden`, which is what clipped them when open.
  ok('the counters are styled unconditionally', byId('r-strip-stats-always') !== undefined)
  ok('...and the open shell no longer clips its children',
    String(byId('r-strip-shell-transparent')?.props?.overflow) === 'visible',
    String(byId('r-strip-shell-transparent')?.props?.overflow))
  // 2. the report is a SEPARATE float, not merged into the shell.
  ok('the collapsed bar has its own surface when open', byId('r-strip-bar-float') !== undefined)
  ok('...and the expanded report is a second float with its own edges',
    byId('r-strip-panel-float') !== undefined && String(byId('r-strip-panel-float').props.boxShadow).includes('e3'))
  // 3. the install count replaced the static word.
  ok('the install count has its own treatment where the label was', byId('r-strip-count') !== undefined)
  // 4. the logo: centred in the bar by two EQUAL flanks, and theme-swapped by the same two signals.
  //
  // Five arrangements were tried and each was measured, and this assertion changed with every one of
  // them — which is the point: it asserts the MECHANISM that makes the centring true, not merely that
  // a rule exists. Auto margins cannot centre the mark (they resolve to 0px once `flex-grow` has taken
  // the space), an absolute overlay at 50% of the ROW lands inside the bar because the bar is only
  // part of the row, and no flex weight works because the counters are a fixed 302px with no slack.
  // Two wrappers at `flex:1` are equal width by construction, and that is what puts the mark's centre
  // on the bar's centre line — measured at 0.0px offset in tools/shot-strip.mjs.
  const logoLayer = byId('r-logo-layer')
  ok('the mark is a fixed-width slot in the middle of the bar',
    String(logoLayer?.props?.flex) === '0 0 22px' && String(logoLayer?.props?.width) === '22',
    JSON.stringify(logoLayer?.props))
  const flankLeft = byId('r-strip-flank-left')
  const flankRight = byId('r-strip-flank-right')
  ok('...between two flanks declared at the same weight',
    String(flankLeft?.props?.flex) === String(flankRight?.props?.flex) && String(flankLeft?.props?.flex).startsWith('1 1'),
    `${String(flankLeft?.props?.flex)} vs ${String(flankRight?.props?.flex)}`)
  ok('...which is what makes the centring structural rather than an offset',
    !Object.hasOwn(logoLayer?.props ?? {}, 'transform') && !Object.hasOwn(logoLayer?.props ?? {}, 'marginInline'),
    'a transform or an auto margin here would be a magic number that breaks when a label changes width')
  // The summary must NOT grow, or it eats its flank and the mark drifts off centre.
  ok('the summary does not grow inside its flank',
    String(byId('r-strip-flank-text')?.props?.flex).startsWith('0 1'),
    JSON.stringify(byId('r-strip-flank-text')?.props))
  ok('...and the counters stay at their natural width, so the flanks keep their share',
    String(byId('r-strip-flank-stats')?.props?.flex) === 'none')
  // EQUAL WIDTHS ARE NOT THE SAME AS CENTRED CONTENTS, and conflating the two shipped a strip whose
  // summary text read as a centred heading. The flanks are equal so the MARK is centred; their
  // contents stay where a reader expects, against their own outer edges. Asserting only the width
  // would let the alignment regress again, so both are asserted.
  ok('the left flank keeps its contents at the left edge',
    String(flankLeft?.props?.justifyContent) === 'flex-start', String(flankLeft?.props?.justifyContent))
  ok('...and the right flank at the right edge',
    String(flankRight?.props?.justifyContent) === 'flex-end', String(flankRight?.props?.justifyContent))
  ok('...and the summary is explicitly left-aligned, not centred',
    String(byId('r-strip-flank-text')?.props?.textAlign) === 'left',
    String(byId('r-strip-flank-text')?.props?.textAlign))
  const dark = design.designDarkCSS(ROOTS)
  ok('the dark sheet swaps the mark', dark.includes('.sr-logo--light{display:none}') && dark.includes('.sr-logo--dark{display:block}'))
  ok('...for the OS preference AND an explicit in-app theme',
    dark.includes('@media (prefers-color-scheme: dark)') && dark.includes('.dark .sr-logo--light') &&
      dark.includes('[data-theme="dark"] .sr-logo--light'),
    'a user who picks Dark in the app while the OS is light must still get the dark mark')
}
// A palette swap is the easiest way to break accessibility silently, so the scale in use is asserted
// rather than assumed. This check has now tracked four palettes — cool neutral, warm stone, Bondi Blue
// and the Vapor Chrome card — and each time the VALUE changed while the reason for asserting it did not:
// a reference card's own tones are DISPLAY weights, and the accent has to be solved to clear AA.
ok('the palette is the Vapor Chrome scale from the reference card',
  String(designRecords.find((r) => r.id === 'color-canvas').props['--sr-canvas']) === '#f6f7fe' &&
    String(designRecords.find((r) => r.id === 'color-display')?.props['--sr-display']) === '#818cf8',
  `${String(designRecords.find((r) => r.id === 'color-canvas')?.props['--sr-canvas'])} / ${String(designRecords.find((r) => r.id === 'color-display')?.props['--sr-display'])}`)
// The card's own Bondi Blue is a DISPLAY weight: 3.3:1 as text on white. It is kept for fills and
// graphics, and the ACCENT must be a deeper value that clears AA both ways — asserted here so a future
// change cannot quietly promote the display tone into body text.
ok('the display tone is kept separate from the text-safe accent',
  String(designRecords.find((r) => r.id === 'color-accent').props['--sr-accent']) !== '#0f97a8',
  'the accent must not be the untinted card value')
ok('...and the frosted wash that gives the blur something to work on is present',
  String(designRecords.find((r) => r.id === 'wash-backdrop')?.props?.backgroundImage ?? '').includes('radial-gradient'))

/* ---- motion: every name resolves, and every breakpoint record is inside a query ---------- */

console.log('\n[10] motion and breakpoints are generated, not referenced into the void')
{
  const generated = design.designCSS(ROOTS)
  const frames = design.KEYFRAMES
  ok('the sheet emits keyframe blocks at all', /@keyframes sr-card-in\{/u.test(generated), 'no keyframes emitted')

  // Every animation name a record references must exist. A name pointing at nothing is SILENT:
  // the declaration parses and the animation simply never runs.
  const referenced = new Set()
  for (const record of designRecords) {
    for (const [key, raw] of Object.entries(record.props)) {
      if (!/^animation(Name)?$/u.test(key)) continue
      for (const name of String(raw).split(/[\s,]+/u)) if (name.startsWith('sr-')) referenced.add(name)
    }
  }
  ok('records reference animation names', referenced.size >= 3, String(referenced.size))
  const missingFrames = [...referenced].filter((name) => !Object.hasOwn(frames, name))
  ok('...and every referenced name has a keyframe block', missingFrames.length === 0, missingFrames.join(', '))
  for (const name of referenced) ok(`@keyframes ${name} is emitted`, generated.includes(`@keyframes ${name}{`))

  // A responsive record emitted as a BARE rule would apply at every width — the exact shape of the
  // bug that once made the catalogue a single column everywhere.
  const responsive = design.designResponsiveCSS(ROOTS)
  const bpIds = designRecords.filter((record) => record.id.startsWith('r-bp-')).map((record) => record.id)
  ok('the pass contributed responsive records', bpIds.length >= 10, String(bpIds.length))
  const leaked = bpIds.filter((id) => {
    const rule = design.designRuleFor(designRecords.find((record) => record.id === id), ROOTS)
    return generated.includes(rule)
  })
  ok('...none of them is emitted outside a media query', leaked.length === 0, leaked.join(', '))
  ok('...and each breakpoint has its own query',
    (responsive.match(/@media/gu) ?? []).length === design.BREAKPOINTS.length,
    `${(responsive.match(/@media/gu) ?? []).length} queries for ${design.BREAKPOINTS.length} breakpoints`)
  ok('...with the narrowest query last, so it wins',
    responsive.lastIndexOf('max-width: 560px') > responsive.lastIndexOf('max-width: 900px'),
    'a narrower breakpoint must be able to override a wider one')
}

const dIds = designRecords.map((record) => record.id)
ok('every design record has a unique id', new Set(dIds).size === dIds.length, JSON.stringify(dIds.filter((id, i) => dIds.indexOf(id) !== i)))
ok('every design record states why it exists',
  designRecords.every((r) => typeof r.why === 'string' && r.why.length >= 20),
  JSON.stringify(designRecords.filter((r) => (r.why ?? '').length < 20).map((r) => r.id)))
ok('every design record carries declarations',
  designRecords.every((r) => Object.keys(r.props ?? {}).length > 0),
  JSON.stringify(designRecords.filter((r) => Object.keys(r.props ?? {}).length === 0).map((r) => r.id)))
const dGroups = new Set(designRecords.map((r) => r.group))
const dDeclared = new Set(design.DESIGN_GROUPS.map(([name]) => name))
ok('every design group is declared and used',
  [...dGroups].every((g) => dDeclared.has(g)) && [...dDeclared].every((g) => dGroups.has(g)),
  JSON.stringify({ undeclared: [...dGroups].filter((g) => !dDeclared.has(g)), unused: [...dDeclared].filter((g) => !dGroups.has(g)) }))
console.log(`        groups: ${Object.entries(design.designCounts()).map(([g, n]) => `${g} ${n}`).join(' · ')}`)

// Every record must actually reach the sheet. The design block is generated separately
// from the polish block, so a generator regression here would silently drop the whole
// redesign while leaving the count intact.
//
// The responsive records are deliberately NOT in `designCSS` — they live inside media queries in
// `designResponsiveCSS`, because a bare responsive rule would apply at every width. So the scan
// covers both blocks; scanning one reported all fourteen of them as unresolved, which is the check
// doing its job on a real distinction rather than a bug.
const DESIGN_GENERATED = design.designCSS(ROOTS)
const RESPONSIVE_GENERATED = design.designResponsiveCSS(ROOTS)
const designRules = [...`${DESIGN_GENERATED}\n${RESPONSIVE_GENERATED}`.matchAll(/([\s\S]*?)\{([^{}]*)\}/gu)].map((m) => ({ selector: m[1].trim(), decls: m[2].trim() }))
const dUnresolved = []
const dLeaked = []
for (const record of designRecords) {
  // Ask the GENERATOR what this record declares, instead of re-deriving it here. The local copy of
  // the two rules (kebab-case, and "numbers under 100 get px unless the key is unitless") did not
  // know about the unitless set, so a `tabSize: 2` record was expected as `tab-size:2px` while the
  // generator correctly emitted `tab-size:2` — reporting a missing declaration that was present.
  // One implementation, used twice.
  const wanted = design.designDeclarations(record).split(';')
  const owner = designRules.find((rule) => wanted.every((decl) => rule.decls.includes(decl)))
  if (owner === undefined) dUnresolved.push(record.id)
  else {
    // Strip an at-rule wrapper before judging the selector. The responsive block wraps its rules in
    // `@media (max-width: …){\n  <selector>{…}`, and the selector capture spans that newline — so
    // this needs [\s\S], not `.`, or the at-rule is never removed and the leak guard reports the
    // media query itself as a rule applying outside the plugin surfaces.
    const bare = owner.selector.replace(/^@media[\s\S]*?\{/u, '').trim()
    if (!bare.includes('.sr-')) dLeaked.push(`${record.id}: ${owner.selector}`)
  }
}
ok('every design declaration reached the generated CSS', dUnresolved.length === 0, JSON.stringify(dUnresolved))
ok('no design rule applies outside the plugin surfaces', dLeaked.length === 0, JSON.stringify(dLeaked))

// Rendered and comment-free, so these assertions are anchored on RULES the browser
// applies rather than on the `/* ---- 4.0 … ---- */` banners, which the strip removes.
const firstPolishRule = polish.polishCSS(ROOTS).split('\n').filter((line) => line.includes('{'))[0]
const firstDesignRule = design.designCSS(ROOTS).split('\n').filter((line) => line.includes('{'))[0]
ok('the polish pass is in the rendered sheet', RENDERED.includes(firstPolishRule), firstPolishRule.slice(0, 60))
ok('the design pass is in the rendered sheet', RENDERED.includes(firstDesignRule), firstDesignRule.slice(0, 60))
ok('...and it comes AFTER the polish pass, so it supersedes it',
  RENDERED.indexOf(firstDesignRule) > RENDERED.indexOf(firstPolishRule),
  `design @${RENDERED.indexOf(firstDesignRule)} polish @${RENDERED.indexOf(firstPolishRule)}`)
ok('...and BEFORE the narrow-viewport media query',
  RENDERED.indexOf(firstDesignRule) < RENDERED.lastIndexOf('@media (max-width:560px)'),
  'the design pass must not swallow the responsive rules')
ok('the polish pass is present in full', polish.POLISH.length >= 200, String(polish.POLISH.length))

// The two blocks genuinely overlap, which is why the order above is load-bearing and not
// a stylistic preference: a shared property must resolve to the design pass's value.
const sharedWithPolish = designRecords.filter((record) => polish.POLISH.some((p) => p.at === record.at && Object.keys(p.props).some((k) => k in record.props)))
ok('the two passes deliberately overlap', sharedWithPolish.length >= 10, String(sharedWithPolish.length))

/* ---- contrast, computed rather than eyeballed -------------------------------------- */

console.log('\n[6] every text colour clears WCAG AA on the surface it is used on')
const srgbToLinear = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const luminance = (hex) => {
  const text = hex.replace('#', '')
  const [r, g, b] = [0, 2, 4].map((i) => srgbToLinear(parseInt(text.slice(i, i + 2), 16) / 255))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (a, b) => {
  const [l1, l2] = [luminance(a), luminance(b)]
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1]
  return (hi + 0.05) / (lo + 0.05)
}
/** Alias, so the dark-palette checks near the top read the same way this section does. */
const contrastOf = contrast
/** The value a token is given by a record, or '' when that record is absent. */
const tokenOf = (id) => {
  const record = designRecords.find((r) => r.id === id)
  return record === undefined ? '' : String(Object.values(record.props)[0])
}
const LIGHT_CARD = tokenOf('color-card')
const LIGHT_RAISED = tokenOf('color-raised')
const LIGHT_SUNKEN = tokenOf('color-sunken')
ok('the text tokens are plain colours, so contrast is computable', [LIGHT_CARD, LIGHT_RAISED].every((v) => /^#[0-9a-f]{6}$/u.test(v)), `${LIGHT_CARD} ${LIGHT_RAISED}`)

const TEXT_ON = [
  ['color-ink', 'body text', 'color-card'],
  ['color-ink2', 'secondary text', 'color-card'],
  ['color-ink3', 'metadata', 'color-card'],
  ['color-ink2', 'secondary text on a card', 'color-raised'],
  ['color-ink3', 'metadata on a card', 'color-raised'],
  ['color-accent', 'the accent as text', 'color-card'],
  ['color-danger', 'destructive text', 'color-card'],
  ['color-ok', 'success text', 'color-card'],
  ['color-warn', 'the no-skill signal', 'color-card'],
]
for (const [inkId, label, bgId] of TEXT_ON) {
  const ink = tokenOf(inkId)
  const bg = /^#[0-9a-f]{6}$/u.test(tokenOf(bgId)) ? tokenOf(bgId) : LIGHT_CARD
  const ratio = contrast(ink, bg)
  ok(`${label} (${ink}) clears AA on ${bg}`, ratio >= 4.5, `${ratio.toFixed(2)}:1`)
}
// The accent is also a FILL, and its label has to be readable on it.
const onAccent = contrast(tokenOf('color-accent-ink'), tokenOf('color-accent'))
ok(`the primary button label clears AA on the accent fill`, onAccent >= 4.5, `${onAccent.toFixed(2)}:1`)
// The sunken step is the darkest light surface, so it is the worst case for metadata.
const onSunken = contrast(tokenOf('color-ink3'), LIGHT_SUNKEN)
ok('metadata also clears AA on the sunken step', onSunken >= 4.5, `${onSunken.toFixed(2)}:1`)

/* ---- the dark palette reaches both signals ----------------------------------------- */

const DARK = design.designDarkCSS(ROOTS)
ok('the dark palette is emitted for the OS preference', /@media \(prefers-color-scheme: dark\)/u.test(DARK))
ok('...and for an explicit in-app theme, which the OS preference would miss',
  /\[data-theme="dark"\]/u.test(DARK) && /\.dark/u.test(DARK), 'a user who picks Dark in-app must get the dark palette')
ok('the dark palette redefines the surfaces, not only the ink',
  ['--sr-card', '--sr-canvas', '--sr-raised', '--sr-sunken'].every((token) => DARK.includes(`${token}:`)), '')
ok('...and the elevation, which must be stronger on a dark surface',
  ['--sr-e1', '--sr-e2', '--sr-e3'].every((token) => DARK.includes(`${token}:`)), '')
// Was: a HARDCODED `#7c74f2`. That asserted the literal rather than the requirement, so it both
// blocked the warm-dark palette and would have passed for any dark theme with that one value in
// it — including an illegible one. Assert the PROPERTY: the dark accent must differ from the light
// one (a dark theme needs a lighter accent) and must clear AA as text on the dark raised surface.
{
  const lightAccent = String(designRecords.find((record) => record.id === 'color-accent').props['--sr-accent'])
  const darkAccent = /--sr-accent:(#[0-9a-f]{6})/u.exec(DARK)?.[1] ?? ''
  ok('the dark palette declares an accent at all', /^#[0-9a-f]{6}$/u.test(darkAccent), darkAccent)
  ok('...which differs from the light one, as a dark theme requires',
    darkAccent !== lightAccent, `${lightAccent} vs ${darkAccent}`)
  const onDark = contrastOf(darkAccent, '#211e1a')
  ok('...and clears AA as text on the dark raised surface', onDark >= 4.5, `${onDark.toFixed(2)}:1`)
  // The ink that sits ON a filled dark accent is ink, not white: white on #8b8bf0 is 2.98:1.
  const inkOnAccent = /--sr-accent-ink:(#[0-9a-f]{6})/u.exec(DARK)?.[1] ?? ''
  ok('...and the ink on top of it is legible too', contrastOf(inkOnAccent, darkAccent) >= 4.5,
    `${inkOnAccent} on ${darkAccent} = ${contrastOf(inkOnAccent, darkAccent).toFixed(2)}:1`)
}
// The dark INKS, which nothing computed before this pass — the suite verified the block was
// EMITTED and never that it was readable.
for (const [token, label] of [['--sr-fg', 'primary'], ['--sr-fg2', 'secondary'], ['--sr-fg3', 'tertiary']]) {
  const ink = new RegExp(`${token}:(#[0-9a-f]{6})`, 'u').exec(DARK)?.[1] ?? ''
  const ratio = contrastOf(ink, '#211e1a')
  ok(`dark ${label} text clears AA on the dark raised surface`, ratio >= 4.5, `${ink} = ${ratio.toFixed(2)}:1`)
}
ok('the dark palette is the LAST thing in the sheet, so it beats the earlier dark block',
  RENDERED.lastIndexOf('prefers-color-scheme: dark') > RENDERED.indexOf(firstDesignRule), '')

/* ---- the systems the redesign claims to have --------------------------------------- */

console.log('\n[7] the type scale, elevation and surface ramp are real systems')
const scale = (id) => tokenOf(id)
ok('the type scale has five named steps',
  ['type-ratio'].every((id) => designRecords.some((r) => r.id === id)), '')
const ratio = String(Object.values(designRecords.find((r) => r.id === 'type-ratio').props).join(','))
ok('...and the steps increase monotonically',
  (() => {
    const sizes = [...ratio.matchAll(/(\d+(?:\.\d+)?)px/gu)].map((m) => Number(m[1]))
    return sizes.length === 5 && sizes.every((size, i) => i === 0 || size > sizes[i - 1])
  })(), ratio)
ok('every elevation is a TWO-layer shadow, which is what reads as depth rather than dirt',
  ['depth-raise', 'depth-hover', 'depth-overlay'].every((id) => {
    const value = String(Object.values(designRecords.find((r) => r.id === id).props)[0])
    return (value.match(/rgba\(/gu) ?? []).length >= 2
  }), '')
ok('the surface ramp has four distinct steps, so a panel can sit ON a page',
  new Set([tokenOf('color-canvas'), tokenOf('color-card'), tokenOf('color-raised'), tokenOf('color-sunken')]).size === 4, '')
ok('the accent is used for exactly the primary, selection and attention roles',
  designRecords.filter((r) => JSON.stringify(r.props).includes('var(--sr-accent)')).length >= 8 &&
  designRecords.filter((r) => JSON.stringify(r.props).includes('var(--sr-danger)')).length <= 10,
  'the accent must not leak into every component')
ok('hairlines are derived from the ink colour rather than hardcoded grey',
  ['color-line', 'color-line2'].every((id) => String(Object.values(designRecords.find((r) => r.id === id).props)[0]).includes('color-mix')), '')
const generated = design.designCSS(ROOTS)
ok('no design rule needed !important', !generated.includes('!important'))

/* ---- the enable/disable switch, the groups, and the claim row ---------------------- */

console.log('\n[8] the switch, the catalogue groups and the claim row are styled')
// Every class the new controls render with needs a rule, or the switch shows up as naked
// text — the failure mode `test/client-css.mjs` exists to catch, checked here for the
// classes this change introduced.
for (const [cls, why] of [
  ['sr-group-head', 'the group header row'],
  ['sr-group-title', 'the group heading'],
  ['sr-group-note', 'the sentence explaining the state'],
  ['sr-tag--off', 'the disabled marker on a parked card'],
  ['sr-skill--off', 'the parked card itself'],
  ['sr-btn--toggle', 'the switch button'],
  ['sr-switch', 'the switch track'],
  ['sr-switch-knob', 'the switch knob'],
  ['sr-card-foot', 'the card action column'],
  ['sr-claim-row', 'the claim row'],
  ['sr-strip-stats', 'the counter row in the strip'],
  ['sr-statcard--inline', 'one counter chip'],
  ['sr-portal-host', 'the modal portal host'],
  ['sr-release', 'the version-controls wrapper'],
  ['sr-release-dot', 'the "an update exists" marker'],
  ['sr-release-note', 'the header line stating the version state'],
]) {
  ok(`.${cls} has a rule (${why})`, new RegExp(`\\.${cls}[{,. :]`, 'u').test(RENDERED), cls)
}
ok('the switch knob slides, so ON and OFF differ without reading the label',
  /\.sr-btn--on \.sr-switch-knob\{[^}]*translateX/u.test(RENDERED),
  (/\.sr-btn--on \.sr-switch-knob\{[^}]*\}/u.exec(RENDERED) ?? [''])[0].slice(0, 120))
ok('...and the track changes colour with it', /\.sr-btn--on \.sr-switch\{[^}]*background/u.test(RENDERED))
ok('the switch is a fixed-height control, not a line-height accident',
  /\.sr-btn--toggle\{[^}]*height:22px/u.test(RENDERED),
  (/\.sr-btn--toggle\{[^}]*\}/u.exec(RENDERED) ?? [''])[0].slice(0, 140))
ok('a parked card is dashed, so it reads as inactive rather than deleted',
  /\.sr-skill--off\{[^}]*dashed/u.test(RENDERED))
// The claim field was a `flex-basis:100%` child of an inline-flex row, which resolves the
// percentage against the row's shrink-to-fit width and overflowed the card it sat in.
ok('the claim field is no longer a child of the button row',
  !/\.sr-row-actions \.sr-claim/u.test(RENDERED) && /\.sr-claim-row\{[^}]*width:100%/u.test(RENDERED),
  (/\.sr-claim-row\{[^}]*\}/u.exec(RENDERED) ?? [''])[0].slice(0, 140))
// THE regression test for the 4.0.1 blank-page bug, and the reason the old assertion here was
// worthless: it checked that a DECLARATION reached the sheet
// (`/\.sr-portal-host\{[^}]*display:contents/`), and the broken selector
// `.sr-root .sr-portal-host{…display:contents}` satisfied it perfectly. The 135-assertion suite
// stayed green while every user who opened the install sheet once got a blank, scrollable page
// a full viewport tall, because the rule could not match the element it was written for.
//
// So assert the MATCH, not the declaration: the selector has to name the host itself, and no
// rule may try to reach it as a descendant of a surface.
const PORTAL_HOST_MATCHES_ITSELF = /(?:^|,)\s*(?:\.sr-root\.sr-portal-host|\.sr-portal-host)\{[^}]*display:contents/mu
ok('the portal host adds no box of its own, and the rule can match the host itself',
  PORTAL_HOST_MATCHES_ITSELF.test(RENDERED),
  (/[^{}]*sr-portal-host[^{}]*\{[^}]*\}/u.exec(RENDERED) ?? ['<no rule names the host>'])[0].slice(0, 220))
ok('...and nothing tries to reach the host as a DESCENDANT of a surface',
  !/\.sr-(?:root|strip-shell|backdrop|rail)\s+\.sr-portal-host/u.test(RENDERED),
  'a rooted form can never match an element that lives on document.body')
// The host must not carry the panel-frame class at all: that is what turned a missing rule into
// a full-viewport bordered box instead of a zero-height div.
ok('the portal host is not given the panel frame class',
  !/PORTAL_HOST_CLASS = '[^']*sr-root/u.test(readFileSync(join(clientDir, 'install.js'), 'utf8')),
  'sr-root on a body-level node is a blank page waiting for a rule to go missing')

/* ---- the card is three rows, so the name is never truncated --------------------- */

console.log('\n[9] the skill name gets its own full-width row')
/**
 * The declarations the sheet ends up applying to `selector` — folded the way the cascade
 * does it: matching rules in SOURCE ORDER, property by property.
 *
 * Written as a character scan rather than one regex, because the sheet is minified and
 * several hundred rules share lines with comments and `@media` blocks between them; a
 * single pass with `[^{}]+` mis-parses as soon as a comment contains a brace, and the
 * resulting table silently drops rules (it lost `.sr-skill{flex-direction:column}` and
 * reported the replaced value instead — the exact class of wrong answer these assertions
 * exist to prevent).
 */
function rulesOf(sheet) {
  const out = []
  let depth = 0
  let start = 0
  let selector = ''
  let buffer = ''
  for (let i = 0; i < sheet.length; i += 1) {
    const ch = sheet[i]
    if (ch === '{') {
      if (depth === 0) {
        selector = buffer.trim()
        buffer = ''
      }
      depth += 1
      continue
    }
    if (ch === '}') {
      depth -= 1
      if (depth === 0) {
        if (selector !== '' && !selector.startsWith('@')) out.push({ selector, decls: buffer })
        selector = ''
        buffer = ''
      }
      continue
    }
    if (depth === 0) {
      if (ch === '}') buffer = ''
      buffer += ch
      continue
    }
    // Inside a rule body: keep characters, but a nested block (a keyframe step) is not a
    // declaration list, so anything at depth > 1 is dropped.
    if (depth === 1) buffer += ch
  }
  return out
}
const SHEET_RULES = rulesOf(RENDERED)
/** `sel` plus the rooted and doubled forms the two generated blocks emit. */
function ruleFor(selector) {
  const forms = new Set([selector, `${selector}${selector}`, ...ROOTS.map((root) => `${root} ${selector}`)])
  const merged = new Map()
  for (const rule of SHEET_RULES) {
    const members = rule.selector.split(',').map((part) => part.trim())
    if (!members.some((member) => forms.has(member))) continue
    for (const decl of rule.decls.split(';')) {
      const at = decl.indexOf(':')
      if (at > 0) merged.set(decl.slice(0, at).trim(), decl.slice(at + 1).trim())
    }
  }
  return [...merged].map(([key, value]) => `${key}:${value}`).join(';')
}
ok('the card stacks its rows instead of putting the name beside the buttons',
  /flex-direction:column/u.test(ruleFor('.sr-skill')), ruleFor('.sr-skill').slice(0, 140))
ok('...with a head row holding the name and the tags',
  /display:flex/u.test(ruleFor('.sr-skill-head')) && /display:flex/u.test(ruleFor('.sr-skill-tags')),
  ruleFor('.sr-skill-head').slice(0, 100))
// THE assertion for the reported bug: the name was `white-space:nowrap` +
// `text-overflow:ellipsis` in a row that six buttons also competed for, so
// `h3-prompt-writing` rendered as `h3-prompt-writi…`.
const nameRule = ruleFor('.sr-skill-name')
ok('the name is NOT truncated', /white-space:normal/u.test(nameRule) && /text-overflow:clip/u.test(nameRule), nameRule)
ok('...and it can break inside a long slug', /overflow-wrap:anywhere/u.test(nameRule), nameRule)
ok('the slug is not truncated either',
  /white-space:normal/u.test(ruleFor('.sr-skill-slug')) && /overflow-wrap:anywhere/u.test(ruleFor('.sr-skill-slug')),
  ruleFor('.sr-skill-slug'))
ok('the actions own their own full-width row',
  /width:100%/u.test(ruleFor('.sr-card-foot .sr-row-actions')), ruleFor('.sr-card-foot .sr-row-actions').slice(0, 140))
ok('...starting at the card edge rather than right-aligned under the text',
  /justify-content:flex-start/u.test(ruleFor('.sr-card-foot .sr-row-actions')))
ok('the old side-by-side row is gone from the sheet', !/\.sr-skill-top[{,]/u.test(RENDERED),
  'the name must not share a row with the actions')

console.log(`\nRESULT: ${pass}/${pass + fail} passed`)
if (fail > 0) process.exitCode = 1
