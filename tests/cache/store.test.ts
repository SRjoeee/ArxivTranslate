import { IDBKeyRange, indexedDB } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { TranslationCache, createCacheDb, type CacheLimits } from '@/cache/store'

let n = 0
const make = (limits?: Partial<CacheLimits>) =>
  new TranslationCache({ db: createCacheDb(`axt-test-${++n}`, { indexedDB, IDBKeyRange }), limits })

describe('TranslationCache', () => {
  it('set / get 往返，未命中为 null', async () => {
    const c = make()
    expect(await c.get('k')).toBeNull()
    expect(await c.set('k', '译文', '2410.00260')).toBe(true)
    expect(await c.get('k')).toBe('译文')
  })

  it('过期返回 null', async () => {
    const c = make({ ttlMs: 1000 })
    await c.set('k', 'v', 'p', 0)
    expect(await c.get('k', 500)).toBe('v')
    expect(await c.get('k', 2000)).toBeNull()
  })

  it('内存热层：持久层被清空后仍能命中', async () => {
    const c = make()
    await c.set('k', 'v', 'p')
    await c.db.entries.clear()
    expect(await c.get('k')).toBe('v')
  })

  it('超容量按最久未访问淘汰，热层同步删除', async () => {
    const c = make({ maxEntries: 2 })
    await c.set('a', 'A', 'p', 1)
    await c.set('b', 'B', 'p', 2)
    expect(await c.get('a', 3)).toBe('A')
    await c.set('c', 'C', 'p', 4)
    expect(await c.get('b', 5)).toBeNull()
    expect(await c.get('a', 6)).toBe('A')
    expect(await c.get('c', 7)).toBe('C')
    expect((await c.stats()).entries).toBe(2)
  })

  it('clear(paper) 只删该论文，clear() 全删', async () => {
    const c = make()
    await c.set('k1', 'v1', 'A')
    await c.set('k2', 'v2', 'B')
    expect(await c.clear('A')).toBe(1)
    expect(await c.get('k1')).toBeNull()
    expect(await c.get('k2')).toBe('v2')
    expect(await c.clear()).toBe(1)
    expect((await c.stats()).entries).toBe(0)
  })

  it('stats 统计条数与字节', async () => {
    const c = make()
    await c.set('k', 'v', 'p')
    const s = await c.stats()
    expect(s.entries).toBe(1)
    expect(s.bytes).toBeGreaterThan(0)
  })

  it('超大单条与空译文不入库', async () => {
    const c = make({ maxEntryBytes: 10 })
    expect(await c.set('k', 'x'.repeat(100), 'p')).toBe(false)
    expect(await c.set('k', '', 'p')).toBe(false)
    expect(await c.get('k')).toBeNull()
  })
})
