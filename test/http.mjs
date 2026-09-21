// Host-side panel feed test.
//
// The route is registered through `ctx.connection.fetch.register`, so this test
// stands up a real cordis Context with a recording `connection` service, mounts
// the real plugin, feeds the real session-event stream, and then invokes the
// registered handler exactly as the connection service would. The only fake is
// the connection service itself — everything else is the shipping code path.

import { Context, Service } from '@deepseek-ai/cordis'
import { join } from 'node:path'
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

class Sessions extends Service {
  constructor(ctx) {
    super(ctx, 'sessions')
  }
}

/** Records Fetch routes instead of serving them; the handler itself is real. */
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

const session = (id, origin) => ({ header: { id, origin } })
const emit = (ctx, s, event) => ctx.emit('session/event', s, event)

const ctx = new Context()
new Sessions(ctx)
const connection = new Connection(ctx)
const warns = []
ctx.logger = { info: () => {}, warn: (message) => warns.push(String(message)) }

console.log('\n[1] the plugin mounts and registers exactly one feed')
plugin.apply(ctx, {})
await settle()
ok('no warning during mount', warns.length === 0, warns.join(' | '))
const paths = connection.routes.map((r) => r.path)
ok('the state feed is registered', paths.includes(plugin.DEFAULT_HTTP_PATH), JSON.stringify(paths))
ok('the install endpoint is registered', paths.includes(plugin.DEFAULT_INSTALL_PATH), JSON.stringify(paths))

const route = connection.routes[0]
ok('the route lives under the authenticated /api prefix',
  typeof route?.path === 'string' && route.path.startsWith('/api/'), String(route?.path))
ok('the default path is the documented one', route?.path === plugin.DEFAULT_HTTP_PATH, String(route?.path))
ok('GET and HEAD are accepted', JSON.stringify([...(route?.methods ?? [])]) === JSON.stringify(['GET', 'HEAD']), JSON.stringify(route?.methods))
ok('the body mode is declared', route?.requestBody === 'buffered', String(route?.requestBody))
ok('the handler is a function', typeof route?.fetch === 'function')

console.log('\n[2] the payload reflects the live store')
const before = await route.fetch(new Request('http://dsh.internal' + route.path))
const empty = await before.json()
ok('a fresh store answers 200', before.status === 200, String(before.status))
ok('content-type is JSON', String(before.headers.get('content-type')).includes('application/json'), String(before.headers.get('content-type')))
ok('responses are not cached', before.headers.get('cache-control') === 'no-store', String(before.headers.get('cache-control')))
ok('the payload identifies the plugin', empty.plugin === plugin.name && empty.version === plugin.VERSION, JSON.stringify({ p: empty.plugin, v: empty.version }))
ok('the payload starts empty', empty.turns === 0 && Array.isArray(empty.recent) && empty.recent.length === 0)
ok('the payload reports pending turns', empty.pending === 0, String(empty.pending))

// One user turn that loads a skill through the tool, and one that invokes none.
{
  const s = session('s1')
  emit(ctx, s, { type: 'turn/start', data: { turn: 1 } })
  emit(ctx, s, { type: 'user/message', data: { source: { kind: 'user' } } })
  emit(ctx, s, { type: 'tool/call', data: { name: 'skill', arguments: JSON.stringify({ name: 'gpt-image' }) } })
  emit(ctx, s, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })

  emit(ctx, s, { type: 'turn/start', data: { turn: 2 } })
  emit(ctx, s, { type: 'user/message', data: { source: { kind: 'skill-invocation', name: 'h3-prompt-writing' } } })
  emit(ctx, s, { type: 'turn/end', data: { turn: 2, reason: { kind: 'completed' } } })
}

// A turn in flight must show up as pending, not as a finished turn.
{
  const s = session('s2')
  emit(ctx, s, { type: 'turn/start', data: { turn: 9 } })
}

