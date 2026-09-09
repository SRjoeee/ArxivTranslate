// OCR service (DESIGN §15.2): read OCR cache, call the helper only for misses, then cache results.
// Shares the translation Dexie database through cachePortOf. ocrCacheKey depends only on image bytes and helper version.
import { ocrCacheKey } from '@/cache/key'
import { CACHE_READ_BUDGET_MS, type CachePort, readWithBudget } from '@/providers/translate-service'
import type { HelperStatus, OcrCall, OcrMessageResponse, OcrResult } from '@/shared/ocr'
import { HelperError, type HelperClient } from './helper'

export interface OcrServiceDeps {
  helper: HelperClient
  cache: CachePort
  /** Test cache-read budget; defaults to the same CACHE_READ_BUDGET_MS as translation. */
  cacheReadBudgetMs?: number
}

export interface OcrService {
  status(): Promise<HelperStatus>
  ocr(call: OcrCall): Promise<OcrMessageResponse>
  cancel(scope: string): number
}

/** Cached records must match our stored shape; a key collision with other data must not be accepted as an OCR result. */
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
   * Cancelled scopes follow translate-service: subsequent calls with the same scope return aborted.
   * Cancellation can happen while reading cache, before helper enqueue; helper.cancel then has nothing to cancel (observed on device).
   * Session ids are unique; this set grows only with session count.
   */
  const cancelled = new Set<string>()
  const aborted = (): OcrMessageResponse => ({ ok: false, error: { kind: 'aborted', message: 'Session cancelled' } })

  return {
    status: () => deps.helper.status(),

    async ocr(call) {
      if (call.scope && cancelled.has(call.scope)) return aborted()
      const status = await deps.helper.status()
      if (!status.available) return { ok: false, error: { kind: 'network', message: status.reason ?? 'Helper unavailable' } }
      const key = await ocrCacheKey(call.imageHash, status.version ?? 'unknown')
      // IndexedDB may hang instead of reject: treat expiry as a miss, or the helper timeout never starts and the message channel stays open (Codex #87).
      const [hit] = await readWithBudget(deps.cache, [key], deps.cacheReadBudgetMs ?? CACHE_READ_BUDGET_MS)
      // Cancellation during status/cache reads blocks both cached results and helper work (Codex #87).
      if (call.scope && cancelled.has(call.scope)) return aborted()
      const cached = parseCached(hit)
      if (cached) return { ok: true, result: cached, cached: true }
      try {
        const { result, version } = await deps.helper.ocr({ image: call.image }, call.scope)
        // The port may reconnect to a different helper version during cache reads; use the response connection's version for writes, not the old key.
        // Cache writes are an optimization; do not await them, so hung IndexedDB cannot block OCR results (Codex #87).
        const storeKey = version === status.version ? key : await ocrCacheKey(call.imageHash, version)
        deps.cache.putMany([{ key: storeKey, translation: JSON.stringify(result), paper: call.paper }]).catch((e: unknown) => console.warn('[axt] Could not cache OCR result', e))
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
