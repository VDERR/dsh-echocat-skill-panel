// echocat-skill-panel — per-turn skill-usage audit (host half).
//
// Answers one question for every finished user turn, whether or not the model
// remembers to mention it: WHICH skills this turn invoked — loaded by the model
// through the `skill` tool, or injected by the user typing `/name` — or that the
// turn invoked none.
//
// Design notes
// ------------
// * Purely observational. It listens to `session/event` and never injects into
//   the model surface: no tokens added to any request, no conversation history
//   rewritten. (The session's surface event set is closed to four message types,
//   so a custom audit message could only be smuggled in as a `user/message` that
//   the model would then read on later turns — deliberately avoided.)
// * Deterministic. The report is derived from the event log, not from model
//   compliance, so it fires even when the model forgets to report.
// * One report per user turn, on turn completion or failure.
//
// Two invocation channels are tracked:
//   1. `tool/call` with name === "skill"  -> model loaded a skill mid-turn.
//      The arguments carry the exact skill name.
//   2. `user/message` with source.kind === "skill-invocation" -> the *user*
//      typed `/name`, which @deepseek-ai/dsh-tool-skill injects at the pre-step
//      boundary. That injection is not logged, so this event is the only
//      durable trace that a human-invoked skill ever existed.
//
// Revision 3 (2.0.0) — the detection and the state now live in dependency-free
// modules (`detect.js`, `store.js`) so the browser half can share exactly one
// implementation instead of shipping a second, drifting copy.
//
// Revision 5 (4.0.0) — an installed skill now remembers where it came from, so it
// can be UPDATED instead of only replaced by hand.
//
//   * New `provenance.js`: every skill this plugin installs carries a
//     `.echocat.json` record in its own directory — the address it came from, the
//     branch/subdirectory, the exact commit, and a content fingerprint. 3.0 used
//     the pasted address once and dropped it, which made "the author published a
//     fix" impossible to act on: the only route was delete-and-reinstall, with no
//     way to tell whether the new copy was actually newer.
//   * New `check` / `update` / `claim` actions. `check` compares the recorded
//     commit against one `git ls-remote` (never a re-download); `update` is an
//     install from the recorded address, so it keeps every 3.0 safety property
//     (stage, back up the old copy, then rename); `claim` records a source for the
//     skills that were installed by hand or by an earlier version.
//   * The catalogue carries per-skill `provenance`, and the panel marks a skill
//     whose local files no longer match what was installed — the one case where an
//     update would silently discard an edit.
//
// Revision 4 (3.0.0) — the plugin became a skill *manager*, not only a reporter.
//
//   * New `install.js` owns every filesystem write: install from pasted
//     SKILL.md, an uploaded .md/.zip, a URL, or a git repository; plus preview,
//     uninstall (moved to a timestamped backup, never deleted) and rescan.
//   * New `POST /api/skill-report/skills` endpoint. It is the only writing route
//     in this plugin, and it exists only because it sits under `/api/`, where
//     `dsh-client-connection`'s `requestRejection` fence already authenticates
//     the browser session. A write route without that fence would let any local
//     process drop files into the user's skills directory.
//   * The state payload gained `capability` (write target, writability, install
//     modes, size caps) and `installHistory`, so the panel can offer only the
//     actions that can actually succeed and can explain the ones that cannot.
//   * Package renamed to the all-lowercase `echocat-skill-panel`: npm-style
//     names are lowercase, and the name is simultaneously the Loader entry name,
//     the vendor directory name and the client bundle id.
//
// Revision 2 — 2026-09-18, after the first mount attempt aborted host boot on
// DSH Desktop Beta 2.0.11-beta.1 (core 0.1.6-alpha.1) with
//   "failed to apply loader entry skill-report (EchoCat-skill-Panel-2.0):
//    ctx.sessions.on is not a function"
//
//   * `session/event` and `session/disposed` are CORDIS CONTEXT events, not
//     methods of the `sessions` service (`SessionStore extends Service` exposes
//     get/list/create/…, never `on`). Subscribing through the service threw, and
//     a throw inside `apply` fails the WHOLE plugin tree, so the desktop app did
//     not start. The subscription now mirrors the shipped `desktop-notifications`
//     plugin: `ctx.inject(['sessions'], sessionsCtx => sessionsCtx.effect(...))`.
//   * `SessionHeader` carries no `title` in this core (only version / id /
//     createdAt / cwd / parentSession / isSeeded / origin / delegationDepth /
//     agentPreset), so the old `session.header.title` was always undefined and
//     the `（会话标题）` suffix never appeared. The title now comes from the
//     `sessionTitle` service projection.
//   * `apply` no longer lets a mount failure escape: an observational plugin
//     must never be able to keep the host from starting.

import Schema from '@deepseek-ai/schemastery'
import { BlockAssembler, ReasoningEffortId, createUserMessage } from '@deepseek-ai/dsh-llm'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { createTurnTracker, describeTurn, sessionIdOf } from './detect.js'
import { createSkillReportStore, MAX_RECENT_TURNS } from './store.js'
import { createInstaller, resolveSkillsRoot, toInstallError } from './install.js'
import { createReleaseChecker, RELEASES_URL, REPO_URL } from './release.js'
import { VERSION as pluginVersion } from './version.js'

export const name = 'echocat-skill-panel'

/** Reported to the browser half so the panel can show what it is talking to. */
export const VERSION = pluginVersion

