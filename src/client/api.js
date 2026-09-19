// Install/manage API client + the async-result status rail.
//
// AUTHORING NOTE: bundle source, not a Node module — see panel.js.
//
// Two responsibilities, both about *writes* (source.js owns reads):
//
//   1. the `/api/skill-report/skills` endpoint, wrapped so the UI never has to
//      know about HTTP status codes. The host maps every failure to a code and
//      returns it inside a JSON body, so the rule is: trust `ok`, and surface
//      `error.message` (+ `error.hint` when present). HTTP status is only used
//      when the body is not JSON at all.
//   2. the toast store, because every write is asynchronous and the user must
//      see pending -> ok/error without the list being rebuilt.
//
// `post()` never rejects and never returns `undefined`: a render path that reads
// `.error.message` off a thrown promise would blank the panel.

const React = require('react')
const { applySkills, refresh } = require('./source.js')

/** The write endpoint. Same-origin, so the `/api` prefix supplies auth. */
const SKILLS_PATH = '/api/skill-report/skills'

/**
 * Longest accepted Chinese display name. Mirrors `DISPLAY_NAME_ZH_MAX` in the host
 * engine (`src/install.js`) — the sheet refuses an over-long value locally rather
 * than letting the user find out after a round trip.
 */
const DISPLAY_NAME_ZH_MAX = 40

/* ------------------------------ small utilities ------------------------------ */

/** `1.4 MB` — sizes are always shown next to a limit, so keep them readable. */
function formatBytes(bytes) {
  const n = typeof bytes === 'number' && Number.isFinite(bytes) ? bytes : 0
  if (n < 1024) return `${Math.round(n)} B`
  const kb = n / 1024
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`
  const mb = kb / 1024
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`
}

/**
 * Suggested slug for a name the host rejected with INVALID_NAME.
 *
 * `_` and `.` are preserved because the host's own name rule allows them, and a
 * "fix" that renamed `my_skill` to `my-skill` would be a different skill.
 */
function slugify(name) {
  return String(name ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, '-')
    .replace(/^[-.]+|[-.]+$/gu, '')
    .slice(0, 64)
}

/** Stable 0..359 hue from a name — the avatar colour must not jump between renders. */
function hueOf(name) {
  let hash = 2166136261
  const text = String(name ?? '')
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return Math.abs(hash) % 360
}

/** Avatar letter: first alphanumeric character, uppercased. */
function initial(name) {
  const match = /[a-z0-9]/iu.exec(String(name ?? ''))
  return match === null ? '?' : match[0].toUpperCase()
}

/* ------------------------------ capability model ------------------------------ */

/** True only when the host both exposes the API and can write the skills root. */
function canInstall(capability) {
  return capability !== null && typeof capability === 'object' && capability.api === 1 && capability.writable === true
}

/** `api:0` (or `install:false`) means the config turned the whole feature off. */
function installDisabled(capability) {
  if (capability === null || capability === undefined) return true
  return capability.api === 0 || capability.install === false
}

/** Human explanation for the footer / disabled sheet. */
function disabledReason(capability) {
  if (capability === null || capability === undefined) return '主机侧未上报安装能力'
  if (typeof capability.reason === 'string' && capability.reason !== '') return capability.reason
  if (capability.api === 0 || capability.install === false) return '安装功能已被配置关闭'
  if (capability.writable !== true) return `skill 目录不可写：${capability.root ?? '未知路径'}`
  return '安装能力不可用'
}

/**
 * `unknown` is a real state: the host probes for git asynchronously, and
 * `git === undefined` means "not settled yet" — never render that as 不可用.
 */
function gitState(capability) {
  const git = capability === null || capability === undefined ? undefined : capability.git
  if (git === true) return 'ok'
  if (git === false) return 'unavailable'
  return 'unknown'
}

/** The modes the host actually advertised, in a fixed display order. */
function installModes(capability) {
  const modes = capability !== null && typeof capability === 'object' && Array.isArray(capability.modes) ? capability.modes : []
  return ['text', 'file', 'url', 'git'].filter((mode) => modes.includes(mode))
}

/** Byte ceiling for one upload, or `null` when the host did not advertise one. */
function uploadLimit(capability) {
  const limit = capability?.limits?.uploadBytes
  return typeof limit === 'number' && Number.isFinite(limit) ? limit : null
}

