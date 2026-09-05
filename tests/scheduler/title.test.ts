import { describe, expect, it } from 'vitest'
import { translateTitle } from '@/core/scheduler/title'

const tick = () => new Promise(resolve => setTimeout(resolve, 0))
const docWith = (title: string) => new DOMParser().parseFromString(`<!doctype html><html><head><title>${title}</title></head><body></body></html>`, 'text/html')

describe('translateTitle', () => {
  it('开始时翻一次标题；停止时恢复原文（§7.1 恢复后逐节点相等）', async () => {
    const doc = docWith('A Paper')
    const before = doc.documentElement.outerHTML
    const calls: string[] = []
    const title = translateTitle(doc, { translate: async text => { calls.push(text); return '一篇论文' }, isCurrent: () => true })
    await tick()
    expect(calls).toEqual(['A Paper'])
    expect(doc.title).toBe('一篇论文')
    title.stop()
    expect(doc.title).toBe('A Paper')
    expect(doc.documentElement.outerHTML).toBe(before)
  })

  it('拿不到译文（null）就保持原标题；会话已结束的结果丢掉', async () => {
    const doc = docWith('A Paper')
    translateTitle(doc, { translate: async () => null, isCurrent: () => true })
    await tick()
    expect(doc.title).toBe('A Paper')

    let current = true
    const doc2 = docWith('Another')
    const t2 = translateTitle(doc2, { translate: async () => { current = false; return '另一篇' }, isCurrent: () => current })
    await tick()
    expect(doc2.title).toBe('Another')
    t2.stop()
  })

  it('页面自己改了标题就重翻；我们写的译文不会触发重翻', async () => {
    const doc = docWith('A Paper')
    const calls: string[] = []
    const title = translateTitle(doc, { translate: async text => { calls.push(text); return `译:${text}` }, isCurrent: () => true })
    await tick()
    expect(doc.title).toBe('译:A Paper')
    doc.title = 'Changed by page'
    await tick()
    await tick()
    expect(calls).toEqual(['A Paper', 'Changed by page'])
    expect(doc.title).toBe('译:Changed by page')
    title.stop()
    // 页面改过的那个才是"原文"
    expect(doc.title).toBe('Changed by page')
  })

  it('翻译抛错：标题不变，不抛出', async () => {
    const doc = docWith('A Paper')
    const title = translateTitle(doc, { translate: async () => { throw new Error('boom') }, isCurrent: () => true })
    await tick()
    expect(doc.title).toBe('A Paper')
    title.stop()
    expect(doc.title).toBe('A Paper')
  })

  it('空标题什么都不做', async () => {
    const doc = docWith('')
    const calls: string[] = []
    const title = translateTitle(doc, { translate: async text => { calls.push(text); return 'x' }, isCurrent: () => true })
    await tick()
    expect(calls).toEqual([])
    title.stop()
  })
})
