// Skill install-engine test.
//
// The engine owns every filesystem write this plugin performs, so it is tested
// against a real temporary skills root — no fs mocks. Archives are built in
// memory here rather than committed as fixtures: the reader is hand-written, and
// generating the bytes in the test is what makes it possible to construct the
// hostile cases (zip-slip, absolute paths, symlink entries) that a committed
// fixture would never contain.

import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateRawSync } from 'node:zlib'
import {
  LIMITS,
  assertSkillName,
  createInstaller,
  detectSource,
  parseFrontmatter,
  removeTree,
  renderFrontmatter,
  resolveSkillsRoot,
  slugify,
  sweepStaleClones,
  toInstallError,
} from '../src/install.js'

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

/** Build a zip in memory. `method: 0` stores, anything else deflates. */
function makeZip(entries) {
  const parts = []
  const centrals = []
  let offset = 0
  for (const entry of entries) {
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(String(entry.data), 'utf8')
    const method = entry.method ?? 8
    const body = method === 8 ? deflateRawSync(data) : data
    const nameBuf = Buffer.from(entry.name, 'utf8')
    const local = Buffer.alloc(30 + nameBuf.length)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x800, 6)
    local.writeUInt16LE(method, 8)
    local.writeUInt32LE(0, 10)
    local.writeUInt32LE(0, 14)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28)
    nameBuf.copy(local, 30)
    const central = Buffer.alloc(46 + nameBuf.length)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x800, 8)
    central.writeUInt16LE(method, 10)
    central.writeUInt32LE(0, 12)
    central.writeUInt32LE(0, 16)
    central.writeUInt32LE(body.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(nameBuf.length, 28)
    central.writeUInt16LE(0, 30)
    central.writeUInt16LE(0, 32)
    central.writeUInt16LE(0, 34)
    central.writeUInt16LE(0, 36)
    // Unix mode rides in the high half: 0xa1ff = symlink, 0x81a4 = regular 0644.
    central.writeUInt32LE(entry.symlink === true ? 0xa1ff0000 : 0x81a40000, 38)
    central.writeUInt32LE(offset, 42)
    nameBuf.copy(central, 46)
    parts.push(local, body)
    centrals.push(central)
    offset += local.length + body.length
  }
  const cd = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(cd.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...parts, cd, eocd])
}

const sandbox = mkdtempSync(join(tmpdir(), 'echocat-install-'))
const root = join(sandbox, 'skills')
const backups = join(sandbox, 'backups')
mkdirSync(root, { recursive: true })

const warns = []
const logger = { info: () => {}, warn: (message) => warns.push(String(message)) }
const quiet = { ...logger, info: () => {} }

const md = (name, description, body = 'Do the thing.') =>
  `---\nname: ${name}\ndescription: ${JSON.stringify(description)}\n---\n\n# ${name}\n\n${body}\n`

/* -------------------------------------------------------------- [1] basics -- */

console.log('\n[1] capability describes a usable write target')
const installer = createInstaller({ root, backupRoot: backups, logger })
const capability = installer.capability()
ok('the root is the configured one', capability.root === root, capability.root)
ok('the directory is writable', capability.writable === true, String(capability.writable))
ok('all five install modes are advertised, `auto` first', JSON.stringify(capability.modes) === JSON.stringify(['auto', 'text', 'file', 'url', 'git']), JSON.stringify(capability.modes))
ok('the limits are exported to the UI', capability.limits.uploadBytes === LIMITS.uploadBytes)
ok('the git probe has not settled yet', installer.gitKnown() === undefined, String(installer.gitKnown()))
ok('gitAvailable resolves to a boolean', typeof (await installer.gitAvailable()) === 'boolean')
ok('gitKnown now reports the probe result', typeof installer.gitKnown() === 'boolean', String(installer.gitKnown()))

/* ---------------------------------------------------------------- [2] text -- */

console.log('\n[2] installing from pasted markdown')
const first = await installer.install({ action: 'install', mode: 'text', text: md('demo-skill', '演示用技能') })
ok('the install succeeded', first.ok === true, JSON.stringify(first))
ok('the directory exists', existsSync(join(root, 'demo-skill')), first.skill?.name)
ok('SKILL.md was written', existsSync(join(root, 'demo-skill', 'SKILL.md')))
ok('the frontmatter name survived', readFileSync(join(root, 'demo-skill', 'SKILL.md'), 'utf8').includes('name: demo-skill'))
ok('the description is reported back', first.skill.description === '演示用技能', first.skill?.description)
ok('one file is reported', first.files === 1, String(first.files))
ok('nothing was overwritten', first.overwritten === false)
ok('the response carries the on-disk catalog', Array.isArray(first.skills) && first.skills.some((s) => s.name === 'demo-skill'))
ok('no warnings for a well-formed file', first.warnings.length === 0, JSON.stringify(first.warnings))