/** Client-side size gate, so an oversized file never leaves the browser. */
function checkSize(bytes, capability) {
  const limit = uploadLimit(capability)
  if (limit === null) return { ok: true }
  if (typeof bytes !== 'number' || !Number.isFinite(bytes)) return { ok: true }
  if (bytes > limit) {
    return { ok: false, message: `文件 ${formatBytes(bytes)} 超过上限 ${formatBytes(limit)}，请拆分或改用「从链接」` }
  }
  return { ok: true }
}

/**
 * Pure form validation, shared by the sheet's disabled-state and its helper text.
 * @returns `{ ok: boolean, code?: string, message?: string }`
 */
function validateInstall(input) {
  const mode = input?.mode ?? 'text'
  if (installDisabled(input?.capability)) {
    return { ok: false, code: 'DISABLED', message: disabledReason(input?.capability) }
  }
  // The Chinese display name is optional in every mode, so it is checked once,
  // here, rather than repeated in each mode's rules — and refused locally instead
  // of after a round trip.
  const displayNameZh = typeof input?.displayNameZh === 'string' ? input.displayNameZh.trim() : ''
  if ([...displayNameZh].length > DISPLAY_NAME_ZH_MAX) {
    return {
      ok: false,
      code: 'DISPLAY_NAME_TOO_LONG',
      message: `中文显示名最多 ${DISPLAY_NAME_ZH_MAX} 个字`,
      hint: '它只是面板上显示的名字，把说明留在 SKILL.md 里就好。',
    }
  }
  if (/[\u0000-\u001f\u007f]/u.test(displayNameZh)) {
    return { ok: false, code: 'DISPLAY_NAME_BAD', message: '中文显示名里不能有换行或控制字符' }
  }
  const name = typeof input?.name === 'string' ? input.name.trim() : ''
  if (name !== '' && !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(name)) {
    return { ok: false, code: 'INVALID_NAME', message: '名称只能包含字母、数字、点、下划线和连字符，且以字母或数字开头' }
  }
  if (mode === 'text') {
    const text = typeof input?.text === 'string' ? input.text.trim() : ''
    if (text === '') return { ok: false, code: 'EMPTY', message: '请粘贴 SKILL.md 内容' }
    const max = input?.capability?.limits?.markdownBytes
    if (typeof max === 'number' && text.length > max) {
      return { ok: false, code: 'TOO_LARGE', message: `内容 ${formatBytes(text.length)} 超过上限 ${formatBytes(max)}` }
    }
    return { ok: true }
  }
  if (mode === 'file') {
    if (input?.file === null || input?.file === undefined) return { ok: false, code: 'EMPTY', message: '请选择 .md 或 .zip 文件' }
    const size = typeof input.file === 'number' ? input.file : input.file.size
    return checkSize(size, input.capability)
  }
  if (mode === 'auto') {
    const address = typeof input?.input === 'string' ? input.input.trim() : ''
    if (address === '') {
      return { ok: false, code: 'EMPTY', message: '请粘贴作者给的地址', hint: '仓库主页、仓库里的文件夹链接、SKILL.md 链接，或 zip 直链，都可以。' }
    }
    if (/\s/u.test(address)) return { ok: false, code: 'BAD_ADDRESS', message: '地址里不能有空格' }
    // A bare repo slug needs git on the host; a URL may turn out to need it too,
    // but the host decides that after parsing, so only block the obvious case.
    if (!/^https?:\/\//iu.test(address) && gitState(input?.capability) === 'unavailable') {
      return { ok: false, code: 'GIT_MISSING', message: '当前主机侧没有可用的 git' }
    }
    return { ok: true }
  }
  if (mode === 'url') {
    const url = typeof input?.url === 'string' ? input.url.trim() : ''
    if (url === '') return { ok: false, code: 'EMPTY', message: '请填写 SKILL.md 或 .zip 的直链' }
    if (!/^https?:\/\/\S+$/iu.test(url)) return { ok: false, code: 'BAD_URL', message: '链接必须以 http:// 或 https:// 开头' }
    return { ok: true }
  }
  if (mode === 'git') {
    if (gitState(input?.capability) === 'unavailable') return { ok: false, code: 'GIT_MISSING', message: '当前主机侧没有可用的 git' }
    const repo = typeof input?.repo === 'string' ? input.repo.trim() : ''
    if (repo === '') return { ok: false, code: 'EMPTY', message: '请填写仓库，例如 owner/repo 或完整 URL' }
    if (/\s/u.test(repo)) return { ok: false, code: 'BAD_REPO', message: '仓库地址里不能有空格' }
    return { ok: true }
  }
  return { ok: false, code: 'BAD_MODE', message: `未知的安装方式：${mode}` }
}

