// Audit every element on the rendered panel and report its computed border-radius, worst offenders first.
//
// The radius scale lives in THREE layers — theme.js has hand-written rules, and design.js / polish.js override some of
// them. An element still reading `var(--sr-r-pill)` in the base layer is a pill unless a later pass happens to name it,
// so which elements are pills is not answerable by reading any one file. This asks the browser.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const chrome = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find((p) => existsSync(p))
if (chrome === undefined) {
  console.error('no Chromium')
  process.exit(1)
}

const preview = readFileSync(join(root, 'tools', 'preview.html'), 'utf8')
const sandbox = mkdtempSync(join(tmpdir(), 'echocat-radius-'))
try {
  const script = [
    'const counts=new Map()',
    'const big=[]',
    'for(const el of document.querySelectorAll("[class*=sr-]")){',
    '  const cs=getComputedStyle(el)',
    '  const r=cs.borderTopLeftRadius',
    '  if(r==="0px") continue',
    '  const cls=(el.getAttribute("class")||"").split(/\\s+/).filter(c=>c.indexOf("sr-")===0).join(".")',
    '  const key=cls+"  =>  "+r',
    '  counts.set(key,(counts.get(key)||0)+1)',
    '  if(parseFloat(r)>=20) big.push(cls+" => "+r)',
    '}',
    'const rows=[...counts.entries()].sort((a,b)=>a[0].localeCompare(b[0]))',
    'const out=["--- every distinct (class, radius) pair ---"]',
    'for(const [k,v] of rows) out.push("  x"+v+"  "+k)',
    'out.push("")',
    'out.push("--- elements with radius >= 20px (pill territory) ---")',
    'for(const b of big) out.push("  "+b)',
    'const pre=document.createElement("pre");pre.id="r";pre.textContent="AUDIT:"+out.join("\\n");document.body.appendChild(pre)',
  ].join('\n')

  const page = join(sandbox, 'a.html')
  writeFileSync(page, preview.replace('</body>', '<script>' + script + '</script></body>'), 'utf8')

  const dom = execFileSync(chrome, [
    '--headless=new', '--disable-gpu', '--no-first-run', `--user-data-dir=${join(sandbox, 'p')}`,
    '--window-size=1400,1000', '--virtual-time-budget=4000', '--dump-dom', pathToFileURL(page).href,
  ], { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 })

  const found = /AUDIT:([\s\S]*?)<\/pre>/u.exec(dom)
  if (found === null) {
    console.error('no audit output')
    process.exitCode = 1
  } else {
    for (const line of found[1].split('\n')) console.log(line)
  }
} finally {
  rmSync(sandbox, { recursive: true, force: true })
}
