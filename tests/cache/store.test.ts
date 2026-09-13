import { IDBKeyRange, indexedDB } from 'fake-indexeddb'
import { describe, expect, it, vi } from 'vitest'
import { TranslationCache, createCacheDb, type CacheLimits } from '@/cache/store'

let n = 0
const make = (limits?: Partial<CacheLimits>) =>
  new TranslationCache({ db: createCacheDb(`axt-test-${++n}`, { indexedDB, IDBKeyRange }), limits })

/** `get` now returns the whole record (translation + optional sentence alignment); assertions that care about the text only go through this */
const text = async (cache: { get: (k: string, now?: number) => Promise<{ translation: string } | null> }, key: string, now?: number) =>
  (await cache.get(key, now))?.translation ?? null

describe('TranslationCache', () => {
  it('the sentence alignment is stored and read with the translation; an old record without the field means no alignment (#105)', async () => {
    const c = make()
    const alignment = { source: [3, 4], target: [2, 3] }
    expect(await c.set('k', { translation: '译文', alignment }, '2410.00260')).toBe(true)
    expect(await c.get('k')).toEqual({ translation: '译文', alignment })
    // Writing the translation alone still works, and it reads back without the alignment key
    expect(await c.set('plain', '只有译文', '2410.00260')).toBe(true)
    expect(await c.get('plain')).toEqual({ translation: '只有译文' })
  })

  it('set / get round trip, a miss is null', async () => {
    const c = make()
    expect(await text(c, 'k')).toBeNull()
    expect(await c.set('k', '译文', '2410.00260')).toBe(true)
    expect(await text(c, 'k')).toBe('译文')
  })

  it('expired returns null', async () => {
    const c = make({ ttlMs: 1000 })
    await c.set('k', 'v', 'p', 0)
    expect(await text(c, 'k', 500)).toBe('v')
    expect(await text(c, 'k', 2000)).toBeNull()
  })

  it('the in-memory hot layer: still hits after the persistent layer was cleared', async () => {
    const c = make()
    await c.set('k', 'v', 'p')
    await c.db.entries.clear()
    expect(await text(c, 'k')).toBe('v')
  })

  it('over capacity the least recently accessed is evicted, the hot layer deleted in step', async () => {
    const c = make({ maxEntries: 2 })
    await c.set('a', 'A', 'p', 1)
    await c.set('b', 'B', 'p', 2)
    expect(await text(c, 'a', 3)).toBe('A')
    await c.set('c', 'C', 'p', 4)
    expect(await text(c, 'b', 5)).toBeNull()
    expect(await text(c, 'a', 6)).toBe('A')
    expect(await text(c, 'c', 7)).toBe('C')
    expect((await c.stats()).entries).toBe(2)
  })

  it('clear(paper) deletes that paper only, clear() everything', async () => {
    const c = make()
    await c.set('k1', 'v1', 'A')
    await c.set('k2', 'v2', 'B')
    expect(await c.clear('A')).toBe(1)
    expect(await text(c, 'k1')).toBeNull()
    expect(await text(c, 'k2')).toBe('v2')
    expect(await c.clear()).toBe(1)
    expect((await c.stats()).entries).toBe(0)
  })

  it('stats counts entries and bytes', async () => {
    const c = make()
    await c.set('k', 'v', 'p')
    const s = await c.stats()
    expect(s.entries).toBe(1)
    expect(s.bytes).toBeGreaterThan(0)
  })

  it('expired entries are removed by cleanup, and the statistics become accurate with it (Codex on #52)', async () => {
    // get() only treats an expired entry as a miss and never deletes it; counting the index as it is, the settings page would keep showing a pile of unusable entries and bytes
    const c = make()
    await c.set('old', 'v', 'p')
    const later = Date.now() + 31 * 24 * 60 * 60 * 1000
    expect((await c.stats()).entries).toBe(1)
    await c.cleanup(later)
    expect((await c.stats()).entries).toBe(0)
  })

  it('a failing cleanup rejects rather than swallows: the statistics must not report expired entries it could not remove as a success (Codex on #52)', async () => {
    const c = make()
    const db = (c as unknown as { db: { entries: { where: unknown } } }).db
    const original = db.entries.where
    db.entries.where = () => { throw new Error('IndexedDB unavailable') }
    await expect(c.cleanup()).rejects.toThrow('IndexedDB unavailable')
    db.entries.where = original
  })

  it('an oversized entry and an empty translation are not stored', async () => {
    const c = make({ maxEntryBytes: 10 })
    expect(await c.set('k', 'x'.repeat(100), 'p')).toBe(false)
    expect(await c.set('k', '', 'p')).toBe(false)
    expect(await text(c, 'k')).toBeNull()
  })
})

describe('TranslationCache: a write does not scan the whole store', () => {
  it('under the limits set no longer sorts the whole store; the totals are counted once at first', async () => {
    const c = make({ maxEntries: 1000 })
    await c.set('warm', 'v', 'p')
    const spy = vi.spyOn(c.db.entries, 'orderBy')
    for (let i = 0; i < 5; i++) await c.set(`k${i}`, `v${i}`, 'p')
    expect(spy).not.toHaveBeenCalled()
    expect((await c.stats()).entries).toBe(6)
    spy.mockRestore()
  })

  it('overwriting the same key does not let the byte count only grow', async () => {
    const c = make({ maxEntries: 10 })
    await c.set('k', 'x'.repeat(500), 'p')
    const big = (await c.stats()).bytes
    await c.set('k', 'y', 'p')
    const small = (await c.stats()).bytes
    expect(small).toBeLessThan(big)
    expect((await c.stats()).entries).toBe(1)
  })

  it('evicts the oldest entries by the byte cap', async () => {
    const c = make({ maxBytes: 400 })
    await c.set('a', 'x'.repeat(150), 'p', 1)
    await c.set('b', 'x'.repeat(150), 'p', 2)
    await c.set('c', 'x'.repeat(150), 'p', 3)
    expect(await text(c, 'a', 4)).toBeNull()
    expect(await text(c, 'c', 5)).not.toBeNull()
    expect((await c.stats()).bytes).toBeLessThanOrEqual(400)
  })
})

