// Close-up screenshot of the skill catalogue, so a design change is judged by looking.
//
// The full-panel preview is 2100px wide and gets downscaled for review, which hid the fact that
// the avatar row was stretching. This shoots the catalogue region only, at 3x.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const pkgRoot = resolve(here, '..')
const chrome = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find((c) => existsSync(c))

function css() {
  const b = readFileSync(join(pkgRoot, 'lib', 'client.js'), 'utf8')
  const h = /^\t\t\t"(\.[^"]+)": function \(module, exports, require\) \{$/gmu
  const marks = []
  let m
  while ((m = h.exec(b)) !== null) marks.push({ id: m[1], end: h.lastIndex, at: m.index })
  const mods = new Map()
  for (let i = 0; i < marks.length; i += 1) {
    const stop = i + 1 < marks.length ? marks[i + 1].at : b.length
    mods.set(marks[i].id, b.slice(marks[i].end, stop).replace(/\},?\s*$/u, ''))
  }
  const c = new Map()
  const load = (id) => {
    const k = id.startsWith('./') ? id : `./${id}`
    if (c.has(k)) return c.get(k)
    const mod = { exports: {} }
    c.set(k, mod.exports)
    new Function('module', 'exports', 'require', mods.get(k))(mod, mod.exports, (s) => {
      if (s === 'react') return { createElement: () => null, useSyncExternalStore: () => null, useState: () => [], useEffect: () => {}, useCallback: (f) => f, useMemo: (f) => f(), useRef: () => ({ current: null }) }
      if (s === 'react-dom') return {}
      if (s.startsWith('./')) return load(s)
      throw new Error('unexpected ' + s)
    })
    c.set(k, mod.exports)
    return mod.exports
  }
  return String(load('./theme.js').CSS)
}

/** Mirrors tools/preview.mjs fixtures, with one skill marked so the colour path is visible. */
const SKILLS = [
  { initial: 'C', zh: '电影9格故事版', name: 'cinema-dna-21x9x3', tag: '影视', used: 19, color: 'indigo',
    blurb: '把故事转译成电影感 21:9 单帧、三联镜头或九镜故事板，锁住人物与风格一致性。', src: 'VDERR/echocat-skill-panel-3.0' },
  { initial: 'H', zh: '', name: 'h3-prompt-writing', tag: '提示词', used: 14, color: '',
    blurb: '为 T2VA、I2VA、FL2VA、L2VA 与 Ref2VA 写 MiniMax H3 视频提示词。', src: 'VDERR/echocat-skill-panel-3.0' },
  { initial: 'G', zh: '图像生成', name: 'gpt-image', tag: '图像', used: 14, color: 'teal',
    blurb: '用 GPT Image 2 生成或编辑图片，支持海报、排版、中文文字与 UI 稿。', src: 'VDERR/echocat-skill-panel-3.0' },
  { initial: 'M', zh: '音乐视频字幕', name: 'music-video-subtitle-generator', tag: '音乐', used: 9, color: '',
    blurb: '按节拍与唱词切分长片，设计随拍律动的空间排版。', src: 'VDERR/echocat-skill-panel-3.0' },
  { initial: 'P', zh: '', name: 'paper-collage-explainer-generator', tag: '教育', used: 5, color: 'amber',
    blurb: 'tactile paper-collage language for narration and knowledge points.', src: 'VDERR/echocat-skill-panel-3.0' },
]

