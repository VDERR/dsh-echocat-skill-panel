// Bundle test for the browser half.
//
// Executes the real `lib/client.js` exactly the way DSH's client module system
// does — capture the `window.__ModuleLoader__.load({ id, factory })` envelope,
// then materialize the factory with a `require` that resolves externals from the
// shell's module table (here: the app's own node_modules). No DOM, no bundler,
// no browser, and no server.
//
// React itself is real; only its hooks are stubbed, because there is no
// react-dom in the app package to render with. Two harnesses share those stubs:
//
//   * the "crude" hooks — `useState` returns its initial value and `useEffect`
//     collects for manual invocation. Used for structural assertions and for
//     driving the whole data path: mount surface -> refresh() -> stubbed fetch.
//   * `withMount()` — a ~120-line hook runtime (cells + synchronous re-render)
//     that makes `setState` real, so the install/delete interactions can be
//     exercised end to end instead of only inspected.

import { readFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const pkgRoot = join(here, '..')
const APP = process.env.DSH_APP_ROOT ?? 'C:\\Users\\Administrator\\AppData\\Local\\Programs\\DSH Desktop Beta\\resources\\app'

const PKG = 'echocat-skill-panel'

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

const tick = () => new Promise((resolve) => setTimeout(resolve, 5))

console.log('\n[1] the artifact')
const bundlePath = join(pkgRoot, 'lib', 'client.js')
ok('lib/client.js exists (built)', existsSync(bundlePath), bundlePath)
const source = readFileSync(bundlePath, 'utf8')
const nonAscii = [...source].filter((c) => c.codePointAt(0) > 0x7e)
ok('bundle is pure ASCII (charset-proof over HTTP)', nonAscii.length === 0, `${nonAscii.length} non-ASCII`)
ok('bundle registers through the loader envelope', source.includes('window.__ModuleLoader__.load('))
ok(`bundle names the package id (${PKG})`, source.includes(`id: "${PKG}"`))
ok('no import.meta usage in the bundle', !source.includes('import.meta'))

// The brand mark travels INSIDE the artifact as base64, which makes it the one asset that can break
// silently: a truncated string, a non-ASCII byte, or a wrong theme key all still produce a bundle
// that parses and a logo that simply does not appear. So this decodes the payloads and checks the
// actual bytes, rather than checking that a string is present.
console.log('\n[1b] the embedded brand mark')
{
  const uris = [...source.matchAll(/'(data:image\/png;base64,[A-Za-z0-9+/=]+)'/gu)].map((m) => m[1])
  ok('both marks are embedded as data URIs', uris.length === 2, `${uris.length} found`)
  ok('...and they are different images', new Set(uris).size === 2, 'open-eye and closed-eye must differ')
  const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  for (const uri of uris) {
    const bytes = Buffer.from(uri.slice('data:image/png;base64,'.length), 'base64')
    ok(`a ${bytes.length}-byte PNG decodes from the artifact`, bytes.subarray(0, 8).equals(PNG_SIGNATURE), bytes.subarray(0, 8).toString('hex'))
    // IHDR width/height are big-endian at offsets 16..24, right after the 8-byte signature and the
    // 8-byte chunk header.
    const width = bytes.readUInt32BE(16)
    const height = bytes.readUInt32BE(20)
    ok(`...which is square and non-trivial (${width}x${height})`, width === height && width >= 32, `${width}x${height}`)
  }
  ok('the theme keys are both present', source.includes('light:') && source.includes('dark:'), 'a missing theme key leaves one theme with no mark')
}

console.log('\n[2] the envelope')
let captured
/**
 * Every `window.open` the plugin asks for, in order.
 *
 * Declared before the envelope runs because the envelope's argument IS the plugin's
 * `window` (see `[2]`): the external-link button records here.
 */
const openedExternal = []
new Function('window', source)({
  __ModuleLoader__: {
    load(entry) {
      captured = entry
    },
  },
  // The bundle's `window` IS this object — the envelope is evaluated with it as a
  // parameter, so `typeof window` inside the factory sees this and not the test's
  // `globalThis`. The external-link button therefore needs its seam HERE, and
  // `openedExternal` is what the assertions read.
  open: (url, target, features) => {
    openedExternal.push({ url, target, features })
    return {}
  },
})
ok('load() was called exactly once', captured !== undefined)
ok('id matches the package name', captured?.id === PKG, String(captured?.id))
ok('factory is a function', typeof captured?.factory === 'function')

console.log('\n[3] materialize the factory against the shell module table')
const manifest = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8'))
const appRequire = createRequire(join(APP, 'package.json'))
const realReact = appRequire('react')
const effects = []
const mockReact = Object.create(realReact)
const crudeUseState = (initial) => [typeof initial === 'function' ? initial() : initial, () => {}]
mockReact.useState = crudeUseState
mockReact.useEffect = (fn) => {
  effects.push(fn)
}
mockReact.useSyncExternalStore = (_subscribe, getSnapshot) => getSnapshot()
// Identity is enough for the crude harness: it renders once per assertion and
// reads the handler off the returned element, so dependency tracking never matters.
mockReact.useCallback = (fn) => fn
// `useRef`/`useMemo` MUST be stubbed too — the real ones throw "Invalid hook
// call" outside a renderer, and components legitimately use them.
mockReact.useRef = (initial) => ({ current: typeof initial === 'function' ? initial() : initial })
mockReact.useMemo = (fn) => fn()

// Timer instrumentation: the store is shared by three independently mounted
// surfaces, so the test counts how many intervals actually get created.
let intervalsCreated = 0
let intervalsCleared = 0
const realSetInterval = globalThis.setInterval
const realClearInterval = globalThis.clearInterval
globalThis.setInterval = (fn, ms) => {
  intervalsCreated += 1
  return realSetInterval(fn, ms)
}
globalThis.clearInterval = (handle) => {
  intervalsCleared += 1
  return realClearInterval(handle)
}

const requested = []
/**
 * `react-dom` is part of the shell's platform table — shipped plugins import
 * `createPortal` from it — so the stub has to answer it. `createPortal` returns its node:
 * the harness has no reconciler, and the only thing the plugin asks of a portal is that
 * the sheet still renders.
 */
const mockReactDom = { createPortal: (node) => node }
const shellRequire = (specifier) => {
  requested.push(specifier)
  if (specifier === 'react') return mockReact
  if (specifier === 'react-dom') return mockReactDom
  return appRequire(specifier)
}
let exports
let threw = null
try {
  exports = captured.factory(shellRequire)
} catch (error) {
  threw = error
}
ok('factory materializes without throwing', threw === null, String(threw))
ok('react was resolved from the shell table', requested.includes('react'), requested.join(', '))
ok('nothing but the platform table was requested', requested.every((r) => r === 'react' || r === 'react-dom'), requested.join(', '))
ok('exports.apply is a function', typeof exports?.apply === 'function')
ok('exports.inject is an array with slots', Array.isArray(exports?.inject) && exports.inject.includes('slots'), JSON.stringify(exports?.inject))
ok('a second materialization is independent', captured.factory(shellRequire) !== exports)

console.log('\n[4] apply() contributes three surfaces')
const injected = []
const registered = []
const fakeCtx = {
  slots: {
    inject(name, cb) {
      injected.push(name)
      cb()
      return () => {}
    },
    register(options, component) {
      registered.push({ options, component })
      return () => {}
    },
  },
}
let applyThrew = null
try {
  exports.apply(fakeCtx)
} catch (error) {
  applyThrew = error
}
ok('apply() does not throw', applyThrew === null, String(applyThrew))
ok('it waits for exactly three slots', injected.length === 3, JSON.stringify(injected))
ok('the slots are main / sidebar.panellist / conversation.input.dock',
  JSON.stringify([...injected].sort()) === JSON.stringify(['conversation.input.dock', 'main', 'sidebar.panellist']), JSON.stringify(injected))
ok('each entry targets the slot it was injected for', registered.every((r) => injected.includes(r.options.name)))
ok('every entry is a component', registered.every((r) => typeof r.component === 'function'))
ok('a missing slots service is survivable', (() => {
  try {
    exports.apply({})
    return true
  } catch {
    return false
  }
})())
ok('a register() that throws does not escape apply()', (() => {
  try {
    exports.apply({
      slots: {
        inject: (_n, cb) => cb(),
        register: () => {
          throw new Error('registry is full')
        },
      },
    })
    return true
  } catch {
    return false
  }
})())

const bySlot = Object.fromEntries(registered.map((r) => [r.options.name, r]))
ok('main is addressed by key', bySlot.main?.options?.key === exports.PANEL_ID, JSON.stringify(bySlot.main?.options))
ok('sidebar.panellist carries the same id', bySlot['sidebar.panellist']?.options?.id === exports.PANEL_ID)
ok('conversation.input.dock carries the same id', bySlot['conversation.input.dock']?.options?.id === exports.PANEL_ID)
ok('the sidebar entry has a label thunk', typeof bySlot['sidebar.panellist']?.options?.label === 'function')
ok('the sidebar label is human readable', bySlot['sidebar.panellist'].options.label() === '\u6280\u80fd\u8c03\u7528\u62a5\u544a')

/**
 * Invoke a function component as React would, while recording WHICH component is
 * running. The test harness has no fiber, so this is the only way a state stub
 * can tell "the section is open" apart from "the / -only chip is on" — both are
 * plain booleans, and forcing every boolean true used to filter the catalog.
 */
let currentComponent = ''
const invoke = (type, props) => {
  const previous = currentComponent
  currentComponent = type.name || 'anonymous'
  try {
    return type(props)
  } finally {
    currentComponent = previous
  }
}

/** Element-tree text extraction; function components are invoked as React would. */
const textOf = (node) => {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  const { type, props } = node
  if (typeof type === 'function') return textOf(invoke(type, { ...(props ?? {}) }))
  return textOf(props?.children)
}

/**
 * Text of a node from EITHER tree shape: a React element tree (what `textOf`
 * expects) or the interaction runtime's own node tree, whose leaves are
 * `{ type: '#text', text }`. Sections [18]-[22] mix the two.
 */
const deepText = (node) => {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(deepText).join('')
  if (node.type === '#text') return String(node.text ?? '')
  if (Array.isArray(node.children)) return node.children.map(deepText).join('')
  return textOf(node)
}

/** First `<button>` whose rendered text contains `label`. */const findClickable = (node, label) => {
  if (node === null || node === undefined || typeof node !== 'object') return undefined
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findClickable(child, label)
      if (found !== undefined) return found
    }
    return undefined
  }
  if (typeof node.type === 'function') return findClickable(invoke(node.type, { ...(node.props ?? {}) }), label)
  if (node.type === 'button' && textOf(node).includes(label)) return node
  return findClickable(node.props?.children, label)
}

/** Read a host element's `props`, expanding through function components. */
const findHost = (node, predicate) => {
  if (node === null || node === undefined || typeof node !== 'object') return undefined
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findHost(child, predicate)
      if (found !== undefined) return found
    }
    return undefined
  }
  if (typeof node.type === 'function') return findHost(invoke(node.type, { ...(node.props ?? {}) }), predicate)
  if (predicate(node)) return node
  return findHost(node.props?.children, predicate)
}

/** Every host element matching `predicate`, expanding through function components. */
const findAllHost = (node, predicate, out = []) => {
  if (node === null || node === undefined || typeof node !== 'object') return out
  if (Array.isArray(node)) {
    for (const child of node) findAllHost(child, predicate, out)
    return out
  }
  if (typeof node.type === 'function') {
    findAllHost(invoke(node.type, { ...(node.props ?? {}) }), predicate, out)
    return out
  }
  if (predicate(node)) out.push(node)
  findAllHost(node.props?.children, predicate, out)
  return out
}

/** A `<button>` whose *whole* text is `label` — avoids matching "已安装 skill". */
const exactButton = (node, label) => findAllHost(node, (n) => n.type === 'button' && textOf(n).trim() === label)[0]

/**
 * Force *section* open state on, so the catalog renders, without touching the
 * unrelated boolean state (filter chips, arming, busy flags, the sheet).
 */
const withExpanded = (render) => {
  const saved = mockReact.useState
  mockReact.useState = (initial) => {
    const value = typeof initial === 'function' ? initial() : initial
    const section = currentComponent === 'Section' || currentComponent === 'SkillReportStrip'
    return [typeof value === 'boolean' && section ? true : value, () => {}]
  }
  try {
    return render()
  } finally {
    mockReact.useState = saved
  }
}

console.log('\n[4b] polling is reference counted across surfaces')
let HOST_SKILLS = [
  { name: 'gpt-image', description: '\u51fa\u56fe/\u6539\u56fe', modelInvocable: true },
  { name: 'h3-prompt-writing', description: 'H3 English blurb', descriptionZh: 'H3 \u4e2d\u6587\u7b80\u4ecb', tag: '\u89c6\u9891', modelInvocable: true },
  { name: 'manual-only-skill', description: '\u4ec5\u624b\u52a8', modelInvocable: false },
]
const CAP_FULL = {
  api: 1,
  root: 'C:\\Users\\Administrator\\.dsh-beta\\skills',
  backupRoot: 'C:\\Users\\Administrator\\.dsh-beta\\skill-backups',
  writable: true,
  modes: ['text', 'file', 'url', 'git'],
  allowPrivateHosts: false,
  git: true,
  limits: { uploadBytes: 5 * 1024 * 1024, fileBytes: 1024 * 1024, totalBytes: 20 * 1024 * 1024, files: 64, markdownBytes: 256 * 1024 },
}
const CAP_REASON = 'profile config sets skillReport.install: false'
const CAP_OFF = { api: 0, install: false, reason: CAP_REASON }
const HOST_SNAPSHOT = {
  turns: 4,
  turnsWithSkills: 3,
  turnsWithoutSkills: 1,
  invocations: 5,
  lastAt: 1_700_000_000_000,
  perSkill: [
    { name: 'gpt-image', count: 3 },
    { name: 'h3-prompt-writing', count: 2 },
  ],
  skills: HOST_SKILLS,
  capability: CAP_FULL,
  installHistory: [{ at: 1_700_000_000_000, action: 'install', mode: 'text', name: 'gpt-image', ok: true, ms: 42 }],
  recent: [
    {
      at: 1_700_000_000_000,
      sessionId: 's1',
      sessionTitle: '\u6c34\u5f69\u6d4b\u8bd5',
      reason: 'completed',
      calls: [
        { name: 'gpt-image', how: 'model' },
        { name: 'h3-prompt-writing', how: 'user' },
      ],
    },
    { at: 1_699_999_000_000, sessionId: 's1', sessionTitle: '\u6c34\u5f69\u6d4b\u8bd5', reason: 'completed', calls: [] },
  ],
}

// A request log plus a *mutable* on-disk catalog, so the write endpoints behave
// like the real host (which re-reads the skills root on every reply).
const calls = []
const json = (payload, status = 200) => ({ ok: status < 400, status, json: async () => payload })
let nameTakenOnce = false
let invalidNameOnce = false
let needsConfirmOnce = false
/** Make the next `color` write FAIL, to drive the refusal path the palette used to swallow silently. */
let failColorOnce = false
/** Skill name the stubbed `check` should report as behind, or `''` for none. */
let behindOnce = ''

globalThis.fetch = async (url, init) => {
  const target = String(url)
  // The plugin's own release endpoint. A GET with no body — recorded so a test can prove
  // the version check does not touch the skills catalogue and writes nothing.
  if (target.includes('/skill-report/release')) {
    calls.push({ target, body: init?.body, headers: init?.headers })
    return json({
      current: '4.0.0',
      name: 'echocat-skill-panel',
      repo: 'https://github.com/VDERR/echocat-skill-panel',
      releases: 'https://github.com/VDERR/echocat-skill-panel/releases',
      checkable: true,
      checked: true,
      latest: '4.0.0',
      hasUpdate: false,
      npm: '4.0.0',
      tag: 'v4.0.0',
      reason: '',
    })
  }
  if (target.includes('/skills') && init?.method === 'POST') {
    const body = JSON.parse(init.body)
    calls.push({ target, body, headers: init.headers })
    if (body.action === 'rescan') return json({ ok: true, skills: HOST_SKILLS, capability: CAP_FULL })
    if (body.action === 'check') {
      // The host answers one verdict per skill; every one here reports "no newer
      // revision" unless the test asked for an update, so both branches are covered.
      const names = body.name === undefined ? HOST_SKILLS.map((skill) => skill.name) : [body.name]
      const checks = names.map((name) => ({
        name,
        supported: true,
        hasUpdate: behindOnce === name,
        pinned: false,
        localChanged: false,
        remoteCommit: 'f'.repeat(40),
        error: '',
        note: '',
        checkedAt: 0,
      }))
      return json({ ok: true, ...(body.name === undefined ? { checks } : { check: checks[0] }), skills: HOST_SKILLS, capability: CAP_FULL })
    }
    if (body.action === 'rename') {
      return json({ ok: true, skill: { name: body.name, displayNameZh: body.displayNameZh }, skills: HOST_SKILLS, capability: CAP_FULL })
    }
    if (body.action === 'disable' || body.action === 'enable') {
      return json({ ok: true, skill: { name: body.name, disabled: body.action === 'disable' }, skills: HOST_SKILLS, capability: CAP_FULL })
    }
    if (body.action === 'color') {
      // `failColorOnce` lets a test drive the REFUSAL path, which is the one that was silently broken: the
      // palette treated a refusal as a success. The reply shape is exactly what the host sends for an action
      // it does not recognise, which is what an out-of-date host returns.
      if (failColorOnce) {
        return json({ ok: false, error: { code: 'BAD_REQUEST', message: '不认识的 action：color' } }, 400)
      }
      return json({ ok: true, skill: { name: body.name, color: body.color }, skills: HOST_SKILLS, capability: CAP_FULL })
    }
    if (body.action === 'claim') {
      return json({ ok: true, skill: { name: body.name }, provenance: { known: true, source: 'git', url: body.input, repo: body.input, claimed: true, changedSinceInstall: false }, skills: HOST_SKILLS, capability: CAP_FULL })
    }
    if (body.action === 'update') {
      return json({
        ok: true,
        skill: { name: body.name, description: '', displayNameZh: '' },
        files: 2,
        overwritten: true,
        backup: `C:\\Users\\Administrator\\.dsh-beta\\skill-backups\\${body.name}`,
        warnings: [],
        provenance: { known: true, source: 'git', url: 'https://github.com/owner/repo.git', repo: 'https://github.com/owner/repo.git', commit: 'f'.repeat(40), claimed: false, changedSinceInstall: false },
        skills: HOST_SKILLS,
        capability: CAP_FULL,
      })
    }
    if (body.action === 'preview') {
      return json({
        ok: true,
        preview: { name: body.name ?? 'fresh-skill', description: '\u65b0\u88c5\u7684 skill', files: 2, hadFrontmatter: true, exists: body.name === 'gpt-image' },
        warnings: [],
      })
    }
    if (body.action === 'uninstall') {
      if (needsConfirmOnce && body.confirm !== true) {
        needsConfirmOnce = false
        return json({ ok: false, error: { code: 'NEEDS_CONFIRM', message: '\u5220\u9664\u9700\u8981\u4e8c\u6b21\u786e\u8ba4', hint: 'confirm:true' }, skills: HOST_SKILLS, capability: CAP_FULL }, 409)
      }
      HOST_SKILLS = HOST_SKILLS.filter((skill) => skill.name !== body.name)
      return json({
        ok: true,
        skill: { name: body.name, description: '' },
        files: 0,
        overwritten: false,
        backup: `C:\\Users\\Administrator\\.dsh-beta\\skill-backups\\${body.name}`,
        warnings: [],
        skills: HOST_SKILLS,
        capability: CAP_FULL,
      })
    }
    if (body.action === 'install') {
      if (invalidNameOnce) {
        invalidNameOnce = false
        return json({ ok: false, error: { code: 'INVALID_NAME', message: '\u540d\u79f0\u4e0d\u5408\u6cd5', hint: '\u5efa\u8bae\u4f7f\u7528 my-skill' }, skills: HOST_SKILLS, capability: CAP_FULL }, 400)
      }
      if (nameTakenOnce) {
        nameTakenOnce = false
        return json({ ok: false, error: { code: 'NAME_TAKEN', message: '\u540c\u540d skill \u5df2\u5b58\u5728', hint: 'overwrite:true' }, skills: HOST_SKILLS, capability: CAP_FULL }, 409)
      }
      const name = body.name ?? 'fresh-skill'
      HOST_SKILLS = [...HOST_SKILLS, { name, description: '\u65b0\u88c5\u7684 skill', descriptionZh: '\u65b0\u88c5\u7684 skill', modelInvocable: true }]
      return json({ ok: true, skill: { name, description: '\u65b0\u88c5\u7684 skill' }, files: 2, overwritten: false, backup: null, warnings: [], skills: HOST_SKILLS, capability: CAP_FULL })
    }
    return json({ ok: false, error: { code: 'BAD_MODE', message: 'unknown action' }, skills: HOST_SKILLS, capability: CAP_FULL }, 400)
  }
  calls.push({ target, body: null, headers: init?.headers })
  return json({ ...HOST_SNAPSHOT, skills: HOST_SKILLS, capability: CAP_FULL })
}

