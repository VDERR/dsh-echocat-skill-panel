// Skill-scope test: the panel must enumerate installed skills BEFORE the first
// turn finishes.
//
// `skills.snapshot()` reads `[global, ...chainLayers(scope)]`. This deployment has
// no global skill provider at all — `dsh-web-app` disables the host
// `skill-filesystem` row and lets each agent preset own local discovery — so an
// UNSCOPED snapshot is legitimately empty. The panel used to take its scope from
// the most recent FINISHED turn, which meant a fresh session showed
// "已安装 skill（0）· 主机侧没有上报 skill" until the first reply landed.
//
// The fix takes the scope from the live session (the newest one the store knows),
// so the catalog is right from the first paint. This test pins that down.

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import * as plugin from '../src/index.js'

let pass = 0
let fail = 0
const ok = (label, cond, extra = '') => {
  if (cond) {
    pass += 1
    console.log(`  PASS  ${label}`)
  } else {
    fail += 1
    console.log(`  FAIL  ${label}${extra === '' ? '' : `  <- ${extra}`}`)
  }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 10))
const sandbox = mkdtempSync(join(tmpdir(), 'echocat-scope-'))

/** Minimal stand-ins for the three services the lookup depends on. */
class Sessions extends Service {
  constructor(ctx) {
    super(ctx, 'sessions')
    this.items = []
  }
  list() {
    return this.items
  }
}

class Connection extends Service {
  constructor(ctx) {
    super(ctx, 'connection')
    this.routes = []
    this.fetch = {
      register: (route) => {
        this.routes.push(route)
        return () => {
          this.routes = this.routes.filter((r) => r !== route)
        }
      },
    }
  }
}

/**
 * Records every snapshot call, so the scope actually passed can be asserted — and
 * mirrors the real registry's layering: an UNSCOPED call sees only the global
 * layer, which in this deployment has no provider at all. That is what made the
 * bug visible on screen, so the stub reproduces it instead of always answering.
 */
class Skills extends Service {
  constructor(ctx) {
    super(ctx, 'skills')
    this.calls = []
  }
  async snapshot(options) {
    this.calls.push(options)
    const scoped = options !== undefined && options.scope !== undefined
    return {
      complete: true,
      skills: scoped ? [{ name: 'probe-skill', description: 'a probe skill', path: join(sandbox, 'probe-skill', 'SKILL.md') }] : [],
    }
  }
}

class Agents extends Service {
  constructor(ctx) {
    super(ctx, 'agents')
    this.scope = { id: 'agent-scope' }
  }
  get(id) {
    return typeof id === 'string' && id !== '' ? this.scope : undefined
  }
  list() {
    return [this.scope]
  }
}

/** Mount the plugin against the stubs; `withAgents: false` reproduces no provider. */
async function mount({ withAgents = true } = {}) {
  const ctx = new Context()
  const sessions = new Sessions(ctx)
  const connection = new Connection(ctx)
  const skills = new Skills(ctx)
  const agents = withAgents ? new Agents(ctx) : undefined
  const warns = []
  ctx.logger = { info: () => {}, warn: (message) => warns.push(String(message)) }
  plugin.apply(ctx, { skillsRoot: join(sandbox, 'skills'), backupRoot: join(sandbox, 'backups'), translateMissing: false })
  await settle()
  const route = connection.routes.find((r) => r.path === plugin.DEFAULT_HTTP_PATH)
  return { ctx, sessions, skills, agents, warns, route }
}

const readState = async (route) => (await route.fetch(new Request('http://dsh.internal/api/skill-report/state'))).json()

/* ------------------------------------------------- [1] a brand-new session -- */

console.log('\n[1] a fresh session with no finished turn still lists skills')
const fresh = await mount()
fresh.sessions.items = [{ header: { id: 'session-1', createdAt: 1 } }]
const freshState = await readState(fresh.route)
ok('the request succeeded', freshState.plugin === plugin.name, JSON.stringify(freshState).slice(0, 120))
ok('the snapshot was called with a scope', fresh.skills.calls.length > 0 && fresh.skills.calls.at(-1).scope !== undefined,
  JSON.stringify(fresh.skills.calls.at(-1)))
ok('no unscoped snapshot was used', fresh.skills.calls.every((call) => call.scope !== undefined))
ok('the installed skill reaches the payload', Array.isArray(freshState.skills) && freshState.skills.length === 1, JSON.stringify(freshState.skills))
ok('the skill keeps its name and description', freshState.skills[0]?.name === 'probe-skill' && freshState.skills[0]?.description === 'a probe skill')
ok('no turn is reported yet', freshState.turns === 0)
ok('the mount raised no warning', fresh.warns.length === 0, fresh.warns.join(' | '))

/* ------------------------------------------- [2] an event, but no turn end -- */

console.log('\n[2] a session that has only STARTED a turn still lists skills')
const started = await mount()
started.sessions.items = [{ header: { id: 'session-2', createdAt: 1 } }]
started.ctx.emit('session/event', { header: { id: 'session-2' } }, { type: 'turn/start', data: { turn: 1 } })
await settle()
const startedState = await readState(started.route)
ok('the live session became the scope', started.skills.calls.at(-1)?.scope !== undefined, JSON.stringify(started.skills.calls.at(-1)))
ok('the catalog is present', startedState.skills.length === 1)
ok('still no finished turn', startedState.turns === 0, String(startedState.turns))

/* --------------------------------- [3] the session list decides, not history -- */

console.log('\n[3] the newest session in the store wins')
const many = await mount()
many.sessions.items = [
  { header: { id: 'old-session', createdAt: 10 } },
  { header: { id: 'new-session', createdAt: 20 } },
]
const manyState = await readState(many.route)
ok('a scope was still passed', many.skills.calls.at(-1)?.scope !== undefined)
ok('the catalog is present', manyState.skills.length === 1)
// String entries (an id-only list) must not break the pick.
const idsOnly = await mount()
idsOnly.sessions.items = ['only-session']
const idsState = await readState(idsOnly.route)
ok('an id-only session list still yields a scope', idsOnly.skills.calls.at(-1)?.scope !== undefined, JSON.stringify(idsOnly.skills.calls.at(-1)))
ok('and still lists the catalog', idsState.skills.length === 1)

/* ------------------------------------------------- [4] degraded, but honest -- */

console.log('\n[4] with no provider at all the panel says so instead of failing')
const degraded = await mount({ withAgents: false })
degraded.sessions.items = []
const degradedState = await readState(degraded.route)
ok('the request still succeeds', degradedState.plugin === plugin.name)
ok('an empty catalog is reported', Array.isArray(degradedState.skills) && degradedState.skills.length === 0, JSON.stringify(degradedState.skills))
ok('the host is still reachable', degradedState.version === plugin.VERSION)

rmSync(sandbox, { recursive: true, force: true })
console.log(`\nRESULT: ${pass}/${pass + fail} passed`)
if (fail > 0) process.exit(1)
