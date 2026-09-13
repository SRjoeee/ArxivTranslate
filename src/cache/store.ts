// Ported from reference/FluentRead/src/services/translation/cache.ts@536a819 (GPL-3.0), 2026-09-03, modified:
// key computation moved to src/cache/key.ts (Web Crypto); records gain a `paper` field and index so one paper can be
// cleared; TTL and capacity constants raised for the paper use case; database name, types and exports follow this
// project, and the constructor takes an injected database and a small capacity for tests. Kept: the in-memory hot
// layer, LRU eviction, and "a cache failure degrades to a miss".
// The largest departure: upstream ran orderBy('lastAccessedAt').toArray() on every set, reading the whole store to
// count entries and bytes (O(n) per write). A paper is a few hundred sets; once the store holds thousands of entries
// every write deserialises all of them, and MV3's single-threaded service worker keeps other messages
// (provider-status) waiting for tens of seconds. Here counts and bytes are maintained incrementally, and only a real
// overflow evicts the oldest in one batch.
import Dexie, { type DexieOptions, type Table } from 'dexie'
import type { SentenceAlignment } from '@/providers/alignment'

/** The part of a cache record that is consumed: the translation, and the sentence alignment reported by the engine that produced it (issue #105) */
export interface CachedEntry {
  translation: string
  alignment?: SentenceAlignment
}

export interface CacheRecord {
  key: string
  /** The arXiv id, for per-paper cleanup and export */
  paper: string
  translation: string
  /** The sentence alignment; an old record has no such field, which reads back as no highlight and needs no cache invalidation */
  alignment?: SentenceAlignment
  createdAt: number
  lastAccessedAt: number
  expiresAt: number
  byteSize: number
}

/** Record → the consumed part. With `alignment` absent the key is omitted, and the caller treats it as “no alignment” */
const entryOf = (record: CacheRecord): CachedEntry => (record.alignment ? { translation: record.translation, alignment: record.alignment } : { translation: record.translation })

export interface CacheLimits {
  ttlMs: number
  maxEntries: number
  maxBytes: number
  maxEntryBytes: number
  memoryEntries: number
}

// A paper is hundreds of blocks; “instant on reopening” needs a TTL in months and enough capacity
export const DEFAULT_CACHE_LIMITS: CacheLimits = {
  ttlMs: 30 * 24 * 60 * 60 * 1000,
  maxEntries: 20_000,
  maxBytes: 50 * 1024 * 1024,
  maxEntryBytes: 256 * 1024,
  memoryEntries: 256,
}

export const CACHE_DB_NAME = 'axt-translation-cache'

export class CacheDatabase extends Dexie {
  entries!: Table<CacheRecord, string>

  constructor(name = CACHE_DB_NAME, options?: DexieOptions) {
    super(name, options)
    this.version(1).stores({ entries: '&key, paper, createdAt, expiresAt, lastAccessedAt' })
    // v2 only adds a byteSize index: it sums by reading index keys alone, so initialising the totals need not read the records
    this.version(2).stores({ entries: '&key, paper, createdAt, expiresAt, lastAccessedAt, byteSize' })
  }
}

export function createCacheDb(name?: string, options?: DexieOptions): CacheDatabase {
  return new CacheDatabase(name, options)
}

const byteSizeOf = (value: string) => new TextEncoder().encode(value).byteLength

/**
 * The translation cache is held by the background alone: a small hot in-memory layer in front of IndexedDB.
 * Failed reads, writes and maintenance all degrade to a miss, so translation goes on in incognito, with IndexedDB disabled or without quota.
 */
export class TranslationCache {
  readonly db: CacheDatabase
  readonly limits: CacheLimits
  private readonly memory = new Map<string, CacheRecord>()
  /** The persistent layer's count and bytes; null until counted. Updated incrementally by every set; voided and recounted after clear / cleanup */
  private totals: { count: number; bytes: number } | null = null
  /**
   * The count in progress, **together with the generation it started in** (Codex on #14 and #63).
   * With the Promise alone and no generation: clear() voids the totals while a count is in flight, a set started
   * afterwards captures the new generation yet reuses the Promise from before the voiding — the two generation numbers agree, and the stale snapshot lands all the same
   */
  private counting: { generation: number; promise: Promise<{ count: number; bytes: number }> } | null = null
  /** +1 on every clear / cleanup that voids the totals: a snapshot voided while counting must not land */
  private totalsGeneration = 0

  constructor(options: { db?: CacheDatabase; limits?: Partial<CacheLimits> } = {}) {
    this.db = options.db ?? createCacheDb()
    this.limits = { ...DEFAULT_CACHE_LIMITS, ...options.limits }
  }

  private isExpired(record: CacheRecord, now: number): boolean {
    return record.expiresAt <= now || record.createdAt + this.limits.ttlMs <= now
  }