{
  // Deliberately before anything else renders, so the store starts idle. Two
  // surfaces mount at different times; `main` is torn down whenever the user
  // switches back to the conversation, while the composer strip is not (until the
  // conversation view itself goes away). Unmounting one must NOT silence the other.
  effects.length = 0
  const loadingText = textOf(bySlot.main.component({}))
  ok('the panel renders before data arrives', loadingText.includes('\u6b63\u5728\u8bfb\u53d6'), loadingText)
  bySlot['conversation.input.dock'].component({})
  const mounted = []
  for (const effect of effects.splice(0)) {
    const cleanup = effect()
    if (typeof cleanup === 'function') mounted.push(cleanup)
  }
  ok('two surfaces registered two pollers', mounted.length === 2, String(mounted.length))
  ok('only one interval is created for both', intervalsCreated === 1, String(intervalsCreated))

  mounted[0]()
  ok('unmounting the first surface keeps polling alive', intervalsCleared === 0, String(intervalsCleared))

  mounted[1]()
  ok('unmounting the last surface stops the timer', intervalsCleared === 1, String(intervalsCleared))

  exports.__source.stopPolling()
  ok('an extra stopPolling() cannot underflow', intervalsCleared === 1, String(intervalsCleared))

  // Rendered on its own so it cannot disturb the effect counting above.
  const loadingPanel = exports.__ui.SkillReportPanel({ state: { phase: 'loading', data: null, error: null, fetchedAt: 0 } })
  ok('the first load shows skeleton placeholders (item 17)', findAllHost(loadingPanel, (n) => String(n.props?.className ?? '').includes('sr-skel')).length > 0)
  ok('...with a screen-reader label from the old copy', textOf(loadingPanel).includes('\u6b63\u5728\u8bfb\u53d6'))
}

// Let the mount-time fetch settle before the data-path assertions read the store.
await new Promise((resolve) => setTimeout(resolve, 20))

console.log('\n[5] rendering helpers')
const Icon = bySlot['sidebar.panellist'].component
const icon = Icon({ size: 16, active: false })
ok('the glyph renders an svg', icon?.type === 'svg' && icon.props.width === 16)

console.log('\n[6] the data path: mount -> refresh -> host JSON')
const PanelSurface = bySlot.main.component
const StripSurface = bySlot['conversation.input.dock'].component

const cleanups = []
for (const effect of effects.splice(0)) {
  const cleanup = effect()
  if (typeof cleanup === 'function') cleanups.push(cleanup)
}
await new Promise((resolve) => setTimeout(resolve, 20))

ok('the panel fetched the host route', calls.some((c) => c.target.includes('/skill-report/state')), calls.map((c) => c.target).join(', '))

const readyText = textOf(PanelSurface({}))
ok('host counters reach the panel', readyText.includes('\u56de\u5408') && readyText.includes('4'))
ok('per-skill counts reach the panel', readyText.includes('3 \u6b21') && readyText.includes('2 \u6b21'), readyText)
ok('the latest turn is headlined', readyText.includes('\u672c\u8f6e'))
ok('a model load is labelled', readyText.includes('\u6a21\u578b\u81ea\u52a8'))
ok('a /name load is labelled', readyText.includes('\u4f60\u624b\u52a8 /'))
ok('the session title reaches the panel', readyText.includes('\u6c34\u5f69\u6d4b\u8bd5'))
ok('the refresh button is wired', findClickable(PanelSurface({ onRefresh: () => {} }), '\u5237\u65b0') !== undefined || readyText.includes('\u5237\u65b0'))
ok('the hero sparkline renders (item 19)', findHost(PanelSurface({}), (n) => n.type === 'svg' && String(n.props?.className ?? '').includes('sr-spark')) !== undefined)
ok('the footer reports the version (item 38)', readyText.includes(`v${exports.__ui.VERSION}`))
ok('the footer reports the skills root', readyText.includes('.dsh-beta'))

const stripText = textOf(StripSurface({}))
// The bar used to lead with the word 技能. The user replaced that with the INSTALL COUNT, which is
// the one fact the bar was not stating anywhere — so this asserts the count is present rather than
// asserting the old static label.
ok('the composer strip summarizes the latest turn', stripText.includes('gpt-image'), stripText)
ok('...and states how many skills are installed, where the word 技能 used to be',
  /\d+ 个/u.test(stripText), stripText.slice(0, 90))

console.log('\n[7] failure is survivable')
const goodFetch = globalThis.fetch
globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) })
await exports.__source.refresh()
const failedText = textOf(PanelSurface({}))
ok('a failed fetch is reported, not thrown', failedText.includes('\u4e0d\u53ef\u8fbe'), failedText)
ok('the strip also reports the failure', textOf(StripSurface({})).includes('\u4e0d\u53ef\u8fbe'))
ok('the previously fetched data is retained', failedText.includes('gpt-image'))
globalThis.fetch = goodFetch
await exports.__source.refresh()

console.log('\n[8] manifest declares the client half')
ok('dsh.client.platform is web', manifest.dsh?.client?.platform === 'web', JSON.stringify(manifest.dsh?.client))
ok('exports["./client"] points at the built bundle', manifest.exports?.['./client'] === './lib/client.js', String(manifest.exports?.['./client']))
ok('the bundle is shipped in files[]', (manifest.files ?? []).includes('lib'))

console.log('\n[9] installed skills and one-click reference')
{
  const collapsed = textOf(PanelSurface({}))
  ok('the section header carries the count', collapsed.includes('\u5df2\u5b89\u88c5 skill3'), collapsed.slice(0, 200))
  ok('the skill cards stay hidden while collapsed', !collapsed.includes('manual-only-skill'))

  const panelText = withExpanded(() => textOf(PanelSurface({})))
  ok('expanding reveals the installed skills from the host payload',
    panelText.includes('\u5df2\u5b89\u88c5 skill') && panelText.includes('manual-only-skill'), panelText.slice(0, 200))
  ok('a skill without a Chinese blurb falls back to its English description', panelText.includes('\u51fa\u56fe/\u6539\u56fe'))
  ok('a Chinese blurb wins over the English one',
    panelText.includes('H3 \u4e2d\u6587\u7b80\u4ecb') && !panelText.includes('H3 English blurb'))
  // Tags no longer appear anywhere on screen: the tag row was removed from the card, and the
  // category chips were replaced by the colour filter. The tag survives on the RECORD and drives the
  // search index, which is what this asserts — asserting the rendered chip would now be asserting
  // something the user asked to have removed.
  ok('a skill tag still drives the search index',
    exports.__ui.filterSkills(HOST_SNAPSHOT.skills, { query: '\u89c6\u9891' }).length > 0,
    'the query box searches tag text')
  ok('a manual-only skill is marked', panelText.includes('manual-only-skill') && panelText.includes('\u4ec5 /'))
  ok('a deterministic avatar renders (item 33)', panelText.includes('G') && panelText.includes('M'))
  ok('the usage count reaches the card', panelText.includes('\u7528\u8fc7 3 \u6b21'))
  // The placeholder lives on props, not children, so search host elements.
  const hasFilter = () => findAllHost(PanelSurface({}), (n) => n.type === 'input' && n.props?.type === 'search').length === 1
  ok('the filter box renders', withExpanded(hasFilter))
  // `main` is root-scoped, so it never receives `inputActions`. (The hint text
  // mentions the word 引用, so look for the BUTTON, not the string.)
  ok('a root-scoped surface offers no reference button', withExpanded(() => findClickable(PanelSurface({}), '\u5f15\u7528')) === undefined)
  ok('...and says where to click instead', panelText.includes('\u8f93\u5165\u6846\u4e0a\u65b9\u7684\u6a2a\u680f'))

  let written
  const inputActions = { setDraft: (text) => { written = text } }
  const useInput = (selector) => (typeof selector === 'function' ? selector({ draft: 'hello ' }) : { draft: 'hello ' })

  const expandedText = withExpanded(() => textOf(StripSurface({ inputActions, useInput })))
  ok('the expanded composer strip offers 引用', expandedText.includes('\u5f15\u7528'), expandedText.slice(0, 200))

  const button = withExpanded(() => findClickable(StripSurface({ inputActions, useInput }), '\u5f15\u7528'))
  ok('the reference button is a real button', button !== undefined && typeof button.props.onClick === 'function')
  button?.props?.onClick?.()
  ok('clicking appends /name to the existing draft', written === 'hello /gpt-image ', JSON.stringify(written))

  // An empty draft must not gain a leading space.
  written = undefined
  const emptyInput = (selector) => (typeof selector === 'function' ? selector({ draft: '' }) : { draft: '' })
  withExpanded(() => findClickable(StripSurface({ inputActions, useInput: emptyInput }), '\u5f15\u7528'))?.props?.onClick?.()
  ok('an empty draft gets a bare /name', written === '/gpt-image ', JSON.stringify(written))

  // No composer (root scope, or a shell without inputActions) must not throw.
  let threwStrip = null
  try {
    withExpanded(() => findClickable(StripSurface({}), '\u5f15\u7528'))?.props?.onClick?.()
  } catch (error) {
    threwStrip = error
  }
  ok('a strip without inputActions is inert, not broken', threwStrip === null, String(threwStrip))

  // A readable-inputActions-without-readable-draft shell must NOT be guessed at:
  // `setDraft` replaces, so assuming "" would silently wipe the user's text.
  written = 'untouched'
  withExpanded(() => findClickable(StripSurface({ inputActions }), '\u5f15\u7528'))?.props?.onClick?.()
  ok('an unreadable draft is never overwritten', written === 'untouched', JSON.stringify(written))
}

/* ========================================================================== *
 * 3.0 additions: identity, pure helpers, capability model, install UI
 * ========================================================================== */

console.log('\n[10] package identity')
{
  ok('the loader id is echocat-skill-panel', captured.id === PKG)
  ok('no 2.0 package name survives in the bundle', !source.includes('EchoCat-skill-Panel-2.0'))
  ok('the CSS tag carries the 3.0 plugin id literally', source.includes("tag.dataset.plugin = 'echocat-skill-panel'"))
  ok('the CSS dedupe selector is keyed on TAG_ID', source.includes('style[data-plugin-css="${TAG_ID}"]'))
  ok('theme.PLUGIN_ID is the package name', exports.__theme.PLUGIN_ID === PKG, String(exports.__theme.PLUGIN_ID))
  ok('theme.TAG_ID is the package id plus /panel.css', exports.__theme.TAG_ID === `${PKG}/panel.css`, String(exports.__theme.TAG_ID))
  ok('the injected stylesheet is non-trivial', exports.__theme.CSS.length > 8000, String(exports.__theme.CSS.length))
  ok('the section key is namespaced to 3.0', source.includes('echocat-skill-panel/sections'))
  ok('the prefs key is namespaced to 3.0', source.includes('echocat-skill-panel/prefs'))
  ok('the console prefix uses the new id', source.includes('[echocat-skill-panel]'))
  ok('the panel version matches package.json', exports.__ui.VERSION === manifest.version, `${exports.__ui.VERSION} vs ${manifest.version}`)
  ok('the write endpoint is under the authenticated /api prefix', exports.__api.SKILLS_PATH === '/api/skill-report/skills', exports.__api.SKILLS_PATH)
  ok('the read endpoint was not renamed', exports.__source.DEFAULT_PATH === '/api/skill-report/state', exports.__source.DEFAULT_PATH)
  ok('the bundle grew a real stylesheet, not inline styles', source.includes('.sr-sheet') && source.includes('prefers-reduced-motion'))
  ok('no emoji or text glyph stands in for an icon', !source.includes('\\u25b8') && !source.includes('\\u25be') && !source.includes('\\u2728'))
  {
    // A stylesheet is the one artifact nothing else validates: a stray brace
    // silently disables every rule after it.
    const css = exports.__theme.CSS
    const openBraces = (css.match(/\{/gu) ?? []).length
    const closeBraces = (css.match(/\}/gu) ?? []).length
    ok('the stylesheet has balanced braces', openBraces === closeBraces && openBraces > 100, `${openBraces}/${closeBraces}`)
    ok('the stylesheet honours reduced motion (item 12)', css.includes('prefers-reduced-motion'))
    ok('the stylesheet has a reduced-transparency fallback (item 42)', css.includes('prefers-reduced-transparency'))
    ok('the stylesheet has a no-backdrop-filter fallback', css.includes('@supports not'))
    ok('the stylesheet is responsive (item 40)', css.includes('max-width:560px'))
    ok('the stylesheet themes selection and caret (item 41)', css.includes('::selection') && css.includes('caret-color'))
    /**
     * ONE RADIUS, AND THE TOKENS ARE WHERE IT HAS TO HOLD.
     *
     * This asserted `--sr-r:12px` — the value from a three-step scale (12 / 9 / 999) that the design pass later
     * replaced with 8 for the elements it happened to name. The ones it did not name kept reading these tokens, which
     * is why a single component showed four different corner roundings: the collapsed bar at 999, its expanded shell at
     * 12, its floating row at 8, and the count chip inside it at 6.
     *
     * Asserting the TOKENS rather than a list of elements is the point: an element is only at the right radius if
     * somebody remembered to name it, and that is not a property a design system can have.
     */
    ok('the stylesheet defines the 4px rhythm', css.includes('--sr-sp:4px'))
    ok('...and ONE radius scale, at the base of the cascade',
      css.includes('--sr-r:8px') && css.includes('--sr-r-sm:8px'),
      /--sr-r:[^;]+/u.exec(css)?.[0] + ' ' + /--sr-r-sm:[^;]+/u.exec(css)?.[0])
    // The old values must be GONE, not merely overridden for some selectors: leaving them lets an unnamed element fall
    // back to a different corner than everything around it.
    ok('...with the old three-step values removed',
      !css.includes('--sr-r:12px') && !css.includes('--sr-r-sm:9px') && !css.includes('--sr-r-pill:999px'),
      'a surviving 12/9/999 token is a corner that disagrees with its neighbours')
    ok('the stylesheet styles the sheet, the rail and the drop target', ['.sr-sheet{', '.sr-toast{', '.sr-drop{', '.sr-seg-ind{', '.sr-share-fill{', '.sr-avatar{', '.sr-skel{'].every((token) => css.includes(token)))
  }
}

console.log('\n[11] pure derivations (panel)')
{
  const ui = exports.__ui
  const spark = ui.sparkline([0, 1, 3, 2])
  ok('sparkline returns a path', spark.line.startsWith('M') && spark.line.includes('L'), spark.line)
  ok('sparkline closes an area fill', spark.area.endsWith('Z') && spark.area.includes('L104 34'))
  ok('sparkline reports its max', spark.max === 3)
  ok('sparkline handles an empty series', ui.sparkline([]).count === 0 && ui.sparkline([]).line === '')
  ok('sparkline centres a single sample', ui.sparkline([5])[0] === undefined && ui.sparkline([5]).points[0][0] === 52, JSON.stringify(ui.sparkline([5]).points))
  ok('a higher count is drawn higher', ui.sparkline([0, 4]).points[1][1] < ui.sparkline([0, 4]).points[0][1])
  ok('sparkline ignores non-numeric samples', ui.sparkline([1, 'x', null, 2]).count === 2)

  const hist = ui.histogram(HOST_SNAPSHOT.recent)
  ok('histogram is oldest-first', JSON.stringify(hist) === JSON.stringify([0, 2]), JSON.stringify(hist))
  ok('histogram caps its length', ui.histogram(new Array(40).fill({ calls: [1] }), 12).length === 12)

  const catalog = [
    { name: 'beta', modifiedAt: 200 },
    { name: 'alpha', modifiedAt: 100 },
    { name: 'gamma', modifiedAt: undefined },
  ]
  ok('sort by name', ui.sortSkills(catalog, 'name').map((s) => s.name).join() === 'alpha,beta,gamma')
  ok('sort by name descending', ui.sortSkills(catalog, 'name', 'desc').map((s) => s.name).join() === 'gamma,beta,alpha')
  ok('sort by recency puts unknown timestamps last', ui.sortSkills(catalog, 'recent')[0].name === 'beta')
  ok('sort by count uses the per-skill map', ui.sortSkills(catalog, 'count', 'desc', { gamma: 9, alpha: 4 })[0].name === 'gamma')
  ok('sort does not mutate its input', catalog.map((s) => s.name).join() === 'beta,alpha,gamma')

  const list = [
    { name: 'gpt-image', tag: 'image', modelInvocable: true, description: 'pictures' },
    { name: 'manual-only', tag: 'image', modelInvocable: false, description: '' },
    { name: 'h3', tag: 'video', modelInvocable: true, description: '', descriptionZh: '\u89c6\u9891\u63d0\u793a\u8bcd' },
  ]
  ok('query matches name', ui.filterSkills(list, { query: 'h3' }).length === 1)
  ok('query matches the Chinese blurb', ui.filterSkills(list, { query: '\u63d0\u793a\u8bcd' }).length === 1)
  ok('query matches the tag', ui.filterSkills(list, { query: 'video' }).length === 1)
  ok('the / -only chip drops manual-only skills', ui.filterSkills(list, { onlySlash: true }).length === 2)
  ok('a tag chip narrows to one tag', ui.filterSkills(list, { tag: 'image' }).length === 2)
  ok('chips and the query compose', ui.filterSkills(list, { tag: 'image', onlySlash: true, query: 'gpt' }).length === 1)
  const tags = ui.tagsOf(list)
  ok('tags are counted and ranked', tags[0].tag === 'image' && tags[0].count === 2, JSON.stringify(tags))
  ok('countMap keys by skill name', ui.countMap(HOST_SNAPSHOT.perSkill)['gpt-image'] === 3)
  ok('countMap tolerates a missing payload', JSON.stringify(ui.countMap(undefined)) === '{}')
}

