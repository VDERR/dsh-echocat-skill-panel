// Skill provenance — where an installed skill came from, and whether it changed.
//
// Why this exists
// ---------------
// 3.0 could install a skill but immediately forgot where it came from: the pasted
// address was used once and dropped, and a git clone was deleted after the copy.
// The practical consequence is that a skill could never be *updated* — the user's
// only route was to delete it (which moves it to a backup they then have to find)
// and install it again, without any way to tell whether the new copy was actually
// newer. This module is the missing record.
//
// Design rules
// ------------
//   1. The record lives INSIDE the skill directory, as `.echocat.json`. Two
//      reasons: a skill stays portable when the user moves or copies it, and the
//      user can read or delete the file without asking this plugin. A dotfile
//      cannot collide with a skill's own files (skill folders are kebab-case),
//      and discovery ignores it because it looks for SKILL.md.
//   2. It never records anything the user did not already send us. The install
//      request already carries the address; this only writes it down.
//   3. Reading is total. A missing, truncated or hand-edited record is `null`, not
//      a throw — the panel must still render the skill.
//   4. Nothing here performs network IO except `resolveRemoteRef`, which runs a
//      single `git ls-remote`. A *comparison* is always explicit; nothing on the
//      5-second state poll may reach the network.
//
// NOT a client module: it imports `node:fs`/`node:child_process`, so it is host-only
// and deliberately absent from `tools/build-client.mjs`'s module table. The browser
// half receives the already-derived fields on the state payload.

import { spawn } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

/** File name of the record, inside the skill's own directory. */
export const PROVENANCE_FILE = '.echocat.json'

/** Schema version of that file, so a future change can migrate instead of guess. */
export const PROVENANCE_VERSION = 1

/** Source kinds, mirroring the install modes the engine already speaks. */
export const SOURCE_KINDS = Object.freeze(['git', 'url', 'file', 'text'])

/** A 40-hex-char object id: a pinned revision, not a moving branch. */
const COMMIT_RE = /^[0-9a-f]{40}$/u

/** Longest address we are willing to write down (a hostile or silly input guard). */
const MAX_URL = 2048

/**
 * Deterministic 64-bit FNV-1a, rendered as 16 hex characters.
 *
 * Deliberately NOT `node:crypto`: this value is a *change detector*, not a
 * security primitive, and a hand-rolled hash keeps the module free of any
 * provider-dependent output (a test that pins a digest must not break because the
 * runtime changed its defaults). Implemented with two 32-bit halves via BigInt so
 * the whole 64 bits are real rather than a truncated 32.
 */
export function hashText(text) {
  const PRIME = 1099511628211n
  const MASK = 0xffffffffffffffffn
  let hash = 14695981039346656037n
  const bytes = Buffer.from(String(text), 'utf8')
  for (const byte of bytes) {
    hash = ((hash ^ BigInt(byte)) * PRIME) & MASK
  }
  return hash.toString(16).padStart(16, '0')
}

/**
 * Fingerprint of a skill directory's *content*.
 *
 * Covers relative paths, sizes and each file's bytes, so an edit, a deletion or an
 * added asset all move it. `.echocat.json` itself is excluded — otherwise writing
 * the record would invalidate the very fingerprint it stores.
 *
 * @returns `{ hash, files, bytes, truncated }`. `truncated: true` means the walk
 *   hit `maxFiles`; the hash is still useful for change detection but must not be
 *   presented as a verified identity.
 */
