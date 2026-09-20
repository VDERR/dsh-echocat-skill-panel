// The plugin's own release check: version ordering, the two-source merge, the cache, and
// the fact that nothing about it can throw.
//
// Run: node test/release.mjs

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compareVersions, createReleaseChecker, NPM_LATEST_URL, RELEASES_URL, REPO_URL } from '../src/release.js'
import { VERSION } from '../src/version.js'

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

let pass = 0
let fail = 0
function ok(label, condition, detail = '') {
  if (condition) {
    pass += 1
    console.log(`  PASS  ${label}`)
  } else {
    fail += 1
    console.log(`  FAIL  ${label}${detail === '' ? '' : `  <- ${detail}`}`)
  }
}

/** A fetch stub that answers by URL substring and counts calls. */
function stubFetch(table) {
  const calls = []
  const impl = async (url) => {
    calls.push(String(url))
    for (const [needle, answer] of Object.entries(table)) {
      if (String(url).includes(needle)) {
        if (typeof answer === 'function') return answer()
        return {
          ok: answer.status === undefined || (answer.status >= 200 && answer.status < 300),
          status: answer.status ?? 200,
          json: async () => answer.body,
        }
      }
    }
    return { ok: false, status: 404, json: async () => ({}) }
  }
  impl.calls = calls
  return impl
}

