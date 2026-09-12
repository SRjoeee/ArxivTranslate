// The OCR service (DESIGN §15.2): the OCR cache first, the backend only on a miss, the result written back. The
// cache is the Dexie store the translations use (cachePortOf); `ocrCacheKey` derives the key from the image bytes
// and the recognizer's version alone. Which backend answers is `OcrBackend`'s business (ADR-0002).
import { ocrCacheKey } from '@/cache/key'
import type { CancelledScopeRegistry } from '@/providers/request/cancellation'
import { CACHE_READ_BUDGET_MS, type CachePort, readWithBudget } from '@/providers/translate-service'
import type { HelperStatus, OcrCall, OcrMessageResponse, OcrResult } from '@/shared/ocr'
import { type OcrBackend, OcrBackendError } from './ocr-backend'

export interface OcrServiceDeps {
  backend: OcrBackend
  cache: CachePort
  /**
   * Scopes the session router has ended for certain (ADR-0005), the same registry the translate services read.
   * Checked at entry and again after the cache read: a drop can land in that window, when the request is not yet in
   * the helper's queue and `helper.cancel` finds nothing (seen on a real machine)
   */
  cancelled: Pick<CancelledScopeRegistry, 'has'>
  /** 读缓存的等待上限（测试用）；默认与译文相同的 CACHE_READ_BUDGET_MS */
  cacheReadBudgetMs?: number
}

export interface OcrService {
  /** `recheck` re-probes a host reported missing; see OcrBackend.status */
  status(options?: { recheck?: boolean }): Promise<HelperStatus>
  ocr(call: OcrCall): Promise<OcrMessageResponse>
  /** Drain the scope's queued and in-flight recognitions; returns how many. Refusing the scope's later calls is the registry's job */
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

/** Why nothing can be recognised right now — the image run records it as the failure reason */
const unavailable = (status: Exclude<HelperStatus, { state: 'ready' }>): string =>
  status.state === 'not-installed' ? status.reason ?? 'recognition helper not installed'
    : status.state === 'permission-missing' ? 'recognition helper: permission not granted'
    : 'recognition helper: waiting for a fresh background worker'

export function createOcrService(deps: OcrServiceDeps): OcrService {
  const aborted = (): OcrMessageResponse => ({ ok: false, error: { kind: 'aborted', message: '会话已撤销' } })

  return {
    status: options => deps.backend.status(options),

    async ocr(call) {
      if (call.scope && deps.cancelled.has(call.scope)) return aborted()
      const status = await deps.backend.status()
      if (status.state !== 'ready') return { ok: false, error: { kind: 'network', message: unavailable(status) } }
      const key = await ocrCacheKey(call.imageHash, status.version)
      // IndexedDB 可能挂住而不是拒绝：超预算当未命中，否则 helper 的超时永远开始不了、消息通道一直开着（Codex 在 #87 指出）
      const [hit] = await readWithBudget(deps.cache, [key], deps.cacheReadBudgetMs ?? CACHE_READ_BUDGET_MS)
      // Dropped while the status or the cache was being read: a hit is not returned either, and nothing goes to
      // the helper (Codex on #87)
      if (call.scope && deps.cancelled.has(call.scope)) return aborted()
      // OCR 走的是同一个缓存端口，但它存的是自己的 JSON，与句子对齐无关：只取译文那一栏
      const cached = parseCached(hit?.translation)
      if (cached) return { ok: true, result: cached, cached: true }
      try {
        const { result, version } = await deps.backend.ocr({ image: call.image }, call.scope)
        // 读缓存期间端口断过、重连的 helper 换了版本：按回应所在连接的版本落缓存，别记在旧键下。
        // 写缓存是优化，不等它：IndexedDB 挂住时识别结果照样回去（Codex 在 #87 指出）
        const storeKey = version === status.version ? key : await ocrCacheKey(call.imageHash, version)
        deps.cache.putMany([{ key: storeKey, translation: JSON.stringify(result), paper: call.paper }]).catch((e: unknown) => console.warn('[axt] OCR 结果写缓存失败', e))
        return { ok: true, result, cached: false }
      } catch (e) {
        if (e instanceof OcrBackendError) return { ok: false, error: { kind: e.kind, message: e.message } }
        return { ok: false, error: { kind: 'unknown', message: e instanceof Error ? e.message : String(e) } }
      }
    },

    // Drain only: whether the scope is dead from now on is the session router's decision, recorded in the shared
    // registry (ADR-0005) — a guessed end (`tabs.onUpdated` cannot tell a hash change from a navigation) must not
    // leave every image the page scrolls to afterwards aborted (Codex on #143)
    cancel: scope => deps.backend.cancel(scope),
  }
}
