// Assert the four names that DSH needs to agree, plus the rest of the release preconditions.
//
// One string has to be simultaneously the npm package name, the directory name, the bundle patch's
// entry name and the vendor directory name — DSH resolves the plugin by it, so if they disagree the
// plugin does not load at all and the failure looks like "the plugin is missing" rather than a rename
// mistake. Run: node tools/check-identity.mjs
import { readFileSync, existsSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const EXPECTED = 'echocat-skill-panel'

const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const patch = readFileSync(join(root, 'cordis.patch.yml'), 'utf8')
const bundle = readFileSync(join(root, 'lib', 'client.js'), 'utf8')

const found = [
  ['package.json name', manifest.name],
  ['directory name', basename(root)],
  ['patch entry name', /\n\s*name: '([^']+)'/u.exec(patch)?.[1]],
  ['client bundle id', /id: "([^"]+)"/u.exec(bundle)?.[1]],
]

let failures = 0
const check = (label, ok, detail) => {
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${label}${detail === undefined ? '' : `   ${detail}`}`)
  if (!ok) failures += 1
}

console.log('=== the four names DSH needs to agree ===')
for (const [label, value] of found) check(label, value === EXPECTED, String(value))

console.log('\n=== the hard constraints from the plugin contract ===')
check('package.json keeps dsh.bundle.patch', manifest.dsh?.bundle?.patch === './cordis.patch.yml', JSON.stringify(manifest.dsh?.bundle))
check('...and the patch file exists', existsSync(join(root, 'cordis.patch.yml')))
check('dsh.client.platform is still "web"', manifest.dsh?.client?.platform === 'web', JSON.stringify(manifest.dsh?.client))
check('exports["./client"] points at a real file',
  existsSync(join(root, manifest.exports?.['./client'] ?? 'missing')),
  String(manifest.exports?.['./client']))
check('the client artifact is built', existsSync(join(root, 'lib', 'client.js')))
check('the install script is named for the package, without a version',
  existsSync(join(root, '\u5b89\u88c5.ps1')))

console.log('\n=== nothing still refers to the old name ===')
const OLD = 'echocat-skill-panel-3.0'
const stale = []
for (const file of ['package.json', 'cordis.patch.yml', 'README.md', '\u5b89\u88c5\u8bf4\u660e.md', 'src/index.js', 'src/release.js', 'lib/client.js']) {
  if (readFileSync(join(root, file), 'utf8').includes(OLD)) stale.push(file)
}
check('no source file mentions the old name', stale.length === 0, stale.join(', ') || 'clean')

console.log(`\nRESULT: ${failures === 0 ? 'identity is consistent' : `${failures} problem(s)`}`)
if (failures > 0) process.exitCode = 1
