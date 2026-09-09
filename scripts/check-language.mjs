// Regression guard for the engineering-language policy in CLAUDE.md.
// Exact data exceptions are reviewable; character detection is not a prose-quality check.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REGISTRY = 'scripts/language-exceptions.json'
export const engineeringText = /[\p{Script=Han}\u3000-\u303f\uff01-\uff60]/u

export function checkLanguage(root) {
  const paths = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean)
  const registry = JSON.parse(readFileSync(resolve(root, REGISTRY), 'utf8'))
  const errors = []
  const allowed = new Map()
  if (registry.version !== 1 || !Array.isArray(registry.exceptions) ||
      Object.keys(registry).sort().join(',') !== 'exceptions,version') throw new Error('Invalid language exception registry')
  for (const entry of registry.exceptions) {
    if (!entry || Object.keys(entry).sort().join(',') !== 'count,file,reason,text' ||
        typeof entry.file !== 'string' || !paths.includes(entry.file) || entry.file === REGISTRY ||
        typeof entry.text !== 'string' || /[\r\n]/.test(entry.text) || !engineeringText.test(entry.text) ||
        typeof entry.reason !== 'string' || entry.reason.trim().length < 12 || engineeringText.test(entry.reason) ||
        !Number.isInteger(entry.count) || entry.count < 1) {
      errors.push(`Invalid exception: ${JSON.stringify(entry)}`)
      continue
    }
    const key = JSON.stringify([entry.file, entry.text])
    if (allowed.has(key)) errors.push(`Duplicate exception: ${entry.file}: ${entry.text}`)
    else allowed.set(key, { ...entry, seen: 0 })
  }
  let textFiles = 0
  let binaryFiles = 0
  let retainedLines = 0
  for (const file of paths) {
    // The registry is data, not an unrestricted file exemption: validate every entry above.
    if (file === REGISTRY) { textFiles++; continue }
    const bytes = readFileSync(resolve(root, file))
    let text
    try {
      if (bytes.includes(0)) throw new Error('Binary file')
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    } catch {
      binaryFiles++
      continue
    }
    textFiles++
    for (const [index, line] of text.split(/\r?\n/).entries()) {
      if (!engineeringText.test(line)) continue
      const exception = allowed.get(JSON.stringify([file, line]))
      if (exception) { exception.seen++; retainedLines++ }
      else errors.push(`${file}:${index + 1}: unregistered Han text or CJK punctuation: ${line.trim()}`)
    }
  }
  for (const entry of allowed.values()) {
    if (entry.seen !== entry.count) errors.push(`${entry.file}: stale exception or changed occurrence count (expected ${entry.count}, found ${entry.seen}): ${entry.text}`)
  }
  return { errors, textFiles, binaryFiles, retainedLines }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = checkLanguage(process.cwd())
    if (result.errors.length) {
      console.error(result.errors.join('\n'))
      console.error('Language check failed. Translate engineering text; register only reviewed, exact data exceptions (CLAUDE.md).')
      process.exitCode = 1
    } else {
      console.log(`Language check passed: ${result.textFiles} tracked text files, ${result.binaryFiles} binary files, ${result.retainedLines} exact data lines.`)
    }
  } catch (error) {
    console.error(`Language check failed: ${error.message}`)
    process.exitCode = 1
  }
}
