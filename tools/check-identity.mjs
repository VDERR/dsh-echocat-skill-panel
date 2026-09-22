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
const EXPECTED = 'dsh-echocat-skill-panel'

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
/**
 * THE OLD NAME IS A SUBSTRING OF THE NEW ONE — `dsh-echocat-skill-panel` contains `echocat-skill-panel` — so a plain
 * `includes` cannot be used in either direction: searching for the new name matches the old one's occurrences, and
 * searching for the old one matches the new one's.
 *
 * The check is therefore a negative lookbehind: an occurrence of `echocat-skill-panel` that is NOT preceded by `dsh-`.
 * That is the only form that distinguishes a leftover reference from the package's own current name.
 *
 * This constant previously held the previous-generation name, and a rename pass rewrote it too — which left the guard
 * verifying that nothing mentioned a package that has never existed, so it passed while genuinely stale references
 * remained elsewhere.
 */
/**
 * ALLOWED OCCURRENCES OF THE PRE-RENAME NAME, each with a reason. Anything else is a leftover.
 *
 * Listing exceptions explicitly rather than skipping whole files is the point: a skipped file silently stops being checked,
 * while a named exception has to be justified and shows up in the output.
 */
const ALLOWED = [
  {
    file: '\u5b89\u88c5\u8bf4\u660e.md',
    // The upgrade instructions. Naming the old packages is the whole content of the section — you cannot tell someone
    // which stale `bundles` entry to delete without printing its name.
    match: /(?<!dsh-)echocat-skill-panel-3\.0/u,
    why: 'upgrade instructions must name the old packages',
  },
  {
    file: '\u5b89\u88c5\u8bf4\u660e.md',
    match: /\[`(?<!dsh-)echocat-skill-panel`\]/u,
    why: 'the list of names to purge',
  },
  {
    file: 'lib/client.js',
    // A storage key, not an identity: the IndexedDB holding the user's background settings AND their locally stored image.
    // Renaming it orphans both, with no error — see src/client/background-store.js.
    match: /(?<!dsh-)echocat-skill-panel-appearance-v1/u,
    why: 'persisted appearance database: renaming it discards the user\'s saved background and image',
  },
]

const OLD_NAME = /(?<!dsh-)echocat-skill-panel/u
const stale = []
const explained = []
for (const file of ['package.json', 'cordis.patch.yml', 'README.md', '\u5b89\u88c5\u8bf4\u660e.md', 'src/index.js', 'src/release.js', 'lib/client.js']) {
  const text = readFileSync(join(root, file), 'utf8')
  const found = OLD_NAME.exec(text)
  if (found === null) continue
  const exception = ALLOWED.find((rule) => rule.file === file && rule.match.test(text))
  const context = JSON.stringify(text.slice(Math.max(0, found.index - 24), found.index + 34))
  if (exception === undefined) stale.push(`${file} @${found.index}: ${context}`)
  else explained.push(`${file}: ${exception.why}`)
}
check('no source file mentions the pre-rename name', stale.length === 0, stale.join(' | ') || 'clean')
for (const line of explained) console.log(`  --   allowed   ${line}`)

console.log(`\nRESULT: ${failures === 0 ? 'identity is consistent' : `${failures} problem(s)`}`)
if (failures > 0) process.exitCode = 1
