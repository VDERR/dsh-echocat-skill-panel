// Stylesheet contract test for the browser half.
//
// Why this file exists: the install sheet shipped rendering like unstyled HTML
// the first time it was opened from the composer strip. Every class it used WAS
// defined in the stylesheet, so a "does the CSS cover this class" check would
// have passed — the sheet simply was not a DOM descendant of `.sr-root`, where
// the `--sr-*` design tokens were defined, and an undefined `var()` makes its
// whole declaration invalid at computed-value time. Borders, padding, gaps and
// colours all collapsed to nothing.
//
// So the assertions here are about *scope and resolution*, not about coverage:
// the token block must sit on every surface root, and no rule may reference a
// token nobody defines. Both are cheap to check from the sources and both are
// invisible to a DOM-free render test.

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
const theme = sources['theme.js']
const CSS = (/const CSS = `([\s\S]*?)`\n/u.exec(theme) ?? [])[1] ?? ''

// Evaluate the stylesheet source, so the structural assertions below run against
// the CSS the browser will actually see. The `${SURFACES_*}` sets are interpolated
// at runtime, so neither the bundle text nor the raw source can prove that the
// selectors EXPAND correctly — and expanding them wrongly is precisely the bug
// that painted the panel blue and outlined it.
const themeModule = { exports: {} }
// `theme.js` requires its two generated-data modules (`./polish.js` for the 211
// refinements, `./design.js` for the 228-record design pass), so the fake table serves
// both — evaluated from the same sources the bundler inlines, which is what makes the
// RENDERED css below the css the browser actually receives.
const generatedCache = {}
const loadGenerated = (file) => {
  if (generatedCache[file] !== undefined) return generatedCache[file]
  const holder = { exports: {} }
  generatedCache[file] = holder.exports
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', 'require', sources[file])(holder, holder.exports, () => {
    throw new Error(`${file} must not require anything`)
  })
  generatedCache[file] = holder.exports
  return generatedCache[file]
}
const fakeRequire = (id) => {
  if (id === 'react') return { createElement: () => null }
  if (id.startsWith('./')) return loadGenerated(id.slice(2))
  throw new Error(`theme.js must not require ${id}`)
}
// eslint-disable-next-line no-new-func
new Function('module', 'exports', 'require', theme)(themeModule, themeModule.exports, fakeRequire)
const RENDERED = String(themeModule.exports.CSS ?? '')
/** Rendered CSS with comments removed: prose must not satisfy or break a check. */
const RULES = RENDERED.replace(/\/\*[\s\S]*?\*\//gu, '')
// The record tables themselves, for the one thing a class inventory needs to know that the
// stylesheet cannot tell it: which `sr-*` tokens are ANIMATION NAMES rather than classes.
const design = loadGenerated('design.js')

/** The selector list that owns the rule containing `marker`. */
function selectorOf(marker) {
  const at = RULES.indexOf(marker)
  if (at === -1) return ''
  const open = RULES.lastIndexOf('{', at)
  return RULES.slice(RULES.lastIndexOf('\n', open) + 1, open).trim()
}
/** Is `root + suffix` one of the comma-separated members of `selector`? */
const lists = (selector, root, suffix) =>
  selector
    .split(',')
    .map((part) => part.trim())
    .includes(`${root}${suffix}`)

console.log('\n[1] the stylesheet is reachable and injected')
ok('theme.js exposes CSS', CSS.length > 5000, `${CSS.length} chars`)
ok('the stylesheet is injected from inside the factory', /document\.head\.appendChild/u.test(theme))
ok('injection is guarded by data-plugin-css', /data-plugin-css/u.test(theme) && /querySelector/u.test(theme))
// A backtick inside the CSS (easy to type in a comment) closes the template
// literal early: the bundler inlines text and would not notice, and the bundle
// would throw SyntaxError in the browser. The build now parses its own output, so
// what this checks is that the literal still reaches its intended END — the last
// rule of the narrow-viewport block — rather than being cut short along the way.
ok('the stylesheet literal closes where intended', CSS.includes('.sr-share-name{max-width:44%}'), `CSS captured ${CSS.length} chars`)

console.log('\n[2] the token block sits on EVERY surface root')
// The roots the components actually render as a top-level element.
const SURFACE_ROOTS = ['.sr-root', '.sr-strip-shell', '.sr-backdrop', '.sr-rail']
const rootListDecl = (/const SURFACE_ROOTS = \[([^\]]+)\]/u.exec(theme) ?? [])[1] ?? ''
const surfaces = rootListDecl
  .split(',')
  .map((s) => s.trim().replace(/^['"]|['"]$/gu, ''))
  .filter(Boolean)
ok('theme.js declares a SURFACE_ROOTS list', surfaces.length >= 3, rootListDecl)
for (const root of SURFACE_ROOTS) {
  ok(`SURFACES covers ${root}`, surfaces.includes(root), rootListDecl)
}
// The list must name classes that EXIST. It once said `.sr-strip-wrap` while the
// composer strip actually rendered `.sr-strip-shell`, so the strip got no tokens
// at all — and neither a coverage check nor a render test could see it.
const componentSource = Object.entries(sources)
  .filter(([file]) => file !== 'theme.js')
  .map(([, source]) => source)
  .join('\n')
for (const surface of surfaces) {
  const cls = surface.slice(1)
  ok(`SURFACES entry .${cls} is really rendered`, componentSource.includes(`'${cls}`), `no component renders .${cls}`)
}

console.log('\n[2b] no selector list shares a trailing combinator')
// The bug that produced every visual complaint at once. `.a,.b ::selection`
// styles `.a` ITSELF and only a descendant of `.b` — so concatenating a list into
// a descendant selector silently applies the declaration to the first N-1 roots:
// the panel and strip were painted with the selection tint, given a permanent
// accent outline, and skipped by box-sizing.
ok('the roots are declared as a list', /const SURFACE_ROOTS = \[[^\]]+\]/u.test(theme))
ok('the descendant set maps every root', /const SURFACES_ALL = SURFACE_ROOTS\.map\(\(root\) => `\$\{root\} \*`\)/u.test(theme))
ok('the selection set maps every root', /const SURFACES_SELECTION = SURFACE_ROOTS\.map\(\(root\) => `\$\{root\} ::selection`\)/u.test(theme))
ok('the focus set maps every root', /const SURFACES_FOCUS = SURFACE_ROOTS\.map\(\(root\) => `\$\{root\} :focus-visible`\)/u.test(theme))
ok('no bare ${SURFACES} is followed by a combinator', !/\$\{SURFACES\}\s+[^\s{]/.test(CSS))
// Assert against the RENDERED stylesheet: every root must appear as its own
// member of the expanded selector lists, not merely as the last one.
const boxSel = selectorOf('{box-sizing:border-box}')
const missingExpand = SURFACE_ROOTS.filter((root) => !lists(boxSel, root, ' *'))
ok('box-sizing lists every root as a descendant selector', missingExpand.length === 0, boxSel)
const selSel = selectorOf('{background:var(--sr-accent-weak);color:var(--sr-fg)}')
const missingSelection = SURFACE_ROOTS.filter((root) => !lists(selSel, root, ' ::selection'))
ok('selection lists every root as a descendant selector', missingSelection.length === 0, selSel)
const focusSel = selectorOf('{outline:2px solid var(--sr-accent)')
const missingFocus = SURFACE_ROOTS.filter((root) => !lists(focusSel, root, ' :focus-visible'))
ok('focus rings list every root as a descendant selector', missingFocus.length === 0, focusSel)
// And the root-ONLY rules must stay free of anything that paints the element.
const rootOnlyRules = [...RULES.matchAll(/\.sr-root,\.sr-strip-shell,\.sr-backdrop,\.sr-rail\{([^}]*)\}/gu)].map((m) => m[1])
ok('the root-only rules are found', rootOnlyRules.length >= 2, String(rootOnlyRules.length))
const rootBackground = rootOnlyRules.find((body) => body.includes('background'))
ok('the roots get no background from the shared rules', rootBackground === undefined, rootBackground)
const rootOutline = rootOnlyRules.find((body) => body.includes('outline'))
ok('the roots get no outline from the shared rules', rootOutline === undefined, rootOutline)

// The rule that defines the spacing token must be the SURFACES list, because
// `--sr-sp` is what every padding and gap in the sheet is built from. The
// selector is checked in the SOURCE (where it reads `${SURFACES}`), not in the
// rendered CSS, because that is where the guarantee lives.
const tokenSelectorLine = CSS.slice(0, CSS.indexOf('--sr-fg:')).trim().split('\n').pop().trim()
ok('the token block starts a rule', tokenSelectorLine === '${SURFACES}{', tokenSelectorLine)
ok('the token block is scoped to the interpolation, not a literal root', tokenSelectorLine.includes('${SURFACES}'))
ok('the token block is not scoped to .sr-root alone', tokenSelectorLine !== '.sr-root{', tokenSelectorLine)
ok('SURFACES is interpolated into the token block', /\$\{SURFACES\}\{\n--sr-fg:/u.test(CSS))

// The sheet is rendered as a SIBLING of the strip's root, so it must be able to
// stand on its own; `.sr-backdrop` being a token root is what makes that true.
ok('the install sheet renders a .sr-backdrop root', /className: closing \? 'sr-backdrop/u.test(sources['install.js']))
ok('base typography is applied to the surfaces', new RegExp(`\\$\\{SURFACES\\}\\{color:var\\(--sr-fg\\)`, 'u').test(theme))
ok('box-sizing is applied to every surface descendant', /\$\{SURFACES_ALL\}\{box-sizing:border-box\}/u.test(theme))

console.log('\n[3] every referenced token is defined somewhere')
const defined = new Set([...CSS.matchAll(/(--sr-[a-z0-9-]+)\s*:/gu)].map((m) => m[1]))
const referenced = new Set([...CSS.matchAll(/var\((--sr-[a-z0-9-]+)/gu)].map((m) => m[1]))
const undefinedTokens = [...referenced].filter((token) => !defined.has(token)).sort()
ok('the token set is not empty', defined.size > 15, String(defined.size))
ok('no rule references an undefined token', undefinedTokens.length === 0, undefinedTokens.join(', '))
ok('the spacing token is defined', defined.has('--sr-sp'))
ok('the accent token is defined', defined.has('--sr-accent'))

console.log('\n[4] every class the components use is styled or a known dynamic form')
// Dynamic fragments (`sr-tab-${mode}`) and behavioural markers are not styleable
// classes; they are listed explicitly so a genuinely missing rule still fails.
const NON_STYLE_CLASSES = new Set([
  'sr-autofocus', 'sr-focusable', 'sr-install-address', 'sr-install-display-zh', 'sr-install-file',
  'sr-install-name', 'sr-install-ref', 'sr-install-subpath', 'sr-install-text',
  // Keyframe names, not classes. `sr-toast-in` is the animation this module applies;
  // it is defined in an `@keyframes` block, which is not a class rule.
  'sr-toast-in', 'sr-spin', 'sr-shimmer', 'sr-pulse', 'sr-fade-in', 'sr-fade-out',
  'sr-sheet-in', 'sr-sheet-out', 'sr-tab-in', 'sr-liquid-reveal',
  // `id` / `aria-controls` / `aria-labelledby` values, not classes: the tab panel and
  // the tabs are addressed by id so the ARIA relationship works without a lookup.
  'sr-panel', 'sr-tab',
])
const DYNAMIC_PREFIXES = ['sr-body-']
/**
 * A class token, never a design token and never an animation name.
 *
 * The lookbehinds reject `--sr-ok` (a custom property) and `.sr-x` (a selector, which
 * `styled` already covers); the lookahead rejects `sr-toast-in(` (a function-ish
 * animation reference) — without them the 4.0 polish block's `color-mix(… var(--sr-warn) …)`
 * and its `animation:sr-toast-in …` made this report phantom unstyled classes.
 */
const CLASS_RE = /(?<![-\w.])(?<!\.)sr-[a-z0-9-]+(?![-\w]*\()/gu
/**
 * Every class the stylesheet styles, read from the RENDERED sheet — not the raw template
 * literal. The generated polish and design blocks are interpolated (`${POLISH_CSS}`), so
 * they exist only after evaluation; matching the source text reported every class they
 * introduce as unstyled even though the browser receives all of them.
 */
const styled = new Set([...RENDERED.matchAll(/\.(sr-[a-z0-9-]+)/gu)].map((m) => m[1]))
// The surface roots are styled through `${SURFACES}`, so they never appear as a
// literal `.sr-…` selector in the source text.
for (const surface of surfaces) styled.add(surface.slice(1))
const usedByComponents = new Map()
for (const [file, source] of Object.entries(sources)) {
  if (file === 'theme.js') continue
  for (const token of source.match(CLASS_RE) ?? []) {
    // A token can never END in a hyphen, so a trailing run of them means the match was
    // cut short — `'sr-toast--' + kind` in a template literal. Trimming keeps the base
    // class, which IS styled, and stops a phantom `sr-toast--` from being reported.
    const clean = token.replace(/-+$/u, '')
    if (clean === '') continue
    // An ANIMATION NAME is not a class, and it has no `.name{…}` rule to find because it lives in
    // an `@keyframes` at-rule. The old lookahead only rejected `name(` — a reference written
    // `animationName: 'sr-card-in'` slipped past it and was reported as an unstyled class. The
    // names are excluded here by identity, and ui-polish asserts each one HAS a keyframe block,
    // so this exclusion cannot hide a name that points at nothing.
    if (Object.hasOwn(design.KEYFRAMES, clean)) continue
    if (!usedByComponents.has(clean)) usedByComponents.set(clean, new Set())
    usedByComponents.get(clean).add(file)
  }
}
const missing = [...usedByComponents.keys()]
  .filter((token) => !styled.has(token))
  .filter((token) => !NON_STYLE_CLASSES.has(token))
  .filter((token) => !DYNAMIC_PREFIXES.some((prefix) => token.startsWith(prefix)))
  // A template-literal head (`'sr-panel-' + kind`) is not a class on its own; it is
  // only a class once a kind is appended, and every kind is styled. Recognised by the
  // fact that no rule — and no component — ever uses the bare stem.
  .filter((token) => !(token.endsWith('-') === false && [...styled].some((s) => s.startsWith(`${token}-`))))
  .sort()
ok('no component class is left unstyled', missing.length === 0, missing.join(', '))
ok('the sheet has its own layout rules', ['sr-sheet', 'sr-sheet-body', 'sr-sheet-foot', 'sr-field', 'sr-input'].every((c) => styled.has(c)))
ok('the sheet body stacks its children', /\.sr-sheet-body\{[^}]*flex-direction:column/u.test(CSS), '.sr-sheet-body must be a column flex box')
ok('the sheet itself stacks header/body/footer', /\.sr-sheet\{[^}]*flex-direction:column/u.test(CSS))
ok('composer strip is styled too', styled.has('sr-strip') && styled.has('sr-strip-shell') && styled.has('sr-strip-row'))
ok('the status rail is styled', styled.has('sr-rail') && styled.has('sr-toast'))

console.log('\n[4b] the tab underline cannot drift')
// The marker is a pseudo-element of the selected tab, so it is exact by
// construction. It must NOT go back to being a separate positioned element whose
// offset is computed in JS from geometry that the CSS does not guarantee.
ok('the selected tab draws its own underline', /\.sr-tab\[aria-selected="true"\]::after\{/u.test(CSS))
ok('the underline is anchored inside its own tab', /aria-selected="true"\]::after\{[^}]*left:calc/u.test(CSS) && /aria-selected="true"\]::after\{[^}]*right:calc/u.test(CSS))
ok('the tabs share the track equally', /\.sr-tab\{[^}]*flex:1 1 0/u.test(CSS))
ok('the track is a positioned flex box', /\.sr-tab-track\{[^}]*position:relative/u.test(CSS) && /\.sr-tab-track\{[^}]*display:flex/u.test(CSS))
ok('no separate indicator class is styled any more', !styled.has('sr-tab-ind'))
const scriptedIndicator = Object.entries(sources)
  .filter(([file]) => file !== 'theme.js')
  .some(([, source]) => /sr-tab-ind/u.test(source))
ok('no component renders a measured indicator', scriptedIndicator === false)

console.log('\n[4c] large surfaces stay neutral')
// The panel must not read as a stack of tinted boxes: the fill tokens that paint
// AREAS are our own neutral greys, not the app's tinted interactive tokens.
ok('the light fill tokens are neutral greys', /--sr-fill:rgba\(127,127,127/u.test(CSS) && /--sr-fill2:rgba\(127,127,127/u.test(CSS))
ok('the dark fill tokens are neutral', /--sr-fill:rgba\(255,255,255/u.test(CSS) && /--sr-fill2:rgba\(255,255,255/u.test(CSS))
ok('no area token borrows the app tinted fill scale', !/--sr-fill2?:var\(--dsw-alias-fill/u.test(CSS))
ok('the hero is an outlined block with no fill', /\.sr-hero\{[^}]*border:1px solid var\(--sr-line\)/u.test(CSS) && /\.sr-hero\{[^}]*background:transparent/u.test(CSS))

console.log('\n[4d] the panel is a surface, not a window onto the host')
// The panel used to be transparent with transparent cards, so what a user read as
// "the plugin's colour" was really the host painting through it — the only thing
// making a card a card was a hairline, and the result looked like a pale blue box.
ok('the panel paints its own surface', /\.sr-root\{[^}]*background:var\(--sr-card\)/u.test(CSS))
ok('the surface has an explicit dark value', /prefers-color-scheme: dark\)\{[\s\S]*--sr-card:#[0-9a-f]{3,6};/u.test(CSS))
ok('cards use the raised step', /\.sr-skill\{[^}]*background:var\(--sr-raised\)/u.test(CSS) && /\.sr-stat\{[^}]*background:var\(--sr-raised\)/u.test(CSS))
ok('no card is left transparent', !/\.sr-(?:skill|stat)\{[^}]*background:transparent/u.test(CSS))

console.log('\n[4e] the layout is capped and grouped')
// Without a cap, an ultra-wide window produced half-metre-wide stat frames and a
// six-column catalogue of truncated names.
// 4.0: the cap is no longer a fixed pixel count. A fixed cap is what let the strip
// above the composer grow WIDER than the composer on a narrow window; it is now
// derived from the host's own composer width. `test/ui-polish.mjs` owns the arithmetic
// (that the result is always narrower); this line only pins that a cap exists and is
// applied to the panel, and that it is not a magic number again.
ok('the panel content is capped', /--sr-max:[^;]*(?:dsh-composer-card-max-width|var\()/u.test(CSS) && /\.sr-root\{[^}]*max-width:var\(--sr-max\)/u.test(CSS), (/--sr-max:[^;]*/u.exec(CSS) ?? [''])[0])
ok('the cap is derived from the host, not invented', /--sr-max:calc\(var\(--dsh-composer-card-max-width/u.test(CSS), (/--sr-max:[^;]*/u.exec(CSS) ?? [''])[0])
// Auto margins, not percentage padding: they were measured to disagree, and the
// padding version left the column shoved to one side of the window.
ok('the cap is centred with auto margins', /\.sr-root\{[^}]*margin-inline:auto/u.test(CSS))
ok('the cap is not percentage padding', !/\.sr-root\{[^}]*padding-inline:max/u.test(CSS))
ok('the panel never scrolls sideways', /\.sr-root\{[^}]*overflow-x:hidden/u.test(CSS))
ok('the stat cells put label and value on one line', /\.sr-stat\{[^}]*flex-direction:row-reverse/u.test(CSS) && /\.sr-stat\{[^}]*justify-content:space-between/u.test(CSS))
ok('the section count sits beside its label', /\.sr-sec-t\{flex:0 1 auto/u.test(CSS))
ok('secondary card actions are not outlined like buttons', /\.sr-row-actions \.sr-btn--icon\{[^}]*border-color:transparent/u.test(CSS))
ok('an armed delete keeps its danger treatment', /\.sr-row-actions \.sr-btn--armed\{[^}]*var\(--sr-danger\)/u.test(CSS))

console.log('\n[5] the dark theme still resolves')
ok('labels still fall back to the design system variables', /var\(--dsw-alias-label-primary/u.test(CSS))
// Hairlines must be OUR values. The host's `--dsw-alias-border-l1` is #0000000a —
// 4% black, i.e. invisible — and borrowing it erased every border in the panel.
ok('hairlines are our own values', /--sr-line:rgba\(0,0,0,\.[0-9]+\)/u.test(CSS) && /--sr-line2:rgba\(0,0,0,\.[0-9]+\)/u.test(CSS))
ok('hairlines do not borrow the host border tokens', !/--sr-line2?:var\(--dsw-alias-border/u.test(CSS))
ok('hairlines have a visible dark-theme value', /prefers-color-scheme: dark\)\{[\s\S]*--sr-line:rgba\(255,255,255,\.[0-9]+\)/u.test(CSS))
ok('a dark-scheme fallback exists for every surface', /@media \(prefers-color-scheme: dark\)\{\n\$\{SURFACES\}\{/u.test(CSS))
const darkBlock = (/@media \(prefers-color-scheme: dark\)\{([\s\S]*?)\n\}\n/u.exec(CSS) ?? [])[1] ?? ''
const darkTokens = new Set([...darkBlock.matchAll(/--sr-[a-z0-9-]+(?=\s*:)/gu)].map((m) => m[0]))
const darkMissing = ['--sr-fg', '--sr-fg2', '--sr-fg3', '--sr-line', '--sr-line2', '--sr-fill'].filter((t) => !darkTokens.has(t))
ok('the dark block redefines the core tokens', darkMissing.length === 0, darkMissing.join(', '))
ok('a reduced-motion override exists', /prefers-reduced-motion/u.test(CSS))
ok('a reduced-transparency override exists', /prefers-reduced-transparency/u.test(CSS))
ok('a narrow-viewport override exists', /max-width:560px/u.test(CSS))
ok('the reduced-motion rule also covers the surfaces', /\$\{SURFACES_ALL\},\.sr-sheet\{transition:none/u.test(theme))

console.log('\n[4f] the composer strip lines up with the panel and joins it')
// The strip sits in the composer dock, which is wider than the capped panel. It
// has to be capped the same way, or the two blocks have different edges.
ok('the strip shell is capped like the panel', RENDERED.includes('.sr-strip-shell{max-width:var(--sr-max)}') || /\.sr-strip-shell\{[^}]*max-width:var\(--sr-max\)/u.test(RENDERED))
// 4.0: centring and de-stretching are separate generated rules (one per record), so each
// declaration is asserted over the whole sheet rather than inside one `{...}` block —
// `\.sr-strip-shell\{[^}]*x` only ever sees the FIRST matching rule.
// Asserted against RENDERED, not the raw template literal: the 4.0 polish block is
// INTERPOLATED, so it exists only in the evaluated stylesheet. Reading the source text
// would miss every generated rule — which is exactly how a rule that is present and
// working was reported as absent.
ok('the strip shell is centred the same way', RENDERED.includes('.sr-strip-shell{margin-inline:auto}'))
ok('...and so is the panel it opens into', RENDERED.includes('.sr-root{margin-inline:auto}'))
ok('...with neither of them stretched by the dock\'s column flex',
  RENDERED.includes('.sr-strip-shell{align-self:center}') && RENDERED.includes('.sr-root{align-self:center}'),
  JSON.stringify([...RENDERED.matchAll(/\.sr-(?:strip-shell|root)\{align-self[^}]*\}/gu)].map((m) => m[0])))
/**
 * THE OPEN STRIP: the shell is a TRANSPARENT LAYOUT COLUMN and each float owns its own surface.
 *
 * These four assertions previously pinned the opposite — one frame on the shell, with `gap:0`, a radius, a shadow and
 * `overflow:hidden` — on the reasoning that a frame per half left the box open-ended. That reasoning was overtaken: the
 * design pass moved to two separate floats (the bar, then the report beneath it), so the shell's frame was neutralised
 * while the declarations stayed behind. The consequence was measurable and is what the owner reported: the shell's
 * radius was still 12px while the bar, the row inside it, the panel and every card were 8 — ONE component showing
 * several different corner roundings.
 *
 * So these now assert the ABSENCE. `overflow:hidden` in particular is not cosmetic: it was what stopped the counters
 * riding the bar in the open state.
 */
ok('opening the strip keeps a gap, because it is two floats not one card', /\.sr-strip-shell--open\{[^}]*gap:calc\(/u.test(CSS))
ok('the shell draws NO frame of its own', !/\.sr-strip-shell--open\{[^}]*border:1px/u.test(CSS))
ok('...no radius and no shadow either', !/\.sr-strip-shell--open\{[^}]*border-radius/u.test(CSS) && !/\.sr-strip-shell--open\{[^}]*box-shadow:(?!none)/u.test(CSS))
ok('...and does NOT clip, so the counters can ride the bar', !/\.sr-strip-shell--open\{[^}]*overflow:hidden/u.test(CSS))
/**
 * THE BAR'S RADIUS CHANGES WITH THE STATE, and that is deliberate rather than an inconsistency.
 *
 * Closed, the bar IS the surface and takes the large step — the same corner as the host's composer card, which is the
 * reference the owner named. Open, the ROW around it becomes the surface and the bar is a control sitting inside it, so
 * it drops to the small step. The host's own scale makes exactly this distinction: 22 for its composer card, 8 for the
 * selects inside it.
 *
 * What must NOT happen is the radius being zeroed, which is what this rule did when the shell was the surface.
 */
ok('the open bar names the SMALL step, since the float around it is the surface',
  /\.sr-strip-shell--open \.sr-strip\{[^}]*border-radius:var\(--sr-r-sm\)/u.test(CSS))
ok('the component marks the open state', componentSource.includes('sr-strip-shell--open'), 'the shell class never switches to the open modifier')
ok('the strip panel adds no frame of its own', /\.sr-strip-panel\{[^}]*border:0;/u.test(CSS))
ok('the report inside the card drops its frame too', /\.sr-strip-panel \.sr-root\{[^}]*border:0/u.test(CSS))
// Nested scrollers break a sticky bottom: the element pins to the OUTER scrollport
// while being constrained to its own containing block, so the footer ended up
// mid-content with the catalogue still visible beneath it.
ok('the strip panel is NOT a scroller', /\.sr-strip-panel\{[^}]*overflow:hidden/u.test(CSS) && !/\.sr-strip-panel\{[^}]*overflow:auto/u.test(CSS))
ok('the strip panel is a flex column, so its child can take a definite height', /\.sr-strip-panel\{[^}]*display:flex/u.test(CSS) && /\.sr-strip-panel\{[^}]*flex-direction:column/u.test(CSS))
ok('the report inside is the one and only scroller', /\.sr-strip-panel \.sr-root\{[^}]*flex:1/u.test(CSS) && /\.sr-strip-panel \.sr-root\{[^}]*min-height:0/u.test(CSS) && /\.sr-strip-panel \.sr-root\{[^}]*overflow-y:auto/u.test(CSS))
ok('the footer really is sticky to the bottom', /\.sr-foot\{[^}]*position:sticky/u.test(CSS) && /\.sr-foot\{[^}]*bottom:0/u.test(CSS))
// min-height:0 on this child compresses it to one screen, which strands the footer
// mid-list: flex:1 puts the footer's flow position at the container's bottom while
// the overflowing content keeps painting below the footer's box.
ok('the scrolling body is never compressed below its content', /\.sr-body\{flex:1\}/u.test(CSS) && !/\.sr-body\{[^}]*min-height:0/u.test(CSS))
// The old single-card shape is GONE, and asserting its absence is the point: these rules were the shell's frame, its
// radius, its clipping and the bar's row rule, and each one is now drawn by a float instead.
ok('the bar row no longer doubles as a card header', !/\.sr-strip-shell--open \.sr-strip-row\{[^}]*border-bottom/u.test(CSS))
// When open, `.sr-strip-row` is the float that carries the frame and the bar inside it is transparent.
ok('the bar inside the open float is transparent, not framed twice', /\.sr-strip-shell--open \.sr-strip\{[^}]*background:transparent/u.test(CSS))
ok('...and still has a radius of its own rather than none', /\.sr-strip-shell--open \.sr-strip\{[^}]*border-radius:var\(--sr-r-sm\)/u.test(CSS))
// The bar row already has install + refresh; the report's header must not repeat them.
ok('the report header is not duplicated inside the card', /\.sr-strip-shell--open \.sr-strip-panel \.sr-head \.sr-btn\{display:none\}/u.test(CSS))

console.log('\n[4h] the panel is a framed surface')
// It had no frame at all: only inner blocks were bordered, so on a white page the
// panel had no boundary and every block read as floating text.
ok('the panel has a real border', /\.sr-root\{[^}]*border:1px solid var\(--sr-line\)/u.test(CSS))
ok('the panel has rounded corners', /\.sr-root\{[^}]*border-radius:var\(--sr-r\)/u.test(CSS))
ok('the panel lifts off the page', /\.sr-root\{[^}]*box-shadow:/u.test(CSS))
ok('the strip bar is bordered too', /\.sr-strip\{[^}]*border:1px solid var\(--sr-line\)/u.test(CSS))
ok('sections are separated by a rule', /\.sr-sec\{border-top:1px solid var\(--sr-line\)\}/u.test(CSS))
ok('the hairline is strong enough to see', (() => {
  const m = /--sr-line:rgba\(0,0,0,\.(\d+)\)/u.exec(CSS)
  return m !== null && Number(`0.${m[1]}`) >= 0.1
})(), (/--sr-line:rgba\([^)]*\)/u.exec(CSS) ?? [''])[0])

console.log('\n[4g] no large surface borrows a host colour')
// The host's menu token is a pale tinted blue in the light theme: painting the
// panel column with it made everything look washed out and produced a visible
// edge where the column met the white background around it.
ok('the surface is a value we own', /--sr-card:#[0-9a-f]{3,6};/u.test(CSS), 'the surface token must not be a host variable')
ok('the surface is not a host token', !/--sr-card:var\(/u.test(CSS))
ok('the hero has no fill at all', /\.sr-hero\{[^}]*background:transparent/u.test(CSS))

console.log('\n[4i] the "used nothing" signal is amber, and never the error colour')
// Item 43. "No skill this turn" is the signal this plugin exists to report, and a
// turn without a skill is a NORMAL turn — so it must not be painted with the error
// colour anywhere, and it needs a weak companion token to sit on.
ok('a weak warn token exists', /--sr-warn-weak:rgba\(199,137,27,\.\d+\)/u.test(RULES), (/--sr-warn-weak:[^;]*/u.exec(RULES) ?? [''])[0])
ok('...and has a dark-theme value', /prefers-color-scheme: dark\)\{[\s\S]*--sr-warn-weak:rgba\(224,168,60/u.test(RULES))
const noSkillRules = [...RULES.matchAll(/\.sr-(?:badge--none|age--none)\{[^}]*\}/gu)].map((m) => m[0])
// `>=` rather than `==`: the 4.0 polish block adds a warn-tinted ring to the same
// carrier, and that is an ADDITIONAL treatment of one signal, not a second signal.
ok('both no-skill carriers are styled', noSkillRules.length >= 2, String(noSkillRules.length))
ok('...every rule for them uses the warn family', noSkillRules.every((rule) => rule.includes('var(--sr-warn)')), noSkillRules.join(' '))
// The primary treatment must still carry BOTH the weak fill and the strong ink; a
// polish rule is allowed to add to it but not to be the only thing left.
const primaryNone = noSkillRules.filter((rule) => rule.includes('var(--sr-warn-weak)'))
ok('...and the carriers keep their weak fill', primaryNone.length >= 2, noSkillRules.join(' '))
ok('...and never on the danger token', noSkillRules.every((rule) => !rule.includes('--sr-danger')), noSkillRules.join(' '))
ok('the hero chip carries its own dot', /\.sr-badge--none:before\{[^}]*border-radius:50%/u.test(RULES))

console.log('\n[4j] the new empty-state, success and usage surfaces are styled')
ok('the guidance block is styled', ['sr-guide', 'sr-guide-body', 'sr-guide-title', 'sr-guide-text', 'sr-guide-act'].every((c) => styled.has(c)))
ok('the guidance block is a row with a flexible body', /\.sr-guide\{[^}]*display:flex/u.test(RULES) && /\.sr-guide-body\{[^}]*flex:1/u.test(RULES))
ok('a success note has its own treatment', /\.sr-note--ok\{[^}]*var\(--sr-ok\)/u.test(RULES) && /\.sr-note--ok\{[^}]*var\(--sr-ok-weak\)/u.test(RULES))
ok('the usage marker differs from a plain tag', /\.sr-tag--used\{[^}]*var\(--sr-accent-weak\)/u.test(RULES) && /\.sr-tag--used\{[^}]*var\(--sr-accent\)/u.test(RULES))

console.log('\n[4k] container queries are NAMED, so a strip cannot be sized by an unrelated ancestor')
/**
 * THE BUG THIS EXISTS FOR: `@container (max-width:640px)` with no name.
 *
 * An unnamed container query resolves against the NEAREST ANCESTOR container. This stylesheet declares
 * `container-type: inline-size` on BOTH `.sr-strip-shell` and `.sr-root`, and the strip is rendered inside the host's own
 * composer column — so "the nearest ancestor container" is whatever the host happens to put above the dock, not the strip.
 * On the owner's machine it resolved against a container that was not the strip, so the NARROW layout applied to a
 * full-width strip: the four counters wrapped to a second line, the bar grew taller than its box, and the shell's
 * `overflow:hidden` clipped it mid-label.
 *
 * Every existing test passed through that, because each rule is correct in isolation. What was missing is that a query must
 * NAME the container it means. These assert the naming rather than re-testing the resulting sizes.
 */
const containerQueries = [...RULES.matchAll(/@container\s*([a-z-]*)\s*\(/gu)].map((m) => m[1])
ok('the stylesheet uses container queries', containerQueries.length >= 2, `${containerQueries.length} found`)
ok('...and EVERY one of them names its container',
  containerQueries.length > 0 && containerQueries.every((name) => name !== ''),
  JSON.stringify(containerQueries))
// A named query only matches if some rule declares that name — otherwise it silently never applies.
const declaredNames = [...RULES.matchAll(/container-name:\s*([a-z-]+)/gu)].map((m) => m[1])
ok('...and every queried name is declared on an element',
  [...new Set(containerQueries)].every((name) => declaredNames.includes(name)),
  `queried ${JSON.stringify([...new Set(containerQueries)])} vs declared ${JSON.stringify(declaredNames)}`)
// Targeted by NAME: the strip's breakpoint must ask about the strip, which is exactly the conflation that caused the report.
ok('the strip\'s narrow layout queries the strip itself',
  /@container sr-strip \(max-width:640px\)/u.test(RULES) && /container-name:sr-strip/u.test(RULES))

console.log('\n[4l] the composer strip compacts instead of adding a clipped second row')
ok('the background action compacts before the host composer reaches its 936px cap',
  /@container sr-strip \(max-width:950px\)\{[\s\S]*\.sr-bg-open\{[^}]*width:26px/u.test(RULES))
ok('the strip and its right flank explicitly stay on one line',
  /@container sr-strip \(max-width:950px\)\{[\s\S]*\.sr-strip\{[^}]*flex-wrap:nowrap/u.test(RULES) &&
  /\.sr-strip-shell \.sr-strip-right\{flex-wrap:nowrap/u.test(RULES))
ok('no responsive rule restores the clipped wrapping layout',
  !/\.sr-strip(?:-right)?\{[^}]*flex-wrap:wrap/u.test(RULES))
ok('the two minimum host widths may hide labels but keep the values',
  /@container sr-strip \(max-width:720px\)\{[\s\S]*\.sr-stat-l\{display:none/u.test(RULES))

console.log(`\nRESULT: ${pass}/${pass + fail} passed`)
if (fail > 0) process.exit(1)
