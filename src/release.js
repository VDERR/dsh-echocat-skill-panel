/**
 * "Is there a newer version of this plugin?" — the one question this plugin cannot answer
 * from local state.
 *
 * WHY IT LIVES ON THE HOST. The answer needs an outbound HTTPS request, and the browser
 * half is not allowed to make one: every byte that reaches the panel comes over
 * `/api/…` so the app's `dsh-client-connection` trust fence (Host/Origin plus the browser
 * session) applies to it. A panel that called `registry.npmjs.org` directly would be
 * reaching the network from a page the app never vetted, and a CORS failure would look to
 * the user like a broken button. So the fetch happens here and the panel gets a value.
 *
 * WHY TWO SOURCES. The npm registry knows what `npm i` would install; the GitHub API knows
 * what a human reading the repo would see, and it carries the release notes. Either can be
 * missing — a package unpublished, a repo with no releases, no network at all — and the
 * panel has to be able to say "I could not tell", so every failure path returns a value
 * with a reason rather than throwing.
 */

import { VERSION } from './version.js'

/** Registry documents; `latest` is the dist-tag `npm i <name>` resolves to. */
export const NPM_LATEST_URL = (name) => `https://registry.npmjs.org/${name}/latest`

/** The repository this plugin is published from, and its human-facing release page. */
export const REPO_URL = 'https://github.com/VDERR/echocat-skill-panel'
export const RELEASES_URL = `${REPO_URL}/releases`
export const GITHUB_LATEST_URL = 'https://api.github.com/repos/VDERR/echocat-skill-panel/releases/latest'

/** How long an answer is reused before another click is allowed to ask again. */
const CACHE_MS = 10 * 60 * 1000
const TIMEOUT_MS = 8000

/**
 * Order two version strings.
 *
 * Deliberately a small hand-written comparison rather than a semver dependency: this runs
 * on the host of a desktop app, the peer-dependency set is deliberately tiny, and the only
 * question being asked is "is B newer than A". Build metadata is ignored (semver says it
 * must not affect precedence) and a tag without a patch (`1.2`) reads as `1.2.0`.
 *
 * A prerelease sorts BELOW its release (`4.0.0-rc.1` < `4.0.0`), which is what stops the
 * panel from telling a user on a release to "upgrade" to a release candidate.
 *
 * @returns negative when `a` is older, 0 when equal, positive when newer.
 */
export function compareVersions(a, b) {
  const parse = (value) => {
    const text = String(value ?? '').trim().replace(/^v/iu, '')
    if (text === '') return null
    const [core, ...pre] = text.split('-')
    const parts = core.split('.')
    // Every component must LOOK numeric. Without this check `Number('nonsense')` is NaN,
    // the comparison below yields NaN, and the caller reads that as "equal" — so a garbage
    // tag would have been silently reported as "you are up to date".
    if (!parts.every((part) => /^\d+$/u.test(part))) return null
    const numbers = parts.map(Number)
    while (numbers.length < 3) numbers.push(0)
    return { numbers, pre: pre.join('-') }
  }
  const left = parse(a)
  const right = parse(b)
  // An unparseable side is never "newer": refusing to answer is better than telling
  // someone to upgrade on the strength of a string we did not understand.
  if (left === null || right === null) return 0
  for (let i = 0; i < 3; i += 1) {
    if (left.numbers[i] !== right.numbers[i]) return left.numbers[i] - right.numbers[i]
  }
  if (left.pre === right.pre) return 0
  if (left.pre === '') return 1
  if (right.pre === '') return -1
  return left.pre < right.pre ? -1 : 1
}

/**
 * One GET that always resolves — to a value or to an error, never a rejection.
 *
 * @returns `{ ok: true, body }` or `{ ok: false, reason }` where `reason` is short enough
 *   to put in a tooltip.
 */
async function getJson(fetchImpl, url, headers = {}) {
  if (typeof fetchImpl !== 'function') return { ok: false, reason: '主机侧没有可用的 fetch' }
  let response
  try {
    // `AbortSignal.timeout` rather than a manual timer: a check that outlives the panel
    // would keep a socket open for a user who already closed it.
    const signal = typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(TIMEOUT_MS) : undefined
    response = await fetchImpl(url, {
      headers: { accept: 'application/json', 'user-agent': `echocat-skill-panel/${VERSION}`, ...headers },
      signal,
      redirect: 'follow',
    })
  } catch (error) {
    const message = String(error?.message ?? error)
    return { ok: false, reason: /abort|timeout/iu.test(message) ? '请求超时' : `网络不可达：${message}` }
  }
  if (response?.ok !== true) {
    // 404 from the registry genuinely means "not published"; say that rather than
    // reporting a network fault the user cannot act on.
    if (response?.status === 404) return { ok: false, reason: '源上没有这个版本信息（可能还没发布）', notFound: true }
    return { ok: false, reason: `HTTP ${response?.status ?? '?'}` }
  }
  try {
    return { ok: true, body: await response.json() }
  } catch (error) {
    return { ok: false, reason: `返回的不是 JSON：${String(error?.message ?? error)}` }
  }
}