  /** Reinserted to move to the LRU's newest position; beyond the hot layer's cap the oldest is evicted first */
  private remember(record: CacheRecord): void {
    this.memory.delete(record.key)
    this.memory.set(record.key, record)
    while (this.memory.size > this.limits.memoryEntries) {
      const oldest = this.memory.keys().next().value
      if (oldest === undefined) break
      this.memory.delete(oldest)
    }
  }

  private forget(key: string): void {
    this.memory.delete(key)
  }

  /**
   * Once per background lifetime: orderBy(index).keys() reads index keys only and deserialises no record.
   *
   * **Must fly alone** (Codex on #14): the count awaits one index query, and several sets arriving concurrently would
   * all see `totals` null, each compute a snapshot, each update its own incrementally, and only the last assigned
   * would remain — the earlier sets' counts lost for good, and the store could quietly exceed the count and byte caps.
   * The background's message listener is concurrent by nature, and a paper starting to translate is a burst of sets at once
   */
  private async ensureTotals(): Promise<{ count: number; bytes: number }> {
    for (;;) {
      if (this.totals) return this.totals
      const generation = this.totalsGeneration
      if (this.counting?.generation !== generation) {
        const pending = { generation, promise: this.countAll() }
        pending.promise = pending.promise.finally(() => { if (this.counting === pending) this.counting = null })
        this.counting = pending
      }
      const counted = await this.counting.promise
      // **Correctness rests on this line**: if somebody landed a snapshot while waiting, that one is used. Without it every
      // caller assigns its own, only the last remains, and the earlier sets' increments are lost for good (flying alone only saves a few index scans; it is not the crux)
      if (this.totals) return this.totals
      if (generation === this.totalsGeneration) {
        this.totals = counted
        return this.totals
      }
      // Voided by a clear / cleanup during the count: this snapshot counted the store before the deletion; dropped and redone
    }
  }

  private async countAll(): Promise<{ count: number; bytes: number }> {
    const sizes = (await this.db.entries.orderBy('byteSize').keys()) as number[]
    return { count: sizes.length, bytes: sizes.reduce((sum, size) => sum + (size || 0), 0) }
  }

  /**
   * Void the totals. Called **once before and once after** a deletion: the first makes concurrent writes stop using the
   * old totals at once, the second marks a count “racing the deletion, counting the store before it” as stale — called
   * before only, that count still sees the current generation and would take the deleted entries for present (measured: a set right after clear over-counted by 2)
   */
  private invalidateTotals(): void {
    this.totals = null
    this.totalsGeneration++
  }

  /**
   * Lazily delete one expired record, and reconcile the totals **only when it was really deleted** (Codex on #14 and #63).
   *
   * Unreconciled, `totals` keeps over-counting it, and near the cap `evictIfNeeded` evicts one **unexpired** record
   * for one that no longer exists. Decrementing by whether `delete(key)` resolves would decrement several times — with
   * a duplicate key in one batch `getMany` reads the same expired record concurrently, Dexie counts a delete of an
   * **already deleted** row as a success, and every caller decrements once. Read then delete in one transaction settles
   * both: one already deleted by somebody else is not found and not decremented twice; one overwritten meanwhile by a concurrent `set` is no longer expired, is not deleted by mistake, and its old byteSize is not subtracted (Codex on #63)
   */
  private async dropExpired(key: string, now: number): Promise<void> {
    await this.db.transaction('rw', this.db.entries, async () => {
      const current = await this.db.entries.get(key)
      // A concurrent set may have overwritten this key since the read: that record is new, not to be deleted, and its old byteSize not to be subtracted
      if (!current || !this.isExpired(current, now)) return
      await this.db.entries.delete(key)
      this.forgetTotals(current.byteSize)
    })
  }

  private forgetTotals(byteSize: number): void {
    if (!this.totals) return
    this.totals.count = Math.max(0, this.totals.count - 1)
    this.totals.bytes = Math.max(0, this.totals.bytes - byteSize)
  }

  private overLimit(totals: { count: number; bytes: number }): boolean {
    return totals.count > this.limits.maxEntries || totals.bytes > this.limits.maxBytes
  }

  /** Evict only over the cap: each round takes the oldest batch of records, until enough, never scanning the whole store */
  private async evictIfNeeded(totals: { count: number; bytes: number }): Promise<void> {
    const batchSize = 128
    while (this.overLimit(totals)) {
      const oldest = await this.db.entries.orderBy('lastAccessedAt').limit(batchSize).toArray()
      if (oldest.length === 0) {
        this.invalidateTotals()
        return
      }
      const evict: string[] = []
      for (const record of oldest) {
        if (!this.overLimit(totals)) break
        evict.push(record.key)
        totals.count = Math.max(0, totals.count - 1)
        totals.bytes = Math.max(0, totals.bytes - record.byteSize)
      }
      if (evict.length === 0) return
      await this.db.entries.bulkDelete(evict)
      for (const key of evict) this.forget(key)
    }
  }

