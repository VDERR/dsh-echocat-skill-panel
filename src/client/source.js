// Client-side data source: one module-level store both panel surfaces read.
//
// AUTHORING NOTE: bundle source, not a Node module — see panel.js.
//
// The browser half is a pure renderer. Skill usage is derived on the host from
// the session event log and served as JSON over the DSH web server, because a
// root-scoped panel cannot reach session-scoped data: the `main` keyed slot
// exposes only the five root seats (`useSessions`, `usePanelInfo`,
// `useWorkspaces`, `useResource`, `useSessionPendingInteraction`) and none of the
// session-scoped hooks that carry messages.
//
// React binding is `useSyncExternalStore`, whose contract requires getSnapshot
// to return a *stable reference* until something actually changes — so every
// update replaces the whole state object exactly once.

const React = require('react')

/** Default host route; the host half registers it under the authenticated `/api` prefix. */
const DEFAULT_PATH = '/api/skill-report/state'

/** How often the mounted surfaces re-poll while visible. */
const POLL_MS = 5000

let path = DEFAULT_PATH
/** @type {{ phase: 'loading'|'ready'|'error', data: unknown, error: string|null, fetchedAt: number, seq: number }} */
let state = { phase: 'loading', data: null, error: null, fetchedAt: 0, seq: 0 }
const listeners = new Set()
let inflight = null
let timer = null
/**
 * How many mounted surfaces currently want polling.
 *
 * Three surfaces share this one store, and they mount and unmount independently:
 * `main` is torn down whenever the user switches back to the conversation, and the
 * composer strip goes with the conversation view itself. A plain start/stop pair
 * would let one surface's cleanup silence the others' auto-refresh, so the timer
 * follows the number of live subscribers instead of the first/last call.
 */
let pollers = 0

const publish = (next) => {
  state = { ...state, ...next, seq: state.seq + 1 }
  for (const listener of [...listeners]) {
    try {
      listener()
    } catch {
      // A broken observer must not stop the others.
    }
  }
}

const subscribe = (listener) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const getSnapshot = () => state

/**
 * Pull the latest snapshot from the host half.
 * @param force - skip the in-flight coalescing (used by the refresh button).
 * @returns the fetch promise, or the in-flight one.
 */
function refresh() {
  if (inflight !== null) return inflight
  const fetchImpl = typeof fetch === 'function' ? fetch : undefined
  if (fetchImpl === undefined) {
    publish({ phase: 'error', error: 'this shell exposes no fetch()', data: state.data })
    return Promise.resolve(state)
  }
  inflight = fetchImpl(path, { headers: { accept: 'application/json' }, cache: 'no-store' })
    .then(async (response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const data = await response.json()
      publish({ phase: 'ready', data, error: null, fetchedAt: Date.now() })
      return state
    })
    .catch((error) => {
      publish({ phase: 'error', error: String(error?.message ?? error), data: state.data })
      return state
    })
    .finally(() => {
      inflight = null
    })
  return inflight
}

/**
 * Republish the catalog straight from a write response.
 *
 * Every install/uninstall reply carries the whole on-disk `skills` array (plus a
 * fresh `capability`), so a successful write can update the list immediately
 * instead of waiting up to `POLL_MS` for the next poll. The phase flips to
 * `ready` on purpose: the write is proof the host is reachable, so a stale
 * "主机侧不可达" banner must not survive it.
 */
function applySkills(skills, capability) {
  if (!Array.isArray(skills)) return
  const data = state.data !== null && typeof state.data === 'object' ? state.data : {}
  const next = { ...data, skills }
  if (capability !== undefined && capability !== null) next.capability = capability
  publish({ phase: 'ready', data: next, error: null, fetchedAt: Date.now() })
}

/** Join the polling set, if the shell exposes timers. Idempotent per caller. */
function startPolling(intervalMs = POLL_MS) {
  pollers += 1
  if (timer !== null) return
  if (typeof setInterval !== 'function') return
  timer = setInterval(() => {
    void refresh()
  }, intervalMs)
}

/** Leave the polling set; the timer stops with the last departure. */
function stopPolling() {
  pollers = Math.max(0, pollers - 1)
  if (pollers > 0) return
  if (timer === null) return
  if (typeof clearInterval === 'function') clearInterval(timer)
  timer = null
}

