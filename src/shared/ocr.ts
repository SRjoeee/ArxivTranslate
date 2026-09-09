// Shared image translation types (DESIGN §15): content requests OCR, background calls the helper; both use the same data shape.
// Do not import Dexie/providers here: they must stay out of the content bundle (§8.0).
import type { ProviderErrorKind } from '@/providers/types'

/** Native Messaging host name, written to the manifest by helper/install.sh. */
export const HELPER_HOST = 'io.github.srjoeee.arxivtranslate'
/** Matches PROTOCOL in helper/Sources/axt-helper/main.swift. */
export const HELPER_PROTOCOL = 1

/** Normalized corners with top-left origin: [top-left, top-right, bottom-right, bottom-left] (§15.3). */
export type Quad = [[number, number], [number, number], [number, number], [number, number]]

export interface OcrLine {
  text: string
  quad: Quad
  /** Vision confidence, 0–1. */
  conf: number
}

export interface OcrResult {
  width: number
  height: number
  lines: OcrLine[]
  /** Helper response exceeded the size limit and dropped lines by confidence (§15.3); callers can flag incomplete results. */
  truncated?: boolean
  /** Frame count: >1 means animated; the helper recognizes only frame 0, and the extension does not overlay animated images. */
  frames?: number
}

export interface HelperStatus {
  available: boolean
  /** Helper-reported version, included in OCR cache keys. */
  version?: string
  /** Unavailability reason (unregistered host, disconnected port, etc.), displayed in settings. */
  reason?: string
}

/** content → background: OCR an image. Content already hashed its bytes; background uses that hash for cache lookup. */
export interface OcrCall {
  /** SHA-256 of image bytes (shared/digest.ts). */
  imageHash: string
  /** Base64-encoded image bytes. */
  image: string
  mime: string
  /** Paper id used to index cache entries for clearing together. */
  paper: string
  /** Session id: cancel queued recognition on restore or tab close. */
  scope?: string
}

export type OcrMessageResponse =
  | { ok: true; result: OcrResult; cached: boolean }
  | { ok: false; error: { kind: ProviderErrorKind; message: string } }

/** Serializable image progress for popup (like Progress): total, viewport-triggered, completed and failed. */
export interface ImageProgress {
  total: number
  requested: number
  done: number
  failed: number
  /** Stop reason after configuration errors (auth/no-key); popup uses it to avoid offering ineffective retries. */
  fatal?: string
}