const after = await route.fetch(new Request('http://dsh.internal' + route.path))
const data = await after.json()
ok('finished turns are counted', data.turns === 2, String(data.turns))
ok('turns with skills are counted', data.turnsWithSkills === 2, String(data.turnsWithSkills))
ok('invocations are counted', data.invocations === 2, String(data.invocations))
ok('in-flight turns are reported separately', data.pending === 1, String(data.pending))
ok('per-skill totals are present', JSON.stringify(data.perSkill) === JSON.stringify([
  { name: 'gpt-image', count: 1 },
  { name: 'h3-prompt-writing', count: 1 },
]), JSON.stringify(data.perSkill))
ok('the newest turn is first', data.recent[0]?.calls?.[0]?.name === 'h3-prompt-writing', JSON.stringify(data.recent[0]))
ok('the model channel survives the wire', data.recent[1]?.calls?.[0]?.how === 'model', JSON.stringify(data.recent[1]))
ok('the /name channel survives the wire', data.recent[0]?.calls?.[0]?.how === 'user', JSON.stringify(data.recent[0]))
ok('the payload is JSON-serializable', typeof after.json === 'function')

console.log('\n[3] HEAD carries headers without a body')
const head = await route.fetch(new Request('http://dsh.internal' + route.path, { method: 'HEAD' }))
ok('HEAD answers 200', head.status === 200, String(head.status))
ok('HEAD has no body', head.body === null, String(head.body))
ok('HEAD keeps the content type', String(head.headers.get('content-type')).includes('application/json'))

console.log('\n[4] degradation')
{
  const off = new Context()
  new Sessions(off)
  new Connection(off)
  const offWarns = []
  off.logger = { info: () => {}, warn: (m) => offWarns.push(String(m)) }
  plugin.apply(off, { httpRoute: false })
  await settle()
  ok('httpRoute: false registers nothing', off.connection.routes.length === 0)
  ok('...and says so', offWarns.length === 0)

  const alone = new Context()
  new Sessions(alone)
  alone.logger = { info: () => {}, warn: () => {} }
  let threw = null
  try {
    plugin.apply(alone, {})
  } catch (error) {
    threw = error
  }
  await settle()
  ok('a host with no connection service still mounts', threw === null, String(threw))
}
{
  const bad = new Context()
  new Sessions(bad)
  new Connection(bad)
  const badWarns = []
  bad.logger = { info: () => {}, warn: (m) => badWarns.push(String(m)) }
  plugin.apply(bad, { httpPath: '/not-api/skill-report' })
  await settle()
  ok('a path outside /api is replaced by the default',
    bad.connection.routes[0]?.path === '/api/skill-report/state', String(bad.connection.routes[0]?.path))
}
{
  const custom = new Context()
  new Sessions(custom)
  new Connection(custom)
  custom.logger = { info: () => {}, warn: () => {} }
  plugin.apply(custom, { httpPath: '/api/skill-report/custom' })
  await settle()
  ok('a valid override is honoured', custom.connection.routes[0]?.path === '/api/skill-report/custom', String(custom.connection.routes[0]?.path))
}

