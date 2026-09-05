// content 侧的缓存端口：本身不碰 IndexedDB（按扩展 origin 隔离，只有 background 持有），
// 批量读写各一条消息。写入不等结果——缓存失败不该拖慢渲染（DESIGN §8.0 / §9）。
import type { CacheEntry, CachePort } from '@/providers/translate-service'
import { sendMessage, type AxtMessage, type AxtMessageType, type AxtResponse } from '@/shared/messages'

type Send = <T extends AxtMessageType>(message: AxtMessage<T>) => Promise<AxtResponse<T>>

/**
 * 读缓存的等待预算。缓存是**优化**不是依赖：MV3 的 service worker 冷启动、被挂起或消息丢失时
 * 这条消息可能永远不回，而翻译服务是先等缓存再发请求的，等于整页翻译被缓存卡死（issue #45 的实验 2）。
 * 超时就当全部未命中继续翻，代价只是多花一次请求。1.5s 远大于实测的命中往返（36 ms 量级）
 */
export const CACHE_READ_TIMEOUT_MS = 1_500

/** send 可注入，便于测试；默认走 runtime 消息 */
export function createMessageCachePort(send: Send = sendMessage, timeoutMs = CACHE_READ_TIMEOUT_MS): CachePort {
  return {
    async getMany(keys: string[]) {
      if (keys.length === 0) return []
      const miss = () => keys.map(() => null)
      try {
        let timer: ReturnType<typeof setTimeout> | undefined
        const hits = await Promise.race([
          send({ type: 'axt:cache-get', keys }).then(r => r.hits),
          new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), timeoutMs) }),
        ]).finally(() => clearTimeout(timer))
        if (hits === null) {
          console.warn(`[axt] 读缓存超过 ${timeoutMs} ms 未返回，按未命中继续翻译`)
          return miss()
        }
        return hits.length === keys.length ? hits : miss()
      } catch {
        return miss()
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
