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

module.exports = { DEFAULT_PATH, POLL_MS, subscribe, getSnapshot, refresh, applySkills, useSkillReport, startPolling, stopPolling }