console.log('\n[3] overwrite protection')
const clash = await installer.install({ action: 'install', mode: 'text', text: md('demo-skill', 'second try') })
ok('a taken name is refused', clash.ok === false && clash.error.code === 'NAME_TAKEN', JSON.stringify(clash.error))
ok('the refusal suggests how to proceed', typeof clash.error.hint === 'string' && clash.error.hint.includes('覆盖'), clash.error?.hint)
ok('the original file is untouched', readFileSync(join(root, 'demo-skill', 'SKILL.md'), 'utf8').includes('演示用技能'))

const replaced = await installer.install({ action: 'install', mode: 'text', text: md('demo-skill', 'second try'), overwrite: true })
ok('overwrite is allowed when asked', replaced.ok === true, JSON.stringify(replaced))
ok('the original was backed up first', replaced.overwritten === true && typeof replaced.backup === 'string' && existsSync(replaced.backup), String(replaced.backup))
ok('the backup holds the previous content', readFileSync(join(replaced.backup, 'SKILL.md'), 'utf8').includes('演示用技能'))
ok('the new content is live', readFileSync(join(root, 'demo-skill', 'SKILL.md'), 'utf8').includes('second try'))

console.log('\n[4] a file with no frontmatter is repaired, not rejected')
const bare = await installer.install({ action: 'install', mode: 'text', text: '# Heading\n\nA useful paragraph about the skill.\n\nMore text.\n', name: 'bare-skill' })
ok('the install succeeded', bare.ok === true, JSON.stringify(bare.error ?? {}))
ok('frontmatter was synthesised', bare.warnings.some((w) => w.includes('description')), JSON.stringify(bare.warnings))
ok('the description came from the body prose', bare.skill.description === 'A useful paragraph about the skill.', bare.skill.description)
ok('the written file has frontmatter', readFileSync(join(root, 'bare-skill', 'SKILL.md'), 'utf8').startsWith('---\nname: bare-skill'))

console.log('\n[5] frontmatter parser')
const fm = parseFrontmatter('---\nname: x\ndescription: >\n  one\n  two\ntags: [a, b]\nquoted: "with: colon"\n---\nbody here')
ok('block scalars fold', fm.data.description === 'one two', fm.data.description)
ok('inline lists split', JSON.stringify(fm.data.tags) === JSON.stringify(['a', 'b']), JSON.stringify(fm.data.tags))
ok('quoted scalars unquote', fm.data.quoted === 'with: colon', fm.data.quoted)
ok('the body is separated', fm.body === 'body here', fm.body)
ok('an unterminated block is reported', parseFrontmatter('---\nname: x\nbody').errors.length === 1)
ok('a file without frontmatter is marked as such', parseFrontmatter('plain text').present === false)
ok('renderFrontmatter round-trips a description with a colon', parseFrontmatter(renderFrontmatter({ name: 'a', description: 'x: y' }) + 'b').data.description === 'x: y')

console.log('\n[6] name validation')
ok('a slug passes', assertSkillName('good-name_1.0') === 'good-name_1.0')
ok('uppercase is refused', (() => { try { assertSkillName('My Skill!'); return false } catch (error) { return error.code === 'INVALID_NAME' } })())
ok('the refusal carries the slug suggestion', (() => { try { assertSkillName('My Skill!') } catch (error) { return error.hint.includes('my-skill') } return false })())
ok('a path separator is refused', (() => { try { assertSkillName('a/b') } catch (error) { return error.code === 'INVALID_NAME' } return false })())
ok('"." is refused', (() => { try { assertSkillName('..') } catch (error) { return error.code === 'INVALID_NAME' } return false })())
ok('slugify strips punctuation', slugify('  My  Skill!! ') === 'my-skill', slugify('  My  Skill!! '))

/* --------------------------------------------------------------- [7] zips -- */

console.log('\n[7] installing from a zip')
const wrapped = makeZip([
  { name: 'repo-main/skills/wrapped-skill/SKILL.md', data: md('wrapped-skill', '包裹在多层目录里') },
  { name: 'repo-main/skills/wrapped-skill/notes.txt', data: 'hello' },
  { name: 'repo-main/README.md', data: 'not part of the skill' },
])
const zipResult = await installer.install({ action: 'install', mode: 'file', filename: 'wrapped-skill.zip', dataBase64: wrapped.toString('base64') })
ok('the zip installed', zipResult.ok === true, JSON.stringify(zipResult.error ?? {}))
ok('the name came from the archive name', zipResult.skill?.name === 'wrapped-skill', zipResult.skill?.name)
ok('the wrapper directories were stripped', existsSync(join(root, 'wrapped-skill', 'SKILL.md')) && !existsSync(join(root, 'wrapped-skill', 'repo-main')))
ok('the sibling file came along', existsSync(join(root, 'wrapped-skill', 'notes.txt')))
ok('the unrelated file was left out', !existsSync(join(root, 'wrapped-skill', 'README.md')))
ok('the description was read from the archive', zipResult.skill.description === '包裹在多层目录里', zipResult.skill?.description)