export function fingerprintTree(dir, { maxFiles = 2000, maxBytes = 32 * 1024 * 1024 } = {}) {
  const parts = []
  let files = 0
  let bytes = 0
  let truncated = false
  const walk = (current) => {
    if (truncated) return
    let entries
    try {
      entries = readdirSync(current, { withFileTypes: true })
    } catch {
      return
    }
    // Sorted, because directory order is not stable across filesystems — an
    // unsorted walk would report a spurious change when nothing changed.
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    for (const entry of entries) {
      if (truncated) return
      if (entry.name === PROVENANCE_FILE) continue
      const full = join(current, entry.name)
      const rel = relative(dir, full).split(sep).join('/')
      let info
      try {
        info = statSync(full)
      } catch {
        continue
      }
      if (info.isDirectory()) {
        parts.push(`d:${rel}`)
        walk(full)
        continue
      }
      if (!info.isFile()) continue
      if (files >= maxFiles || bytes + info.size > maxBytes) {
        truncated = true
        return
      }
      files += 1
      bytes += info.size
      let digest = ''
      try {
        digest = hashText(readFileSync(full))
      } catch {
        digest = 'unreadable'
      }
      parts.push(`f:${rel}:${info.size}:${digest}`)
    }
  }
  walk(dir)
  return { hash: hashText(parts.join('\n')), files, bytes, truncated }
}

/* ------------------------------------------------------------------ record -- */

/** Keep a scalar inside sane bounds; the record is written into the user's folder. */
const text = (value, max) => {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  return trimmed === '' ? '' : trimmed.slice(0, max)
}

/**
 * Normalise an install's source description into the record we store.
 *
 * @param options.source - the install response's `source` (or a client-supplied claim).
 * @param options.installedAt - epoch ms; defaulted by the caller.
 * @returns `{ source, url, repo, ref, subpath, commit, claimed }`.
 */
export function describeSource({ source, url = '', repo = '', ref = '', subpath = '', commit = '' } = {}) {
  // `source` may be the string the engine already produced (a URL or a filename), or
  // the `{kind, url, ...}` object an install path built. Both are accepted, because
  // both reach this function depending on which mode the install took.
  const asObject = source !== null && typeof source === 'object' ? source : null
  const kind = (() => {
    // An explicit `kind` is the install path telling us what it IS (a pasted body, an
    // upload, a URL, a clone). Trusting it beats inferring from an address the caller
    // may not have: an upload has a filename and no address, and inferring "file"
    // from that would be right by luck rather than by design.
    if (asObject !== null && SOURCE_KINDS.includes(asObject.kind)) return asObject.kind
    if (text(repo, MAX_URL) !== '') return 'git'
    if (text(url, MAX_URL) !== '') return 'url'
    return 'file'
  })()
  const given = asObject === null ? text(source, MAX_URL) : ''
  return {
    source: kind,
    // For a `git` source the canonical address is the repository; otherwise it is
    // whatever address the install came from (a URL, or an uploaded filename).
    url: text(asObject?.url, MAX_URL) || text(url, MAX_URL) || given,
    repo: text(asObject?.repo, MAX_URL) || text(repo, MAX_URL),
    ref: text(asObject?.ref, 200) || text(ref, 200),
    subpath: text(asObject?.subpath, 500) || text(subpath, 500),
    commit: text(commit, 64).toLowerCase(),
    claimed: false,
  }
}

/**
 * Build the record to write for a freshly installed skill.
 *
 * @param options.dir - the skill directory (already staged or committed).
 * @param options.name - the installed skill's slug.
 * @param options.fields - output of {@link describeSource}.
 * @param options.version - the plugin's version, for later diagnosis.
 * @param options.now - epoch ms, injectable for tests.
 */
export function buildRecord({ dir, name, fields, version = '', now = Date.now() }) {
  const print = fingerprintTree(dir)
  return {
    version: PROVENANCE_VERSION,
    plugin: text(version, 40),
    name: text(name, 100),
    installedAt: now,
    source: fields.source,
    url: fields.url,
    repo: fields.repo,
    ref: fields.ref,
    subpath: fields.subpath,
    commit: fields.commit,
    claimed: fields.claimed === true,
    fingerprint: print.hash,
    files: print.files,
    bytes: print.bytes,
    ...(print.truncated ? { fingerprintPartial: true } : {}),
  }
}

/**
 * Serialise a record. `files`/`bytes`/`commit` are omitted when empty rather than
 * written as `""` — a reader should see absence, not a meaningless value.
 */