/**
 * Default path the browser half fetches its snapshot from.
 *
 * It lives under `/api/` on purpose: `dsh-client-connection` runs
 * `requestRejection` (trusted-Host/Origin fence + browser session auth) on the
 * whole `/api` prefix before dispatch, so this route inherits authentication for
 * free. A raw `webServer.register` route would not — it would be reachable by any
 * local process, and by the LAN when `networkExposure` is not `loopback`.
 */
export const DEFAULT_HTTP_PATH = '/api/skill-report/state'

/**
 * Default path of the skill install/uninstall endpoint.
 *
 * It sits under the same authenticated `/api` prefix as the panel feed, and it is
 * the only route in this plugin that WRITES. The fence that makes that
 * acceptable is `dsh-client-connection`'s `requestRejection`: a write endpoint
 * reachable without the browser session's auth cookie would let any local
 * process — or the LAN, when `networkExposure` is not `loopback` — drop files
 * into the user's skills directory.
 */
export const DEFAULT_INSTALL_PATH = '/api/skill-report/skills'

/**
 * Default path of the plugin's own release-check endpoint.
 *
 * A separate route rather than a field on the state feed on purpose: the state feed is
 * polled every few seconds, and a check that reached the network on that cadence would
 * hammer the registry for a panel that is merely open. This one only ever runs because a
 * human pressed a button, and it caches its answer for ten minutes after that.
 */
export const DEFAULT_RELEASE_PATH = '/api/skill-report/release'

/** HTTP status per install error code, so the browser half can be simple. */
const INSTALL_STATUS = {
  BAD_REQUEST: 400,
  INVALID_NAME: 400,
  UNSAFE_PATH: 400,
  NEEDS_CONFIRM: 400,
  NAME_TAKEN: 409,
  TOO_LARGE: 413,
  NOT_FOUND: 404,
  BAD_ARCHIVE: 422,
  NETWORK: 502,
  GIT_MISSING: 501,
  GIT_FAILED: 502,
  FS_ERROR: 500,
  INTERNAL: 500,
}

// Only `sessions` is a hard dependency: it carries the event stream and always
// exists on the host plane. `desktopRuntime` (the Electron runtime that raises
// native notifications), `sessionTitle` and `webServer` are resolved lazily
// instead of being injected, so an unexpected service topology degrades to
// "no popup" / "no title suffix" / "no panel feed" rather than failing the
// whole plugin load.
export const inject = ['sessions']

// Must be a schemastery schema, not a plain object: the loader resolves it and
// hands `apply` the materialized values. A plain object would arrive as the raw
// descriptor and turn every flag into a truthy object.
export const Config = Schema.object({
  /** Master switch. */
  enabled: Schema.boolean().default(true),
  /** Notify for turns that invoked nothing, not just turns that used a skill. */
  notifyOnNoSkill: Schema.boolean().default(true),
  /** Skip subagent sessions so delegated work does not raise desktop popups. */
  includeSubagents: Schema.boolean().default(false),
  /** Also log every report to the host log (useful while diagnosing). */
  logReports: Schema.boolean().default(false),
  /** How many finished turns the panel keeps. */
  maxRecent: Schema.number().default(MAX_RECENT_TURNS),
  /** Serve the browser panel's snapshot over the DSH web server. */
  httpRoute: Schema.boolean().default(true),
  /** Path of that route. */
  httpPath: Schema.string().default(DEFAULT_HTTP_PATH),
  /** Translate skills that ship no Chinese blurb, using the default model. */
  translateMissing: Schema.boolean().default(true),
  /** Expose the install/uninstall endpoint. Off means the panel is read-only. */
  allowInstall: Schema.boolean().default(true),
  /** Path of that endpoint. */
  installPath: Schema.string().default(DEFAULT_INSTALL_PATH),
  /**
   * Where installed skills are written. Empty means "work it out": the parent of
   * the skills the running app already reports, else `$DSH_HOME/skills`, else
   * `~/.dsh-beta/skills`.
   */
  skillsRoot: Schema.string().default(''),
  /**
   * Where a replaced or deleted skill is parked before it disappears. Empty
   * means `$DSH_HOME/skill-report/backups`. Nothing is ever hard-deleted by this
   * plugin, so this directory is the user's undo.
   */
  backupRoot: Schema.string().default(''),
  /** Permit installing from `localhost` / RFC1918 URLs (off: the app is local). */
  allowPrivateHosts: Schema.boolean().default(false),
  /**
   * Let the panel ask the npm registry / GitHub for the newest published version.
   *
   * On by default because it is the plugin's own release state, not the user's data — and
   * it only runs when the button is pressed, never on a timer. Off means the button is
   * replaced by a link to the release page, which needs no request at all.
   */
  checkForUpdates: Schema.boolean().default(true),
  /** Path of that endpoint. */
  releasePath: Schema.string().default(DEFAULT_RELEASE_PATH),
})

/** Resolve a flag that may arrive as a boolean, a schemastery default fn, or a descriptor. */
function flag(value, fallback) {
  const raw = typeof value === 'function' ? value() : value
  if (typeof raw === 'boolean') return raw
  if (raw !== null && typeof raw === 'object' && typeof raw.default === 'boolean') return raw.default
  return fallback
}

/** Same resolution for numeric options. */
function numberFlag(value, fallback) {
  const raw = typeof value === 'function' ? value() : value
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  if (raw !== null && typeof raw === 'object' && typeof raw.default === 'number') return raw.default
  return fallback
}

