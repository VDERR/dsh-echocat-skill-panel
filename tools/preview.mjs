#!/usr/bin/env node
// Render the real panel to a static page and screenshot it in Chrome.
//
// WHY THIS EXISTS
// ---------------
// This stylesheet's worst bugs were invisible to every DOM-free test and to arithmetic:
// a token defined only on `.sr-root` while the sheet rendered as its sibling (the sheet
// came out as unstyled HTML), a comma selector list that painted whole surfaces blue and
// outlined them, a sticky footer stranded mid-list. All of those were found by looking at
// a screen, late, one at a time.
//
// So this renders the ACTUAL components --- `SkillReportPanel`, `SkillReportStrip`,
// `InstallSheet` --- with the ACTUAL stylesheet, through the same CommonJS shim and the
// same hook runtime the bundle test uses, serialises the tree to HTML, and screenshots it
// in light and dark. It is how a design change is checked before a human has to look.
//
// Usage:  node tools/preview.mjs [outfile.png]
// Output: tools/preview-<variant>.png, plus the HTML it rendered.

import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const pkgRoot = join(here, '..')

/* ------------------------------------------------------------------ module shim -- */

/** Evaluate one CJS client source with a stub `require`, exactly like the bundle does. */
function loadClientModule(state, id) {
  if (state.cache[id] !== undefined) return state.cache[id]
  const module = { exports: {} }
  state.cache[id] = module.exports
  const source = readFileSync(join(pkgRoot, 'src', 'client', id), 'utf8')
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', 'require', source)(module, module.exports, (spec) => {
    if (spec === 'react') return state.React
    if (spec.startsWith('./')) return loadClientModule(state, spec.slice(2))
    throw new Error(`${id} must not require ${spec}`)
  })
  state.cache[id] = module.exports
  return module.exports
}

/* --------------------------------------------------------------- hook runtime -- */

/** The component currently being rendered, so its hook cells get stable keys. */
let currentHookKey = 'root'

/**
 * Enough of the hooks API to render once, statically.
 *
 * Every component in this plugin is a pure function of its props plus module-level
 * stores, so a single pass with real hook semantics is enough to produce the tree a user
 * would see. Effects are collected and dropped: the two that exist kick off polling and
 * an update check, neither of which belongs in a screenshot.
 */
function makeReact() {
  const cells = new Map()
  const key = (kind, index) => `${currentHookKey}::${kind}${index}`
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false) }),
    Fragment: '#fragment',
    useRef: (initial) => {
      const id = key('r', cells.size)
      if (!cells.has(id)) cells.set(id, { current: initial })
      return cells.get(id)
    },
    useState: (initial) => {
      const id = key('s', cells.size)
      if (!cells.has(id)) cells.set(id, typeof initial === 'function' ? initial() : initial)
      return [cells.get(id), () => {}]
    },
    useMemo: (fn) => fn(),
    useCallback: (fn) => fn,
    useEffect: () => {},
    useLayoutEffect: () => {},
    useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
  }
  return React
}

/* ------------------------------------------------------------------- serialiser -- */

const VOID_TAGS = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'source', 'area', 'base', 'col', 'embed', 'track', 'wbr'])
const HTML_ATTR = { className: 'class', htmlFor: 'for', tabIndex: 'tabindex', spellCheck: 'spellcheck', autoComplete: 'autocomplete', colSpan: 'colspan', rowSpan: 'rowspan' }

/** `ariaLabel` -> `aria-label`, `dataFoo` -> `data-foo`, `onClick` -> dropped. */
function attrName(name) {
  if (name.startsWith('on')) return undefined
  if (HTML_ATTR[name] !== undefined) return HTML_ATTR[name]
  if (name === 'value') return undefined // React sets the property; a static page needs `defaultValue`
  if (name === 'defaultValue') return 'value'
  if (name.startsWith('aria') && name[4] === name[4]?.toUpperCase()) return `aria-${name.slice(4).toLowerCase()}`
  if (name.startsWith('data') && name[4] === name[4]?.toUpperCase()) return `data-${name.slice(4).replace(/[A-Z]/gu, (c) => `-${c.toLowerCase()}`)}`
  if (/^[a-z][a-z0-9-]*$/u.test(name)) return name
  return name.replace(/[A-Z]/gu, (c) => `-${c.toLowerCase()}`)
}