console.log('\n[8] stored (uncompressed) entries are supported too')
const stored = makeZip([{ name: 'stored-skill/SKILL.md', data: md('stored-skill', '未压缩'), method: 0 }])
const storedResult = await installer.install({ action: 'install', mode: 'file', filename: 'stored.zip', dataBase64: stored.toString('base64') })
ok('a stored zip installs', storedResult.ok === true, JSON.stringify(storedResult.error ?? {}))

/* ------------------------------------------------------- [9] hostile zips -- */

console.log('\n[9] hostile archives are refused before anything is written')
const slip = makeZip([{ name: 'evil/../../escaped.txt', data: 'pwned' }])
const slipResult = await installer.install({ action: 'install', mode: 'file', filename: 'slip.zip', dataBase64: slip.toString('base64') })
ok('zip-slip is refused', slipResult.ok === false && slipResult.error.code === 'UNSAFE_PATH', JSON.stringify(slipResult.error))
ok('nothing escaped the sandbox', !existsSync(join(sandbox, 'escaped.txt')) && !existsSync(join(tmpdir(), 'escaped.txt')))

const absolute = makeZip([{ name: 'C:/Windows/Temp/absolute.txt', data: 'pwned' }])
const absResult = await installer.install({ action: 'install', mode: 'file', filename: 'abs.zip', dataBase64: absolute.toString('base64') })
ok('an absolute path is refused', absResult.ok === false && absResult.error.code === 'UNSAFE_PATH', JSON.stringify(absResult.error))

const symlink = makeZip([
  { name: 'link-skill/SKILL.md', data: md('link-skill', '带符号链接') },
  { name: 'link-skill/escape', data: '../../..', symlink: true },
])
const linkResult = await installer.install({ action: 'install', mode: 'file', filename: 'link.zip', dataBase64: symlink.toString('base64') })
ok('the archive still installs', linkResult.ok === true, JSON.stringify(linkResult.error ?? {}))
ok('the symlink entry is skipped with a warning', linkResult.warnings.some((w) => w.includes('符号链接')), JSON.stringify(linkResult.warnings))
ok('no symlink was created', !existsSync(join(root, 'link-skill', 'escape')))

const noSkill = makeZip([{ name: 'stuff/readme.md', data: 'nothing here' }])
const noSkillResult = await installer.install({ action: 'install', mode: 'file', filename: 'noskill.zip', dataBase64: noSkill.toString('base64') })
ok('a zip with no SKILL.md is refused', noSkillResult.ok === false && noSkillResult.error.code === 'BAD_ARCHIVE', JSON.stringify(noSkillResult.error))
ok('the refusal explains what is missing', noSkillResult.error.message.includes('SKILL.md'), noSkillResult.error.message)
ok('the staging directory was cleaned up', readdirSync(root).every((entry) => !entry.startsWith('.echocat-stage')), JSON.stringify(readdirSync(root)))

const notZip = await installer.install({ action: 'install', mode: 'file', filename: 'broken.zip', dataBase64: Buffer.from('this is not a zip at all').toString('base64') })
ok('a corrupt archive is reported as such', notZip.ok === false && notZip.error.code === 'BAD_ARCHIVE', JSON.stringify(notZip.error))

console.log('\n[10] caps are enforced')
const tightFiles = createInstaller({ root, backupRoot: backups, logger: quiet, limits: { ...LIMITS, files: 2 } })
const many = makeZip([1, 2, 3, 4].map((n) => ({ name: `many/f${n}.txt`, data: 'x' })))
const manyResult = await tightFiles.install({ action: 'install', mode: 'file', filename: 'many.zip', dataBase64: many.toString('base64') })
ok('the file-count cap is enforced', manyResult.ok === false && manyResult.error.code === 'TOO_LARGE', JSON.stringify(manyResult.error))

const tightMarkdown = createInstaller({ root, backupRoot: backups, logger: quiet, limits: { ...LIMITS, markdownBytes: 80 } })
const bigResult = await tightMarkdown.install({ action: 'install', mode: 'text', text: md('too-big', 'x'.repeat(400)) })
ok('the markdown cap is enforced', bigResult.ok === false && bigResult.error.code === 'TOO_LARGE', JSON.stringify(bigResult.error))

/* ------------------------------------------------------------ [11] preview -- */

console.log('\n[11] preview writes nothing')
const beforePreview = readdirSync(root).length
const preview = await installer.install({ action: 'preview', mode: 'text', text: md('preview-only', '只看不装') })
ok('the preview succeeds', preview.ok === true, JSON.stringify(preview.error ?? {}))
ok('the preview reports the parsed name', preview.preview.name === 'preview-only', preview.preview?.name)
ok('the preview reports the description', preview.preview.description === '只看不装')
ok('the preview knows the name is free', preview.preview.exists === false)
ok('nothing was written', readdirSync(root).length === beforePreview, String(readdirSync(root).length))

