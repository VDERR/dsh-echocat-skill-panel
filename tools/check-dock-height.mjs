// Measure the plugin's dock seat in real Chrome over the DevTools protocol.
//
// WHY THIS EXISTS. A user reported "scrolling down shows a blank page" after installing the
// plugin. The dock seat is the one surface that participates in the page's own layout, so
// the question is whether the strip — or the expansion it opens — makes the PAGE taller than
// the viewport, which would give the shell a blank region to scroll into. Guessing at that
// from CSS is how you fix the wrong thing; this measures it.
//
// `--dump-dom` was tried first and is the wrong tool: it snapshots the DOM while virtual time
// is still running, so an async probe either races it or never runs. CDP evaluates an
// expression and waits for the promise.
//
// Deliberately NOT part of `npm test`: it needs a Chrome binary.

import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const pkgRoot = resolve(here, '..')

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  join(process.env.LOCALAPPDATA ?? '', 'Google\\Chrome\\Application\\chrome.exe'),
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
]
const chrome = CHROME_CANDIDATES.find((candidate) => candidate !== '' && existsSync(candidate))
if (chrome === undefined) {
  console.log('no Chrome/Edge binary found; skipping (not part of `npm test`)')
  process.exit(0)
}

/**
 * The plugin's real stylesheet, read back OUT of the shipped artifact.
 *
 * From `lib/client.js`, not `src/`, on purpose: those two diverge whenever someone forgets
 * `npm run build`, and the question here is what users actually receive.
 */
