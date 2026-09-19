// Skill-report surfaces — presentational.
//
// AUTHORING NOTE: this file is a *bundle source*, not a Node module. It is
// written as CommonJS because tools/build-client.mjs inlines it verbatim into
// the lazy-CJS factory DSH's client module system loads. Running it directly
// with `node` is not supported — `require` and `module` only exist inside the
// factory.
//
// Three surfaces share one visual language:
//   SkillReportPanel  the full report (centre `main` slot, and inside the strip)
//   SkillReportIcon   the resident left-sidebar glyph (`sidebar.panellist`)
//   SkillReportStrip  the summary strip above the composer (`conversation.input.dock`)
// Only the strip fetches nothing itself: src/client/source.js owns the read
// store and src/client/api.js owns the write path, both passed/hooked in here.
//
// Styling lives in src/client/theme.js, injected the way the shipped client
// bundles do it (`<style data-plugin data-plugin-css>`, side effect inside the
// factory), so `@deepseek-ai/dsh-client-hmr` can remove it on reload.
//
// Polish items in this revision
// ----------------------------
//   1. collapsible sections, with the open/closed state persisted per section
//   2. section headers: count pill, hover feedback, rotating chevron, aria-expanded
//   3. skill cards in a responsive grid, so a long list stays compact
//   4. live filter box over skill name + blurb + tag
//   5. sticky header that grows a hairline shadow once the body scrolls
//   6. stat cards: equal-width, large tabular numerals, hover lift
//   7. the current turn promoted into a tinted card with an accent rail
//   8. channel badges differentiated by colour (model neutral / manual accent)
//   9. recent turns as a timeline rail with dots and an outcome chip
//  10. empty states carry a glyph instead of bare grey text
//  11. themed thin scrollbar + contained overscroll
//  12. `prefers-reduced-motion` honoured
//  13. dark-scheme fallbacks for every token
//  14. one consistent focus-visible ring, keyboard-operable headers
//  15. composer strip: turn-count chip, rotating chevron, hover tint
//  16. inline SVG icon set (icons.js) — no emoji, no triangle text glyphs
//  17. skeleton shimmer placeholders on first load
//  18. stat values count up on change; tabular numerals; reduced-motion aware
//  19. hero sparkline: last ~12 turns' invocation counts, line + area fill
//  20. per-skill share bars in 按 skill (relative usage weight)
//  21. segmented control for 最近回合 (全部 / 有 skill / 未调用), sliding indicator
//  22. recent turns are an accordion; the newest is open, the rest collapsed
//  23. status rail (toasts) for async results, aria-live, auto-dismiss on success
//  24. sheet: backdrop blur, Esc, focus trap, scroll lock, entrance/exit motion
//  25. install tabs are equal-width cells, and the selected tab draws its own
//      underline as a `::after` pseudo-element: no runtime measurement, so the
//      marker is exact by construction. (An earlier version divided the track by
//      the tab count and slid a separate marker, but the tabs were content-width
//      and the marker landed between tabs.) Arrow-key navigation.
//  25b. colour is carried by borders, badges and a single accent hue — the fill
//      tokens are neutral greys, because tinted app fill tokens used as large
//      container backgrounds made the panel read as washed-out blue boxes
//  26. form craft: real labels, helper text, inline validation, char counter,
//      primary disabled until valid
//  27. drag-and-drop target with a highlighted drop state
//  28. hidden file input behind a styled 选择文件 button
//  29. copy-to-clipboard for skill name and skills root, with 已复制 + fallback
//  30. REMOVED — the footer's list-spacing toggle. Two states were not worth a
//      footer slot on a panel this small, and a value left in the shared preference
//      object by an older build is simply ignored (nothing reads that key any more).
//  31. sort control (名称 / 最近修改 / 调用次数) with a direction toggle
//  32. quick filter chips: 仅可 `/` 调用 + tag chips from skill.tag
//  33. deterministic per-skill avatar (initial letter, hue from a name hash)
//  34. sticky per-section headers inside the scroll body
//  35. scroll fade masks at the top and bottom of the scroll body
//  36. row actions on a skill card (引用 / 复制名称 / 删除)
//  37. keyboard shortcuts with a discoverable hint: `/` filter, r refresh,
//      n install, Esc close/clear
//  38. footer status line: version, reachability, skills root (copyable),
//      writable badge, git badge, and capability.reason when disabled
//  39. timeline rail: per-turn outcome colour plus a "now" pulse on the newest
//  40. responsive: single column under 560px, stats 2x2, hero wraps, sheet full-height
//  41. themed ::selection and caret colour
//  42. reduced-transparency fallback for the backdrop blur
//  43. "this turn used nothing" gets its own calm signal — a muted amber dot and a
//      未使用 chip in the strip, the hero and the turn rail; never the error red
//  44. per-skill usage totals joined into the cards (用过 N 次) plus a 用过的 quick
//      filter that only appears once something has actually been used
//  45. the reading position survives the panel being unmounted, per surface,
//      clamped to the content that is there now
//  46. one guidance block replaces the three separate "nothing here yet"
//      placeholders when there is neither history nor an installed skill
//  47. a finished install offers to write /name straight into the composer, from
//      the sheet's own status area — and only where the seat can reach the draft

const React = require('react')
const { Icon } = require('./icons.js')
// Requiring the theme also injects it — the side effect is the point.
const { VERSION } = require('./theme.js')
const api = require('./api.js')
const { InstallSheet, SkillRowActions, LiveRail, copyText } = require('./install.js')
const { checkForUpdates, useUpdates } = require('./source.js')

const h = React.createElement

const pad = (n) => String(n).padStart(2, '0')

/** `HH:MM:SS` in local time; `--:--:--` for a missing timestamp. */
function clock(ts) {
  if (typeof ts !== 'number' || !Number.isFinite(ts)) return '--:--:--'
  const d = new Date(ts)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** `3 分钟前` style relative age, falling back to the absolute clock. */
function ago(ts, now) {
  if (typeof ts !== 'number' || !Number.isFinite(ts)) return '—'
  const seconds = Math.max(0, Math.round(((typeof now === 'number' ? now : Date.now()) - ts) / 1000))
  if (seconds < 60) return `${seconds} 秒前`
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前`
  return clock(ts)
}

const EMPTY = {
  turns: 0,
  turnsWithSkills: 0,
  turnsWithoutSkills: 0,
  invocations: 0,
  perSkill: [],
  recent: [],
  skills: [],
  capability: undefined,
  installHistory: [],
}

/** `本轮 gpt-image（模型自动）` — the one-line answer. */
function summarize(row) {
  if (row === undefined) return '还没有完成的回合'
  if (row.calls.length === 0) return '本轮未调用 skill'
  return `本轮 ${row.calls.map((c) => `${c.name}（${c.how === 'user' ? '你手动 /' : '模型自动'}）`).join('、')}`
}

/* ------------------------------ derivations ------------------------------ */

/** Invocation counts for the last `n` turns, oldest first (sparkline order). */
function histogram(recent, n = 12) {
  const rows = Array.isArray(recent) ? recent.slice(0, n) : []
  return rows.reverse().map((row) => (Array.isArray(row.calls) ? row.calls.length : 0))
}

/**
 * Polyline + area for the hero sparkline (polish item 19).
 *
 * Pure geometry, so the bundle test can pin the maths without a DOM. A single
 * sample is centred rather than pinned to x=0, which would look like a bug.
 */
function sparkline(values, width = 104, height = 34, padY = 3) {
  const list = Array.isArray(values) ? values.filter((v) => typeof v === 'number' && Number.isFinite(v)) : []
  const max = list.length === 0 ? 0 : Math.max(...list, 1)
  const span = Math.max(1, height - padY * 2)
  const step = list.length <= 1 ? 0 : width / (list.length - 1)
  const points = list.map((value, i) => {
    const x = list.length <= 1 ? width / 2 : i * step
    const y = height - padY - (max === 0 ? 0 : (value / max) * span)
    return [Math.round(x * 100) / 100, Math.round(y * 100) / 100]
  })
  const line = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x} ${y}`).join(' ')
  const area = points.length === 0 ? '' : `${line} L${points[points.length - 1][0]} ${height} L${points[0][0]} ${height} Z`
  return { line, area, points, max, count: list.length }
}