const escapeHtml = (text) => String(text).replace(/[&<>]/gu, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])
const escapeAttr = (text) => escapeHtml(text).replace(/"/gu, '&quot;')

/** Inline `style={{...}}` objects, the few places the components set one directly. */
function styleAttr(style) {
  if (style === undefined || style === null || typeof style !== 'object') return undefined
  const text = Object.entries(style)
    .map(([key, value]) => `${key.replace(/[A-Z]/gu, (c) => `-${c.toLowerCase()}`)}:${value}`)
    .join(';')
  return text === '' ? undefined : text
}

/** Distinct hook-cell keys, so two components' `useState` calls cannot collide. */
let hookSeq = 0

function serialize(node) {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (Array.isArray(node)) return node.map(serialize).join('')
  if (typeof node === 'string' || typeof node === 'number') return escapeHtml(node)
  const { type, props, children } = node
  if (type === '#fragment') return children.map(serialize).join('')
  // A function component is INVOKED, the way React would: it is a pure function of its
  // props, so one call produces the element tree. Its hooks get a fresh key so that two
  // instances of the same component (a card, a section) do not share state.
  if (typeof type === 'function') {
    hookSeq += 1
    const previous = currentHookKey
    currentHookKey = `${type.name || 'Anon'}#${hookSeq}`
    try {
      return serialize(type({ ...props, children: children.length === 0 ? undefined : children.length === 1 ? children[0] : children }))
    } catch (error) {
      throw new Error(`rendering ${currentHookKey} threw: ${error?.message ?? error}`)
    } finally {
      currentHookKey = previous
    }
  }
  const attrs = []
  for (const [name, value] of Object.entries(props)) {
    if (name === 'children' || value === undefined || value === null || value === false) continue
    if (name === 'style') {
      const style = styleAttr(value)
      if (style !== undefined) attrs.push(`style="${escapeAttr(style)}"`)
      continue
    }
    const attr = attrName(name)
    if (attr === undefined) continue
    attrs.push(value === true ? attr : `${attr}="${escapeAttr(value)}"`)
  }
  const open = `<${type}${attrs.length === 0 ? '' : ` ${attrs.join(' ')}`}>`
  if (VOID_TAGS.has(type)) return open
  return `${open}${children.map(serialize).join('')}</${type}>`
}

/* ------------------------------------------------------------------- the fixture -- */

const REPO = 'https://github.com/VDERR/echocat-skill-panel-3.0.git'

/** A catalogue with every card state the design has to survive. */
const SKILLS = [
  { name: 'cinema-dna-21x9x3', description: 'transpose a story into a 21:9 cinematic single frame', descriptionZh: '把故事转译成电影感 21:9 单帧、三联镜头或九镜故事板，锁住人物与风格一致性。', displayNameZh: '电影感 21:9 三联分镜', tag: '影视', modelInvocable: true, provenance: { known: true, source: 'git', url: REPO, repo: REPO, ref: 'main', subpath: 'skills/cinema', commit: 'a'.repeat(40), claimed: false, changedSinceInstall: false }, dir: 'C:\\Users\\Administrator\\.dsh-beta\\skills\\cinema-dna-21x9x3', modifiedAt: Date.now() - 86400000 },
  { name: 'h3-prompt-writing', description: 'Write MiniMax H3 video prompts for T2VA, I2VA, FL2VA, L2VA, Ref2VA', descriptionZh: '为 T2VA、I2VA、FL2VA、L2VA 与 Ref2VA 写 MiniMax H3 视频提示词。', displayNameZh: '', tag: '提示词', modelInvocable: true, provenance: { known: true, source: 'git', url: REPO, repo: REPO, ref: 'main', subpath: 'skills/h3', commit: 'a'.repeat(40), claimed: false, changedSinceInstall: true }, dir: 'C:\\Users\\Administrator\\.dsh-beta\\skills\\h3-prompt-writing', modifiedAt: Date.now() - 3600000 },
  { name: 'paper-collage-explainer-generator', description: 'tactile paper-collage language for narration and knowledge points', descriptionZh: '', displayNameZh: '', tag: '教育', modelInvocable: false, provenance: { known: true, source: 'url', url: 'https://example.com/pack.zip', repo: '', ref: '', subpath: '', commit: '', claimed: false, changedSinceInstall: false }, dir: 'C:\\Users\\Administrator\\.dsh-beta\\skills\\paper-collage', modifiedAt: Date.now() - 600000 },
  { name: 'gpt-image', description: 'Generate or edit images with GPT Image 2', descriptionZh: '用 GPT Image 2 生成或编辑图片，支持海报、排版、中文文字与 UI 稿。', displayNameZh: '图像生成', tag: '图像', modelInvocable: true, provenance: { known: false, source: '', changedSinceInstall: false }, dir: 'C:\\Users\\Administrator\\.dsh-beta\\skills\\gpt-image', modifiedAt: Date.now() - 7200000 },
  { name: 'manual-only-skill', description: 'reachable only through the /name gesture', descriptionZh: '', displayNameZh: '', tag: '', modelInvocable: false, provenance: { known: true, source: 'text', url: '', repo: '', ref: '', subpath: '', commit: '', claimed: false, changedSinceInstall: false }, dir: 'C:\\Users\\Administrator\\.dsh-beta\\skills\\manual-only-skill', modifiedAt: Date.now() - 259200000 },
  { name: 'music-video-subtitle-generator', description: 'beat-synced lyric typography for music videos', descriptionZh: '按节拍与唱词切分长片，设计随拍律动的空间排版。', displayNameZh: '音乐视频字幕', tag: '音乐', modelInvocable: true, provenance: { known: true, source: 'git', url: REPO, repo: REPO, ref: 'main', subpath: 'skills/mv', commit: 'b'.repeat(40), claimed: true, changedSinceInstall: false }, dir: 'C:\\Users\\Administrator\\.dsh-beta\\skills\\music-video', modifiedAt: Date.now() - 172800000 },
]

const CALLS = [
  { name: 'cinema-dna-21x9x3', how: 'model' },
  { name: 'h3-prompt-writing', how: 'user' },
  { name: 'gpt-image', how: 'model' },
]

const SNAPSHOT = {
  plugin: 'echocat-skill-panel-3.0',
  version: '4.0.0',
  generatedAt: Date.now(),
  pending: [],
  turns: 37,
  turnsWithSkills: 24,
  turnsWithoutSkills: 13,
  invocations: 61,
  perSkill: [
    { name: 'cinema-dna-21x9x3', count: 19 },
    { name: 'gpt-image', count: 14 },
    { name: 'h3-prompt-writing', count: 11 },
    { name: 'music-video-subtitle-generator', count: 9 },
    { name: 'paper-collage-explainer-generator', count: 5 },
    { name: 'manual-only-skill', count: 3 },
  ],
  recent: [
    { at: Date.now() - 40000, sessionId: 's1', sessionTitle: '把这段故事做成 21:9 分镜', calls: CALLS, reason: '' },
    { at: Date.now() - 400000, sessionId: 's1', sessionTitle: '把这段故事做成 21:9 分镜', calls: [], reason: 'none' },
    { at: Date.now() - 900000, sessionId: 's2', sessionTitle: '给产品做个 15 秒短片', calls: [{ name: 'gpt-image', how: 'model' }], reason: '' },
    { at: Date.now() - 1800000, sessionId: 's2', sessionTitle: '给产品做个 15 秒短片', calls: [{ name: 'manual-only-skill', how: 'user' }], reason: '' },
    { at: Date.now() - 3600000, sessionId: 's3', sessionTitle: '整理一下字幕节拍', calls: [{ name: 'music-video-subtitle-generator', how: 'model' }, { name: 'h3-prompt-writing', how: 'model' }], reason: '' },
    { at: Date.now() - 7200000, sessionId: 's3', sessionTitle: '整理一下字幕节拍', calls: [], reason: 'error' },
  ],
  skills: SKILLS,
  capability: {
    api: 1,
    root: 'C:\\Users\\Administrator\\.dsh-beta\\skills',
    backupRoot: 'C:\\Users\\Administrator\\.dsh-beta\\skill-report\\backups',
    writable: true,
    modes: ['auto', 'text', 'file', 'url', 'git'],
    limits: { uploadBytes: 25165824, fileBytes: 8388608, totalBytes: 67108864, files: 600, markdownBytes: 524288 },
    allowPrivateHosts: false,
    git: true,
  },
  installHistory: [
    { at: Date.now() - 300000, action: 'update', name: 'cinema-dna-21x9x3', ok: true, ms: 1840 },
    { at: Date.now() - 600000, action: 'check', name: '', ok: true, ms: 420 },
    { at: Date.now() - 1200000, action: 'install', mode: 'git', name: 'h3-prompt-writing', ok: true, ms: 2610 },
    { at: Date.now() - 2000000, action: 'install', mode: 'url', name: 'bad-pack', ok: false, code: 'BAD_ARCHIVE', message: '压缩包里找不到 SKILL.md。', ms: 310 },
  ],
}

const TOASTS = [
  { kind: 'ok', message: '已更新 · cinema-dna-21x9x3 · 8 个文件', hint: '备份：C:\\Users\\Administrator\\.dsh-beta\\skill-report\\backups\\2026-09-20T05-10-22-cinema-dna-21x9x3' },
  { kind: 'error', message: '已经有一个叫 "gpt-image" 的 skill 了。', hint: '勾选「覆盖同名的已有 skill」后重试。' },
  { kind: 'pending', message: '正在检查更新…' },
]

/* ------------------------------------------------------------------- the page -- */

/**
 * The host's own design tokens, in the values this app actually ships.
 *
 * Kept here (rather than stubbed as empty) because the whole point of the preview is to
 * see the panel in its real context: our tokens fall back to these, so a preview with a
 * blank host would show fallbacks the user never sees.
 */
const HOST_TOKENS = `
:root{
--dsw-alias-bg-base:#ffffff;
--dsw-alias-label-primary:#0f1115;
--dsw-alias-label-secondary:#5b6270;
--dsw-alias-label-tertiary:#8b93a1;
--dsw-alias-label-error:#d54941;
--dsw-alias-border-l1:rgba(0,0,0,.06);
--dsw-alias-border-l2:rgba(0,0,0,.12);
--dsh-chat-content-width:min(calc(100% - 32px), 920px);
--dsh-composer-card-max-width:calc(var(--dsh-chat-content-width) + 32px);
}
.dark{
--dsw-alias-bg-base:#0b0c0e;
--dsw-alias-label-primary:#e9eaee;
--dsw-alias-label-secondary:#a6abb6;
--dsw-alias-label-tertiary:#767c88;
--dsw-alias-label-error:#f4736a;
--dsw-alias-border-l1:rgba(255,255,255,.08);
--dsw-alias-border-l2:rgba(255,255,255,.16);
}
*{box-sizing:border-box}
body{margin:0;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);
font:13px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}
.stage{display:grid;grid-template-columns:1fr 1fr;gap:28px;padding:28px;align-items:start;max-width:2100px;margin:0 auto}
.col{min-width:0}
.col > h2{font:600 12px/1.4 ui-monospace,monospace;text-transform:uppercase;letter-spacing:.08em;
color:var(--dsw-alias-label-tertiary);margin:0 0 12px}
.frame{border:1px solid var(--dsw-alias-border-l1);border-radius:14px;overflow:hidden;background:var(--dsw-alias-bg-base)}
.composer{margin-top:14px;border:1px solid var(--dsw-alias-border-l2);border-radius:16px;padding:14px 16px;
color:var(--dsw-alias-label-tertiary);max-width:var(--dsh-composer-card-max-width)}
/* The install sheet is a position:fixed modal; this gives it a box to fill. */
.sheet-frame{position:relative;height:900px;border:1px solid var(--dsw-alias-border-l1);border-radius:14px;overflow:hidden;background:var(--dsw-alias-bg-base)}
.sheet-frame .sr-backdrop{position:absolute}
.dark{background:#0e1013;padding:28px}
`

function buildPage(state, exports) {
  const React = state.React
  const h = React.createElement
  const panel = exports.__ui.SkillReportPanel
  const strip = exports.__ui.SkillReportStrip
  // The sheet and the rail live in `install.js`, which `__ui` does not re-export; they are
  // reached through `__install`, the same seam the bundle test uses.
  const sheet = exports.__install.InstallSheet
  // The store-backed rail is `LiveRail`; the presentational one that takes a `toasts` prop
  // is `StatusRail`, which is what a static render can actually populate.
  const liveRail = exports.__install.StatusRail
  if (typeof panel !== 'function' || typeof strip !== 'function' || typeof sheet !== 'function' || typeof liveRail !== 'function') {
    throw new Error(`preview could not reach a component: panel=${typeof panel} strip=${typeof strip} sheet=${typeof sheet} rail=${typeof liveRail}`)
  }

  const sections = []

  // 1. the centre panel, which is the surface with the most components on it.
  //    `onInstall` is supplied so the header's install affordance renders.
  sections.push(h('div', { className: 'col', key: 'panel' }, [
    h('h2', { key: 'h' }, 'centre panel / 中栏面板'),
    h('div', { className: 'frame', key: 'f', style: { height: '1180px', display: 'flex' } }, [
      h(panel, { key: 'p', snapshot: SNAPSHOT, onRefresh: () => {}, onUse: () => {}, onInstall: () => {}, now: Date.now() }),
    ]),
  ]))

  // 2. the composer strip open, above a stand-in composer, then the sheet and the rail.
  sections.push(h('div', { className: 'col', key: 'strip' }, [
    h('h2', { key: 'h' }, 'composer strip / 输入框上方横栏（展开）'),
    h('div', { className: 'frame', key: 'open', style: { padding: '16px', background: 'var(--dsw-alias-bg-base)' } }, [
      h(strip, { key: 's', state: { phase: 'ready', data: SNAPSHOT, error: null, fetchedAt: Date.now() }, onRefresh: () => {}, onUse: () => {}, now: Date.now() }),
    ]),
    h('div', { className: 'composer', key: 'c' }, '描述你想要构建的内容，/ 调用指令，@ 文件或对话'),
    h('h2', { key: 'h2', style: { marginTop: '28px' } }, 'install sheet / 安装面板'),
    // The sheet is a fixed-position modal, so it is rendered inside its own positioned
    // frame here; `embedded` would change its layout, and the point is to see the real one.
    h('div', { key: 'sheet', className: 'sheet-frame' }, [
      h(sheet, {
        key: 'i',
        open: true,
        capability: SNAPSHOT.capability,
        history: SNAPSHOT.installHistory,
        onClose: () => {},
        onChanged: () => {},
        onUse: () => {},
      }),
    ]),
    h('h2', { key: 'h3', style: { marginTop: '28px' } }, 'status rail / 状态条'),
    // `toasts` is a prop of the presentational rail; the store-backed variant reads
    // `useToasts()`, and the preview has no store to populate.
    h('div', { key: 'rail' }, [h(liveRail, { key: 'r', toasts: TOASTS, onDismiss: () => {} })]),
  ]))

  const body = h('div', { className: 'stage' }, sections)
  const html = [
    '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">',
    '<title>echocat-skill-panel preview</title>',
    `<style>${HOST_TOKENS}</style>`,
    '<style data-plugin-css="echocat-skill-panel-3.0/panel.css">',
    exports.__theme.CSS,
    '</style>',
    '</head><body>',
    serialize(body),
    '</body></html>',
  ].join('\n')
  return html
}

/* --------------------------------------------------------------------- run it -- */

const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
].find((candidate) => existsSync(candidate))
const state = { React: makeReact(), cache: {} }
const exports = loadClientModule(state, 'index.js')

