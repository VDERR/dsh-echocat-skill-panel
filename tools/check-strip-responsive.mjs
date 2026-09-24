#!/usr/bin/env node
// Render the real composer-strip markup and stylesheet at the widths the DSH
// composer uses.  This catches content wrapping and clipping; the older width
// harness only measured the outer shell and could stay green while the bar
// inside it became two rows tall.

import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const previewPath = join(here, 'preview.html')
const chrome = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find((candidate) => existsSync(candidate))

if (chrome === undefined) {
  console.error('NOT MEASURED: no Chromium browser was found')
  process.exit(2)
}
if (!existsSync(previewPath)) {
  console.error('NOT MEASURED: run node tools/preview.mjs first')
  process.exit(2)
}

const html = readFileSync(previewPath, 'utf8')
const styles = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gu)].map((match) => match[1]).join('\n')
const shellAt = html.indexOf('class="sr-strip-shell')
if (shellAt === -1) throw new Error('preview has no composer strip')

const openAt = html.lastIndexOf('<', shellAt)
let depth = 0
let closeAt = html.length
for (let index = openAt; index < html.length; index += 1) {
  if (html.startsWith('<div', index)) depth += 1
  else if (html.startsWith('</div', index)) {
    depth -= 1
    if (depth === 0) {
      closeAt = html.indexOf('>', index) + 1
      break
    }
  }
}
const stripMarkup = html.slice(openAt, closeAt)

