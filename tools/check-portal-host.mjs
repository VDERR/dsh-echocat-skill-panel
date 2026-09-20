#!/usr/bin/env node
// Measure the install sheet's portal host in real Chrome, over the DevTools protocol.
//
// WHY THIS EXISTS. A user reported "scrolling down shows a blank page with a frame and
// nothing in it" after using the plugin. The dock seat is not the cause: the surface that
// participates in the DOCUMENT's layout is the portal host that src/client/install.js
// appends to `document.body` as <div class="sr-root sr-portal-host">. If the rule meant to
// neutralise it does not match the host itself, the host keeps the `.sr-root` frame
// (height:100%, 1px border, radius, --sr-max width) and the page grows taller than the
// viewport — a blank, scrollable region below the shell, which is exactly what was seen.
//
// Guessing that from CSS is how you fix the wrong thing; this measures it. The assertion is
// one-directional: the portal host must add ZERO page overflow, in both the closed and the
// open state. It fails while the selector bug is present and passes once it is fixed.
//
// Place next to `check-dock-height.mjs`; deliberately NOT part of `npm test` (needs Chrome).

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const pkgRoot = resolve(here, '..')

// NOTE: the (x86) Edge path is listed on purpose — it is the only browser on some Windows
// machines, and omitting it makes this tool skip silently on exactly those machines.
const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  join(process.env.LOCALAPPDATA ?? '', 'Google\\Chrome\\Application\\chrome.exe'),
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
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
      '--window-size=1256,885',
      'about:blank',
    ],
    { stdio: 'ignore' },
  )
  try {
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
      const done = pending.get(message.id)
      if (done !== undefined) {
        pending.delete(message.id)
        done(message)
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

const sandbox = mkdtempSync(join(tmpdir(), 'echocat-portal-'))
let failed = false
try {
  const css = renderStylesheet()
  writeFileSync(join(sandbox, 'index.html'), readFileSync(join(here, 'portal-harness.html'), 'utf8'), 'utf8')
  const url = pathToFileURL(join(sandbox, 'index.html')).href

  await withChrome(9334, async (send) => {
    await send('Page.navigate', { url })
    for (let i = 0; i < 40; i += 1) {
      const ready = await send('Runtime.evaluate', { expression: 'typeof window.__probe === "object" && !!window.__probe', returnByValue: true })
      if (ready.result?.result?.value === true) break
      await new Promise((r) => setTimeout(r, 200))
    }
    await send('Runtime.evaluate', { expression: `document.getElementById('plugin-css').textContent = ${JSON.stringify(css)}`, returnByValue: true })
    for (const size of [
      [1256, 885],
      [1280, 800],
    ]) {
      await send('Emulation.setDeviceMetricsOverride', { width: size[0], height: size[1], deviceScaleFactor: 1, mobile: false })
      const evaluated = await send('Runtime.evaluate', {
        expression: `(async () => { const out = []; for (const v of ['none', 'host', 'sheet-open']) out.push(await window.__probe.run(v)); return out })()`,
        awaitPromise: true,
        returnByValue: true,
      })
      if (evaluated.result?.exceptionDetails !== undefined) {
        console.log(`  window ${size.join('x')}: probe threw: ${evaluated.result.exceptionDetails.text}`)
        failed = true
        continue
      }
      const rows = evaluated.result?.result?.value ?? []
      const none = rows.find((row) => row.variant === 'none')
      console.log(`\n  window ${size[0]}x${size[1]}  (baseline document ${none?.documentScrollHeight}px, viewport ${none?.viewport})`)
      console.log(`    ${'variant'.padEnd(11)} ${'docH'.padEnd(6)} ${'pageOverflow'.padEnd(13)} ${'hostPainted'.padEnd(12)} ${'hostBox'.padEnd(16)} hostDisplay`)
      for (const row of rows) {
        const box = row.host === null ? '-' : `${row.host.w}x${row.host.h}`
        console.log(
          `    ${String(row.variant).padEnd(11)} ${String(row.documentScrollHeight).padEnd(6)} ${String(row.pageOverflow).padEnd(13)} ${String(row.host?.painted ?? false).padEnd(12)} ${box.padEnd(16)} ${row.host?.display ?? '-'}`,
        )
      }
      for (const row of rows.filter((r) => r.variant !== 'none')) {
        const delta = row.pageOverflow - (none?.pageOverflow ?? 0)
        const verdict = delta === 0 ? 'OK — adds no page overflow' : `REGRESSION — the page can scroll ${delta}px into blank space`
        console.log(`    -> ${row.variant}: pageOverflow ${none?.pageOverflow} -> ${row.pageOverflow} (${delta >= 0 ? '+' : ''}${delta}px)  ${verdict}`)
        if (delta !== 0) failed = true
        if (row.host !== null && row.host.painted) {
          console.log(`       and the host IS still painted as a box: ${row.host.w}x${row.host.h}, border ${row.host.border}, background ${row.host.background}`)
          failed = true
        }
      }
    }
  })
  process.exitCode = failed ? 1 : 0
} finally {
  rmSync(sandbox, { recursive: true, force: true })
}
