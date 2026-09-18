// Unit tests for the dependency-free halves: the turn tracker and the store.
// No cordis, no DOM, no React — these are the modules the browser half reuses.

import {
  createTurnTracker,
  describeTurn,
  skillNameFromToolCall,
  sessionIdOf,
  isSubagent,
  HOW_MODEL,
  HOW_USER,
} from '../src/detect.js'
import { createSkillReportStore } from '../src/store.js'

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
const eq = (label, actual, expected) =>
  ok(label, JSON.stringify(actual) === JSON.stringify(expected), `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`)

const session = (id, origin) => ({ header: { id, origin } })
const start = (turn) => ({ type: 'turn/start', data: { turn } })
const end = (turn, kind = 'completed') => ({ type: 'turn/end', data: { turn, reason: { kind } } })
const userMsg = (source) => ({ type: 'user/message', data: { source } })
const skillCall = (name) => ({ type: 'tool/call', data: { name: 'skill', arguments: JSON.stringify({ name }) } })
const otherCall = () => ({ type: 'tool/call', data: { name: 'bash', arguments: '{}' } })

console.log('\n[1] skillNameFromToolCall')
eq('plain JSON', skillNameFromToolCall('{"name":"gpt-image"}'), 'gpt-image')
eq('accepts .skill', skillNameFromToolCall('{"skill":"h3-prompt-writing"}'), 'h3-prompt-writing')
eq('accepts .skill_name', skillNameFromToolCall('{"skill_name":"papercraft-stop-motion-explainer"}'), 'papercraft-stop-motion-explainer')
eq('regex fallback on truncated JSON', skillNameFromToolCall('{"name":"gpt-image"'), 'gpt-image')
eq('rejects non-string', skillNameFromToolCall(undefined), undefined)
eq('rejects empty string', skillNameFromToolCall(''), undefined)
eq('rejects JSON without a name', skillNameFromToolCall('{"other":1}'), undefined)
eq('rejects empty name', skillNameFromToolCall('{"name":""}'), undefined)

console.log('\n[2] session helpers')
eq('sessionIdOf', sessionIdOf(session('abc')), 'abc')
eq('sessionIdOf on nothing', sessionIdOf(undefined), '')
eq('isSubagent true', isSubagent(session('s', 'subagent')), true)
eq('isSubagent false', isSubagent(session('s')), false)

console.log('\n[3] tracker — the two channels')
{
  const t = createTurnTracker()
  const s = session('s1')
  eq('turn/start is not a report', t.onEvent(s, start(1)), undefined)
  t.onEvent(s, userMsg({ kind: 'user' }))
  t.onEvent(s, skillCall('gpt-image'))
  eq('turn/end reports the model load',
    t.onEvent(s, end(1)),
    { turn: 1, reason: 'completed', calls: [{ name: 'gpt-image', how: HOW_MODEL }] })
  eq('state is cleared after the report', t.pending(), 0)
}
{
  const t = createTurnTracker()
  const s = session('s2')
  t.onEvent(s, start(1))
  t.onEvent(s, userMsg({ kind: 'skill-invocation', name: 'h3-prompt-writing' }))
  eq('a /name turn is user-initiated',
    t.onEvent(s, end(1)),
    { turn: 1, reason: 'completed', calls: [{ name: 'h3-prompt-writing', how: HOW_USER }] })
}
{
  const t = createTurnTracker()
  const s = session('s3')
  t.onEvent(s, start(1))
  t.onEvent(s, userMsg({ kind: 'user' }))
  t.onEvent(s, skillCall('gpt-image'))
  t.onEvent(s, skillCall('gpt-image'))
  eq('a repeated model load is deduplicated',
    t.onEvent(s, end(1)),
    { turn: 1, reason: 'completed', calls: [{ name: 'gpt-image', how: HOW_MODEL }] })
}
{
  const t = createTurnTracker()
  const s = session('s4')
  t.onEvent(s, start(1))
  t.onEvent(s, skillCall('gpt-image'))
  t.onEvent(s, userMsg({ kind: 'skill-invocation', name: 'gpt-image' }))
  eq('an explicit /name wins over a model load of the same skill',
    t.onEvent(s, end(1)),
    { turn: 1, reason: 'completed', calls: [{ name: 'gpt-image', how: HOW_USER }] })
}

