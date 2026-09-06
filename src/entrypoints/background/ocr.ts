// OCR 服务（DESIGN §15.2）：查 OCR 缓存，未命中才叫 helper，结果写回。
// 缓存与译文共用一个 Dexie 库（cachePortOf），键由 ocrCacheKey 算——只随图片字节与 helper 版本变。
import { ocrCacheKey } from '@/cache/key'
import { CACHE_READ_BUDGET_MS, type CachePort, readWithBudget } from '@/providers/translate-service'
import type { HelperStatus, OcrCall, OcrMessageResponse, OcrResult } from '@/shared/ocr'
import { HelperError, type HelperClient } from './helper'

export interface OcrServiceDeps {
  helper: HelperClient
  cache: CachePort
  /** 读缓存的等待上限（测试用）；默认与译文相同的 CACHE_READ_BUDGET_MS */
  cacheReadBudgetMs?: number
}

export interface OcrService {
  status(): Promise<HelperStatus>
  ocr(call: OcrCall): Promise<OcrMessageResponse>
  cancel(scope: string): number
}

/** 缓存里的记录得是我们写的那个形状，别的东西撞了键也不能当结果用 */
function parseCached(raw: string | null | undefined): OcrResult | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<OcrResult>
    if (typeof parsed.width !== 'number' || typeof parsed.height !== 'number' || !Array.isArray(parsed.lines)) return null
    return parsed as OcrResult
  } catch {
    return null
  }
}

export function createOcrService(deps: OcrServiceDeps): OcrService {
  /**
   * 撤过的 scope（与 translate-service 同一约定：之后带同一 scope 的调用直接回 aborted）。
   * 撤销可能落在读缓存的空窗里——那时请求还没排进 helper 队列，helper.cancel 撤了个空（真机实测）；
   * 会话 id 不会重复，集合只随会话数增长
   */
  const cancelled = new Set<string>()
  const aborted = (): OcrMessageResponse => ({ ok: false, error: { kind: 'aborted', message: '会话已撤销' } })

  return {
    status: () => deps.helper.status(),

    async ocr(call) {
      if (call.scope && cancelled.has(call.scope)) return aborted()
      const status = await deps.helper.status()
      if (!status.available) return { ok: false, error: { kind: 'network', message: status.reason ?? 'helper 不可用' } }
      const key = await ocrCacheKey(call.imageHash, status.version ?? 'unknown')
      // IndexedDB 可能挂住而不是拒绝：超预算当未命中，否则 helper 的超时永远开始不了、消息通道一直开着（Codex 在 #87 指出）
      const [hit] = await readWithBudget(deps.cache, [key], deps.cacheReadBudgetMs ?? CACHE_READ_BUDGET_MS)
      const cached = parseCached(hit)
      if (cached) return { ok: true, result: cached, cached: true }
      // 读缓存期间被撤：别再把活交给 helper
      if (call.scope && cancelled.has(call.scope)) return aborted()
      try {
        const { result, version } = await deps.helper.ocr({ image: call.image }, call.scope)
        // 读缓存期间端口断过、重连的 helper 换了版本：按回应所在连接的版本落缓存，别记在旧键下
        const storeKey = version === status.version ? key : await ocrCacheKey(call.imageHash, version)
        await deps.cache.putMany([{ key: storeKey, translation: JSON.stringify(result), paper: call.paper }])
        return { ok: true, result, cached: false }
      } catch (e) {
        if (e instanceof HelperError) return { ok: false, error: { kind: e.kind, message: e.message } }
        return { ok: false, error: { kind: 'unknown', message: e instanceof Error ? e.message : String(e) } }
      }
    },

    cancel(scope) {
      cancelled.add(scope)
      return deps.helper.cancel(scope)
    },
  }
}