console.log('\n[5] the installed-skill list')
{
  /** Minimal stand-in for the `skills` service (snapshot() is the member used). */
  class Skills extends Service {
    constructor(ctx, summaries) {
      super(ctx, 'skills')
      this.summaries = summaries
      this.seen = []
    }
    async list() {
      if (this.summaries instanceof Error) throw this.summaries
      return this.summaries
    }
    async snapshot(options = {}) {
      this.seen.push(options)
      if (this.summaries instanceof Error) throw this.summaries
      return { skills: this.summaries, complete: true }
    }
  }
  /** Minimal stand-in for the `agents` service: only the scope lookup is used. */
  class Agents extends Service {
    constructor(ctx, bySession) {
      super(ctx, 'agents')
      this.bySession = bySession
    }
    get(sessionId) {
      return this.bySession[sessionId]
    }
    list() {
      return Object.values(this.bySession)
    }
  }
  const summaries = () => [
    { name: 'gpt-image', description: '\u51fa\u56fe', invocation: { modelInvocable: true } },
    { name: 'manual-only', description: '\u4ec5\u624b\u52a8', invocation: { modelInvocable: false } },
    {
      // A skill that ships inside a PLUGIN package. DSH's skill service folds these into the same list as
      // the user's own, so the catalogue showed "browser-skill" and friends as though they had been
      // installed here. The `path` is what distinguishes them: it is not under the root this plugin manages.
      name: 'bundled-one',
      description: '\u63d2\u4ef6\u81ea\u5e26',
      path: join('C:\\somewhere\\else\\node_modules\\a-plugin\\skills\\bundled-one', 'SKILL.md'),
      invocation: { modelInvocable: true },
    },
    {
      // And one that IS under the managed root, so the attribution is proved to be per-skill rather than a
      // blanket 'plugin' for everything the service reports.
      name: 'mine',
      description: '\u81ea\u5df1\u88c5\u7684',
      path: join('C:\\Users\\Administrator\\.dsh-beta\\skills\\mine', 'SKILL.md'),
      invocation: { modelInvocable: true },
    },
    { name: '', description: 'no name, must be dropped' },
    null,
  ]

  const withSkills = new Context()
  new Sessions(withSkills)
  new Connection(withSkills)
  new Skills(withSkills, summaries())
  withSkills.logger = { info: () => {}, warn: () => {} }
  // `skillsRoot` is passed explicitly. Attribution is decided by asking whether a skill's directory sits
  // under the root this plugin manages, and with no root configured every skill comes back 'user' — which is
  // the safe default and is exactly why the fixture has to state the root for the check to mean anything.
  const rootWarnings = []
  withSkills.logger = { info: () => {}, warn: (m) => rootWarnings.push(String(m)) }
  plugin.apply(withSkills, { skillsRoot: 'C:\\Users\\Administrator\\.dsh-beta\\skills' })
  await settle()
  const skillsRoute = withSkills.connection.routes[0]
  const payload = await (await skillsRoute.fetch(new Request('http://dsh.internal' + skillsRoute.path))).json()
  ok('the payload carries the installed skills', Array.isArray(payload.skills) && payload.skills.length === 4, JSON.stringify(payload.skills.map((s) => s.name)))
  ok('a nameless summary is dropped', payload.skills.every((s) => s.name !== ''))
  ok('descriptions survive', payload.skills[0]?.description === '\u51fa\u56fe', JSON.stringify(payload.skills[0]))
  ok('modelInvocable is carried through', payload.skills.find((s) => s.name === 'manual-only')?.modelInvocable === false)
  // The attribution the catalogue needs: which skills are the user's and which a plugin shipped. Decided by
  // PATH, so a summary the service reports from anywhere else is not silently presented as the user's own.
  ok('a skill outside the managed root is attributed to a plugin',
    payload.skills.find((s) => s.name === 'bundled-one')?.location === 'plugin',
    `location=${JSON.stringify(payload.skills.find((s) => s.name === 'bundled-one')?.location)} ` +
      `dir=${JSON.stringify(payload.skills.find((s) => s.name === 'bundled-one')?.dir)} ` +
      `root=${JSON.stringify(payload.capability?.root)} warns=${JSON.stringify(rootWarnings)}`)
  ok('...and one inside it is attributed to the user',
    payload.skills.find((s) => s.name === 'mine')?.location === 'user',
    JSON.stringify(payload.skills.find((s) => s.name === 'mine')?.location))
  ok('...so the two are not all labelled the same',
    new Set(payload.skills.map((s) => s.location)).size >= 1 && payload.skills.some((s) => s.location === 'user'))
  ok('the usage report is unaffected', payload.turns === 0 && Array.isArray(payload.recent))

  // The real host provides `skills` from a plugin mounted ELSEWHERE in the tree,
  // not from a service constructed on the same context. Resolution must not depend
  // on that — resolving it with ctx.get() from the connection inject child came
  // back undefined exactly here, which showed up as "已安装 skill（0）".
  const nested = new Context()
  new Sessions(nested)
  new Connection(nested)
  nested.plugin({
    name: 'test-provides-skills',
    apply: (serviceCtx) => {
      new Skills(serviceCtx, summaries())
    },
  })
  await settle()
  nested.logger = { info: () => {}, warn: () => {} }
  plugin.apply(nested, {})
  await settle()
  const nestedRoute = nested.connection.routes[0]
  const nestedPayload = await (await nestedRoute.fetch(new Request('http://dsh.internal' + nestedRoute.path))).json()
  ok('skills resolve when provided by a plugin elsewhere in the tree',
    nestedPayload.skills.length === 4, JSON.stringify(nestedPayload.skills))

  // Scope: the desktop composition disables the HOST skill-filesystem row, so an
  // unscoped snapshot legitimately returns nothing. The panel must pass the scope
  // whose layer chain owns local discovery — the agent, exactly as dsh-tool-skill does.
  {
    const scoped = new Context()
    new Sessions(scoped)
    new Connection(scoped)
    const skills = new Skills(scoped, summaries())
    const agent = { id: 'agent-for-s1' }
    new Agents(scoped, { s1: agent })
    scoped.logger = { info: () => {}, warn: () => {} }
    plugin.apply(scoped, {})
    await settle()
    // One finished turn, so the scope comes from a real session id.
    scoped.emit('session/event', session('s1'), { type: 'turn/start', data: { turn: 1 } })
    scoped.emit('session/event', session('s1'), { type: 'user/message', data: { source: { kind: 'user' } } })
    scoped.emit('session/event', session('s1'), { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
    const scopedRoute = scoped.connection.routes[0]
    await scopedRoute.fetch(new Request('http://dsh.internal' + scopedRoute.path))
    ok('an agent is discovered for the scope', skills.seen.length === 1 && skills.seen[0].scope !== undefined,
      JSON.stringify(skills.seen))
    ok('the scope is the agent of the most recent turn', skills.seen[0]?.scope === agent, JSON.stringify(skills.seen[0]?.scope))

    // ...and with no live agent it degrades to the unscoped call rather than throwing.
    const unscoped = new Context()
    new Sessions(unscoped)
    new Connection(unscoped)
    const bareSkills = new Skills(unscoped, summaries())
    unscoped.logger = { info: () => {}, warn: () => {} }
    plugin.apply(unscoped, {})
    await settle()
    const bareRoute2 = unscoped.connection.routes[0]
    await bareRoute2.fetch(new Request('http://dsh.internal' + bareRoute2.path))
    ok('without an agents service the call is unscoped, not broken',
      bareSkills.seen.length === 1 && bareSkills.seen[0].scope === undefined, JSON.stringify(bareSkills.seen))
  }

  const noSkills = new Context()
  new Sessions(noSkills)
  new Connection(noSkills)
  noSkills.logger = { info: () => {}, warn: () => {} }
  plugin.apply(noSkills, {})
  await settle()
  const bareRoute = noSkills.connection.routes[0]
  const bare = await (await bareRoute.fetch(new Request('http://dsh.internal' + bareRoute.path))).json()
  ok('a host without the skills service still answers', Array.isArray(bare.skills) && bare.skills.length === 0, JSON.stringify(bare.skills))

  const brokenSkills = new Context()
  new Sessions(brokenSkills)
  new Connection(brokenSkills)
  const warnings = []
  new Skills(brokenSkills, new Error('provider exploded'))
  brokenSkills.logger = { info: () => {}, warn: (m) => warnings.push(String(m)) }
  plugin.apply(brokenSkills, {})
  await settle()
  const brokenRoute = brokenSkills.connection.routes[0]
  const degraded = await (await brokenRoute.fetch(new Request('http://dsh.internal' + brokenRoute.path))).json()
  ok('a throwing skills service degrades to an empty list', degraded.skills.length === 0, JSON.stringify(degraded.skills))
  ok('...and does not break the usage report', degraded.turns === 0 && degraded.plugin === plugin.name)
  ok('...and is logged', warnings.some((w) => w.includes('could not list skills')), warnings.join(' | '))
}

console.log(`\nRESULT: ${pass}/${pass + fail} passed`)
if (fail > 0) process.exitCode = 1