/* ------------------------------ the transport ------------------------------ */

const fail = (code, message, hint) => ({ ok: false, error: { code, message, hint } })

/** Pull the host's `{ok, error}` envelope out of a response, whatever it holds. */
async function readEnvelope(response) {
  let payload = null
  try {
    payload = await response.json()
  } catch {
    payload = null
  }
  if (payload === null || typeof payload !== 'object') {
    return fail('HTTP', `主机侧返回了非 JSON 响应（HTTP ${response?.status ?? '?'}）`)
  }
  if (payload.ok === true) return { ok: true, status: response.status, data: payload }
  const error = payload.error ?? {}
  return {
    ok: false,
    status: response.status,
    data: payload,
    error: {
      code: typeof error.code === 'string' ? error.code : 'UNKNOWN',
      message: typeof error.message === 'string' && error.message !== '' ? error.message : `主机侧拒绝了这次请求（HTTP ${response.status}）`,
      hint: typeof error.hint === 'string' ? error.hint : undefined,
    },
  }
}

/**
 * POST one JSON body to the write endpoint.
 * @returns `{ok:true,data}|{ok:false,error}` — never throws, never `undefined`.
 */
async function post(body, options = {}) {
  const path = typeof options.path === 'string' ? options.path : SKILLS_PATH
  if (typeof fetch !== 'function') return fail('NETWORK', '当前外壳没有暴露 fetch()')
  let response
  try {
    response = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
    })
  } catch (error) {
    return fail('NETWORK', `无法连接主机侧：${String(error?.message ?? error)}`)
  }
  return readEnvelope(response)
}

/** GET the catalog snapshot (`{ok, capability, history, skills}`). */
async function loadSkills(options = {}) {
  const path = typeof options.path === 'string' ? options.path : SKILLS_PATH
  if (typeof fetch !== 'function') return fail('NETWORK', '当前外壳没有暴露 fetch()')
  let response
  try {
    response = await fetch(path, { headers: { accept: 'application/json' }, cache: 'no-store' })
  } catch (error) {
    return fail('NETWORK', `无法连接主机侧：${String(error?.message ?? error)}`)
  }
  return readEnvelope(response)
}

/* ------------------------------ request builders ------------------------------ */

const str = (value) => (typeof value === 'string' ? value.trim() : '')

/**
 * The install body for a mode.
 *
 * Deliberately total — an unknown mode yields a body the host rejects with
 * `BAD_MODE` rather than a thrown error, because this runs inside an event
 * handler and a throw there reaches the page's error boundary.
 */
function bodyFor(mode, fields = {}) {
  const base = { action: 'install', mode }
  const name = str(fields.name)
  if (name !== '') base.name = name
  // Sent for every mode: the Chinese name is an attribute of the skill, not of the
  // transport, and the host merges it into meta.yaml whichever route was taken.
  const displayNameZh = str(fields.displayNameZh)
  if (displayNameZh !== '') base.displayNameZh = displayNameZh
  if (fields.overwrite === true) base.overwrite = true
  if (mode === 'text') {
    base.text = typeof fields.text === 'string' ? fields.text : ''
    return base
  }
  if (mode === 'auto') {
    // One field, pasted straight from wherever the author published it. The host
    // decides whether that is a repo, a folder, a file or a zip — and an explicit
    // ref/subpath still overrides whatever it inferred.
    base.input = str(fields.input)
    const ref = str(fields.ref)
    const subpath = str(fields.subpath)
    if (ref !== '') base.ref = ref
    if (subpath !== '') base.subpath = subpath
    return base
  }
  if (mode === 'url') {
    base.url = str(fields.url)
    return base
  }
  if (mode === 'git') {
    base.repo = str(fields.repo)
    const ref = str(fields.ref)
    const subpath = str(fields.subpath)
    if (ref !== '') base.ref = ref
    if (subpath !== '') base.subpath = subpath
    return base
  }
  if (mode === 'file') {
    base.filename = str(fields.filename)
    base.dataBase64 = typeof fields.dataBase64 === 'string' ? fields.dataBase64 : ''
    return base
  }
  return base
}

