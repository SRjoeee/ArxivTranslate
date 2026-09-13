import { describe, expect, it } from 'vitest'
import { formatGlossaryText, parseGlossary } from '@/providers/glossary'

describe('parseGlossary', () => {
  it('a comma, a full-width comma and a tab all separate the source from the translation', () => {
    const { entries, issues } = parseGlossary('weights, 权重\nbias，偏置\nloss\t损失\nlogits, 对数几率\nprior, 先验')
    expect(entries).toEqual([
      { term: 'weights', translation: '权重' },
      { term: 'bias', translation: '偏置' },
      { term: 'loss', translation: '损失' },
      { term: 'logits', translation: '对数几率' },
      { term: 'prior', translation: '先验' },
    ])
    expect(issues).toEqual([])
  })

  it('split at the first separator only: a comma inside the translation is kept as it is', () => {
    const { entries } = parseGlossary('i.i.d., 独立同分布, 简称 iid')
    expect(entries).toEqual([{ term: 'i.i.d.', translation: '独立同分布, 简称 iid' }])
  })

  it('empty lines and # comments are skipped', () => {
    const { entries, issues } = parseGlossary('# 深度学习\nweights, 权重\n\n   \n# 尾注\n')
    expect(entries).toEqual([{ term: 'weights', translation: '权重' }])
    expect(issues).toEqual([])
  })

  it('the same source: the later overrides the earlier but keeps the order of first appearance', () => {
    const { entries } = parseGlossary('weights, 重量\nbias, 偏置\nweights, 权重')
    expect(entries).toEqual([
      { term: 'weights', translation: '权重' },
      { term: 'bias', translation: '偏置' },
    ])
  })

  it('a malformed line reports its line number rather than being dropped silently', () => {
    const { entries, issues } = parseGlossary('weights, 权重\nbias\n, 偏置\nloss,   ')
    expect(entries).toEqual([{ term: 'weights', translation: '权重' }])
    expect(issues).toEqual([
      { line: 2, text: 'bias', reason: 'noSeparator' },
      { line: 3, text: ', 偏置', reason: 'emptySource' },
      { line: 4, text: 'loss,', reason: 'emptyTarget' },
    ])
  })

  it('a semicolon is no record separator: a semicolon in the translation stays in the translation (Codex on #52)', () => {
    // Taken as a separator it would quietly split one valid mapping into two unrelated ones (`kernel` → `核`, plus an unreadable fragment)
    const { entries, issues } = parseGlossary('kernel, 核; 统计学中称核函数')
    expect(entries).toEqual([{ term: 'kernel', translation: '核; 统计学中称核函数' }])
    expect(issues).toEqual([])
  })

  it('line numbers count the raw lines', () => {
    const { issues } = parseGlossary('weights, 权重\nbias')
    expect(issues).toEqual([{ line: 2, text: 'bias', reason: 'noSeparator' }])
  })

  it('empty text gives an empty table', () => {
    expect(parseGlossary('')).toEqual({ entries: [], issues: [] })
    expect(parseGlossary('   \n\n')).toEqual({ entries: [], issues: [] })
  })

  it('format and parse round-trip', () => {
    const entries = [
      { term: 'weights', translation: '权重' },
      { term: 'i.i.d.', translation: '独立同分布' },
    ]
    const text = formatGlossaryText(entries)
    expect(text).toBe('weights, 权重\ni.i.d., 独立同分布')
    expect(parseGlossary(text).entries).toEqual(entries)
  })

  it('an empty table formats to the empty string', () => {
    expect(formatGlossaryText([])).toBe('')
  })
})