export function serializeRecord(record) {
  const out = {}
  for (const [key, value] of Object.entries(record)) {
    if (value === '' || value === undefined || value === null) continue
    out[key] = value
  }
  return `${JSON.stringify(out, null, 2)}\n`
}

/**
 * Write the record into `dir`. Returns the record, so callers can report it.
 *
 * Sibling temp + rename rather than a direct write: skill discovery scans these
 * directories, and a half-written record must never be observable. Same discipline
 * as `renameDisplayName` in install.js.
 */
export function writeProvenance(dir, record) {
  const file = join(dir, PROVENANCE_FILE)
  const staging = `${file}.tmp-${Math.floor(Math.random() * 0xffffffff).toString(36)}`
  try {
    writeFileSync(staging, serializeRecord(record), 'utf8')
    renameSync(staging, file)
  } catch (error) {
    try {
      rmSync(staging, { force: true })
    } catch {
      // The staging name is dot-prefixed inside the skill; a leftover is untidy,
      // never harmful, and must not turn a write failure into a different one.
    }
    throw error
  }
  return record
}

/* --------------------------------------------------------- summary for UI -- */

/**
 * The subset of the record the panel renders, derived fresh on every state poll.
 *
 * `changedSinceInstall` is the interesting one: it means the user (or another tool)
 * edited the skill after it was installed, which is exactly when a blind update
 * would silently destroy that edit — so the UI can warn before overwriting.
 */
export function provenanceSummary(dir, { readFile = readFileSync } = {}) {
  const record = readProvenance(dir, { readFile })
  if (record === null) return { known: false, source: '', changedSinceInstall: false }
  const current = fingerprintTree(dir)
  return {
    known: true,
    source: record.source,
    url: record.url,
    repo: record.repo,
    ref: record.ref,
    subpath: record.subpath,
    commit: record.commit,
    installedAt: record.installedAt,
    claimed: record.claimed === true,
    files: record.files,
    bytes: record.bytes,
    // An unreadable or partially-hashed tree cannot prove anything either way.
    changedSinceInstall: current.truncated === true ? false : current.hash !== record.fingerprint,
  }
}

/** Read one skill's record. Total: anything unusable is `null`. */
export function readProvenance(dir, { readFile = readFileSync } = {}) {
  const file = join(dir, PROVENANCE_FILE)
  try {
    if (!existsSync(file)) return null
    const parsed = JSON.parse(readFile(file, 'utf8'))
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    if (typeof parsed.fingerprint !== 'string' || parsed.fingerprint === '') return null
    return {
      version: typeof parsed.version === 'number' ? parsed.version : 0,
      name: typeof parsed.name === 'string' ? parsed.name : '',
      installedAt: typeof parsed.installedAt === 'number' ? parsed.installedAt : 0,
      source: SOURCE_KINDS.includes(parsed.source) ? parsed.source : 'file',
      url: typeof parsed.url === 'string' ? parsed.url : '',
      repo: typeof parsed.repo === 'string' ? parsed.repo : '',
      ref: typeof parsed.ref === 'string' ? parsed.ref : '',
      subpath: typeof parsed.subpath === 'string' ? parsed.subpath : '',
      commit: typeof parsed.commit === 'string' ? parsed.commit : '',
      claimed: parsed.claimed === true,
      fingerprint: parsed.fingerprint,
      files: typeof parsed.files === 'number' ? parsed.files : 0,
      bytes: typeof parsed.bytes === 'number' ? parsed.bytes : 0,
      fingerprintPartial: parsed.fingerprintPartial === true,
    }
  } catch {
    // A corrupt record costs the panel a provenance badge, never the skill row.
    return null
  }
}

/* ------------------------------------------------------------------ remote -- */

/** True when the stored ref is a pinned revision rather than a moving branch. */
export function isPinnedRevision(ref) {
  return COMMIT_RE.test(String(ref ?? '').trim().toLowerCase())
}