describe('the correctness of the totals (Codex on #14)', () => {
  /** Private fields; the tests assert on the internal state: wrong totals are the substance of these two bugs, invisible through stats() */
  const totalsOf = (cache: TranslationCache) => (cache as unknown as { totals: { count: number; bytes: number } | null }).totals

  it('concurrent first writes share one set of totals: assigning a copy each, only the last would remain and the earlier increments all lost', async () => {
    const c = make()
    // Two existing records first, so the first count has a non-zero result
    await c.set('seed-1', 'v', 'p')
    await c.set('seed-2', 'v', 'p')
    // Void the totals to imitate the worker just woken: then write 6 concurrently
    await c.clear('不存在的论文')
    expect(totalsOf(c)).toBeNull()
    await Promise.all(Array.from({ length: 6 }, (_, i) => c.set(`k${i}`, `译文${i}`, 'p')))
    expect(totalsOf(c)!.count).toBe((await c.stats()).entries)
    expect(totalsOf(c)!.bytes).toBe((await c.stats()).bytes)
  })

  it('lazily deleting an expired entry has to decrement the totals: the persistent-layer hit path', async () => {
    const c = make({ ttlMs: 1000, memoryEntries: 0 })
    await c.set('old', 'v', 'p', 0)
    await c.set('new', 'v', 'p', 0)
    const before = totalsOf(c)!.count
    // Hot-layer capacity 0, so reads go to the persistent layer; old has expired by now
    expect(await text(c, 'old', 2000)).toBeNull()
    expect(totalsOf(c)!.count).toBe(before - 1)
    expect(totalsOf(c)!.count).toBe((await c.stats()).entries)
  })

  it('lazily deleting an expired entry has to decrement the totals: the hot-layer hit path', async () => {
    const c = make({ ttlMs: 1000 })
    await c.set('old', 'v', 'p', 0)
    await c.set('new', 'v', 'p', 0)
    const before = totalsOf(c)!.count
    expect(await text(c, 'old', 2000)).toBeNull()
    // The hot layer's deletion is fire-and-forget; wait for it to land
    for (let i = 0; i < 50 && totalsOf(c)!.count === before; i++) await new Promise(r => setTimeout(r, 5))
    expect(totalsOf(c)!.count).toBe(before - 1)
    expect(totalsOf(c)!.count).toBe((await c.stats()).entries)
  })

  it('the same expired record read concurrently: the totals decrement once (Codex on #63)', async () => {
    // With a duplicate key in one batch getMany reads the same record concurrently; Dexie counts a delete of an already deleted row as a success,
    // and decrementing by “did delete resolve” would decrement several times, the totals under-count, and later writes break through the cap
    const c = make({ ttlMs: 1000, memoryEntries: 0 })
    await c.set('old', 'v', 'p', 0)
    await c.set('keep', 'v', 'p', 0)
    const before = totalsOf(c)!.count
    await Promise.all([c.get('old', 2000), c.get('old', 2000), c.get('old', 2000)])
    expect(totalsOf(c)!.count).toBe(before - 1)
    expect(totalsOf(c)!.count).toBe((await c.stats()).entries)
  })

  it('with the totals not over-counted, unexpired entries are not evicted by mistake', async () => {
    // Cap 2 entries: fill up → let the first expire and read it away → write one more; the unexpired one must not be evicted too
    const c = make({ maxEntries: 2, ttlMs: 1000, memoryEntries: 0 })
    await c.set('a', 'v', 'p', 0)
    await c.set('b', 'v', 'p', 1500) // b was created later and has not expired at 2000
    expect(await text(c, 'a', 2000)).toBeNull() // a expired and was lazily deleted
    await c.set('c', 'v', 'p', 2000)
    expect(await text(c, 'b', 2000)).toBe('v')
    expect(await text(c, 'c', 2000)).toBe('v')
  })

  it('an expired record overwritten by a concurrent set after being read: the new record is not deleted, and the old size is not subtracted (Codex on #63)', async () => {
    const c = make({ ttlMs: 1000, memoryEntries: 0 })
    await c.set('k', '短', 'p', 0)
    // While the expired record has been read but not deleted yet, a new one is written under the same key
    const reading = c.get('k', 2000)
    await c.set('k', '长很多的新译文内容', 'p', 2000)
    expect(await reading).toBeNull()
    // The new record must still be there, and the totals must agree with the store (subtracting the old byteSize would put bytes off)
    expect(await text(c, 'k', 2000)).toBe('长很多的新译文内容')
    expect(totalsOf(c)!.count).toBe((await c.stats()).entries)
    expect(totalsOf(c)!.bytes).toBe((await c.stats()).bytes)
  })

  it('a count in progress voided by clear: the stale snapshot does not land', async () => {
    const c = make()
    await c.set('a', 'v', 'p')
    await c.set('b', 'v', 'p')
    // Write racing the clear: if the count included the 2 entries from before the clear, the totals would over-count
    const clearing = c.clear()
    await c.set('c', 'v', 'p')
    await clearing
    // The totals are voided as the clear finishes; write one more, and the recount must agree with the store
    await c.set('d', 'v', 'p')
    expect(totalsOf(c)!.count).toBe((await c.stats()).entries)
    expect(totalsOf(c)!.bytes).toBe((await c.stats()).bytes)
  })
})

