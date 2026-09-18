// Skill install / uninstall engine (host half).
//
// This module owns every filesystem write the plugin performs. It is deliberately
// free of cordis and of the panel: the HTTP layer in src/index.js parses a
// request, calls one method here, and serialises the result. Keeping the writes
// in one place is what makes the safety story auditable — every path that
// reaches the filesystem goes through `targetFor()`, and every archive entry
// through `safeEntryName()`.
//
// Design rules, in priority order
// ------------------------------
//   1. Never write outside the skills root. Names are validated against a strict
//      slug pattern AND the resolved path is re-checked for containment, because
//      the pattern alone cannot stop a symlinked parent.
//   2. Never destroy the user's data. A successful install is staged in a
//      dot-prefixed sibling directory and only then renamed into place; replacing
//      an existing skill first moves it into a timestamped backup directory, and
//      uninstall moves rather than deletes.
//   3. Never fail silently. Every failure is an `InstallError` with a stable
//      `code` the browser half can branch on, plus a message a user can act on.
//   4. Never trust the input. A zip is parsed by hand precisely so that zip-slip
//      (`../`), absolute paths, symlink entries and decompression bombs can be
//      rejected before anything is written.
//
// Why a hand-written zip reader: Node ships no public zip API, this plugin has
// no runtime dependencies by design (the DSH plugin tree has no per-plugin
// isolation, so every dependency is a liability), and the subset a skill archive
// needs is small — stored + deflate entries, no zip64, no encryption.

import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { inflateRawSync } from 'node:zlib'

/** Version of the install protocol the browser half speaks. */
export const INSTALL_API = 1

/**
 * A skill directory name must be a conservative slug.
 *
 * Every skill discovered on this machine is lowercase-kebab, and discovery
 * derives a skill's name from its directory (or file) name — so an install that
 * accepted `My Skill!` would "succeed" and then never appear. Rejecting it up
 * front, with the slugified suggestion attached, is the honest behaviour.
 */
export const SKILL_NAME_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/

/** Hard caps. A skill is prose plus a few assets; anything larger is a mistake. */
export const LIMITS = Object.freeze({
  /** Largest single uploaded payload (base64-decoded) accepted from the browser. */
  uploadBytes: 24 * 1024 * 1024,
  /** Largest archive accepted from a URL. */
  downloadBytes: 64 * 1024 * 1024,
  /** Largest single extracted file. */
  fileBytes: 8 * 1024 * 1024,
  /** Largest total extracted content. */
  totalBytes: 64 * 1024 * 1024,
  /** Largest number of files in one archive. */
  files: 600,
  /** Largest inline SKILL.md body. */
  markdownBytes: 512 * 1024,
  /** Wall-clock budget for one network fetch. */
  fetchMs: 30000,
  /** Wall-clock budget for one git clone. */
  gitMs: 120000,
})

/** A failure with a stable machine-readable code. */
export class InstallError extends Error {
  constructor(code, message, hint) {
    super(message)
    this.name = 'InstallError'
    this.code = code
    if (typeof hint === 'string' && hint !== '') this.hint = hint
  }
}

/** Turn any thrown value into the wire shape, without leaking a stack. */
export function toInstallError(error) {
  if (error instanceof InstallError) {
    return { code: error.code, message: error.message, ...(error.hint === undefined ? {} : { hint: error.hint }) }
  }
  const message = String(error?.message ?? error)
  return { code: 'INTERNAL', message, hint: '把这条信息连同 host 日志一起反馈。' }
}

/* ------------------------------------------------------------------ names -- */

/** `My Skill!` -> `my-skill`; used only to *suggest*, never to silently rename. */
export function slugify(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, '-')
    .replace(/^[-._]+/u, '')
    .replace(/-{2,}/gu, '-')
    .slice(0, 64)
    .replace(/[-._]+$/u, '')
}

/** Validate a requested skill name, or throw with the suggestion attached. */
export function assertSkillName(name) {
  const raw = String(name ?? '').trim()
  if (raw === '') throw new InstallError('INVALID_NAME', '缺少 skill 名称。')
  if (raw.includes('/') || raw.includes('\\') || raw.includes('\0')) {
    throw new InstallError('INVALID_NAME', `名称里不能有路径分隔符：${raw}`)
  }
  if (raw === '.' || raw === '..') throw new InstallError('INVALID_NAME', '名称不能是 "." 或 ".."。')
  if (SKILL_NAME_RE.test(raw)) return raw
  const suggestion = slugify(raw)
  throw new InstallError(
    'INVALID_NAME',
    `"${raw}" 不是合法的 skill 名称：只允许小写字母、数字、"-"、"_"、"."，且以字母或数字开头。`,
    suggestion === '' ? undefined : `建议改成 "${suggestion}"。`,
  )
}

/** First non-empty string among the candidates, or `''`. */
function firstName(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
  }
  return ''
}

/** `decodeURIComponent` throws on a malformed escape; a filename is not worth failing over. */
function safeDecode(value) {
  try {
    return decodeURIComponent(String(value ?? ''))
  } catch {
    return String(value ?? '')
  }
}

/* ------------------------------------------------------------- skills root -- */

/**
 * Where a newly installed skill must be written.
 *
 * Resolution order, most authoritative first:
 *   1. an explicit absolute `skillsRoot` in the plugin config;
 *   2. the parent directory of the skills the `skills` service is already
 *      reporting — this is the ground truth, because it is literally where the
 *      running app looks, and it survives a DSH_HOME the plugin cannot guess;
 *   3. `$DSH_HOME/skills`, else `~/.dsh-beta/skills`.
 *
 * @param options.configured - config value, may be undefined.
 * @param options.discovered - absolute skill directories from the live snapshot.
 * @param options.env - environment map (injectable for tests).
 */
export function resolveSkillsRoot({ configured, discovered = [], env = process.env } = {}) {
  if (typeof configured === 'string' && isAbsolute(configured)) return resolve(configured)

  // A skill directory is always <root>/<name>. Require the parent to look like a
  // skills container so an exotic provider path cannot silently become our
  // write target; a wrong guess here would install into a directory the app
  // never reads.
  const parents = new Map()
  for (const dir of discovered) {
    if (typeof dir !== 'string' || dir === '') continue
    const parent = resolve(dir, '..')
    if (/(^|[\\/])skills$/iu.test(parent)) parents.set(parent, (parents.get(parent) ?? 0) + 1)
  }
  if (parents.size > 0) {
    const [best] = [...parents.entries()].sort((a, b) => b[1] - a[1])
    return best[0]
  }

  const home = typeof env.DSH_HOME === 'string' && env.DSH_HOME !== '' ? env.DSH_HOME : join(homedir(), '.dsh-beta')
  return resolve(home, 'skills')
}

/* ------------------------------------------------------------------ limits -- */

/** Reject a value that exceeds one of the caps, with the cap named in the message. */
function assertSize(bytes, cap, label) {
  if (!Number.isFinite(bytes) || bytes < 0) throw new InstallError('BAD_REQUEST', `${label} 大小不可读。`)
  if (bytes > cap) {
    throw new InstallError('TOO_LARGE', `${label} 有 ${Math.round(bytes / 1024)} KB，超过上限 ${Math.round(cap / 1024)} KB。`)
  }
}

/* ------------------------------------------------------------ frontmatter -- */

/**
 * Parse a SKILL.md frontmatter block.
 *
 * Deliberately a small YAML subset rather than a YAML engine: keys, plain and
 * quoted scalars, inline `[a, b]` lists, and `>` / `|` block scalars. That is
 * what real SKILL.md files use, and a full YAML parser is exactly the kind of
 * dependency this plugin must not carry.
 *
 * @returns `{ present, data, body, errors }` — never throws on malformed input,
 *          because the caller wants to *report* a bad file, not crash on it.
 */