/* -------------------------------------------------------------- [12] fetch -- */

console.log('\n[12] URL installs, with the network stubbed')
const calls = []
const stubFetch = (response) => async (url) => {
  calls.push(String(url))
  return response
}
const urlInstaller = createInstaller({
  root,
  backupRoot: backups,
  logger: quiet,
  fetchImpl: stubFetch(new Response(md('from-url', '从链接安装'), { status: 200, headers: { 'content-type': 'text/markdown' } })),
})
const urlResult = await urlInstaller.install({ action: 'install', mode: 'url', url: 'https://example.com/skills/from-url.md' })
ok('the markdown was installed', urlResult.ok === true, JSON.stringify(urlResult.error ?? {}))
ok('the name came from frontmatter', urlResult.skill?.name === 'from-url', urlResult.skill?.name)
ok('the URL was actually fetched', calls.length === 1 && calls[0] === 'https://example.com/skills/from-url.md', JSON.stringify(calls))

const zipInstaller = createInstaller({
  root,
  backupRoot: backups,
  logger: quiet,
  fetchImpl: stubFetch(new Response(makeZip([{ name: 'zipurl/SKILL.md', data: md('zipurl', '压缩包来自链接') }]), { status: 200, headers: { 'content-type': 'application/zip' } })),
})
const zipUrlResult = await zipInstaller.install({ action: 'install', mode: 'url', url: 'https://example.com/pack.zip' })
ok('a zip over HTTP installs', zipUrlResult.ok === true, JSON.stringify(zipUrlResult.error ?? {}))
ok('the name came from the URL', zipUrlResult.skill?.name === 'pack', zipUrlResult.skill?.name)

const http404 = createInstaller({ root, backupRoot: backups, logger: quiet, fetchImpl: stubFetch(new Response('nope', { status: 404 })) })
const missing = await http404.install({ action: 'install', mode: 'url', url: 'https://example.com/gone.md' })
ok('an HTTP error is reported', missing.ok === false && missing.error.code === 'NETWORK' && missing.error.message.includes('404'), JSON.stringify(missing.error))

console.log('\n[13] the SSRF fence')
const privateResult = await installer.install({ action: 'install', mode: 'url', url: 'http://127.0.0.1:8080/skill.md' })
ok('a loopback URL is refused by default', privateResult.ok === false && privateResult.error.code === 'BAD_REQUEST', JSON.stringify(privateResult.error))
ok('the refusal names the host', privateResult.error.message.includes('127.0.0.1'), privateResult.error.message)
const lanResult = await installer.install({ action: 'install', mode: 'url', url: 'http://192.168.1.9/skill.md' })
ok('a LAN URL is refused by default', lanResult.ok === false && lanResult.error.code === 'BAD_REQUEST')
const laxResult = await createInstaller({
  root,
  backupRoot: backups,
  logger: quiet,
  allowPrivateHosts: true,
  fetchImpl: stubFetch(new Response(md('local-skill', '内网技能'), { status: 200 })),
}).install({ action: 'install', mode: 'url', url: 'http://127.0.0.1:8080/skill.md' })
ok('allowPrivateHosts lifts the fence', laxResult.ok === true, JSON.stringify(laxResult.error ?? {}))
const badScheme = await installer.install({ action: 'install', mode: 'url', url: 'file:///etc/passwd' })
ok('a non-http scheme is refused', badScheme.ok === false && badScheme.error.code === 'BAD_REQUEST')

/* ---------------------------------------------------------- [14] uninstall -- */

console.log('\n[14] uninstall keeps a recoverable copy')
const refusedDelete = await installer.install({ action: 'uninstall', name: 'demo-skill' })
ok('a delete without confirmation is refused', refusedDelete.ok === false && refusedDelete.error.code === 'NEEDS_CONFIRM', JSON.stringify(refusedDelete.error))
ok('the skill is still there', existsSync(join(root, 'demo-skill')))
const deleted = await installer.install({ action: 'uninstall', name: 'demo-skill', confirm: true })
ok('a confirmed delete succeeds', deleted.ok === true, JSON.stringify(deleted.error ?? {}))
ok('the directory is gone', !existsSync(join(root, 'demo-skill')))
ok('a backup was kept', existsSync(join(deleted.backup, 'SKILL.md')), String(deleted.backup))
const deletedTwice = await installer.install({ action: 'uninstall', name: 'demo-skill', confirm: true })
ok('deleting a missing skill reports NOT_FOUND', deletedTwice.ok === false && deletedTwice.error.code === 'NOT_FOUND', JSON.stringify(deletedTwice.error))

/* ------------------------------------------------------------- [15] misc -- */

