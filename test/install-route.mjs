// HTTP-level test of the skill install endpoint.
//
// `test/install.mjs` proves the engine; this proves the *route*: that it is
// mounted where it claims to be, that it speaks the documented protocol, that it
// refuses malformed input with the right code, and — most importantly — that it
// writes into a directory the test chose, so running the suite can never touch
// the real skills directory.
//
// The plugin is mounted for real. The only fake is the `connection` service,
// exactly as in test/http.mjs.

import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
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

class Sessions extends Service {
  constructor(ctx) {
    super(ctx, 'sessions')
  }
}

/** Records Fetch routes instead of serving them; the handlers themselves are real. */
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
 * Mirrors the real skill provider: one skill per directory, named from the
 * directory name, with a path the host can read `meta.yaml` from.
 *
 * Without this the state feed reports an empty catalogue — this deployment has no
 * global skill provider — so the rename round trip could only be asserted against
 * the filesystem, never through the feed the panel actually reads.
 */
class Skills extends Service {
  constructor(ctx, root) {
    super(ctx, 'skills')
    this.root = root
  }
  async snapshot() {
    let entries = []
    try {
      entries = readdirSync(this.root, { withFileTypes: true }).filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    } catch {
      return { complete: true, skills: [] }
    }
    return {
      complete: true,
      skills: entries.map((entry) => ({
        name: entry.name,
        description: 'from disk',
        path: join(this.root, entry.name, 'SKILL.md'),
      })),
    }
  }
}

/** Mount the plugin against an isolated skills root and hand back its routes. */
async function mountPlugin(config = {}) {
  const sandbox = mkdtempSync(join(tmpdir(), 'echocat-route-'))
  const ctx = new Context()
  new Sessions(ctx)
  const connection = new Connection(ctx)
  const warns = []
  ctx.logger = { info: () => {}, warn: (message) => warns.push(String(message)) }
  plugin.apply(ctx, { skillsRoot: join(sandbox, 'skills'), backupRoot: join(sandbox, 'backups'), ...config })
  await settle()
  const byPath = new Map(connection.routes.map((route) => [route.path, route]))
  return { sandbox, ctx, connection, warns, byPath }
}