export function parseFrontmatter(text) {
  const source = String(text ?? '').replace(/^\uFEFF/u, '')
  const errors = []
  const lines = source.split(/\r?\n/u)
  if (lines[0]?.trim() !== '---') return { present: false, data: {}, body: source.trim(), errors }

  let end = -1
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trim() === '---') {
      end = i
      break
    }
  }
  if (end === -1) {
    errors.push('frontmatter 起始的 "---" 没有对应的结束行')
    return { present: false, data: {}, body: source.trim(), errors }
  }

  const data = {}
  const block = lines.slice(1, end)
  for (let i = 0; i < block.length; i += 1) {
    const line = block[i]
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue
    const match = /^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/u.exec(line)
    if (match === null) {
      // A continuation of a block scalar, or an indented nested structure we do
      // not model (skills only need top-level scalars).
      if (/^\s+\S/u.test(line)) continue
      errors.push(`第 ${i + 2} 行不是 "key: value" 形式，已忽略`)
      continue
    }
    const key = match[1]
    let value = match[2].trim()

    if (value === '>' || value === '|' || value === '>-' || value === '|-') {
      const folded = value.startsWith('>')
      const parts = []
      let j = i + 1
      for (; j < block.length; j += 1) {
        if (block[j].trim() === '') {
          parts.push('')
          continue
        }
        if (!/^\s/u.test(block[j])) break
        parts.push(block[j].trim())
      }
      i = j - 1
      while (parts.length > 0 && parts[parts.length - 1] === '') parts.pop()
      value = folded ? parts.join(' ').replace(/\s{2,}/gu, ' ').trim() : parts.join('\n')
      data[key] = value
      continue
    }

    if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
      value = value.slice(1, -1)
      if (match[2].trim().startsWith('"')) value = value.replace(/\\n/gu, '\n').replace(/\\"/gu, '"')
    } else if (value.startsWith('[') && value.endsWith(']')) {
      data[key] = value
        .slice(1, -1)
        .split(',')
        .map((part) => part.trim().replace(/^["']|["']$/gu, ''))
        .filter((part) => part !== '')
      continue
    }
    data[key] = value
  }

  const body = lines
    .slice(end + 1)
    .join('\n')
    .trim()
  return { present: true, data, body, errors }
}

/** Render a frontmatter block from the fields a skill actually needs. */
export function renderFrontmatter({ name, description, extra = {} }) {
  const lines = ['---', `name: ${name}`, `description: ${JSON.stringify(description)}`]
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined || value === null || value === '') continue
    lines.push(`${key}: ${typeof value === 'string' ? JSON.stringify(value) : String(value)}`)
  }
  lines.push('---', '')
  return lines.join('\n')
}

/* -------------------------------------------------------------- zip reader -- */

const EOCD_SIG = 0x06054b50
const CEN_SIG = 0x02014b50
const LOC_SIG = 0x04034b50

/** Locate the End Of Central Directory record, scanning back over any comment. */
function findEocd(buffer) {
  const stop = Math.max(0, buffer.length - 22 - 0xffff)
  for (let i = buffer.length - 22; i >= stop; i -= 1) {
    if (buffer.readUInt32LE(i) === EOCD_SIG) return i
  }
  return -1
}

/**
 * Normalise an archive entry name, rejecting everything that could escape the
 * destination: absolute paths, drive letters, `..` segments and backslashes.
 */
function safeEntryName(raw) {
  const name = String(raw ?? '').replace(/\\/gu, '/')
  if (name === '' || name.includes('\0')) throw new InstallError('UNSAFE_PATH', '压缩包里有空文件名。')
  if (name.startsWith('/') || /^[A-Za-z]:/u.test(name)) {
    throw new InstallError('UNSAFE_PATH', `压缩包里含绝对路径：${name}`, '这种压缩包通常是在带盘符的工具里打的，请重新打包。')
  }
  const parts = name.split('/').filter((part) => part !== '' && part !== '.')
  if (parts.some((part) => part === '..')) {
    throw new InstallError('UNSAFE_PATH', `压缩包里含向上跳出的路径：${name}`)
  }
  if (parts.length === 0) throw new InstallError('UNSAFE_PATH', `压缩包里有无法使用的条目：${name}`)
  return parts.join('/')
}

/** Read the central directory of a stored/deflated zip, without extracting. */
function readCentralDirectory(buffer) {
  const eocd = findEocd(buffer)
  if (eocd === -1) {
    throw new InstallError('BAD_ARCHIVE', '这不是一个有效的 zip 文件。', '如果它是 .tar.gz 或 .rar，请先转成 zip，或改用「Git 仓库」方式。')
  }
  const count = buffer.readUInt16LE(eocd + 10)
  const cdOffset = buffer.readUInt32LE(eocd + 16)
  if (count === 0xffff || cdOffset === 0xffffffff) {
    throw new InstallError('BAD_ARCHIVE', '不支持 zip64 格式的压缩包。', '用普通 zip（小于 4 GB、条目少于 65535）重新打包即可。')
  }
  const entries = []
  let at = cdOffset
  for (let i = 0; i < count; i += 1) {
    if (at + 46 > buffer.length || buffer.readUInt32LE(at) !== CEN_SIG) {
      throw new InstallError('BAD_ARCHIVE', 'zip 中央目录已损坏。')
    }
    const flags = buffer.readUInt16LE(at + 8)
    const method = buffer.readUInt16LE(at + 10)
    const compSize = buffer.readUInt32LE(at + 20)
    const size = buffer.readUInt32LE(at + 24)
    const nameLen = buffer.readUInt16LE(at + 28)
    const extraLen = buffer.readUInt16LE(at + 30)
    const commentLen = buffer.readUInt16LE(at + 32)
    const externalAttr = buffer.readUInt32LE(at + 38)
    const localOffset = buffer.readUInt32LE(at + 42)
    const rawName = buffer.subarray(at + 46, at + 46 + nameLen)
    // Bit 11 means the writer promised UTF-8; otherwise assume the (older) CP437
    // reality. latin1 round-trips the bytes, which keeps ASCII names exact and
    // leaves non-ASCII names merely mangled rather than wrong-by-crash.
    const name = rawName.toString((flags & 0x800) === 0 ? 'latin1' : 'utf8')
    const unixMode = (externalAttr >>> 16) & 0xffff
    entries.push({
      name,
      method,
      compSize,
      size,
      localOffset,
      isDirectory: name.endsWith('/'),
      isSymlink: (unixMode & 0xf000) === 0xa000,
    })
    at += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

/** Inflate one entry from its local header. */
function readEntry(buffer, entry) {
  const at = entry.localOffset
  if (at + 30 > buffer.length || buffer.readUInt32LE(at) !== LOC_SIG) {
    throw new InstallError('BAD_ARCHIVE', `条目 "${entry.name}" 的本地头已损坏。`)
  }
  const nameLen = buffer.readUInt16LE(at + 26)
  const extraLen = buffer.readUInt16LE(at + 28)
  const start = at + 30 + nameLen + extraLen
  const end = start + entry.compSize
  if (end > buffer.length) throw new InstallError('BAD_ARCHIVE', `条目 "${entry.name}" 的数据被截断。`)
  const raw = buffer.subarray(start, end)
  if (entry.method === 0) return Buffer.from(raw)
  if (entry.method === 8) {
    try {
      return inflateRawSync(raw)
    } catch (error) {
      throw new InstallError('BAD_ARCHIVE', `解压 "${entry.name}" 失败：${error?.message ?? error}`)
    }
  }
  throw new InstallError('BAD_ARCHIVE', `"${entry.name}" 用了不支持的压缩方式（method=${entry.method}）。`)
}

/* ----------------------------------------------------------------- paths -- */

/**
 * Containment check. `assertSkillName` already forbids separators, so this is
 * the second lock: it catches a symlinked root and any future relaxation of the
 * name rule. `relative()` is used instead of `startsWith()` because
 * `startsWith('/skills')` also matches `/skills-evil`.
 */
function assertInside(root, target) {
  const base = resolve(root)
  const full = resolve(target)
  const rel = relative(base, full)
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel) || rel.split(sep).includes('..')) {
    throw new InstallError('UNSAFE_PATH', '拒绝写入 skills 目录之外的路径。')
  }
  return full
}