const DEFAULT_DIR = { name: 'asc', recent: 'desc', count: 'desc' }

/** Sort a catalog copy. Missing `modifiedAt` sorts last, and ties fall back to name. */
function sortSkills(skills, key = 'name', dir, counts) {
  const list = Array.isArray(skills) ? [...skills] : []
  const direction = dir ?? DEFAULT_DIR[key] ?? 'asc'
  const sign = direction === 'desc' ? -1 : 1
  const count = (name) => (counts !== null && typeof counts === 'object' && typeof counts[name] === 'number' ? counts[name] : 0)
  list.sort((a, b) => {
    const byName = String(a.name).localeCompare(String(b.name))
    if (key === 'count') return sign * (count(a.name) - count(b.name)) || byName
    if (key === 'recent') {
      const av = typeof a.modifiedAt === 'number' ? a.modifiedAt : 0
      const bv = typeof b.modifiedAt === 'number' ? b.modifiedAt : 0
      return sign * (av - bv) || byName
    }
    return sign * byName
  })
  return list
}

/** Query + chip filter, shared by the toolbar and its "no match" empty state. */
function filterSkills(skills, options = {}) {
  const query = typeof options.query === 'string' ? options.query.trim().toLowerCase() : ''
  const tag = typeof options.tag === 'string' ? options.tag : ''
  const onlySlash = options.onlySlash === true
  // "用过的" (item 44) is driven by the per-skill totals the host already sends.
  const onlyUsed = options.onlyUsed === true
  const counts = options.counts !== null && typeof options.counts === 'object' ? options.counts : {}
  return (Array.isArray(skills) ? skills : []).filter((skill) => {
    if (onlySlash && skill.modelInvocable === false) return false
    if (onlyUsed && !(typeof counts[skill.name] === 'number' && counts[skill.name] > 0)) return false
    if (tag !== '' && skill.tag !== tag) return false
    if (query === '') return true
    const hay = `${skill.name} ${skill.descriptionZh ?? ''} ${skill.description ?? ''} ${skill.tag ?? ''}`.toLowerCase()
    return hay.includes(query)
  })
}

/** How many installed skills have actually been invoked (item 44). */
function usedSkillCount(skills, counts) {
  const map = counts !== null && typeof counts === 'object' ? counts : {}
  return (Array.isArray(skills) ? skills : []).filter((skill) => typeof map[skill.name] === 'number' && map[skill.name] > 0).length
}

