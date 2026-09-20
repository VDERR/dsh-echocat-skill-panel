// Offline smoke test for echocat-skill-panel.
//
// Deliberately runs the plugin against the REAL `@deepseek-ai/cordis` Context
// and REAL `Service` instances — the previous harness stubbed the whole context,
// which is exactly why `ctx.sessions.on is not a function` slipped through and
// aborted host boot twice. Everything the plugin touches here (`ctx.inject`,
// `ctx.effect`, `ctx.on`, `ctx.emit`, `ctx.get`, `ctx.logger`) is the genuine
// implementation from the installed DSH core.

import { Context, Service } from '@deepseek-ai/cordis'
import { pathToFileURL } from 'node:url'

// Defaults to this package's own source; pass a path to exercise another copy
// (for example the one installed into a profile), whose bare imports then
// resolve exactly the way the host resolves them.
const target = process.argv[2] ?? new URL('../src/index.js', import.meta.url).href
const plugin = await import(target.startsWith('file:') ? target : pathToFileURL(target).href)
console.log(`plugin under test: ${target}`)

// `ctx.inject(deps, cb)` activates its child fiber on a later tick (verified
// against this core: the callback is not synchronous), so every mount must be
// given a tick before events are emitted at it.
const settle = () => new Promise((resolve) => setTimeout(resolve, 10))

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

// --- real cordis context + real Service-based stubs --------------------------
const notices = []
const warns = []
const titles = new Map()

class Sessions extends Service {
  constructor(ctx) {
    super(ctx, 'sessions')
  }
}

class DesktopRuntime extends Service {
  constructor(ctx) {
    super(ctx, 'desktopRuntime')
  }
  notifyAttention(notification) {
    notices.push(notification)
  }
}

class SessionTitle extends Service {
  constructor(ctx) {
    super(ctx, 'sessionTitle')
  }
  get(session) {
    const title = titles.get(session.header.id)
    return title === undefined ? undefined : { title }
  }
}

const makeContext = () => {
  const ctx = new Context()
  new Sessions(ctx)
  new DesktopRuntime(ctx)
  new SessionTitle(ctx)
  return ctx
}

const ctx = makeContext()
ctx.logger = { info: () => {}, warn: (message) => warns.push(String(message)) }

console.log('\n[1] exports and the API that used to be wrong')
ok('name / apply / inject / Config exported',
  plugin.name === 'echocat-skill-panel'
  && typeof plugin.apply === 'function'
  && Array.isArray(plugin.inject)
  && plugin.inject.includes('sessions')
  && plugin.Config !== undefined)
ok('the `sessions` service really has no .on() (the 09-18 crash)',
  typeof ctx.get('sessions').on !== 'function')
ok('cordis Context really does expose .on()',
  typeof ctx.on === 'function')

console.log('\n[2] mount')
let threw = null
try {
  plugin.apply(ctx, {})
} catch (error) {
  threw = error
}
ok('apply() does not throw against the real cordis context', threw === null, String(threw))
await settle()
ok('no warning logged during a clean mount', warns.length === 0, warns.join(' | '))

// --- helpers ----------------------------------------------------------------
const session = (id, origin) => ({ header: { id, origin } })
const emit = (s, event) => ctx.emit('session/event', s, event)
const say = (s, source) => emit(s, { type: 'user/message', data: { source } })
const start = (s, turn) => emit(s, { type: 'turn/start', data: { turn } })
const end = (s, turn, kind = 'completed') => emit(s, { type: 'turn/end', data: { turn, reason: { kind } } })
const skillCall = (s, skillName) => emit(s, { type: 'tool/call', data: { name: 'skill', arguments: JSON.stringify({ name: skillName }) } })

titles.set('s1', '水彩测试')
titles.set('s2', '双人替换')
titles.set('s3', '没有技能的一轮')

console.log('\n[3] model loads a skill through the `skill` tool')
notices.length = 0
{
  const s = session('s1')
  start(s, 1)
  say(s, { kind: 'user' })
  skillCall(s, 'gpt-image')
  end(s, 1)
  ok('exactly one notification', notices.length === 1, JSON.stringify(notices))
  ok('title carries the session title', notices[0]?.title === '本轮调用了 skill（水彩测试）', JSON.stringify(notices[0]))
  ok('body marks it 模型自动', notices[0]?.body === 'gpt-image（模型自动）', JSON.stringify(notices[0]))
}

console.log('\n[4] user types /name (skill-invocation source)')
notices.length = 0
{
  const s = session('s2')
  start(s, 7)
  say(s, { kind: 'skill-invocation', name: 'h3-prompt-writing', form: 'instructions' })
  end(s, 7)
  ok('a /name turn is reported at all', notices.length === 1, JSON.stringify(notices))
  ok('body marks it 你手动 /', notices[0]?.body === 'h3-prompt-writing（你手动 /）', JSON.stringify(notices[0]))
}

console.log('\n[5] both channels in one turn, deduplicated')
notices.length = 0
{
  const s = session('s2')
  start(s, 8)
  say(s, { kind: 'skill-invocation', name: 'h3-prompt-writing', form: 'instructions' })
  skillCall(s, 'gpt-image')
  skillCall(s, 'gpt-image')
  end(s, 8)
  ok('one notification, skill order preserved, dedup applied',
    notices.length === 1 && notices[0]?.body === 'h3-prompt-writing（你手动 /）、gpt-image（模型自动）',
    JSON.stringify(notices))
}