/** `.echocat-stage-<rand>` — hidden, inside the root, so the rename stays on one volume. */
function stagePath(root) {
  return join(root, `.echocat-stage-${randomBytes(6).toString('hex')}`)
}

/* ------------------------------------------------------- chinese name -- */

/** Longest accepted Chinese display name. A name, not a description. */
export const DISPLAY_NAME_ZH_MAX = 40

/**
 * Validate the optional Chinese display name.
 *
 * The skill's NAME stays an ASCII slug: it is simultaneously the directory name,
 * the catalogue identity and the `/名字` composer gesture. The Chinese name belongs
 * in `meta.yaml` as `display-name-zh` — which is exactly what all ten skills
 * installed on this machine do, and what the panel already reads back as
 * `skills[].displayNameZh`. This function is only about that field.
 *
 * @returns the trimmed value, or `''` when the field was left empty.
 */
export function cleanDisplayNameZh(value) {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') {
    throw new InstallError('BAD_REQUEST', '中文显示名必须是一段文字。', '如果你是从别处粘贴的，请只保留名字本身。')
  }
  const trimmed = value.trim()
  if (trimmed === '') return ''
  // Count code points, not UTF-16 units, so an emoji costs one.
  if ([...trimmed].length > DISPLAY_NAME_ZH_MAX) {
    throw new InstallError(
      'BAD_REQUEST',
      `中文显示名最多 ${DISPLAY_NAME_ZH_MAX} 个字，收到 ${[...trimmed].length} 个。`,
      '它只是面板上显示的名字，把说明留在 SKILL.md 里就好。',
    )
  }
  if (/[\u0000-\u001f\u007f]/u.test(trimmed)) {
    throw new InstallError('BAD_REQUEST', '中文显示名里不能有换行或控制字符。', '它必须是一行文字。')
  }
  return trimmed
}

/** Characters that would change how a YAML reader parses a bare scalar. */
const YAML_RISKY = /[:#'"]/u
/** A leading indicator character also has meaning in YAML. */
const YAML_LEADING = /^[-?*&!|>%@`]/u

/** Emit a bare scalar when it is safe to, single-quote it otherwise. */
function yamlValue(value) {
  const risky = YAML_RISKY.test(value) || YAML_LEADING.test(value) || value !== value.trim()
  return risky ? `'${value.replace(/'/gu, "''")}'` : value
}

/**
 * Patch a `meta.yaml`, changing one line and nothing else.
 *
 * A zip or a repository usually ships a `meta.yaml` that already carries
 * `summary-cn`, `tag-cn`, `complete-tags-*`, `version` and comments. Parsing and
 * re-serialising it would drop the comments, reorder the keys and lose every field
 * this engine does not model — so the file is edited line by line instead, and
 * every other byte survives. `display-name-zh` goes first because that is where
 * every skill in this ecosystem keeps it.
 */
export function patchMetaYaml(text, displayNameZh) {
  const lines = String(text ?? '')
    .replace(/\r\n?/gu, '\n')
    .split('\n')
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  const at = lines.findIndex((entry) => /^display-name-zh\s*:/u.test(entry))
  // An EMPTY value clears the key rather than writing an empty one, so a clear can
  // undo a create. Returning `''` means "nothing left worth keeping" and the caller
  // deletes the file — a meta.yaml holding only a blank key would be litter.
  if (displayNameZh === '' || displayNameZh === undefined || displayNameZh === null) {
    if (at < 0) return lines.length === 0 ? '' : `${lines.join('\n')}\n`
    lines.splice(at, 1)
    return lines.length === 0 ? '' : `${lines.join('\n')}\n`
  }
  const line = `display-name-zh: ${yamlValue(displayNameZh)}`
  if (at >= 0) lines[at] = line
  else lines.unshift(line)
  return `${lines.join('\n')}\n`
}

/* ---------------------------------------------------------------- sources -- */

/** Hosts whose browse URLs encode a branch and a subdirectory. */
const isForgeHost = (host) => /(github|gitlab|bitbucket|gitee|codeberg)\./u.test(host) || host.endsWith('.sr.ht')

/**
 * Work out what a pasted address IS, before fetching anything.
 *
 * The point is that a user should paste whatever the skill's author published — a
 * repo page, the folder URL straight out of their browser's address bar, a
 * SKILL.md link, or a zip — and not first have to decide which of four tabs it
 * belongs in or split it into three fields by hand. Everything the panel needs to
 * explain the decision comes back here, so the UI can show what it understood
 * while the user is still typing.
 *
 * @returns `{ kind, input, url, repo, ref, subpath, note }` where `kind` is one of
 *          `git` | `zip` | `markdown` | `unknown` (`unknown` = fetch and sniff).
 */
export function detectSource(input) {
  const raw = String(input ?? '').trim()
  if (raw === '') throw new InstallError('BAD_REQUEST', '请粘贴 skill 的地址。')

  // The one accepted form that is not a URL.
  if (/^[\w.-]+\/[\w.-]+$/u.test(raw)) {
    return { kind: 'git', input: raw, url: `https://github.com/${raw}.git`, repo: raw, ref: '', subpath: '', note: 'GitHub 仓库简写' }
  }
  if (/^git@[^:]+:/u.test(raw)) {
    const repo = raw.split(':').slice(1).join(':').replace(/\.git$/u, '')
    return { kind: 'git', input: raw, url: raw, repo, ref: '', subpath: '', note: 'SSH 仓库地址' }
  }

  let url
  try {
    url = new URL(raw)
  } catch {
    throw new InstallError('BAD_REQUEST', `这不像一个地址：${raw}`, '可以粘贴仓库主页、仓库里的文件夹链接、SKILL.md 链接，或 zip 直链。')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new InstallError('BAD_REQUEST', `只支持 http/https，收到的是 ${url.protocol}`)
  }

  const host = url.hostname.toLowerCase()
  const parts = url.pathname.split('/').filter(Boolean)
  const marker = parts.findIndex((part) => part === 'tree' || part === 'blob')

  if (isForgeHost(host) && marker >= 1) {
    // GitLab writes `…/-/tree/<ref>/<path>`; the `-` is not part of the project.
    const segments = parts.slice(0, marker).filter((part) => part !== '-')
    if (segments.length >= 2) {
      const ref = parts[marker + 1] ?? ''
      let subpath = parts.slice(marker + 2).join('/')
      // A `blob` URL points at a FILE, so the skill is its directory.
      if (parts[marker] === 'blob') subpath = subpath.includes('/') ? subpath.slice(0, subpath.lastIndexOf('/')) : ''
      return {
        kind: 'git',
        input: raw,
        url: `${url.origin}/${segments.join('/')}.git`,
        repo: segments.join('/'),
        ref,
        subpath,
        note: parts[marker] === 'blob' ? '仓库里的文件链接' : '仓库里的文件夹链接',
      }
    }
  }
  if (/\.zip$/iu.test(url.pathname) || host.startsWith('codeload.')) {
    return { kind: 'zip', input: raw, url: raw, repo: '', ref: '', subpath: '', note: '压缩包直链' }
  }
  if (/\.(md|markdown|txt)$/iu.test(url.pathname) || host.startsWith('raw.')) {
    return { kind: 'markdown', input: raw, url: raw, repo: '', ref: '', subpath: '', note: 'SKILL.md 直链' }
  }
  if (isForgeHost(host) && parts.length >= 2) {
    return { kind: 'git', input: raw, url: `${url.origin}/${parts[0]}/${parts[1]}.git`, repo: `${parts[0]}/${parts[1]}`, ref: '', subpath: '', note: '仓库主页' }
  }
  return { kind: 'unknown', input: raw, url: raw, repo: '', ref: '', subpath: '', note: '按直链下载后再判断' }
}