/** Distinct tags with their counts, most common first — the chip row's data. */
function tagsOf(skills) {
  const seen = new Map()
  for (const skill of Array.isArray(skills) ? skills : []) {
    if (typeof skill.tag === 'string' && skill.tag !== '') seen.set(skill.tag, (seen.get(skill.tag) ?? 0) + 1)
  }
  return [...seen.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
}

/** `name -> count` lookup for the share bars and the 调用次数 sort. */
function countMap(perSkill) {
  const map = {}
  for (const entry of Array.isArray(perSkill) ? perSkill : []) {
    if (entry !== null && typeof entry === 'object' && typeof entry.name === 'string') map[entry.name] = entry.count
  }
  return map
}

/* ------------------------------ persisted prefs ------------------------------ */

const OPEN_KEY = 'echocat-skill-panel-3.0/sections'
const PREF_KEY = 'echocat-skill-panel-3.0/prefs'

const storage = () => {
  // `document` is the environment probe on purpose: Node exposes a
  // `localStorage` global that warns loudly and then throws when no backing file
  // was configured, so merely reading it is already a side effect.
  if (typeof document === 'undefined' || typeof localStorage === 'undefined') return null
  return localStorage
}

function readJson(key) {
  try {
    const store = storage()
    if (store === null) return {}
    const parsed = JSON.parse(store.getItem(key) ?? 'null')
    return parsed !== null && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeJson(key, value) {
  try {
    const store = storage()
    if (store === null) return
    store.setItem(key, JSON.stringify(value))
  } catch {
    // Persistence is a convenience; hostile storage must not break the panel.
  }
}

/**
 * Section open state, remembered across remounts and restarts.
 *
 * `skills` starts collapsed: it is the one section that grows without bound, and
 * an expanded 10-row catalog pushes everything else off screen.
 */
function useSection(id, defaultOpen) {
  const [open, setOpen] = React.useState(() => {
    const stored = readJson(OPEN_KEY)[id]
    return typeof stored === 'boolean' ? stored : defaultOpen
  })
  const toggle = React.useCallback(() => {
    setOpen((value) => {
      const next = !value
      const all = readJson(OPEN_KEY)
      all[id] = next
      writeJson(OPEN_KEY, all)
      return next
    })
  }, [id])
  return [open, toggle]
}

/** Sort / chip preferences (polish items 31-32), persisted together. */
function usePref(key, fallback) {
  const [value, setValue] = React.useState(() => {
    const stored = readJson(PREF_KEY)[key]
    return stored === undefined ? fallback : stored
  })
  const update = React.useCallback(
    (next) => {
      setValue(next)
      const all = readJson(PREF_KEY)
      all[key] = next
      writeJson(PREF_KEY, all)
    },
    [key],
  )
  return [value, update]
}

/* ------------------------------ scroll memory ------------------------------ */

const SCROLL_KEY = 'echocat-skill-panel-3.0/scroll'

/**
 * Clamp a remembered offset to what the node can actually scroll (item 45).
 *
 * A stored offset outlives the content that produced it — the catalogue may have
 * shrunk since, or the window may be taller on the next mount. Restoring an offset
 * past the end silently parks the user at the bottom of a shorter list, so the
 * value is clamped to `scrollHeight - clientHeight`. Pure, so the test can pin the
 * arithmetic without a DOM.
 */
function clampScroll(offset, scrollHeight, clientHeight) {
  const height = typeof scrollHeight === 'number' && Number.isFinite(scrollHeight) ? scrollHeight : 0
  const view = typeof clientHeight === 'number' && Number.isFinite(clientHeight) ? clientHeight : 0
  const max = Math.max(0, height - view)
  if (typeof offset !== 'number' || !Number.isFinite(offset) || offset <= 0) return 0
  return Math.min(offset, max)
}

/**
 * Remember where the user was reading (polish item 45).
 *
 * `main` is a KEYED slot: the centre panel is unmounted the moment the user
 * switches back to the conversation. Without this the report always came back
 * scrolled to the top, which is the worst possible behaviour for the one thing
 * this panel is — a long list you scroll through.
 *
 * @param scrollKey - stable id, one per surface. `null`/`''` opts out: the strip's
 *   expanded panel does, because it is 46vh of transient detail that is rebuilt
 *   under the bar on every open.
 * @param onScroll - the caller's own scroll bookkeeping, still called.
 * @returns `{ rootRef, onScroll }` — attach both to the scrolling element.
 */
function useScrollMemory(scrollKey, onScroll) {
  const rootRef = React.useRef(null)
  const restored = React.useRef(false)
  const enabled = typeof scrollKey === 'string' && scrollKey !== ''

  // Deliberately no dependency array: this runs after EVERY commit until it
  // succeeds. On the first commits there may be nothing to scroll yet (the
  // skeleton, or a list shorter than the viewport), and marking the restore as
  // done then would throw the remembered position away for good.
  React.useEffect(() => {
    if (restored.current === true) return
    if (!enabled) {
      restored.current = true
      return
    }
    // Read first: whether there is anything to restore does not depend on the DOM,
    // and the read is idempotent, so a missing node can simply retry on a later
    // commit without losing the parse.
    const stored = readJson(SCROLL_KEY)[scrollKey]
    const node = rootRef.current
    if (node === null || node === undefined) return
    if (typeof stored !== 'number') {
      restored.current = true
      return
    }
    const target = clampScroll(stored, node.scrollHeight, node.clientHeight)
    if (target <= 0) {
      // Still nothing scrollable — retry on a later commit. A stored 0 (or a
      // negative/garbage value) means there is genuinely nothing to restore.
      if (stored > 0) return
      restored.current = true
      return
    }
    node.scrollTop = target
    restored.current = true
  })

  // Written straight through, with no debounce and no timer to clean up.
  //
  // The obvious design — coalesce with a trailing timer — needs a pending timer
  // that outlives the component, because the panel is unmounted as a matter of
  // course (that is the entire reason this hook exists). What is being written is
  // a ~40-byte JSON under one key, which is orders of magnitude cheaper than the
  // machinery that would avoid writing it, so the simple version is also the
  // correct one.
  //
  // No gate on the restore is needed either: effects run at commit, before the
  // browser can dispatch any input event, so the element's initial scrollTop of 0
  // can never reach the store ahead of the remembered value.
  const remember = React.useCallback(
    (event) => {
      const node = event?.currentTarget
      if (enabled) {
        const top = typeof node?.scrollTop === 'number' ? node.scrollTop : 0
        const all = readJson(SCROLL_KEY)
        all[scrollKey] = top
        writeJson(SCROLL_KEY, all)
      }
      onScroll?.(event)
    },
    [enabled, scrollKey, onScroll],
  )

  return { rootRef, onScroll: remember }
}

/* ------------------------------ small pieces ------------------------------ */

/** Collapsible section: the header row is the toggle, the count rides in a pill. */
function Section({ id, title, count, defaultOpen = true, actions, children }) {
  const [open, toggle] = useSection(id, defaultOpen)
  return h(
    'section',
    { className: 'sr-sec' },
    // Sticky inside the scroll body (item 34); the actions sit OUTSIDE the
    // toggle button, because a button inside a button is invalid and eats clicks.
    h(
      'div',
      { className: 'sr-sec-head' },
      h(
        'button',
        { type: 'button', className: 'sr-sec-h', 'aria-expanded': open, 'aria-controls': `sr-body-${id}`, onClick: toggle },
        h(Icon, { name: 'caret', size: 11, className: 'sr-sec-caret' }),
        h('span', { className: 'sr-sec-t' }, title),
        count === undefined ? null : h('span', { className: 'sr-pill' }, String(count)),
      ),
      actions === undefined ? null : h('div', { className: 'sr-sec-actions' }, actions),
    ),
    open ? h('div', { className: 'sr-sec-b', id: `sr-body-${id}` }, children) : null,
  )
}

function HowBadge({ how }) {
  const manual = how === 'user'
  return h('span', { className: manual ? 'sr-badge sr-badge--user' : 'sr-badge' }, manual ? '你手动 /' : '模型自动')
}

function CallRow({ call }) {
  return h('div', { className: 'sr-call' }, h('span', { className: 'sr-call-name' }, call.name), h(HowBadge, { how: call.how }))
}

/** True when the OS asks for less motion; guarded — Node has no window. */
function prefersReducedMotion() {
  try {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches === true
  } catch {
    return true
  }
}

/**
 * Count a stat up to its new value (polish item 18).
 *
 * Degrades to "show the number" whenever animation is unavailable or unwanted —
 * including under Node, which is what keeps the bundle test deterministic.
 */
function useCountUp(target) {
  const value = typeof target === 'number' && Number.isFinite(target) ? target : 0
  const [shown, setShown] = React.useState(value)
  const fromRef = React.useRef(value)
  React.useEffect(() => {
    const from = fromRef.current
    fromRef.current = value
    if (from === value) return undefined
    if (prefersReducedMotion() || typeof requestAnimationFrame !== 'function') {
      setShown(value)
      return undefined
    }
    const start = typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now()
    let handle = null
    const tick = () => {
      const nowMs = typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now()
      const progress = Math.min(1, (nowMs - start) / 260)
      setShown(Math.round(from + (value - from) * progress))
      if (progress < 1) handle = requestAnimationFrame(tick)
    }
    handle = requestAnimationFrame(tick)
    return () => {
      if (handle !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(handle)
    }
  }, [value])
  return shown
}

function Stat({ label, value }) {
  const shown = useCountUp(value)
  return h('div', { className: 'sr-stat' }, h('span', { className: 'sr-stat-v' }, String(shown)), h('span', { className: 'sr-stat-l' }, label))
}

function Empty({ children }) {
  return h('div', { className: 'sr-empty' }, children)
}

/** First-load placeholder (item 17) — shimmer, never a bare grey sentence. */
function Skeleton({ rows = 3 }) {
  return h(
    'div',
    { className: 'sr-skel-wrap', 'aria-busy': 'true' },
    h('span', { className: 'sr-sr-only' }, '正在读取…'),
    h('div', { className: 'sr-skel sr-skel--line', style: { width: '42%' } }),
    ...Array.from({ length: rows }, (_, i) =>
      h('div', { key: i, className: 'sr-skel sr-skel--card', style: { opacity: 1 - i * 0.18 } }),
    ),
  )
}

function Sparkline({ values, label = '最近回合调用次数' }) {
  const geo = sparkline(values)
  if (geo.count === 0) return null
  // A flat series draws a flat line, which reads as a stray horizontal rule with
  // two end marks rather than as a chart — and it carries no information either.
  // Two points is the minimum that can show a shape, and one non-zero value is the
  // minimum that can show anything at all.
  const peak = values.reduce((max, value) => (Number.isFinite(value) && value > max ? value : max), 0)
  if (values.length < 2 || peak === 0) return null
  const last = geo.points[geo.points.length - 1]
  return h(
    'svg',
    { className: 'sr-spark', viewBox: '0 0 104 34', preserveAspectRatio: 'none', role: 'img', 'aria-label': label },
    geo.area === '' ? null : h('path', { className: 'sr-spark-fill', d: geo.area }),
    h('path', { className: 'sr-spark-line', d: geo.line }),
    h('circle', { className: 'sr-spark-dot', cx: last[0], cy: last[1], r: 2.1 }),
  )
}

/** Deterministic avatar (item 33): hue from a name hash, never a random palette. */
function Avatar({ name }) {
  const hue = api.hueOf(name)
  return h(
    'span',
    {
      className: 'sr-avatar',
      style: { background: `hsl(${hue} 52% 44%)`, color: '#fff' },
      'aria-hidden': 'true',
    },
    api.initial(name),
  )
}

function SkillRow({ skill, counts, onUse, capability, onChanged, update }) {
  const chinese = typeof skill.descriptionZh === 'string' && skill.descriptionZh !== ''
  const blurb = chinese ? skill.descriptionZh : skill.description
  const used = typeof counts?.[skill.name] === 'number' ? counts[skill.name] : 0
  const zh = typeof skill.displayNameZh === 'string' ? skill.displayNameZh : ''
  // The Chinese name is what the user recognises, so it leads; the slug stays
  // visible underneath because it is the IDENTITY — it is what `/名字` types and
  // what 引用 inserts, and hiding it would make the two impossible to connect.
  const title = zh === '' ? skill.name : zh
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [note, setNote] = React.useState('')

  const startEdit = React.useCallback(() => {
    setDraft(zh)
    setNote('')
    setEditing(true)
  }, [zh])

  const save = React.useCallback(() => {
    const value = draft.trim()
    // The host's two rules, checked here so a refusal costs no round trip.
    if ([...value].length > 40) {
      setNote('最多 40 个字')
      return
    }
    if (/[\u0000-\u001f\u007f]/u.test(value)) {
      setNote('不能包含换行或控制字符')
      return
    }
    setBusy(true)
    setNote('')
    // The outcome (including a failure, with its message and hint) lands in the
    // status rail; the editor closes either way rather than trapping the user.
    void api
      .performRename(skill.name, value, {
        onDone: () => {
          setEditing(false)
          setBusy(false)
          if (typeof onChanged === 'function') onChanged()
        },
      })
      .then(() => setBusy(false))
  }, [draft, skill.name, onChanged])

  if (editing) {
    return h(
      'div',
      { className: 'sr-skill sr-skill--editing' },
      h(Avatar, { name: title }),
      h(
        'div',
        { className: 'sr-skill-main' },
        h(
          'div',
          { className: 'sr-rename-row' },
          h('input', {
            className: 'sr-input sr-input--mono sr-rename-input',
            value: draft,
            placeholder: '留空则清除，恢复显示英文名',
            'aria-label': `修改 ${skill.name} 的中文显示名`,
            spellCheck: 'false',
            onChange: (event) => setDraft(event.target.value),
            onKeyDown: (event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                save()
              } else if (event.key === 'Escape') {
                event.preventDefault()
                setEditing(false)
              }
            },
            'data-sr-focusable': 'true',
            'data-sr-autofocus': 'true',
          }),
          h('button', { type: 'button', className: 'sr-btn sr-btn--sm sr-btn--primary', onClick: save, disabled: busy, title: '保存（Enter）' }, '保存'),
          h('button', { type: 'button', className: 'sr-btn sr-btn--sm', onClick: () => setEditing(false), disabled: busy, title: '取消（Esc）' }, '取消'),
        ),
        h(
          'div',
          { className: note === '' ? 'sr-help' : 'sr-help sr-help--bad' },
          h('span', null, note === '' ? `留空则清除；slug 仍是 /${skill.name}` : note),
          h('span', { className: 'sr-counter' }, `${[...draft].length} / 40`),
        ),
      ),
    )
  }

  return h(
    'div',
    { className: 'sr-skill' },
    h(Avatar, { name: title }),
    h(
      'div',
      { className: 'sr-skill-main' },
      h(
        'div',
        { className: 'sr-skill-top' },
        h('span', { className: 'sr-skill-name', title: zh === '' ? skill.name : `${zh}（/${skill.name}）` }, title),
        typeof skill.tag === 'string' && skill.tag !== '' ? h('span', { className: 'sr-tag' }, skill.tag) : null,
        skill.modelInvocable === false ? h('span', { className: 'sr-tag' }, '仅 /') : null,
        // Item 44: the host already sends per-skill totals; showing them here is
        // what turns the catalogue from a static list into a record. The marker
        // rides in the existing top row so the card never grows taller.
        used > 0 ? h('span', { className: 'sr-tag sr-tag--used', title: `本机累计调用 ${used} 次` }, `用过 ${used} 次`) : null,
      ),
      zh === '' ? null : h('div', { className: 'sr-skill-slug', title: `代号 ${skill.name}` }, `/${skill.name}`),
      typeof blurb === 'string' && blurb !== ''
        ? h('div', { className: chinese ? 'sr-blurb' : 'sr-blurb sr-blurb--en', title: blurb }, blurb)
        : null,
      // Where the skill came from, and — when the source has been compared — whether
      // it moved on. Sits in the text column so it can never crowd the buttons.
      h(SourceLine, { skill, update }),
    ),
    h(SkillRowActions, { skill, onUse, capability, onChanged, onEdit: startEdit, update }),
  )
}

/**
 * One line of provenance under a card's blurb.
 *
 * Three states, and the difference between them is the whole point of the feature:
 *   * a comparable source that the host has checked -> 可更新 / 已是最新
 *   * a recorded source whose kind cannot be compared -> the address, no verdict
 *   * no record at all (installed by hand, or by 2.x) -> nothing; the card offers
 *     「标记来源」 instead
 *
 * `claimed` sources are shown as such: the address is what the USER typed, and
 * presenting it as a fact would be the dishonest version of this line.
 */
function SourceLine({ skill, update }) {
  const provenance = skill?.provenance
  const checkbox = update?.result
  const known = provenance !== null && typeof provenance === 'object' && provenance.known === true
  // No record at all: nothing true can be said, and a "来源未知" line on every
  // hand-installed skill would be noise. The card offers 标记来源 instead.
  if (!known) return null
  const label = api.sourceLabel(provenance)
  const claimed = provenance.claimed === true
  const comparable = api.hasSource(provenance) === true
  const checked = update?.phase === 'done' && checkbox !== undefined && checkbox !== null
  const hasUpdate = checked && checkbox.hasUpdate === true
  const failed = checked && typeof checkbox.error === 'string' && checkbox.error !== ''
  const classes = ['sr-src']
  if (hasUpdate) classes.push('sr-src--new')
  else if (failed) classes.push('sr-src--warn')

  const parts = []
  if (claimed) parts.push('标记来源')
  if (label !== '') parts.push(label)
  let verdict = ''
  if (hasUpdate) verdict = '可更新'
  else if (failed) verdict = checkbox.note === '' ? '检查失败' : checkbox.note
  else if (checked) verdict = checkbox.supported === true ? '已是最新' : checkbox.note
  else if (comparable && update?.phase === 'checking') verdict = '检查中…'
  if (verdict !== '') parts.push(verdict)

  return h(
    'div',
    {
      className: classes.join(' '),
      // The full address lives here: available without being in the way of a card
      // that is ~200px wide.
      title:
        [
          claimed ? `来源是你标记的，尚未核对：${provenance.url ?? provenance.repo}` : (provenance.url ?? provenance.repo),
          provenance.ref === '' ? '' : `分支 ${provenance.ref}`,
          provenance.subpath === '' ? '' : `子目录 ${provenance.subpath}`,
          api.locallyEdited(provenance) ? '安装后本地有改动，更新会覆盖它们（旧文件先进备份目录）' : '',
        ]
          .filter((line) => line !== '')
          .join('\n') || label,
    },
    h('span', { className: 'sr-src-dot' }),
    h('span', { className: 'sr-src-text' }, parts.join(' · ')),
  )
}

function StatusLine({ phase, error, fetchedAt, now }) {
  if (phase === 'error') {
    return h('span', { className: 'sr-status sr-status--error', title: error ?? '' }, h('span', { className: 'sr-status-dot' }), `主机侧不可达：${error ?? '未知错误'}`)
  }
  if (phase === 'loading') return h('span', { className: 'sr-status' }, h('span', { className: 'sr-status-dot' }), '正在读取…')
  if (phase === undefined) return null
  return h('span', { className: 'sr-status' }, `更新 ${clock(fetchedAt)} · ${ago(fetchedAt, now)}`)
}

/* ------------------------------ catalog ------------------------------ */

const SORTS = [
  { key: 'name', label: '名称' },
  { key: 'recent', label: '最近修改' },
  { key: 'count', label: '调用次数' },
]

function SkillsSection({ skills, capability, counts, onUse, onInstall, onChanged, phase, filterRef, updates, checking, onCheckUpdate }) {
  const [query, setQuery] = React.useState('')
  const [onlySlash, setOnlySlash] = React.useState(false)
  const [onlyUsed, setOnlyUsed] = React.useState(false)
  const [tag, setTag] = React.useState('')
  const [sortKey, setSortKey] = usePref('sort', 'name')
  const [sortDir, setSortDir] = usePref('sortDir', '')
  const tags = tagsOf(skills)
  const direction = sortDir === '' ? DEFAULT_DIR[sortKey] ?? 'asc' : sortDir
  const shown = sortSkills(filterSkills(skills, { query, onlySlash, onlyUsed, counts, tag }), sortKey, direction, counts)
  const installable = api.canInstall(capability)
  // The chip only exists once something has been used: a filter that can never
  // match anything is furniture, not a tool.
  const usedCount = usedSkillCount(skills, counts)

  const tools =
    skills.length === 0
      ? null
      : h(
          'div',
          { className: 'sr-tools' },
          h(
            'div',
            { className: 'sr-filter' },
            h(
              'span',
              { className: 'sr-field-inline' },
              h(Icon, { name: 'search', size: 12 }),
              h('input', {
                ref: filterRef,
                type: 'search',
                value: query,
                placeholder: `筛选 ${skills.length} 个 skill…`,
                'aria-label': '筛选已安装 skill',
                onChange: (event) => setQuery(event.target.value),
                onKeyDown: (event) => {
                  if (event.key === 'Escape') setQuery('')
                },
              }),
            ),
            h('span', { className: 'sr-count' }, `${shown.length} / ${skills.length}`),
          ),
          h(
            'div',
            { className: 'sr-tools-right' },
            h(
              'div',
              { className: 'sr-chips' },
              usedCount > 0
                ? h(
                    'button',
                    {
                      type: 'button',
                      className: onlyUsed ? 'sr-chip sr-chip--on' : 'sr-chip',
                      'aria-pressed': onlyUsed,
                      onClick: () => setOnlyUsed((value) => !value),
                      title: '只留下本机真正调用过的 skill',
                    },
                    h(Icon, { name: 'spark', size: 10 }),
                    '用过的',
                    h('span', { className: 'sr-count' }, String(usedCount)),
                  )
                : null,
              h(
                'button',
                {
                  type: 'button',
                  className: onlySlash ? 'sr-chip sr-chip--on' : 'sr-chip',
                  'aria-pressed': onlySlash,
                  onClick: () => setOnlySlash((value) => !value),
                  title: '只留下模型可以自己调用的 skill',
                },
                h(Icon, { name: 'check', size: 10 }),
                '仅可 / 调用',
              ),
              ...tags.map((entry) =>
                h(
                  'button',
                  {
                    key: entry.tag,
                    type: 'button',
                    className: tag === entry.tag ? 'sr-chip sr-chip--on' : 'sr-chip',
                    'aria-pressed': tag === entry.tag,
                    onClick: () => setTag((value) => (value === entry.tag ? '' : entry.tag)),
                  },
                  entry.tag,
                  h('span', { className: 'sr-count' }, String(entry.count)),
                ),
              ),
            ),
            h(
              'div',
              { className: 'sr-sort', role: 'group', 'aria-label': '排序方式' },
              ...SORTS.map((entry) =>
                h(
                  'button',
                  {
                    key: entry.key,
                    type: 'button',
                    'aria-pressed': sortKey === entry.key,
                    onClick: () => {
                      setSortKey(entry.key)
                      if (sortKey === entry.key) setSortDir(direction === 'asc' ? 'desc' : 'asc')
                      else setSortDir(DEFAULT_DIR[entry.key] ?? 'asc')
                    },
                  },
                  entry.label,
                ),
              ),
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'sr-btn sr-btn--sm sr-btn--icon',
                onClick: () => setSortDir(direction === 'asc' ? 'desc' : 'asc'),
                title: direction === 'asc' ? '当前升序，点击改为降序' : '当前降序，点击改为升序',
                'aria-label': '切换排序方向',
              },
              h(Icon, { name: direction === 'asc' ? 'caretDown' : 'sort', size: 12 }),
            ),
          ),
        )

  return h(
    Section,
    {
      id: 'skills',
      title: '已安装 skill',
      count: skills.length,
      defaultOpen: false,
      actions: [
        api.installDisabled(capability) || capability?.api !== 1
          ? null
          : h(
              'button',
              {
                key: 'rescan',
                type: 'button',
                className: 'sr-btn sr-btn--sm sr-btn--icon',
                title: '重新扫描 skill 目录',
                'aria-label': '重新扫描 skill 目录',
                onClick: () => void api.performRescan({ onDone: () => onChanged?.() }),
              },
              h(Icon, { name: 'refresh', size: 12 }),
            ),
        installable
          ? h(
              'button',
              {
                key: 'check',
                type: 'button',
                className: 'sr-btn sr-btn--sm sr-btn--icon',
                disabled: checking === true,
                title: checking === true ? '正在检查更新…' : '检查所有 skill 的来源有没有更新',
                'aria-label': '检查 skill 更新',
                onClick: () => void onCheckUpdate?.(),
              },
              h(Icon, { name: 'refresh', size: 12 }),
            )
          : null,
        installable
          ? h(
              'button',
              {
                key: 'install',
                type: 'button',
                className: 'sr-btn sr-btn--sm',
                title: '安装新的 skill（快捷键 n）',
                onClick: () => onInstall?.(),
              },
              h(Icon, { name: 'plus', size: 12 }),
              '安装',
            )
          : null,
      ],
    },
    skills.length === 0
      ? phase === 'ready'
        ? h(Empty, null, '主机侧没有上报 skill')
        : h(Empty, null, '等待主机侧上报')
      : [
          h('div', { key: 'tools' }, tools),
          shown.length === 0
            ? h(Empty, { key: 'none' }, '没有匹配的 skill')
            : h(
                'div',
                { key: 'grid', className: 'sr-grid' },
                shown.map((skill) => h(SkillRow, { key: skill.name, skill, counts, onUse, capability, onChanged, update: updates?.[skill.name] })),
              ),
          onUse === undefined
            ? h('div', { key: 'hint', className: 'sr-hint' }, '在输入框上方的横栏里点「引用」可直接写入对话。')
            : null,
        ],
  )
}

/* ------------------------------ sections ------------------------------ */

function PerSkillSection({ perSkill }) {
  const max = perSkill.reduce((acc, entry) => Math.max(acc, typeof entry.count === 'number' ? entry.count : 0), 0)
  return h(
    Section,
    { id: 'per-skill', title: '按 skill', count: perSkill.length },
    perSkill.length === 0
      ? h(Empty, null, '暂无')
      : perSkill.map((entry) =>
          h(
            'div',
            { key: entry.name, className: 'sr-share' },
            h('span', { className: 'sr-share-name', title: entry.name }, entry.name),
            h('span', { className: 'sr-share-track' }, h('span', { className: 'sr-share-fill', style: { width: `${max === 0 ? 0 : Math.round((entry.count / max) * 100)}%` } })),
            h('span', { className: 'sr-share-n' }, `${entry.count} 次`),
          ),
        ),
  )
}

const TURN_FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'with', label: '有 skill' },
  { key: 'without', label: '未调用' },
]