/** The preview body. `text`, `url` and `auto` are previewable by contract. */
function previewBodyFor(mode, fields = {}) {
  const base = { action: 'preview', mode: mode === 'url' ? 'url' : mode === 'auto' ? 'auto' : 'text' }
  const name = str(fields.name)
  if (name !== '') base.name = name
  if (base.mode === 'url') base.url = str(fields.url)
  else if (base.mode === 'auto') base.input = str(fields.input)
  else base.text = typeof fields.text === 'string' ? fields.text : ''
  return base
}

/** Read a picked `File` as base64. Guarded: Node has no FileReader. */
function readFileBase64(file) {
  return new Promise((resolve) => {
    if (typeof FileReader === 'undefined') {
      resolve({ ok: false, error: { code: 'NETWORK', message: '当前环境无法读取本地文件' } })
      return
    }
    try {
      const reader = new FileReader()
      reader.onerror = () => resolve({ ok: false, error: { code: 'FS_ERROR', message: '读取文件失败' } })
      reader.onload = () => {
        const result = typeof reader.result === 'string' ? reader.result : ''
        const comma = result.indexOf(',')
        if (comma < 0) {
          resolve({ ok: false, error: { code: 'FS_ERROR', message: '读取文件失败' } })
          return
        }
        resolve({ ok: true, dataBase64: result.slice(comma + 1) })
      }
      reader.readAsDataURL(file)
    } catch (error) {
      resolve({ ok: false, error: { code: 'FS_ERROR', message: String(error?.message ?? error) } })
    }
  })
}

/* ------------------------------ status rail ------------------------------ */

let toasts = []
let toastSeq = 0
const toastListeners = new Set()
/**
 * Pending auto-dismiss timers, keyed by toast id.
 *
 * Tracked rather than fire-and-forget so an early ✕, a replacement or an eviction
 * cancels the countdown. A stale timer firing against a removed entry would at best
 * do nothing and at worst dismiss an unrelated toast.
 */
const toastTimers = new Map()

/** The rail is a notification strip, not a log: three at a time. */
const TOAST_LIMIT = 3
/** How long a non-error toast stays before it clears itself. */
const TOAST_TTL_MS = 5000

const clearToastTimer = (id) => {
  const timer = toastTimers.get(id)
  if (timer === undefined) return
  toastTimers.delete(id)
  if (typeof clearTimeout === 'function') clearTimeout(timer)
}

/**
 * Arm — or disarm — the auto-dismiss for one toast.
 *
 * Deliberate asymmetry: `error` toasts NEVER expire. They carry the host's `message`
 * and `hint`, which is the actionable half of a failure (the EPERM instructions, for
 * instance), and a message that vanishes before it can be read is worse than a stack
 * the user clears by hand. Successes and progress notices are the ones worth
 * clearing automatically.
 */
const armToastTimer = (id, kind) => {
  clearToastTimer(id)
  if (kind === 'error') return
  if (typeof setTimeout !== 'function') return
  const timer = setTimeout(() => {
    toastTimers.delete(id)
    dismissToast(id)
  }, TOAST_TTL_MS)
  // In a browser this is a number and the optional call is skipped; in Node it is a
  // Timeout, and without `unref` one pending toast would hold a test process open.
  timer?.unref?.()
  toastTimers.set(id, timer)
}

const publishToasts = (next) => {
  toasts = next
  for (const listener of [...toastListeners]) {
    try {
      listener()
    } catch {
      // One broken observer must not silence the rail.
    }
  }
}

const subscribeToasts = (listener) => {
  toastListeners.add(listener)
  return () => toastListeners.delete(listener)
}

const getToasts = () => toasts

/** Newest last, capped: the oldest EVICTABLE toast goes when a fourth arrives. */
function pushToast(toast) {
  toastSeq += 1
  const entry = {
    id: toastSeq,
    kind: toast?.kind ?? 'pending',
    message: String(toast?.message ?? ''),
    hint: typeof toast?.hint === 'string' && toast.hint !== '' ? toast.hint : undefined,
    code: typeof toast?.code === 'string' ? toast.code : undefined,
    at: Date.now(),
  }
  const next = [...toasts, entry]
  // An error is never evicted by successes piling up behind it; if nothing is
  // evictable the rail simply grows, which is the honest outcome for a burst of
  // failures. Without this, clearing eleven names stacked eleven toasts.
  while (next.length > TOAST_LIMIT) {
    const at = next.findIndex((item) => item.kind !== 'error')
    if (at === -1) break
    clearToastTimer(next[at].id)
    next.splice(at, 1)
  }
  publishToasts(next)
  armToastTimer(entry.id, entry.kind)
  return entry.id
}