console.log('\n[4] tracker — the filters')
{
  const t = createTurnTracker()
  const s = session('sub', 'subagent')
  t.onEvent(s, start(1))
  t.onEvent(s, userMsg({ kind: 'user' }))
  t.onEvent(s, skillCall('gpt-image'))
  eq('subagent turn is not reported', t.onEvent(s, end(1)), undefined)

  const t2 = createTurnTracker({ includeSubagents: true })
  const s2 = session('sub2', 'subagent')
  t2.onEvent(s2, start(1))
  t2.onEvent(s2, userMsg({ kind: 'user' }))
  eq('includeSubagents opts back in', t2.onEvent(s2, end(1))?.calls?.length, 0)
}
{
  const t = createTurnTracker()
  const s = session('bg')
  t.onEvent(s, start(1))
  t.onEvent(s, skillCall('gpt-image'))
  eq('a turn no human opened is not reported', t.onEvent(s, end(1)), undefined)
}
{
  const t = createTurnTracker()
  const s = session('x')
  t.onEvent(s, start(1))
  t.onEvent(s, userMsg({ kind: 'user' }))
  eq('a turn/end for a different turn number is ignored', t.onEvent(s, end(99)), undefined)
  eq('the real turn/end still reports', t.onEvent(s, end(1))?.turn, 1)
}
{
  const t = createTurnTracker()
  const s = session('y')
  t.onEvent(s, start(1))
  t.onEvent(s, userMsg({ kind: 'user' }))
  t.forget('y')
  eq('forget() drops the in-flight turn', t.onEvent(s, end(1)), undefined)
}
{
  const t = createTurnTracker()
  eq('events before any turn/start are ignored', t.onEvent(session('z'), skillCall('gpt-image')), undefined)
  eq('a null session is ignored', t.onEvent(null, start(1)), undefined)
  eq('a null event is ignored', t.onEvent(session('z'), null), undefined)
}
{
  const t = createTurnTracker()
  const a = session('a')
  const b = session('b')
  t.onEvent(a, start(1))
  t.onEvent(a, userMsg({ kind: 'user' }))
  t.onEvent(a, skillCall('gpt-image'))
  t.onEvent(b, start(1))
  t.onEvent(b, userMsg({ kind: 'user' }))
  t.onEvent(b, skillCall('h3-prompt-writing'))
  eq('two interleaved sessions stay separate', t.onEvent(b, end(1))?.calls?.[0]?.name, 'h3-prompt-writing')
  eq('...and the first one is still intact', t.onEvent(a, end(1))?.calls?.[0]?.name, 'gpt-image')
}
{
  const t = createTurnTracker()
  const s = session('r')
  t.onEvent(s, start(1))
  t.onEvent(s, userMsg({ kind: 'user' }))
  eq('a failed turn still carries its reason', t.onEvent(s, end(1, 'error'))?.reason, 'error')
}
{
  const t = createTurnTracker()
  const s = session('n')
  t.onEvent(s, start(1))
  t.onEvent(s, userMsg({ kind: 'user' }))
  t.onEvent(s, otherCall())
  eq('non-skill tool calls are ignored', t.onEvent(s, end(1))?.calls, [])
}

console.log('\n[5] describeTurn')
eq('positive', describeTurn('水彩测试', [{ name: 'gpt-image', how: HOW_MODEL }]), {
  used: true,
  count: 1,
  heading: '本轮调用了 skill（水彩测试）',
  body: 'gpt-image（模型自动）',
  skills: [{ name: 'gpt-image', how: HOW_MODEL }],
})
eq('two channels, order preserved', describeTurn('t', [
  { name: 'h3-prompt-writing', how: HOW_USER },
  { name: 'gpt-image', how: HOW_MODEL },
]).body, 'h3-prompt-writing（你手动 /）、gpt-image（模型自动）')
eq('negative', describeTurn('', []), {
  used: false,
  count: 0,
  heading: '本轮未调用 skill',
  body: '本轮对话没有加载任何 skill。',
  skills: [],
})
eq('no title means no suffix', describeTurn(undefined, [{ name: 'x', how: HOW_MODEL }]).heading, '本轮调用了 skill')
eq('tolerates a non-array', describeTurn('t', undefined).used, false)