/** Log the enumerated count only when it changes, so a 5 s poll cannot spam the log. */
let lastSkillCount = -1

/** Which skills already have a machine translation in flight. */
const translating = new Set()
/** skill name -> Chinese blurb, persisted so each skill is translated once, ever. */
const translations = new Map()
let translationsLoaded = false

const TRANSLATE_SYSTEM = 'Translate the user text into Simplified Chinese. Reply with the translation only.'

/**
 * Reasoning-effort levels tried in order, one attempt each.
 *
 * The default model here is a *reasoning* model whose configured effort is High,
 * and leaving the effort unspecified inherits it: the model then spends the whole
 * output budget on a `reasoning` block and finishes as `max-tokens` with zero
 * text (observed at 160 and again at 2000 tokens: chunks=164/2004, blocks=1,
 * blockType=reasoning). A 40-character translation needs none of that. The
 * acceptable ids are adapter-owned, so each level gets one try rather than a guess.
 */
const TRANSLATE_EFFORTS = ['none', 'minimal', 'low']

/** A background translation that outlives this is treated as failed. */
const TRANSLATE_TIMEOUT_MS = 30000

/** JSON for a log line, never throwing on a circular or exotic value. */
function safeJson(value) {
  try {
    return JSON.stringify(value ?? null).slice(0, 300)
  } catch {
    return String(value)
  }
}

/** `<dshHome>/skill-report/translations.json` — the persistent translation cache. */
function translationsFile() {
  const home = typeof process.env.DSH_HOME === 'string' && process.env.DSH_HOME.trim() !== '' ? process.env.DSH_HOME : join(homedir(), '.dsh')
  return join(home, 'skill-report', 'translations.json')
}

function loadTranslations() {
  if (translationsLoaded) return
  translationsLoaded = true
  try {
    const file = translationsFile()
    if (!existsSync(file)) return
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    if (parsed === null || typeof parsed !== 'object') return
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'string' && value !== '') translations.set(key, value)
    }
  } catch {
    // A corrupt cache only costs one more translation.
  }
}

function saveTranslations(logger) {
  try {
    const file = translationsFile()
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, `${JSON.stringify(Object.fromEntries(translations), null, 2)}\n`, 'utf8')
  } catch (error) {
    logger?.warn?.(`skill-report: could not persist translations: ${error?.message ?? error}`)
  }
}

/**
 * Translate one English blurb through the user's configured default model.
 *
 * Mirrors `dsh-session-title-llm`: `ctx.llm.stream(...)` yields chunks that a
 * `BlockAssembler` folds into text blocks. Fire-and-forget by design — the panel
 * keeps showing the English description until the translation lands, and a
 * failure costs nothing but the English text.
 */
async function translateBlurb({ llm, route, name, text, logger, maxTokens, sessionId }) {
  if (translating.has(name)) return
  translating.add(name)

  /** One attempt at one reasoning-effort level. */
  const attempt = async (effort) => {
    const assembler = new BlockAssembler()
    const options = {
      provider: route.provider,
      model: route.model,
      messages: [
        createUserMessage({
          content: [{ type: 'text', text }],
          source: { kind: 'plugin', plugin: name },
        }),
      ],
      system: TRANSLATE_SYSTEM,
      maxTokens,
      reasoningEffort: ReasoningEffortId(effort),
      purpose: 'skill-report-translate',
      // A background call must not hang forever: without a deadline a stalled
      // stream leaves `translating` occupied and every later poll is skipped.
      signal: AbortSignal.timeout(TRANSLATE_TIMEOUT_MS),
      ...(typeof sessionId === 'string' && sessionId !== '' ? { sessionId } : {}),
    }
    let chunks = 0
    let sample
    for await (const chunk of llm.stream(options)) {
      chunks += 1
      if (sample === undefined) sample = chunk
      assembler.push(chunk)
    }
    const blocks = assembler.blocks()
    const translated = blocks
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
    return { translated, detail: `chunks=${chunks}, blocks=${blocks.length}, finish=${safeJson(assembler.finish)}, first=${safeJson(sample)}` }
  }

  try {
    const notes = []
    for (const effort of TRANSLATE_EFFORTS) {
      let outcome
      try {
        logger?.info?.(`skill-report: translating "${name}" via ${route.provider}/${route.model} (effort=${effort})`)
        outcome = await attempt(effort)
      } catch (error) {
        notes.push(`${effort}: ${error?.message ?? error}`)
        continue
      }
      if (outcome.translated !== '') {
        translations.set(name, outcome.translated)
        saveTranslations(logger)
        logger?.info?.(`skill-report: translated "${name}" -> ${outcome.translated} (effort=${effort})`)
        return
      }
      notes.push(`${effort}: no text (${outcome.detail})`)
    }
    // Give up on this skill for the rest of the process: retrying on every poll
    // turns one broken model call into a hot loop that spends tokens forever.
    translateBlocked.add(name)
    logger?.warn?.(`skill-report: could not translate "${name}" — ${notes.join(' | ')}`)
  } catch (error) {
    translateBlocked.add(name)
    logger?.warn?.(`skill-report: could not translate "${name}": ${error?.message ?? error}`)
  } finally {
    translating.delete(name)
  }
}

/** Per-skill folder lookups are IO; the answer never changes within a run. */
const blurbCache = new Map()

