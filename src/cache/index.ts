// 译文缓存（DESIGN §9）。只在 background 使用：IndexedDB 按扩展 origin 隔离，content 侧通过消息读写（§8.0）。
// 算键的 cacheKeyFor 在 ./key，两个上下文都能引，且不会把 Dexie 带进 content 的包。
import { TranslationCache } from './store'

export const translationCache = new TranslationCache()

export * from './key'
export * from './store'

/** 把本地 Dexie 缓存包成 CachePort（background 侧用它，content 侧走消息代理） */
export function cachePortOf(cache: TranslationCache) {
  return {
    getMany: (keys: string[]) => Promise.all(keys.map(key => cache.get(key))),
    async putMany(entries: { key: string; translation: string; paper: string }[]) {
      for (const entry of entries) await cache.set(entry.key, entry.translation, entry.paper)
    },
  }
}
