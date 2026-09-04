// content 侧的缓存端口：本身不碰 IndexedDB（按扩展 origin 隔离，只有 background 持有），
// 批量读写各一条消息。写入不等结果——缓存失败不该拖慢渲染（DESIGN §8.0 / §9）。
import type { CacheEntry, CachePort } from '@/providers/translate-service'
import { sendMessage, type AxtMessage, type AxtMessageType, type AxtResponse } from '@/shared/messages'

type Send = <T extends AxtMessageType>(message: AxtMessage<T>) => Promise<AxtResponse<T>>

/** send 可注入，便于测试；默认走 runtime 消息 */
export function createMessageCachePort(send: Send = sendMessage): CachePort {
  return {
    async getMany(keys: string[]) {
      if (keys.length === 0) return []
      try {
        const { hits } = await send({ type: 'axt:cache-get', keys })
        return hits.length === keys.length ? hits : keys.map(() => null)
      } catch {
        return keys.map(() => null)
      }
    },
    async putMany(entries: CacheEntry[]) {
      if (entries.length === 0) return
      // 扩展上下文失效时 send 会同步抛错，所以 try 包住调用本身而不只是 Promise
      try {
        void send({ type: 'axt:cache-put', entries }).catch(() => undefined)
      } catch {
        // 写缓存失败无所谓：下次翻译重新请求
      }
    },
  }
}