console.log('\n[6] a turn that invoked nothing')
notices.length = 0
{
  const s = session('s3')
  start(s, 1)
  say(s, { kind: 'user' })
  end(s, 1)
  ok('negative report fires', notices.length === 1, JSON.stringify(notices))
  ok('negative copy is exact',
    notices[0]?.title === '本轮未调用 skill（没有技能的一轮）'
    && notices[0]?.body === '本轮对话没有加载任何 skill。',
    JSON.stringify(notices[0]))
}

console.log('\n[7] failed turn still reports')
notices.length = 0
{
  const s = session('s1')
  start(s, 2)
  say(s, { kind: 'user' })
  skillCall(s, 'gpt-image')
  end(s, 2, 'error')
  ok('turn/end reason=error still reports', notices.length === 1, JSON.stringify(notices))
  end(s, 2, 'max-tokens')
  ok('a second turn/end for the same turn is ignored', notices.length === 1, JSON.stringify(notices))
}

console.log('\n[8] subagent sessions stay silent')
notices.length = 0
{
  const s = session('sub-1', 'subagent')
  start(s, 1)
  say(s, { kind: 'user' })
  skillCall(s, 'gpt-image')
  end(s, 1)
  ok('no notification for a subagent turn', notices.length === 0, JSON.stringify(notices))
}

console.log('\n[9] background / non-user turns stay silent')
notices.length = 0
{
  const s = session('bg-1')
  start(s, 1)
  skillCall(s, 'gpt-image')
  end(s, 1)
  ok('no notification when no human message opened the turn', notices.length === 0, JSON.stringify(notices))
}

console.log('\n[10] session/disposed clears turn state')
notices.length = 0
{
  const s = session('s3')
  start(s, 3)
  say(s, { kind: 'user' })
  ctx.emit('session/disposed', s)
  end(s, 3)
  ok('a disposed session leaves no pending turn', notices.length === 0, JSON.stringify(notices))
}

console.log('\n[11] notifyOnNoSkill: false')
{
  const quiet = makeContext()
  quiet.logger = { info: () => {}, warn: (m) => warns.push(String(m)) }
  plugin.apply(quiet, { notifyOnNoSkill: false })
  await settle()
  notices.length = 0
  const s = session('q1')
  quiet.emit('session/event', s, { type: 'turn/start', data: { turn: 1 } })
  quiet.emit('session/event', s, { type: 'user/message', data: { source: { kind: 'user' } } })
  quiet.emit('session/event', s, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
  ok('empty turn is not announced when the flag is off', notices.length === 0, JSON.stringify(notices))
}

console.log('\n[12] enabled: false')
{
  const off = makeContext()
  const logs = []
  off.logger = { info: (m) => logs.push(String(m)), warn: (m) => warns.push(String(m)) }
  notices.length = 0
  plugin.apply(off, { enabled: false })
  await settle()
  const s = session('off-1')
  off.emit('session/event', s, { type: 'turn/start', data: { turn: 1 } })
  off.emit('session/event', s, { type: 'user/message', data: { source: { kind: 'user' } } })
  off.emit('session/event', s, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
  ok('disabled plugin reports nothing', notices.length === 0, JSON.stringify(notices))
  ok('disabled plugin says so', logs.some((line) => line.includes('disabled by config')), logs.join(' | '))
}

console.log('\n[13] a mount failure must never escape apply()')
{
  const hostile = {
    logger: { warn: (m) => warns.push(String(m)) },
    inject() {
      throw new Error('simulated host API mismatch')
    },
  }
  let escaped = null
  try {
    plugin.apply(hostile, {})
  } catch (error) {
    escaped = error
  }
  ok('apply() swallowed the failure instead of killing the plugin tree', escaped === null, String(escaped))
  ok('the failure is visible in the host log',
    warns.some((line) => line.includes('mount failed, plugin disabled')),
    warns.join(' | '))
}

console.log('\n[14] notification failure is contained')
{
  const brittle = makeContext()
  brittle.logger = { info: () => {}, warn: (m) => warns.push(String(m)) }
  const runtime = brittle.get('desktopRuntime')
  runtime.notifyAttention = () => {
    throw new Error('simulated Electron failure')
  }
  plugin.apply(brittle, {})
  await settle()
  const s = session('b1')
  let escaped = null
  try {
    brittle.emit('session/event', s, { type: 'turn/start', data: { turn: 1 } })
    brittle.emit('session/event', s, { type: 'user/message', data: { source: { kind: 'user' } } })
    brittle.emit('session/event', s, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
  } catch (error) {
    escaped = error
  }
  ok('a throwing desktopRuntime does not break event dispatch', escaped === null, String(escaped))
  ok('the notification failure is logged',
    warns.some((line) => line.includes('notification failed')),
    warns.join(' | '))
}

console.log(`\nRESULT: ${pass}/${pass + fail} passed`)
if (fail > 0) process.exitCode = 1