function updateToast(id, patch) {
  const current = toasts.find((toast) => toast.id === id)
  if (current === undefined) return
  const kind = typeof patch?.kind === 'string' ? patch.kind : current.kind
  publishToasts(toasts.map((toast) => (toast.id === id ? { ...toast, ...patch } : toast)))
  // The countdown follows the KIND: a pending toast that turns into an error must
  // stop counting down, and one that succeeds must start.
  armToastTimer(id, kind)
}

function dismissToast(id) {
  clearToastTimer(id)
  const next = toasts.filter((toast) => toast.id !== id)
  if (next.length !== toasts.length) publishToasts(next)
}

/** `useSyncExternalStore` binding; the array reference changes once per update. */
function useToasts() {
  return React.useSyncExternalStore(subscribeToasts, getToasts, getToasts)
}

/* ------------------------------ orchestration ------------------------------ */

/**
 * Run a write, then make the UI reflect the response immediately.
 *
 * The host returns the whole on-disk catalog with every reply, so the list is
 * republished from that payload rather than waiting up to `POLL_MS` for the next
 * poll — but the poll is still kicked, because `capability` and `installHistory`
 * only travel on the state route.
 */
async function performWrite(body, labels = {}) {
  const id = pushToast({ kind: 'pending', message: labels.pending ?? '正在写入…' })
  const result = await post(body)
  if (result.ok === true) {
    const data = result.data ?? {}
    applySkills(data.skills, data.capability)
    const name = data.skill?.name ?? (typeof body?.name === 'string' ? body.name : '')
    const parts = [labels.okPrefix ?? '已完成']
    if (name !== '') parts.push(name)
    if (typeof data.files === 'number') parts.push(`${data.files} 个文件`)
    // An update replaces an existing skill by definition, so "已覆盖" is noise there
    // — the backup path below is the part the user actually needs.
    if (data.overwritten === true && labels.okPrefix !== '已更新') parts.push('已覆盖')
    updateToast(id, {
      kind: 'ok',
      message: parts.join(' · '),
      hint: typeof data.backup === 'string' && data.backup !== '' ? `备份：${data.backup}` : undefined,
    })
    if (typeof labels.onDone === 'function') {
      try {
        labels.onDone(data)
      } catch {
        // A consumer's callback must not turn a successful write into an error.
      }
    }
  } else {
    const error = result.error ?? { code: 'UNKNOWN', message: '未知错误' }
    updateToast(id, { kind: 'error', message: error.message, hint: error.hint, code: error.code })
  }
  void refresh()
  return result
}

/** Install with an install-flavoured toast; returns the host envelope. */
function performInstall(body, labels = {}) {
  return performWrite(body, { pending: labels.pending ?? '正在安装…', okPrefix: '已安装', onDone: labels.onDone })
}

/** Uninstall; the backup path (when the host made one) rides in the toast hint. */
function performUninstall(name, labels = {}) {
  return performWrite({ action: 'uninstall', name, confirm: true }, { pending: `正在删除 ${name}…`, okPrefix: '已删除', onDone: labels.onDone })
}

/** Force the host to re-read its skills root. */
function performRescan(labels = {}) {
  return performWrite({ action: 'rescan' }, { pending: '正在重新扫描…', okPrefix: '已扫描', onDone: labels.onDone })
}

/* ------------------------------ provenance / updates ------------------------------ */

/** Source kinds the host can record, in the order the labels below are keyed. */
const SOURCE_LABELS = { git: 'Git 仓库', url: '直链', file: '上传文件', text: '粘贴内容' }

/**
 * How much of a source address fits on a card.
 *
 * A card is ~200px wide and a clone URL is 60 characters, so the label is the
 * SHORT form (a repo slug, a filename, a hostname) and the full address stays in
 * the `title` attribute, where it is available without being in the way.
 */