console.log('\n[12] capability model and validation (api)')
{
  const api = exports.__api
  ok('formatBytes: bytes', api.formatBytes(0) === '0 B' && api.formatBytes(512) === '512 B')
  ok('formatBytes: kilobytes', api.formatBytes(2048) === '2.0 KB', api.formatBytes(2048))
  ok('formatBytes: megabytes', api.formatBytes(3 * 1024 * 1024) === '3.0 MB', api.formatBytes(3 * 1024 * 1024))
  ok('slugify lowercases and dashes', api.slugify('My Skill!') === 'my-skill', api.slugify('My Skill!'))
  ok('slugify trims stray dashes', api.slugify('--Weird__Name--') === 'weird__name', api.slugify('--Weird__Name--'))
  ok('initial takes the first alphanumeric', api.initial('gpt-image') === 'G' && api.initial('_x') === 'X')
  ok('initial survives an empty name', api.initial('') === '?')
  // The avatar used to take a hue from a name hash, which gave every skill its own arbitrary
  // colour — thirteen skills, thirteen hues, and the hue meant nothing. The palette is now
  // something the USER assigns and the default is a NEUTRAL tile, so these assertions are about
  // the inversion: an unmarked skill must come out colourless.
  ok('the palette is a fixed set of named keys', Array.isArray(api.SKILL_COLORS) && api.SKILL_COLORS.length === 8, String(api.SKILL_COLORS?.length))
  ok('every palette entry has a key, a hex and a label',
    api.SKILL_COLORS.every((c) => /^[a-z]+$/u.test(c.key) && /^#[0-9a-f]{6}$/iu.test(c.hex) && typeof c.label === 'string' && c.label !== ''))
  ok('palette keys are unique', new Set(api.SKILL_COLORS.map((c) => c.key)).size === 8)
  ok('an absent colour resolves to null, not to a colour', api.skillColor('') === null && api.skillColor(undefined) === null)
  ok('an unknown key resolves to null rather than falling back to a colour', api.skillColor('chartreuse') === null)
  // The VALUE is retuned with every palette swap (warm stone, Bondi Blue, now Vapor Chrome) while the
  // KEY is the thing that must never change: it is what each skill's .echocat.json stores, so renaming
  // one would silently drop every marking a user had already made. So this asserts that the key
  // resolves to a valid colour and that the key SET is stable — not the literal hex of the moment.
  ok('a known key resolves to its entry',
    /^#[0-9a-f]{6}$/iu.test(api.skillColor('teal')?.hex ?? '') && api.skillColor('teal')?.key === 'teal',
    JSON.stringify(api.skillColor('teal')))
  ok('...and the key set is the STABLE one that is written to disk',
    api.SKILL_COLORS.map((c) => c.key).join(',') === 'indigo,teal,green,amber,red,pink,violet,slate',
    api.SKILL_COLORS.map((c) => c.key).join(','))
  ok('hueOf is gone from the API', typeof api.hueOf === 'undefined', 'the hash-colour path was removed with the palette')

  ok('canInstall is true only when api:1 and writable', api.canInstall(CAP_FULL) === true)
  ok('canInstall is false when read-only', api.canInstall({ ...CAP_FULL, writable: false }) === false)
  ok('canInstall is false when the api is gone', api.canInstall(CAP_OFF) === false)
  ok('canInstall is false with no capability at all', api.canInstall(undefined) === false)
  ok('installDisabled explains a config-off host', api.installDisabled(CAP_OFF) === true && api.disabledReason(CAP_OFF) === CAP_REASON)
  ok('installDisabled calls a missing capability unavailable', api.disabledReason(undefined).includes('\u672a\u4e0a\u62a5'))
  ok('gitState: settled yes', api.gitState(CAP_FULL) === 'ok')
  ok('gitState: settled no', api.gitState({ ...CAP_FULL, git: false }) === 'unavailable')
  ok('gitState: undefined means probing, not unavailable', api.gitState({ ...CAP_FULL, git: undefined }) === 'unknown')
  ok('installModes keeps a fixed order', api.installModes({ modes: ['git', 'text'] }).join() === 'text,git')
  ok('uploadLimit reads limits.uploadBytes', api.uploadLimit(CAP_FULL) === 5 * 1024 * 1024)
  ok('checkSize refuses oversize input with the real size', api.checkSize(9 * 1024 * 1024, CAP_FULL).ok === false && api.checkSize(9 * 1024 * 1024, CAP_FULL).message.includes('9.0 MB'))
  ok('checkSize accepts input inside the limit', api.checkSize(1024, CAP_FULL).ok === true)

  const v = api.validateInstall
  ok('validation: empty text is refused', v({ mode: 'text', text: '   ', capability: CAP_FULL }).ok === false)
  ok('validation: text within limits passes', v({ mode: 'text', text: '# hi', capability: CAP_FULL }).ok === true)
  ok('validation: oversize markdown is refused', v({ mode: 'text', text: 'x'.repeat(300 * 1024), capability: CAP_FULL }).code === 'TOO_LARGE')
  ok('validation: a bad name is refused', v({ mode: 'text', text: '# hi', name: 'has space', capability: CAP_FULL }).code === 'INVALID_NAME')
  ok('validation: a dotted name is allowed', v({ mode: 'text', text: '# hi', name: 'my.skill', capability: CAP_FULL }).ok === true)
  ok('validation: url must be http(s)', v({ mode: 'url', url: 'ftp://x', capability: CAP_FULL }).code === 'BAD_URL')
  ok('validation: a good url passes', v({ mode: 'url', url: 'https://x/y.md', capability: CAP_FULL }).ok === true)
  ok('validation: file mode needs a file', v({ mode: 'file', file: null, capability: CAP_FULL }).code === 'EMPTY')
  ok('validation: file mode checks the upload limit', v({ mode: 'file', file: { size: 9 * 1024 * 1024 }, capability: CAP_FULL }).code === undefined && v({ mode: 'file', file: 9 * 1024 * 1024, capability: CAP_FULL }).ok === false)
  ok('validation: git mode needs a repo', v({ mode: 'git', repo: '', capability: CAP_FULL }).code === 'EMPTY')
  ok('validation: git mode is refused without git', v({ mode: 'git', repo: 'a/b', capability: { ...CAP_FULL, git: false } }).code === 'GIT_MISSING')
  ok('validation: a disabled host blocks every mode', v({ mode: 'text', text: '# hi', capability: CAP_OFF }).code === 'DISABLED')

  ok('bodyFor: text install', JSON.stringify(api.bodyFor('text', { text: '# hi', name: 'my-skill', overwrite: true })) === JSON.stringify({ action: 'install', mode: 'text', name: 'my-skill', overwrite: true, text: '# hi' }))
  ok('bodyFor: url install trims', api.bodyFor('url', { url: '  https://x/y.md  ' }).url === 'https://x/y.md')
  ok('bodyFor: git install carries ref and subpath', JSON.stringify(api.bodyFor('git', { repo: 'a/b', ref: 'v1', subpath: 'skills/x' })) === JSON.stringify({ action: 'install', mode: 'git', repo: 'a/b', ref: 'v1', subpath: 'skills/x' }))
  ok('bodyFor: file install carries the base64 payload', api.bodyFor('file', { filename: 'a.zip', dataBase64: 'AAA=' }).dataBase64 === 'AAA=')
  ok('bodyFor: an unknown mode degrades instead of throwing', api.bodyFor('nope', {}).mode === 'nope')
  ok('previewBodyFor: url preview', JSON.stringify(api.previewBodyFor('url', { url: 'https://x/y.md' })) === JSON.stringify({ action: 'preview', mode: 'url', url: 'https://x/y.md' }))
  ok('previewBodyFor: text preview carries the text', api.previewBodyFor('text', { text: '# hi' }).text === '# hi')
}

console.log('\n[13] the status rail store (api)')
{
  const api = exports.__api
  for (const toast of api.getToasts()) api.dismissToast(toast.id)
  const before = api.getToasts()
  const id = api.pushToast({ kind: 'pending', message: '\u6b63\u5728\u5b89\u88c5\u2026' })
  ok('pushToast publishes a new array (stable snapshot contract)', api.getToasts() !== before && api.getToasts().length === 1)
  ok('the pending toast is rendered by the rail', textOf(exports.__install.StatusRail({ toasts: api.getToasts(), onDismiss: api.dismissToast })).includes('\u6b63\u5728\u5b89\u88c5'))
  api.updateToast(id, { kind: 'error', message: '\u5931\u8d25\u4e86', hint: '\u53c2\u8003\u63d0\u793a' })
  const railText = textOf(exports.__install.StatusRail({ toasts: api.getToasts(), onDismiss: api.dismissToast }))
  ok('updateToast replaces in place', api.getToasts().length === 1 && api.getToasts()[0].kind === 'error')
  ok('the rail renders the message and the hint', railText.includes('\u5931\u8d25\u4e86') && railText.includes('\u53c2\u8003\u63d0\u793a'))
  ok('the rail is a polite live region', findHost(exports.__install.StatusRail({ toasts: api.getToasts(), onDismiss: api.dismissToast }), (n) => n.props?.['aria-live'] === 'polite') !== undefined)
  ok('the rail offers a dismiss button', findClickable(exports.__install.StatusRail({ toasts: api.getToasts(), onDismiss: api.dismissToast }), '') !== undefined)
  api.dismissToast(id)
  ok('dismissToast empties the rail', api.getToasts().length === 0)
  ok('dismissing an unknown id is a no-op', (() => {
    const snapshot = api.getToasts()
    api.dismissToast(99999)
    return api.getToasts() === snapshot
  })())
  for (let i = 0; i < 9; i += 1) api.pushToast({ kind: 'pending', message: `t${i}` })
  ok('the rail is capped at three entries', api.getToasts().length === 3, String(api.getToasts().length))
  ok('the cap drops the OLDEST and keeps the newest', api.getToasts().map((t) => t.message).join(',') === 't6,t7,t8', api.getToasts().map((t) => t.message).join(','))
  for (const toast of api.getToasts()) api.dismissToast(toast.id)
}

console.log('\n[13b] one rail, and toasts that clear themselves')
{
  const api = exports.__api
  // Fake timers, so the five-second window is asserted deterministically rather
  // than slept through — and so a real timer can never hold the suite open.
  const realSetTimeout = globalThis.setTimeout
  const realClearTimeout = globalThis.clearTimeout
  const timers = new Map()
  const unrefed = []
  let seq = 0
  globalThis.setTimeout = (fn, ms) => {
    seq += 1
    const handle = {
      id: seq,
      unref: () => unrefed.push(seq),
    }
    timers.set(seq, { fn, ms })
    return handle
  }
  globalThis.clearTimeout = (handle) => {
    if (handle !== null && typeof handle === 'object') timers.delete(handle.id)
  }
  const fireAll = () => {
    for (const [key, timer] of [...timers]) {
      timers.delete(key)
      timer.fn()
    }
  }
  try {
    // ONE SECOND, for EVERY kind. This replaced a deliberate asymmetry: errors used to never expire, on the
    // reasoning that they carry the actionable half of a failure. The owner's report was the opposite problem —
    // a failure toast became a permanent fixture to dismiss by hand — so the tests now assert the rule that
    // actually holds rather than the two that used to.
    const TTL = 1000
    api.pushToast({ kind: 'pending', message: '\u8fdb\u884c\u4e2d' })
    ok('a toast gets a one-second countdown', timers.size === 1 && [...timers.values()][0].ms === TTL, JSON.stringify([...timers.values()].map((t) => t.ms)))
    ok('the countdown is unref-ed, so it cannot hold a process open', unrefed.length === 1, JSON.stringify(unrefed))
    fireAll()
    ok('...and the toast clears itself when it elapses', api.getToasts().length === 0, JSON.stringify(api.getToasts()))

    // The case the owner hit: an error used to stay forever.
    const errorId = api.pushToast({ kind: 'error', message: '\u5931\u8d25\u4e86' })
    ok('an ERROR toast is armed too, so it cannot become a permanent fixture', timers.size === 1, String(timers.size))
    fireAll()
    ok('...and it clears itself like everything else', !api.getToasts().some((t) => t.id === errorId), JSON.stringify(api.getToasts()))

    // Pending to ok/error still re-arms, so a toast gets a full second from the moment it says something final
    // rather than whatever was left of the original window.
    const flip = api.pushToast({ kind: 'pending', message: '\u5373\u5c06\u5931\u8d25' })
    ok('a pending toast arms one', timers.size === 1, String(timers.size))
    api.updateToast(flip, { kind: 'error', message: '\u5931\u8d25\u4e86' })
    ok('turning it into an error RE-arms rather than disarms', timers.size === 1 && [...timers.values()][0].ms === TTL, JSON.stringify([...timers.values()].map((t) => t.ms)))

    const gone = api.pushToast({ kind: 'ok', message: '\u5b8c\u6210' })
    api.dismissToast(gone)
    ok('an explicit dismiss clears the pending countdown', timers.size === 1, String(timers.size))

    api.pushToast({ kind: 'error', message: '\u4fdd\u7559\u6211' })
    for (let i = 0; i < 4; i += 1) api.pushToast({ kind: 'ok', message: `s${i}` })
    const kinds = api.getToasts().map((t) => t.kind)
    ok('errors are still not evicted by successes piling up behind them', kinds.includes('error'), JSON.stringify(kinds))
    ok('the visible stack still stays at three', api.getToasts().length === 3, JSON.stringify(kinds))

    // Exactly ONE rail, and it belongs to the strip. The centre panel is unmounted
    // in the conversation view, so a rail inside it would be invisible exactly when
    // a write finishes — and with both surfaces on screen the same toast rendered
    // twice, once above the report and once inside it.
    const railCount = (tree) => findAllHost(tree, (n) => String(n.props?.className ?? '').includes('sr-rail')).length
    const panelTree = exports.__ui.SkillReportPanel({ snapshot: HOST_SNAPSHOT })
    const stripTree = exports.__ui.SkillReportStrip({ state: { phase: 'ready', data: HOST_SNAPSHOT, error: null, fetchedAt: Date.now() } })
    ok('the report panel renders no status rail', railCount(panelTree) === 0, String(railCount(panelTree)))
    ok('the composer strip renders the one rail', railCount(stripTree) >= 1, String(railCount(stripTree)))
  } finally {
    globalThis.setTimeout = realSetTimeout
    globalThis.clearTimeout = realClearTimeout
    for (const toast of api.getToasts()) api.dismissToast(toast.id)
  }
}

console.log('\n[14] the icon set (icons.js)')
{
  const { Icon: IconComponent, ICON_NAMES } = exports.__icons
  ok('the set is non-trivial', ICON_NAMES.length >= 20, String(ICON_NAMES.length))
  const broken = ICON_NAMES.filter((name) => {
    try {
      const node = IconComponent({ name })
      const kids = Array.isArray(node.props.children) ? node.props.children : [node.props.children]
      return node?.type !== 'svg' || kids.length === 0 || kids.some((kid) => kid === null || kid === undefined)
    } catch {
      return true
    }
  })
  ok('every glyph renders an svg with geometry', broken.length === 0, broken.join(', '))
  ok('every glyph is decorative by default', IconComponent({ name: 'plus' }).props['aria-hidden'] === 'true')
  ok('a titled glyph exposes an accessible name', IconComponent({ name: 'plus', title: 'x' }).props.role === 'img')
  ok('an unknown name falls back instead of rendering a hole', IconComponent({ name: 'nope' }).props.children !== undefined)
  ok('the 16x16 grid is fixed', IconComponent({ name: 'plus', size: 22 }).props.width === 22 && IconComponent({ name: 'plus' }).props.viewBox === '0 0 16 16')
  const required = ['search', 'plus', 'refresh', 'close', 'trash', 'check', 'warning', 'link', 'upload', 'git', 'copy', 'spark', 'caret']
  ok('all the icons the spec names exist', required.every((name) => ICON_NAMES.includes(name)), required.filter((n) => !ICON_NAMES.includes(n)).join(', '))
  ok('the panel no longer draws a chevron with a text glyph', !source.includes('sr-strip-caret" }, open ?'))
}

console.log('\n[15] the install sheet')
{
  const { InstallSheet } = exports.__install
  const base = { open: true, capability: CAP_FULL, history: HOST_SNAPSHOT.installHistory, onClose: () => {} }

  ok('a closed sheet renders nothing', InstallSheet({ ...base, open: false }) === null)

  const tree = InstallSheet(base)
  const sheetText = textOf(tree)
  ok('the sheet is a modal dialog', findHost(tree, (n) => n.props?.role === 'dialog' && n.props?.['aria-modal'] === 'true') !== undefined)
  ok('three mode tabs are offered', findAllHost(tree, (n) => n.props?.role === 'tab').length === 3, String(findAllHost(tree, (n) => n.props?.role === 'tab').length))
  ok('the tablist is labelled', findAllHost(tree, (n) => n.props?.role === 'tablist').length === 1)
  // One address tab, not two: `auto` decides whether the pasted URL is a repo, a
  // folder, a file or a zip, so the old "从链接" and "Git 仓库" tabs were the same
  // gesture — and the Git form asked the user to split a URL into three boxes.
  ok('the tab labels are the three gestures', ['\u7c98\u8d34\u5730\u5740', '\u7c98\u8d34 SKILL.md', '\u4e0a\u4f20\u6587\u4ef6'].every((label) => sheetText.includes(label)), sheetText.slice(0, 240))
  ok('the address tab is the default', findHost(tree, (n) => n.type === 'input' && n.props?.id === 'sr-install-address') !== undefined)
  ok('there is only one address field', findAllHost(tree, (n) => n.type === 'input' && n.props?.id === 'sr-install-address').length === 1)
  ok('the field says it takes any published address', typeof findHost(tree, (n) => n.props?.id === 'sr-install-address')?.props?.placeholder === 'string' && findHost(tree, (n) => n.props?.id === 'sr-install-address').props.placeholder.includes('/tree/'), findHost(tree, (n) => n.props?.id === 'sr-install-address')?.props?.placeholder)
  // The branch/subdirectory overrides exist but stay folded away.
  ok('the advanced fields are not shown by default', findHost(tree, (n) => n.props?.id === 'sr-install-subpath') === undefined)
  ok('an affordance to reveal them exists', findHost(tree, (n) => n.type === 'button' && textOf(n).includes('\u624b\u52a8\u6307\u5b9a')) !== undefined)
  // The Chinese display name is offered beside the install name, for EVERY mode —
  // it is an attribute of the skill, not of the transport.
  ok('the Chinese display name field is offered', findHost(tree, (n) => n.props?.id === 'sr-install-display-zh') !== undefined)
  ok('it says where the value goes', textOf(tree).includes('\u4e2d\u6587\u663e\u793a\u540d') && textOf(tree).includes('meta.yaml'), textOf(tree).slice(0, 200))
  ok('it is marked optional', textOf(tree).includes('\u53ef\u9009'))
  const longZh = InstallSheet({ ...base, displayNameZh: '\u5b57'.repeat(41) })
  ok('an over-long name is refused locally', findClickable(longZh, '\u5b89\u88c5').props.disabled === true)
  // The disabled reason lives on the button's title (same contract the textarea
  // assertions use), not as loose text in the panel.
  ok('...with a message naming the field', String(findClickable(longZh, '\u5b89\u88c5').props.title ?? '').includes('\u4e2d\u6587\u663e\u793a\u540d\u6700\u591a 40'), String(findClickable(longZh, '\u5b89\u88c5').props.title))
  // A pasted URL is described locally, so the field answers before any request.
  const described = InstallSheet({ ...base, repo: 'https://github.com/owner/repo/tree/main/skills/my-skill' })
  const describedText = textOf(described)
  ok('a pasted folder URL is recognised', describedText.includes('\u4ed3\u5e93\u91cc\u7684\u4f4d\u7f6e'), describedText.slice(0, 240))
  ok('the recognition names the branch and subdirectory', describedText.includes('main') && describedText.includes('skills/my-skill'), describedText.slice(0, 240))
  ok('an unparseable address is called out', textOf(InstallSheet({ ...base, repo: 'not an address at all' })).includes('\u4e0d\u50cf\u4e00\u4e2a\u5730\u5740'))
  // The underline is a CSS pseudo-element on the selected tab, so the marker can
  // never drift from the tab it belongs to. There must be no JS-measured
  // indicator element left over: the old one divided the track by the tab count
  // while the tabs were content-width, and landed between tabs.
  const selectedTabs = findAllHost(tree, (n) => n.props?.role === 'tab' && n.props?.['aria-selected'] === true)
  ok('exactly one tab is marked selected', selectedTabs.length === 1, String(selectedTabs.length))
  ok('no JS-measured indicator element is rendered', findHost(tree, (n) => String(n.props?.className ?? '').includes('sr-tab-ind')) === undefined)
  // The paste-a-file tab keeps its own behaviour, asserted directly on that tab.
  const textTree = InstallSheet({ ...base, initialMode: 'text' })
  // The field is not per-tab: it must be there whatever mode is showing.
  ok('the Chinese display name field is offered on the text tab too', findHost(textTree, (n) => n.props?.id === 'sr-install-display-zh') !== undefined)
  ok('the text tab shows a textarea', findHost(textTree, (n) => n.type === 'textarea') !== undefined)
  ok('the textarea has a real label', findHost(textTree, (n) => n.type === 'label' && n.props?.htmlFor === 'sr-install-text') !== undefined)
  const textTreeText = textOf(textTree)
  ok('a character counter is shown', textTreeText.includes('0') && /字符/u.test(textTreeText))
  ok('the install button is disabled while the textarea is empty', findHost(textTree, (n) => n.type === 'button' && textOf(n).includes('\u5b89\u88c5') && n.props?.disabled === true) !== undefined)
  ok('the install button explains why it is disabled', typeof findHost(tree, (n) => n.type === 'button' && textOf(n).includes('\u5b89\u88c5') && n.props?.disabled === true)?.props?.title === 'string')
  ok('a preview button is offered for pastable input', findClickable(tree, '\u9884\u89c8') !== undefined)
  ok('the preview button is disabled until the input is valid', findClickable(tree, '\u9884\u89c8').props.disabled === true)
  ok('history is listed from installHistory', sheetText.includes('gpt-image'))
  ok('the footer states the upload ceiling', textOf(InstallSheet({ ...base, mode: 'text', text: '# hi' })).includes('5.0 MB'))

  const fileTree = InstallSheet({ ...base, mode: 'file' })
  ok('the file tab hides a real file input', findHost(fileTree, (n) => n.type === 'input' && n.props?.type === 'file' && String(n.props.className).includes('sr-sr-only')) !== undefined)
  ok('the file input accepts md and zip', findHost(fileTree, (n) => n.type === 'input' && n.props?.type === 'file').props.accept.includes('.zip'))
  ok('a drop target is presented', findHost(fileTree, (n) => String(n.props?.className ?? '').includes('sr-drop')) !== undefined)
  ok('the drop target has a styled picker button', findClickable(fileTree, '\u9009\u62e9\u6587\u4ef6') !== undefined)
  {
    const drop = findHost(fileTree, (n) => String(n.props?.className ?? '') === 'sr-drop')
    ok('the drop target handles drag events', typeof drop.props.onDrop === 'function' && typeof drop.props.onDragOver === 'function')
    let prevented = 0
    drop.props.onDragOver({ preventDefault: () => { prevented += 1 } })
    ok('dragover is prevented so the browser does not open the file', prevented === 1)
    let refused = null
    drop.props.onDrop({ preventDefault: () => {}, dataTransfer: { files: [{ name: 'evil.exe', size: 10 }] } })
    const afterText = textOf(InstallSheet({ ...base, mode: 'file' }))
    refused = afterText
    ok('a non-skill file is refused with its name', InstallSheet({ ...base, mode: 'file' }) !== null && refused !== null)
  }

  // The old separate url/git tabs are gone; both are the same gesture now, and the
  // host decides what the address is.
  const urlTree = InstallSheet({ ...base, mode: 'url', repo: 'https://x/y.md' })
  ok('the address tab renders one address field', findAllHost(urlTree, (n) => n.type === 'input' && n.props?.id === 'sr-install-address').length === 1)
  ok('a valid address enables the primary action', findClickable(urlTree, '\u5b89\u88c5').props.disabled === false)
  ok('the address tab offers no file input', findHost(urlTree, (n) => n.type === 'input' && n.props?.type === 'file') === undefined)
  ok('a markdown link is recognised as a skill file', textOf(urlTree).includes('SKILL.md \u76f4\u94fe'), textOf(urlTree).slice(0, 200))
  ok('a repo slug is recognised as a repository', textOf(InstallSheet({ ...base, repo: 'owner/repo' })).includes('GitHub \u4ed3\u5e93'))
  ok('a zip link is recognised as an archive', textOf(InstallSheet({ ...base, repo: 'https://x/y.zip' })).includes('zip \u538b\u7f29\u5305'))
  const advancedTree = InstallSheet({ ...base, repo: 'owner/repo', initialAdvanced: true })
  ok('the branch / subdirectory overrides are reachable', ['sr-install-ref', 'sr-install-subpath'].every((id) => findHost(advancedTree, (n) => n.props?.id === id) !== undefined))
  const gitOffTree = InstallSheet({ ...base, repo: 'owner/repo', capability: { ...CAP_FULL, git: false } })
  ok('a bare repo slug is blocked when the host has no git', findClickable(gitOffTree, '\u5b89\u88c5') !== undefined && textOf(gitOffTree).includes('\u6ca1\u6709\u53ef\u7528\u7684 git'))
  ok('...and says why', textOf(gitOffTree).includes('\u6ca1\u6709\u53ef\u7528\u7684 git'))
  const gitProbeTree = InstallSheet({ ...base, repo: 'owner/repo', capability: { ...CAP_FULL, git: undefined } })
  ok('an unsettled git probe reads as 检测中, not 不可用', textOf(gitProbeTree).includes('\u68c0\u6d4b\u4e2d'), textOf(gitProbeTree).slice(-260))
  ok('...and does not disable the git tab', findHost(gitProbeTree, (n) => n.props?.role === 'tab' && n.props.disabled === true) === undefined)

  const offTree = InstallSheet({ ...base, capability: CAP_OFF })
  const offText = textOf(offTree)
  ok('a config-off host shows no mode tabs', findHost(offTree, (n) => n.props?.role === 'tablist') === undefined)
  ok('a config-off host states the reason', offText.includes(CAP_REASON), offText.slice(0, 200))
  ok('a config-off host offers no install button', findClickable(offTree, '\u5b89\u88c5') === undefined)
  ok('a config-off host can still be closed', findClickable(offTree, '\u5173\u95ed') !== undefined)
  ok('the sheet has an aria-labelled close affordance', findHost(offTree, (n) => n.props?.['aria-label'] === '\u5173\u95ed\u5b89\u88c5\u9762\u677f') !== undefined)
  ok('the sheet is rendered closed when open is not exactly true', InstallSheet({ ...base, open: undefined }) === null)
}

console.log('\n[16] install affordances follow the capability')
{
  const ui = exports.__ui
  const snapshotWith = (capability) => ({ ...HOST_SNAPSHOT, capability })
  const panelFor = (capability) => ui.SkillReportPanel({ snapshot: snapshotWith(capability), onRefresh: () => {} })
  const stripFor = (capability) => ui.SkillReportStrip({ state: { phase: 'ready', data: snapshotWith(capability), fetchedAt: Date.now(), error: null }, onRefresh: () => {} })

  const full = panelFor(CAP_FULL)
  ok('the writable panel header offers install', findHost(full, (n) => n.props?.['aria-label'] === '\u5b89\u88c5 skill') !== undefined)
  ok('the writable catalog header offers install', exactButton(full, '\u5b89\u88c5') !== undefined)
  ok('the writable catalog header offers rescan', findHost(full, (n) => n.props?.['aria-label'] === '\u91cd\u65b0\u626b\u63cf skill \u76ee\u5f55') !== undefined)
  ok('the footer reports a writable root', textOf(full).includes('\u53ef\u5199'))
  ok('the footer reports git availability', textOf(full).includes('git \u53ef\u7528'))

  const readOnly = panelFor({ ...CAP_FULL, writable: false })
  ok('a read-only panel hides install', findHost(readOnly, (n) => n.props?.['aria-label'] === '\u5b89\u88c5 skill') === undefined)
  ok('a read-only panel hides the catalog install button', exactButton(readOnly, '\u5b89\u88c5') === undefined)
  ok('a read-only panel still offers rescan', findHost(readOnly, (n) => n.props?.['aria-label'] === '\u91cd\u65b0\u626b\u63cf skill \u76ee\u5f55') !== undefined)
  ok('a read-only panel says so in the footer', textOf(readOnly).includes('\u53ea\u8bfb'))

  const off = panelFor(CAP_OFF)
  ok('a config-off panel hides install and rescan', findHost(off, (n) => n.props?.['aria-label'] === '\u5b89\u88c5 skill') === undefined && findHost(off, (n) => n.props?.['aria-label'] === '\u91cd\u65b0\u626b\u63cf skill \u76ee\u5f55') === undefined)
  ok('a config-off panel states the reason in the footer', textOf(off).includes(CAP_REASON), textOf(off).slice(-200))
  ok('a config-off panel hides per-skill delete', findAllHost(off, (n) => n.type === 'button' && String(n.props?.['aria-label'] ?? '').includes('\u5220\u9664')).length === 0)

  ok('the writable strip offers install', findHost(stripFor(CAP_FULL), (n) => n.props?.['aria-label'] === '\u5b89\u88c5 skill') !== undefined)
  ok('a read-only strip hides install', findHost(stripFor({ ...CAP_FULL, writable: false }), (n) => n.props?.['aria-label'] === '\u5b89\u88c5 skill') === undefined)
  ok('a config-off strip hides install', findHost(stripFor(CAP_OFF), (n) => n.props?.['aria-label'] === '\u5b89\u88c5 skill') === undefined)
  ok('a host with no capability is treated as read-only', findHost(stripFor(undefined), (n) => n.props?.['aria-label'] === '\u5b89\u88c5 skill') === undefined)
  ok('the git badge is omitted without git', !textOf(panelFor({ ...CAP_FULL, git: false })).includes('git \u53ef\u7528'))

  // The section header must stay a single button so its text layout is unchanged.
  const headerRow = findHost(full, (n) => String(n.props?.className ?? '') === 'sr-sec-head')
  ok('the section header keeps one toggle button and a sibling action slot', headerRow !== undefined && headerRow.props.children.length === 2 && headerRow.props.children[0].type === 'button')

  // Per-skill row actions need the catalog open.
  let deleteLabels = []
  let copyLabels = []
  withExpanded(() => {
    // Inside `withExpanded` only the *section* state is forced, so the cards
    // render in their normal (unarmed) state.
    deleteLabels = findAllHost(full, (n) => n.type === 'button' && String(n.props?.['aria-label'] ?? '').includes('\u5220\u9664')).map((n) => n.props['aria-label'])
    copyLabels = findAllHost(full, (n) => n.type === 'button' && String(n.props?.['aria-label'] ?? '').includes('\u590d\u5236\u540d\u79f0')).map((n) => n.props['aria-label'])
  })
  ok('a card offers NO per-skill copy button, at the owner\'s request',
    copyLabels.length === 0, JSON.stringify(copyLabels))
  ok('a writable catalog offers per-skill delete', deleteLabels.length === 3, JSON.stringify(deleteLabels))
  ok('the delete control is unarmed until clicked', deleteLabels.every((label) => label.startsWith('\u5220\u9664')), JSON.stringify(deleteLabels))

/* -- the card footer: calls | actions | source, and the plugin-skill switch -- */
//
// Every one of these is a request the owner made in one message, so each is pinned separately rather than
// left to be noticed on the next screenshot.
{
  const skillRow = (name, extra = {}) => ({
    name,
    description: 'x',
    descriptionZh: '描述',
    modelInvocable: true,
    provenance: { known: true, source: 'git', repo: 'owner/repo', url: 'https://github.com/owner/repo', color: '', claimed: false, changedSinceInstall: false },
    ...extra,
  })
  // `snapshot` IS the data object — the panel does `snapshot ?? state.data`. Wrapping it in `{data: …}` (the
  // first two attempts here) leaves the panel with no `skills` at all, and it silently renders "0 个 skill"
  // rather than complaining. `perSkill` is a LIST of `{name, count}`, which `countMap` turns into the lookup.
  const snapshot = {
    ...HOST_SNAPSHOT,
    capability: CAP_FULL,
    skills: [
      skillRow('mine', { location: 'user' }),
      skillRow('bundled-one', { location: 'plugin', layer: 'bundled' }),
    ],
    disabledSkills: [],
    perSkill: [{ name: 'mine', count: 7 }],
  }
  // Rendered through `SkillRow` DIRECTLY, and that is not a shortcut.
  //
  // The card is only reachable through the panel, whose skills section is collapsed by default, and the harness
  // cannot expand it: `withExpanded` patches `useState` only while `currentComponent === 'Section'`, a name that
  // only the harness's `invoke()` sets, so calling a component directly leaves it collapsed. `SkillRow` is the
  // component that renders a card, so this drives the real code rather than a stand-in for it — the same route
  // the colour palette is tested by.
  const card = (skill, counts) =>
    exports.__ui.SkillRow({ skill, counts, onUse: () => {}, capability: CAP_FULL, onChanged: () => {}, update: undefined })
  const tree = card(snapshot.skills[0], exports.__ui.countMap(snapshot.perSkill))

  // The footer holds TWO columns now: a lead column with the count and the actions, then the source.
  //
  // It was three — count, actions, source — with the actions centred, until the owner asked for the buttons to be
  // left-aligned ("这些按钮直接左对齐吧"). The count moved inside the lead column so it sits before the buttons on
  // one left-aligned line rather than floating between them.
  const footRow = findAllHost(tree, (n) => String(n.props?.className ?? '') === 'sr-card-foot-row')
  ok('[29] the card has a footer row', footRow.length >= 1, String(footRow.length))
  ok('[29] ...whose FIRST column is the lead holding count + actions',
    String(footRow[0]?.props?.children?.[0]?.props?.className ?? '') === 'sr-card-lead',
    JSON.stringify(footRow[0]?.props?.children?.map?.((c) => c?.props?.className)))
  ok('[29] ...and the source as its LAST column',
    String(footRow[0]?.props?.children?.[1]?.props?.className ?? '') === 'sr-card-src')
  // The count comes BEFORE the buttons inside the lead, which is what makes the line read
  // "what this skill has done, then what you can do with it".
  const lead = footRow[0]?.props?.children?.[0]
  ok('[29] the lead column runs count-then-actions, left to right',
    String(lead?.props?.children?.[0]?.props?.className ?? '') === 'sr-card-calls' &&
      String(lead?.props?.children?.[1]?.props?.className ?? '') === 'sr-card-actions',
    JSON.stringify(lead?.props?.children?.map?.((c) => c?.props?.className)))

  /**
   * THE ACTION ROW IS LEFT-ALIGNED, asserted against the generated STYLESHEET.
   *
   * `justify-content` is a CSS outcome, so a tree assertion cannot see it — and this is the second time this exact
   * row's alignment has changed, which is precisely when a written-down rule gets silently reverted.
   *
   * It has to be the SHEET and not `source`: `source` is the raw bundle, so a regex against it matches the JS record
   * literal (`{ justifyContent: 'center' }`) rather than the CSS declaration. The first version of this check did
   * exactly that and passed for the wrong reason.
   *
   * The sheet is produced the same way `test/client-css.mjs` produces it — by evaluating `theme.js` against its two
   * generated-data modules — because the record tables are interpolated at runtime and neither the bundle text nor
   * the raw source can show what the browser receives.
   */
  const sheet = (() => {
    const clientDir = join(pkgRoot, 'src', 'client')
    const generated = {}
    const load = (file) => {
      if (generated[file] !== undefined) return generated[file]
      const holder = { exports: {} }
      // eslint-disable-next-line no-new-func
      new Function('module', 'exports', 'require', readFileSync(join(clientDir, file), 'utf8'))(holder, holder.exports, () => {
        throw new Error(`${file} must not require anything`)
      })
      generated[file] = holder.exports
      return generated[file]
    }
    const holder = { exports: {} }
    // eslint-disable-next-line no-new-func
    new Function('module', 'exports', 'require', readFileSync(join(clientDir, 'theme.js'), 'utf8'))(holder, holder.exports, (id) => {
      if (id === 'react') return { createElement: () => null }
      if (id.startsWith('./')) return load(id.slice(2))
      throw new Error(`theme.js must not require ${id}`)
    })
    return String(holder.exports.CSS ?? '')
  })()
  ok('[29] the stylesheet was generated for these assertions', sheet.length > 10000, `${sheet.length} bytes`)
  ok('[29] nothing centres the card action row any more',
    !/\.sr-card-foot-row \.sr-row-actions\{[^}]*justify-content:center/u.test(sheet))

  /**
   * THE HOVER EFFECT: the card under the pointer grows, and NOTHING else moves.
   *
   * It required both halves (grow and recede) until the owner saw it working and asked for the recede to go —
   * "悬停的时候其他卡片不用缩小" — so the second assertion is now inverted, and the absence is what is pinned. A later
   * pass re-adding a sibling rule would otherwise be invisible here.
   */
  // Matched loosely on purpose: the selector has had to gain `:has()` and `:is()` to win the cascade, and a regex
  // pinned to the exact text would fail every time the selector is corrected — which is the opposite of useful. What
  // matters is that a rule scales the hovered card up; WHICH rule wins is asserted separately and precisely below.
  ok('[29] hovering a card grows it', /scale\(1\.02\)/u.test(sheet), 'the hovered card must scale up')
  ok('[29] ...and NOTHING shrinks the other cards',
    !/scale\(\.98\)|scale\(0\.98\)/u.test(sheet) && !/\.sr-skill:not\(:hover\)[^{]*\{[^}]*transform/u.test(sheet),
    'a recede rule was removed at the owner\'s request and must not come back')
  // And the transition has to be on the base rule, or the effect animates in but snaps out.
  ok('[29] ...with the transition declared at the base, so it animates BOTH ways',
    /\.sr-skill\{[^}]*transition:[^}]*transform/u.test(sheet),
    'a transition inside a :hover rule does not run when the pointer leaves')
  /**
   * AND THE GROW RULE MUST WIN THE CASCADE, not merely exist.
   *
   * THIS is what the first two versions were missing, and its absence is why the effect shipped DEAD TWICE, for two
   * different reasons:
   *
   *   1. a hardcoded `transform:translateY(-1px)` in the HAND-WRITTEN part of the stylesheet — a third file,
   *      `theme.js`, emitted before both generated passes — overrode the scale by source order;
   *   2. once that was gone, the RECEDE rule (`:not(:hover)`, whose argument contributes to specificity) scored FOUR
   *      classes against the grow rule's THREE, so the HOVERED card was pinned at `scale(.98)` and looked like it had
   *      no effect — while the avatar moved, because its own transform rule won ITS pair. That asymmetry is exactly
   *      what the owner reported: "只是鼠标在卡片里的头像上有放大缩小效果".
   *
   * Both were invisible to "does the rule exist". A property two rules claim is decided by SPECIFICITY first and
   * source order second, so this scores every rule that sets `transform` on a hovered card and requires the scale to
   * be the winner.
   */
  const transformRules = sheet
    .split('}')
    .map((chunk) => chunk.split('{'))
    .filter(([sel, body]) => typeof sel === 'string' && typeof body === 'string' && body.includes('transform'))
    .map(([sel, body]) => ({
      // `:not()` and `:has()` contribute their ARGUMENT, which is the detail that caused failure 2.
      spec: Math.max(
        ...sel.split(',').map((one) => {
          const classes = (one.match(/\.[a-z-]+/gu) ?? []).length
          const pseudos = (one.match(/:(?!:)[a-z-]+(\([^)]*\))?/gu) ?? []).length
          const inner = (one.match(/:(?:not|has|is)\(([^)]*)\)/gu) ?? [])
            .map((part) => (part.match(/[.:][a-z-]+/gu) ?? []).length)
            .reduce((sum, n) => sum + n, 0)
          return classes + pseudos + inner
        }),
      ),
      // Matched by ENDING at the card: `.sr-grid:has(.sr-skill:hover) .sr-skill:is(.sr-skill):hover` does, while
      // `.sr-skill:hover .sr-avatar` does not — the avatar's own nudge is a deliberate separate motion and must not be
      // counted as a competing claimant for the CARD's transform.
      hovered: sel
        .split(',')
        .some(
          (one) =>
            /\.sr-skill(?![\w-])[^ >]*:hover$/u.test(one.trim()) ||
            /\.sr-skill:is\(\.sr-skill\):hover$/u.test(one.trim()),
        ),
      body: body.trim(),
    }))
    .filter((rule) => rule.hovered)
  const topSpec = Math.max(...transformRules.map((rule) => rule.spec))
  const winners = transformRules.filter((rule) => rule.spec === topSpec)
  ok('[29] the rule that WINS the hover transform is the scale',
    winners.length > 0 && winners.every((rule) => rule.body.includes('scale(1.02)') && !rule.body.includes('translateY')),
    `top specificity ${topSpec}: ` + JSON.stringify(winners.map((rule) => rule.body.slice(0, 60))))
  // With the recede rule gone there is only ONE rule left, so this cannot be shown to outrank a sibling any more. What it
  // still pins is that the winning rule is the only claimant — the state the owner asked for, and the state in which the
  // earlier specificity fight cannot recur.
  ok('[29] ...and it is the ONLY rule claiming a transform on a hovered card',
    transformRules.length === 1,
    `claimants: ${JSON.stringify(transformRules.map((rule) => rule.body.slice(0, 40)))}`)

  // The count, bottom-left, showing a real number for a skill that has been called.
  const rendered = textOf(tree)
  ok('[29] the call count is shown for a used skill', rendered.includes('7 次'), rendered.slice(0, 400))
  ok('[29] ...and nothing is shown for an unused one',
    !rendered.includes('0 次'), 'a quiet card must stay quiet rather than print a zero')

  // The source line, in the footer rather than in the text block.
  ok('[29] the source line names its field', rendered.includes('\u6765\u6e90\uff1a'), rendered.slice(0, 400))

  // THE SWITCH. Hidden by default is the whole point of the request, and the rule is a pure function so it is
  // stated directly rather than inferred from what a render happened to omit.
  const catalogue = [
    { name: 'mine', location: 'user' },
    { name: 'bundled-one', location: 'plugin' },
    { name: 'bundled-two', location: 'plugin' },
    { name: 'legacy-unknown' },
  ]
  const hidden = exports.__ui.visibleSkills(catalogue, false)
  ok('[29] plugin-shipped skills are hidden by default',
    hidden.map((s) => s.name).join(',') === 'mine,legacy-unknown',
    JSON.stringify(hidden.map((s) => s.name)))
  ok('[29] ...so the count offered to the user is the number hidden',
    catalogue.length - hidden.length === 2, String(catalogue.length - hidden.length))
  ok('[29] ...and the switch reveals them when asked',
    exports.__ui.visibleSkills(catalogue, true).length === catalogue.length)
  // Defaulting to VISIBLE is what the first version of the check would have done by accident: an unknown
  // `location` is not evidence of a plugin, so a legacy payload must not be swallowed by the filter.
  ok('[29] a skill with no location is NOT treated as a plugin\'s',
    hidden.some((s) => s.name === 'legacy-unknown'), JSON.stringify(hidden.map((s) => s.name)))

  /**
   * THE CONTROL HAS TO SURVIVE ITS OWN ACTIVATION.
   *
   * The chip was gated on `skills.length - visible.length` — how many the switch is currently REMOVING — which is
   * zero the instant the user reveals them. So ONE CLICK REMOVED THE VERY CONTROL THAT HAD JUST BEEN CLICKED and
   * there was no way to hide them again. The owner found it immediately: "插件自带开关点一下就消失了".
   *
   * The number governing visibility has to be the number of plugin skills that EXIST. Those two quantities are
   * equal only while the switch is OFF, which is exactly why the first version of this test passed while the
   * control was broken.
   */
  const pluginTotal = (list) => list.filter((s) => s.location === 'plugin').length
  ok('[29] the count gating the switch is the TOTAL, not the filtered-out number',
    pluginTotal(catalogue) === 2, `total=${pluginTotal(catalogue)}`)
  ok('[29] ...and the two differ exactly when the switch is ON, which is the case that broke',
    pluginTotal(catalogue) !== catalogue.length - exports.__ui.visibleSkills(catalogue, true).length,
    `total=${pluginTotal(catalogue)} filteredOutWhenShown=${catalogue.length - exports.__ui.visibleSkills(catalogue, true).length}`)
  /**
   * A NOTE ON WHAT THE ABOVE DOES AND DOES NOT PROVE.
   *
   * These are arithmetic checks on `visibleSkills`, and they passed 508/508 with the BROKEN gate restored — so
   * they are NOT evidence that the switch survives being clicked. They pin the RULE, which is worth having, but
   * the click itself needs a real hook runtime and is asserted in the [17] block below, where `withMount` is in
   * scope. This note exists because the first version of this block claimed to catch the bug and did not.
   */
}
  ok('a writable catalog offers per-skill delete', deleteLabels.length === 3, JSON.stringify(deleteLabels))
  ok('the delete control is unarmed until clicked', deleteLabels.every((label) => label.startsWith('\u5220\u9664')), JSON.stringify(deleteLabels))
}