/** Strip one layer of matching quotes from a YAML scalar. */
function unquote(value) {
  const text = value.trim()
  if (text.length >= 2 && (text[0] === '"' || text[0] === "'") && text[text.length - 1] === text[0]) {
    return text.slice(1, -1)
  }
  return text
}

/** Read a single-line `key: value` scalar from a small YAML file. */
function yamlScalar(file, key) {
  try {
    if (!existsSync(file)) return ''
    const match = new RegExp(`^${key}:[ \\t]*(.+)$`, 'm').exec(readFileSync(file, 'utf8'))
    return match === null ? '' : unquote(match[1])
  } catch {
    return ''
  }
}

/**
 * Read `description:` from a Markdown frontmatter block — inline, or the `|`/`>`
 * block scalar these skill docs use.
 */
function frontmatterDescription(file) {
  try {
    if (!existsSync(file)) return ''
    const source = readFileSync(file, 'utf8')
    if (!source.startsWith('---')) return ''
    const end = source.indexOf('\n---', 3)
    const head = end === -1 ? source : source.slice(0, end)
    const match = /^description:[ \t]*(.*)$/m.exec(head)
    if (match === null) return ''
    const inline = match[1].trim()
    if (inline !== '' && inline !== '|' && inline !== '>' && inline !== '|-') return unquote(inline)
    const rest = head.slice(match.index + match[0].length).split('\n').slice(1)
    const lines = []
    for (const line of rest) {
      if (line.trim() === '') {
        if (lines.length > 0) lines.push('')
        continue
      }
      if (!/^\s/.test(line)) break
      lines.push(line.trim())
    }
    return lines.join(' ').replace(/\s+/g, ' ').trim()
  } catch {
    return ''
  }
}

/**
 * Chinese one-liner for a skill, best source first: built-in gap filler ->
 * `meta.yaml` `summary-cn` -> `SKILL.cn.md` frontmatter. '' when the skill ships
 * no Chinese text at all.
 */
function chineseBlurb(skillPath, name) {
  if (blurbCache.has(name)) return blurbCache.get(name)
  let text = ''
  if (typeof skillPath === 'string' && skillPath !== '') {
    const folder = dirname(skillPath)
    text = yamlScalar(join(folder, 'meta.yaml'), 'summary-cn') || frontmatterDescription(join(folder, 'SKILL.cn.md'))
  }
  blurbCache.set(name, text)
  return text
}

/**
 * Pick the scope whose layer chain owns local skill discovery.
 *
 * In the desktop composition the HOST `skill-filesystem` row is disabled —
 * `dsh-web-app/cordis.patch.yml` says so outright: "presets own local discovery",
 * each preset registering its own provider into **its** layer. `SkillRegistry`
 * therefore reads `[global, ...chainLayers(scope)]`, and an unscoped call sees
 * only the global layer, which has no provider at all. That is a legitimate empty
 * catalog, not a bug — and it is exactly why the panel showed "已安装 skill（0）"
 * while every other counter was right.
 *
 * `dsh-tool-skill` passes the agent it serves. The panel is global, so it uses the
 * agent of the most recent turn's session.
 */
function skillScope(agents, sessionId) {
  if (agents === undefined) return undefined
  try {
    if (typeof sessionId === 'string' && sessionId !== '') {
      const agent = agents.get?.(sessionId)
      if (agent !== undefined) return agent
    }
    const all = agents.list?.()
    return Array.isArray(all) && all.length > 0 ? all[0] : undefined
  } catch {
    return undefined
  }
}

/**
 * Enumerate the installed skills for the panel's one-click reference list.
 *
 * @param skills - the `skills` service, captured from an `inject` handle (the
 *   same mechanism every other consumer uses).
 * @param agents - the `agents` service, used only to obtain a scope.
 * @param sessionId - most recent finished turn's session, for the scope lookup.
 * @param logger - host logger, for a one-line diagnostic.
 * @param provenance - `(skillName) => record`; supplies each row's source record.
 *   Injected rather than looked up here, so a read-only host never has to build the
 *   install engine (which probes the filesystem and git) just to paint the panel.
 * @returns `{ name, description, modelInvocable }` records.
 */
/**
 * Provider/model for a background call, read from whatever face the
 * `agentDefaultModel` service exposes.
 *
 * It publishes `currentSelection()`; an earlier revision of this plugin assumed
 * `.provider`/`.model` instance fields, which silently produced an empty route and
 * therefore no translation at all. Both shapes are accepted, and an unusable one
 * returns undefined so the caller can say so out loud.
 */
function modelRoute(service) {
  if (service === undefined || service === null) return undefined
  try {
    const selection = typeof service.currentSelection === 'function' ? service.currentSelection() : service
    if (selection === null || typeof selection !== 'object') return undefined
    const { provider, model } = selection
    return typeof provider === 'string' && provider !== '' && typeof model === 'string' && model !== ''
      ? { provider, model }
      : undefined
  } catch {
    return undefined
  }
}

/** Skills already reported as untranslatable, so the warning is said once each. */
const translateBlocked = new Set()

/**
 * Skill directories the `skills` service reported on the last enumeration.
 *
 * The install engine needs a write target, and the only honest source for it is
 * where the *running* app already finds skills — see {@link resolveSkillsRoot}.
 */
const skillDirs = []

/** Directory mtime, or 0 when it cannot be read. One stat, never a recursive walk. */
function dirMtime(folder) {
  if (typeof folder !== 'string' || folder === '') return 0
  try {
    return statSync(folder).mtimeMs
  } catch {
    return 0
  }
}