console.log('\n[15] protocol edges')
const unknown = await installer.install({ action: 'nonsense' })
ok('an unknown action is refused', unknown.ok === false && unknown.error.code === 'BAD_REQUEST', JSON.stringify(unknown.error))
const badMode = await installer.install({ action: 'install', mode: 'telepathy' })
ok('an unknown mode is refused', badMode.ok === false && badMode.error.code === 'BAD_REQUEST', JSON.stringify(badMode.error))
const noName = await installer.install({ action: 'install', mode: 'text', text: 'no frontmatter and no name' })
ok('a nameless install is refused with a suggestion', noName.ok === false && noName.error.code === 'INVALID_NAME', JSON.stringify(noName.error))
const rescan = await installer.install({ action: 'rescan' })
ok('rescan lists the disk', rescan.ok === true && rescan.skills.length > 0, String(rescan.skills?.length))
ok('the on-disk catalog marks SKILL.md presence', rescan.skills.every((entry) => typeof entry.hasSkillMd === 'boolean'))
const history = installer.history()
ok('the install history is recorded', history.length > 5, String(history.length))
ok('failures are recorded too', history.some((entry) => entry.ok === false))
ok('history entries carry a code on failure', history.filter((e) => e.ok === false).every((e) => typeof e.code === 'string'))
ok('toInstallError keeps the code and hint', (() => { const w = toInstallError(Object.assign(new Error('x'), { code: 'BAD_ARCHIVE' })); return w.code === 'INTERNAL' && typeof w.message === 'string' })())

console.log('\n[16] skills root resolution')
ok('an explicit absolute root wins', resolveSkillsRoot({ configured: 'C:\\custom\\skills', discovered: ['C:\\other\\skills\\a'], env: {} }) === 'C:\\custom\\skills')
ok('a relative override is ignored', resolveSkillsRoot({ configured: 'relative/path', discovered: [], env: { DSH_HOME: 'C:\\home\\dsh' } }) === join('C:\\home\\dsh', 'skills'))
ok('the discovered parent is used when it looks like a skills container', resolveSkillsRoot({ discovered: ['C:\\Users\\x\\.dsh-beta\\skills\\gpt-image'], env: {} }) === 'C:\\Users\\x\\.dsh-beta\\skills')
ok('a non-skills parent is not trusted', resolveSkillsRoot({ discovered: ['C:\\temp\\random\\thing'], env: { DSH_HOME: 'C:\\home\\dsh' } }) === join('C:\\home\\dsh', 'skills'))
ok('the majority parent wins', resolveSkillsRoot({ discovered: ['C:\\a\\skills\\x', 'C:\\a\\skills\\y', 'C:\\b\\skills\\z'], env: {} }) === 'C:\\a\\skills')
ok('DSH_HOME is honoured', resolveSkillsRoot({ env: { DSH_HOME: 'D:\\dsh' } }) === join('D:\\dsh', 'skills'))
ok('the default is ~/.dsh-beta/skills', resolveSkillsRoot({ env: {} }).endsWith(join('.dsh-beta', 'skills')), resolveSkillsRoot({ env: {} }))

console.log('\n[17] nothing was left behind')
const leftovers = readdirSync(root).filter((entry) => entry.startsWith('.echocat-stage'))
ok('no staging directories remain', leftovers.length === 0, JSON.stringify(leftovers))
ok('every surviving entry is a real skill directory', readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()).every((e) => existsSync(join(root, e.name, 'SKILL.md'))), JSON.stringify(readdirSync(root)))

rmSync(sandbox, { recursive: true, force: true })
ok('the sandbox was removed', !existsSync(sandbox))

