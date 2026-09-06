import { IDBKeyRange, indexedDB } from 'fake-indexeddb'
import { describe, expect, it, vi } from 'vitest'
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

  it('过期条目会被 cleanup 清掉，统计随之变准（Codex 在 #52 指出）', async () => {
    // get() 只是把过期条目当未命中，从不删除；统计若照数索引，设置页会一直显示一堆用不了的条数与体积
    const c = make()
    await c.set('old', 'v', 'p')
    const later = Date.now() + 31 * 24 * 60 * 60 * 1000
    expect((await c.stats()).entries).toBe(1)
    await c.cleanup(later)
    expect((await c.stats()).entries).toBe(0)
  })

  it('cleanup 失败时拒绝而不是吞掉：统计不能把清不掉的过期条目当成功结果（Codex 在 #52 指出）', async () => {
    const c = make()
    const db = (c as unknown as { db: { entries: { where: unknown } } }).db
    const original = db.entries.where
    db.entries.where = () => { throw new Error('IndexedDB 不可用') }
    await expect(c.cleanup()).rejects.toThrow('IndexedDB 不可用')
    db.entries.where = original
  })

  it('超大单条与空译文不入库', async () => {
    const c = make({ maxEntryBytes: 10 })
    expect(await c.set('k', 'x'.repeat(100), 'p')).toBe(false)
    expect(await c.set('k', '', 'p')).toBe(false)
    expect(await c.get('k')).toBeNull()
  })
})

describe('TranslationCache：写入不扫全库', () => {
  it('未超限时 set 不再排序整库；总量只在首次统计一次', async () => {
    const c = make({ maxEntries: 1000 })
    await c.set('warm', 'v', 'p')
    const spy = vi.spyOn(c.db.entries, 'orderBy')
    for (let i = 0; i < 5; i++) await c.set(`k${i}`, `v${i}`, 'p')
    expect(spy).not.toHaveBeenCalled()
    expect((await c.stats()).entries).toBe(6)
    spy.mockRestore()
  })

  it('覆盖同一个键不会让字节数只增不减', async () => {
    const c = make({ maxEntries: 10 })
    await c.set('k', 'x'.repeat(500), 'p')
    const big = (await c.stats()).bytes
    await c.set('k', 'y', 'p')
    const small = (await c.stats()).bytes
    expect(small).toBeLessThan(big)
    expect((await c.stats()).entries).toBe(1)
  })

  it('按字节上限淘汰最旧的条目', async () => {
    const c = make({ maxBytes: 400 })
    await c.set('a', 'x'.repeat(150), 'p', 1)
    await c.set('b', 'x'.repeat(150), 'p', 2)
    await c.set('c', 'x'.repeat(150), 'p', 3)
    expect(await c.get('a', 4)).toBeNull()
    expect(await c.get('c', 5)).not.toBeNull()
    expect((await c.stats()).bytes).toBeLessThanOrEqual(400)
  })
})

describe('账面（totals）的正确性（Codex 在 #14 指出）', () => {
  /** 私有字段，测试里按内部状态断言：账面错了才是这两条 bug 的本体，看 stats() 是看不出来的 */
  const totalsOf = (cache: TranslationCache) => (cache as unknown as { totals: { count: number; bytes: number } | null }).totals

  it('并发的首批写入共用同一份账面：各自赋值一份的话，只有最后那份留下、先前的增量全丢', async () => {
    const c = make()
    // 先塞两条已存在的记录，让首次统计有非零结果
    await c.set('seed-1', 'v', 'p')
    await c.set('seed-2', 'v', 'p')
    // 作废账面，模拟 worker 刚醒来：接着并发写 6 条
    await c.clear('不存在的论文')
    expect(totalsOf(c)).toBeNull()
    await Promise.all(Array.from({ length: 6 }, (_, i) => c.set(`k${i}`, `译文${i}`, 'p')))
    expect(totalsOf(c)!.count).toBe((await c.stats()).entries)
    expect(totalsOf(c)!.bytes).toBe((await c.stats()).bytes)
  })

  it('惰性删除过期条目要减账面：持久层命中的那条路径', async () => {
    const c = make({ ttlMs: 1000, memoryEntries: 0 })
    await c.set('old', 'v', 'p', 0)
    await c.set('new', 'v', 'p', 0)
    const before = totalsOf(c)!.count
    // 热层容量为 0，读会走持久层；此时 old 已过期
    expect(await c.get('old', 2000)).toBeNull()
    expect(totalsOf(c)!.count).toBe(before - 1)
    expect(totalsOf(c)!.count).toBe((await c.stats()).entries)
  })

  it('惰性删除过期条目要减账面：热层命中的那条路径', async () => {
    const c = make({ ttlMs: 1000 })
    await c.set('old', 'v', 'p', 0)
    await c.set('new', 'v', 'p', 0)
    const before = totalsOf(c)!.count
    expect(await c.get('old', 2000)).toBeNull()
    // 热层那条是 fire-and-forget 的删除，等它落地
    for (let i = 0; i < 50 && totalsOf(c)!.count === before; i++) await new Promise(r => setTimeout(r, 5))
    expect(totalsOf(c)!.count).toBe(before - 1)
    expect(totalsOf(c)!.count).toBe((await c.stats()).entries)
  })

  it('账面不多算时不会误淘汰没过期的条目', async () => {
    // 上限 2 条：写满 → 让第一条过期并读掉它 → 再写一条，不该把没过期的那条也淘汰掉
    const c = make({ maxEntries: 2, ttlMs: 1000, memoryEntries: 0 })
    await c.set('a', 'v', 'p', 0)
    await c.set('b', 'v', 'p', 1500) // b 晚建，2000 时还没过期
    expect(await c.get('a', 2000)).toBeNull() // a 过期，被惰性删掉
    await c.set('c', 'v', 'p', 2000)
    expect(await c.get('b', 2000)).toBe('v')
    expect(await c.get('c', 2000)).toBe('v')
  })

  it('统计进行中被 clear 作废：过时的快照不落地', async () => {
    const c = make()
    await c.set('a', 'v', 'p')
    await c.set('b', 'v', 'p')
    // 与 clear 赛跑地写：统计若把 clear 之前的 2 条算进来，账面就会多算
    const clearing = c.clear()
    await c.set('c', 'v', 'p')
    await clearing
    // clear 收尾时账面作废；再写一条，重算出来的必须与库一致
    await c.set('d', 'v', 'p')
    expect(totalsOf(c)!.count).toBe((await c.stats()).entries)
    expect(totalsOf(c)!.bytes).toBe((await c.stats()).bytes)
  })
})

