import { describe, expect, it } from 'vitest'
import { translateTitle } from '@/core/scheduler/title'

const tick = () => new Promise(resolve => setTimeout(resolve, 0))
const docWith = (title: string) => new DOMParser().parseFromString(`<!doctype html><html><head><title>${title}</title></head><body></body></html>`, 'text/html')

describe('translateTitle', () => {
  it('translates the title once at the start; restores the original on stop (§7.1: equal node for node after restore)', async () => {
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

  it('with no translation (null) the original title stays; a result after the session ended is dropped', async () => {
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

  it('a title changed by the page itself is retranslated; our own translation triggers no retranslation', async () => {
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
    // What the page changed it to is the “original”
    expect(doc.title).toBe('Changed by page')
  })

  it('the translation throws: the title unchanged, nothing thrown', async () => {
    const doc = docWith('A Paper')
    const title = translateTitle(doc, { translate: async () => { throw new Error('boom') }, isCurrent: () => true })
    await tick()
    expect(doc.title).toBe('A Paper')
    title.stop()
    expect(doc.title).toBe('A Paper')
  })

  it('an empty title does nothing', async () => {
    const doc = docWith('')
    const calls: string[] = []
    const title = translateTitle(doc, { translate: async text => { calls.push(text); return 'x' }, isCurrent: () => true })
    await tick()
    expect(calls).toEqual([])
    title.stop()
  })
})