function sourceLabel(provenance) {
  if (provenance === null || typeof provenance !== 'object' || provenance.known !== true) return ''
  const kind = SOURCE_LABELS[provenance.source] ?? '未知来源'
  const raw = typeof provenance.url === 'string' && provenance.url !== '' ? provenance.url : provenance.repo
  if (typeof raw !== 'string' || raw === '') return kind
  if (provenance.source === 'git') {
    // `https://github.com/owner/repo.git` -> `owner/repo`
    const slug = raw.replace(/\.git$/u, '').split('/').filter(Boolean).slice(-2).join('/')
    return slug === '' ? kind : slug
  }
  if (provenance.source === 'url') {
    try {
      return new URL(raw).hostname
    } catch {
      return kind
    }
  }
  // An upload's "address" is its filename, which may itself be long.
  return raw.length > 28 ? `${raw.slice(0, 27)}…` : raw
}

/** True when the host recorded a source for this skill (so it can be checked). */
function hasSource(provenance) {
  return provenance !== null && typeof provenance === 'object' && provenance.known === true && provenance.source === 'git' && provenance.repo !== ''
}

/**
 * True when this skill's source can be COMPARED for updates.
 *
 * A claimed source is excluded: the user typed that address, nothing has verified
 * it points at these files, so offering a one-click replace would be a guess
 * dressed as a feature. The card offers 「标记来源」 again instead.
 */
function updateable(provenance) {
  return hasSource(provenance) && provenance.claimed !== true
}

/** True when the local files no longer match what was installed. */
function locallyEdited(provenance) {
  return provenance !== null && typeof provenance === 'object' && provenance.changedSinceInstall === true
}

/** Ask the host whether one skill (or the whole catalogue) has a newer revision. */
function performCheck(name, labels = {}) {
  const pending = name === undefined || name === '' ? '正在检查全部更新…' : `正在检查 ${name}…`
  return performWrite({ action: 'check', ...(name === undefined || name === '' ? {} : { name }) }, { pending, okPrefix: '已检查', onDone: labels.onDone })
}

/** Record where an installed-by-hand skill came from. Writes nothing but a record. */
function performClaim(name, input, labels = {}) {
  return performWrite({ action: 'claim', name, input }, { pending: `正在记录 ${name} 的来源…`, okPrefix: '已标记来源', onDone: labels.onDone })
}

/**
 * Replace a skill with the current content of its recorded source.
 *
 * `confirm` is only ever true for a CLAIMED source, where the address itself has
 * never been verified — the host answers `NEEDS_CONFIRM` otherwise, which is the
 * same two-step shape the delete control uses.
 */
function performUpdate(name, labels = {}) {
  return performWrite(
    { action: 'update', name, confirm: labels.confirm === true },
    { pending: `正在更新 ${name}…`, okPrefix: '已更新', onDone: labels.onDone },
  )
}

/** Client-side gate for the claim field, mirroring the host's own rejection. */
function validateClaim(input) {
  if (installDisabled(input?.capability)) {
    return { ok: false, code: 'DISABLED', message: disabledReason(input?.capability) }
  }
  const address = typeof input?.input === 'string' ? input.input.trim() : ''
  if (address === '') return { ok: false, code: 'EMPTY', message: '请粘贴这个 skill 的来源地址' }
  if (/\s/u.test(address)) return { ok: false, code: 'BAD_ADDRESS', message: '地址里不能有空格' }
  return { ok: true }
}

/**
 * Set — or clear — one installed skill's Chinese display name.
 *
 * An empty value CLEARS it, which is why the pending label differs: the status rail
 * should say which of the two happened, not a vague "renaming".
 */
function performRename(name, displayNameZh, labels = {}) {
  const value = typeof displayNameZh === 'string' ? displayNameZh : ''
  return performWrite(
    { action: 'rename', name, displayNameZh: value },
    {
      pending: value === '' ? `正在清除 ${name} 的中文名…` : `正在改名 ${name}…`,
      okPrefix: value === '' ? '已清除中文名' : '已改名',
      onDone: labels.onDone,
    },
  )
}

module.exports = {
  SKILLS_PATH,
  formatBytes,
  slugify,
  hueOf,
  initial,
  canInstall,
  installDisabled,
  disabledReason,
  gitState,
  installModes,
  uploadLimit,
  checkSize,
  validateInstall,
  post,
  loadSkills,
  performRename,
  performCheck,
  performClaim,
  performUpdate,
  validateClaim,
  sourceLabel,
  hasSource,
  updateable,
  locallyEdited,
  SOURCE_LABELS,
  bodyFor,
  previewBodyFor,
  readFileBase64,
  getToasts,
  subscribeToasts,
  pushToast,
  updateToast,
  dismissToast,
  useToasts,
  performWrite,
  performInstall,
  performUninstall,
  performRescan,
}