// Module-level state the panel reads on first render.
const storeBackup = new Map()
globalThis.localStorage = {
  getItem: (key) => (storeBackup.has(key) ? storeBackup.get(key) : null),
  setItem: (key, value) => storeBackup.set(key, value),
  removeItem: (key) => storeBackup.delete(key),
}
// Every collapsible section open, so the screenshot shows the whole design rather than
// one collapsed row.
storeBackup.set('echocat-skill-panel-3.0/sections', JSON.stringify({ skills: true, perSkill: true, recent: true }))
globalThis.document = {
  addEventListener: () => {},
  removeEventListener: () => {},
  querySelector: () => null,
  createElement: () => ({ style: {}, setAttribute: () => {}, appendChild: () => {}, dataset: {} }),
  head: { appendChild: () => {} },
  body: { style: {} },
  execCommand: () => true,
}

const html = buildPage(state, exports)
const scratch = mkdtempSync(join(tmpdir(), 'echocat-preview-'))
const page = join(scratch, 'preview.html')

/**
 * `--measure` appends a probe that reports what the browser actually computed.
 *
 * A screenshot says "something looks small"; this says "the stat value is 26px and the
 * label 10.5px", which is the difference between adjusting a value and guessing at one.
 * It reuses the same page, so what is measured is exactly what is photographed.
 */
