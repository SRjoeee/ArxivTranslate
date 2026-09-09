import { describe, expect, it } from 'vitest'
import { formatGlossaryText, parseGlossary } from '@/providers/glossary'

describe('parseGlossary', () => {
  it('accepts commas, fullwidth commas, and tabs between source and translation', () => {
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

  it('splits only at the first delimiter, preserving commas in the translation', () => {
    const { entries } = parseGlossary('i.i.d., 独立同分布, 简称 iid')
    expect(entries).toEqual([{ term: 'i.i.d.', translation: '独立同分布, 简称 iid' }])
  })

  it('skips blank lines and hash comments', () => {
    const { entries, issues } = parseGlossary('# 深度学习\nweights, 权重\n\n   \n# 尾注\n')
    expect(entries).toEqual([{ term: 'weights', translation: '权重' }])
    expect(issues).toEqual([])
  })

  it('later entries override the same source while preserving first-occurrence order', () => {
    const { entries } = parseGlossary('weights, 重量\nbias, 偏置\nweights, 权重')
    expect(entries).toEqual([
      { term: 'weights', translation: '权重' },
      { term: 'bias', translation: '偏置' },
    ])
  })

  it('reports malformed line numbers instead of silently dropping entries', () => {
    const { entries, issues } = parseGlossary('weights, 权重\nbias\n, 偏置\nloss,   ')
    expect(entries).toEqual([{ term: 'weights', translation: '权重' }])
    expect(issues).toEqual([
      { line: 2, text: 'bias', reason: 'Missing separator; use "source, translation"' },
      { line: 3, text: ', 偏置', reason: 'Source term is empty' },
      { line: 4, text: 'loss,', reason: 'Translation is empty' },
    ])
  })

  it('semicolons are not record delimiters and remain in translated text (Codex #52)', () => {
    // Treating semicolons as delimiters would silently split a valid kernel mapping into an unrelated entry and an unintelligible fragment.
    const { entries, issues } = parseGlossary('kernel, 核; 统计学中称核函数')
    expect(entries).toEqual([{ term: 'kernel', translation: '核; 统计学中称核函数' }])
    expect(issues).toEqual([])
  })

  it('line numbers refer to the original input', () => {
    const { issues } = parseGlossary('weights, 权重\nbias')
    expect(issues).toEqual([{ line: 2, text: 'bias', reason: 'Missing separator; use "source, translation"' }])
  })

  it('empty input produces an empty glossary', () => {
    expect(parseGlossary('')).toEqual({ entries: [], issues: [] })
    expect(parseGlossary('   \n\n')).toEqual({ entries: [], issues: [] })
  })

  it('format and parse round-trip consistently', () => {
    const entries = [
      { term: 'weights', translation: '权重' },
      { term: 'i.i.d.', translation: '独立同分布' },
    ]
    const text = formatGlossaryText(entries)
    expect(text).toBe('weights, 权重\ni.i.d., 独立同分布')
    expect(parseGlossary(text).entries).toEqual(entries)
  })

  it('formats an empty glossary as an empty string', () => {
    expect(formatGlossaryText([])).toBe('')
  })
})
