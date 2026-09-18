// Pure, dependency-free report store.
//
// A bounded recent-turn log plus aggregate counters, with a change subscription.
// Shared by the host half (which is the source of truth) and reusable by the
// browser half for its own optimistic view.

export const MAX_RECENT_TURNS = 200

/**
 * @param options - store configuration.
 * @param options.maxRecent - ring size for the recent-turn log.
 * @param options.now - clock, injectable for tests.
 */
export function createSkillReportStore({ maxRecent = MAX_RECENT_TURNS, now = () => Date.now() } = {}) {
  /** Newest-first ring of finished user turns. */
  const recent = []
  const perSkill = new Map()
  let turns = 0
  let turnsWithSkills = 0
  let invocations = 0
  let lastAt

  const listeners = new Set()
  const notify = () => {
    for (const listener of [...listeners]) {
      try {
        listener()
      } catch {
        // A broken observer must not break the recorder.
      }
    }
  }

  return {
    /**
     * Append one finished turn.
     * @param entry - `{ sessionId, sessionTitle, calls, reason }`; `at` optional.
     * @returns the stored timestamp.
     */
    record(entry) {
      const calls = Array.isArray(entry?.calls) ? entry.calls : []
      const at = typeof entry?.at === 'number' ? entry.at : now()
      const stored = {
        at,
        sessionId: String(entry?.sessionId ?? ''),
        sessionTitle: String(entry?.sessionTitle ?? ''),
        reason: entry?.reason,
        calls: calls.map((c) => ({ name: String(c?.name ?? ''), how: c?.how === 'user' ? 'user' : 'model' })),
      }
      turns += 1
      if (stored.calls.length > 0) turnsWithSkills += 1
      for (const call of stored.calls) {
        invocations += 1
        perSkill.set(call.name, (perSkill.get(call.name) ?? 0) + 1)
      }
      recent.unshift(stored)
      if (recent.length > maxRecent) recent.length = maxRecent
      lastAt = at
      notify()
      return at
    },

    /**
     * Immutable view for a UI or an RPC response.
     * @returns counters, the recent-turn ring, and per-skill totals (descending).
     */
    snapshot() {
      return {
        turns,
        turnsWithSkills,
        turnsWithoutSkills: turns - turnsWithSkills,
        invocations,
        lastAt,
        recent: recent.map((r) => ({ ...r, calls: r.calls.map((c) => ({ ...c })) })),
        perSkill: [...perSkill.entries()]
          .map(([name, count]) => ({ name, count }))
          .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
      }
    },

    /** @returns an unsubscribe function. */
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    clear() {
      recent.length = 0
      perSkill.clear()
      turns = 0
      turnsWithSkills = 0
      invocations = 0
      lastAt = undefined
      notify()
    },
  }
}