function RecentSection({ recent, now }) {
  const [filter, setFilter] = React.useState('all')
  const [openAt, setOpenAt] = React.useState(() => (recent[0] === undefined ? null : `${recent[0].at}-0`))
  const rows = recent
    .slice(0, 30)
    .map((row, index) => ({ row, key: `${row.at}-${index}` }))
    .filter(({ row }) => (filter === 'with' ? row.calls.length > 0 : filter === 'without' ? row.calls.length === 0 : true))
  const activeIndex = Math.max(0, TURN_FILTERS.findIndex((entry) => entry.key === filter))
  return h(
    Section,
    { id: 'recent', title: '最近回合', count: recent.length },
    recent.length === 0
      ? h(Empty, null, '暂无')
      : [
          h(
            'div',
            { key: 'seg', className: 'sr-seg', role: 'group', 'aria-label': '过滤最近回合' },
            h('span', {
              className: 'sr-seg-ind',
              style: { width: `calc((100% - 4px) / ${TURN_FILTERS.length})`, transform: `translateX(${activeIndex * 100}%)` },
            }),
            ...TURN_FILTERS.map((entry) =>
              h(
                'button',
                { key: entry.key, type: 'button', 'aria-pressed': filter === entry.key, onClick: () => setFilter(entry.key) },
                entry.label,
              ),
            ),
          ),
          rows.length === 0
            ? h(Empty, { key: 'none' }, '这个筛选下没有回合')
            : h(
                'div',
                { key: 'rail', className: 'sr-time-rail' },
                ...rows.map(({ row, key }, i) => {
                  const open = openAt === key
                  return h(
                    'div',
                    { key, className: `sr-turn${row.calls.length > 0 ? ' sr-turn--hot' : ''}${i === 0 && filter === 'all' ? ' sr-turn--now' : ''}` },
                    h(
                      'button',
                      { type: 'button', className: 'sr-turn-h', 'aria-expanded': open, onClick: () => setOpenAt(open ? null : key) },
                      h(Icon, { name: 'caret', size: 10, className: 'sr-turn-caret' }),
                      h('span', { className: 'sr-time' }, clock(row.at)),
                      h('span', { className: 'sr-turn-title' }, row.sessionTitle === '' ? '（无标题）' : row.sessionTitle),
                      h('span', { className: row.calls.length === 0 ? 'sr-age sr-age--none' : 'sr-age' }, row.calls.length === 0 ? '未使用' : `${row.calls.length} 个`),
                      h('span', { className: 'sr-age' }, ago(row.at, now)),
                    ),
                    open && row.calls.length > 0
                      ? h(
                          'div',
                          { className: 'sr-turn-body' },
                          row.calls.map((call, j) => h(CallRow, { key: `${call.name}-${j}`, call })),
                        )
                      : null,
                  )
                }),
              ),
        ],
  )
}

