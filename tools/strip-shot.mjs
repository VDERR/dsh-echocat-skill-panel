// A clean, zoomed screenshot of the composer strip in both themes, plus a MEASURED readout of its
// layout.
//
// WHY THIS FILE SITS ALONE. Judging the strip by eye failed repeatedly for a reason that had nothing
// to do with the strip: tools/preview.mjs lays the panel out in TWO columns, so the strip's column is
// only ~593px wide while the real composer gives it ~936px, and forcing the column wider made the
// document wider than the layout viewport, after which Chromium's `--screenshot` captured from a
// horizontal offset and cropped the LEFT HALF of the bar out of the image. The brand and the summary
// therefore kept looking absent when they were on screen the whole time.
//
// So this builds a page containing nothing but the strip. The component, its props and its stylesheet
// are still the real ones — they are lifted verbatim out of the preview's own output — because the
// other lesson from this repo is that a hand-rolled fixture produces layout problems that do not
// exist in the component.
//
//   node tools/preview.mjs && node tools/shot-strip.mjs
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
  const styles = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gu)].map((m) => m[1]).join('\n')

  // The strip's markup, taken from the preview's own output rather than written here, so the render
  // is the component's. Located by the strip's own class, not by counting frames: the first attempt
  // sliced from the composer-strip heading to the next `</div></div>` and captured the PANEL's header
  // instead, which looked like a rendering bug and was a string-slicing bug.
  const shellAt = html.indexOf('class="sr-strip-shell')
  if (shellAt === -1) {
    console.error('the preview page has no .sr-strip-shell — run `node tools/preview.mjs` first')
    process.exit(2)
  }
  // Walk back to the opening `<` of that element, then forward to its matching close.
  const openAt = html.lastIndexOf('<', shellAt)
  let depth = 0
  let i = openAt
  let closeAt = html.length
  while (i < html.length) {
    if (html.startsWith('<div', i)) depth += 1
    else if (html.startsWith('</div', i)) {
      depth -= 1
      if (depth === 0) {
        closeAt = html.indexOf('>', i) + 1
        break
      }
    }
    i += 1
  }
  const stripMarkup = `<div class="frame">${html.slice(openAt, closeAt)}</div>`

  const page = (background, dark) => `<!doctype html><meta charset="utf-8"><style>${styles}
    html,body{margin:0;padding:0;background:${background}}
    body{padding:20px;width:1000px;box-sizing:border-box;overflow-x:hidden}
    .frame{border:0 !important;height:auto !important;overflow:visible !important;padding:0 !important;background:transparent !important}
    h2,pre{display:none !important}
  </style>${stripMarkup}${dark ? '<script>document.documentElement.classList.add("dark");document.documentElement.setAttribute("data-theme","dark")</script>' : ''}`

  const shots = [
    ['strip-clean', '#faf8f5', false],
    ['strip-clean-dark', '#100e0c', true],
  ]
  for (const [name, background, dark] of shots) {
    const file = join(sandbox, `${name}.html`)
    writeFileSync(file, page(background, dark), 'utf8')
    const out = join(here, `${name}.png`)
    execFileSync(chrome, [
      '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      `--user-data-dir=${join(sandbox, name)}`,
      '--window-size=1040,230', '--hide-scrollbars', '--force-color-profile=srgb',
      '--virtual-time-budget=3000', `--screenshot=${out}`,
      pathToFileURL(file).href,
    ], { stdio: 'ignore' })
    console.log('wrote ' + out)
  }

  // And the readout: overlap, centring, and whether the summary starts where it should. "Centred"
  // and "left-aligned" are claims, and every wrong turn in this file came from assuming one.
  const probe = join(sandbox, 'probe.html')
  writeFileSync(probe, page('#faf8f5', false).replace('</body>', `<script>
    const rows = []
    for (const row of document.querySelectorAll('.sr-strip-row')) {
      const rr = row.getBoundingClientRect()
      const bar = row.querySelector('.sr-strip')
      const br = bar.getBoundingClientRect()
      rows.push('bar ' + Math.round(br.width) + 'x' + Math.round(br.height) +
        '  @' + Math.round(br.left) + '..' + Math.round(br.right))
      const mark = row.querySelector('.sr-strip-logo')
      if (mark === null) { rows.push('  *** NO MARK ***') } else {
        const mr = mark.getBoundingClientRect()
        const mid = br.left + br.width / 2
        const markMid = mr.left + mr.width / 2
        rows.push('  mark centre ' + markMid.toFixed(1) + ' vs bar centre ' + mid.toFixed(1) +
          '  offset ' + (markMid - mid).toFixed(1) + 'px  ' + (Math.abs(markMid - mid) <= 1.5 ? 'CENTRED' : 'NOT CENTRED'))
        for (const kid of bar.children) {
          const kr = kid.getBoundingClientRect()
          if (kr.width === 0) continue
          const cls = (kid.getAttribute('class') ?? '').split(' ')[0]
          if (cls === 'sr-strip-logo') continue
          if (kr.left < mr.right - 0.5 && kr.right > mr.left + 0.5) rows.push('  MARK SITS OVER: ' + cls)
        }
      }
      const text = bar.querySelector('.sr-strip-text')
      const brand = bar.querySelector('.sr-strip-brand')
      if (text !== null && brand !== null) {
        const tr = text.getBoundingClientRect()
        const gr = brand.getBoundingClientRect()
        const expected = gr.right + 6
        const gap = tr.left - expected
        rows.push('  summary starts ' + Math.round(tr.left) + 'px, brand ends ' + Math.round(gr.right) +
          'px, gap ' + gap.toFixed(1) + 'px  ' + (Math.abs(gap) <= 1.5 ? 'AFTER THE BRAND (left-aligned)' : '*** WRONG ***'))
        const cs = getComputedStyle(text)
        rows.push('  summary text-align=' + cs.textAlign + '  width=' + Math.round(tr.width) + 'px')
      }
    }
    const pre = document.createElement('pre')
    pre.id = 'r'
    pre.textContent = rows.join('\\n')
    document.body.appendChild(pre)
  </script></body>`), 'utf8')
  const dom = execFileSync(chrome, [
    '--headless=new', '--disable-gpu', '--no-first-run', `--user-data-dir=${join(sandbox, 'dom')}`,
    '--window-size=1040,230', '--virtual-time-budget=3000', '--dump-dom',
    pathToFileURL(probe).href,
  ], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] })
  const out = /<pre id="r">([\s\S]*?)<\/pre>/u.exec(dom)
  console.log('\n=== measured ===')
  console.log(out === null ? '  the probe did not run' : out[1].replace(/&amp;/gu, '&').replace(/&lt;/gu, '<'))
} finally {
  rmSync(sandbox, { recursive: true, force: true })
}