const card = (s) => `
  <div class="sr-skill">
    <div class="sr-skill-head">
      <button type="button" class="sr-avatar-btn"><span class="sr-avatar${s.color ? ' sr-avatar--marked' : ''}" ${s.color ? `style="background:${({ indigo: '#5b5bd6', teal: '#0d9488', amber: '#d97706' })[s.color]};color:#fff"` : ''}>${s.initial}</span></button>
      <div class="sr-skill-headtext">
        <span class="sr-skill-name">${s.zh || s.name}</span>
        ${s.zh ? `<div class="sr-skill-slug">/${s.name}</div>` : ''}
      </div>
      <div class="sr-skill-tags">
        ${s.tag ? `<span class="sr-tag">${s.tag}</span>` : ''}
        ${s.used > 0 ? `<span class="sr-tag sr-tag--used">用过 ${s.used} 次</span>` : ''}
      </div>
    </div>
    <div class="sr-skill-main">
      <div class="sr-blurb">${s.blurb}</div>
      <div class="sr-src"><span class="sr-src-dot"></span><span class="sr-src-text">${s.src}</span></div>
    </div>
    <div class="sr-card-foot">
      <div class="sr-row-actions">
        <button type="button" class="sr-btn sr-btn--sm sr-btn--toggle sr-btn--on"><span class="sr-switch"><span class="sr-switch-knob"></span></span></button>
        <button type="button" class="sr-btn sr-btn--sm sr-btn--primary">引用</button>
        <button type="button" class="sr-btn sr-btn--sm">中文名</button>
        <button type="button" class="sr-btn sr-btn--sm sr-btn--icon">link</button>
        <button type="button" class="sr-btn sr-btn--sm sr-btn--danger sr-btn--icon">del</button>
      </div>
    </div>
  </div>`

const sandbox = mkdtempSync(join(tmpdir(), 'echocat-closeup-'))
try {
  const page = (dark) => `<!doctype html><meta charset="utf-8"><style>
  :root{--dsh-conversation-column-width:1440px;--dsh-chat-content-width:clamp(680px,calc(var(--dsh-conversation-column-width,0px)*.64),920px);--dsh-composer-card-max-width:calc(var(--dsh-chat-content-width) + 32px)}
  *{box-sizing:border-box}html,body{margin:0}
  body{background:var(--dsw-alias-bg-base, #fff)}
  .frame{width:940px;margin:0 auto;padding:16px}
  /* Debug outlines, toggled by ?boxes=1: shows which box is which instead of guessing at a
     shape in a screenshot. */
  body.boxes .sr-skill *{outline:1px dashed rgba(220,38,38,.75);outline-offset:-1px}
  body.boxes .sr-tag{outline-color:rgba(13,148,136,.9)}
  body.boxes .sr-avatar,body.boxes .sr-btn{outline-color:rgba(79,70,229,.9)}
  </style><style id="p">${css()}</style>
  <div class="frame"><div class="sr-root"${dark ? ' class="sr-root dark"' : ''}>
    <header class="sr-head"><span class="sr-title">技能调用报告</span><span class="sr-status">更新 05:31:41</span></header>
    <div class="sr-body"><div class="sr-group">
      <div class="sr-group-head"><span class="sr-group-title">已启用</span><span class="sr-pill">5</span><span class="sr-group-note">模型与 / 手势都能用</span></div>
      <div class="sr-grid">${SKILLS.map(card).join('')}</div>
    </div></div>
  </div></div>
  <script>
    // ?boxes=1 turns the debug outlines on, so a screenshot can name the boxes it shows.
    if (new URLSearchParams(location.search).get('boxes') === '1') document.body.classList.add('boxes')
  </script>`
  writeFileSync(join(sandbox, 'light.html'), page(false), 'utf8')
  writeFileSync(join(sandbox, 'dark.html'), page(true), 'utf8')
  for (const [name, file, query] of [
    ['closeup-light', 'light.html', ''],
    ['closeup-dark', 'dark.html', ''],
    ['closeup-boxes', 'light.html', '?boxes=1'],
  ]) {
    const out = join(here, `${name}.png`)
    execFileSync(chrome, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${join(sandbox, name)}`, '--window-size=980,900', '--force-device-scale-factor=2', '--hide-scrollbars', '--virtual-time-budget=3000', `--screenshot=${out}`, pathToFileURL(join(sandbox, file)).href + query], { stdio: 'ignore' })
    console.log('wrote ' + out)
  }
} finally {
  rmSync(sandbox, { recursive: true, force: true })
}
