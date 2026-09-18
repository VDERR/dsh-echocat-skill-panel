// Pure, dependency-free skill-usage detection.
//
// Extracted so the host half and the browser half can share exactly one
// implementation: the host subscribes to `session/event` through cordis, and the
// client panel (if it observes events itself) replays the same stream through the
// same tracker. Nothing here imports cordis, React, or node builtins.

export const SOURCE_USER = 'user'
export const SOURCE_SKILL_INVOCATION = 'skill-invocation'
export const HOW_MODEL = 'model'
export const HOW_USER = 'user'

/** Skill names mentioned by a `skill` tool call's raw JSON argument string. */
export function skillNameFromToolCall(rawArguments) {
  if (typeof rawArguments !== 'string' || rawArguments.length === 0) return undefined
  let parsed
  try {
    parsed = JSON.parse(rawArguments)
  } catch {
    // Tolerate a truncated or non-JSON payload rather than dropping the report.
    const match = /"name"\s*:\s*"([^"]+)"/.exec(rawArguments)
    return match === null ? undefined : match[1]
  }
  const value = parsed?.name ?? parsed?.skill ?? parsed?.skill_name
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

export function sessionIdOf(session) {
  return String(session?.header?.id ?? '')
}

export function isSubagent(session) {
  return session?.header?.origin === 'subagent'
}

/**
 * Fold a session/event stream into one report per user-initiated turn.
 *
 * State lives per session id, so interleaved sessions (a session plus its
 * subagents, or two windows) cannot cross-contaminate each other.
 *
 * @param options - tracker configuration.
 * @param options.includeSubagents - also track subagent sessions (default false).
 * @returns tracker with `onEvent`, `forget`, `clear`, `pending`.
 */
export function createTurnTracker({ includeSubagents = false } = {}) {
  /** sessionId -> { turn, userInitiated, calls: Map<name, how> } */
  const turns = new Map()

  return {
    /**
     * Feed one event.
     * @returns the finished turn's report, or undefined when the event is not a
     *          reportable turn boundary (the common case).
     */
    onEvent(session, event) {
      if (session === null || typeof session !== 'object') return undefined
      if (isSubagent(session) && includeSubagents !== true) return undefined
      if (event === null || typeof event !== 'object') return undefined

      const sessionId = sessionIdOf(session)
      if (sessionId === '') return undefined

      if (event.type === 'turn/start') {
        turns.set(sessionId, { turn: event.data?.turn, userInitiated: false, calls: new Map() })
        return undefined
      }

      const turn = turns.get(sessionId)
      if (turn === undefined) return undefined

      if (event.type === 'user/message') {
        const source = event.data?.source
        if (source?.kind === SOURCE_USER) {
          turn.userInitiated = true
          return undefined
        }
        if (source?.kind === SOURCE_SKILL_INVOCATION) {
          // A `/name` gesture IS the human starting the turn: the injected
          // skill-invocation message is the only durable trace of it, so it must
          // mark the turn user-initiated too. Otherwise the very turns this
          // plugin exists to report would be filtered out as background work.
          turn.userInitiated = true
          const skillName = source.name
          // No dedup guard on this channel: an explicit `/name` is the stronger
          // signal, so it wins over a model load of the same skill.
          if (typeof skillName === 'string' && skillName.length > 0) turn.calls.set(skillName, HOW_USER)
        }
        return undefined
      }

      if (event.type === 'tool/call' && event.data?.name === 'skill') {
        const skillName = skillNameFromToolCall(event.data?.arguments)
        if (skillName !== undefined && !turn.calls.has(skillName)) turn.calls.set(skillName, HOW_MODEL)
        return undefined
      }

      if (event.type !== 'turn/end') return undefined
      if (event.data?.turn !== turn.turn) return undefined

      turns.delete(sessionId)
      if (turn.userInitiated !== true) return undefined

      return {
        turn: turn.turn,
        reason: event.data?.reason?.kind,
        calls: [...turn.calls.entries()].map(([name, how]) => ({ name, how })),
      }
    },

    /** Drop one session's in-flight turn (on `session/disposed`). */
    forget(sessionId) {
      turns.delete(String(sessionId ?? ''))
    },

    clear() {
      turns.clear()
    },

    /** Number of turns currently in flight — used by the panel's health line. */
    pending() {
      return turns.size
    },
  }
}

/**
 * Render one report into the notification/panel strings.
 *
 * @param title - session title, or '' when unknown.
 * @param calls - report calls from {@link createTurnTracker}.
 * @returns `{ used, count, title, body, skills }`.
 */
export function describeTurn(title, calls) {
  const skills = Array.isArray(calls) ? calls : []
  const used = skills.length > 0
  const suffix = typeof title === 'string' && title !== '' ? `（${title}）` : ''
  return {
    used,
    count: skills.length,
    heading: used ? `本轮调用了 skill${suffix}` : `本轮未调用 skill${suffix}`,
    body: used
      ? skills.map((c) => `${c.name}（${c.how === HOW_USER ? '你手动 /' : '模型自动'}）`).join('、')
      : '本轮对话没有加载任何 skill。',
    skills,
  }
}
