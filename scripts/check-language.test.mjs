import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { checkLanguage } from './check-language.mjs'

// Literal samples exercise rejection, exact exceptions, punctuation, and Unicode support.
const sample = '中文'
const punctuation = '，'

function repository(t, text, exceptions = []) {
  const root = mkdtempSync(join(tmpdir(), 'axt-language-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, 'scripts'))
  writeFileSync(join(root, 'sample.txt'), text)
  writeFileSync(join(root, 'scripts/language-exceptions.json'), JSON.stringify({ version: 1, exceptions }))
  execFileSync('git', ['init', '-q', root])
  execFileSync('git', ['add', '.'], { cwd: root })
  return root
}

const exception = { file: 'sample.txt', text: sample, reason: 'Chinese translation output used to test exact data exceptions.', count: 1 }

test('rejects new Han engineering text and CJK punctuation', t => {
  const result = checkLanguage(repository(t, `English ${sample}\nEnglish${punctuation}\n`))
  assert.equal(result.errors.length, 2)
  assert.match(result.errors[0], /sample.txt:1:/)
  assert.match(result.errors[1], /sample.txt:2:/)
})

test('permits reviewed exact data and unrelated Unicode', t => {
  const result = checkLanguage(repository(t, `${sample}\nCafé → Ελληνικά 한국어\n`, [exception]))
  assert.deepEqual(result.errors, [])
  assert.equal(result.retainedLines, 1)
})

test('rejects changed lines and stale exceptions', t => {
  const result = checkLanguage(repository(t, `prefix ${sample}\n`, [exception]))
  assert.equal(result.errors.length, 2)
  assert.ok(result.errors.some(error => error.includes('stale exception')))
})

test('rejects duplicated data beyond its reviewed occurrence count', t => {
  const result = checkLanguage(repository(t, `${sample}\n${sample}\n`, [exception]))
  assert.equal(result.errors.length, 1)
  assert.match(result.errors[0], /expected 1, found 2/)
})

test('rejects broad exemptions and missing reasons', t => {
  const root = repository(t, sample, [{ ...exception, file: 'src/**' }, { ...exception, reason: '' }])
  assert.equal(checkLanguage(root).errors.filter(error => error.startsWith('Invalid exception')).length, 2)
})

test('does not allow unvalidated registry metadata', t => {
  const root = repository(t, sample, [{ ...exception, note: sample }])
  assert.ok(checkLanguage(root).errors.some(error => error.startsWith('Invalid exception')))
  writeFileSync(join(root, 'scripts/language-exceptions.json'), JSON.stringify({ version: 1, exceptions: [], note: sample }))
  assert.throws(() => checkLanguage(root), /Invalid language exception registry/)
})
