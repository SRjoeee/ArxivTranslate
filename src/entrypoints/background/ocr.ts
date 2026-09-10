// OCR 服务（DESIGN §15.2）：查 OCR 缓存，未命中才叫 helper，结果写回。
// 缓存与译文共用一个 Dexie 库（cachePortOf），键由 ocrCacheKey 算——只随图片字节与 helper 版本变。
import { ocrCacheKey } from '@/cache/key'
import { CACHE_READ_BUDGET_MS, type CachePort, type CancelOptions, readWithBudget } from '@/providers/translate-service'
import type { HelperStatus, OcrCall, OcrMessageResponse, OcrResult } from '@/shared/ocr'
import { HelperError, type HelperClient } from './helper'

export interface OcrServiceDeps {
  helper: HelperClient
  cache: CachePort
  /** 读缓存的等待上限（测试用）；默认与译文相同的 CACHE_READ_BUDGET_MS */
  cacheReadBudgetMs?: number
}

export interface OcrService {
  /** `recheck` re-probes a host reported missing; see HelperClient.status */
  status(options?: { recheck?: boolean }): Promise<HelperStatus>
  ocr(call: OcrCall): Promise<OcrMessageResponse>
  /** 撤掉该 scope 排队与在飞的识别；`remember: false` 只排空、不判死（见 `CancelOptions`） */
  cancel(scope: string, options?: CancelOptions): number
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
    status: options => deps.helper.status(options),

    async ocr(call) {
      if (call.scope && cancelled.has(call.scope)) return aborted()
      const status = await deps.helper.status()
      if (!status.available) return { ok: false, error: { kind: 'network', message: status.reason ?? 'helper 不可用' } }
      const key = await ocrCacheKey(call.imageHash, status.version ?? 'unknown')
      // IndexedDB 可能挂住而不是拒绝：超预算当未命中，否则 helper 的超时永远开始不了、消息通道一直开着（Codex 在 #87 指出）
      const [hit] = await readWithBudget(deps.cache, [key], deps.cacheReadBudgetMs ?? CACHE_READ_BUDGET_MS)
      // 查状态 / 读缓存期间被撤：命中也不回结果、更不把活交给 helper（Codex 在 #87 指出）
      if (call.scope && cancelled.has(call.scope)) return aborted()
      // OCR 走的是同一个缓存端口，但它存的是自己的 JSON，与句子对齐无关：只取译文那一栏
      const cached = parseCached(hit?.translation)
      if (cached) return { ok: true, result: cached, cached: true }
      try {
        const { result, version } = await deps.helper.ocr({ image: call.image }, call.scope)
        // 读缓存期间端口断过、重连的 helper 换了版本：按回应所在连接的版本落缓存，别记在旧键下。
        // 写缓存是优化，不等它：IndexedDB 挂住时识别结果照样回去（Codex 在 #87 指出）
        const storeKey = version === status.version ? key : await ocrCacheKey(call.imageHash, version)
        deps.cache.putMany([{ key: storeKey, translation: JSON.stringify(result), paper: call.paper }]).catch((e: unknown) => console.warn('[axt] OCR 结果写缓存失败', e))
        return { ok: true, result, cached: false }
      } catch (e) {
        if (e instanceof HelperError) return { ok: false, error: { kind: e.kind, message: e.message } }
        return { ok: false, error: { kind: 'unknown', message: e instanceof Error ? e.message : String(e) } }
      }
    },

    cancel(scope, { remember = true } = {}) {
      // 判死只给确定的终结用。猜出来的（`tabs.onUpdated` 分不出同文档换 hash 与真的跳走）不能判死：
      // 猜错时页面还活着，它后面滚到的每一张图都会直接 aborted（Codex 在 #143 指出翻译那条改了、
      // 这条没改）
      if (remember) cancelled.add(scope)
      return deps.helper.cancel(scope)
    },
  }
}
