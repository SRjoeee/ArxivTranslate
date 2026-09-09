// Translation cache (DESIGN §9), background-only: IndexedDB is isolated by extension origin; content reads/writes via messages (§8.0).
// cacheKeyFor lives in ./key, importable by both contexts without pulling Dexie into content.
import { TranslationCache } from './store'

export const translationCache = new TranslationCache()

export * from './key'
export * from './store'

/** Wrap local Dexie as CachePort for background; content uses the message proxy. */
export function cachePortOf(cache: TranslationCache) {
  return {
    getMany: (keys: string[]) => Promise.all(keys.map(key => cache.get(key))),
    async putMany(entries: { key: string; translation: string; paper: string }[]) {
      for (const entry of entries) await cache.set(entry.key, entry.translation, entry.paper)
    },
  }
}
