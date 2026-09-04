import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DOCUMENT_ROOT, RULES_VERSION } from '@/core/rules/latexml'
import { isAxtMessage } from '@/shared/messages'
import { handlePing } from '@/shared/ping'

// 脚手架冒烟：同时证明 Vitest + WxtVitest 跑通、@/ 别名可用、happy-dom 能解析 fixture
describe('脚手架', () => {
  it('@/ 别名与规则模块可用', () => {
    expect(typeof RULES_VERSION).toBe('string')
  })

  it('happy-dom 能解析 fixture 并找到翻译根', () => {
    const html = readFileSync(join(import.meta.dirname, 'fixtures/arxiv/2608.30667.html'), 'utf8')
    const doc = new DOMParser().parseFromString(html, 'text/html')
    expect(doc.querySelector(DOCUMENT_ROOT)).not.toBeNull()
  })

  it('axt:ping 消息判定与处理', () => {
    expect(isAxtMessage({ type: 'axt:ping' })).toBe(true)
    expect(isAxtMessage({ type: 'axt:stats' })).toBe(true)
    expect(isAxtMessage({ type: 'other' })).toBe(false)
    expect(isAxtMessage(null)).toBe(false)
    expect(handlePing('1.2.3')).toEqual({ ok: true, version: '1.2.3' })
  })
})