/* ------------------------------- update checks ------------------------------- */

/**
 * Results of "does this skill's source have something newer?".
 *
 * A separate store rather than a field on the snapshot, for two reasons: the answer
 * is not part of the host's state (it comes from a network round trip the user may
 * never trigger), and it must survive the 5-second poll that replaces the whole
 * snapshot object.
 *
 * `checking` lives here too, NOT in component state: the check resolves after an
 * await, and a `setState` from that continuation is exactly the shape that breaks
 * when a surface is torn down mid-flight. A module store has no such lifecycle.
 */
let updates = { checking: false, at: 0, error: '', results: {} }
const updateListeners = new Set()
let updateInflight = null

const publishUpdates = (next) => {
  updates = { ...updates, ...next }
  for (const listener of [...updateListeners]) {
    try {
      listener()
    } catch {
      // One broken observer must not stop the others.
    }
  }
}

const subscribeUpdates = (listener) => {
  updateListeners.add(listener)
  return () => updateListeners.delete(listener)
}

const getUpdates = () => updates

/** `useSyncExternalStore` binding for the update-check results. */
function useUpdates() {
  return React.useSyncExternalStore(subscribeUpdates, getUpdates, getUpdates)
}

/**
 * Ask the host whether the given skills' recorded sources moved on.
 *
 * `skills` is the catalogue from the published snapshot: only skills with a
 * RECORDED source are worth asking about, and asking about the rest would spend a
 * round trip to be told "no record". Nothing happens when there is nothing to ask.
 *
 * @returns the host envelope, or `undefined` when no check was warranted.
 */
function checkForUpdates(skills) {
  if (updateInflight !== null) return updateInflight
  const names = (Array.isArray(skills) ? skills : [])
    .filter((skill) => skill?.provenance !== null && typeof skill?.provenance === 'object' && skill.provenance.known === true && skill.provenance.source === 'git')
    .map((skill) => skill.name)
  if (names.length === 0) return undefined

  // Required lazily: api.js already requires this module (for `applySkills` after a
  // write), so a top-level require here would be a cycle. The read/write split is the
  // reason the update CHECK lives on this side — it fetches, it changes nothing on
  // the host, and api.js is documented as the writes.
  const api = require('./api.js')
  publishUpdates({
    checking: true,
    error: '',
    results: names.reduce((acc, name) => {
      acc[name] = { phase: 'checking' }
      return acc
    }, {}),
  })

  updateInflight = api
    .performCheck(undefined, {})
    .then((result) => {
      const checks = Array.isArray(result?.data?.checks) ? result.data.checks : []
      const results = {}
      for (const entry of checks) results[entry.name] = { phase: 'done', result: entry }
      publishUpdates({
        checking: false,
        at: Date.now(),
        // A check that never reached the host is reported as such; the cards then
        // say "检查失败" instead of silently showing nothing.
        error: result?.ok === true ? '' : (result?.error?.message ?? '检查更新失败'),
        results,
      })
      return result
    })
    .catch((error) => {
      publishUpdates({ checking: false, at: Date.now(), error: String(error?.message ?? error), results: {} })
      return undefined
    })
    .finally(() => {
      updateInflight = null
    })
  return updateInflight
}

/** Drop every remembered verdict. Used by tests and by an explicit re-check. */
function clearUpdates() {
  publishUpdates({ checking: false, at: 0, error: '', results: {} })
}

/**
 * `useSyncExternalStore` binding, with a first-mount fetch.
 * @param options.path - override the host route.
 * @param options.poll - auto-refresh interval in ms, 0 to disable.
 */
function useSkillReport({ path: overridePath, poll = POLL_MS } = {}) {
  if (typeof overridePath === 'string' && overridePath !== '' && overridePath !== path) path = overridePath
  const snapshot = React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  React.useEffect(() => {
    void refresh()
    if (poll > 0) startPolling(poll)
    return () => {
      if (poll > 0) stopPolling()
    }
  }, [poll])
  return snapshot
}

/* ------------------------- the plugin's own release state ------------------------- */