/**
 * Ask the remote which revision a ref points at, WITHOUT cloning.
 *
 * One `git ls-remote` — the cheapest question that has an honest answer. Comparing
 * file contents instead would mean re-downloading the whole skill on every check,
 * which is exactly the kind of cost that turns a "check for updates" button into
 * something nobody presses.
 *
 * @returns `{ ok, sha, error, code }`. Never throws: the caller is a UI action and a
 *   network failure is a normal outcome, not an exception.
 */
export function resolveRemoteRef({ repo, ref = '', gitBinary = 'git', timeoutMs = 20000, spawnImpl = spawn }) {
  return new Promise((resolvePromise) => {
    const target = String(repo ?? '').trim()
    if (target === '') {
      resolvePromise({ ok: false, sha: '', code: 'BAD_REQUEST', error: '没有记录来源仓库。' })
      return
    }
    const wanted = String(ref ?? '').trim()
    const args = ['ls-remote', target, ...(wanted === '' ? ['HEAD'] : [wanted])]
    let output = ''
    let settle
    const done = (value) => {
      if (settle === undefined) return
      const finish = settle
      settle = undefined
      clearTimeout(timer)
      finish(value)
    }
    const timer = setTimeout(() => {
      try {
        child?.kill()
      } catch {
        // Already gone.
      }
      done({ ok: false, sha: '', code: 'NETWORK', error: `查询远端超过 ${Math.round(timeoutMs / 1000)} 秒。` })
    }, timeoutMs)
    let child
    try {
      child = spawnImpl(gitBinary, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (error) {
      clearTimeout(timer)
      resolvePromise({ ok: false, sha: '', code: 'GIT_FAILED', error: `git 启动失败：${error?.message ?? error}` })
      return
    }
    settle = resolvePromise
    child.stdout?.on('data', (chunk) => {
      output = (output + String(chunk)).slice(-4000)
    })
    child.on('error', (error) => done({ ok: false, sha: '', code: 'GIT_FAILED', error: `git 无法执行：${error?.message ?? error}` }))
    child.on('exit', (code) => {
      if (code !== 0) {
        done({ ok: false, sha: '', code: 'GIT_FAILED', error: `git ls-remote 退出码 ${code}：${output.trim().slice(-300)}` })
        return
      }
      // `ls-remote` prints `<sha>\t<ref>` per match. For a branch it matches
      // `refs/heads/<ref>`; HEAD matches whatever the remote's default branch is.
      const first = output
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '')
        .map((line) => line.split(/\s+/u)[0])
        .find((sha) => COMMIT_RE.test(sha.toLowerCase()))
      if (first === undefined) {
        done({ ok: false, sha: '', code: 'NOT_FOUND', error: `远端找不到这个分支：${wanted === '' ? 'HEAD' : wanted}` })
        return
      }
      done({ ok: true, sha: first.toLowerCase(), error: '' })
    })
  })
}

/**
 * The bare SHA of a ref inside an existing clone (`HEAD` after a `--branch` clone).
 * Used at install time to record exactly what was installed.
 */
export function revParse(dir, { gitBinary = 'git', timeoutMs = 10000, spawnImpl = spawn } = {}) {
  return new Promise((resolvePromise) => {
    let child
    const timer = setTimeout(() => {
      try {
        child?.kill()
      } catch {
        // Already gone.
      }
      resolvePromise('')
    }, timeoutMs)
    try {
      child = spawnImpl(gitBinary, ['rev-parse', 'HEAD'], { cwd: dir, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })
    } catch {
      clearTimeout(timer)
      resolvePromise('')
      return
    }
    let output = ''
    child.stdout?.on('data', (chunk) => {
      output = (output + String(chunk)).slice(-200)
    })
    child.on('error', () => {
      clearTimeout(timer)
      resolvePromise('')
    })
    child.on('exit', (code) => {
      clearTimeout(timer)
      const sha = code === 0 ? output.trim().toLowerCase() : ''
      resolvePromise(COMMIT_RE.test(sha) ? sha : '')
    })
  })
}