/**
 * Build the checker the state route and the release route both read.
 *
 * @param options.version  - the running plugin's version (injected, so the tests can pin it)
 * @param options.fetchImpl - platform fetch, injected for the same reason
 * @param options.allowNetwork - false turns the whole thing into "disabled by config"
 */
export function createReleaseChecker({ version = VERSION, fetchImpl, allowNetwork = true, logger } = {}) {
  let cached = null
  let inflight = null

  const base = {
    /** What this plugin IS, whether or not anything has been checked. */
    current: version,
    name: 'echocat-skill-panel',
    repo: REPO_URL,
    releases: RELEASES_URL,
    checkable: allowNetwork === true && typeof fetchImpl === 'function',
  }

  /**
   * The last answer, or null when nothing has been checked in this process.
   *
   * Returns the VALUE, not the cache envelope: every caller wants to put it straight into a
   * payload, and making each of them reach through `.value` is how one of them ends up
   * reading the timestamp instead. `at` is exposed separately for diagnostics.
   */
  const peek = () => (cached === null ? null : cached.value)
  const peekedAt = () => (cached === null ? 0 : cached.at)

  /**
   * Ask both sources. Concurrent callers share one round of requests: the panel can be
   * mounted in three seats, and three clicks must not become six requests.
   */
  async function check({ force = false } = {}) {
    if (allowNetwork !== true) {
      return { ...base, checked: false, reason: '配置里关掉了联网检查', latest: null }
    }
    if (typeof fetchImpl !== 'function') {
      return { ...base, checked: false, reason: '主机侧没有可用的 fetch', latest: null }
    }
    const now = Date.now()
    if (force !== true && cached !== null && now - cached.at < CACHE_MS) {
      return { ...base, ...cached.value, checked: true, cached: true }
    }
    if (inflight !== null) return inflight

    inflight = (async () => {
      const [registry, github] = await Promise.all([
        getJson(fetchImpl, NPM_LATEST_URL(base.name)),
        getJson(fetchImpl, GITHUB_LATEST_URL, { accept: 'application/vnd.github+json' }),
      ])

      const npmVersion = registry.ok === true && typeof registry.body?.version === 'string' ? registry.body.version : ''
      const rawTag = github.ok === true && typeof github.body?.tag_name === 'string' ? github.body.tag_name : ''
      // Normalised for COMPARISON and for display: `compareVersions` tolerates a leading
      // `v`, but the panel shows this string next to the running version, and
      // "有新版本 v4.1.0（当前 4.0.0）" mixes two conventions in one sentence.
      const tagVersion = rawTag.replace(/^v/iu, '')
      // Prefer whichever source reports the HIGHER version: a release can be tagged before
      // the package is published, and the user wants to know about the newer of the two.
      const candidates = [npmVersion, tagVersion].filter((value) => value !== '' && compareVersions(value, value) === 0)
      const newest = candidates.reduce((best, value) => (best === '' || compareVersions(value, best) > 0 ? value : best), '')

      const value = {
        latest: newest === '' ? null : newest,
        /** True only when `latest` is strictly newer than what is running. */
        hasUpdate: newest !== '' && compareVersions(newest, version) > 0,
        npm: npmVersion === '' ? null : npmVersion,
        /** The RAW tag, because that is what the release page shows. */
        tag: rawTag === '' ? null : rawTag,
        /** Release notes, so the panel can say WHAT changed without another request. */
        notes: github.ok === true && typeof github.body?.body === 'string' ? github.body.body.slice(0, 2000) : '',
        publishedAt: github.ok === true && typeof github.body?.published_at === 'string' ? github.body.published_at : '',
        htmlUrl: github.ok === true && typeof github.body?.html_url === 'string' ? github.body.html_url : RELEASES_URL,
        checkedAt: now,
        reason: newest === '' ? [registry.reason, github.reason].filter(Boolean).join('；') || '没有查到版本信息' : '',
      }
      cached = { at: now, value }
      return { ...base, ...value, checked: true, cached: false }
    })()

    try {
      return await inflight
    } catch (error) {
      // Nothing above should throw, but a route must never 500 over a version question.
      logger?.warn?.(`skill-report: release check failed: ${error?.stack ?? error}`)
      return { ...base, checked: true, latest: null, hasUpdate: false, reason: `检查失败：${String(error?.message ?? error)}` }
    } finally {
      inflight = null
    }
  }

  return { base, peek, peekedAt, check, compareVersions }
}

export const releaseInternals = { getJson, CACHE_MS, TIMEOUT_MS }
