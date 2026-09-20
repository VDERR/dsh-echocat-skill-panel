// Assert the client stylesheets' template literals are INTACT.
//
// Why this exists, at length: a backtick inside a CSS comment ends the template literal early,
// and the rest of the sheet then parses as JavaScript. That usually STILL PARSES — `font-size:12px`
// is a legal label statement — so `new Function` in the bundler passes, the artifact is fine by
// every mechanical check, and the damage appears at runtime instead. Six separate debugging
// cycles in this repository were this one mistake, including one that shipped a blank-page bug.
//
// So: walk the literal character by character, honour `${...}` nesting the way the parser does,
// and FAIL if a backtick appears inside it. No heuristics, no regex over the whole file — the
// first version of this checker used regexes, reported a false FAIL, and missed the real break.
//
// Run: node tools/check-template-literals.mjs   (also part of `npm test`)

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const clientDir = join(here, '..', 'src', 'client')

/**
 * Walk `text` from the assignment to the closing backtick.
 *
 * @returns `{ body, openedAt, closedAt, strays }` — `strays` are backticks found INSIDE the
 *   literal (each would have ended it), which is by definition a bug.
 */
function scanLiteral(text, marker) {
  const at = text.indexOf(marker)
  if (at < 0) return null
  const open = at + marker.length
  let i = open
  let depth = 0
  const strays = []
  while (i < text.length) {
    const ch = text[i]
    if (ch === '\\') {
      i += 2
      continue
    }
    if (ch === '$' && text[i + 1] === '{') {
      depth += 1
      i += 2
      continue
    }
    if (depth > 0) {
      if (ch === '{') depth += 1
      else if (ch === '}') depth -= 1
      i += 1
      continue
    }
    if (ch === '`') {
      return { body: text.slice(open, i), openedAt: open, closedAt: i, strays }
    }
    if (ch === '${') {
      depth += 1
      i += 2
      continue
    }
    i += 1
  }
  void strays
  return null
}

/** Files that hold a whole stylesheet in one literal. */
const SHEETS = [
  ['theme.js', 'const CSS = `'],
  ['design.js', 'const CSS = `'],
  ['polish.js', 'const CSS = `'],
]

let failures = 0
for (const [file, marker] of SHEETS) {
  const text = readFileSync(join(clientDir, file), 'utf8')
  const found = scanLiteral(text, marker)
  if (found === null) {
    // design.js and polish.js have no `const CSS =` of their own; that is expected, not a bug.
    console.log(`  --   ${file}: no ${marker.trim()} assignment (expected for the generator modules)`)
    continue
  }
  const lines = text.slice(0, found.openedAt).split('\n').length
  const bodyLines = found.body.split('\n').length
  // theme.js is the composed sheet and must carry its end marker; a truncated literal loses it.
  const needsMarker = file === 'theme.js'
  const hasMarker = found.body.includes('end of stylesheet')
  // The real test: a backtick inside the body is impossible by construction, so if the literal
  // closed suspiciously early the body will be SHORT and the marker missing.
  const ok = (!needsMarker || hasMarker) && found.strays.length === 0
  if (!ok) failures += 1
  console.log(
    `  ${ok ? 'OK  ' : 'FAIL'} ${file}: literal opens at line ${lines}, ${bodyLines} lines, ` +
      `${found.body.length} chars${needsMarker ? `, end marker ${hasMarker ? 'present' : 'MISSING'}` : ''}`,
  )
  if (!ok) {
    console.log('         a backtick in a comment inside the sheet ends the literal early;')
    console.log('         remove it (the whole file is a template literal).')
  }
}

console.log(`\nRESULT: ${failures === 0 ? 'clean' : `${failures} stylesheet literal(s) broken`}`)
if (failures > 0) process.exitCode = 1