console.log('\n[18] a pasted address is understood on its own')
// The whole point of `auto`: the user pastes whatever the author published and the
// host works out what it is, instead of splitting a URL across three boxes or
// choosing between a "从链接" tab and a "Git 仓库" tab.
ok('a bare repo slug is a repo', detectSource('owner/repo').kind === 'git' && detectSource('owner/repo').repo === 'owner/repo')
ok('a repo page is a repo', detectSource('https://github.com/owner/repo').kind === 'git')
ok(
  'a folder URL carries its branch and subdirectory',
  (() => {
    const d = detectSource('https://github.com/owner/repo/tree/main/skills/my-skill')
    return d.kind === 'git' && d.ref === 'main' && d.subpath === 'skills/my-skill' && d.url === 'https://github.com/owner/repo.git'
  })(),
  JSON.stringify(detectSource('https://github.com/owner/repo/tree/main/skills/my-skill')),
)
ok(
  'a file URL becomes its containing directory',
  (() => {
    const d = detectSource('https://github.com/owner/repo/blob/main/skills/my-skill/SKILL.md')
    return d.kind === 'git' && d.subpath === 'skills/my-skill' && d.ref === 'main'
  })(),
  JSON.stringify(detectSource('https://github.com/owner/repo/blob/main/skills/my-skill/SKILL.md')),
)
ok(
  'GitLab browse URLs work too',
  (() => {
    const d = detectSource('https://gitlab.com/group/proj/-/tree/main/skills/x')
    return d.kind === 'git' && d.repo === 'group/proj' && d.ref === 'main' && d.subpath === 'skills/x'
  })(),
  JSON.stringify(detectSource('https://gitlab.com/group/proj/-/tree/main/skills/x')),
)
ok('a branch-only URL keeps an empty subpath', (() => {
  const d = detectSource('https://github.com/owner/repo/tree/v2')
  return d.kind === 'git' && d.ref === 'v2' && d.subpath === ''
})())
ok('an archive link is an archive', detectSource('https://github.com/owner/repo/archive/refs/heads/main.zip').kind === 'zip')
ok('a codeload link is an archive', detectSource('https://codeload.github.com/owner/repo/zip/main').kind === 'zip')
ok('a raw markdown link is markdown', detectSource('https://raw.githubusercontent.com/o/r/main/s/SKILL.md').kind === 'markdown')
ok('an unknown link is left to the downloader', detectSource('https://example.com/dl/x').kind === 'unknown')
ok('an SSH remote is a repo', detectSource('git@github.com:owner/repo.git').kind === 'git')
ok('a non-http scheme is refused', (() => {
  try {
    detectSource('file:///etc/passwd')
    return false
  } catch (error) {
    return error.code === 'BAD_REQUEST'
  }
})())
ok('an empty address is refused', (() => {
  try {
    detectSource('   ')
    return false
  } catch (error) {
    return error.code === 'BAD_REQUEST'
  }
})())
ok('an unparseable address is refused with a hint', (() => {
  try {
    detectSource('definitely not an address')
    return false
  } catch (error) {
    return error.code === 'BAD_REQUEST' && typeof error.hint === 'string'
  }
})())

console.log('\n[19] the optional Chinese display name lands in meta.yaml')
// The name stays an ASCII slug (it is the directory, the catalogue identity and the
// `/名字` gesture); the Chinese name belongs in meta.yaml — which is exactly what
// all ten skills already installed on this machine do.
const zh = await installer.install({ action: 'install', mode: 'text', text: md('zh-skill', 'a skill'), displayNameZh: '  3D动画短片生成器  ' })
ok('the install succeeded', zh.ok === true, JSON.stringify(zh.error ?? {}))
ok('the response echoes the trimmed name', zh.skill.displayNameZh === '3D动画短片生成器', JSON.stringify(zh.skill))
const zhMeta = readFileSync(join(root, 'zh-skill', 'meta.yaml'), 'utf8')
ok('meta.yaml was written', zhMeta.startsWith('display-name-zh: 3D动画短片生成器'), JSON.stringify(zhMeta))
ok('it is a bare scalar, not quoted', !zhMeta.includes("'3D"), zhMeta.split('\n')[0])
ok('it ends with exactly one newline', zhMeta.endsWith('\n') && !zhMeta.endsWith('\n\n'))

// An existing meta.yaml must survive byte for byte apart from the one added line.
const zipped = makeZip([
  { name: 'pack/SKILL.md', data: md('packed-zh', 'packed skill') },
  { name: 'pack/meta.yaml', data: '# a comment\nversion: 0.5.4\ntag-cn: 动画\nsummary-cn: 做点事\n' },
])
const merged = await installer.install({ action: 'install', mode: 'file', filename: 'packed-zh.zip', dataBase64: zipped.toString('base64'), displayNameZh: '打包技能' })
ok('an archive install accepted the name', merged.ok === true, JSON.stringify(merged.error ?? {}))
ok('the response echoes it', merged.skill.displayNameZh === '打包技能', JSON.stringify(merged.skill))
const mergedMeta = readFileSync(join(root, 'packed-zh', 'meta.yaml'), 'utf8')
ok('the new line goes first', mergedMeta.split('\n')[0] === 'display-name-zh: 打包技能', JSON.stringify(mergedMeta))
ok(
  'every other line survives, comment included',
  mergedMeta.includes('# a comment') && mergedMeta.includes('version: 0.5.4') && mergedMeta.includes('tag-cn: 动画') && mergedMeta.includes('summary-cn: 做点事'),
  JSON.stringify(mergedMeta),
)