/** The provenance block for a skill we know nothing about — the honest default. */
const unknownProvenance = () => ({ known: false, source: '', changedSinceInstall: false })

/** Enabled state for a host with no installer — assume enabled, which is the truth. */
const unknownEnabled = () => true

async function listSkills({ skills, agents, sessionId, logger, translate, provenance = unknownProvenance, enabled = unknownEnabled }) {
  loadTranslations()
  try {
    if (skills === undefined || typeof skills.snapshot !== 'function') {
      logger?.warn?.(`skill-report: skills service unavailable (got ${typeof skills})`)
      return []
    }
    const scope = skillScope(agents, sessionId)
    const snapshot = await skills.snapshot(scope === undefined ? {} : { scope })
    const mapped = (snapshot.skills ?? [])
      .map((skill) => {
        const skillName = String(skill?.name ?? '')
        const folder = typeof skill?.path === 'string' && skill.path !== '' ? dirname(skill.path) : ''
        const description = typeof skill?.description === 'string' ? skill.description : ''
        // Chinese shipped with the skill wins; otherwise a cached machine
        // translation; otherwise kick one off and show the English until it lands.
        const shipped = chineseBlurb(skill?.path, skillName)
        const cached = shipped === '' ? translations.get(skillName) ?? '' : ''
        if (shipped === '' && cached === '' && description !== '' && translate?.enabled === true && !translateBlocked.has(skillName)) {
          if (translate.llm === undefined || translate.route === undefined) {
            // Never fail silently: an unusable model route used to look exactly
            // like "the translation is just slow".
            if (!translateBlocked.has(skillName)) {
              translateBlocked.add(skillName)
              logger?.warn?.(
                `skill-report: cannot translate "${skillName}" ` +
                  `(llm=${translate.llm === undefined ? 'unavailable' : 'ok'}, ` +
                  `route=${translate.route === undefined ? 'unavailable' : 'ok'})`,
              )
            }
          } else {
            void translateBlurb({
              llm: translate.llm,
              route: translate.route,
              name: skillName,
              text: description,
              logger,
              maxTokens: translate.maxTokens,
              sessionId,
            })
          }
        }
        return {
          name: skillName,
          description,
          descriptionZh: shipped !== '' ? shipped : cached,
          // Which layer produced the Chinese line — the panel labels machine
          // translations differently, because those are the ones a user may want
          // to correct by hand.
          blurbSource: shipped !== '' ? 'skill' : cached !== '' ? 'machine' : 'none',
          dir: folder,
          modifiedAt: dirMtime(folder),
          displayNameZh: folder === '' ? '' : yamlScalar(join(folder, 'meta.yaml'), 'display-name-zh'),
          tag: folder === '' ? '' : yamlScalar(join(folder, 'meta.yaml'), 'tag-cn'),
          // `modelInvocable: false` means the skill is reachable ONLY through the
          // `/name` gesture — which is exactly what the panel's button performs.
          modelInvocable: skill?.invocation?.modelInvocable !== false,
          // Where this skill came from, and whether its files still match what was
          // installed. Read here, in the same pass that already resolved the
          // directory — so the record can never disagree with the row it labels.
          provenance: provenance(skillName),
          // A disabled skill is parked OUTSIDE the watched root, so discovery cannot see
          // it and it never reaches this list — which is exactly why this field exists:
          // the panel appends the disabled half of the catalogue itself, and needs to
          // know when a LIVE skill has been disabled since the last snapshot.
          enabled: enabled(skillName) !== false,
        }
      })
      .filter((skill) => skill.name !== '')
    // Refreshed wholesale: a skill that was uninstalled must stop influencing the
    // install target as well.
    skillDirs.length = 0
    for (const skill of mapped) if (skill.dir !== '') skillDirs.push(skill.dir)
    if (mapped.length !== lastSkillCount) {
      lastSkillCount = mapped.length
      logger?.info?.(
        `skill-report: enumerated ${mapped.length} installed skill(s) ` +
          `(scope=${scope === undefined ? 'none' : 'agent'}, discovery complete=${snapshot.complete !== false})`,
      )
    }
    return mapped
  } catch (error) {
    logger?.warn?.(`skill-report: could not list skills: ${error?.message ?? error}`)
    return []
  }
}

/**
 * Mount the per-turn skill audit.
 *
 * Kept separate from {@link apply} so that a mount failure is contained: this
 * plugin only *observes*, so the worst acceptable outcome is "feature off and a
 * warning in the host log", never "the desktop app does not start".
 *
 * @param ctx - cordis context carrying the `sessions`, `sessionTitle` and
 *              (lazily resolved) `desktopRuntime` services.
 * @param config - resolved plugin configuration.
 */