function renderStylesheet() {
  const bundled = readFileSync(join(pkgRoot, 'lib', 'client.js'), 'utf8')
  const header = /^\t\t\t"(\.[^"]+)": function \(module, exports, require\) \{$/gmu
  const marks = []
  let match
  while ((match = header.exec(bundled)) !== null) marks.push({ id: match[1], end: header.lastIndex, at: match.index })
  if (marks.length === 0) throw new Error('could not find the module table in lib/client.js')
  const modules = new Map()
  for (let i = 0; i < marks.length; i += 1) {
    const stop = i + 1 < marks.length ? marks[i + 1].at : bundled.length
    modules.set(marks[i].id, bundled.slice(marks[i].end, stop).replace(/\},?\s*$/u, ''))
  }
  const cache = new Map()
  const load = (id) => {
    const key = id.startsWith('./') ? id : `./${id}`
    if (cache.has(key)) return cache.get(key)
    const source = modules.get(key)
    if (source === undefined) throw new Error(`module ${key} not in the bundle`)
    const module = { exports: {} }
    cache.set(key, module.exports)
    // eslint-disable-next-line no-new-func
    new Function('module', 'exports', 'require', source)(module, module.exports, (spec) => {
      if (spec === 'react') {
        return {
          createElement: () => null,
          useSyncExternalStore: () => null,
          useState: () => [],
          useEffect: () => {},
          useCallback: (fn) => fn,
          useMemo: (fn) => fn(),
          useRef: () => ({ current: null }),
        }
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

/** A tiny CDP client: enough to evaluate one expression and read its value. */
async function withChrome(port, fn) {
  const child = spawn(
    chrome,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${join(sandbox, `profile-${port}`)}`,
      '--window-size=1280,800',
      '--allow-file-access-from-files',
      'about:blank',
    ],
    { stdio: 'ignore' },
  )
  try {
    // Wait for the debugging endpoint, then take the page target's websocket.
    let target = null
    for (let i = 0; i < 60 && target === null; i += 1) {
      await new Promise((r) => setTimeout(r, 250))
      try {
        const list = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json())
        target = list.find((entry) => entry.type === 'page' && entry.webSocketDebuggerUrl !== undefined) ?? null
      } catch {
        // not up yet
      }
    }
    if (target === null) throw new Error('Chrome never exposed a page target')
    const socket = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise((res, rej) => {
      socket.addEventListener('open', res, { once: true })
      socket.addEventListener('error', rej, { once: true })
    })
    let seq = 0
    const pending = new Map()
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      const resolvePromise = pending.get(message.id)
      if (resolvePromise !== undefined) {
        pending.delete(message.id)
        resolvePromise(message)
      }
    })
    const send = (method, params = {}) =>
      new Promise((res) => {
        seq += 1
        pending.set(seq, res)
        socket.send(JSON.stringify({ id: seq, method, params }))
      })
    await send('Page.enable')
    try {
      return await fn(send)
    } finally {
      socket.close()
    }
  } finally {
    child.kill()
    // Windows: `kill` does not reap the whole tree; the temporary profile keeps it isolated.
    await new Promise((r) => setTimeout(r, 400))
  }
}

const sandbox = mkdtempSync(join(tmpdir(), 'echocat-dock-'))
let failed = false
try {
  writeFileSync(join(sandbox, 'plugin.css'), renderStylesheet(), 'utf8')
  writeFileSync(join(sandbox, 'index.html'), readFileSync(join(here, 'dock-harness.html'), 'utf8'), 'utf8')
  const url = pathToFileURL(join(sandbox, 'index.html')).href

  await withChrome(9333, async (send) => {
    await send('Page.navigate', { url })
    // Let the page settle: the harness reads its stylesheet over XHR on first run.
    for (let i = 0; i < 40; i += 1) {
      const ready = await send('Runtime.evaluate', { expression: 'typeof window.__probe === "object" && !!window.__probe', returnByValue: true })
      if (ready.result?.result?.value === true) break
      await new Promise((r) => setTimeout(r, 200))
    }
    for (const size of [
      [1280, 800],
      [1024, 700],
    ]) {
      await send('Emulation.setDeviceMetricsOverride', { width: size[0], height: size[1], deviceScaleFactor: 1, mobile: false })
      const evaluated = await send('Runtime.evaluate', {
        expression: `(async () => {
          const out = []
          for (const variant of ['none', 'collapsed', 'open']) out.push(await window.__probe.run(variant))
          return out
        })()`,
        awaitPromise: true,
        returnByValue: true,
      })
      if (evaluated.result?.exceptionDetails !== undefined) {
        console.log(`  window ${size.join('x')}: probe threw: ${evaluated.result.exceptionDetails.text} ${evaluated.result.exceptionDetails.exception?.description ?? ''}`)
        failed = true
        continue
      }
      const rows = evaluated.result?.result?.value ?? []
      console.log(`\n  window ${size[0]}x${size[1]}`)
      console.log(`    ${'variant'.padEnd(10)} ${'docH'.padEnd(6)} ${'pageOverflow'.padEnd(13)} ${'dockH'.padEnd(6)} ${'mainH'.padEnd(6)} ${'mainPastVp'.padEnd(11)} pluginMaxBottom`)
      for (const row of rows) {
        console.log(
          `    ${String(row.variant).padEnd(10)} ${String(row.documentScrollHeight).padEnd(6)} ${String(row.pageOverflow).padEnd(13)} ${String(row.dockHeight).padEnd(6)} ${String(row.mainHeight).padEnd(6)} ${String(row.mainOverflowsViewport).padEnd(11)} ${row.pluginMaxBottom}`,
        )
      }
      const none = rows.find((row) => row.variant === 'none')
      if (none === undefined) continue
      for (const row of rows.filter((r) => r.variant !== 'none')) {
        const delta = row.pageOverflow - none.pageOverflow
        const verdict = delta === 0 ? 'OK — adds no page overflow' : 'REGRESSION — the page can scroll into blank space'
        console.log(`    -> ${row.variant}: pageOverflow ${none.pageOverflow} -> ${row.pageOverflow} (${delta >= 0 ? '+' : ''}${delta}px)  ${verdict}`)
        if (delta !== 0) failed = true
      }
    }
  })
  process.exitCode = failed ? 1 : 0
} finally {
  rmSync(sandbox, { recursive: true, force: true })
}