  async get(key: string, now = Date.now()): Promise<CachedEntry | null> {
    const hot = this.memory.get(key)
    if (hot) {
      if (this.isExpired(hot, now)) {
        this.forget(key)
        void this.dropExpired(key, now).catch(() => undefined)
        return null
      }
      hot.lastAccessedAt = now
      this.remember(hot)
      // Unlike the original: a hot-layer hit writes the access time back to the persistent layer too, or the persistent LRU evicts the wrong entries by stale times
      await this.db.entries.update(key, { lastAccessedAt: now }).catch(() => undefined)
      return entryOf(hot)
    }
    try {
      const record = await this.db.entries.get(key)
      if (!record) return null
      if (this.isExpired(record, now)) {
        await this.dropExpired(key, now)
        return null
      }
      record.lastAccessedAt = now
      await this.db.entries.put(record)
      this.remember(record)
      return entryOf(record)
    } catch (error) {
      console.warn('[axt] cache read failed; treated as a miss', error)
      return null
    }
  }

  /**
   * An empty translation and an oversized item are not stored; after writing, the persistent LRU evicts by count and
   * total bytes in the same transaction.
   *
   * The value may be the translation alone or carry the sentence alignment — two shapes rather than a trailing
   * parameter, because `now` holds the fourth position already, and a parameter before it would break every call site passing `now`.
   */
  async set(key: string, value: string | CachedEntry, paper: string, now = Date.now()): Promise<boolean> {
    const { translation, alignment } = typeof value === 'string' ? { translation: value, alignment: undefined } : value
    // The alignment counts into the bytes: it persists with the record, and uncounted the totals would under-estimate
    const byteSize = byteSizeOf(key) + byteSizeOf(translation) + (alignment ? byteSizeOf(JSON.stringify(alignment)) : 0)
    if (!translation || byteSize > this.limits.maxEntryBytes) return false
    const record: CacheRecord = { key, paper, translation, createdAt: now, lastAccessedAt: now, expiresAt: now + this.limits.ttlMs, byteSize }
    if (alignment) record.alignment = alignment
    try {
      const totals = await this.ensureTotals()
      await this.db.transaction('rw', this.db.entries, async () => {
        // Overwriting the same key subtracts the old record's bytes first, or the totals only ever grow
        const previous = await this.db.entries.get(key)
        await this.db.entries.put(record)
        if (previous) totals.bytes = Math.max(0, totals.bytes - previous.byteSize)
        else totals.count++
        totals.bytes += byteSize
        await this.evictIfNeeded(totals)
      })
      // Into the hot layer only after persisting succeeded, so the two layers' states do not fork
      if (!this.memory.has(key) || this.memory.get(key) !== record) this.remember(record)
      return true
    } catch (error) {
      console.warn('[axt] cache write failed', error)
      return false
    }
  }

  /**
   * Delete the expired entries. A failure is **thrown**, not swallowed: the only runtime caller is cache-stats, and
   * swallowed, the statistics would report the expired entries it could not remove to the settings page as a success (Codex on #52)
   */
  async cleanup(now = Date.now()): Promise<void> {
    try {
      this.invalidateTotals()
      await this.db.entries.where('expiresAt').belowOrEqual(now).delete()
      await this.db.entries.where('createdAt').belowOrEqual(now - this.limits.ttlMs).delete()
      this.invalidateTotals()
      for (const [key, record] of this.memory) if (this.isExpired(record, now)) this.memory.delete(key)
    } catch (error) {
      console.warn('[axt] cache cleanup failed', error)
      throw error
    }
  }

  /** Clear everything, or one paper only; returns how many were deleted */
  async clear(paper?: string): Promise<number> {
    this.invalidateTotals()
    if (paper === undefined) {
      const total = await this.db.entries.count()
      this.memory.clear()
      await this.db.entries.clear()
      this.invalidateTotals()
      return total
    }
    const keys = await this.db.entries.where('paper').equals(paper).primaryKeys()
    await this.db.entries.bulkDelete(keys)
    this.invalidateTotals()
    for (const key of keys) this.forget(key)
    return keys.length
  }

  /** Reads index keys only, like ensureTotals, so opening the popup need not read the whole store */
  async stats(): Promise<{ entries: number; bytes: number }> {
    const sizes = (await this.db.entries.orderBy('byteSize').keys()) as number[]
    return { entries: sizes.length, bytes: sizes.reduce((sum, size) => sum + (size || 0), 0) }
  }
}
