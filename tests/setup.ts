// Vitest 全局准备：Dexie 需要 IndexedDB，缓存键需要 Web Crypto
import 'fake-indexeddb/auto'
import { webcrypto } from 'node:crypto'

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true })
}