/* ------------------------------ footer ------------------------------ */

function Footer({ capability, phase, skills, now, fetchedAt }) {
  const [copied, setCopied] = React.useState(false)
  const root = typeof capability?.root === 'string' ? capability.root : ''
  const apiOn = capability?.api === 1
  const writable = capability?.writable === true
  const git = api.gitState(capability)
  const disabled = api.installDisabled(capability)

  const onCopyRoot = React.useCallback(() => {
    if (root === '') return
    copyText(root, () => {
      setCopied(true)
      if (typeof setTimeout === 'function') setTimeout(() => setCopied(false), 1400)
    })
  }, [root])

  return h(
    'footer',
    { className: 'sr-foot' },
    h('span', { className: 'sr-foot-item' }, h(Icon, { name: 'layers', size: 11 }), `v${VERSION}`),
    h(
      'span',
      { className: phase === 'error' ? 'sr-foot-item sr-badge-warn' : 'sr-foot-item' },
      h('span', { className: 'sr-status-dot', style: { color: phase === 'error' ? 'var(--sr-danger)' : 'var(--sr-ok)' } }),
      phase === 'error' ? '主机侧不可达' : '主机侧已连接',
    ),
    h('span', { className: 'sr-foot-item' }, h(Icon, { name: 'grid', size: 11 }), `${skills.length} 个 skill`),
    root === ''
      ? null
      : h(
          'span',
          { className: 'sr-foot-item' },
          h(Icon, { name: 'folder', size: 11 }),
          h('span', { className: 'sr-foot-mono', title: root }, root),
          h(
            'button',
            { type: 'button', className: 'sr-btn sr-btn--sm sr-btn--icon', onClick: onCopyRoot, title: copied ? '已复制' : `复制路径 ${root}`, 'aria-label': '复制 skills 根目录' },
            h(Icon, { name: copied ? 'check' : 'copy', size: 11 }),
          ),
        ),
    apiOn
      ? h('span', { className: writable ? 'sr-foot-item sr-badge-ok' : 'sr-foot-item sr-badge-warn' }, h(Icon, { name: writable ? 'check' : 'ban', size: 11 }), writable ? '可写' : '只读')
      : null,
    apiOn && git === 'ok' ? h('span', { className: 'sr-foot-item sr-badge-ok' }, h(Icon, { name: 'git', size: 11 }), 'git 可用') : null,
    apiOn && git === 'unavailable' ? h('span', { className: 'sr-foot-item sr-badge-off' }, h(Icon, { name: 'git', size: 11 }), '无 git') : null,
    apiOn && git === 'unknown' ? h('span', { className: 'sr-foot-item sr-badge-off' }, h(Icon, { name: 'clock', size: 11 }), 'git 检测中') : null,
    h('span', { className: 'sr-foot-item' }, h('span', { className: 'sr-kbd' }, '/'), '筛选', h('span', { className: 'sr-kbd' }, 'r'), '刷新', h('span', { className: 'sr-kbd' }, 'n'), '安装', h('span', { className: 'sr-kbd' }, 'Esc'), '关闭'),
    fetchedAt === undefined || fetchedAt === 0 ? null : h('span', { className: 'sr-foot-item' }, `更新于 ${clock(fetchedAt)} · ${ago(fetchedAt, now)}`),
    disabled ? h('span', { className: 'sr-foot-reason' }, `安装不可用：${api.disabledReason(capability)}`) : null,
  )
}

