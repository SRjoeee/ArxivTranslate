// A check-up of the build output: Chrome validates a content script strictly as UTF-8 before loading it, and a Unicode
// noncharacter (U+FFFF etc.) in the file makes it refuse the whole extension with "It isn't UTF-8 encoded".
// Met 2026-09-04: the content side imported @/cache/index by mistake and bundled Dexie, which uses "￿" as a key-range upper bound.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const OUT = '.output/chrome-mv3'
const CONTENT_DIR = join(OUT, 'content-scripts')

const isNoncharacter = code =>
  (code >= 0xd800 && code <= 0xdfff) || (code >= 0xfdd0 && code <= 0xfdef) || (code & 0xfffe) === 0xfffe || code === 0xfeff

function scan(path) {
  const bytes = readFileSync(path)
  const problems = []
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) problems.push('starts with a BOM')
  let text
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    problems.push('not valid UTF-8')
    return problems
  }
  const found = new Set()
  for (const ch of text) if (isNoncharacter(ch.codePointAt(0))) found.add(`U+${ch.codePointAt(0).toString(16).toUpperCase()}`)
  if (found.size > 0) problems.push(`contains the Unicode noncharacters ${[...found].join(', ')}, which Chrome refuses to load`)
  return problems
}

let failed = false
for (const name of readdirSync(CONTENT_DIR)) {
  const path = join(CONTENT_DIR, name)
  if (!statSync(path).isFile()) continue
  const problems = scan(path)
  if (problems.length > 0) {
    failed = true
    console.error(`✗ ${path}\n  ${problems.join('\n  ')}`)
  } else {
    console.log(`✓ ${path}`)
  }
}
if (failed) {
  console.error('\nThe content script cannot be loaded by Chrome. Usual cause: the content side imports a module meant for the background only (such as the Dexie cache implementation in @/cache).')
  process.exit(1)
}