console.log('\n[17] interactions (real setState)')
await (async () => {
  /* ---------------- a tiny hook runtime ---------------- */
  function createView(Component, props) {
    const cells = new Map()
    const effectDeps = new Map()
    const effectCleanups = new Map()
    let hookCtx = null
    let pendingEffects = []
    let rendering = false
    let currentProps = props ?? {}
    let tree = null

    const sameDeps = (prev, next) => {
      if (prev === undefined || next === undefined) return false
      if (prev.length !== next.length) return false
      return prev.every((value, i) => Object.is(value, next[i]))
    }

    const runtime = {
      useState(initial) {
        const id = `${hookCtx.key}::s${hookCtx.i++}`
        if (!cells.has(id)) cells.set(id, typeof initial === 'function' ? initial() : initial)
        const set = (next) => {
          const value = typeof next === 'function' ? next(cells.get(id)) : next
          if (Object.is(value, cells.get(id))) return
          cells.set(id, value)
          schedule()
        }
        return [cells.get(id), set]
      },
      useRef(initial) {
        const id = `${hookCtx.key}::r${hookCtx.i++}`
        if (!cells.has(id)) cells.set(id, { current: typeof initial === 'function' ? initial() : initial })
        return cells.get(id)
      },
      useMemo: (fn) => fn(),
      useCallback: (fn) => fn,
      useEffect(fn, deps) {
        pendingEffects.push({ id: `${hookCtx.key}::e${hookCtx.i++}`, fn, deps })
      },
      useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
    }

    const build = (node, counters) => {
      if (node === null || node === undefined || typeof node === 'boolean') return null
      if (Array.isArray(node)) {
        return { type: '#frag', props: {}, element: null, children: node.map((child) => build(child, counters)).filter(Boolean) }
      }
      if (typeof node === 'string' || typeof node === 'number') return { type: '#text', props: {}, text: String(node), children: [] }
      const { type, props: nodeProps } = node
      if (typeof type === 'function') {
        const seen = (counters.get(type) ?? 0) + 1
        counters.set(type, seen)
        const previous = hookCtx
        hookCtx = { key: `${type.name || 'Anon'}#${seen}`, i: 0 }
        let output
        try {
          output = type({ ...(nodeProps ?? {}) })
        } finally {
          hookCtx = previous
        }
        return build(output, counters)
      }
      const children = []
      const kids = build(nodeProps?.children, counters)
      if (kids !== null) children.push(kids)
      return { type, props: nodeProps ?? {}, element: node, children }
    }

    const runEffects = () => {
      for (const effect of pendingEffects) {
        if (sameDeps(effectDeps.get(effect.id), effect.deps)) continue
        if (effectCleanups.has(effect.id)) {
          try {
            effectCleanups.get(effect.id)()
          } catch {
            /* ignore */
          }
          effectCleanups.delete(effect.id)
        }
        effectDeps.set(effect.id, effect.deps)
        const cleanup = effect.fn()
        if (typeof cleanup === 'function') effectCleanups.set(effect.id, cleanup)
      }
    }

    const render = () => {
      const counters = new Map()
      pendingEffects = []
      tree = build(mockReact.createElement(Component, currentProps), counters)
      runEffects()
    }
    const schedule = () => {
      if (rendering) return
      rendering = true
      try {
        render()
      } finally {
        rendering = false
      }
    }

    // Swap the stub hooks for the real ones for the lifetime of this view; the
    // components' `React` reference is this same object, so they pick them up.
    Object.assign(mockReact, runtime)
    render()

    const text = (node = tree) => {
      if (node === null || node === undefined) return ''
      if (node.type === '#text') return node.text
      return node.children.map((child) => text(child)).join('')
    }
    const collect = (node, predicate, out = []) => {
      if (node === null || node === undefined) return out
      if (predicate(node)) out.push(node)
      for (const child of node.children) collect(child, predicate, out)
      return out
    }
    const view = {
      get tree() {
        return tree
      },
      text: () => text(),
      findAll: (predicate) => collect(tree, predicate),
      buttons: () => collect(tree, (n) => n.type === 'button'),
      byText: (label) => collect(tree, (n) => n.type === 'button' && text(n).includes(label))[0],
      byLabel: (label) => collect(tree, (n) => n.props?.['aria-label'] === label)[0],
      click: (node) => {
        const handler = node?.props?.onClick
        if (typeof handler !== 'function') return false
        handler({ preventDefault() {}, stopPropagation() {}, target: node.element, currentTarget: node.element })
        return true
      },
      setProps: (patch) => {
        currentProps = { ...currentProps, ...patch }
        render()
      },
      unmount: () => {
        for (const cleanup of effectCleanups.values()) {
          try {
            cleanup()
          } catch {
            /* ignore */
          }
        }
        effectCleanups.clear()
        Object.assign(mockReact, savedRuntime)
      },
    }
    return view
  }

  const savedRuntime = {
    useState: mockReact.useState,
    useEffect: mockReact.useEffect,
    useCallback: mockReact.useCallback,
    useRef: mockReact.useRef,
    useMemo: mockReact.useMemo,
    useSyncExternalStore: mockReact.useSyncExternalStore,
  }

  const withMount = async (Component, props, body) => {
    const view = createView(Component, props)
    try {
      return await body(view)
    } finally {
      view.unmount()
    }
  }

  {
    const install = exports.__install
    const { SkillRowActions, InstallSheet, StatusRail } = install

    const clearToasts = () => {
      for (const toast of exports.__api.getToasts()) exports.__api.dismissToast(toast.id)
    }

    /* -- delete is a two-step in-card confirm -- */
    clearToasts()
    let changed = 0
    await withMount(SkillRowActions, { skill: { name: 'gpt-image' }, capability: CAP_FULL, onChanged: () => { changed += 1 } }, async (view) => {
      const before = calls.length
      const unarmed = view.byLabel('\u5220\u9664 gpt-image')
      ok('[17a] the delete control starts unarmed', unarmed !== undefined && view.text().includes('\u5220\u9664') === false)
      view.click(unarmed)
      ok('[17a] the first click only arms the button', view.text().includes('\u786e\u8ba4\u5220\u9664') && calls.length === before)
      ok('[17a] arming explains the backup', view.text().includes('\u5907\u4efd'))
      view.click(view.byLabel('\u786e\u8ba4\u5220\u9664 gpt-image'))
      ok('[17a] the second click posts the uninstall', calls.length === before + 1 && calls[calls.length - 1].body.action === 'uninstall')
      ok('[17a] ...with confirm:true, which is what avoids NEEDS_CONFIRM', calls[calls.length - 1].body.confirm === true)
      await tick()
      ok('[17a] the response is reported in the rail', exports.__api.getToasts().some((t) => t.kind === 'ok' && t.message.includes('gpt-image')), JSON.stringify(exports.__api.getToasts()))
      ok('[17a] the backup path is shown to the user', exports.__api.getToasts().some((t) => String(t.hint ?? '').includes('skill-backups')), JSON.stringify(exports.__api.getToasts()))
      ok('[17a] onChanged fires so the list reloads', changed === 1, String(changed))
    })

    /* -- the colour palette: the whole click path, which had NO test at all -- */
    //
    // The owner reported twice that marking a skill with a colour does nothing, and that it happens on
    // SOME skills. This action shipped without a single client test, so every step was unverified: the
    // avatar being a button at all, the palette opening, a swatch existing, and a click on that swatch
    // reaching the transport.
    //
    // Rendered DIRECTLY rather than through the registered `PanelSurface`, which is the real component
    // and reads its data from the store — passing it a `snapshot` prop feeds nothing and every card
    // disappears, which is how the first attempt at this test failed.
    const paletteCatalog = [
      { name: 'gpt-image', descriptionZh: '图像生成', modelInvocable: true, provenance: { known: true, kind: 'repo', url: 'https://github.com/VDERR/echocat-skill-panel' } },
      { name: 'marked-one', descriptionZh: '已标记的', modelInvocable: true, provenance: { known: true, kind: 'repo', url: 'https://github.com/VDERR/echocat-skill-panel', color: 'amber' } },
    ]
    const paletteSnapshot = { ...HOST_SNAPSHOT, capability: CAP_FULL, skills: paletteCatalog, disabledSkills: [] }
    clearToasts()
    let doneCount = 0
    // Counts `onDone` calls for the refusal case: it must NOT fire when the write was refused.
    let colourDoneCount = 0
    {
      // Rendered through the PANEL so the assertion is about what a user can actually click, but the
      // palette is opened by invoking the avatar's own `onClick` — the harness re-renders a function tree
      // rather than a live React tree, so state does not survive a re-read. Asserting the WRITE is what
      // matters here, and that needs no re-render.
      const before = calls.length
      const tree = withExpanded(() => exports.__ui.SkillReportPanel({ snapshot: paletteSnapshot }))
      ok('[17f] ...and no palette is open until it is clicked',
        findAllHost(tree, (n) => String(n.props?.className ?? '') === 'sr-palette-row').length === 0)

      // The palette itself, rendered directly. This is the component the owner clicks, and its failure
      // mode is SILENT: a swatch that posts nothing looks identical to a swatch that was never wired.
      const picker = exports.__ui.ColorPicker({ name: 'gpt-image', current: '', onDone: () => { doneCount += 1 } })
      // Matched on the EXACT class, not `includes`: `.sr-swatches` is the container and also contains the
      // substring, so the first version of this counted it as a swatch and expected 9 while finding 10.
      const swatches = findAllHost(picker, (n) => String(n.props?.className ?? '').split(/\s+/u).includes('sr-swatch'))
      ok('[17f] the palette offers every colour plus a reset',
        swatches.length === exports.__api.SKILL_COLORS.length + 1, `${swatches.length} swatches`)
      const teal = findAllHost(picker, (n) => n.type === 'button' && String(n.props?.['aria-label'] ?? '').includes('水绿'))[0]
      ok('[17f] a swatch is a labelled button', teal !== undefined,
        JSON.stringify(findAllHost(picker, (n) => n.type === 'button').map((n) => n.props?.['aria-label']).filter(Boolean)))
      ok('[17f] nothing is written merely by opening the palette', calls.length === before)
      teal.props.onClick()
      await tick()
      const colourCall = calls.slice(before).find((call) => call.body?.action === 'color')
      ok('[17f] clicking a swatch POSTS the colour — the click the owner reports doing nothing',
        colourCall !== undefined, JSON.stringify(calls.slice(before).map((c) => c.body)))
      ok('[17f] ...naming the skill and the colour',
        colourCall?.body?.name === 'gpt-image' && colourCall?.body?.color === 'teal', JSON.stringify(colourCall?.body))
      ok('[17f] ...and the caller is told it is done, so the card can close the palette',
        doneCount > 0, String(doneCount))

      // The reset, which is the control an ALREADY marked skill needs. "Some skills cannot be marked" is
      // the shape of a bug that depends on the skill's state, so the marked case is exercised rather than
      // assumed equivalent.
      const markedPicker = exports.__ui.ColorPicker({ name: 'marked-one', current: 'amber', onDone: () => {} })
      const reset = findAllHost(markedPicker, (n) => n.type === 'button' && String(n.props?.['aria-label'] ?? '').includes('不标记'))[0]
      ok('[17f] an already-marked skill gets a reset control', reset !== undefined,
        JSON.stringify(findAllHost(markedPicker, (n) => n.type === 'button').map((n) => n.props?.['aria-label']).filter(Boolean)))
      const beforeReset = calls.length
      reset.props.onClick()
      await tick()
      const cleared = calls.slice(beforeReset).find((call) => call.body?.action === 'color')
      ok('[17f] the reset writes an EMPTY colour rather than omitting the field',
        cleared !== undefined && cleared.body.color === '', JSON.stringify(cleared?.body))

      // A read-only host must not offer a palette it cannot honour: a clickable avatar that silently fails
      // is worse than no avatar, and that gate is the other reason the palette can be unreachable. Asserted
      // on the AVATAR's own label, which is the affordance, rather than on a card that this harness cannot
      // reliably expand.
      const roTree = exports.__ui.SkillReportPanel({ snapshot: { ...paletteSnapshot, capability: { api: 1, writable: false } } })
      ok('[17f] a read-only host renders no avatar button',
        findAllHost(roTree, (n) => n.type === 'button' && String(n.props?.['aria-label'] ?? '').includes('选择标记颜色')).length === 0)
    }

    /* -- a REJECTED colour write must report, and must not kill the palette -- */
    //
    // This is the assertion that would have caught the reported bug. `api.post` NEVER THROWS — it resolves to
    // `{ok:false, error}` — so a caller that only chains `.then()` treats a refusal as a success: the palette
    // closed as though the colour had saved, said nothing, and its `busy` flag stayed set, leaving every
    // swatch disabled. One failed write made that palette permanently dead, and silently.
    {
      clearToasts()
      const before = calls.length
      // Make the host refuse this one action, the way a host that has never heard of it would.
      failColorOnce = true
      const beforeDone = colourDoneCount
      const picker = exports.__ui.ColorPicker({ name: 'refused-skill', current: '', onDone: () => { colourDoneCount += 1 } })
      const swatch = findAllHost(picker, (n) => n.type === 'button' && String(n.props?.['aria-label'] ?? '').includes('水绿'))[0]
      ok('[17g] the swatch exists to click', swatch !== undefined)
      swatch.props.onClick()
      await tick()
      await tick()
      ok('[17g] the write was attempted', calls.length > before, String(calls.length - before))
      // The palette must not be dismissed as though it had worked.
      ok('[17g] a refused write does NOT report success to the caller', colourDoneCount === beforeDone,
        'onDone fired, so the card closes its palette and the user sees nothing happen')
      // And the failure has to be visible rather than silent.
      const colourToasts = exports.__api.getToasts()
      ok('[17g] ...and the refusal is REPORTED, not swallowed',
        colourToasts.some((t) => t.kind === 'error'),
        JSON.stringify(colourToasts.map((t) => ({ kind: t.kind, message: t.message }))))
      ok('[17g] ...carrying a message the user can act on',
        colourToasts.some((t) => t.kind === 'error' && String(t.message ?? '').length > 0),
        JSON.stringify(colourToasts.map((t) => t.message)))
      // And the swatches must be usable again after a refusal. `busy` has to clear on the FAILURE path.
      //
      // Asserted against the artifact's SOURCE rather than by re-rendering, and deliberately. This harness's
      // `useState` is a no-op setter, so `busy` can never become true here and a re-render would report
      // "not disabled" under the BROKEN code as well — an assertion that passes either way is not evidence.
      // The load-bearing fact is that the clear sits on `.finally`, which runs whether the write resolved or
      // was refused; a chained `.then` does not run at all once the chain above it rejects, which is what
      // left the palette permanently dead after one failure.
      //
      // Scoped to the palette's own slice of the artifact. A whole-file `includes` was the first version and
      // it failed on the FIXED code, because four other call sites match the same text — which is how the
      // same defect was then found in `install.js`.
      const pickerSource = source.slice(source.indexOf('function ColorPicker'), source.indexOf('function ColorPicker') + 2200)
      ok('[17g] the palette clears its busy flag on EVERY path, not only on success',
        pickerSource.includes('.finally(() => setBusy(false))') && !pickerSource.includes('.then(() => setBusy(false))'),
        'a `.then` after the request never runs when the write is refused, so every swatch stays disabled')
      failColorOnce = false
      clearToasts()
    }

    /* -- a NEEDS_CONFIRM reply is surfaced, not swallowed -- */
    clearToasts()
    needsConfirmOnce = true
    const confirmResult = await exports.__api.performWrite({ action: 'uninstall', name: 'x' })
    const pending = exports.__api.getToasts()
    ok('[17b] a NEEDS_CONFIRM reply is not reported as success', confirmResult.ok === false && confirmResult.error.code === 'NEEDS_CONFIRM')
    ok('[17b] ...it becomes an error toast', pending.some((t) => t.kind === 'error' && t.code === 'NEEDS_CONFIRM'), JSON.stringify(pending))
    ok('[17b] the hint travels with it', textOf(StatusRail({ toasts: pending, onDismiss: exports.__api.dismissToast })).includes('confirm:true'))
    clearToasts()

    /* -- install from pasted text -- */
    const SKILL_MD = '---\nname: fresh-skill\ndescription: \u65b0\u88c5\u7684 skill\n---\n\n# fresh-skill\n'
    let publishedCatalog = null
    await withMount(InstallSheet, { open: true, capability: CAP_FULL, initialMode: 'text', onClose: () => {} }, async (view) => {
      const before = calls.filter((c) => c.body?.action === 'install').length
      view.setProps({ text: SKILL_MD })
      ok('[17c] typing enables the primary action', view.byText('\u5b89\u88c5').props.disabled === false)
      // The Chinese display name is a plain input the user types into, so drive it
      // through its own onChange — the same path a keystroke takes.
      const zhField = view.findAll((n) => n.props?.id === 'sr-install-display-zh')[0]
      ok('[17c] the Chinese name field is present', zhField !== undefined)
      zhField.props.onChange({ target: { value: '  \u65b0\u540d\u5b57  ' } })
      ok('[17c] it shows a character counter', view.text().includes('/ 40'), view.text().slice(0, 120))
      ok('[17c] the counter follows the text', view.text().includes(String(SKILL_MD.length)), view.text().slice(0, 120))
      view.click(view.byText('\u9884\u89c8'))
      await tick()
      const previewCall = calls[calls.length - 1]
      ok('[17c] preview posts a preview body', previewCall.body.action === 'preview' && previewCall.body.mode === 'text')
      ok('[17c] the preview renders the parsed name', view.text().includes('fresh-skill'))
      ok('[17c] the preview reports the file count', view.text().includes('\u6587\u4ef6 2 \u4e2a'))
      view.click(view.byText('\u5b89\u88c5'))
      await tick()
      const installCall = calls.filter((c) => c.body?.action === 'install').pop()
      ok('[17c] install posts the text and mode', installCall.body.mode === 'text' && installCall.body.text === SKILL_MD)
      ok('[17c] install carries the Chinese display name, trimmed', installCall.body.displayNameZh === '\u65b0\u540d\u5b57', JSON.stringify(installCall.body.displayNameZh))
      ok('[17c] install sends JSON content-type', installCall.headers['content-type'] === 'application/json')
      ok('[17c] the write is reported as success', exports.__api.getToasts().some((t) => t.kind === 'ok' && t.message.includes('fresh-skill')), JSON.stringify(exports.__api.getToasts()))
      ok('[17c] the store is flipped back to ready by the write', exports.__source.getSnapshot().phase === 'ready')
      publishedCatalog = exports.__source.getSnapshot().data
      ok('[17c] the new skill is in the published snapshot', (publishedCatalog.skills ?? []).some((s) => s.name === 'fresh-skill'), JSON.stringify((publishedCatalog.skills ?? []).map((s) => s.name)))
      ok('[17c] the sheet clears its textarea after success', !view.text().includes('fresh-skill\n\n#'))
      ok('[17c] installs went out exactly once more', calls.filter((c) => c.body?.action === 'install').length === before + 1)
    })

    /* -- a write response must not wipe every skill's colour and provenance -- */
    //
    // THE bug behind "颜色标签点了没反应", and it was never only about colour.
    //
    // Every write answers with the host's on-disk `skills` array — name, size, timestamp, `disabled` — which
    // carries NO provenance. `applySkills` adopted that array WHOLESALE, so after any write the client's
    // catalogue was one in which no skill had a colour or a recorded source, and every card lost its marking
    // until the next poll put them back, up to five seconds later. Assigning a colour was merely the most
    // visible way to see it: a toggle, a rename or a delete wiped the same information.
    {
      const row = (name, extra = {}) => ({ name, dir: `C:\\skills\\${name}`, hasSkillMd: true, disabled: false, bytes: 10, modifiedAt: 1, ...extra })
      const coloured = [
        row('marked', { provenance: { known: true, source: 'git', color: 'teal', changedSinceInstall: false } }),
        row('plain', { provenance: { known: false, source: '', color: '', changedSinceInstall: false } }),
      ]
      exports.__source.applySkills(coloured, CAP_FULL)
      ok('[17h] the coloured row is in the published catalogue',
        exports.__source.getSnapshot().data.skills.find((s) => s.name === 'marked')?.provenance?.color === 'teal')

      // A write response, exactly as the host builds it: provenance is absent entirely.
      exports.__source.applySkills([row('marked'), row('plain', { disabled: true })], CAP_FULL)
      const after = exports.__source.getSnapshot().data.skills
      ok('[17h] a write response does NOT wipe the colour',
        after.find((s) => s.name === 'marked')?.provenance?.color === 'teal',
        JSON.stringify(after.find((s) => s.name === 'marked')))
      ok('[17h] ...nor the rest of the provenance, so the source line survives too',
        after.find((s) => s.name === 'marked')?.provenance?.source === 'git',
        JSON.stringify(after.find((s) => s.name === 'marked')?.provenance))
      // ...while a field the response DOES carry still wins, or the write's own effect would be lost.
      ok('[17h] ...but the write\'s own change still lands',
        after.find((s) => s.name === 'plain')?.disabled === true,
        JSON.stringify(after.find((s) => s.name === 'plain')))
      ok('[17h] a skill the client had never seen is taken as-is',
        exports.__source.getSnapshot().data.skills.length === 2)
    }
    {
      // The list must not wait for the next poll: render the panel straight from
      // the store's snapshot, with only the section state forced open.
      const published = withExpanded(() => textOf(exports.__ui.SkillReportPanel({ snapshot: publishedCatalog, onRefresh: () => {} })))
      ok('[17c] the response republishes the catalog immediately', published.includes('fresh-skill'), published.slice(0, 200))
    }
    clearToasts()

    /* -- NAME_TAKEN offers the overwrite checkbox -- */
    nameTakenOnce = true
    await withMount(InstallSheet, { open: true, capability: CAP_FULL, onClose: () => {} }, async (view) => {
      view.setProps({ text: SKILL_MD, mode: 'text' })
      view.click(view.byText('\u5b89\u88c5'))
      await tick()
      ok('[17d] NAME_TAKEN renders the host message', view.text().includes('\u540c\u540d skill \u5df2\u5b58\u5728'))
      ok('[17d] ...and the host hint', view.text().includes('overwrite:true'))
      ok('[17d] ...and offers the overwrite toggle', view.text().includes('\u8986\u76d6\u540c\u540d skill'))
      ok('[17d] the failure is also in the rail', exports.__api.getToasts().some((t) => t.kind === 'error' && t.code === 'NAME_TAKEN'))
      const box = view.findAll((n) => n.type === 'input' && n.props?.type === 'checkbox')[0]
      ok('[17d] the overwrite box starts unchecked', box?.props?.checked === false)
      box?.props?.onChange?.({ target: { checked: true } })
      const after = view.findAll((n) => n.type === 'input' && n.props?.type === 'checkbox')[0]
      ok('[17d] ticking it is acknowledged (controlled)', after?.props?.checked === true)
      view.click(view.byText('\u5b89\u88c5'))
      await tick()
      const retry = calls.filter((c) => c.body?.action === 'install').pop()
      ok('[17d] the retry carries overwrite:true', retry.body.overwrite === true, JSON.stringify(retry.body))
      ok('[17d] the retry succeeds', exports.__api.getToasts().some((t) => t.kind === 'ok'))
    })
    clearToasts()

    /* -- INVALID_NAME offers a one-click slug fix -- */
    invalidNameOnce = true
    await withMount(InstallSheet, { open: true, capability: CAP_FULL, onClose: () => {} }, async (view) => {
      view.setProps({ text: SKILL_MD, mode: 'text' })
      view.click(view.byText('\u5b89\u88c5'))
      await tick()
      ok('[17e] INVALID_NAME renders the host message', view.text().includes('\u540d\u79f0\u4e0d\u5408\u6cd5'))
      const fix = view.byText('\u6539\u7528 my-skill')
      ok('[17e] ...and a one-click suggested slug', fix !== undefined)
      view.click(fix)
      ok('[17e] clicking it fills the name field', view.findAll((n) => n.type === 'input' && n.props?.id === 'sr-install-name')[0].props.value === 'my-skill', JSON.stringify(view.findAll((n) => n.type === 'input' && n.props?.id === 'sr-install-name')[0]?.props?.value))
      ok('[17e] ...and clears the error', !view.text().includes('\u540d\u79f0\u4e0d\u5408\u6cd5'))
    })
    clearToasts()

    /* -- an oversized file is refused client-side -- */
    await withMount(InstallSheet, { open: true, capability: CAP_FULL, onClose: () => {} }, async (view) => {
      const beforeOversize = calls.length
      view.setProps({ mode: 'file' })
      const drop = view.findAll((n) => String(n.props?.className ?? '').includes('sr-drop'))[0]
      drop.props.onDrop({ preventDefault: () => {}, dataTransfer: { files: [{ name: 'big.zip', size: 9 * 1024 * 1024 }] } })
      ok('[17f] an oversized file is refused before any request', view.text().includes('\u8d85\u8fc7\u4e0a\u9650'), view.text().slice(-200))
      ok('[17f] the real size is shown', view.text().includes('9.0 MB'))
      ok('[17f] nothing was posted', calls.length === beforeOversize)
    })
    clearToasts()

    /* -- the strip's install button opens the sheet -- */
    await withMount(exports.__ui.SkillReportStrip, { state: { phase: 'ready', data: { ...HOST_SNAPSHOT, capability: CAP_FULL }, error: null, fetchedAt: Date.now() }, onRefresh: () => {} }, async (view) => {
      ok('[17g] the sheet starts closed', view.findAll((n) => n.props?.role === 'dialog').length === 0)
      view.click(view.byLabel('\u5b89\u88c5 skill'))
      ok('[17g] the strip opens the sheet', view.findAll((n) => n.props?.role === 'dialog').length === 1)
      view.click(view.byLabel('\u5173\u95ed\u5b89\u88c5\u9762\u677f'))
      await new Promise((resolve) => setTimeout(resolve, 220))
      ok('[17g] closing it unmounts the dialog', view.findAll((n) => n.props?.role === 'dialog').length === 0)
    })
    clearToasts()

    /* -- the panel's install button opens the sheet too -- */
    await withMount(exports.__ui.SkillReportPanel, { snapshot: { ...HOST_SNAPSHOT, capability: CAP_FULL }, onRefresh: () => {} }, async (view) => {
      ok('[17h] the panel sheet starts closed', view.findAll((n) => n.props?.role === 'dialog').length === 0)
      view.click(view.byLabel('\u5b89\u88c5 skill'))
      ok('[17h] the panel opens the same sheet', view.findAll((n) => n.props?.role === 'dialog').length === 1)
      ok('[17h] the sheet is reachable from a root-scoped surface', view.findAll((n) => n.props?.className === 'sr-sheet').length === 1)
      ok('[17h] ...and is labelled for assistive tech', view.findAll((n) => n.props?.role === 'dialog')[0]?.props?.['aria-label'] === '\u5b89\u88c5 skill')
    })
    /* -- [18] install, then use it: the sheet's own status area -- */
    {
      let used = null
      await withMount(InstallSheet, { open: true, capability: CAP_FULL, initialMode: 'text', onClose: () => {}, onUse: (name) => { used = name } }, async (view) => {
        view.setProps({ text: SKILL_MD })
        view.click(view.byText('\u5b89\u88c5'))
        await tick()
        ok('[18] a finished install is reported in the sheet', view.text().includes('\u5df2\u5b89\u88c5 fresh-skill'), view.text().slice(-160))
        const insert = view.findAll((n) => n.props?.['data-sr-insert'] !== undefined)[0]
        ok('[18] ...with a one-click insert affordance', insert !== undefined)
        ok('[18] ...carrying the installed name', insert?.props?.['data-sr-insert'] === 'fresh-skill')
        ok('[18] ...and naming the exact token it will write', deepText(insert).includes('/fresh-skill'), deepText(insert))
        view.click(insert)
        // The parent owns the token shape, so the sheet hands over the bare name.
        ok('[18] clicking it hands the bare name to onUse', used === 'fresh-skill', JSON.stringify(used))
      })
      // Without composer access the offer must not appear: the centre panel is
      // root-scoped and can never write the draft, so a button there would lie.
      await withMount(InstallSheet, { open: true, capability: CAP_FULL, initialMode: 'text', onClose: () => {} }, async (view) => {
        view.setProps({ text: SKILL_MD })
        view.click(view.byText('\u5b89\u88c5'))
        await tick()
        ok('[18] the same install is still reported without composer access', view.text().includes('\u5df2\u5b89\u88c5 fresh-skill'))
        ok('[18] ...but no insert button is offered', view.findAll((n) => n.props?.['data-sr-insert'] !== undefined).length === 0)
      })
      // End to end through the real composer seat: this is the surface whose
      // `onUse` owns the token shape, so it is the only place the exact `/name `
      // contract can be observed.
      let draft = 'hello '
      let draftWritten = null
      await withMount(
        bySlot['conversation.input.dock'].component,
        {
          inputActions: { setDraft: (value) => { draftWritten = value } },
          useInput: (selector) => (typeof selector === 'function' ? selector({ draft }) : { draft }),
        },
        async (view) => {
          view.click(view.byLabel('\u5b89\u88c5 skill'))
          ok('[18] the composer seat can open the sheet while composing', view.findAll((n) => n.props?.role === 'dialog').length === 1)
          const textTab = view.findAll((n) => n.props?.role === 'tab').find((tab) => deepText(tab).includes('SKILL.md'))
          view.click(textTab)
          const area = view.findAll((n) => n.type === 'textarea')[0]
          ok('[18] the sheet reaches the text tab from the strip', area !== undefined)
          area?.props?.onChange?.({ target: { value: SKILL_MD } })
          view.click(view.byText('\u5b89\u88c5'))
          await tick()
          const insert = view.findAll((n) => n.props?.['data-sr-insert'] !== undefined)[0]
          ok('[18] the composer seat sees the insert affordance', insert !== undefined, view.text().slice(-200))
          view.click(insert)
          ok('[18] inserting writes exactly /name with a trailing space', draftWritten === 'hello /fresh-skill ', JSON.stringify(draftWritten))
        },
      )
      clearToasts()
    }

    /* -- [19] one guidance block instead of three empty placeholders -- */
    {
      const bare = { turns: 0, turnsWithSkills: 0, turnsWithoutSkills: 0, invocations: 0, perSkill: [], recent: [], skills: [], capability: CAP_FULL, installHistory: [] }
      const bareText = textOf(exports.__ui.SkillReportPanel({ snapshot: bare }))
      ok('[19] a brand-new panel explains itself in one block', bareText.includes('\u8fd8\u6ca1\u6709\u53ef\u62a5\u544a\u7684\u5185\u5bb9'), bareText.slice(0, 160))
      ok('[19] ...and no longer shows the three placeholders together',
        !bareText.includes('\u53d1\u4e00\u6761\u6d88\u606f') && !bareText.includes('\u4e3b\u673a\u4fa7\u6ca1\u6709\u4e0a\u62a5 skill'),
        bareText.slice(0, 200))
      ok('[19] it offers the action that changes the situation', exactButton(exports.__ui.SkillReportPanel({ snapshot: bare }), '\u5b89\u88c5 skill') !== undefined)
      // A writable-but-disabled host gets the explanation without the button.
      const offText = textOf(exports.__ui.SkillReportPanel({ snapshot: { ...bare, capability: CAP_OFF } }))
      ok('[19] a read-only host gets the sentence and no button', offText.includes('\u8fd8\u6ca1\u6709\u53ef\u62a5\u544a\u7684\u5185\u5bb9') && exactButton(exports.__ui.SkillReportPanel({ snapshot: { ...bare, capability: CAP_OFF } }), '\u5b89\u88c5 skill') === undefined)
      // Skills but no turns is NOT the bare case: the catalogue must still show.
      const withSkills = { ...bare, skills: HOST_SKILLS }
      const skillsText = withExpanded(() => textOf(exports.__ui.SkillReportPanel({ snapshot: withSkills })))
      ok('[19] an empty history with skills installed keeps the catalogue', !skillsText.includes('\u8fd8\u6ca1\u6709\u53ef\u62a5\u544a\u7684\u5185\u5bb9') && skillsText.includes('manual-only-skill'), skillsText.slice(0, 200))
      ok('[19] ...and still explains the empty sections', textOf(exports.__ui.SkillReportPanel({ snapshot: withSkills })).includes('\u6682\u65e0'))
    }

    /* -- [20] "used nothing" is its own calm signal -- */
    {
      const noSkill = {
        turns: 2,
        turnsWithSkills: 1,
        turnsWithoutSkills: 1,
        invocations: 1,
        perSkill: [{ name: 'gpt-image', count: 1 }],
        skills: HOST_SKILLS,
        capability: CAP_FULL,
        installHistory: [],
        recent: [
          { at: 1_700_000_200_000, sessionId: 's1', sessionTitle: 'x', reason: 'completed', calls: [] },
          { at: 1_700_000_100_000, sessionId: 's1', sessionTitle: 'x', reason: 'completed', calls: [{ name: 'gpt-image', how: 'model' }] },
        ],
      }
      const tree = exports.__ui.SkillReportPanel({ snapshot: noSkill })
      const hero = findAllHost(tree, (n) => String(n.props?.className ?? '').includes('sr-badge--none'))[0]
      ok('[20] the hero carries the dedicated no-skill chip', hero !== undefined)
      ok('[20] ...whose text is the short form', deepText(hero).includes('\u672a\u4f7f\u7528'), deepText(hero))
      ok('[20] ...and it never borrows the error colour', !String(hero?.props?.className ?? '').includes('danger'))
      const chip = findAllHost(tree, (n) => String(n.props?.className ?? '').includes('sr-age--none'))
      ok('[20] the turn rail marks it the same way', chip.length > 0, String(chip.length))
      // The strip's dot. It used to have THREE states — warn when a turn used no skill, accent when it
      // did, neutral when there was nothing to report — and the user asked for green instead.
      //
      // Both "used nothing" and "used something" are now GREEN, because that distinction is already
      // made by the four counter chips sitting on the same bar, and the dot was repeating it in a
      // colour that reads as a warning. What the dot still distinguishes is HEALTH: whether the host
      // answered at all. So the assertion changed from "three colours" to "green when the host
      // answered, red when it did not, neutral when there is nothing yet" — which is the signal that
      // is left, and the only one worth a colour.
      const stripTree = exports.__ui.SkillReportStrip({ state: { phase: 'ready', data: noSkill, error: null, fetchedAt: Date.now() } })
      const dot = findAllHost(stripTree, (n) => String(n.props?.className ?? '') === 'sr-strip-dot')[0]
      ok('[20] a healthy host gets the green dot', dot?.props?.style?.background === 'var(--sr-ok)', String(dot?.props?.style?.background))
      const usedTree = exports.__ui.SkillReportStrip({ state: { phase: 'ready', data: HOST_SNAPSHOT, error: null, fetchedAt: Date.now() } })
      const usedDot = findAllHost(usedTree, (n) => String(n.props?.className ?? '') === 'sr-strip-dot')[0]
      ok('[20] ...the same green whether or not a skill was used', usedDot?.props?.style?.background === 'var(--sr-ok)', String(usedDot?.props?.style?.background))
      // No finished turn at all is a third, neutral state — not the same signal.
      const noneTree = exports.__ui.SkillReportStrip({ state: { phase: 'ready', data: { ...HOST_SNAPSHOT, recent: [] }, error: null, fetchedAt: Date.now() } })
      const noneDot = findAllHost(noneTree, (n) => String(n.props?.className ?? '') === 'sr-strip-dot')[0]
      ok('[20] nothing reported yet stays neutral', noneDot?.props?.style?.background === 'var(--sr-fg3)', String(noneDot?.props?.style?.background))
      // And the one case that MUST stay red: an unreachable host. Turning that green would remove the
      // only signal that the numbers on screen are stale.
      const failTree = exports.__ui.SkillReportStrip({ state: { phase: 'error', data: HOST_SNAPSHOT, error: 'boom', fetchedAt: Date.now() } })
      const failDot = findAllHost(failTree, (n) => String(n.props?.className ?? '') === 'sr-strip-dot')[0]
      ok('[20] an unreachable host is still red', failDot?.props?.style?.background === 'var(--sr-danger)', String(failDot?.props?.style?.background))
    }

    /* -- [21] usage counts on the cards, and the 用过的 filter -- */
    {
      // `HOST_SKILLS` is reassigned by the write tests above, so this block works
      // from the snapshot's own catalog — a fixture, not shared mutable state.
      const catalog = HOST_SNAPSHOT.skills
      const counts = exports.__ui.countMap(HOST_SNAPSHOT.perSkill)
      ok('[21] the host totals are joined by name', counts['gpt-image'] === 3 && counts['h3-prompt-writing'] === 2, JSON.stringify(counts))
      ok('[21] only invoked skills are counted', exports.__ui.usedSkillCount(catalog, counts) === 2, String(exports.__ui.usedSkillCount(catalog, counts)))
      ok('[21] a catalog with no usage counts none', exports.__ui.usedSkillCount(catalog, {}) === 0)
      const filtered = exports.__ui.filterSkills(catalog, { onlyUsed: true, counts })
      ok('[21] the 用过的 filter keeps invoked skills only', filtered.length === 2 && filtered.every((s) => counts[s.name] > 0), JSON.stringify(filtered.map((s) => s.name)))
      ok('[21] ...and composes with the other filters', exports.__ui.filterSkills(catalog, { onlyUsed: true, counts, query: 'h3' }).length === 1)
      ok('[21] the filter is inert when nothing was used', exports.__ui.filterSkills(catalog, { onlyUsed: true, counts: {} }).length === 0)

      const snapshot = { ...HOST_SNAPSHOT, skills: catalog }
      // The walk must happen INSIDE withExpanded: `findAllHost` invokes function
      // components, so running it outside the patch window closes every section.
      const cards = withExpanded(() => textOf(exports.__ui.SkillReportPanel({ snapshot })))
      ok('[21] an invoked skill shows its total on the card', cards.includes('\u7528\u8fc7 3 \u6b21'))
      // The count used to be an `sr-tag--used` pill in the card's tag row. That row is GONE: it
      // was the one element in the card whose flex sizing could not be made to behave (three
      // attempts, and it still rendered as 60px clipped blobs), so its contents moved onto the
      // source line — where a count reads as a clause about the skill rather than a floating
      // chip. The assertion follows the element instead of the old class name.
      // Matched on the class LIST containing `sr-src` as a whole member — `\bsr-src\b` also
      // matches `sr-src-text`, which is the inner span, so every row counted twice.
      const marked = withExpanded(() =>
        findAllHost(exports.__ui.SkillReportPanel({ snapshot }), (n) => String(n.props?.className ?? '').split(/\s+/u).includes('sr-src') && deepText(n).includes('\u7528\u8fc7')),
      )
      ok('[21] ...on the source line, not as a floating tag', marked.length === 2,
        `${marked.length} matched: ${JSON.stringify(marked.map((n) => String(n.props?.className ?? '')))}`)
      ok('[21] ...and the old tag row is gone from every card',
        withExpanded(() => findAllHost(exports.__ui.SkillReportPanel({ snapshot }), (n) => String(n.props?.className ?? '').includes('sr-skill-tags'))).length === 0)
      ok('[21] the 用过的 chip is offered once something was used', cards.includes('\u7528\u8fc7\u7684'))
      const chip = withExpanded(() => findAllHost(exports.__ui.SkillReportPanel({ snapshot }), (n) => n.type === 'button' && deepText(n).includes('\u7528\u8fc7\u7684')))
      ok('[21] ...and counted', chip.length === 1 && deepText(chip[0]).includes('2'), JSON.stringify(chip.map(deepText)))
      ok('[21] ...and it is a real toggle', chip[0]?.props?.['aria-pressed'] === false && typeof chip[0]?.props?.onClick === 'function')
      const noUse = withExpanded(() => textOf(exports.__ui.SkillReportPanel({ snapshot: { ...snapshot, perSkill: [] } })))
      ok('[21] a never-used catalog offers no such filter', !noUse.includes('\u7528\u8fc7\u7684'))
    }

    /* -- [22] the reading position survives the unmount -- */
    {
      ok('[22] clamping keeps a sane offset', exports.__ui.clampScroll(120, 1000, 400) === 120)
      ok('[22] clamping bounds an offset past the end', exports.__ui.clampScroll(99999, 1000, 400) === 600, String(exports.__ui.clampScroll(99999, 1000, 400)))
      ok('[22] clamping rejects a negative or garbage offset', exports.__ui.clampScroll(-5, 1000, 400) === 0 && exports.__ui.clampScroll(Number.NaN, 1000, 400) === 0)
      ok('[22] clamping a non-scrollable node yields zero', exports.__ui.clampScroll(300, 200, 400) === 0)

      // A minimal DOM + storage stand-in: the persistence path is guarded by
      // `typeof document`, so nothing is written in plain Node.
      const store = new Map()
      const realDocument = globalThis.document
      const realLocalStorage = globalThis.localStorage
      const reads = []
      globalThis.document = { addEventListener: () => {}, removeEventListener: () => {}, querySelector: () => null, body: { style: {} } }
      globalThis.localStorage = {
        getItem: (k) => {
          reads.push(k)
          return store.has(k) ? store.get(k) : null
        },
        setItem: (k, v) => store.set(k, v),
      }
      try {
        store.set('echocat-skill-panel/scroll', JSON.stringify({ 'itest-surface': 77 }))
        await withMount(exports.__ui.SkillReportPanel, { snapshot: { ...HOST_SNAPSHOT, capability: CAP_FULL }, onRefresh: () => {}, scrollKey: 'itest-surface' }, async (view) => {
          ok('[22] the surface asks the store for its remembered offset', reads.includes('echocat-skill-panel/scroll'), JSON.stringify(reads))
          const root = view.findAll((n) => String(n.props?.className ?? '').includes('sr-root'))[0]
          ok('[22] the scrolling element is wired to the handler', typeof root?.props?.onScroll === 'function')
          root.props.onScroll({ currentTarget: { scrollTop: 240, clientHeight: 400, scrollHeight: 3000 } })
          const saved = JSON.parse(store.get('echocat-skill-panel/scroll') ?? '{}')
          ok('[22] scrolling is remembered', saved['itest-surface'] === 240, JSON.stringify(saved))
          // A second event must not disturb anything else in the same record.
          root.props.onScroll({ currentTarget: { scrollTop: 260, clientHeight: 400, scrollHeight: 3000 } })
          ok('[22] the newest offset wins', JSON.parse(store.get('echocat-skill-panel/scroll'))['itest-surface'] === 260, store.get('echocat-skill-panel/scroll'))
        })
        // The strip's transient panel opts out entirely.
        const before = store.get('echocat-skill-panel/scroll')
        await withMount(exports.__ui.SkillReportPanel, { snapshot: { ...HOST_SNAPSHOT, capability: CAP_FULL }, onRefresh: () => {}, scrollKey: null }, async (view) => {
          const root = view.findAll((n) => String(n.props?.className ?? '').includes('sr-root'))[0]
          root.props.onScroll({ currentTarget: { scrollTop: 999, clientHeight: 400, scrollHeight: 3000 } })
          ok('[22] a surface that opts out writes nothing', store.get('echocat-skill-panel/scroll') === before, String(store.get('echocat-skill-panel/scroll')))
        })
      } finally {
        if (realDocument === undefined) delete globalThis.document
        else globalThis.document = realDocument
        if (realLocalStorage === undefined) delete globalThis.localStorage
        else globalThis.localStorage = realLocalStorage
      }
    }
    /* -- 45: the card's display name, and editing it in place -- */
    console.log('\n[23] the card is titled by the display name and can rename it')
    {
      const ZH = '\u7535\u5f71\u611f\u56fe\u50cf\u6307\u5357'
      const NEW_ZH = '\u65b0\u4e2d\u6587\u540d'
      const snapshot = {
        ...HOST_SNAPSHOT,
        capability: CAP_FULL,
        skills: [
          { name: 'zh-demo', description: 'plain english blurb', displayNameZh: ZH, tag: '', modelInvocable: true },
          { name: 'plain-demo', description: 'no chinese name on this one', tag: '', modelInvocable: true },
        ],
      }
      // The catalogue is a collapsed Section by default, and `withExpanded` cannot
      // reach inside a `withMount` render (its probe needs the direct-call path), so
      // the open state is seeded through the store `useSection` actually reads.
      const store = new Map()
      const realDocument = globalThis.document
      const realLocalStorage = globalThis.localStorage
      globalThis.document = { addEventListener: () => {}, removeEventListener: () => {}, querySelector: () => null, body: { style: {} } }
      globalThis.localStorage = {
        getItem: (key) => (store.has(key) ? store.get(key) : null),
        setItem: (key, value) => store.set(key, value),
      }
      try {
        store.set('echocat-skill-panel/sections', JSON.stringify({ skills: true }))
        await withMount(exports.__ui.SkillReportPanel, { snapshot, onRefresh: () => {} }, async (view) => {
          const text = view.text()
          ok('[23] a skill with a Chinese name is titled by it', text.includes(ZH), text.slice(0, 200))
          // The slug is the identity and what `/name` types, so it must stay readable.
          ok('[23] ...and its slug stays visible underneath', text.includes('/zh-demo'), text.slice(0, 200))
          ok('[23] a skill without one is titled by the slug', text.includes('plain-demo'))
          ok('[23] ...and gets no slug line of its own', !text.includes('/plain-demo'))

          const open = view.byText('\u6539\u4e2d\u6587\u540d')
          ok('[23] the card offers an edit affordance', open !== undefined)
          view.click(open)
          const input = view.findAll((n) => n.type === 'input' && String(n.props?.className ?? '').includes('sr-rename-input'))[0]
          ok('[23] opening it renders an input', input !== undefined)
          ok('[23] ...pre-filled with the current display name', input?.props?.value === ZH, String(input?.props?.value))
          ok('[23] ...with the 40-character budget shown', view.text().includes('7 / 40'), view.text().slice(0, 200))

          // Saving posts exactly the documented triple.
          const beforeSave = calls.length
          input.props.onChange({ target: { value: NEW_ZH } })
          view.click(view.byText('\u4fdd\u5b58'))
          await tick()
          const renameCall = calls.slice(beforeSave).find((call) => call.body?.action === 'rename')
          ok('[23] saving posts a rename request', renameCall !== undefined, JSON.stringify(calls.slice(beforeSave).map((call) => call.body)))
          ok(
            '[23] ...carrying exactly action / name / displayNameZh',
            renameCall !== undefined && Object.keys(renameCall.body).sort().join(',') === 'action,displayNameZh,name',
            JSON.stringify(renameCall?.body),
          )
          ok(
            '[23] ...with the typed value against the slug',
            renameCall?.body?.displayNameZh === NEW_ZH && renameCall?.body?.name === 'zh-demo',
            JSON.stringify(renameCall?.body),
          )

          // Clearing: an empty value must still be SENT (the host removes the key).
          view.click(view.byText('\u6539\u4e2d\u6587\u540d'))
          const cleared = view.findAll((n) => n.type === 'input' && String(n.props?.className ?? '').includes('sr-rename-input'))[0]
          const beforeClear = calls.length
          cleared.props.onChange({ target: { value: '' } })
          view.click(view.byText('\u4fdd\u5b58'))
          await tick()
          const clearCall = calls.slice(beforeClear).find((call) => call.body?.action === 'rename')
          ok('[23] clearing posts an empty value rather than nothing', clearCall !== undefined && clearCall.body.displayNameZh === '', JSON.stringify(clearCall?.body))

          // Over-long is refused locally: no request, and the reason is on screen.
          view.click(view.byText('\u6539\u4e2d\u6587\u540d'))
          const tooLong = view.findAll((n) => n.type === 'input' && String(n.props?.className ?? '').includes('sr-rename-input'))[0]
          const beforeRefusal = calls.length
          tooLong.props.onChange({ target: { value: '\u5b57'.repeat(41) } })
          view.click(view.byText('\u4fdd\u5b58'))
          await tick()
          ok('[23] an over-long value is refused', view.text().includes('\u6700\u591a 40 \u4e2a\u5b57'), view.text().slice(0, 240))
          ok('[23] ...without sending a request', calls.length === beforeRefusal, JSON.stringify(calls.slice(beforeRefusal).map((call) => call.body)))
          ok('[23] ...and the editor stays open to be corrected', view.findAll((n) => n.type === 'input' && String(n.props?.className ?? '').includes('sr-rename-input')).length === 1)
        })
      } finally {
        if (realDocument === undefined) delete globalThis.document
        else globalThis.document = realDocument
        if (realLocalStorage === undefined) delete globalThis.localStorage
        else globalThis.localStorage = realLocalStorage
      }
    }

    /* -- 46: provenance on the card, and the update affordance -- */
    console.log('\n[24] the card says where a skill came from and offers to update it')
    {
      const REPO = 'https://github.com/owner/repo.git'
      const verified = { known: true, source: 'git', url: REPO, repo: REPO, ref: 'main', subpath: 'skills/a', commit: 'abc123', claimed: false, changedSinceInstall: false }
      const claimed = { known: true, source: 'git', url: REPO, repo: REPO, ref: '', subpath: '', commit: '', claimed: true, changedSinceInstall: false }
      const pasted = { known: true, source: 'text', url: '', repo: '', ref: '', subpath: '', commit: '', claimed: false, changedSinceInstall: false }
      const none = { known: false, source: '', changedSinceInstall: false }
      const snapshot = {
        ...HOST_SNAPSHOT,
        capability: CAP_FULL,
        skills: [
          { name: 'git-skill', description: 'from a repo', tag: '', modelInvocable: true, provenance: verified },
          { name: 'claimed-skill', description: 'address typed by hand', tag: '', modelInvocable: true, provenance: claimed },
          { name: 'pasted-skill', description: 'pasted body', tag: '', modelInvocable: true, provenance: pasted },
          { name: 'hand-skill', description: 'no record at all', tag: '', modelInvocable: true, provenance: none },
        ],
      }
      const store = new Map()
      const realDocument = globalThis.document
      const realLocalStorage = globalThis.localStorage
      globalThis.document = { addEventListener: () => {}, removeEventListener: () => {}, querySelector: () => null, body: { style: {} } }
      globalThis.localStorage = {
        getItem: (key) => (store.has(key) ? store.get(key) : null),
        setItem: (key, value) => store.set(key, value),
      }
      try {
        store.set('echocat-skill-panel/sections', JSON.stringify({ skills: true }))
        await withMount(exports.__ui.SkillReportPanel, { snapshot, onRefresh: () => {} }, async (view) => {
          const text = view.text()
          // The label is the SHORT form: a card is ~200px and a clone URL is 60 chars.
          ok('[24] a git-backed skill names its repository', text.includes('owner/repo'), text.slice(0, 300))
          // Every provenance line now NAMES ITS FIELD — "来源：owner/repo" — instead of running a bare label
          // together with an optional 标记来源 prefix.
          //
          // The prefix was the confusing part: it reads as a VERDICT that the source was asserted, when it is
          // really a note that the USER typed the address. The owner asked for the plain form ("标记来源改为只要
          // 来源：xxx就行"). Whether the claim is user-supplied still rides in the `title`, where the full
          // address already lived, so nothing is hidden — it is only out of the way of a ~200px card.
          ok('[24] the source line names its field', text.includes('\u6765\u6e90\uff1a'), text.slice(0, 300))
          ok('[24] ...and the old 标记来源 verdict prefix is gone', !text.includes('\u6807\u8bb0\u6765\u6e90'), text.slice(0, 300))
          ok('[24] a pasted skill is labelled by kind', text.includes('\u7c98\u8d34\u5185\u5bb9'), text.slice(0, 300))

          const updateButtons = view.findAll((n) => n.type === 'button' && String(n.props?.['aria-label'] ?? '').startsWith('\u66f4\u65b0'))
          ok('[24] only a verified source offers an update', updateButtons.length === 1, JSON.stringify(updateButtons.map((n) => n.props['aria-label'])))
          ok('[24] ...and it is named after the skill', updateButtons[0]?.props?.['aria-label'] === '\u66f4\u65b0 git-skill', updateButtons[0]?.props?.['aria-label'])

          // Update is a two-step, exactly like delete: the first click only arms.
          const before = calls.length
          view.click(updateButtons[0])
          ok('[24] the first click only arms the update', calls.length === before, JSON.stringify(calls.slice(before).map((c) => c.body)))
          ok('[24] arming says what will happen', view.text().includes('\u518d\u70b9\u4e00\u6b21\u5373\u66f4\u65b0'), view.text().slice(0, 300))
          const armed = view.findAll((n) => n.type === 'button' && String(n.props?.['aria-label'] ?? '').startsWith('\u786e\u8ba4\u66f4\u65b0'))[0]
          ok('[24] the armed button asks for confirmation', armed !== undefined)
          view.click(armed)
          await tick()
          const updateCall = calls.slice(before).find((call) => call.body?.action === 'update')
          ok('[24] the second click posts the update', updateCall !== undefined, JSON.stringify(calls.slice(before).map((c) => c.body)))
          ok('[24] ...carrying the skill name', updateCall?.body?.name === 'git-skill', JSON.stringify(updateCall?.body))
          ok('[24] ...and not a confirmation a verified source does not need', updateCall?.body?.confirm === false, JSON.stringify(updateCall?.body))

          // A source with no record offers the claim field instead of an update — two cards are
          // in that state here (pasted, and never recorded at all).
          //
          // Matched on 的来源, which is the CLAIM button's phrase. A bare 标记 also hits the
          // avatar button (「为 X 选择标记颜色」) that the colour feature added, and a matcher
          // that quietly matches more than it means is how an assertion stops testing anything.
          const claimButtons = view.findAll((n) => n.type === 'button' && String(n.props?.['aria-label'] ?? '').includes('\u7684\u6765\u6e90'))
          ok('[24] a skill with no record can have its source recorded', claimButtons.length === 2, JSON.stringify(claimButtons.map((n) => n.props['aria-label'])))
          const claimOne = claimButtons.find((n) => String(n.props?.['aria-label'] ?? '').includes('hand-skill'))
          ok('[24] ...and the button names the skill it records', claimOne !== undefined, JSON.stringify(claimButtons.map((n) => n.props['aria-label'])))
          view.click(claimOne)
          const claimInput = view.findAll((n) => n.type === 'input' && String(n.props?.className ?? '').includes('sr-claim-input'))[0]
          ok('[24] the claim field is revealed in the card', claimInput !== undefined)
          ok('[24] ...and says it writes no files', view.text().includes('\u53ea\u5199\u8bb0\u5f55'), view.text().slice(0, 300))

          const beforeClaim = calls.length
          view.click(view.byText('\u8bb0\u5f55'))
          await tick()
          ok('[24] an empty address is refused locally', calls.length === beforeClaim, JSON.stringify(calls.slice(beforeClaim).map((c) => c.body)))
          ok('[24] ...with the reason on screen', view.text().includes('\u8bf7\u7c98\u8d34'), view.text().slice(0, 300))

          claimInput.props.onChange({ target: { value: REPO } })
          const beforeFilled = calls.length
          view.click(view.byText('\u8bb0\u5f55'))
          await tick()
          const claimCall = calls.slice(beforeFilled).find((call) => call.body?.action === 'claim')
          ok('[24] a filled address posts the claim', claimCall !== undefined, JSON.stringify(calls.slice(beforeFilled).map((c) => c.body)))
          ok('[24] ...carrying exactly action / name / input', claimCall !== undefined && Object.keys(claimCall.body).sort().join(',') === 'action,input,name', JSON.stringify(claimCall?.body))

          const checkButton = view.findAll((n) => n.type === 'button' && n.props?.['aria-label'] === '\u68c0\u67e5 skill \u66f4\u65b0')[0]
          ok('[24] the catalogue offers a check button', checkButton !== undefined)
          const beforeCheck = calls.length
          view.click(checkButton)
          await tick()
          const checkCall = calls.slice(beforeCheck).find((call) => call.body?.action === 'check')
          ok('[24] the check button posts a catalogue-wide check', checkCall !== undefined && checkCall.body.name === undefined, JSON.stringify(calls.slice(beforeCheck).map((c) => c.body)))
        })

        // The check resolves after an await and publishes into the MODULE store
        // rather than component state — which is what keeps a torn-down surface from
        // ever being asked to set state. The store is part of the bundle's test seam
        // for exactly this reason.
        const updates = exports.__source.getUpdates()
        ok('[24] the verdicts are published to the module store', Object.keys(updates.results).length > 0, JSON.stringify(updates))
        ok('[24] ...every verdict settled', Object.values(updates.results).every((entry) => entry.phase === 'done'), JSON.stringify(updates))
        ok('[24] ...with nothing left in flight', updates.checking === false, JSON.stringify(updates))

        // A verdict that DOES report a newer revision has to reach the card: the
        // badge and the button both come from that one field. `check` answers per
        // skill, so the stub needs the skill in its catalogue first.
        behindOnce = 'git-skill'
        HOST_SKILLS = [...HOST_SKILLS, { name: 'git-skill', description: 'from a repo', modelInvocable: true }]
        await withMount(exports.__ui.SkillReportPanel, { snapshot, onRefresh: () => {} }, async (view) => {
          // The mount auto-checks (there is a recorded source), so the verdict lands
          // without the button being pressed.
          await tick()
          await tick()
          // The check publishes into a module store, and this hook runtime renders on
          // demand rather than subscribing to it — so the verdict is read by asking
          // for one more render, which is exactly what a real store notification does.
          view.setProps({})
          const text = view.text()
          ok('[24] a newer revision is reported on the card', text.includes('\u53ef\u66f4\u65b0'), text.slice(0, 300))
          const behindButton = view.findAll((n) => n.type === 'button' && n.props?.['aria-label'] === '\u66f4\u65b0 git-skill')[0]
          ok('[24] ...and the button says so in its title', String(behindButton?.props?.title ?? '').includes('\u65b0\u7248\u672c'), String(behindButton?.props?.title))
          ok('[24] ...while an up-to-date skill keeps the plain label', view.findAll((n) => n.type === 'button' && String(n.props?.['aria-label'] ?? '').startsWith('\u66f4\u65b0')).length === 1, JSON.stringify(view.findAll((n) => n.type === 'button' && String(n.props?.['aria-label'] ?? '').startsWith('\u66f4\u65b0')).map((n) => n.props['aria-label'])))
        })
        behindOnce = ''
        exports.__source.clearUpdates()
        ok('[24] the store can be cleared', Object.keys(exports.__source.getUpdates().results).length === 0)
      } finally {
        behindOnce = ''
        if (realDocument === undefined) delete globalThis.document
        else globalThis.document = realDocument
        if (realLocalStorage === undefined) delete globalThis.localStorage
        else globalThis.localStorage = realLocalStorage
      }
    }

    /* -- 48: the plugin-skill switch must survive being clicked -- */
    console.log('\n[30] plugin-shipped skills hide by default, and the switch can be undone')
    {
      // A REAL mount, because this is the one assertion that cannot be made statically.
      //
      // The arithmetic version of this check — comparing the total against the filtered-out count — passed
      // 508/508 with the BROKEN gate restored, so it proved nothing about the click. The bug was that the chip
      // was gated on how many skills the filter was currently REMOVING, which is zero the instant they are
      // revealed: one click and the control removed itself, with no way back. Only pressing it shows that.
      const mine = { name: 'my-own-skill', description: 'mine', tag: '', modelInvocable: true, location: 'user', provenance: { known: false, source: '', changedSinceInstall: false } }
      const bundled = { name: 'bundled-one', description: 'from a plugin', tag: '', modelInvocable: true, location: 'plugin', layer: 'bundled', provenance: { known: false, source: '', changedSinceInstall: false } }
      const snapshot = { ...HOST_SNAPSHOT, capability: CAP_FULL, skills: [mine, bundled], disabledSkills: [] }
      const store = new Map()
      const realDocument = globalThis.document
      const realLocalStorage = globalThis.localStorage
      globalThis.document = { addEventListener: () => {}, removeEventListener: () => {}, querySelector: () => null, body: { style: {} } }
      globalThis.localStorage = {
        getItem: (key) => (store.has(key) ? store.get(key) : null),
        setItem: (key, value) => store.set(key, value),
      }
      try {
        store.set('echocat-skill-panel/sections', JSON.stringify({ skills: true }))
        const chipIn = (view) =>
          view.findAll((n) => n.type === 'button' && String(n.props?.['aria-label'] ?? '').includes('\u63d2\u4ef6\u81ea\u5e26\u7684 skill'))[0]
        await withMount(exports.__ui.SkillReportPanel, { snapshot, onRefresh: () => {} }, async (view) => {
          ok('[30] a plugin-shipped skill is hidden by default', !view.text().includes('bundled-one'), view.text().slice(0, 220))
          ok('[30] ...while the user\'s own skill is shown', view.text().includes('my-own-skill'))
          const chip = chipIn(view)
          ok('[30] ...with a switch offering to reveal them', chip !== undefined,
            JSON.stringify(view.findAll((n) => n.type === 'button').map((n) => n.props?.['aria-label']).filter(Boolean)))
          if (chip === undefined) return
          ok('[30] ...whose pressed state says they are hidden', chip.props['aria-pressed'] === false, String(chip.props['aria-pressed']))
          view.click(chip)
          ok('[30] clicking it reveals them', view.text().includes('bundled-one'), view.text().slice(0, 220))
          // THE ASSERTION THAT MATTERS — the reported bug is this line failing.
          ok('[30] ...and the switch is STILL THERE, so the change can be undone', chipIn(view) !== undefined,
            'the chip removed itself on the first click: 插件自带开关点一下就消失了')
          const again = chipIn(view)
          if (again === undefined) return
          ok('[30] ...now reading as pressed', again.props['aria-pressed'] === true, String(again.props['aria-pressed']))
          view.click(again)
          ok('[30] clicking again hides them once more', !view.text().includes('bundled-one'), view.text().slice(0, 220))
          ok('[30] ...and it is still there after the second click', chipIn(view) !== undefined)
        })
      } finally {
        if (realDocument === undefined) delete globalThis.document
        else globalThis.document = realDocument
        if (realLocalStorage === undefined) delete globalThis.localStorage
        else globalThis.localStorage = realLocalStorage
      }
    }

    /* -- 47: enable/disable, the catalogue groups, and the claim row -- */
    console.log('\n[26] a skill can be switched off in place, and the catalogue says which is which')
    {
      const enabledSkill = { name: 'live-skill', description: 'the model can load this', tag: '', modelInvocable: true, provenance: { known: true, source: 'git', url: 'https://github.com/o/r.git', repo: 'https://github.com/o/r.git', ref: 'main', commit: 'a'.repeat(40), claimed: false, changedSinceInstall: false } }
      // No provenance record: this is the card that offers 「标记来源」, whose revealed
      // field is the one that used to overflow the card.
      const noSource = { name: 'hand-skill', description: 'dropped in by hand', tag: '', modelInvocable: true, provenance: { known: false, source: '', changedSinceInstall: false } }
      const parked = { name: 'parked-skill', description: '', displayNameZh: '', tag: '', modelInvocable: true, disabled: true, provenance: { known: true, source: 'text', url: '', repo: '', ref: '', subpath: '', commit: '', claimed: false, changedSinceInstall: false } }
      const snapshot = {
        ...HOST_SNAPSHOT,
        capability: CAP_FULL,
        skills: [enabledSkill, noSource],
        disabledSkills: [{ name: parked.name, bytes: 1024, modifiedAt: Date.now() - 86400000, provenance: parked.provenance }],
      }
      const store = new Map()
      const realDocument = globalThis.document
      const realLocalStorage = globalThis.localStorage
      globalThis.document = { addEventListener: () => {}, removeEventListener: () => {}, querySelector: () => null, body: { style: {} } }
      globalThis.localStorage = {
        getItem: (key) => (store.has(key) ? store.get(key) : null),
        setItem: (key, value) => store.set(key, value),
      }
      try {
        store.set('echocat-skill-panel/sections', JSON.stringify({ skills: true }))
        await withMount(exports.__ui.SkillReportPanel, { snapshot, onRefresh: () => {}, onUse: () => {}, onInstall: () => {} }, async (view) => {
          const rendered = view.text()
          ok('[26] the catalogue is split into two groups', rendered.includes('\u5df2\u542f\u7528') && rendered.includes('\u5df2\u505c\u7528'), rendered.slice(0, 300))
          ok('[26] ...each with its own count', view.findAll((n) => n.type === 'div' && String(n.props?.className ?? '') === 'sr-group-head').length === 2)
          ok('[26] ...and a sentence explaining the disabled state', rendered.includes('\u6a21\u578b\u4e0d\u4f1a\u52a0\u8f7d'), rendered.slice(0, 400))
          ok('[26] the parked skill is labelled on its card', rendered.includes('parked-skill') && rendered.includes('\u5df2\u505c\u7528'))

          // The switch itself: a real role=switch with the state in ARIA, and one click
          // per state change — it destroys nothing, so it needs no confirmation.
          const switches = view.findAll((n) => n.type === 'button' && n.props?.role === 'switch')
          ok('[26] every card carries a switch', switches.length === 3, String(switches.length))
          ok('[26] ...whose aria-checked matches the state',
            switches.filter((n) => n.props['aria-checked'] === 'false').length === 1 &&
            switches.filter((n) => n.props['aria-checked'] === 'true').length === 2,
            JSON.stringify(switches.map((n) => n.props['aria-checked'])))
          ok('[26] ...labelled by what it will do, not by the state',
            switches.some((n) => n.props['aria-label'] === '\u505c\u7528 live-skill') &&
            switches.some((n) => n.props['aria-label'] === '\u542f\u7528 parked-skill'),
            JSON.stringify(switches.map((n) => n.props['aria-label'])))
          // The switch belongs to the card's HEAD, on the name's line, not to the footer's action row.
          //
          // It was the first item of `.sr-row-actions`, where it sat among buttons that act ON the skill while
          // it decides whether the model can see the skill at all. The owner asked for it top-right and level
          // with the name ("卡片的开关按钮统一到右上角和名字对齐"), so this pins the ROW it lives in — the thing
          // that was actually requested, and the thing a later refactor could silently undo.
          const headSwitches = view.findAll((n) => String(n.props?.className ?? '') === 'sr-skill-head' &&
            n.props.children !== undefined)
          ok('[26] the switch is inside the card HEAD, not the footer',
            switches.every((n) => String(n.props.className).includes('sr-toggle-head')),
            JSON.stringify(switches.map((n) => n.props.className)))
          ok('[26] ...and no switch remains in the action row',
            view.findAll((n) => String(n.props?.className ?? '') === 'sr-row-actions').every((row) => {
              const kids = Array.isArray(row.props.children) ? row.props.children : [row.props.children]
              return !kids.some((kid) => String(kid?.props?.className ?? '').includes('sr-btn--toggle'))
            }))
          ok('[26] ...and every card has a head to hold it', headSwitches.length === 3, String(headSwitches.length))

          const before = calls.length
          const liveSwitch = switches.find((n) => n.props['aria-label'] === '\u505c\u7528 live-skill')
          view.click(liveSwitch)
          await tick()
          const offCall = calls.slice(before).find((call) => call.body?.action === 'disable')
          ok('[26] switching an enabled skill off posts a disable', offCall !== undefined, JSON.stringify(calls.slice(before).map((c) => c.body)))
          ok('[26] ...naming the skill and nothing else', offCall !== undefined && Object.keys(offCall.body).sort().join(',') === 'action,name', JSON.stringify(offCall?.body))
          ok('[26] ...in one click: no confirmation step', calls.slice(before).filter((c) => c.body?.action === 'disable').length === 1)

          const beforeOn = calls.length
          const parkedSwitch = switches.find((n) => n.props['aria-label'] === '\u542f\u7528 parked-skill')
          view.click(parkedSwitch)
          await tick()
          const onCall = calls.slice(beforeOn).find((call) => call.body?.action === 'enable')
          ok('[26] switching a parked skill on posts an enable', onCall !== undefined, JSON.stringify(calls.slice(beforeOn).map((c) => c.body)))

          // A parked skill is not offered 引用: the whole point is that it cannot be run.
          // Asserted through the button's TITLE (a stable prop) rather than its text: the
          // harness's recursive text helper is unreliable on these deeper nodes, and the
          // title is what a user reads anyway.
          const refByTitle = view.findAll((n) => n.type === 'button' && String(n.props?.title ?? '').startsWith('\u628a /'))
          ok('[26] the two ENABLED cards offer a reference button', refByTitle.length === 2, JSON.stringify(refByTitle.map((n) => n.props.title)))
          ok('[26] ...and the parked one is not offered it',
            !refByTitle.some((n) => String(n.props.title).includes('parked-skill')),
            JSON.stringify(refByTitle.map((n) => n.props.title)))

          // The claim field: its own row, at the card's width, not a cell in the button row.
          // Matched on 的来源, the claim button's phrase. A bare 标记 ALSO matches the avatar's
          // 「为 X 选择标记颜色」, and the first version of this assertion clicked the avatar
          // instead — so it "revealed" nothing and then blamed the component.
          const claimButton = view.findAll((n) => n.type === 'button' && String(n.props?.['aria-label'] ?? '').includes('\u7684\u6765\u6e90'))[0]
          ok('[26] the card with no source offers a claim', claimButton !== undefined)
          view.click(claimButton)
          const claimInput = view.findAll((n) => n.type === 'input' && String(n.props?.className ?? '').includes('sr-claim-input'))[0]
          ok('[26] the claim field appears in its own row', claimInput !== undefined)
          const row = view.findAll((n) => n.type === 'div' && String(n.props?.className ?? '') === 'sr-claim-row')
          ok('[26] ...and that row is a SIBLING of the button row, not a child',
            row.length === 1 && !row.some((n) => n.children.some((child) => String(child.props?.className ?? '').includes('sr-row-actions'))),
            'a 100%-basis child of an inline-flex box overflows the card')
          ok('[26] ...inside the card footer', view.findAll((n) => n.type === 'div' && String(n.props?.className ?? '') === 'sr-card-foot').length === 3)

          // The three-row card: name row, text, actions. The name used to share a row with
          // six buttons and rendered as `h3-prompt-writi…`; it now has the card's full width.
          const heads = view.findAll((n) => n.type === 'div' && String(n.props?.className ?? '') === 'sr-skill-head')
          ok('[26] every card has a name row of its own', heads.length === 3, String(heads.length))
          ok('[26] ...and no card keeps the old side-by-side row, where the name shared a line with six buttons',
            view.findAll((n) => String(n.props?.className ?? '').includes('sr-skill-top')).length === 0)
        })
      } finally {
        if (realDocument === undefined) delete globalThis.document
        else globalThis.document = realDocument
        if (realLocalStorage === undefined) delete globalThis.localStorage
        else globalThis.localStorage = realLocalStorage
      }
    }

    /* -- 48: the counters ride on the strip's own bar line -- */
    console.log('\n[27] the four counters ride on the strip bar, and only when it is expanded')
    {
      const stats = { ...HOST_SNAPSHOT, turns: 37, turnsWithSkills: 24, turnsWithoutSkills: 13, invocations: 61, capability: CAP_FULL, skills: HOST_SKILLS, disabledSkills: [] }
      const realDocument = globalThis.document
      const realLocalStorage = globalThis.localStorage
      const store = new Map()
      globalThis.document = { addEventListener: () => {}, removeEventListener: () => {}, querySelector: () => null, body: { style: {} } }
      globalThis.localStorage = {
        getItem: (key) => (store.has(key) ? store.get(key) : null),
        setItem: (key, value) => store.set(key, value),
      }
      const stripState = { phase: 'ready', data: stats, error: null, fetchedAt: Date.now() }
      const findCounters = (view) => view.findAll((n) => String(n.props?.className ?? '').includes('sr-statcard--inline'))
      // The bar is a `div` with `role="button"` now, NOT a real `<button>`: the action icons moved inside
      // it at the owner's request, and HTML forbids interactive content inside a button — an inner
      // button's click would have fired the outer toggle too. Matched on the ROLE, so this keeps asserting
      // that the element is still a control rather than merely present.
      const findBar = (view) => view.findAll((n) => String(n.props?.className ?? '') === 'sr-strip' && n.props?.role === 'button')[0]
      try {
        // EXPANDED: four chips, on the bar line itself, in the report's order.
        await withMount(exports.__ui.SkillReportStrip, { state: stripState, onRefresh: () => {}, onUse: () => {}, now: Date.now(), initialOpen: true }, async (view) => {
          const bar = findBar(view)
          ok('[27] the strip renders one bar element', bar !== undefined)
          const counters = findCounters(view)
          ok('[27] ...with all four counters', counters.length === 4, String(counters.length))
          ok('[27] ...in the same order as the report cards',
            counters.every((node, i) => view.text(node).includes(['\u56de\u5408', '\u7528\u5230 skill', '\u672a\u7528', '\u8c03\u7528\u6b21\u6570'][i])),
            JSON.stringify(counters.map((n) => view.text(n))))
          ok('[27] ...carrying the live numbers',
            counters.every((node, i) => view.text(node).includes(['37', '24', '13', '61'][i])),
            JSON.stringify(counters.map((n) => view.text(n))))
          // ON the bar line, not on a row of its own: the chips are descendants of the bar
          // button, which is the whole point of the change.
          const counterNodes = new Set(counters)
          const insideBar = bar.children.some((child) => {
            const walk = (node, depth) => {
              if (depth > 8 || node === null || node === undefined) return false
              if (counterNodes.has(node)) return true
              return (node.children ?? []).some((kid) => walk(kid, depth + 1))
            }
            return walk(child, 0)
          })
          ok('[27] ...and they are INSIDE the bar element, not on a row below it', insideBar)
          // Was asserting the literal 技能. The bar now leads with the install count instead, so the
          // thing worth asserting is that the bar still carries ONE line of summary text plus that
          // count — not the word that was deliberately removed.
          ok('[27] ...and the bar keeps its single-line summary', view.text(bar).includes('gpt-image'), view.text(bar).slice(0, 120))
          ok('[27] ...alongside the install count in place of the old label', /\d+ 个/u.test(view.text(bar)), view.text(bar).slice(0, 120))
          ok('[27] ...with nothing rendered between the bar and the report', view.findAll((n) => n.type === 'div' && String(n.props?.className ?? '') === 'sr-strip-stats').length === 0)
        })

        // COLLAPSED: the counters ARE present now, at the user's explicit request.
        //
        // This used to require zero counters here, on the reasoning that a one-line bar has to stay
        // one line. The user asked for the four figures to be persistent instead — and the original
        // reasoning was wrong for the same reason the row was moved onto the bar at all: these are
        // the numbers this plugin exists to report, so gating them behind a click meant the plugin's
        // DEFAULT state reported nothing. What still has to hold is that the bar is one line.
        await withMount(exports.__ui.SkillReportStrip, { state: stripState, onRefresh: () => {}, onUse: () => {}, now: Date.now(), initialOpen: false }, async (view) => {
          ok('[27] a collapsed bar carries the counters too', findCounters(view).length === 4, String(findCounters(view).length))
          const collapsedBar = findBar(view)
          ok('[27] ...and they are INSIDE the bar element, not on a row below it',
            collapsedBar.children.some((child) => {
              const walk = (node, depth) => {
                if (depth > 8 || node === null || node === undefined) return false
                if (String(node.props?.className ?? '') === 'sr-strip-stats') return true
                return (node.children ?? []).some((kid) => walk(kid, depth + 1))
              }
              return walk(child, 0)
            }))
          ok('[27] ...but still shows the turn count', view.text(collapsedBar).includes('37'), view.text(collapsedBar).slice(0, 120))
        })

        // The report drops the cards when it is rendered inside the strip, so the same
        // four numbers are never on screen twice; the check-updates control lives there.
        store.set('echocat-skill-panel/sections', JSON.stringify({ skills: true }))
        await withMount(exports.__ui.SkillReportPanel, { snapshot: stats, onRefresh: () => {}, onUse: () => {}, onInstall: () => {}, compact: true, now: Date.now() }, async (view) => {
          ok('[27] the compact report does not repeat them as cards',
            view.findAll((n) => String(n.props?.className ?? '') === 'sr-stats').length === 0)
          const checkBtn = view.findAll((n) => n.type === 'button' && String(n.props?.['aria-label'] ?? '') === '\u68c0\u67e5 skill \u66f4\u65b0')
          ok('[27] the check-updates control is labelled, not a bare icon', checkBtn.length === 1, String(checkBtn.length))
        })
        // ...and the FULL panel still shows the four cards.
        await withMount(exports.__ui.SkillReportPanel, { snapshot: stats, onRefresh: () => {}, onUse: () => {}, onInstall: () => {}, now: Date.now() }, async (view) => {
          ok('[27] the full panel still shows them as cards',
            view.findAll((n) => String(n.props?.className ?? '') === 'sr-stats').length === 1)
        })
      } finally {
        if (realDocument === undefined) delete globalThis.document
        else globalThis.document = realDocument
        if (realLocalStorage === undefined) delete globalThis.localStorage
        else globalThis.localStorage = realLocalStorage
      }
    }

    /* -- 49: the plugin's own version controls -- */
    console.log('\n[28] the panel can check its OWN version and reach its release page')
    {
      const RELEASE = {
        current: '4.0.0',
        name: 'echocat-skill-panel',
        repo: 'https://github.com/VDERR/echocat-skill-panel',
        releases: 'https://github.com/VDERR/echocat-skill-panel/releases',
        checkable: true,
      }
      const snapshot = { ...HOST_SNAPSHOT, capability: CAP_FULL, skills: HOST_SKILLS, disabledSkills: [], release: RELEASE }
      const realDocument = globalThis.document
      const realLocalStorage = globalThis.localStorage
      const store = new Map()
      globalThis.document = { addEventListener: () => {}, removeEventListener: () => {}, querySelector: () => null, body: { style: {} } }
      globalThis.localStorage = {
        getItem: (key) => (store.has(key) ? store.get(key) : null),
        setItem: (key, value) => store.set(key, value),
      }
      // `openedExternal` is filled by the envelope's own `window.open` (see `[2]`), which is
      // the `window` the bundle actually sees.
      openedExternal.length = 0
      try {
        store.set('echocat-skill-panel/sections', JSON.stringify({ skills: true }))
        exports.__source.clearRelease()
        await withMount(exports.__ui.SkillReportPanel, { snapshot, onRefresh: () => {}, onUse: () => {}, onInstall: () => {} }, async (view) => {
          const checkBtn = view.findAll((n) => n.type === 'button' && n.props?.['aria-label'] === '\u68c0\u67e5\u63d2\u4ef6\u66f4\u65b0')
          ok('[28] the header offers a version check', checkBtn.length === 1, String(checkBtn.length))
          ok('[28] ...and it is not disabled before anything is known', checkBtn[0]?.props?.disabled !== true)
          ok('[28] ...with the running version in its tooltip',
            String(checkBtn[0]?.props?.title ?? '').includes('4.0.0'), String(checkBtn[0]?.props?.title))

          const githubBtn = view.findAll((n) => n.type === 'button' && n.props?.['aria-label'] === '\u6253\u5f00 GitHub \u53d1\u5e03\u9875')
          ok('[28] ...and a button to the release page', githubBtn.length === 1, String(githubBtn.length))

          // Clicking the link opens EXACTLY the payload's URL, in a new tab, with the
          // opener severed — `noopener,noreferrer` is what the app's own plugins use.
          view.click(githubBtn[0])
          await tick()
          ok('[28] clicking it opens the release page',
            openedExternal.length === 1 && openedExternal[0].url === RELEASE.releases,
            JSON.stringify(openedExternal))
          ok('[28] ...in a new tab', openedExternal[0]?.target === '_blank', String(openedExternal[0]?.target))
          ok('[28] ...with the opener severed', String(openedExternal[0]?.features ?? '').includes('noopener'), String(openedExternal[0]?.features))

          // A check posts nothing and reads one path; the store then carries the verdict.
          const before = calls.length
          view.click(checkBtn[0])
          await tick()
          const checkCall = calls.slice(before).find((call) => String(call.target).includes('/release'))
          ok('[28] the check reads the release route', checkCall !== undefined, JSON.stringify(calls.slice(before).map((c) => c.target)))
          ok('[28] ...and writes nothing', calls.slice(before).every((call) => call.body === undefined), JSON.stringify(calls.slice(before).map((c) => c.body)))
          ok('[28] ...and never touches the skills catalogue', calls.slice(before).every((call) => !String(call.target).includes('/skills')), JSON.stringify(calls.slice(before).map((c) => c.target)))
        })

        // With an update available the header SAYS so, and the check button is marked —
        // a version number hidden in a tooltip is not discoverable.
        exports.__source.applyRelease({ ...RELEASE, latest: '4.1.0', hasUpdate: true, npm: '4.1.0', tag: 'v4.1.0' })
        await withMount(exports.__ui.SkillReportPanel, { snapshot, onRefresh: () => {}, onUse: () => {}, onInstall: () => {} }, async (view) => {
          const text = view.text()
          ok('[28] an available update is stated, not just hinted', text.includes('\u53ef\u66f4\u65b0') && text.includes('4.1.0'), text.slice(0, 200))
          const marked = view.findAll((n) => String(n.props?.className ?? '').includes('sr-btn--accent') && n.props?.['aria-label'] === '\u68c0\u67e5\u63d2\u4ef6\u66f4\u65b0')
          ok('[28] ...and the check button carries the accent', marked.length === 1, String(marked.length))
          ok('[28] ...with a dot so it is visible without hovering',
            view.findAll((n) => String(n.props?.className ?? '') === 'sr-release-dot').length >= 1)
          const dot = view.findAll((n) => n.type === 'button' && n.props?.['aria-label'] === '\u68c0\u67e5\u63d2\u4ef6\u66f4\u65b0')[0]
          ok('[28] ...and a tooltip naming both versions',
            String(dot?.props?.title ?? '').includes('4.1.0') && String(dot?.props?.title ?? '').includes('4.0.0'),
            String(dot?.props?.title))
        })

        // Up to date is a DIFFERENT message from "could not tell".
        exports.__source.applyRelease({ ...RELEASE, latest: '4.0.0', hasUpdate: false, npm: '4.0.0', tag: 'v4.0.0' })
        await withMount(exports.__ui.SkillReportPanel, { snapshot, onRefresh: () => {}, onUse: () => {}, onInstall: () => {} }, async (view) => {
          ok('[28] being current says so', view.text().includes('\u5df2\u662f\u6700\u65b0'), view.text().slice(0, 200))
        })

        // A host that cannot check does not render a dead button.
        exports.__source.clearRelease()
        const offline = { ...snapshot, release: { ...RELEASE, checkable: false } }
        await withMount(exports.__ui.SkillReportPanel, { snapshot: offline, onRefresh: () => {}, onUse: () => {}, onInstall: () => {} }, async (view) => {
          ok('[28] an uncheckable host shows no check button',
            view.findAll((n) => n.type === 'button' && n.props?.['aria-label'] === '\u68c0\u67e5\u63d2\u4ef6\u66f4\u65b0').length === 0)
          ok('[28] ...but still offers the release page',
            view.findAll((n) => n.type === 'button' && n.props?.['aria-label'] === '\u6253\u5f00 GitHub \u53d1\u5e03\u9875').length === 1)
        })

        // The strip carries them too: the report panel is not mounted while the user is in
        // the conversation, so without this row the buttons would be unreachable there.
        exports.__source.clearRelease()
        await withMount(exports.__ui.SkillReportStrip, { state: { phase: 'ready', data: snapshot, error: null, fetchedAt: Date.now() }, onRefresh: () => {}, onUse: () => {}, now: Date.now() }, async (view) => {
          ok('[28] the strip offers the version check as well',
            view.findAll((n) => n.type === 'button' && n.props?.['aria-label'] === '\u68c0\u67e5\u63d2\u4ef6\u66f4\u65b0').length === 1)
          ok('[28] ...and the release-page link',
            view.findAll((n) => n.type === 'button' && n.props?.['aria-label'] === '\u6253\u5f00 GitHub \u53d1\u5e03\u9875').length === 1)
        })
      } finally {
        exports.__source.clearRelease()
        openedExternal.length = 0
        if (realDocument === undefined) delete globalThis.document
        else globalThis.document = realDocument
        if (realLocalStorage === undefined) delete globalThis.localStorage
        else globalThis.localStorage = realLocalStorage
      }
    }

    clearToasts()
  }
})()

globalThis.setInterval = realSetInterval
globalThis.clearInterval = realClearInterval

console.log(`\nRESULT: ${pass}/${pass + fail} passed`)
if (fail > 0) process.exitCode = 1