// Replacing a value the artifact itself declares: the old one is announced.
// (A plain re-install of the same zip cannot warn — the archive path extracts a
// fresh copy, so the previous INSTALL is not the merge source. The incoming file is.)
const declared = makeZip([
  { name: 'decl/SKILL.md', data: md('declared-zh', 'declared skill') },
  { name: 'decl/meta.yaml', data: 'display-name-zh: 旧名字\nsummary-cn: 说明\n' },
])
const swapped = await installer.install({ action: 'install', mode: 'file', filename: 'declared-zh.zip', dataBase64: declared.toString('base64'), displayNameZh: '新名字' })
ok('an existing declaration is replaced', swapped.skill.displayNameZh === '新名字', JSON.stringify(swapped.skill))
ok('the old value was announced', swapped.warnings.some((w) => w.includes('旧名字')), JSON.stringify(swapped.warnings))
ok('it was replaced in place, not duplicated', readFileSync(join(root, 'declared-zh', 'meta.yaml'), 'utf8').split('display-name-zh').length === 2, JSON.stringify(readFileSync(join(root, 'declared-zh', 'meta.yaml'), 'utf8')))
ok('the sibling key survived', readFileSync(join(root, 'declared-zh', 'meta.yaml'), 'utf8').includes('summary-cn: 说明'))

// Risky scalars are quoted rather than emitted bare.
const quoted = await installer.install({ action: 'install', mode: 'text', text: md('quoted-zh', 'x'), displayNameZh: '名字: 带冒号' })
ok('a risky value is single-quoted', quoted.ok === true && readFileSync(join(root, 'quoted-zh', 'meta.yaml'), 'utf8').includes("display-name-zh: '名字: 带冒号'"))

// Empty means "do nothing" — no meta.yaml is invented.
const plain = await installer.install({ action: 'install', mode: 'text', text: md('plain-zh', 'x') })
ok('omitting it writes no meta.yaml', plain.ok === true && !existsSync(join(root, 'plain-zh', 'meta.yaml')))
ok('and the response reports an empty name', plain.skill.displayNameZh === '')
const blank = await installer.install({ action: 'install', mode: 'text', text: md('blank-zh', 'x'), displayNameZh: '   ' })
ok('a whitespace-only value is ignored too', blank.ok === true && !existsSync(join(root, 'blank-zh', 'meta.yaml')))

// Validation.
const tooLong = await installer.install({ action: 'install', mode: 'text', text: md('long-zh', 'x'), displayNameZh: '字'.repeat(41) })
ok('41 characters is refused', tooLong.ok === false && tooLong.error.code === 'BAD_REQUEST', JSON.stringify(tooLong.error))
ok('the refusal names the limit', tooLong.error.message.includes('40'), tooLong.error.message)
ok('the refusal offers a hint', typeof tooLong.error.hint === 'string' && tooLong.error.hint.length > 0, tooLong.error.hint)
ok('nothing was written for the refused install', !existsSync(join(root, 'long-zh')))
const newline = await installer.install({ action: 'install', mode: 'text', text: md('nl-zh', 'x'), displayNameZh: '两\n行' })
ok('a newline is refused', newline.ok === false && newline.error.code === 'BAD_REQUEST', JSON.stringify(newline.error))
ok('40 characters is accepted', (await installer.install({ action: 'install', mode: 'text', text: md('forty-zh', 'x'), displayNameZh: '字'.repeat(40) })).ok === true)

console.log('\n[19] cleanup can never fail a caller')
// A real install reported "EPERM, Permission denied" to the user while the skill had
// in fact been committed: the `finally` that removes the git clone threw, because
// git leaves read-only pack files and Windows refuses to unlink a read-only file
// (`force` suppresses ENOENT, not EPERM).
const readonlyTree = join(sandbox, 'readonly-tree')
mkdirSync(join(readonlyTree, 'nested'), { recursive: true })
writeFileSync(join(readonlyTree, 'top.txt'), 'x')
writeFileSync(join(readonlyTree, 'nested', 'pack.pack'), 'binary-ish')
chmodSync(join(readonlyTree, 'nested', 'pack.pack'), 0o444)
const warnsBefore = warns.length
const swept = removeTree(readonlyTree, (message) => warns.push(message))
ok('a tree containing a read-only file is removed', swept === true && !existsSync(readonlyTree), String(swept))
ok('...without needing to warn', warns.length === warnsBefore, JSON.stringify(warns.slice(warnsBefore)))
ok('a missing tree counts as removed', removeTree(join(sandbox, 'never-existed')) === true)

// Stale clones are swept; a fresh one belongs to a concurrent install and survives.
// Age must be simulated by back-dating the directory, not by moving `now` forward:
// a future `now` makes EVERY directory look old, including the fresh one.
const staleClone = join(tmpdir(), `echocat-skill-stale-${Date.now().toString(16)}`)
const freshClone = join(tmpdir(), `echocat-skill-fresh-${Date.now().toString(16)}`)
mkdirSync(staleClone, { recursive: true })
mkdirSync(freshClone, { recursive: true })
writeFileSync(join(staleClone, 'SKILL.md'), 'x')
const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000)
utimesSync(staleClone, twoHoursAgo, twoHoursAgo)
const sweptCount = sweepStaleClones()
ok('a stale clone is swept away', !existsSync(staleClone), staleClone)
ok('a concurrent clone survives', existsSync(freshClone), freshClone)
ok('the sweep reports what it removed', sweptCount >= 1, String(sweptCount))
removeTree(freshClone)

