// A zoomed screenshot of just the composer strip, in both themes.
//
// `tools/preview.mjs` renders the whole panel, and at 2100px wide the strip is a 40px sliver that
// gets downscaled for review - so the things this pass changed (a 22px centred mark, a count chip,
// and four counters that now ride the FOLDED bar) are not legible in that image at all. This shoots
// only the strip, at 3x, by hiding every other section of the preview page.
//
// It renders the REAL component, because it loads the page preview.mjs builds rather than writing
// markup of its own. That distinction has already cost this repo several debugging cycles: a
// hand-rolled fixture produced a layout problem that did not exist in the component.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const chrome = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find((c) => existsSync(c))
if (chrome === undefined) {
  console.error('NOT MEASURED: no Chromium found, so the strip was not rendered')
  process.exit(2)
}

const previewPath = join(here, 'preview.html')
if (!existsSync(previewPath)) {
  console.error('run `node tools/preview.mjs` first: it writes tools/preview.html')
  process.exit(2)
}

const sandbox = mkdtempSync(join(tmpdir(), 'echocat-strip-'))
try {
  const html = readFileSync(previewPath, 'utf8')
  const patch = (background, dark) => `<script>
      const cols = [...document.querySelectorAll('.col')]
      for (const col of cols) {
        const heading = col.querySelector('h2')
        const keep = heading !== null && /composer strip/u.test(heading.textContent)
        col.style.display = keep ? '' : 'none'
      }
      document.body.style.background = '${background}'
      document.body.style.padding = '0'
      // The plugin picks its palette from the OS preference OR an explicit dark class /
      // [data-theme] on an ancestor. A dark PAGE behind a light panel is not a dark theme, so the
      // signal has to be set on the document element here - otherwise this renders the light theme
      // with the light mark and says nothing at all about the dark one.
      // (No backticks anywhere in this template: they would end it, the same way a stray backtick
      // in the plugin's stylesheet does.)
      if (${dark}) {
        document.documentElement.classList.add('dark')
        document.documentElement.setAttribute('data-theme', 'dark')
      }
      for (const frame of document.querySelectorAll('.frame')) frame.style.height = 'auto'
      // Give the strip the width it ACTUALLY has: the real composer column is ~920px of chat
      // content, and in the two-column preview page the strip's column is only ~593px. Judging the
      // bar at 593px led to a wrong conclusion about the summary text fitting at all.
      for (const col of document.querySelectorAll('.col')) col.style.width = '1000px'
      for (const frame of document.querySelectorAll('.frame')) frame.style.width = '1000px'

      // Report the boxes, so overlap is a MEASUREMENT rather than an impression from a screenshot.
      const rows = []
      for (const row of document.querySelectorAll('.sr-strip-row')) {
        const rr = row.getBoundingClientRect()
        rows.push('row ' + Math.round(rr.width) + 'x' + Math.round(rr.height) + ' @' + Math.round(rr.left))
        for (const child of row.children) {
          const cr = child.getBoundingClientRect()
          const cls = (child.getAttribute('class') ?? child.tagName).split(' ')[0]
          rows.push('   ' + cls.padEnd(22) + Math.round(cr.width) + 'x' + Math.round(cr.height) +
            '  @' + Math.round(cr.left) + '..' + Math.round(cr.right) + (cr.right > rr.right + 1 ? '   OVERFLOWS THE ROW' : ''))
        }
        // Do any two children overlap horizontally?
        const kids = [...row.children].map((c) => ({ cls: (c.getAttribute('class') ?? '').split(' ')[0], r: c.getBoundingClientRect() }))
        for (let i = 0; i < kids.length; i += 1) {
          for (let j = i + 1; j < kids.length; j += 1) {
            if (kids[i].r.right > kids[j].r.left + 0.5 && kids[j].r.right > kids[i].r.left + 0.5) {
              rows.push('   OVERLAP: ' + kids[i].cls + ' and ' + kids[j].cls)
            }
          }
        }
      }
      const box = document.createElement('pre')
      box.id = 'boxes'
      box.style.cssText = 'position:fixed;left:0;bottom:0;z-index:99999;background:#fff;color:#000;font:11px monospace;margin:0;padding:6px'
      box.textContent = rows.join('\\n')
      document.body.appendChild(box)
    </script></body>`

  for (const [name, background, dark] of [['strip-light', '#faf8f5', false], ['strip-dark', '#100e0c', true]]) {
    writeFileSync(join(sandbox, `${name}.html`), html.replace('</body>', patch(background, dark)), 'utf8')
    const out = join(here, `${name}.png`)
    execFileSync(chrome, [
      '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      `--user-data-dir=${join(sandbox, name)}`,
      // Wide enough for the whole comparison shell plus its padding: at 760px the row was clipped
      // and a screenshot of it said nothing about whether the buttons really overlapped.
      '--window-size=1100,300', '--force-device-scale-factor=3', '--hide-scrollbars',
      '--virtual-time-budget=3000', `--screenshot=${out}`,
      pathToFileURL(join(sandbox, `${name}.html`)).href,
    ], { stdio: 'ignore' })
    console.log('wrote ' + out)
  }

  // And print the measurement as text.
  const dom = execFileSync(chrome, [
    '--headless=new', '--disable-gpu', '--no-first-run', `--user-data-dir=${join(sandbox, 'dom')}`,
    '--window-size=1100,300', '--virtual-time-budget=3000', '--dump-dom',
    pathToFileURL(join(sandbox, 'strip-light.html')).href,
  ], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] })
  const boxes = /<pre id="boxes"[^>]*>([\s\S]*?)<\/pre>/u.exec(dom)
  console.log('\n=== measured row layout ===')
  console.log(boxes === null ? '  the probe did not run' : boxes[1].replace(/&amp;/gu, '&').replace(/&lt;/gu, '<'))
} finally {
  rmSync(sandbox, { recursive: true, force: true })
}