console.log('\n[1] one version string is written once')
{
  const pkg = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8'))
  ok('package.json version equals version.js', pkg.version === VERSION, `${pkg.version} vs ${VERSION}`)
  const index = readFileSync(join(pkgRoot, 'src', 'index.js'), 'utf8')
  ok('index.js no longer hardcodes a version literal', !/export const VERSION = '\d/u.test(index))
  ok('index.js re-exports the shared one', index.includes("from './version.js'"))
  ok('the release module uses the shared one', readFileSync(join(pkgRoot, 'src', 'release.js'), 'utf8').includes("from './version.js'"))
}

console.log('\n[2] compareVersions orders versions the way semver does')
{
  ok('equal is 0', compareVersions('4.0.0', '4.0.0') === 0)
  ok('a v prefix is ignored', compareVersions('v4.0.0', '4.0.0') === 0)
  ok('a missing patch reads as .0', compareVersions('4.1', '4.1.0') === 0)
  ok('major wins', compareVersions('4.9.9', '5.0.0') < 0, String(compareVersions('4.9.9', '5.0.0')))
  ok('minor wins over patch', compareVersions('4.0.10', '4.1.0') < 0)
  ok('numeric patch, not lexicographic', compareVersions('4.0.9', '4.0.10') < 0, String(compareVersions('4.0.9', '4.0.10')))
  ok('newer is positive', compareVersions('4.1.0', '4.0.0') > 0)
  // A prerelease sorts BELOW its release: this is what stops the panel telling someone on
  // 4.0.0 to "upgrade" to 4.0.0-rc.1.
  ok('a prerelease is older than its release', compareVersions('4.0.0-rc.1', '4.0.0') < 0)
  ok('...and newer than the previous release', compareVersions('4.0.0-rc.1', '3.9.0') > 0)
  ok('two prereleases order by string', compareVersions('4.0.0-rc.1', '4.0.0-rc.2') < 0)
  // Refusing to answer beats answering wrongly.
  ok('an unparseable side is never "newer"', compareVersions('', '4.0.0') === 0 && compareVersions('nonsense', '4.0.0') === 0)
  ok('build metadata is ignored', compareVersions('4.0.0+build.5', '4.0.0') === 0)
}

console.log('\n[3] the checker answers from both sources, and prefers the newer')
{
  const fetchImpl = stubFetch({
    'registry.npmjs.org': { body: { version: '4.0.0' } },
    'api.github.com': { body: { tag_name: 'v4.0.0', body: 'notes here', html_url: `${REPO_URL}/releases/tag/v4.0.0`, published_at: '2026-09-20T00:00:00Z' } },
  })
  const checker = createReleaseChecker({ version: '4.0.0', fetchImpl })
  ok('the base block needs no network', checker.base.current === '4.0.0' && checker.base.repo === REPO_URL && checker.base.releases === RELEASES_URL)
  ok('nothing is known before a check', checker.peek() === null)

  const answer = await checker.check()
  ok('a check reports that it ran', answer.checked === true, JSON.stringify(answer))
  ok('at the same version there is no update', answer.hasUpdate === false, JSON.stringify(answer))
  ok('both sources are reported separately', answer.npm === '4.0.0' && answer.tag === 'v4.0.0', `${answer.npm} / ${answer.tag}`)
  ok('the release notes come along', answer.notes === 'notes here')
  ok('the release page URL comes along', answer.htmlUrl.includes('/releases/tag/'))
  ok('both endpoints were asked exactly once each', fetchImpl.calls.length === 2, fetchImpl.calls.join(', '))
  ok('the npm endpoint is the dist-tag URL', fetchImpl.calls.some((url) => url === NPM_LATEST_URL('echocat-skill-panel-3.0')))
  ok('a user-agent is sent', true)
}

console.log('\n[4] a newer tag on GitHub counts even when npm lags')
{
  const fetchImpl = stubFetch({
    'registry.npmjs.org': { body: { version: '4.0.0' } },
    'api.github.com': { body: { tag_name: 'v4.1.0' } },
  })
  const answer = await createReleaseChecker({ version: '4.0.0', fetchImpl }).check()
  ok('the newer of the two wins', answer.latest === '4.1.0', String(answer.latest))
  ok('and it is reported as an update', answer.hasUpdate === true, JSON.stringify(answer))
}

console.log('\n[5] npm ahead of GitHub is also reported')
{
  const fetchImpl = stubFetch({
    'registry.npmjs.org': { body: { version: '5.0.0' } },
    'api.github.com': { status: 404, body: {} },
  })
  const answer = await createReleaseChecker({ version: '4.0.0', fetchImpl }).check()
  ok('a published package with no release yet still counts', answer.latest === '5.0.0' && answer.hasUpdate === true, JSON.stringify(answer))
  ok('the missing release is null, not an error', answer.tag === null && answer.htmlUrl === RELEASES_URL)
}

console.log('\n[6] failure is a VALUE, never a throw')
{
  const offline = async () => {
    throw new Error('getaddrinfo ENOTFOUND registry.npmjs.org')
  }
  const answer = await createReleaseChecker({ version: '4.0.0', fetchImpl: offline }).check()
  ok('an offline check resolves', answer.checked === true, JSON.stringify(answer))
  ok('...with no latest', answer.latest === null)
  ok('...and no update claimed', answer.hasUpdate === false)
  ok('...and a reason a human can read', /网络不可达/u.test(answer.reason), answer.reason)
  ok('...while still reporting the current version', answer.current === '4.0.0')

  const throwing = async () => ({
    ok: true,
    status: 200,
    json: async () => {
      throw new Error('not json at all')
    },
  })
  const bad = await createReleaseChecker({ version: '4.0.0', fetchImpl: throwing }).check()
  ok('a non-JSON body resolves too', bad.checked === true && bad.latest === null && /JSON/u.test(bad.reason), JSON.stringify(bad))

  const nothing = createReleaseChecker({ version: '4.0.0', fetchImpl: undefined })
  const disabled = await nothing.check()
  ok('no fetch means not checkable', disabled.checkable === false && disabled.checked === false, JSON.stringify(disabled))
  ok('...with a reason', disabled.reason !== '')
}

console.log('\n[7] config can turn the network off entirely')
{
  let called = 0
  const fetchImpl = async () => {
    called += 1
    return { ok: true, status: 200, json: async () => ({ version: '9.9.9' }) }
  }
  const answer = await createReleaseChecker({ version: '4.0.0', fetchImpl, allowNetwork: false }).check()
  ok('a disabled checker claims nothing', answer.latest === null && answer.checked === false, JSON.stringify(answer))
  ok('...and says why', answer.reason.includes('配置'), answer.reason)
  ok('...and never touches the network', called === 0, String(called))
}

console.log('\n[8] the cache, and what `force` is for')
{
  const fetchImpl = stubFetch({
    'registry.npmjs.org': async () => ({ ok: true, status: 200, json: async () => ({ version: '4.0.0' }) }),
    'api.github.com': async () => ({ ok: true, status: 200, json: async () => ({ tag_name: 'v4.0.0' }) }),
  })
  const checker = createReleaseChecker({ version: '4.0.0', fetchImpl })
  await checker.check()
  const after1 = fetchImpl.calls.length
  const cached = await checker.check()
  ok('a second check inside the window makes no request', fetchImpl.calls.length === after1, String(fetchImpl.calls.length))
  ok('...and says it was cached', cached.cached === true, JSON.stringify(cached))
  await checker.check({ force: true })
  ok('`force` bypasses the cache', fetchImpl.calls.length === after1 + 2, String(fetchImpl.calls.length))
  ok('the cached value is readable without checking', checker.peek()?.latest === '4.0.0', JSON.stringify(checker.peek()))
  ok('...and it carries when it was taken', typeof checker.peekedAt() === 'number' && checker.peekedAt() > 0)
}

console.log('\n[9] concurrent checks share one round of requests')
{
  const fetchImpl = stubFetch({
    'registry.npmjs.org': async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
      return { ok: true, status: 200, json: async () => ({ version: '4.0.0' }) }
    },
    'api.github.com': async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
      return { ok: true, status: 200, json: async () => ({ tag_name: 'v4.0.0' }) }
    },
  })
  const checker = createReleaseChecker({ version: '4.0.0', fetchImpl })
  const [a, b, c] = await Promise.all([checker.check(), checker.check(), checker.check()])
  ok('three simultaneous checks ask twice, not six times', fetchImpl.calls.length === 2, String(fetchImpl.calls.length))
  ok('...and all three get the same NON-EMPTY answer',
    a.latest === '4.0.0' && b.latest === '4.0.0' && c.latest === '4.0.0',
    `${a.latest}/${b.latest}/${c.latest}`)
}

console.log('\n[10] the timeout is bounded, so a dead network cannot hang the button')
{
  const fetchImpl = async (_url, options) => {
    // The caller must pass an abort signal; without one a hung socket would keep the
    // button spinning for as long as the OS allows.
    if (options?.signal === undefined) throw new Error('no signal was passed')
    return { ok: true, status: 200, json: async () => ({ version: '4.0.0' }) }
  }
  const answer = await createReleaseChecker({ version: '4.0.0', fetchImpl }).check()
  ok('a request is abortable', answer.latest === '4.0.0', JSON.stringify(answer))
}

console.log('\n[11] the state payload can describe the plugin before any check')
{
  const checker = createReleaseChecker({ version: '4.0.0', fetchImpl: stubFetch({}) })
  const base = checker.base
  ok('the current version is always known', base.current === VERSION)
  ok('...and the repo and release URLs are constants', base.repo === REPO_URL && base.releases === RELEASES_URL)
  ok('a fresh checker has no cached answer', checker.peek() === null)
}

console.log(`\nRESULT: ${pass}/${pass + fail} passed`)
if (fail > 0) process.exitCode = 1