console.log('\n[6] store — counters')
{
  let clock = 1000
  const store = createSkillReportStore({ now: () => (clock += 5) })
  store.record({ sessionId: 'a', sessionTitle: 'T1', calls: [{ name: 'gpt-image', how: 'model' }] })
  store.record({ sessionId: 'a', sessionTitle: 'T1', calls: [] })
  store.record({
    sessionId: 'b',
    sessionTitle: 'T2',
    calls: [{ name: 'gpt-image', how: 'user' }, { name: 'h3-prompt-writing', how: 'model' }],
  })
  const snap = store.snapshot()
  eq('turns', snap.turns, 3)
  eq('turnsWithSkills', snap.turnsWithSkills, 2)
  eq('turnsWithoutSkills', snap.turnsWithoutSkills, 1)
  eq('invocations', snap.invocations, 3)
  eq('perSkill sorted by count desc', snap.perSkill, [
    { name: 'gpt-image', count: 2 },
    { name: 'h3-prompt-writing', count: 1 },
  ])
  eq('recent is newest-first', snap.recent.map((r) => r.sessionId), ['b', 'a', 'a'])
  eq('lastAt tracks the newest record', typeof snap.lastAt, 'number')
}

console.log('\n[7] store — isolation and bounds')
{
  const snap = createSkillReportStore().snapshot()
  eq('empty snapshot shape', [snap.turns, snap.recent, snap.perSkill, snap.lastAt], [0, [], [], undefined])
}
{
  const store = createSkillReportStore({ maxRecent: 3 })
  for (let i = 0; i < 10; i += 1) store.record({ sessionId: `s${i}`, calls: [] })
  const snap = store.snapshot()
  eq('the ring is bounded', snap.recent.length, 3)
  eq('the ring keeps the newest', snap.recent.map((r) => r.sessionId), ['s9', 's8', 's7'])
  eq('counters are not bounded', snap.turns, 10)
}
{
  const store = createSkillReportStore()
  store.record({ sessionId: 'a', calls: [{ name: 'gpt-image', how: 'model' }] })
  const snap = store.snapshot()
  snap.recent[0].calls[0].name = 'MUTATED'
  snap.perSkill[0].count = 999
  const fresh = store.snapshot()
  eq('snapshot is a deep copy (calls)', fresh.recent[0].calls[0].name, 'gpt-image')
  eq('snapshot is a deep copy (perSkill)', fresh.perSkill[0].count, 1)
}
{
  const store = createSkillReportStore()
  store.record({ sessionId: 'a', calls: [{ name: 'x', how: 'nonsense' }] })
  eq('an unknown how normalizes to model', store.snapshot().recent[0].calls[0].how, 'model')
}

console.log('\n[8] store — subscription')
{
  const store = createSkillReportStore()
  let hits = 0
  const off = store.subscribe(() => { hits += 1 })
  store.record({ sessionId: 'a', calls: [] })
  eq('subscriber fires on record', hits, 1)
  off()
  store.record({ sessionId: 'b', calls: [] })
  eq('unsubscribe stops delivery', hits, 1)

  const store2 = createSkillReportStore()
  let boom = 0
  store2.subscribe(() => { throw new Error('broken observer') })
  store2.subscribe(() => { boom += 1 })
  store2.record({ sessionId: 'a', calls: [] })
  eq('a throwing observer does not break the others', boom, 1)

  const store3 = createSkillReportStore()
  let cleared = 0
  store3.subscribe(() => { cleared += 1 })
  store3.record({ sessionId: 'a', calls: [{ name: 'x', how: 'model' }] })
  store3.clear()
  eq('clear() notifies and resets', [cleared, store3.snapshot().turns], [2, 0])
}

console.log(`\nRESULT: ${pass}/${pass + fail} passed`)
if (fail > 0) process.exitCode = 1
