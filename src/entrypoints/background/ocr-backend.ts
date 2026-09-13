// The seam the image pipeline reads through (ADR-0002 §2): one interface, today one implementation — the Native
// Messaging helper (`helper.ts`). A hosted recognition service plugs in here when it is built; the OCR service
// (`ocr.ts`) and the cache key do not know which one answers. Cancellation is by scope, as everywhere in the
// background (ADR-0005): a backend that works over `fetch` keeps its own scope → controller map behind `cancel`.
import type { ProviderErrorKind } from '@/providers/types'
import type { HelperStatus, OcrResult } from '@/shared/ocr'

export interface OcrBackend {
  /**
   * Whether the backend can recognise right now, and which build would answer. `recheck` forgets a negative answer
   * the backend remembered (the helper client keeps "host not found" for the worker's life) and probes again
   */
  status(options?: { recheck?: boolean }): Promise<HelperStatus>
  /**
   * Recognise one image. `version` is the build that produced the result — the cache key is computed from it, so a
   * backend whose build can change between calls reports the one that actually answered, not the one `status()` saw
   */
  ocr(request: { image: string }, scope?: string): Promise<{ result: OcrResult; version: string }>
  /** Drop the scope's queued and in-flight recognitions (they reject as `aborted`); returns how many */
  cancel(scope: string): number
}

/** What a backend rejects with: a kind the wire error and the image run's policy understand */
export class OcrBackendError extends Error {
  constructor(readonly kind: ProviderErrorKind, message: string) {
    super(message)
    this.name = 'OcrBackendError'
  }
}