/* ------------------------------ hotkeys ------------------------------ */

/**
 * Global shortcuts (item 37). Deliberately inert while the user is typing, and
 * `Esc` inside a field clears focus rather than closing a dialog.
 */
function useHotkeys({ onFilter, onRefresh, onInstall, onEscape, sheetOpen }) {
  React.useEffect(() => {
    if (typeof document === 'undefined') return undefined
    const onKeyDown = (event) => {
      if (event.metaKey === true || event.ctrlKey === true || event.altKey === true) return
      const target = event.target
      const tag = target === null || target === undefined ? '' : String(target.tagName ?? '').toUpperCase()
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable === true
      if (event.key === '/' && !typing) {
        event.preventDefault()
        onFilter?.()
        return
      }
      if (event.key === 'Escape') {
        if (sheetOpen === true) return
        if (typing) {
          target.blur?.()
          return
        }
        onEscape?.()
        return
      }
      if (typing || sheetOpen === true) return
      if (event.key === 'r') {
        event.preventDefault()
        onRefresh?.()
      } else if (event.key === 'n') {
        event.preventDefault()
        onInstall?.()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onFilter, onRefresh, onInstall, onEscape, sheetOpen])
}

/* ------------------------------ the panel ------------------------------ */

/**
 * The full report.
 *
 * @param props.state - `{ phase, data, error, fetchedAt }` from src/client/source.js.
 * @param props.snapshot - a bare snapshot; overrides `state.data` (used by tests).
 * @param props.onRefresh - refresh handler; omit to hide the button.
 * @param props.onUse - one-click reference handler; omit for a read-only list.
 * @param props.now - clock override, for deterministic renders.
 */
function SkillReportPanel({ state, snapshot, onRefresh, onUse, now, title = '技能调用报告', scrollKey = 'main' }) {
  const phase = state?.phase
  const error = state?.error ?? null
  const s = snapshot ?? (state !== undefined && state !== null ? state.data : null) ?? EMPTY
  const perSkill = Array.isArray(s.perSkill) ? s.perSkill : []
  const recent = Array.isArray(s.recent) ? s.recent : []
  const skills = Array.isArray(s.skills) ? s.skills : []
  const capability = s.capability
  const history = Array.isArray(s.installHistory) ? s.installHistory : []
  const counts = countMap(perSkill)
  const latest = recent[0]

  const [sheetOpen, setSheetOpen] = React.useState(false)
  const [scrolled, setScrolled] = React.useState(false)
  const [atBottom, setAtBottom] = React.useState(false)
  const filterRef = React.useRef(null)
  // Update verdicts live in the module store (source.js), not in component state:
  // the check resolves after an await, and this panel is unmounted whenever the
  // user switches back to the conversation.
  const updateState = useUpdates()
  const updates = updateState.results

  /**
   * Ask the host, once per mounted panel, whether any skill's recorded source has
   * moved on. Deliberately NOT part of the 5-second poll: a check is one network
   * request per skill, and doing that on a timer would hammer the origin for a
   * panel that is merely open.
   */
  const autoChecked = React.useRef(false)
  React.useEffect(() => {
    if (autoChecked.current === true) return
    if (api.canInstall(capability) !== true) return
    if (!skills.some((skill) => api.hasSource(skill?.provenance) === true)) return
    autoChecked.current = true
    void checkForUpdates(skills)
  }, [capability, skills])

  const onScrollTrack = React.useCallback((event) => {
    const node = event?.currentTarget
    const top = node?.scrollTop ?? 0
    setScrolled(top > 6)
    const height = node?.clientHeight ?? 0
    const total = node?.scrollHeight ?? 0
    setAtBottom(height > 0 && total > 0 && top + height >= total - 8)
  }, [])

  // Item 45: `main` is unmounted whenever the user returns to the conversation, so
  // the reading position has to survive outside the component.
  const { rootRef, onScroll } = useScrollMemory(scrollKey, onScrollTrack)

  const openInstall = React.useCallback(() => setSheetOpen(true), [])
  const closeInstall = React.useCallback(() => setSheetOpen(false), [])

  useHotkeys({
    onFilter: () => filterRef.current?.focus?.(),
    onRefresh,
    onInstall: api.canInstall(capability) ? openInstall : undefined,
    onEscape: () => setSheetOpen(false),
    sheetOpen,
  })

  if (phase === 'loading' && state?.data === null && snapshot === undefined) {
    return h(
      'div',
      { className: 'sr-root' },
      h(
        'header',
        { className: 'sr-head' },
        h('span', { className: 'sr-title' }, title),
        h(StatusLine, { phase, error }),
      ),
      h(Skeleton, null),
    )
  }

  const installable = api.canInstall(capability)

  const header = h(
    'header',
    { className: scrolled ? 'sr-head sr-head--scrolled' : 'sr-head' },
    h(Icon, { name: 'layers', size: 14 }),
    h('span', { className: 'sr-title' }, title),
    h(
      'div',
      { className: 'sr-head-tools' },
      h(StatusLine, { phase, error, fetchedAt: state?.fetchedAt, now }),
      installable
        ? h(
            'button',
            { type: 'button', className: 'sr-btn sr-btn--icon', onClick: openInstall, title: '安装 skill（快捷键 n）', 'aria-label': '安装 skill' },
            h(Icon, { name: 'plus', size: 13 }),
          )
        : null,
      onRefresh
        ? h('button', { type: 'button', className: 'sr-btn sr-btn--icon', onClick: onRefresh, title: '重新读取最新状态（快捷键 r）', 'aria-label': '刷新' }, h(Icon, { name: 'refresh', size: 13 }))
        : null,
    ),
  )

  const hero = h(
    'div',
    { className: 'sr-hero' },
    h(
      'div',
      { className: 'sr-hero-top' },
      h(
        'div',
        { className: 'sr-hero-main' },
        h('div', { className: 'sr-hero-meta' }, latest === undefined ? '等待第一个完成的回合' : `本轮 · ${clock(latest.at)} · ${ago(latest.at, now)}`),
        latest === undefined
          ? h('div', { className: 'sr-hero-empty' }, '发一条消息，这里就会出现本轮结果。')
          : latest.calls.length === 0
            ? h(
                'div',
                { className: 'sr-hero-line' },
                // Item 43: "this turn used nothing" is the signal this whole plugin
                // exists to report, so it stops sharing the neutral badge with
                // everything else. Amber, calm, and deliberately not the error red —
                // a turn with no skill is a normal turn.
                h('span', { className: 'sr-badge sr-badge--none' }, '未使用'),
              )
            : h('div', { className: 'sr-hero-line' }, latest.calls.map((call, i) => h(CallRow, { key: `${call.name}-${i}`, call }))),
      ),
      // The chart and its caption stand or fall together: a caption floating under
      // nothing is worse than no chart, and a flat series says nothing anyway.
      (() => {
        const series = histogram(recent)
        return series.length < 2 || series.every((value) => value === 0)
          ? null
          : h(
              'div',
              null,
              h(Sparkline, { values: series }),
              h('div', { className: 'sr-spark-cap' }, '最近 12 回合'),
            )
      })(),
    ),
  )

  const stats = h(
    'div',
    { className: 'sr-stats' },
    h(Stat, { label: '回合', value: s.turns ?? 0 }),
    h(Stat, { label: '用到 skill', value: s.turnsWithSkills ?? 0 }),
    h(Stat, { label: '未用', value: s.turnsWithoutSkills ?? 0 }),
    h(Stat, { label: '调用次数', value: s.invocations ?? 0 }),
  )

  /**
   * Item 42: with nothing to report and nothing installed, the panel used to show
   * three separate placeholders (hero, catalogue, two sections), which reads as a
   * broken panel rather than a new one. One sentence plus the action that changes
   * it is the honest empty state. The "only turns === 0" case is deliberately NOT
   * folded in here: a fresh session that already has skills should still show its
   * catalogue, so that path keeps the per-section text.
   */
  const bare = (s.turns ?? 0) === 0 && skills.length === 0
  const guide = h(
    'div',
    { className: 'sr-guide' },
    h(Icon, { name: 'layers', size: 15, style: { color: 'var(--sr-fg3)', flex: 'none', marginTop: '2px' } }),
    h(
      'div',
      { className: 'sr-guide-body' },
      h('div', { className: 'sr-guide-title' }, '还没有可报告的内容'),
      h(
        'div',
        { className: 'sr-guide-text' },
        installable
          ? '装好 skill 之后，这里会列出它们；每聊完一轮，还会显示这一轮到底调用了哪些 skill。'
          : '每聊完一轮，这里会显示这一轮到底调用了哪些 skill，以及一个都没用到的情况。',
      ),
    ),
    installable ? h('div', { className: 'sr-guide-act' }, h('button', { type: 'button', className: 'sr-btn sr-btn--primary', onClick: openInstall, 'data-sr-focusable': 'true' }, h(Icon, { name: 'plus', size: 12 }), '安装 skill')) : null,
  )

  return h(
    'div',
    { className: 'sr-root', onScroll, ref: rootRef },
    header,
    h('div', { className: scrolled ? 'sr-fade sr-fade--t sr-fade--on' : 'sr-fade sr-fade--t', 'aria-hidden': 'true' }),
    h(
      'div',
      { className: 'sr-body' },
      bare
        ? guide
        : [
            hero,
            stats,
            // No rail here. The composer strip owns the one status rail: it is
            // mounted in every view, so a write that finishes while the report is
            // hidden still gets reported — and with both surfaces on screen the
            // same toast used to appear twice (once above the report, once inside
            // it), because they render the same global store.
            h(SkillsSection, {
              key: 'skills',
              skills,
              capability,
              counts,
              onUse,
              onInstall: installable ? openInstall : undefined,
              onChanged: onRefresh,
              phase,
              filterRef,
              updates,
              checking: updateState.checking,
              onCheckUpdate: () => void checkForUpdates(skills),
            }),
            h(PerSkillSection, { key: 'per', perSkill }),
            h(RecentSection, { key: 'recent', recent, now }),
          ],
    ),
    h('div', { className: atBottom ? 'sr-fade sr-fade--b' : 'sr-fade sr-fade--b sr-fade--on', 'aria-hidden': 'true' }),
    h(Footer, { capability, phase, skills, now, fetchedAt: state?.fetchedAt }),
    // Item 41: the sheet reports the install, so the offer to start using it
    // belongs there too. `onUse` only exists on the composer seat, so the button
    // is absent in the centre panel — which is exactly right, since that surface
    // cannot write to the draft.
    h(InstallSheet, { open: sheetOpen, onClose: closeInstall, capability, history, onInstalled: onRefresh, onUse }),
  )
}

/* ------------------------------ sidebar glyph ------------------------------ */

/** Left-sidebar glyph. The owner hands over the size it allotted. */
function SkillReportIcon({ size = 16, active = false }) {
  return h(
    'svg',
    {
      width: size,
      height: size,
      viewBox: '0 0 16 16',
      'aria-hidden': 'true',
      style: { color: active ? 'var(--dsw-alias-label-primary, #3370ff)' : 'var(--dsw-alias-label-tertiary, #8f959e)', display: 'block' },
    },
    h('path', { d: 'M2.5 2.5h11v2.2h-11z', fill: 'currentColor', opacity: 0.55 }),
    h('path', { d: 'M2.5 6.6h6.4v2.2H2.5z', fill: 'currentColor', opacity: 0.85 }),
    h('path', { d: 'M2.5 10.7h9v2.2h-9z', fill: 'currentColor', opacity: 0.4 }),
    h('circle', { cx: 12.6, cy: 7.7, r: 1.5, fill: 'currentColor' }),
  )
}

/* ------------------------------ composer strip ------------------------------ */

/**
 * Composer strip: one rounded bar, expanding in place into the full report.
 *
 * Local `useState` is safe here — the owning entry unmounts the strip with the
 * conversation view and re-mounts it collapsed.
 */
function SkillReportStrip({ state, onRefresh, onUse, now }) {
  const [open, setOpen] = React.useState(false)
  const [sheetOpen, setSheetOpen] = React.useState(false)
  const s = (state?.data ?? null) ?? EMPTY
  const latest = Array.isArray(s.recent) ? s.recent[0] : undefined
  const used = latest !== undefined && latest.calls.length > 0
  const failed = state?.phase === 'error'
  const capability = s.capability
  // Item 43, first of its three homes: the strip's dot. Our own tokens, not the
  // host's label colours — and a separate amber state so "used nothing" is
  // distinguishable from "nothing to report yet" at a glance.
  const dot = failed
    ? 'var(--sr-danger)'
    : latest === undefined
      ? 'var(--sr-fg3)'
      : used
        ? 'var(--sr-accent)'
        : 'var(--sr-warn)'
  const installable = api.canInstall(capability)
  const openInstall = React.useCallback(() => setSheetOpen(true), [])
  const closeInstall = React.useCallback(() => setSheetOpen(false), [])

  // The `main` panel is torn down while the user is in the conversation, so this
  // seat owns the shortcuts too — otherwise `n` would do nothing in the one view
  // where the composer (and therefore the strip) is.
  useHotkeys({
    onRefresh,
    onInstall: installable ? openInstall : undefined,
    onEscape: closeInstall,
    sheetOpen,
  })

  const bar = h(
    'button',
    {
      type: 'button',
      className: 'sr-strip',
      onClick: () => setOpen((value) => !value),
      title: `${summarize(latest)}（点击${open ? '收起' : '展开'}）`,
      'aria-expanded': open,
    },
    h('span', { className: 'sr-strip-dot', style: { background: dot } }),
    h('span', { className: 'sr-strip-label' }, '技能'),
    h('span', { className: 'sr-strip-text' }, failed ? `主机侧不可达：${state?.error ?? '未知错误'}` : summarize(latest)),
    h('span', { className: 'sr-strip-n' }, String(s.turns ?? 0)),
    h(Icon, { name: 'caret', size: 11, className: open ? 'sr-strip-caret sr-strip-caret--open' : 'sr-strip-caret' }),
  )

  const shell = [
    h(
      'div',
      { key: 'row', className: 'sr-strip-row' },
      bar,
      // Installing needs no composer access, so this seat can offer it too — and
      // it is the affordance the user reaches for while writing a message.
      api.canInstall(capability)
        ? h(
            'button',
            {
              key: 'install',
              type: 'button',
              className: 'sr-btn sr-btn--icon',
              onClick: openInstall,
              title: '安装 skill（快捷键 n）',
              'aria-label': '安装 skill',
            },
            h(Icon, { name: 'plus', size: 13 }),
          )
        : null,
      s.turns > 0 && !failed
        ? h(
            'button',
            { key: 'rescan', type: 'button', className: 'sr-btn sr-btn--icon', onClick: () => void api.performRescan(), title: '重新扫描 skill 目录', 'aria-label': '重新扫描 skill 目录' },
            h(Icon, { name: 'refresh', size: 13 }),
          )
        : null,
    ),
    h(LiveRail, { key: 'rail', className: 'sr-rail' }),
  ]

  if (open) {
    shell.push(
      h('div', { key: 'panel', className: 'sr-strip-panel' }, h(SkillReportPanel, { state, onRefresh, onUse, now, title: '技能调用报告', scrollKey: null })),
    )
  }
  shell.push(h(InstallSheet, { key: 'sheet', open: sheetOpen, onClose: closeInstall, capability, history: s.installHistory, onInstalled: onRefresh, onUse }))

  // `--open` lets CSS join the bar row and the report into ONE block: no gap, and
  // a single hairline between them instead of two separate rounded boxes.
  return h('div', { className: open ? 'sr-strip-shell sr-strip-shell--open' : 'sr-strip-shell' }, ...shell)
}

module.exports = {
  SkillReportPanel,
  SkillReportIcon,
  SkillReportStrip,
  clock,
  ago,
  summarize,
  histogram,
  sparkline,
  sortSkills,
  filterSkills,
  usedSkillCount,
  clampScroll,
  tagsOf,
  countMap,
  EMPTY,
  VERSION,
}