const MEASURE = `
<script>
window.addEventListener('load', () => {
  const probes = ${JSON.stringify([
    '.sr-root', '.sr-head', '.sr-title', '.sr-hero', '.sr-hero-meta', '.sr-hero-line',
    '.sr-stats', '.sr-stat', '.sr-stat-v', '.sr-stat-l',
    '.sr-sec-h', '.sr-sec-b', '.sr-pill',
    '.sr-skill', '.sr-avatar', '.sr-skill-name', '.sr-skill-slug', '.sr-blurb', '.sr-src',
    '.sr-btn', '.sr-btn--primary', '.sr-btn--sm', '.sr-tag', '.sr-tag--used',
    '.sr-share-track', '.sr-share-fill', '.sr-share-n',
    '.sr-turn-h', '.sr-age', '.sr-kbd',
    '.sr-sheet', '.sr-sheet-title', '.sr-tab', '.sr-input', '.sr-label', '.sr-sheet-foot',
    '.sr-toast', '.sr-toast-msg', '.sr-strip-shell', '.sr-footer, .sr-foot',
  ])}
  const read = (sel) => {
    const el = document.querySelector(sel)
    if (el === null) return null
    const cs = getComputedStyle(el)
    const r = el.getBoundingClientRect()
    return {
      font: cs.fontSize + '/' + cs.lineHeight + ' ' + cs.fontWeight,
      color: cs.color,
      bg: cs.backgroundColor,
      border: cs.borderTopWidth + ' ' + cs.borderTopColor,
      radius: cs.borderRadius,
      shadow: cs.boxShadow.slice(0, 60),
      pad: cs.padding,
      box: Math.round(r.width) + 'x' + Math.round(r.height),
    }
  }
  const out = {}
  for (const sel of probes) out[sel] = read(sel)
  const pre = document.createElement('pre')
  pre.id = 'measure'
  pre.textContent = 'MEASURE:' + JSON.stringify(out, null, 1)
  document.body.appendChild(pre)
})
</script>`