/* ---------------------------------------------------------------- cleanup -- */

/**
 * Remove a directory tree, best effort — and NEVER let it fail a caller.
 *
 * `git clone` leaves read-only files behind (`objects/pack/*.pack`), and on Windows
 * a read-only file cannot be unlinked at all: `force: true` suppresses ENOENT, not
 * EPERM. This ran inside a `finally`, so a cleanup failure turned a **successful**
 * install into an error response and left the directory behind — observed on a real
 * install (10 → 11 skills enumerated, yet the panel reported "EPERM, Permission
 * denied"). Hence two rules: clear the read-only bit first, and swallow.
 *
 * @returns `true` when the tree is gone.
 */
export function removeTree(dir, onWarn) {
  try {
    for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) continue
      try {
        chmodSync(join(entry.parentPath ?? dir, entry.name), 0o666)
      } catch {
        // A file we cannot chmod is one we cannot remove either; rmSync reports it
        // once below rather than twice here.
      }
    }
  } catch {
    // The walk is best effort too: a missing directory is a success, not a fault.
  }
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 120 })
    return true
  } catch (error) {
    onWarn?.(`skill-report: could not remove ${dir}: ${error?.message ?? error}`)
    return false
  }
}

/* --------------------------------------------------------------- installer -- */

/**
 * Remove clone directories an earlier run could not delete. Never throws.
 *
 * Only clearly stale ones: a concurrent install's clone is younger than any sane
 * age limit, and deleting it would break that install.
 */
