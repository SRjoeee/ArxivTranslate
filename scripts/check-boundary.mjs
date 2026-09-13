#!/usr/bin/env node
// The platform boundary (ADR-0008): the core of the extension — `src/core`, `src/providers`, `src/cache` — is pure
// DOM, fetch and IndexedDB, so another host (a web reader, a test harness) can run it. It must not import the
// extension's platform layer: WXT / chrome.* wrappers, the entry points, the UI, the locale packs, the WXT-backed
// configuration store, or the runtime-messaging modules. Type-only imports are allowed (they compile away).
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const CORE = [/^src\/core\//, /^src\/providers\//, /^src\/cache\//]
const FORBIDDEN = [/^wxt(\/|$)/, /^webextension-polyfill/, /^@\/entrypoints\//, /^@\/ui\//, /^@\/locales(\/|$)/, /^@\/config\/storage$/, /^@\/shared\/messages$/, /^@\/shared\/transport$/]
const IMPORT = /^\s*(?:import|export)\s+(type\s+)?(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/gm
const DYNAMIC = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g

const files = execFileSync('git', ['ls-files', '-z', 'src'], { encoding: 'utf8' }).split('\0').filter(f => f && /\.(ts|tsx)$/.test(f) && CORE.some(re => re.test(f)))
const problems = []
for (const file of files) {
  const text = readFileSync(file, 'utf8')
  for (const m of text.matchAll(IMPORT)) {
    if (m[1]) continue // `import type` / `export type … from`
    const spec = m[2]
    if (FORBIDDEN.some(re => re.test(spec))) problems.push(`${file}: imports ${spec}`)
  }
  for (const m of text.matchAll(DYNAMIC)) {
    if (FORBIDDEN.some(re => re.test(m[1]))) problems.push(`${file}: imports ${m[1]} (dynamic)`)
  }
}
if (problems.length) {
  console.error('The core imports the platform layer (ADR-0008 forbids it; inject the dependency instead):')
  for (const p of problems) console.error(`  ${p}`)
  process.exit(1)
}
console.log(`boundary check: ${files.length} core files import no platform module`)
