// Ported from reference/FluentRead/src/services/translation/cache.ts@536a819 (GPL-3.0), 2026-09-03; modified:
// Key generation moved to src/cache/key.ts (Web Crypto); added paper field/index for per-paper clearing; increased TTL/capacity for papers.
// Adapted database name, types and exports; constructor accepts isolated databases and small limits for tests. Kept hot-memory layer, LRU eviction and cache-failure-as-miss behavior.
// Main departure: upstream reads the entire database with orderBy('lastAccessedAt').toArray() on every set to count records/bytes (O(n) per write).
// Papers cause hundreds of sets; with thousands of entries each write deserializes the database on the single-threaded MV3 worker,
// blocking other messages such as provider-status for tens of seconds. Maintain incremental totals and evict oldest batches only when over limits.
import Dexie, { type DexieOptions, type Table } from 'dexie'

export interface CacheRecord {
  key: string
  /** arXiv id for per-paper clearing/export. */
  paper: string
  translation: string
  createdAt: number
  lastAccessedAt: number
  expiresAt: number
  byteSize: number
}

export interface CacheLimits {
  ttlMs: number
  maxEntries: number
  maxBytes: number
  maxEntryBytes: number
  memoryEntries: number
}

// Hundreds of blocks per paper require month-scale TTL and enough capacity for instant reopening.
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
    // v2 only adds a byteSize index, allowing totals to sum index keys without deserializing records.
    this.version(2).stores({ entries: '&key, paper, createdAt, expiresAt, lastAccessedAt, byteSize' })
  }
}

export function createCacheDb(name?: string, options?: DexieOptions): CacheDatabase {
  return new CacheDatabase(name, options)
}

const byteSizeOf = (value: string) => new TextEncoder().encode(value).byteLength

/**
 * Translation cache owned by background, with a small in-memory hot layer above IndexedDB.
 * Read/write/maintenance failures degrade to misses, keeping translation available in incognito, with disabled IndexedDB or exhausted quota.
 */
export class TranslationCache {
  readonly db: CacheDatabase
  readonly limits: CacheLimits
  private readonly memory = new Map<string, CacheRecord>()
  /** Persistent entry/byte totals; null means uncounted. Updated incrementally on set and invalidated after clear/cleanup. */
  private totals: { count: number; bytes: number } | null = null
  /**
   * In-progress count **and the generation when it started** (Codex #14 and #63).
   * Storing only its Promise lets clear() invalidate totals while counting, then a new set capture the new generation
   * but reuse the old Promise. The generation comparison would pass and install a stale snapshot.
   */
  private counting: { generation: number; promise: Promise<{ count: number; bytes: number }> } | null = null
  /** Increment whenever clear/cleanup invalidates totals; invalidated counting snapshots must not be installed. */
  private totalsGeneration = 0

  constructor(options: { db?: CacheDatabase; limits?: Partial<CacheLimits> } = {}) {
    this.db = options.db ?? createCacheDb()
    this.limits = { ...DEFAULT_CACHE_LIMITS, ...options.limits }
  }

  private isExpired(record: CacheRecord, now: number): boolean {
    return record.expiresAt <= now || record.createdAt + this.limits.ttlMs <= now
  }