console.log('\n[20] renaming the Chinese display name of an installed skill')
// The slug is the identity (directory, catalogue key, what `/名字` types), so only
// the display name moves — and meta.yaml is read by discovery on every scan, so a
// half-written file would drop the skill out of the catalogue.
const other = await installer.install({ action: 'install', mode: 'text', text: md('has-meta', 'x'), name: 'has-meta' })
ok('a skill to rename was installed', other.ok === true, JSON.stringify(other.error ?? {}))
writeFileSync(join(root, 'has-meta', 'meta.yaml'), 'tag-cn: 动画\nsummary-cn: 说明\n# 手工维护\n')

const renamed = await installer.install({ action: 'rename', name: 'has-meta', displayNameZh: 'AI时代电影视觉指南' })
ok('the rename succeeds', renamed.ok === true, JSON.stringify(renamed.error ?? {}))
ok('the response echoes the new name', renamed.skill?.displayNameZh === 'AI时代电影视觉指南', JSON.stringify(renamed.skill))
const meta1 = readFileSync(join(root, 'has-meta', 'meta.yaml'), 'utf8')
ok('the value is written as a bare scalar', meta1.includes('display-name-zh: AI时代电影视觉指南'), meta1)
ok('every other key survives, including the comment', meta1.includes('tag-cn: 动画') && meta1.includes('summary-cn: 说明') && meta1.includes('# 手工维护'), meta1)
ok('SKILL.md is untouched', readFileSync(join(root, 'has-meta', 'SKILL.md'), 'utf8').includes('name: has-meta'))

const renamed2 = await installer.install({ action: 'rename', name: 'has-meta', displayNameZh: '第二个名字' })
ok('a second rename replaces in place', renamed2.skill?.displayNameZh === '第二个名字')
const meta2 = readFileSync(join(root, 'has-meta', 'meta.yaml'), 'utf8')
ok('...leaving exactly one display-name-zh line', (meta2.match(/display-name-zh:/gu) ?? []).length === 1, meta2)
ok('...with the other keys still present', meta2.includes('tag-cn: 动画'), meta2)

const cleared = await installer.install({ action: 'rename', name: 'has-meta', displayNameZh: '   ' })
ok('an empty value clears it', cleared.ok === true && cleared.skill.displayNameZh === '', JSON.stringify(cleared.skill))
const meta3 = readFileSync(join(root, 'has-meta', 'meta.yaml'), 'utf8')
ok('the key is gone and the rest remains', !meta3.includes('display-name-zh') && meta3.includes('tag-cn: 动画'), meta3)

// Clearing the ONLY key must take the file with it: a meta.yaml holding nothing but
// a blank key is litter, and it would also report a name nobody set.
const lonely = await installer.install({ action: 'install', mode: 'text', text: md('lonely', 'x'), name: 'lonely' })
ok('a skill with no meta.yaml was installed', lonely.ok === true)
await installer.install({ action: 'rename', name: 'lonely', displayNameZh: '只有一个键' })
ok('the rename created meta.yaml', existsSync(join(root, 'lonely', 'meta.yaml')))
await installer.install({ action: 'rename', name: 'lonely', displayNameZh: '' })
ok('clearing the only key deletes the file', !existsSync(join(root, 'lonely', 'meta.yaml')))
ok('...and the skill itself survives', existsSync(join(root, 'lonely', 'SKILL.md')))

const unknownRename = await installer.install({ action: 'rename', name: 'no-such-skill', displayNameZh: 'x' })
ok('an unknown slug is NOT_FOUND', unknownRename.ok === false && unknownRename.error.code === 'NOT_FOUND', JSON.stringify(unknownRename.error))
const tooLongRename = await installer.install({ action: 'rename', name: 'has-meta', displayNameZh: '名'.repeat(41) })
ok('41 code points are refused', tooLongRename.ok === false && tooLongRename.error.code === 'BAD_REQUEST', JSON.stringify(tooLongRename.error))
const newlineRename = await installer.install({ action: 'rename', name: 'has-meta', displayNameZh: 'a\nb' })
ok('a newline is refused', newlineRename.ok === false && newlineRename.error.code === 'BAD_REQUEST', JSON.stringify(newlineRename.error))
const traversalRename = await installer.install({ action: 'rename', name: '../escape', displayNameZh: 'x' })
ok('a traversal slug is refused', traversalRename.ok === false && traversalRename.error.code === 'INVALID_NAME', JSON.stringify(traversalRename.error))
ok('a refused rename left the file alone', readFileSync(join(root, 'has-meta', 'meta.yaml'), 'utf8').includes('tag-cn: 动画'))
ok('the rename is recorded in the history', installer.history().some((entry) => entry.action === 'rename' && entry.ok === true))

console.log(`\nRESULT: ${pass}/${pass + fail} passed`)
if (fail > 0) process.exit(1)
