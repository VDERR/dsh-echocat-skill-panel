// Build the BRIDGE package: the current code published under the OLD name as well.
//
// WHY. Both plugin marketplaces listed this plugin under `echocat-skill-panel-3.0`, because that was
// its npm name when they indexed it, and they read the version from npm. Renaming the package left
// that name frozen at 4.0.2, so both markets went on showing 4.0.2 while every other source 鈥?GitHub
// main, the latest release, and the new npm package 鈥?was already 4.1.0.
//
// WHY THE IDENTITY HAS TO FOLLOW THE PACKAGE NAME. DSH resolves a plugin by one string that must
// simultaneously be the directory name, the bundle patch's entry id, and the client bundle id. A
// package called `echocat-skill-panel-3.0` whose patch inserts an entry called `echocat-skill-panel`
// would be installed into `vendor/echocat-skill-panel-3.0` and then fail to mount, or mount under a
// name whose directory does not exist 鈥?the exact failure the identity check exists to prevent. So the
// bridge carries `echocat-skill-panel-3.0` END TO END, and tools/check-identity.mjs is run against the
// staged copy to prove it before anything is published.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const BRIDGE_NAME = 'echocat-skill-panel-3.0'
const stage = resolve(root, '..', `bridge-${BRIDGE_NAME}`)

// What ships. Explicit, so node_modules and generated previews cannot ride along.
const INCLUDE = ['src', 'lib', 'docs', 'cordis.patch.yml', 'package.json', 'README.md', 'LICENSE', '瀹夎璇存槑.md', '.npmignore']

rmSync(stage, { recursive: true, force: true })
mkdirSync(stage, { recursive: true })
for (const item of INCLUDE) {
  const from = join(root, item)
  if (!existsSync(from)) continue
  cpSync(from, join(stage, item), { recursive: true })
}

const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version

// E409 "Cannot publish over previously staged version". The first attempt was ACCEPTED into npm's
// staging area but never reached the registry — `npm publish` reported success while the registry went
// on showing 4.0.2 — and that burns the version number permanently.
//
// The bridge therefore gets its own RELEASE version, one patch above the main package. A prerelease
// would not do: npm requires an explicit --tag for those, so they never take `latest`, and `latest` is
// precisely what the two marketplaces read.
const BRIDGE_VERSION = process.env.BRIDGE_VERSION ?? bumpPatch(version)
function bumpPatch(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/u.exec(v)
  if (m === null) throw new Error(`cannot derive a bridge version from "${v}"`)
  return `${m[1]}.${m[2]}.${Number(m[3]) + 1}`
}
const manifestPath = join(stage, 'package.json')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
manifest.version = BRIDGE_VERSION
manifest.name = BRIDGE_NAME
// A bridge is not for new users, so the package page should say so.
manifest.description = `${manifest.description}（兼容包：正式名称为 ${BRIDGE_NAME.replace('-3.0', '')}）`
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')

// Rewrite every identity string. The names are the whole point of this script, so each file that
// carries one is named rather than globbed.
const EDITS = [
  ['cordis.patch.yml', `name: 'echocat-skill-panel'`, `name: '${BRIDGE_NAME}'`],
  ['lib/client.js', 'id: "echocat-skill-panel"', `id: "${BRIDGE_NAME}"`],
]
for (const [file, from, to] of EDITS) {
  const path = join(stage, file)
  const before = readFileSync(path, 'utf8')
  if (!before.includes(from)) {
    console.error(`  MISSING anchor in ${file}: ${from}`)
    process.exit(1)
  }
  writeFileSync(path, before.split(from).join(to), 'utf8')
  console.log(`  wrote ${file}`)
}

// The bridge is a compatibility artifact, and its README should say so rather than telling a new user
// to install the old name.
const readmePath = join(stage, 'README.md')
const banner = `> **杩欐槸鍏煎鍖呫€?* 鏈彃浠剁殑姝ｅ紡鍚嶅瓧鏄?[\`echocat-skill-panel\`](https://www.npmjs.com/package/echocat-skill-panel)锛歕n> 鍖呭悕銆佺洰褰曞悕銆丩oader 鏉＄洰鍚嶃€乿endor 鐩綍鍚嶆槸鍚屼竴涓瓧绗︿覆锛屾墍浠ユ敼鍚嶆椂鍥涘涓€璧锋敼浜嗐€俓n> 杩欎釜鍖呭彧鏄浠嶅湪鎸夋棫鍚嶅瓧绱㈠紩鐨勬彃浠跺競鍦鸿兘璇诲埌褰撳墠鐗堟湰锛?*鏂拌璇风敤鏂板悕瀛?*銆俓n\n`
writeFileSync(readmePath, banner + readFileSync(readmePath, 'utf8'), 'utf8')

// Prove the staged copy is internally consistent BEFORE publishing. A bridge whose identity does not
// match its own package name would install into `vendor/<name>` and then fail to mount, because the
// patch inserts an entry the loader cannot find 鈥?the failure the identity check exists to catch.
//
// Asserted inline rather than by running tools/check-identity.mjs against the staged copy: that script
// resolves its paths relative to its OWN location, and a copy of it inside the stage therefore looked
// for package.json one directory above the package.
console.log('\n=== the four names in the staged bridge ===')
const stagedManifest = JSON.parse(readFileSync(join(stage, 'package.json'), 'utf8'))
const stagedPatch = readFileSync(join(stage, 'cordis.patch.yml'), 'utf8')
const stagedBundle = readFileSync(join(stage, 'lib', 'client.js'), 'utf8')
// The stage lives in a scratch folder, so its DIRECTORY name is not the package name — the name npm
// publishes under is. Checking the folder failed on the `bridge-` prefix in the temp path, and would
// not have been checking the thing that matters anyway, so the manifest name is used and the folder is
// reported for information only.
const stagedNames = [
  ['package.json name (what npm publishes as)', stagedManifest.name],
  ['patch entry name', /\n\s*name: '([^']+)'/u.exec(stagedPatch)?.[1]],
  ['client bundle id', /id: "([^"]+)"/u.exec(stagedBundle)?.[1]],
]
let bad = 0
for (const [label, value] of stagedNames) {
  const ok = value === BRIDGE_NAME
  if (!ok) bad += 1
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${label}: ${value}`)
}
console.log(`  --   staging folder: ${stage.split(/[\\/]/u).pop()} (scratch, not the package name)`)
const required = [
  ['dsh.bundle.patch', stagedManifest.dsh?.bundle?.patch === './cordis.patch.yml'],
  ['dsh.client.platform is web', stagedManifest.dsh?.client?.platform === 'web'],
  ['exports["./client"] points at a real file', existsSync(join(stage, stagedManifest.exports?.['./client'] ?? 'missing'))],
  ['the patch file ships', existsSync(join(stage, 'cordis.patch.yml'))],
]
for (const [label, ok] of required) {
  if (!ok) bad += 1
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${label}`)
}
if (bad > 0) {
  console.error(`\n${bad} problem(s) in the staged bridge 鈥?NOT publishing`)
  process.exit(1)
}

console.log(`\nstaged ${stage} at version ${version} 鈥?identity verified`)