// 1258/1259 straddle the measured compact boundary (1240/1241px container content boxes);
// 1304px mirrors the owner's wide screenshot (1288px shell). DSH lets a saved
// user width override the default cap, so each case sets the host variable.
const SEATS = [648, 712, 851, 952, 1040, 1258, 1259, 1304]
const scratch = mkdtempSync(join(tmpdir(), 'echocat-strip-responsive-'))
try {
  const cases = SEATS.map((seat) => `<section class="probe host-body" data-seat="${seat}" style="width:${seat}px;--dsh-composer-card-max-width:${seat}px"><div class="host-scroll"><div class="host-seat"><div class="host-stack host-hero">${stripMarkup}</div></div></div></section>`).join('')
  const page = `<!doctype html><html><head><meta charset="utf-8"><style>
${styles}
*{box-sizing:border-box}html,body{margin:0;padding:0}body{padding:20px;background:#faf8f5;display:flex;flex-direction:column;gap:18px;align-items:flex-start}
.probe{--dsh-chat-content-width:920px;--dsh-composer-card-max-width:952px;--dsh-composer-side-clearance:16px;--dsh-composer-dock-inset:8px;display:flex;flex-direction:column;min-width:0;height:150px;overflow:visible}
.host-scroll{display:flex;flex:1;min-height:0;flex-direction:column;justify-content:center;overflow-y:auto}
.host-seat{display:flex;flex:none;flex-direction:column}
.host-stack{--dsh-composer-stack-gap:6px;display:flex;flex-direction:column;gap:var(--dsh-composer-stack-gap)}
.host-hero{width:min(calc(var(--dsh-composer-card-max-width) + 2 * var(--dsh-composer-side-clearance)),100%);align-self:center;gap:8px;padding-bottom:32px}
</style></head><body>${cases}<script>
const round = (value) => Math.round(value * 100) / 100
const box = (element) => { const value = element.getBoundingClientRect(); return { x: round(value.x), y: round(value.y), w: round(value.width), h: round(value.height), right: round(value.right), bottom: round(value.bottom) } }
const rows = [...document.querySelectorAll('.probe')].map((probe) => {
  const shell = probe.querySelector('.sr-strip-shell')
  const row = probe.querySelector('.sr-strip-row')
  const bar = probe.querySelector('.sr-strip')
  const left = probe.querySelector('.sr-strip-left')
  const logo = probe.querySelector('.sr-strip-logo')
  const right = probe.querySelector('.sr-strip-right')
  const stats = probe.querySelector('.sr-strip-stats')
  const actions = probe.querySelector('.sr-strip-actions')
  const bgLabel = probe.querySelector('.sr-bg-open-label')
  const visibleStatLabels = [...stats.querySelectorAll('.sr-stat-l')].filter((element) => {
    const style = getComputedStyle(element)
    const bounds = element.getBoundingClientRect()
    return style.display !== 'none' && style.visibility !== 'hidden' && bounds.width > 0 && bounds.height > 0
  })
  const children = [...bar.children].filter((element) => getComputedStyle(element).display !== 'none').map((element) => ({ className: element.className, box: box(element) }))
  const rightChildren = [...right.children].filter((element) => getComputedStyle(element).display !== 'none').map((element) => ({ className: element.className, box: box(element) }))
  const overlaps = (items) => items.some((item, index) => index > 0 && item.box.x < items[index - 1].box.right - 1)
  const barBox = box(bar)
  const rightBox = box(right)
  const lineTops = [...new Set(children.map((child) => child.box.y))]
  return {
    seat: Number(probe.dataset.seat),
    shell: box(shell), row: box(row), bar: barBox,
    left: box(left), logo: box(logo), right: rightBox, stats: box(stats), actions: box(actions),
    statWidths: [...stats.children].map((element) => box(element).w),
    actionWidths: [...actions.children].filter((element) => getComputedStyle(element).display !== 'none').map((element) => box(element).w),
    rightChildren,
    bgLabelVisible: getComputedStyle(bgLabel).display !== 'none',
    visibleStatLabels: visibleStatLabels.map((element) => element.textContent),
    lineTops,
    barWraps: box(right).y >= box(left).bottom - 1 || box(actions).y > box(stats).y + 1,
    horizontalOverflow: bar.scrollWidth > bar.clientWidth + 1,
    rightOverflow: right.scrollWidth > right.clientWidth + 1,
    rightOverlap: overlaps(rightChildren),
    rightChildrenOutside: rightChildren.some((child) => child.box.x < rightBox.x - 1 || child.box.right > rightBox.right + 1),
    verticalOverflow: bar.scrollHeight > bar.clientHeight + 1,
    shellVerticalOverflow: shell.scrollHeight > shell.clientHeight + 1,
    rowOutsideShell: box(row).y < box(shell).y - 1 || box(row).bottom > box(shell).bottom + 1,
    descendantsOutsideBar: children.some((child) => child.box.x < barBox.x - 1 || child.box.right > barBox.right + 1 || child.box.y < barBox.y - 1 || child.box.bottom > barBox.bottom + 1),
  }
})
const result = document.createElement('pre')
result.id = 'results'
result.textContent = 'STRIP-RESULTS:' + JSON.stringify(rows)
document.body.appendChild(result)
</script></body></html>`
  const pagePath = join(scratch, 'probe.html')
  writeFileSync(pagePath, page, 'utf8')
  const dom = execFileSync(chrome, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars',
    `--user-data-dir=${join(scratch, 'profile')}`,
    '--window-size=1100,900', '--virtual-time-budget=3000', '--dump-dom', pathToFileURL(pagePath).href,
  ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })
  const match = /<pre id="results">STRIP-RESULTS:([\s\S]*?)<\/pre>/u.exec(dom)
  if (match === null) throw new Error('Chromium returned no strip measurements')
  const measurements = JSON.parse(match[1].replace(/&quot;/gu, '"').replace(/&amp;/gu, '&'))

  let failed = false
  for (const row of measurements) {
    console.log(`seat ${row.seat}px -> shell ${row.shell.w}x${row.shell.h}px, row ${row.row.w}x${row.row.h}px, bar ${row.bar.w}x${row.bar.h}`)
    console.log(`  left ${row.left.w}x${row.left.h}, logo ${row.logo.w}x${row.logo.h}, right ${row.right.w}x${row.right.h}, stats ${row.stats.w}x${row.stats.h}, actions ${row.actions.w}x${row.actions.h}`)
    console.log(`  stat widths [${row.statWidths.join(', ')}], action widths [${row.actionWidths.join(', ')}]`)
    console.log(`  right x=${row.right.x}..${row.right.right}: ${row.rightChildren.map((child) => `${child.className}:${child.box.x}..${child.box.right}`).join(' | ')}`)
    console.log(`  visible stat labels [${row.visibleStatLabels.join(', ')}]`)
    const checks = [
      ['one-line bar', !row.barWraps],
      ['no horizontal overflow', !row.horizontalOverflow],
      ['the right flank neither overflows nor overlaps', !row.rightOverflow && !row.rightOverlap && !row.rightChildrenOutside],
      ['no vertical overflow', !row.verticalOverflow],
      ['the shell cannot collapse or clip its row', row.shell.h >= 48 && row.row.h >= 46 && !row.shellVerticalOverflow && !row.rowOutsideShell],
      ['every counter keeps a visible label', row.visibleStatLabels.length === 4],
      ['all children stay inside the bar', !row.descendantsOutsideBar],
    ]
    for (const [label, passed] of checks) {
      console.log(`  ${passed ? 'PASS' : 'FAIL'}  ${label}`)
      if (!passed) failed = true
    }
  }
  if (failed) process.exitCode = 1
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