  /** Reinsert to make most recent in LRU; evict oldest entries when the hot-layer limit is exceeded. */
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
   * Once per background lifecycle: orderBy(index).keys() reads index keys without deserializing records.
   *
   * **Only one count may run at a time** (Codex #14): counting awaits an index query. Concurrent sets would all see
   * null totals, compute their own snapshots, increment them separately, then overwrite one another.
   * Earlier increments would be lost permanently, silently exceeding entry/byte limits. Background listeners run concurrently,
   * and a paper starting translation produces a burst of simultaneous sets.
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
      // Correctness depends on this line: use totals installed while awaiting. Otherwise each caller installs its own snapshot,
      // overwriting prior increments. Sharing the count Promise only avoids redundant index scans; this check prevents lost accounting.
      if (this.totals) return this.totals
      if (generation === this.totalsGeneration) {
        this.totals = counted
        return this.totals
      }
      // clear/cleanup invalidated this snapshot while counting; it reflects pre-deletion data, so discard and retry.
    }
  }

  private async countAll(): Promise<{ count: number; bytes: number }> {
    const sizes = (await this.db.entries.orderBy('byteSize').keys()) as number[]
    return { count: sizes.length, bytes: sizes.reduce((sum, size) => sum + (size || 0), 0) }
  }

  /**
   * Invalidate totals both before and after deletion. The first call stops concurrent writes from using old totals;
   * the second marks counts racing with deletion as stale. Calling only before deletion leaves those counts in the current generation,
   * incorrectly retaining deleted entries (observed clear followed immediately by set overcounted by two).
   */
  private invalidateTotals(): void {
    this.totals = null
    this.totalsGeneration++
  }

  /**
   * Lazily delete an expired entry and update totals **only if it was actually deleted** (Codex #14 and #63).
   *
   * Without decrementing, totals retain a nonexistent entry and evictIfNeeded may discard an extra live record near the limit.
   * Decrementing whenever delete(key) resolves is also wrong: duplicate keys in getMany can read the same expired record concurrently,
   * and Dexie treats deletion of an already-deleted row as success, so every caller would decrement.
   * Reading then deleting in one transaction prevents double decrement after another deletion and preserves a fresh concurrent set
   * without subtracting its predecessor's byteSize (Codex #63).
   */
  private async dropExpired(key: string, now: number): Promise<void> {
    await this.db.transaction('rw', this.db.entries, async () => {
      const current = await this.db.entries.get(key)
      // A concurrent set may have replaced this key after the read; do not delete the fresh record or subtract the old byteSize.
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

  /** Evict only when over limits, fetching oldest records in batches until enough are removed; never scan the entire database. */
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

  async get(key: string, now = Date.now()): Promise<string | null> {
    const hot = this.memory.get(key)
    if (hot) {
      if (this.isExpired(hot, now)) {
        this.forget(key)
        void this.dropExpired(key, now).catch(() => undefined)
        return null
      }
      hot.lastAccessedAt = now
      this.remember(hot)
      // Unlike upstream, hot-layer hits update persistent access time too, preventing persistent LRU from evicting by stale timestamps.
      await this.db.entries.update(key, { lastAccessedAt: now }).catch(() => undefined)
      return hot.translation
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
      return record.translation
    } catch (error) {
      console.warn('[axt] Cache read failed; treating as a miss', error)
      return null
    }
  }

  /** Skip empty/oversized translations; after writing, evict persistent LRU entries by count and total bytes in the same transaction. */
  async set(key: string, translation: string, paper: string, now = Date.now()): Promise<boolean> {
    const byteSize = byteSizeOf(key) + byteSizeOf(translation)
    if (!translation || byteSize > this.limits.maxEntryBytes) return false
    const record: CacheRecord = { key, paper, translation, createdAt: now, lastAccessedAt: now, expiresAt: now + this.limits.ttlMs, byteSize }
    try {
      const totals = await this.ensureTotals()
      await this.db.transaction('rw', this.db.entries, async () => {
        // Subtract the old record's bytes when overwriting a key; otherwise the total only grows.
        const previous = await this.db.entries.get(key)
        await this.db.entries.put(record)
        if (previous) totals.bytes = Math.max(0, totals.bytes - previous.byteSize)
        else totals.count++
        totals.bytes += byteSize
        await this.evictIfNeeded(totals)
      })
      // Update the hot layer only after persistence succeeds, keeping both layers consistent.
      if (!this.memory.has(key) || this.memory.get(key) !== record) this.remember(record)
      return true
    } catch (error) {
      console.warn('[axt] Cache write failed', error)
      return false
    }
  }

  /**
   * Clear expired entries. Rethrow failures: cache-stats is the only runtime caller;
   * swallowing errors would report uncleared expired entries as successful statistics in settings (Codex #52).
   */
  async cleanup(now = Date.now()): Promise<void> {
    try {
      this.invalidateTotals()
      await this.db.entries.where('expiresAt').belowOrEqual(now).delete()
      await this.db.entries.where('createdAt').belowOrEqual(now - this.limits.ttlMs).delete()
      this.invalidateTotals()
      for (const [key, record] of this.memory) if (this.isExpired(record, now)) this.memory.delete(key)
    } catch (error) {
      console.warn('[axt] Cache cleanup failed', error)
      throw error
    }
  }

  /** Clear all entries or one paper; return the number deleted. */
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

  /** Like ensureTotals, read only index keys rather than the entire database when the popup opens. */
  async stats(): Promise<{ entries: number; bytes: number }> {
    const sizes = (await this.db.entries.orderBy('byteSize').keys()) as number[]
    return { entries: sizes.length, bytes: sizes.reduce((sum, size) => sum + (size || 0), 0) }
  }
}