const measureMode = process.argv.includes('--measure')
if (measureMode) {
  const probePage = join(scratch, 'measure.html')
  writeFileSync(probePage, html.replace('</body>', `${MEASURE}\n</body>`), 'utf8')
  if (CHROME === undefined) {
    console.log('no Chrome found — cannot measure')
    process.exit(1)
  }
  const dom = execFileSync(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${join(scratch, 'profile-measure')}`, '--window-size=1400,2400',
    '--virtual-time-budget=3000', '--dump-dom', pathToFileURL(probePage).href,
  ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })
  const payload = /<pre id="measure">([\s\S]*?)<\/pre>/u.exec(dom)
  if (payload === null) {
    console.log('measure produced no output')
    process.exit(1)
  }
  const data = JSON.parse(payload[1].replace(/^MEASURE:/u, ''))
  for (const [selector, value] of Object.entries(data)) {
    if (value === null) {
      console.log(`  ${selector.padEnd(24)} — not rendered`)
      continue
    }
    console.log(`  ${selector.padEnd(24)} box ${String(value.box).padEnd(11)} font ${value.font.padEnd(20)} pad ${value.pad}`)
    console.log(`  ${''.padEnd(24)} bg ${value.bg.padEnd(30)} radius ${value.radius}`)
  }
  rmSync(scratch, { recursive: true, force: true })
  process.exit(0)
}

writeFileSync(page, html, 'utf8')
const outDir = join(pkgRoot, 'tools')
writeFileSync(join(outDir, 'preview.html'), html, 'utf8')

if (CHROME === undefined) {
  console.log(`no Chrome found — wrote ${join(outDir, 'preview.html')} instead of a screenshot`)
  process.exit(0)
}

// Two separate pages rather than one page with a flag: `--force-dark-mode` makes Chromium
// INVERT the whole document, which is not the design pass's dark palette at all (the first
// dark screenshot was Chromium's auto-dark, with our indigo rendered as coral). The
// explicit `.dark` wrapper is the same signal design.js listens for.
const shots = [
  ['light', ''],
  ['dark', 'dark'],
]
for (const [name, themeClass] of shots) {
  const out = join(outDir, `preview-${name}.png`)
  const themed = themeClass === '' ? html : html.replace('<body>', `<body class="${themeClass}">`)
  const themedPage = join(scratch, `preview-${name}.html`)
  writeFileSync(themedPage, themed, 'utf8')
  const args = [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--hide-scrollbars', '--force-color-profile=srgb',
    `--user-data-dir=${join(scratch, `profile-${name}`)}`,
    '--window-size=2100,2400', '--virtual-time-budget=3000',
    `--screenshot=${out}`, pathToFileURL(themedPage).href,
  ]
  try {
    execFileSync(CHROME, args, { stdio: ['ignore', 'ignore', 'ignore'], windowsHide: true })
    console.log(`wrote ${out}`)
  } catch (error) {
    console.log(`screenshot failed (${name}): ${error?.message ?? error}`)
  }
}
mkdirSync(outDir, { recursive: true })
rmSync(scratch, { recursive: true, force: true })