/**
 * A tiny external store for "is there a newer version of this plugin".
 *
 * Module-level rather than component state for the same reason `useUpdates` is: the check
 * resolves AFTER an await and the panel is unmounted whenever the user switches back to
 * the conversation, so a result kept in component state would be thrown away and the
 * answer would have to be fetched again on every reopen.
 *
 * `reason` is carried alongside the result on purpose: "I could not reach the registry" and
 * "you are up to date" look identical if all you keep is a boolean, and only one of them
 * means the user can stop thinking about it.
 */
const releaseStore = {
  checking: false,
  /** `null` until a check has run in this page. */
  result: null,
  error: '',
}

const releaseListeners = new Set()

function emitRelease() {
  for (const listener of [...releaseListeners]) {
    try {
      listener()
    } catch {
      // A listener that throws must not stop the others.
    }
  }
}

function subscribeRelease(listener) {
  releaseListeners.add(listener)
  return () => releaseListeners.delete(listener)
}

function releaseSnapshot() {
  return releaseStore
}

/** Current release state, bound to React. */
function useRelease() {
  return React.useSyncExternalStore(subscribeRelease, releaseSnapshot, releaseSnapshot)
}

/**
 * Run the check. Concurrent presses share one request, and the flag is always cleared —
 * a button stuck on "checking" is worse than one that reports a failure.
 */
let releaseInflight = null
function checkPluginRelease(options = {}) {
  if (releaseInflight !== null) return releaseInflight
  releaseStore.checking = true
  releaseStore.error = ''
  emitRelease()
  // Lazy for the same reason as the update check above: api.js requires this module.
  const api = require('./api.js')
  releaseInflight = api
    .checkPluginRelease({ force: options.force === true })
    .then((envelope) => {
      if (envelope.ok !== true) {
        releaseStore.error = envelope.error?.message ?? '检查失败'
        releaseStore.result = null
        return
      }
      const value = envelope.data?.release ?? envelope.data ?? {}
      releaseStore.result = value
      // Reaching the host is not the same as reaching the outside world: the host phrases
      // that case as a `reason` with no `latest`, and it is worth showing.
      releaseStore.error = typeof value.reason === 'string' && value.latest === null ? value.reason : ''
    })
    .catch((error) => {
      releaseStore.error = String(error?.message ?? error)
      releaseStore.result = null
    })
    .then(() => {
      releaseStore.checking = false
      releaseInflight = null
      emitRelease()
    })
  return releaseInflight
}

/** Replace the release state outright — the seam the bundle test drives. */
function applyRelease(result) {
  releaseStore.result = result ?? null
  releaseStore.error = ''
  emitRelease()
}

/** Forget everything; used between mounts so one test cannot leak into the next. */
function clearRelease() {
  releaseStore.result = null
  releaseStore.error = ''
  releaseStore.checking = false
  releaseInflight = null
  emitRelease()
}

/** The release page from the last payload, with a compiled-in fallback. */
const FALLBACK_RELEASES = 'https://github.com/VDERR/echocat-skill-panel/releases'
function releaseUrl(fallback = FALLBACK_RELEASES) {
  const fromResult = releaseStore.result?.releases ?? releaseStore.result?.htmlUrl
  if (typeof fromResult === 'string' && fromResult !== '') return fromResult
  return fallback
}

/**
 * Open a URL in the user's browser.
 *
 * `window.open` with `noopener,noreferrer` is what the app's own client plugins use, and it
 * is the only mechanism available: the browser half has no shell API. Opens asynchronously
 * so a popup blocker's verdict never lands in the middle of a React event handler.
 *
 * @returns true when a window was asked for, false when there is none to open.
 */
function openExternal(url) {
  if (typeof url !== 'string' || url === '') return false
  if (typeof window === 'undefined' || typeof window.open !== 'function') return false
  try {
    window.open(url, '_blank', 'noopener,noreferrer')
    return true
  } catch {
    return false
  }
}

module.exports = {
  DEFAULT_PATH,
  POLL_MS,
  subscribe,
  getSnapshot,
  refresh,
  applySkills,
  useSkillReport,
  startPolling,
  stopPolling,
  useUpdates,
  getUpdates,
  subscribeUpdates,
  checkForUpdates,
  clearUpdates,
  useRelease,
  checkPluginRelease,
  releaseUrl,
  openExternal,
  applyRelease,
  clearRelease,
}
