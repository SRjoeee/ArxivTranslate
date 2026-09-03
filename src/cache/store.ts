// 移植自 reference/FluentRead/src/services/translation/cache.ts@536a819（GPL-3.0），有修改：
// 键的计算移到 src/cache/key.ts（Web Crypto）；记录加 paper 字段与索引，支持按论文清理；TTL / 容量常量按论文场景放大；
// 库名、类型与导出按本项目调整，构造函数可注入独立库与小容量用于测试；保留原有的内存热层、事务内 LRU 淘汰与"缓存故障降级为未命中"的策略。
import Dexie, { type DexieOptions, type Table } from 'dexie'

export interface CacheRecord {
  key: string
  /** arXiv id，便于按论文清理与导出 */
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

// 一篇论文几百个块，"重开秒出"需要按月计的 TTL 与足够的容量
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
  }
}

export function createCacheDb(name?: string, options?: DexieOptions): CacheDatabase {
  return new CacheDatabase(name, options)
}

const byteSizeOf = (value: string) => new TextEncoder().encode(value).byteLength

/**
 * 译文缓存由 background 统一持有：IndexedDB 之外保留一层小型热数据内存缓存。
 * 读取、写入和维护失败都降级为未命中，无痕模式、禁用 IndexedDB 或配额不足时仍能翻译。
 */
export class TranslationCache {
  readonly db: CacheDatabase
  readonly limits: CacheLimits
  private readonly memory = new Map<string, CacheRecord>()

  constructor(options: { db?: CacheDatabase; limits?: Partial<CacheLimits> } = {}) {
    this.db = options.db ?? createCacheDb()
    this.limits = { ...DEFAULT_CACHE_LIMITS, ...options.limits }
  }

  private isExpired(record: CacheRecord, now: number): boolean {
    return record.expiresAt <= now || record.createdAt + this.limits.ttlMs <= now
  }

  /** 重新插入以移动到 LRU 最新位置，超过热层上限时从最旧开始淘汰 */
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

  async get(key: string, now = Date.now()): Promise<string | null> {
    const hot = this.memory.get(key)
    if (hot) {
      if (this.isExpired(hot, now)) {
        this.forget(key)
        void this.db.entries.delete(key).catch(() => undefined)
        return null
      }
      hot.lastAccessedAt = now
      this.remember(hot)
      // 与原实现不同：热层命中也回写持久层的访问时间，否则持久层 LRU 会按过时的时间淘汰错误条目
      await this.db.entries.update(key, { lastAccessedAt: now }).catch(() => undefined)
      return hot.translation
    }
    try {
      const record = await this.db.entries.get(key)
      if (!record) return null
      if (this.isExpired(record, now)) {
        await this.db.entries.delete(key)
        return null
      }
      record.lastAccessedAt = now
      await this.db.entries.put(record)
      this.remember(record)
      return record.translation
    } catch (error) {
      console.warn('[axt] 缓存读取失败，按未命中处理', error)
      return null
    }
  }

  /** 空译文与过大单项不入库；写入后在同一事务里按条数与总字节数做持久层 LRU 淘汰 */
  async set(key: string, translation: string, paper: string, now = Date.now()): Promise<boolean> {
    const byteSize = byteSizeOf(key) + byteSizeOf(translation)
    if (!translation || byteSize > this.limits.maxEntryBytes) return false
    const record: CacheRecord = { key, paper, translation, createdAt: now, lastAccessedAt: now, expiresAt: now + this.limits.ttlMs, byteSize }
    try {
      await this.db.transaction('rw', this.db.entries, async () => {
        await this.db.entries.put(record)
        const entries = await this.db.entries.orderBy('lastAccessedAt').toArray()
        let totalBytes = entries.reduce((sum, item) => sum + item.byteSize, 0)
        const evict: string[] = []
        while (entries.length - evict.length > this.limits.maxEntries || totalBytes > this.limits.maxBytes) {
          const candidate = entries[evict.length]
          if (!candidate) break
          evict.push(candidate.key)
          totalBytes -= candidate.byteSize
        }
        if (evict.length > 0) {
          await this.db.entries.bulkDelete(evict)
          evict.forEach(k => this.forget(k))
        }
      })
      // 持久化成功后再进热层，防止两层状态分叉
      if (!this.memory.has(key) || this.memory.get(key) !== record) this.remember(record)
      return true
    } catch (error) {
      console.warn('[axt] 缓存写入失败', error)
      return false
    }
  }

  async cleanup(now = Date.now()): Promise<void> {
    try {
      await this.db.entries.where('expiresAt').belowOrEqual(now).delete()
      await this.db.entries.where('createdAt').belowOrEqual(now - this.limits.ttlMs).delete()
      for (const [key, record] of this.memory) if (this.isExpired(record, now)) this.memory.delete(key)
    } catch (error) {
      console.warn('[axt] 缓存清理失败', error)
    }
  }

  /** 清空全部，或只清某篇论文；返回删除条数 */
  async clear(paper?: string): Promise<number> {
    if (paper === undefined) {
      const total = await this.db.entries.count()
      this.memory.clear()
      await this.db.entries.clear()
      return total
    }
    const keys = await this.db.entries.where('paper').equals(paper).primaryKeys()
    await this.db.entries.bulkDelete(keys)
    keys.forEach(k => this.forget(k))
    return keys.length
  }

  async stats(): Promise<{ entries: number; bytes: number }> {
    let bytes = 0
    await this.db.entries.each(record => { bytes += record.byteSize })
    return { entries: await this.db.entries.count(), bytes }
  }
}
