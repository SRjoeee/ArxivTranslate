import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DOCUMENT_ROOT, RULES_VERSION } from '@/core/rules/latexml'
import { isAxtMessage } from '@/shared/messages'
import { handlePing } from '@/shared/ping'

// Scaffold smoke test: proves at once that Vitest + WxtVitest run, the @/ alias works, and happy-dom parses a fixture
describe('scaffold', () => {
  it('the @/ alias and the rule module are usable', () => {
    expect(typeof RULES_VERSION).toBe('string')
  })

  it('happy-dom parses a fixture and finds the translation root', () => {
    const html = readFileSync(join(import.meta.dirname, 'fixtures/arxiv/2608.30667.html'), 'utf8')
    const doc = new DOMParser().parseFromString(html, 'text/html')
    expect(doc.querySelector(DOCUMENT_ROOT)).not.toBeNull()
  })

  it('axt:ping message detection and handling', () => {
    expect(isAxtMessage({ type: 'axt:ping' })).toBe(true)
    expect(isAxtMessage({ type: 'axt:stats' })).toBe(true)
    expect(isAxtMessage({ type: 'other' })).toBe(false)
    expect(isAxtMessage(null)).toBe(false)
    expect(handlePing('1.2.3')).toEqual({ ok: true, version: '1.2.3' })
  })
})
