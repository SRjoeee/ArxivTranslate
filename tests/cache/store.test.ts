import { IDBKeyRange, indexedDB } from 'fake-indexeddb'
import { describe, expect, it, vi } from 'vitest'
import { TranslationCache, createCacheDb, type CacheLimits } from '@/cache/store'

let n = 0
const make = (limits?: Partial<CacheLimits>) =>
  new TranslationCache({ db: createCacheDb(`axt-test-${++n}`, { indexedDB, IDBKeyRange }), limits })

describe('TranslationCache', () => {
  it('set/get round trip; cache misses return null', async () => {
    const c = make()
    expect(await c.get('k')).toBeNull()
    expect(await c.set('k', '译文', '2410.00260')).toBe(true)
    expect(await c.get('k')).toBe('译文')
  })

  it('expired entries return null', async () => {
    const c = make({ ttlMs: 1000 })
    await c.set('k', 'v', 'p', 0)
    expect(await c.get('k', 500)).toBe('v')
    expect(await c.get('k', 2000)).toBeNull()
  })

  it('the memory hot cache still hits after persistent storage is cleared', async () => {
    const c = make()
    await c.set('k', 'v', 'p')
    await c.db.entries.clear()
    expect(await c.get('k')).toBe('v')
  })

  it('evicts the least recently accessed entry over capacity and removes it from the hot cache too', async () => {
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

  it('clear(paper) deletes only that paper; clear() deletes everything', async () => {
    const c = make()
    await c.set('k1', 'v1', 'A')
    await c.set('k2', 'v2', 'B')
    expect(await c.clear('A')).toBe(1)
    expect(await c.get('k1')).toBeNull()
    expect(await c.get('k2')).toBe('v2')
    expect(await c.clear()).toBe(1)
    expect((await c.stats()).entries).toBe(0)
  })

  it('stats reports entry count and bytes', async () => {
    const c = make()
    await c.set('k', 'v', 'p')
    const s = await c.stats()
    expect(s.entries).toBe(1)
    expect(s.bytes).toBeGreaterThan(0)
  })

  it('cleanup removes expired entries so statistics become accurate (Codex #52)', async () => {
    // get() treats expired entries as misses without deleting them; counting the index alone leaves unusable entries and bytes in settings statistics.
    const c = make()
    await c.set('old', 'v', 'p')
    const later = Date.now() + 31 * 24 * 60 * 60 * 1000
    expect((await c.stats()).entries).toBe(1)
    await c.cleanup(later)
    expect((await c.stats()).entries).toBe(0)
  })

  it('cleanup failures reject rather than being swallowed, so undeletable expired entries cannot appear in successful statistics (Codex #52)', async () => {
    const c = make()
    const db = (c as unknown as { db: { entries: { where: unknown } } }).db
    const original = db.entries.where
    db.entries.where = () => { throw new Error('IndexedDB unavailable') }
    await expect(c.cleanup()).rejects.toThrow('IndexedDB unavailable')
    db.entries.where = original
  })

  it('does not store oversized entries or empty translations', async () => {
    const c = make({ maxEntryBytes: 10 })
    expect(await c.set('k', 'x'.repeat(100), 'p')).toBe(false)
    expect(await c.set('k', '', 'p')).toBe(false)
    expect(await c.get('k')).toBeNull()
  })
})

describe('TranslationCache: writes do not scan the entire database', () => {
  it('set avoids sorting the database below capacity; totals are computed only on first use', async () => {
    const c = make({ maxEntries: 1000 })
    await c.set('warm', 'v', 'p')
    const spy = vi.spyOn(c.db.entries, 'orderBy')
    for (let i = 0; i < 5; i++) await c.set(`k${i}`, `v${i}`, 'p')
    expect(spy).not.toHaveBeenCalled()
    expect((await c.stats()).entries).toBe(6)
    spy.mockRestore()
  })

  it('overwriting a key adjusts bytes instead of only incrementing them', async () => {
    const c = make({ maxEntries: 10 })
    await c.set('k', 'x'.repeat(500), 'p')
    const big = (await c.stats()).bytes
    await c.set('k', 'y', 'p')
    const small = (await c.stats()).bytes
    expect(small).toBeLessThan(big)
    expect((await c.stats()).entries).toBe(1)
  })

  it('evicts the oldest entries to respect the byte limit', async () => {
    const c = make({ maxBytes: 400 })
    await c.set('a', 'x'.repeat(150), 'p', 1)
    await c.set('b', 'x'.repeat(150), 'p', 2)
    await c.set('c', 'x'.repeat(150), 'p', 3)
    expect(await c.get('a', 4)).toBeNull()
    expect(await c.get('c', 5)).not.toBeNull()
    expect((await c.stats()).bytes).toBeLessThanOrEqual(400)
  })
})

describe('totals bookkeeping correctness (Codex #14)', () => {
  /** Assert the private bookkeeping state: these bugs are incorrect totals that stats() cannot reveal. */
  const totalsOf = (cache: TranslationCache) => (cache as unknown as { totals: { count: number; bytes: number } | null }).totals

  it('concurrent initial writes share one totals object so later initialization cannot discard earlier increments', async () => {
    const c = make()
    // Seed two existing entries so the initial totals are nonzero.
    await c.set('seed-1', 'v', 'p')
    await c.set('seed-2', 'v', 'p')
    // Invalidate totals to simulate a waking worker, then write six entries concurrently.
    await c.clear('nonexistent-paper')
    expect(totalsOf(c)).toBeNull()
    await Promise.all(Array.from({ length: 6 }, (_, i) => c.set(`k${i}`, `译文${i}`, 'p')))
    expect(totalsOf(c)!.count).toBe((await c.stats()).entries)
    expect(totalsOf(c)!.bytes).toBe((await c.stats()).bytes)
  })

  it('lazy deletion of expired persistent-cache hits decrements totals', async () => {
    const c = make({ ttlMs: 1000, memoryEntries: 0 })
    await c.set('old', 'v', 'p', 0)
    await c.set('new', 'v', 'p', 0)
    const before = totalsOf(c)!.count
    // With hot-cache capacity 0, reads use persistent storage; old has now expired.
    expect(await c.get('old', 2000)).toBeNull()
    expect(totalsOf(c)!.count).toBe(before - 1)
    expect(totalsOf(c)!.count).toBe((await c.stats()).entries)
  })

  it('lazy deletion of expired hot-cache hits decrements totals', async () => {
    const c = make({ ttlMs: 1000 })
    await c.set('old', 'v', 'p', 0)
    await c.set('new', 'v', 'p', 0)
    const before = totalsOf(c)!.count
    expect(await c.get('old', 2000)).toBeNull()
    // Wait for the fire-and-forget hot-cache deletion to finish.
    for (let i = 0; i < 50 && totalsOf(c)!.count === before; i++) await new Promise(r => setTimeout(r, 5))
    expect(totalsOf(c)!.count).toBe(before - 1)
    expect(totalsOf(c)!.count).toBe((await c.stats()).entries)
  })

  it('concurrent reads of the same expired entry decrement totals only once (Codex #63)', async () => {
    // getMany can concurrently get a duplicate key; Dexie treats deleting an already deleted row as success.
    // Decrementing on every resolved delete undercounts totals and allows later writes beyond capacity.
    const c = make({ ttlMs: 1000, memoryEntries: 0 })
    await c.set('old', 'v', 'p', 0)
    await c.set('keep', 'v', 'p', 0)
    const before = totalsOf(c)!.count
    await Promise.all([c.get('old', 2000), c.get('old', 2000), c.get('old', 2000)])
    expect(totalsOf(c)!.count).toBe(before - 1)
    expect(totalsOf(c)!.count).toBe((await c.stats()).entries)
  })

  it('accurate bookkeeping avoids evicting unexpired entries', async () => {
    // Capacity 2: fill it, expire and read the first entry, then add another; the unexpired entry must survive.
    const c = make({ maxEntries: 2, ttlMs: 1000, memoryEntries: 0 })
    await c.set('a', 'v', 'p', 0)
    await c.set('b', 'v', 'p', 1500) // b was created later and is still valid at 2000.
    expect(await c.get('a', 2000)).toBeNull() // a expired and was lazily deleted.
    await c.set('c', 'v', 'p', 2000)
    expect(await c.get('b', 2000)).toBe('v')
    expect(await c.get('c', 2000)).toBe('v')
  })

  it('if set replaces an expired entry after a concurrent read, keeps the new entry and does not subtract the old size (Codex #63)', async () => {
    const c = make({ ttlMs: 1000, memoryEntries: 0 })
    await c.set('k', '短', 'p', 0)
    // After reading the expired entry but before deletion, write a new value under the same key.
    const reading = c.get('k', 2000)
    await c.set('k', '长很多的新译文内容', 'p', 2000)
    expect(await reading).toBeNull()
    // The new entry must survive and totals must match storage; subtracting the old byteSize would corrupt bytes.
    expect(await c.get('k', 2000)).toBe('长很多的新译文内容')
    expect(totalsOf(c)!.count).toBe((await c.stats()).entries)
    expect(totalsOf(c)!.bytes).toBe((await c.stats()).bytes)
  })

  it('clear invalidates in-progress totals computation so a stale snapshot cannot be committed', async () => {
    const c = make()
    await c.set('a', 'v', 'p')
    await c.set('b', 'v', 'p')
    // Race a write against clear: counting the two pre-clear entries would overstate totals.
    const clearing = c.clear()
    await c.set('c', 'v', 'p')
    await clearing
    // clear invalidates totals on completion; a subsequent write must recompute totals matching storage.
    await c.set('d', 'v', 'p')
    expect(totalsOf(c)!.count).toBe((await c.stats()).entries)
    expect(totalsOf(c)!.bytes).toBe((await c.stats()).bytes)
  })
})

