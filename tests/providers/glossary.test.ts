import { describe, expect, it } from 'vitest'
import { formatGlossaryText, parseGlossary } from '@/providers/glossary'

describe('parseGlossary', () => {
  it('逗号、全角逗号、制表符、分号都能分隔', () => {
    const { entries, issues } = parseGlossary('weights, 权重\nbias，偏置\nloss\t损失\nlogits, 对数几率; prior, 先验')
    expect(entries).toEqual([
      { term: 'weights', translation: '权重' },
      { term: 'bias', translation: '偏置' },
      { term: 'loss', translation: '损失' },
      { term: 'logits', translation: '对数几率' },
      { term: 'prior', translation: '先验' },
    ])
    expect(issues).toEqual([])
  })

  it('只按第一个分隔符切：译文里的逗号原样保留', () => {
    const { entries } = parseGlossary('i.i.d., 独立同分布, 简称 iid')
    expect(entries).toEqual([{ term: 'i.i.d.', translation: '独立同分布, 简称 iid' }])
  })

  it('空行与 # 注释跳过', () => {
    const { entries, issues } = parseGlossary('# 深度学习\nweights, 权重\n\n   \n# 尾注\n')
    expect(entries).toEqual([{ term: 'weights', translation: '权重' }])
    expect(issues).toEqual([])
  })

  it('同一原文后者覆盖前者，但保持首次出现的顺序', () => {
    const { entries } = parseGlossary('weights, 重量\nbias, 偏置\nweights, 权重')
    expect(entries).toEqual([
      { term: 'weights', translation: '权重' },
      { term: 'bias', translation: '偏置' },
    ])
  })

  it('写错的行报行号，不静默丢弃', () => {
    const { entries, issues } = parseGlossary('weights, 权重\nbias\n, 偏置\nloss,   ')
    expect(entries).toEqual([{ term: 'weights', translation: '权重' }])
    expect(issues).toEqual([
      { line: 2, text: 'bias', reason: '缺少分隔符，应写成「原文, 译文」' },
      { line: 3, text: ', 偏置', reason: '原文为空' },
      { line: 4, text: 'loss,', reason: '译文为空' },
    ])
  })

  it('行号按原始行计，一行里的多个分号条目共用行号', () => {
    const { issues } = parseGlossary('weights, 权重\nbias; loss, 损失')
    expect(issues).toEqual([{ line: 2, text: 'bias', reason: '缺少分隔符，应写成「原文, 译文」' }])
  })

  it('空文本得到空表', () => {
    expect(parseGlossary('')).toEqual({ entries: [], issues: [] })
    expect(parseGlossary('   \n\n')).toEqual({ entries: [], issues: [] })
  })

  it('format 与 parse 往返一致', () => {
    const entries = [
      { term: 'weights', translation: '权重' },
      { term: 'i.i.d.', translation: '独立同分布' },
    ]
    const text = formatGlossaryText(entries)
    expect(text).toBe('weights, 权重\ni.i.d., 独立同分布')
    expect(parseGlossary(text).entries).toEqual(entries)
  })

  it('空表格式化成空串', () => {
    expect(formatGlossaryText([])).toBe('')
  })
})