function mount(ctx, config) {
  const enabled = flag(config.enabled, true)
  const notifyOnNoSkill = flag(config.notifyOnNoSkill, true)
  const includeSubagents = flag(config.includeSubagents, false)
  const logReports = flag(config.logReports, false)
  const maxRecent = Math.max(1, Math.floor(numberFlag(config.maxRecent, MAX_RECENT_TURNS)))
  const httpRoute = flag(config.httpRoute, true)
  const translateMissing = flag(config.translateMissing, true)
  const allowInstall = flag(config.allowInstall, true)
  const allowPrivateHosts = flag(config.allowPrivateHosts, false)
  const checkForUpdates = flag(config.checkForUpdates, true)
  // `assertFetchRoute` rejects anything outside `/api/`, so an override that
  // does not look like one is ignored rather than allowed to throw later.
  const path =
    typeof config.httpPath === 'string' && config.httpPath.startsWith('/api/') ? config.httpPath : DEFAULT_HTTP_PATH
  const installPath =
    typeof config.installPath === 'string' && config.installPath.startsWith('/api/') ? config.installPath : DEFAULT_INSTALL_PATH
  const releasePath =
    typeof config.releasePath === 'string' && config.releasePath.startsWith('/api/') ? config.releasePath : DEFAULT_RELEASE_PATH

  // The plugin's own release state. `fetch` comes from `ctx.get` so the host's own
  // instrumented fetch is used when the app provides one.
  const releases = createReleaseChecker({
    version: VERSION,
    fetchImpl: globalThis.fetch,
    allowNetwork: checkForUpdates,
    logger: ctx.logger,
  })

  if (enabled !== true) {
    ctx.logger?.info?.('skill-report disabled by config')
    return
  }

  const tracker = createTurnTracker({ includeSubagents })
  const store = createSkillReportStore({ maxRecent })

  const notify = (title, body) => {
    try {
      // `ctx.get` is the cordis service lookup (it returns undefined for a
      // service that was never provided); the property form is a fallback for
      // contexts that expose injected services directly.
      const runtime = ctx.get?.('desktopRuntime') ?? ctx.desktopRuntime
      runtime?.notifyAttention?.({ title, body })
    } catch (error) {
      ctx.logger?.warn?.(`skill-report: notification failed: ${error?.message ?? error}`)
    }
  }

  /**
   * Latest title of one session. Titles live in the `sessionTitle` service
   * projection (`session/title` events), never on `SessionHeader` — so this is
   * best-effort and optional: without the service the suffix is simply omitted.
   */
  const titleOf = (session) => {
    try {
      const snapshot = ctx.get?.('sessionTitle')?.get?.(session)
      return typeof snapshot?.title === 'string' ? snapshot.title : ''
    } catch {
      return ''
    }
  }

  /**
   * The most recent session seen on ANY event, not just a finished turn.
   *
   * `listSkills` needs a scope to reach the layer that owns local skill discovery,
   * and it used to take that scope from the last FINISHED turn. In a fresh session
   * there is no finished turn yet, so the lookup fell back to an unscoped
   * snapshot — which reads only the global layer, where this deployment has
   * nothing, and the panel said "0 个 skill / 主机侧没有上报 skill" until the first
   * reply landed.
   */
  let lastSessionId = ''
  let sessionsService

  const rememberSession = (session) => {
    const id = sessionIdOf(session)
    if (typeof id === 'string' && id !== '') lastSessionId = id
    return id
  }

  /** Newest session known to the store, for the very first paint of a fresh session. */
  const newestSessionId = () => {
    try {
      const list = sessionsService?.list?.()
      if (!Array.isArray(list) || list.length === 0) return ''
      let best = ''
      let bestAt = -1
      for (const item of list) {
        const id = typeof item === 'string' ? item : sessionIdOf(item)
        if (typeof id !== 'string' || id === '') continue
        const at = Number(item?.header?.createdAt ?? item?.createdAt ?? 0)
        // `>=` so an unordered list still ends on its last entry.
        if (!Number.isFinite(at) || at >= bestAt) {
          bestAt = Number.isFinite(at) ? at : bestAt
          best = id
        }
      }
      return best
    } catch {
      return ''
    }
  }

  const onEvent = (session, event) => {
    rememberSession(session)
    const finished = tracker.onEvent(session, event)
    if (finished === undefined) return

    const sessionTitle = titleOf(session)
    const described = describeTurn(sessionTitle, finished.calls)

    // The store is a complete record of user turns; `notifyOnNoSkill` only
    // mutes the popup, it never drops history.
    store.record({
      sessionId: sessionIdOf(session),
      sessionTitle,
      calls: finished.calls,
      reason: finished.reason,
    })

    if (logReports === true) ctx.logger?.info?.(`skill-report: ${described.heading} — ${described.body}`)
    if (!described.used && notifyOnNoSkill !== true) return
    notify(described.heading, described.body)
  }

  // `session/event` and `session/disposed` are emitted on the cordis context,
  // not exposed by the `sessions` service. This is the same shape the shipped
  // `desktop-notifications` plugin uses, and it keeps the listeners owned by the
  // injected fiber so unloading the plugin disposes them.
  ctx.inject(['sessions'], (sessionsCtx) => {
    sessionsCtx.effect(() => {
      sessionsService = sessionsCtx.sessions
      const stopEvents = sessionsCtx.on('session/event', onEvent)
      const stopDisposed = sessionsCtx.on('session/disposed', (session) => {
        tracker.forget(sessionIdOf(session))
      })
      return () => {
        sessionsService = undefined
        stopDisposed()
        stopEvents()
        tracker.clear()
      }
    }, 'echocat-skill-panel: turn skill audit')
  })

  // The browser panel is a pure renderer: it cannot derive skill usage itself,
  // because `main` is a root-scoped slot that exposes none of the session-scoped
  // hooks carrying messages. So the host serves the snapshot as JSON on the same
  // origin the page was loaded from.
  //
  // Everything below runs in an ASYNC inject callback, outside `apply`'s
  // try/catch — a throw here fails the whole plugin tree and, with it, host
  // boot. Hence the local guard.
  /**
   * Handle on the `skills` service, resolved through `inject` — the same mechanism
   * every other consumer uses. Deliberately NOT `ctx.get()` from the connection
   * inject child; see listSkills() for why.
   */
  let skillsService
  ctx.inject(['skills'], (skillsCtx) => {
    skillsCtx.effect(() => {
      skillsService = skillsCtx.skills
      return () => {
        skillsService = undefined
      }
    }, 'echocat-skill-panel: skills handle')
  })

  /** Agents service: only used to obtain the scope that owns local skill discovery. */
  let agentsService
  ctx.inject(['agents'], (agentsCtx) => {
    agentsCtx.effect(() => {
      agentsService = agentsCtx.agents
      return () => {
        agentsService = undefined
      }
    }, 'echocat-skill-panel: agents handle')
  })

  /** Model handles for on-demand translation of skills that ship no Chinese text. */
  let llmService
  ctx.inject(['llm'], (llmCtx) => {
    llmCtx.effect(() => {
      llmService = llmCtx.llm
      return () => {
        llmService = undefined
      }
    }, 'echocat-skill-panel: llm handle')
  })
  let defaultModel
  ctx.inject(['agentDefaultModel'], (modelCtx) => {
    modelCtx.effect(() => {
      defaultModel = modelCtx.agentDefaultModel
      return () => {
        defaultModel = undefined
      }
    }, 'echocat-skill-panel: default model handle')
  })

  /**
   * The install engine, created on first use.
   *
   * Lazily on purpose: resolving the write target needs the skill directories the
   * `skills` service reports, and that service arrives through an async `inject`
   * — building the engine at mount time could pin a *guess* as the write root for
   * the whole process lifetime.
   */
  let installerInstance
  const installer = () => {
    if (installerInstance === undefined) {
      const root = resolveSkillsRoot({ configured: config.skillsRoot, discovered: skillDirs })
      const backupRoot =
        typeof config.backupRoot === 'string' && config.backupRoot !== ''
          ? config.backupRoot
          : join(homedir(), '.dsh-beta', 'skill-report', 'backups')
      installerInstance = createInstaller({
        root,
        backupRoot,
        logger: ctx.logger,
        allowPrivateHosts,
        // Stamped into every provenance record, so a stale record can be traced
        // back to the build that wrote it.
        pluginVersion: VERSION,
      })
      // Fire-and-forget: the probe must not delay the first panel paint, and
      // `gitKnown()` reports `undefined` until it settles.
      void installerInstance.gitAvailable()
      ctx.logger?.info?.(`skill-report: install endpoint will write to ${root}`)
    }
    return installerInstance
  }

  /** JSON response helper — the same headers the panel feed uses. */
  const jsonResponse = (value, status = 200) =>
    new Response(JSON.stringify(value), {
      status,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    })

  if (httpRoute === true) {
    ctx.inject(['connection'], (connectionCtx) => {
      connectionCtx.effect(() => {
        const disposers = []
        try {
          const dispose = connectionCtx.connection.fetch.register({
            path,
            methods: ['GET', 'HEAD'],
            requestBody: 'buffered',
            fetch: async (request) => {
              let payload
              try {
                // Two directory listings per poll, not two per skill: the enabled map and
                // the disabled catalogue are computed ONCE here and closed over below.
                const enabledNow = allowInstall === true ? installer().enabledMap() : null
                const parked = allowInstall === true ? installer().onDisk().filter((entry) => entry.disabled === true) : []
                payload = JSON.stringify({
                  plugin: name,
                  version: VERSION,
                  generatedAt: Date.now(),
                  pending: tracker.pending(),
                  skills: await listSkills({
                    skills: skillsService,
                    agents: agentsService,
                    // Live session first, then the newest the store knows: either
                    // one reaches the preset layer that owns local discovery.
                    sessionId: lastSessionId || newestSessionId() || store.snapshot().recent[0]?.sessionId,
                    logger: ctx.logger,
                    provenance: (skillName) =>
                      allowInstall === true ? installer().provenance(skillName) : { known: false, source: '', changedSinceInstall: false },
                    enabled: (skillName) => enabledNow === null || enabledNow[skillName] !== false,
                    translate: {
                      enabled: translateMissing,
                      // `ctx.get` is a second chance: the injected handles can be
                      // absent if a service arrives after this plugin mounts.
                      llm: llmService ?? ctx.get?.('llm'),
                      route: modelRoute(defaultModel ?? ctx.get?.('agentDefaultModel')),
                      // A reasoning model spends tokens on a `reasoning` block
                      // BEFORE the text block, so a tight budget ends as
                      // `max-tokens` with zero text (observed: 160 tokens,
                      // chunks=164, blocks=1, blockType=reasoning). The answer
                      // itself is ≤40 characters; this only has to cover thinking.
                      maxTokens: 2000,
                    },
                  }),
                  // The parked skills, so the panel can list and re-enable them. They are
                  // deliberately NOT part of `skills`: that array is what the live
                  // registry reports, and a disabled skill is absent from it by
                  // construction — mixing the two would make the panel claim DSH has a
                  // skill it cannot actually load.
                  disabledSkills: parked.map((entry) => ({
                    name: entry.name,
                    bytes: entry.bytes,
                    modifiedAt: entry.modifiedAt,
                    dir: entry.dir,
                    provenance: allowInstall === true ? installer().provenance(entry.name) : { known: false, source: '', changedSinceInstall: false },
                  })),
                  capability:
                    allowInstall === true
                      ? { ...installer().capability(), git: installer().gitKnown() }
                      : { api: 0, install: false, reason: 'disabled by config' },
                  installHistory: allowInstall === true ? installer().history() : [],
                  // Where this plugin itself lives, plus the last release answer if one has
                  // been asked for. Only the cheap half is in the polled payload: the panel
                  // needs the repo link on first paint, but it must never make a request on
                  // a timer.
                  release: { ...releases.base, cached: releases.peek() },
                  ...store.snapshot(),
                })
              } catch (error) {
                return Response.json({ error: String(error?.message ?? error) }, { status: 500 })
              }
              const response = new Response(payload, {
                status: 200,
                headers: {
                  'content-type': 'application/json; charset=utf-8',
                  'cache-control': 'no-store',
                },
              })
              if (request.method === 'GET') return response
              // HEAD must carry the headers but no body.
              await response.body?.cancel()
              return new Response(null, { status: response.status, headers: response.headers })
            },
          })
          ctx.logger?.info?.(`skill-report: panel feed at ${path}`)
          disposers.push(dispose)
        } catch (error) {
          ctx.logger?.warn?.(`skill-report: could not register the panel feed at ${path}: ${error?.message ?? error}`)
        }

        // The plugin's own release check. GET only — there is nothing to write — and it
        // rides the same authenticated prefix as everything else, so a local process
        // cannot use this app as an outbound-request proxy.
        try {
          disposers.push(
            connectionCtx.connection.fetch.register({
              path: releasePath,
              methods: ['GET', 'HEAD'],
              requestBody: 'buffered',
              fetch: async (request) => {
                // `?force=1` is what the button sends when the user presses it a second
                // time inside the ten-minute cache window: an explicit request for a fresh
                // answer, not a silent cache hit.
                const force = new URL(request.url, 'http://dsh.internal').searchParams.get('force') === '1'
                const value = await releases.check({ force })
                const response = jsonResponse(value)
                if (request.method === 'GET') return response
                await response.body?.cancel()
                return new Response(null, { status: response.status, headers: response.headers })
              },
            }),
          )
          ctx.logger?.info?.(`skill-report: release check at ${releasePath}`)
        } catch (error) {
          ctx.logger?.warn?.(`skill-report: could not register the release route at ${releasePath}: ${error?.message ?? error}`)
        }

        // The write endpoint. Same authenticated prefix, same failure policy: a
        // registration failure degrades to "panel is read-only", never to a
        // failed plugin tree.
        if (allowInstall === true) {
          try {
            disposers.push(
              connectionCtx.connection.fetch.register({
                path: installPath,
                methods: ['GET', 'POST'],
                requestBody: 'buffered',
                fetch: async (request) => {
                  const inst = installer()
                  if (request.method !== 'POST') {
                    return jsonResponse({
                      ok: true,
                      capability: { ...inst.capability(), git: inst.gitKnown() },
                      history: inst.history(),
                      skills: inst.onDisk(),
                    })
                  }
                  let body
                  try {
                    body = await request.json()
                  } catch (error) {
                    return jsonResponse(
                      { ok: false, error: { code: 'BAD_REQUEST', message: `请求体不是合法 JSON：${error?.message ?? error}` } },
                      400,
                    )
                  }
                  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
                    return jsonResponse({ ok: false, error: { code: 'BAD_REQUEST', message: '请求体必须是一个 JSON 对象。' } }, 400)
                  }
                  try {
                    const result = await inst.install(body)
                    return jsonResponse(
                      { ...result, capability: { ...inst.capability(), git: inst.gitKnown() } },
                      result.ok === true ? 200 : INSTALL_STATUS[result.error?.code] ?? 500,
                    )
                  } catch (error) {
                    // `install()` maps its own failures; anything reaching here is
                    // a defect, and still must not take the host down.
                    const wire = toInstallError(error)
                    ctx.logger?.warn?.(`skill-report: install handler failed: ${error?.stack ?? error}`)
                    return jsonResponse({ ok: false, error: wire }, INSTALL_STATUS[wire.code] ?? 500)
                  }
                },
              }),
            )
            ctx.logger?.info?.(`skill-report: skill install endpoint at ${installPath}`)
          } catch (error) {
            ctx.logger?.warn?.(`skill-report: could not register the install endpoint at ${installPath}: ${error?.message ?? error}`)
          }
        }

        return () => {
          for (const dispose of disposers) {
            try {
              dispose()
            } catch {
              // The connection may already be gone; unloading must not throw.
            }
          }
        }
      }, 'echocat-skill-panel: panel feed')
    })
  } else {
    ctx.logger?.info?.('skill-report: panel feed disabled by config')
  }

  ctx.logger?.info?.('skill-report mounted: per-turn skill audit active')
}

/**
 * Entry point called by the cordis loader.
 * @param ctx - plugin context.
 * @param config - resolved plugin configuration.
 */
export function apply(ctx, config = {}) {
  try {
    mount(ctx, config)
  } catch (error) {
    // A throw here fails the entire plugin tree — and with it the desktop app's
    // host boot (observed 2026-09-18). Degrade to "disabled" instead.
    ctx.logger?.warn?.(`skill-report: mount failed, plugin disabled: ${error?.stack ?? error}`)
  }
}