const jsonPost = (route, body) =>
  route.fetch(
    new Request('http://dsh.internal' + route.path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  )

const md = (name, description) => `---\nname: ${name}\ndescription: ${JSON.stringify(description)}\n---\n\n# ${name}\n\nBody.\n`

/* ------------------------------------------------------------ [1] mounting -- */

console.log('\n[1] the endpoint is mounted where it claims to be')
const main = await mountPlugin()
ok('mounting raised no warning', main.warns.length === 0, main.warns.join(' | '))
const route = main.byPath.get(plugin.DEFAULT_INSTALL_PATH)
ok('the endpoint exists at the documented path', route !== undefined, JSON.stringify([...main.byPath.keys()]))
ok('it lives under the authenticated /api prefix', route.path.startsWith('/api/'), route?.path)
ok('GET and POST are accepted', JSON.stringify([...route.methods]) === JSON.stringify(['GET', 'POST']), JSON.stringify(route?.methods))
ok('the body mode is declared', route.requestBody === 'buffered', String(route?.requestBody))
ok('an installer instance is exposed on the state feed too', main.byPath.has(plugin.DEFAULT_HTTP_PATH))

console.log('\n[2] GET describes the capability without writing')
const capabilityResponse = await route.fetch(new Request('http://dsh.internal' + route.path))
const capability = await capabilityResponse.json()
ok('GET answers 200', capabilityResponse.status === 200, String(capabilityResponse.status))
ok('it reports the isolated root', capability.capability.root === join(main.sandbox, 'skills'), capability.capability?.root)
ok('it reports the root as writable', capability.capability.writable === true)
ok('it advertises every mode, with `auto` first', capability.capability.modes[0] === 'auto' && capability.capability.modes.length === 5, JSON.stringify(capability.capability?.modes))
ok('the git probe is reported as a tri-state', capability.capability.git === undefined || typeof capability.capability.git === 'boolean', String(capability.capability?.git))
ok('the response is not cached', capabilityResponse.headers.get('cache-control') === 'no-store')
ok('an empty install history is reported', Array.isArray(capability.history) && capability.history.length === 0)
ok('no skills are listed yet', Array.isArray(capability.skills) && capability.skills.length === 0)
ok('nothing was written by the GET', readdirSync(join(main.sandbox, 'skills')).length === 0, JSON.stringify(readdirSync(join(main.sandbox, 'skills'))))

/* ------------------------------------------------------------- [3] install -- */

console.log('\n[3] a POST installs, and reports what it did')
const installed = await jsonPost(route, { action: 'install', mode: 'text', text: md('route-skill', '从接口安装') })
const installedBody = await installed.json()
ok('the install answers 200', installed.status === 200, `${installed.status} ${JSON.stringify(installedBody)}`)
ok('the payload says ok', installedBody.ok === true, JSON.stringify(installedBody.error ?? {}))
ok('the skill name is echoed', installedBody.skill?.name === 'route-skill', installedBody.skill?.name)
ok('the description is echoed', installedBody.skill?.description === '从接口安装')
ok('it did not claim to overwrite', installedBody.overwritten === false)
ok('the file exists in the isolated root', existsSync(join(main.sandbox, 'skills', 'route-skill', 'SKILL.md')))
ok('the written file carries the frontmatter', readFileSync(join(main.sandbox, 'skills', 'route-skill', 'SKILL.md'), 'utf8').includes('name: route-skill'))
ok('the response carries the refreshed catalog', Array.isArray(installedBody.skills) && installedBody.skills.some((s) => s.name === 'route-skill'))
ok('the capability rides along', installedBody.capability?.root === join(main.sandbox, 'skills'))
ok('the response content-type is JSON', String(installed.headers.get('content-type')).includes('application/json'))

console.log('\n[4] the state feed reflects the install')
const stateResponse = await main.byPath.get(plugin.DEFAULT_HTTP_PATH).fetch(new Request('http://dsh.internal/api/skill-report/state'))
const state = await stateResponse.json()
ok('the state feed still answers 200', stateResponse.status === 200)
ok('it carries a capability block', state.capability?.root === join(main.sandbox, 'skills'), JSON.stringify(state.capability))
ok('it carries an install history', Array.isArray(state.installHistory) && state.installHistory.length >= 1, JSON.stringify(state.installHistory))
ok('the history records the action and the name', state.installHistory[0].action === 'install' && state.installHistory[0].name === 'route-skill', JSON.stringify(state.installHistory[0]))
ok('the history records success', state.installHistory[0].ok === true)

/* -------------------------------------------------------------- [5] errors -- */

console.log('\n[5] failures come back with a code the UI can branch on')
const taken = await jsonPost(route, { action: 'install', mode: 'text', text: md('route-skill', 'again') })
const takenBody = await taken.json()
ok('a taken name answers 409', taken.status === 409, String(taken.status))
ok('the code is NAME_TAKEN', takenBody.error?.code === 'NAME_TAKEN', JSON.stringify(takenBody.error))
ok('the error carries an actionable hint', typeof takenBody.error?.hint === 'string' && takenBody.error.hint.length > 0, takenBody.error?.hint)
ok('the catalog still comes back on failure', Array.isArray(takenBody.skills))

const overwritten = await jsonPost(route, { action: 'install', mode: 'text', text: md('route-skill', 'replaced'), overwrite: true })
const overwrittenBody = await overwritten.json()
ok('overwrite:true replaces it', overwrittenBody.ok === true && overwrittenBody.overwritten === true, JSON.stringify(overwrittenBody.error ?? {}))
ok('the previous copy was backed up', typeof overwrittenBody.backup === 'string' && existsSync(overwrittenBody.backup), String(overwrittenBody.backup))

const badName = await jsonPost(route, { action: 'install', mode: 'text', text: md('Good Name', 'x'), name: 'Good Name' })
const badNameBody = await badName.json()
ok('an illegal name answers 400', badName.status === 400, String(badName.status))
ok('the code is INVALID_NAME', badNameBody.error?.code === 'INVALID_NAME', JSON.stringify(badNameBody.error))

const traversal = await jsonPost(route, { action: 'install', mode: 'text', text: md('x', 'x'), name: '../../escape' })
const traversalBody = await traversal.json()
ok('a traversal name is refused', traversalBody.ok === false && traversalBody.error.code === 'INVALID_NAME', JSON.stringify(traversalBody.error))
ok('nothing was written outside the root', !existsSync(join(main.sandbox, 'escape')))

const brokenJson = await jsonPost(route, '{not json')
const brokenBody = await brokenJson.json()
ok('malformed JSON answers 400', brokenJson.status === 400, String(brokenJson.status))
ok('the code is BAD_REQUEST', brokenBody.error?.code === 'BAD_REQUEST', JSON.stringify(brokenBody.error))

const arrayBody = await jsonPost(route, '[1,2,3]')
const arrayBodyJson = await arrayBody.json()
ok('a non-object body is refused', arrayBody.status === 400 && arrayBodyJson.error.code === 'BAD_REQUEST', JSON.stringify(arrayBodyJson.error))

const unknown = await jsonPost(route, { action: 'destroy-everything' })
const unknownBody = await unknown.json()
ok('an unknown action is refused', unknown.status === 400 && unknownBody.error.code === 'BAD_REQUEST', JSON.stringify(unknownBody.error))

const tooBig = await jsonPost(route, { action: 'install', mode: 'text', text: 'x'.repeat(600 * 1024) })
const tooBigBody = await tooBig.json()
ok('an oversized body answers 413', tooBig.status === 413, String(tooBig.status))
ok('the code is TOO_LARGE', tooBigBody.error?.code === 'TOO_LARGE', JSON.stringify(tooBigBody.error))

const privateUrl = await jsonPost(route, { action: 'install', mode: 'url', url: 'http://127.0.0.1/x.md' })
const privateBody = await privateUrl.json()
ok('a loopback URL is refused at the route', privateBody.ok === false && privateBody.error.code === 'BAD_REQUEST', JSON.stringify(privateBody.error))

/* ----------------------------------------------------------- [6] preview -- */

console.log('\n[6] preview reports without writing')
const preview = await jsonPost(route, { action: 'preview', mode: 'text', text: md('previewed', '只看不装') })
const previewBody = await preview.json()
ok('the preview answers 200', preview.status === 200, `${preview.status}`)
ok('it reports the parsed name', previewBody.preview?.name === 'previewed', JSON.stringify(previewBody.preview))
ok('it reports that the name is free', previewBody.preview?.exists === false)
ok('nothing was written', !existsSync(join(main.sandbox, 'skills', 'previewed')))

/* --------------------------------------------------------- [7] uninstall -- */

console.log('\n[7] uninstall needs a confirmation')
const unconfirmed = await jsonPost(route, { action: 'uninstall', name: 'route-skill' })
const unconfirmedBody = await unconfirmed.json()
ok('an unconfirmed delete answers 400', unconfirmed.status === 400, String(unconfirmed.status))
ok('the code is NEEDS_CONFIRM', unconfirmedBody.error?.code === 'NEEDS_CONFIRM', JSON.stringify(unconfirmedBody.error))
ok('the skill is still on disk', existsSync(join(main.sandbox, 'skills', 'route-skill')))

const confirmed = await jsonPost(route, { action: 'uninstall', name: 'route-skill', confirm: true })
const confirmedBody = await confirmed.json()
ok('a confirmed delete succeeds', confirmedBody.ok === true, JSON.stringify(confirmedBody.error ?? {}))
ok('the directory is gone', !existsSync(join(main.sandbox, 'skills', 'route-skill')))
ok('a backup was kept', existsSync(join(confirmedBody.backup, 'SKILL.md')), String(confirmedBody.backup))

/* ----------------------------------------------------------- [7c] rename -- */

console.log('\n[7c] the display name can be changed after the install')
// A fresh mount with a skill provider attached, so the state feed can be read back:
// the round trip that matters is "rename lands on disk AND the feed the panel reads
// reports it", not merely that the file changed.
const ren = await mountPlugin({ translateMissing: false })
new Skills(ren.ctx, join(ren.sandbox, 'skills'))
await settle()
const renRoute = ren.byPath.get(plugin.DEFAULT_INSTALL_PATH)
const renFeed = ren.byPath.get(plugin.DEFAULT_HTTP_PATH)
const renMeta = join(ren.sandbox, 'skills', 'ren-demo', 'meta.yaml')
const readMeta = () => (existsSync(renMeta) ? readFileSync(renMeta, 'utf8') : '')

const seeded = await jsonPost(renRoute, { action: 'install', mode: 'text', text: md('ren-demo', 'rename me'), displayNameZh: '旧中文名' })
const seededBody = await seeded.json()
ok('the skill installs with a display name', seededBody.ok === true && seededBody.skill?.displayNameZh === '旧中文名', JSON.stringify(seededBody.error ?? seededBody.skill))
ok('meta.yaml holds only that key, so clearing can remove the file', readMeta().trim() === 'display-name-zh: 旧中文名', JSON.stringify(readMeta()))

const renamed = await jsonPost(renRoute, { action: 'rename', name: 'ren-demo', displayNameZh: '新中文名' })
const renamedBody = await renamed.json()
ok('the rename answers 200', renamed.status === 200, `${renamed.status} ${JSON.stringify(renamedBody.error ?? {})}`)
ok('it reports ok', renamedBody.ok === true, JSON.stringify(renamedBody.error ?? {}))
ok('it echoes the new value', renamedBody.skill?.displayNameZh === '新中文名', JSON.stringify(renamedBody.skill))
ok('meta.yaml now carries the new value', readMeta().includes('display-name-zh: 新中文名'), JSON.stringify(readMeta()))

const afterRename = await (await renFeed.fetch(new Request('http://dsh.internal/api/skill-report/state'))).json()
const renamedEntry = (afterRename.skills ?? []).find((skill) => skill.name === 'ren-demo')
ok('the state feed lists the renamed skill', renamedEntry !== undefined, JSON.stringify(afterRename.skills))
ok('...with the new display name — the round trip the panel depends on', renamedEntry?.displayNameZh === '新中文名', JSON.stringify(renamedEntry))

const unknownRename = await jsonPost(renRoute, { action: 'rename', name: 'no-such-skill', displayNameZh: 'x' })
const unknownRenameBody = await unknownRename.json()
ok('renaming an unknown slug answers 404', unknownRename.status === 404, String(unknownRename.status))
ok('the code is NOT_FOUND', unknownRenameBody.error?.code === 'NOT_FOUND', JSON.stringify(unknownRenameBody.error))

const longRename = await jsonPost(renRoute, { action: 'rename', name: 'ren-demo', displayNameZh: '字'.repeat(41) })
const longRenameBody = await longRename.json()
ok('an over-long value answers 400', longRename.status === 400, `${longRename.status} ${JSON.stringify(longRenameBody.error)}`)
ok('the code is BAD_REQUEST', longRenameBody.error?.code === 'BAD_REQUEST', JSON.stringify(longRenameBody.error))
// A refused rename must leave the file exactly as it was.
ok('the previous value survives the refusal', readMeta().includes('display-name-zh: 新中文名'), JSON.stringify(readMeta()))
ok('...and left no temporary file behind', readdirSync(join(ren.sandbox, 'skills', 'ren-demo')).sort().join(',') === 'SKILL.md,meta.yaml', readdirSync(join(ren.sandbox, 'skills', 'ren-demo')).sort().join(','))

const cleared = await jsonPost(renRoute, { action: 'rename', name: 'ren-demo', displayNameZh: '' })
const clearedBody = await cleared.json()
ok('clearing answers 200', cleared.status === 200, String(cleared.status))
ok('it reports ok and echoes the empty value', clearedBody.ok === true && clearedBody.skill?.displayNameZh === '', JSON.stringify(clearedBody.skill))
ok('the file is removed once its only key is gone', !existsSync(renMeta), JSON.stringify(readMeta()))

const afterClear = await (await renFeed.fetch(new Request('http://dsh.internal/api/skill-report/state'))).json()
const clearedEntry = (afterClear.skills ?? []).find((skill) => skill.name === 'ren-demo')
ok('the feed reports no display name afterwards', clearedEntry !== undefined && clearedEntry.displayNameZh === '', JSON.stringify(clearedEntry))

/* ---------------------------------------------------------- [8] toggles -- */

console.log('\n[7b] the Chinese display name travels over the route')
const zhPost = await jsonPost(route, { action: 'install', mode: 'text', text: md('route-zh', 'from the route'), displayNameZh: '路由中文名' })
const zhBody = await zhPost.json()
ok('the install succeeded', zhBody.ok === true, JSON.stringify(zhBody.error ?? {}))
ok('the response echoes the name', zhBody.skill?.displayNameZh === '路由中文名', JSON.stringify(zhBody.skill))
ok('meta.yaml is on disk in the isolated root', existsSync(join(main.sandbox, 'skills', 'route-zh', 'meta.yaml')))
ok('and it carries the value', readFileSync(join(main.sandbox, 'skills', 'route-zh', 'meta.yaml'), 'utf8').includes('display-name-zh: 路由中文名'))
const zhLong = await jsonPost(route, { action: 'install', mode: 'text', text: md('route-long', 'x'), displayNameZh: '字'.repeat(41) })
const zhLongBody = await zhLong.json()
ok('an over-long name answers 400', zhLong.status === 400, `${zhLong.status} ${JSON.stringify(zhLongBody.error)}`)
ok('the code is BAD_REQUEST', zhLongBody.error?.code === 'BAD_REQUEST', JSON.stringify(zhLongBody.error))
ok('nothing was written for it', !existsSync(join(main.sandbox, 'skills', 'route-long')))

console.log('\n[8] configuration can remove the write surface')
const readOnly = await mountPlugin({ allowInstall: false })
ok('no install route is registered', readOnly.byPath.get(plugin.DEFAULT_INSTALL_PATH) === undefined, JSON.stringify([...readOnly.byPath.keys()]))
ok('the state feed still works', readOnly.byPath.has(plugin.DEFAULT_HTTP_PATH))
const readOnlyState = await readOnly.byPath.get(plugin.DEFAULT_HTTP_PATH).fetch(new Request('http://dsh.internal/api/skill-report/state'))
const readOnlyBody = await readOnlyState.json()
ok('its capability says install is off', readOnlyBody.capability?.install === false, JSON.stringify(readOnlyBody.capability))
ok('and it says why', readOnlyBody.capability?.reason === 'disabled by config', String(readOnlyBody.capability?.reason))
ok('no history is exposed when install is off', JSON.stringify(readOnlyBody.installHistory) === '[]')

const noRoutes = await mountPlugin({ httpRoute: false })
ok('httpRoute:false registers nothing at all', noRoutes.connection.routes.length === 0, JSON.stringify(noRoutes.connection.routes.map((r) => r.path)))

const badPath = await mountPlugin({ installPath: '/not-api/skills' })
ok('an install path outside /api is ignored', badPath.byPath.get(plugin.DEFAULT_INSTALL_PATH) !== undefined, JSON.stringify([...badPath.byPath.keys()]))
ok('and it did not take the bad path', badPath.byPath.get('/not-api/skills') === undefined)

console.log('\n[9] cleanup')
for (const mounted of [main, ren, readOnly, noRoutes, badPath]) rmSync(mounted.sandbox, { recursive: true, force: true })
ok('every sandbox was removed', !existsSync(main.sandbox) && !existsSync(readOnly.sandbox) && !existsSync(ren.sandbox))

console.log(`\nRESULT: ${pass}/${pass + fail} passed`)
if (fail > 0) process.exit(1)