export function sweepStaleClones({ maxAgeMs = 60 * 60 * 1000, now = Date.now(), onWarn } = {}) {
  let removed = 0
  try {
    for (const entry of readdirSync(tmpdir(), { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.startsWith('echocat-skill-')) continue
      const dir = join(tmpdir(), entry.name)
      try {
        if (now - statSync(dir).mtimeMs < maxAgeMs) continue
        if (removeTree(dir, onWarn)) removed += 1
      } catch {
        // Raced away, or unreadable: neither is worth a warning.
      }
    }
  } catch {
    // An unreadable temp directory is not this plugin's problem.
  }
  return removed
}

const BACKUP_KEEP = 20

/**
 * @param options.root - absolute skills root (see {@link resolveSkillsRoot}).
 * @param options.backupRoot - where replaced/removed skills are parked.
 * @param options.logger - host logger, optional.
 * @param options.fetchImpl - injectable for tests; defaults to global fetch.
 * @param options.allowPrivateHosts - permit fetching from LAN/localhost URLs.
 */
export function createInstaller({
  root,
  backupRoot,
  logger,
  fetchImpl,
  allowPrivateHosts = false,
  limits = LIMITS,
  env = process.env,
  gitBinary = 'git',
} = {}) {
  const skillsRoot = resolve(root ?? resolveSkillsRoot({ env }))
  const trashRoot = resolve(backupRoot ?? join(env.DSH_HOME ?? join(homedir(), '.dsh-beta'), 'skill-report', 'backups'))

  /** Ring buffer of recent install attempts, newest first, for the panel's log. */
  const history = []
  const record = (entry) => {
    history.unshift({ at: Date.now(), ...entry })
    if (history.length > BACKUP_KEEP) history.length = BACKUP_KEEP
  }

  // Probed once: `capability()` rides on every state poll, and a poll must not
  // perform a filesystem write attempt every five seconds.
  let writableCache
  const writable = () => {
    if (writableCache !== undefined) return writableCache
    try {
      mkdirSync(skillsRoot, { recursive: true })
      writableCache = true
    } catch (error) {
      logger?.warn?.(`skill-report: skills root is not writable (${skillsRoot}): ${error?.message ?? error}`)
      writableCache = false
    }
    return writableCache
  }

  const exists = (name) => existsSync(join(skillsRoot, name))

  /** Enumerate skill directories currently on disk (not the live snapshot). */
  function onDisk() {
    try {
      return readdirSync(skillsRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
        .map((entry) => {
          const dir = join(skillsRoot, entry.name)
          const skill = join(dir, 'SKILL.md')
          let bytes = 0
          let modifiedAt = 0
          try {
            for (const file of readdirSync(dir, { recursive: true, withFileTypes: true })) {
              if (!file.isFile()) continue
              const info = statSync(join(file.parentPath ?? dir, file.name))
              bytes += info.size
              modifiedAt = Math.max(modifiedAt, info.mtimeMs)
            }
          } catch {
            // A directory we cannot stat is still a skill directory; the size and
            // mtime columns simply stay empty.
          }
          return { name: entry.name, dir, hasSkillMd: existsSync(skill), bytes, modifiedAt }
        })
        .sort((a, b) => a.name.localeCompare(b.name))
    } catch {
      return []
    }
  }

  /** Capability descriptor the browser half renders the install sheet from. */
  function capability() {
    return {
      api: INSTALL_API,
      root: skillsRoot,
      backupRoot: trashRoot,
      writable: writable(),
      /** `auto` first: one pasted address is the primary gesture. */
      modes: ['auto', 'text', 'file', 'url', 'git'],
      limits: {
        uploadBytes: limits.uploadBytes,
        fileBytes: limits.fileBytes,
        totalBytes: limits.totalBytes,
        files: limits.files,
        markdownBytes: limits.markdownBytes,
      },
      allowPrivateHosts,
    }
  }

  /* ------------------------------------------------------------- staging -- */

  /**
   * Move a fully-built staging directory into place as `<root>/<name>`.
   * Existing content is parked in the backup directory first: an install must
   * never be the reason a user loses a skill they had edited by hand.
   */
  function commit(stage, name, overwrite) {
    const target = assertInside(skillsRoot, join(skillsRoot, name))
    const existed = existsSync(target)
    if (existed && overwrite !== true) {
      throw new InstallError('NAME_TAKEN', `已经有一个叫 "${name}" 的 skill 了。`, '勾选「覆盖同名的已有 skill」后重试。')
    }
    let backup = null
    if (existed) {
      backup = join(trashRoot, `${new Date().toISOString().replace(/[:.]/gu, '-')}-${name}`)
      mkdirSync(trashRoot, { recursive: true })
      rmSync(backup, { recursive: true, force: true })
      cpSync(target, backup, { recursive: true })
      rmSync(target, { recursive: true, force: true })
    }
    renameSync(stage, target)
    return { target, existed, backup }
  }

  /**
   * Write (or merge) `display-name-zh` into the staged skill's `meta.yaml`.
   *
   * Called at the END of each mode's build step, so it lands in the directory that
   * is about to be committed and the install stays as atomic as the rest of it.
   * Returns the value actually written, or `''` when the field was left empty.
   */
  function applyDisplayName(stageDir, value, warnings = []) {
    const name = cleanDisplayNameZh(value)
    if (name === '') return ''
    const file = join(stageDir, 'meta.yaml')
    let existing = ''
    try {
      existing = readFileSync(file, 'utf8')
    } catch {
      // The skill shipped no meta.yaml; the merge simply starts from nothing.
    }
    const previous = /^display-name-zh\s*:\s*(.*)$/mu.exec(existing)
    if (previous !== null) {
      const had = previous[1].trim().replace(/^['"]|['"]$/gu, '')
      if (had !== '' && had !== name) warnings.push(`这个 skill 原本的中文显示名是 "${had}"，已按你填的覆盖。`)
    }
    writeFileSync(file, patchMetaYaml(existing, name), 'utf8')
    return name
  }

  /** Run `build(stageDir)`, then commit; the stage is always cleaned up. */
  function staged(name, overwrite, build) {
    if (writable() !== true) {
      throw new InstallError('FS_ERROR', `skills 目录不可写：${skillsRoot}`, '检查目录权限，或用配置项 skillsRoot 指到别处。')
    }
    let stage = stagePath(skillsRoot)
    while (existsSync(stage)) stage = stagePath(skillsRoot)
    mkdirSync(stage, { recursive: true })
    try {
      const built = build(stage)
      return { ...commit(stage, name, overwrite), ...built }
    } catch (error) {
      removeTree(stage)
      throw error
    }
  }

  /* ---------------------------------------------------------- markdown in -- */

  /**
   * Normalise a pasted/loaded SKILL.md into the exact bytes we will write.
   *
   * Missing frontmatter is repaired rather than rejected (a description taken
   * from the body's first paragraph is genuinely useful), but a declared name
   * that disagrees with the install name is an error: silently installing one
   * name under another is how a catalog becomes untrustworthy.
   */
  function normalizeMarkdown({ text, name, warnings }) {
    const bytes = Buffer.byteLength(text, 'utf8')
    assertSize(bytes, limits.markdownBytes, 'SKILL.md')
    const parsed = parseFrontmatter(text)
    for (const issue of parsed.errors) warnings.push(`frontmatter：${issue}`)

    const declared = typeof parsed.data.name === 'string' ? parsed.data.name.trim() : ''
    const finalName = assertSkillName(name ?? declared)
    if (declared !== '' && declared !== finalName) {
      warnings.push(`文件里声明的名称是 "${declared}"，已按你指定的 "${finalName}" 安装。`)
    }

    let description = typeof parsed.data.description === 'string' ? parsed.data.description.trim() : ''
    if (description === '') {
      // Fall back to the first paragraph of actual prose: heading-only
      // paragraphs are skipped, because `# My Skill` as a description tells the
      // user nothing they cannot already see from the name.
      for (const paragraph of parsed.body.split(/\n\s*\n/u)) {
        const prose = paragraph
          .split('\n')
          .filter((line) => !/^#{1,6}\s/u.test(line.trim()))
          .join(' ')
          .trim()
        if (prose !== '') {
          description = prose.slice(0, 300)
          break
        }
      }
      if (description !== '') warnings.push('文件没有 description，已用正文第一段代替。')
    }
    if (description === '') {
      throw new InstallError('BAD_REQUEST', 'SKILL.md 里既没有 description，正文也没有可用文字。')
    }
    if (parsed.body === '') warnings.push('SKILL.md 只有 frontmatter，没有正文。')

    const extra = {}
    for (const [key, value] of Object.entries(parsed.data)) {
      if (key === 'name' || key === 'description') continue
      extra[key] = value
    }
    const output = `${renderFrontmatter({ name: finalName, description, extra })}${parsed.body}\n`
    return { name: finalName, description, content: output, hadFrontmatter: parsed.present }
  }

  async function installText({ text, name, overwrite, displayNameZh }) {
    const warnings = []
    const normalized = normalizeMarkdown({ text, name, warnings })
    const result = staged(normalized.name, overwrite, (stage) => {
      writeFileSync(join(stage, 'SKILL.md'), normalized.content, 'utf8')
      return { files: 1, bytes: Buffer.byteLength(normalized.content, 'utf8'), displayNameZh: applyDisplayName(stage, displayNameZh, warnings) }
    })
    return { ...result, name: normalized.name, description: normalized.description, warnings }
  }

  /* ------------------------------------------------------------- archivos -- */

  /**
   * Find the directory that is the actual skill inside an extracted tree.
   *
   * Releases are packaged inconsistently — `<name>/SKILL.md`, `repo-main/SKILL.md`,
   * `repo-main/skills/<name>/SKILL.md` — so the archive is searched (breadth
   * first, shallowest wins) rather than assumed. A wrapper is then stripped away
   * so the skill is installed at the root of its own directory.
   */
  function locateSkillRoot(dir) {
    const queue = [{ dir, depth: 0 }]
    while (queue.length > 0) {
      const { dir: current, depth } = queue.shift()
      if (existsSync(join(current, 'SKILL.md'))) return current
      if (depth >= 3) continue
      let entries = []
      try {
        entries = readdirSync(current, { withFileTypes: true })
      } catch {
        continue
      }
      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith('.')) queue.push({ dir: join(current, entry.name), depth: depth + 1 })
      }
    }
    return null
  }

  /** Extract a zip buffer into `stage`, enforcing every cap as it goes. */
  function extractZip(buffer, stage) {
    const entries = readCentralDirectory(buffer)
    if (entries.length > limits.files) {
      throw new InstallError('TOO_LARGE', `压缩包里有 ${entries.length} 个文件，超过上限 ${limits.files} 个。`)
    }
    let total = 0
    let files = 0
    const skipped = []
    for (const entry of entries) {
      if (entry.isDirectory) continue
      const name = safeEntryName(entry.name)
      if (entry.isSymlink) {
        skipped.push(`${name}（符号链接，已跳过）`)
        continue
      }
      assertSize(entry.size, limits.fileBytes, name)
      const data = readEntry(buffer, entry)
      assertSize(data.length, limits.fileBytes, name)
      total += data.length
      if (total > limits.totalBytes) {
        throw new InstallError('TOO_LARGE', `解压后总大小超过上限 ${Math.round(limits.totalBytes / 1024 / 1024)} MB。`)
      }
      files += 1
      const dest = assertInside(stage, join(stage, name))
      mkdirSync(join(dest, '..'), { recursive: true })
      writeFileSync(dest, data)
    }
    if (files === 0) throw new InstallError('BAD_ARCHIVE', '压缩包里没有任何文件。')
    return { files, bytes: total, skipped }
  }

  /** Shared tail of the archive-based modes. */
  function installArchive({ buffer, name, overwrite, source, displayNameZh }) {
    const warnings = []
    return {
      ...staged(name, overwrite, (stage) => {
        const extracted = extractZip(buffer, stage)
        for (const note of extracted.skipped) warnings.push(`已跳过 ${note}`)
        const skillDir = locateSkillRoot(stage)
        if (skillDir === null) {
          throw new InstallError(
            'BAD_ARCHIVE',
            '压缩包里找不到 SKILL.md。',
            'skill 的目录里必须有 SKILL.md；如果这是一个 Git 仓库快照，请确认 skill 在仓库内（深度 3 层以内）。',
          )
        }
        const skillFile = join(skillDir, 'SKILL.md')
        const parsed = parseFrontmatter(readFileSync(skillFile, 'utf8'))
        for (const issue of parsed.errors) warnings.push(`frontmatter：${issue}`)
        const declared = typeof parsed.data.name === 'string' ? parsed.data.name.trim() : ''
        if (declared !== '' && declared !== name) {
          // The directory name and the declared name disagree. Discovery may key
          // on either, so say so instead of letting the catalog look inconsistent.
          warnings.push(`SKILL.md 里声明的名称是 "${declared}"，目录名是 "${name}"。`)
        }
        const files = readdirSync(skillDir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).length

        if (skillDir !== stage) {
          // Flatten: move the payload up, then drop the wrapper directories. The
          // intermediate lives BESIDE the stage, never inside it — removing the
          // stage would otherwise take the payload with it.
          const flat = stagePath(skillsRoot)
          renameSync(skillDir, flat)
          rmSync(stage, { recursive: true, force: true })
          renameSync(flat, stage)
        }
        // After the flatten, so the file lands in the directory that gets committed
        // rather than in a wrapper that is about to be dropped.
        const written = applyDisplayName(stage, displayNameZh, warnings)
        const description = typeof parsed.data.description === 'string' ? parsed.data.description.trim() : ''
        return { files, bytes: extracted.bytes, description, warnings, source, displayNameZh: written }
      }),
      name,
    }
  }

  /* ------------------------------------------------------------------ net -- */

  /** Cheapest possible SSRF fence: the app is local, so a URL may reach the LAN. */
  function assertPublicUrl(raw) {
    let url
    try {
      url = new URL(String(raw))
    } catch {
      throw new InstallError('BAD_REQUEST', `不是合法的网址：${raw}`)
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new InstallError('BAD_REQUEST', `只支持 http/https，收到的是 ${url.protocol}`)
    }
    if (allowPrivateHosts === true) return url
    const host = url.hostname.toLowerCase()
    const privateHost =
      host === 'localhost' ||
      host === '::1' ||
      host.endsWith('.local') ||
      /^127\./u.test(host) ||
      /^10\./u.test(host) ||
      /^192\.168\./u.test(host) ||
      /^169\.254\./u.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./u.test(host) ||
      host === '0.0.0.0' ||
      host === '[::1]'
    if (privateHost) {
      throw new InstallError('BAD_REQUEST', `拒绝从内网地址安装：${host}`, '确实需要时，在插件配置里打开 allowPrivateHosts。')
    }
    return url
  }

  async function download(url) {
    const doFetch = fetchImpl ?? (typeof fetch === 'function' ? fetch : undefined)
    if (doFetch === undefined) throw new InstallError('NETWORK', '当前运行时没有可用的 fetch。')
    let response
    try {
      response = await doFetch(url.href, {
        redirect: 'follow',
        headers: { accept: 'application/zip, application/octet-stream, text/markdown, text/plain, */*', 'user-agent': 'echocat-skill-panel' },
        signal:
          typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
            ? AbortSignal.timeout(limits.fetchMs)
            : undefined,
      })
    } catch (error) {
      throw new InstallError('NETWORK', `下载失败：${error?.message ?? error}`, '检查网络或代理设置。')
    }
    if (!response.ok) throw new InstallError('NETWORK', `下载失败：HTTP ${response.status}`)
    const declared = Number(response.headers.get('content-length') ?? '0')
    if (Number.isFinite(declared) && declared > limits.downloadBytes) {
      throw new InstallError('TOO_LARGE', `文件有 ${Math.round(declared / 1024 / 1024)} MB，超过下载上限。`)
    }
    const buffer = Buffer.from(await response.arrayBuffer())
    assertSize(buffer.length, limits.downloadBytes, '下载内容')
    // `Response.url` is empty for a synthetic response and for some redirect
    // chains, and the URL we asked for is the better name source in that case.
    const finalUrl = typeof response.url === 'string' && response.url !== '' ? response.url : url.href
    return { buffer, contentType: String(response.headers.get('content-type') ?? ''), finalUrl }
  }

  async function installUrl({ url, name, overwrite, displayNameZh }) {
    const target = assertPublicUrl(url)
    const { buffer, contentType, finalUrl } = await download(target)
    const looksZip = buffer.length >= 4 && buffer.readUInt32LE(0) === LOC_SIG
    const isZip = looksZip || /zip/u.test(contentType) || /\.zip(\?|$)/iu.test(finalUrl)
    // The URL's last path segment is the best available fallback name; a declared
    // frontmatter name beats it, and an explicit request beats both.
    const fromUrl = slugify(safeDecode(finalUrl.split('/').filter(Boolean).pop() ?? '').replace(/\.(zip|md|markdown|txt)$/iu, ''))
    if (!isZip) {
      const text = buffer.toString('utf8')
      const parsed = parseFrontmatter(text)
      const declared = typeof parsed.data.name === 'string' ? parsed.data.name : ''
      const derived = firstName(name, declared, fromUrl)
      if (derived === '') {
        throw new InstallError('INVALID_NAME', '无法从网址推断 skill 名称。', '请在「名称」一栏里填一个，例如 my-skill。')
      }
      return installText({ text, name: derived, overwrite, displayNameZh })
    }
    const derived = firstName(name, fromUrl)
    if (derived === '') {
      throw new InstallError('INVALID_NAME', '无法从网址推断 skill 名称。', '请在「名称」一栏里填一个，例如 my-skill。')
    }
    return installArchive({ buffer, name: assertSkillName(derived), overwrite, source: finalUrl, displayNameZh })
  }

  /* ------------------------------------------------------------------ git -- */

  /** `git` availability, probed once and cached — the panel shows it as a capability. */
  let gitProbe
  let gitKnown
  function gitAvailable() {
    if (gitProbe !== undefined) return gitProbe
    gitProbe = new Promise((resolvePromise) => {
      let settled = false
      const done = (value) => {
        if (settled) return
        settled = true
        gitKnown = value
        resolvePromise(value)
      }
      try {
        const child = spawn(gitBinary, ['--version'], { stdio: 'ignore', windowsHide: true })
        child.on('error', () => done(false))
        child.on('exit', (code) => done(code === 0))
        setTimeout(() => {
          try {
            child.kill()
          } catch {
            // Already gone.
          }
          done(false)
        }, 5000)
      } catch {
        done(false)
      }
    })
    return gitProbe
  }

  function run(cmd, args, { cwd, timeoutMs }) {
    return new Promise((resolvePromise, rejectPromise) => {
      let output = ''
      let child
      try {
        child = spawn(cmd, args, { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
      } catch (error) {
        rejectPromise(new InstallError('GIT_FAILED', `${cmd} 启动失败：${error?.message ?? error}`))
        return
      }
      const timer = setTimeout(() => {
        try {
          child.kill()
        } catch {
          // Already gone.
        }
        rejectPromise(new InstallError('GIT_FAILED', `${cmd} 超过 ${Math.round(timeoutMs / 1000)} 秒仍未结束。`))
      }, timeoutMs)
      child.stdout?.on('data', (chunk) => {
        output = (output + String(chunk)).slice(-4000)
      })
      child.stderr?.on('data', (chunk) => {
        output = (output + String(chunk)).slice(-4000)
      })
      child.on('error', (error) => {
        clearTimeout(timer)
        rejectPromise(new InstallError('GIT_FAILED', `${cmd} 无法执行：${error?.message ?? error}`))
      })
      child.on('exit', (code) => {
        clearTimeout(timer)
        if (code === 0) resolvePromise(output)
        else rejectPromise(new InstallError('GIT_FAILED', `${cmd} 退出码 ${code}：${output.trim().slice(-400)}`))
      })
    })
  }

  /**
   * Accept `owner/repo`, a full URL, a `…/tree/<ref>/<path>` browser URL, or a
   * `…/blob/<ref>/<path>/SKILL.md` file URL (whose directory becomes the subpath).
   *
   * GitLab spells its browse URLs `…/-/tree/<ref>/<path>`, and a trailing `-` is
   * stripped from the project path so the clone URL stays correct.
   */
  function normalizeRepo(input) {
    const raw = String(input ?? '').trim()
    if (raw === '') throw new InstallError('BAD_REQUEST', '请填写 Git 仓库地址。')
    if (/^[\w.-]+\/[\w.-]+$/u.test(raw)) return { url: `https://github.com/${raw}.git`, ref: '', subpath: '' }
    let url
    try {
      url = new URL(raw)
    } catch {
      throw new InstallError('BAD_REQUEST', `不是合法的仓库地址：${raw}`)
    }
    const parts = url.pathname.split('/').filter(Boolean)
    const marker = parts.findIndex((part) => part === 'tree' || part === 'blob')
    if (marker >= 1) {
      const segments = parts.slice(0, marker).filter((part) => part !== '-')
      const ref = parts[marker + 1] ?? ''
      let subpath = parts.slice(marker + 2).join('/')
      // A `blob` URL points at a FILE: keep its directory.
      if (parts[marker] === 'blob' && subpath.includes('/')) subpath = subpath.slice(0, subpath.lastIndexOf('/'))
      else if (parts[marker] === 'blob') subpath = ''
      if (segments.length >= 2) {
        return { url: `${url.origin}/${segments.join('/')}.git`, ref, subpath }
      }
    }
    return { url: url.href.endsWith('.git') ? url.href : `${url.href.replace(/\/$/u, '')}.git`, ref: '', subpath: '' }
  }

  async function installGit({ repo, ref, subpath, name, overwrite, displayNameZh }) {
    if ((await gitAvailable()) !== true) {
      throw new InstallError('GIT_MISSING', '这台机器上没有可用的 git。', '改用「上传文件」或「粘贴 SKILL.md」，或先安装 git。')
    }
    const normalized = normalizeRepo(repo)
    // Sweep clones left behind by an earlier run that died (or that could not delete
    // its own read-only pack files before this fix). Only clearly stale directories:
    // a concurrent install's clone must survive.
    sweepStaleClones({ onWarn: (message) => logger?.warn?.(message) })
    const cloneDir = join(tmpdir(), `echocat-skill-${randomBytes(6).toString('hex')}`)
    mkdirSync(cloneDir, { recursive: true })
    try {
      const branch = String(ref ?? normalized.ref ?? '').trim()
      const args = ['clone', '--depth', '1', '--quiet']
      if (branch !== '') args.push('--branch', branch)
      args.push(normalized.url, cloneDir)
      await run(gitBinary, args, { timeoutMs: limits.gitMs })
      const wanted = String(subpath ?? normalized.subpath ?? '').trim()
      const searchRoot = wanted === '' ? cloneDir : assertInside(cloneDir, join(cloneDir, wanted))
      if (!existsSync(searchRoot)) throw new InstallError('NOT_FOUND', `仓库里没有这个目录：${wanted}`)
      const skillDir = locateSkillRoot(searchRoot)
      if (skillDir === null) {
        throw new InstallError('NOT_FOUND', '仓库里找不到 SKILL.md。', '可以填一个子目录，例如 skills/<名字>。')
      }
      const parsed = parseFrontmatter(readFileSync(join(skillDir, 'SKILL.md'), 'utf8'))
      const declared = typeof parsed.data.name === 'string' ? parsed.data.name.trim() : ''
      const fromRepo = slugify((normalized.url.split('/').pop() ?? '').replace(/\.git$/u, ''))
      const finalName = assertSkillName(firstName(name, declared, fromRepo, 'skill'))
      const warnings = []
      for (const issue of parsed.errors) warnings.push(`frontmatter：${issue}`)
      if (declared !== '' && declared !== finalName) warnings.push(`文件里声明的名称是 "${declared}"，已按 "${finalName}" 安装。`)
      const result = staged(finalName, overwrite, (stage) => {
        const files = readdirSync(skillDir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).length
        // Copy beside the stage, not inside it: swapping through a child of the
        // stage would delete the copy along with the wrapper.
        const inner = stagePath(skillsRoot)
        cpSync(skillDir, inner, { recursive: true })
        rmSync(stage, { recursive: true, force: true })
        renameSync(inner, stage)
        // After the swap, so the merge reads the repository's own meta.yaml.
        const written = applyDisplayName(stage, displayNameZh, warnings)
        return { files, bytes: 0, displayNameZh: written }
      })
      return { ...result, name: finalName, description: typeof parsed.data.description === 'string' ? parsed.data.description : '', warnings, source: normalized.url }
    } finally {
      // Must never throw: by now the skill is committed, and a cleanup failure used
      // to turn that success into an error the user saw instead.
      removeTree(cloneDir, (message) => logger?.warn?.(message))
    }
  }

  /* ------------------------------------------------------------- uninstall -- */

  function uninstall({ name, confirm }) {
    const finalName = assertSkillName(name)
    const target = assertInside(skillsRoot, join(skillsRoot, finalName))
    if (!existsSync(target)) throw new InstallError('NOT_FOUND', `没有找到叫 "${finalName}" 的 skill。`)
    if (confirm !== true) {
      throw new InstallError('NEEDS_CONFIRM', `删除 "${finalName}" 需要确认。`, '在面板里再点一次「删除」以确认。')
    }
    const backup = join(trashRoot, `${new Date().toISOString().replace(/[:.]/gu, '-')}-${finalName}`)
    try {
      mkdirSync(trashRoot, { recursive: true })
      cpSync(target, backup, { recursive: true })
      rmSync(target, { recursive: true, force: true })
    } catch (error) {
      throw new InstallError('FS_ERROR', `删除失败：${error?.message ?? error}`)
    }
    return { name: finalName, backup }
  }

  /* ------------------------------------------------------------- display -- */

  /**
   * Set — or clear — one installed skill's Chinese display name.
   *
   * `meta.yaml` is read by skill discovery on every scan, so the write goes through
   * a sibling temp file and is renamed over the target: a half-written file would
   * drop the skill out of the catalogue until someone repaired it by hand.
   */
  function renameDisplayName({ name, displayNameZh }) {
    const finalName = assertSkillName(name)
    const target = assertInside(skillsRoot, join(skillsRoot, finalName))
    if (!existsSync(target)) throw new InstallError('NOT_FOUND', `没有找到叫 "${finalName}" 的 skill。`)
    const value = cleanDisplayNameZh(displayNameZh)
    const file = join(target, 'meta.yaml')
    let before = ''
    if (existsSync(file)) {
      try {
        before = readFileSync(file, 'utf8')
      } catch (error) {
        throw new InstallError('FS_ERROR', `读不到 meta.yaml：${error?.message ?? error}`)
      }
    }
    const next = patchMetaYaml(before, value)
    try {
      if (next === '') {
        // Nothing left worth keeping: a meta.yaml holding only a blank key is litter.
        if (existsSync(file)) rmSync(file, { force: true })
      } else {
        const staging = `${file}.echocat-${randomBytes(4).toString('hex')}`
        writeFileSync(staging, next, 'utf8')
        renameSync(staging, file)
      }
    } catch (error) {
      throw new InstallError('FS_ERROR', `写 meta.yaml 失败：${error?.message ?? error}`)
    }
    return { name: finalName, displayNameZh: value }
  }

  /* ---------------------------------------------------------------- public -- */

  /**
   * One entry point for every mutating action.
   *
   * `preview` is the read-only twin: it parses and reports what *would* be
   * installed (name, description, file count) without touching the disk, so the
   * sheet can show a confirmation step before the write.
   */
  async function run_action(request = {}) {
    const action = String(request.action ?? '')
    const mode = String(request.mode ?? '')
    const overwrite = request.overwrite === true
    const started = Date.now()
    try {
      if (action === 'install') {
        let result
        let resolved = null
        // Validated once, here, so every mode gets the same rejection.
        const displayNameZh = cleanDisplayNameZh(request.displayNameZh)
        if (mode === 'auto') {
          // One field, pasted straight from wherever the author published it.
          resolved = detectSource(request.input ?? request.url ?? request.repo)
          if (resolved.kind === 'git') {
            result = await installGit({
              repo: resolved.url,
              // An explicit field still wins, so the advanced inputs can override.
              ref: request.ref ?? resolved.ref,
              subpath: request.subpath ?? resolved.subpath,
              name: request.name,
              overwrite,
              displayNameZh,
            })
          } else {
            result = await installUrl({ url: resolved.url, name: request.name, overwrite, displayNameZh })
          }
        } else if (mode === 'text') result = await installText({ text: String(request.text ?? ''), name: request.name, overwrite, displayNameZh })
        else if (mode === 'url') result = await installUrl({ url: request.url, name: request.name, overwrite, displayNameZh })
        else if (mode === 'git') result = await installGit({ repo: request.repo, ref: request.ref, subpath: request.subpath, name: request.name, overwrite, displayNameZh })
        else if (mode === 'file') {
          const base64 = String(request.dataBase64 ?? '')
          if (base64 === '') throw new InstallError('BAD_REQUEST', '上传内容为空。')
          const buffer = Buffer.from(base64, 'base64')
          assertSize(buffer.length, limits.uploadBytes, '上传内容')
          const filename = String(request.filename ?? '')
          const isZip = buffer.length > 4 && buffer.readUInt32LE(0) === LOC_SIG
          if (isZip || /\.zip$/iu.test(filename)) {
            const derived = request.name ?? slugify(filename.replace(/\.zip$/iu, ''))
            result = installArchive({ buffer, name: assertSkillName(derived), overwrite, source: filename, displayNameZh })
          } else {
            result = await installText({ text: buffer.toString('utf8'), name: request.name ?? slugify(filename.replace(/\.(md|markdown|txt)$/iu, '')), overwrite, displayNameZh })
          }
        } else {
          throw new InstallError('BAD_REQUEST', `不支持的安装方式：${mode === '' ? '(空)' : mode}`)
        }
        record({ action: 'install', mode: resolved?.kind ?? mode, name: result.name, ok: true, ms: Date.now() - started })
        logger?.info?.(`skill-report: installed skill "${result.name}" (${resolved?.kind ?? mode}) into ${skillsRoot}`)
        return {
          ok: true,
          // The Chinese name is what the panel shows; the slug stays the identity.
          skill: { name: result.name, description: result.description ?? '', displayNameZh: result.displayNameZh ?? '' },
          files: result.files ?? 0,
          overwritten: result.existed === true,
          backup: result.backup ?? null,
          warnings: result.warnings ?? [],
          // What the address turned out to be, so the panel can say "按 Git 仓库安装".
          source: resolved,
          skills: onDisk(),
        }
      }

      if (action === 'preview') {
        // `auto` is a parse-only preview: it reports what the address IS, without
        // fetching or cloning, so the panel can validate while the user types.
        if (mode === 'auto') {
          const source = detectSource(request.input ?? request.url ?? request.repo)
          return {
            ok: true,
            preview: { name: '', description: '', files: 0, kind: source.kind, repo: source.repo, ref: source.ref, subpath: source.subpath, note: source.note },
            warnings: [],
          }
        }
        if (mode === 'text') {
          const warnings = []
          const normalized = normalizeMarkdown({ text: String(request.text ?? ''), name: request.name, warnings })
          return { ok: true, preview: { name: normalized.name, description: normalized.description, files: 1, hadFrontmatter: normalized.hadFrontmatter, exists: exists(normalized.name) }, warnings }
        }
        if (mode === 'url') {
          const target = assertPublicUrl(request.url)
          const { buffer, contentType, finalUrl } = await download(target)
          const isZip = (buffer.length >= 4 && buffer.readUInt32LE(0) === LOC_SIG) || /zip/u.test(contentType) || /\.zip(\?|$)/iu.test(finalUrl)
          const fromUrl = slugify(safeDecode(finalUrl.split('/').filter(Boolean).pop() ?? '').replace(/\.(zip|md|markdown|txt)$/iu, ''))
          if (!isZip) {
            const parsed = parseFrontmatter(buffer.toString('utf8'))
            const declared = typeof parsed.data.name === 'string' ? parsed.data.name : ''
            const derived = firstName(request.name, declared, fromUrl)
            return { ok: true, preview: { name: derived === '' ? '' : slugify(derived), description: typeof parsed.data.description === 'string' ? parsed.data.description : '', files: 1, kind: 'markdown', bytes: buffer.length, finalUrl }, warnings: [] }
          }
          const entries = readCentralDirectory(buffer)
          return {
            ok: true,
            preview: { name: firstName(request.name, fromUrl), description: '', files: entries.filter((e) => !e.isDirectory).length, kind: 'zip', bytes: buffer.length, finalUrl },
            warnings: [],
          }
        }
        throw new InstallError('BAD_REQUEST', `预览不支持 ${mode === '' ? '(空)' : `方式 "${mode}"`}`)
      }

      if (action === 'uninstall') {
        const result = uninstall({ name: request.name, confirm: request.confirm === true })
        record({ action: 'uninstall', name: result.name, ok: true, ms: Date.now() - started })
        logger?.info?.(`skill-report: uninstalled skill "${result.name}" (backup kept at ${result.backup})`)
        return { ok: true, skill: { name: result.name }, backup: result.backup, skills: onDisk() }
      }

      if (action === 'rename') {
        // Rename only the DISPLAY name. The slug stays the identity: it is the
        // directory, the catalogue key and what `/名字` types, so it cannot move
        // without breaking every reference to it.
        const target = renameDisplayName({ name: request.name, displayNameZh: request.displayNameZh })
        record({ action: 'rename', name: target.name, ok: true, ms: Date.now() - started })
        logger?.info?.(
          target.displayNameZh === ''
            ? `skill-report: cleared the display name of "${target.name}"`
            : `skill-report: display name of "${target.name}" is now "${target.displayNameZh}"`,
        )
        return { ok: true, skill: { name: target.name, displayNameZh: target.displayNameZh }, skills: onDisk() }
      }

      if (action === 'rescan') {
        return { ok: true, skills: onDisk(), capability: capability() }
      }

      throw new InstallError('BAD_REQUEST', `不认识的 action：${action === '' ? '(空)' : action}`)
    } catch (error) {
      const wire = toInstallError(error)
      record({ action: action === '' ? 'unknown' : action, mode, name: request.name ?? request.filename ?? '', ok: false, code: wire.code, message: wire.message, ms: Date.now() - started })
      if (wire.code === 'INTERNAL') logger?.warn?.(`skill-report: install failed: ${error?.stack ?? error}`)
      return { ok: false, error: wire, skills: onDisk() }
    }
  }

  return {
    capability,
    onDisk,
    install: run_action,
    uninstall,
    root: skillsRoot,
    backupRoot: trashRoot,
    history: () => [...history],
    /** Non-blocking view of the git probe: `undefined` until it has settled. */
    gitKnown: () => gitKnown,
    gitAvailable,
    limits,
  }
}
