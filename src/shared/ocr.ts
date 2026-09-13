// The shared types of image translation (DESIGN §15): the content side sends OCR requests, the background calls the
// helper, and both must agree on one shape. Neither Dexie nor a provider is imported here; the content bundle must not carry them (§8.0).
import type { ProviderErrorKind } from '@/providers/types'

/** The Native Messaging host name (the one helper/install.sh writes into the manifest) */
export const HELPER_HOST = 'io.github.srjoeee.arxivtranslate'
/** Matches PROTOCOL in helper/Sources/axt-helper/main.swift */
export const HELPER_PROTOCOL = 1

/** Normalised corners, top-left origin: [top-left, top-right, bottom-right, bottom-left] (§15.3) */
export type Quad = [[number, number], [number, number], [number, number], [number, number]]

export interface OcrLine {
  text: string
  quad: Quad
  /** Vision's confidence, 0–1 */
  conf: number
  /**
   * Text direction in radians, absent when upright. Only the SVG path (§15.5) sets it, from the
   * glyph transform; Vision's quads are axis-aligned in practice and the helper leaves it off.
   */
  angle?: number
  /**
   * The label's own box when it is not axis-aligned, as fractions of the figure's **width** —
   * `len` along the baseline, `thick` across it. The quad's axis-aligned bounds are bigger than a
   * tilted label and in two different scales (x of the width, y of the height), so they cannot
   * place it; these can, and a single axis keeps the two comparable (§15.5). Set by the glyph path
   * whenever `angle` is; absent means the overlay falls back to the axis-aligned box.
   */
  len?: number
  thick?: number
  /**
   * How many rendered lines the quad spans, when the source knows. Only the inline-picture path
   * (§15.6) sets it — a TikZ label is one node whatever it wraps to, and the overlay sizes its font
   * by the box height divided by this. OCR and glyph runs are one line each and leave it off.
   */
  rows?: number
}

export interface OcrResult {
  width: number
  height: number
  lines: OcrLine[]
  /** The helper's reply exceeded the size cap and lines were dropped by confidence (§15.3); the result is incomplete, and the caller may say so */
  truncated?: boolean
  /** The image's frame count; > 1 is an animation, the helper recognised frame 0 only, and the extension overlays no translation on animations */
  frames?: number
}

/**
 * Where the recognition helper stands (ADR-0002 §3, plus the one state the implementation needed):
 * - `permission-missing`: the optional `nativeMessaging` permission is not granted, so nothing can be asked of the
 *   helper. The popup and the settings page request it from the reader's own click.
 * - `restarting`: granted a moment ago, while the background worker was already running. Chrome adds an API to a
 *   context when the context is created, never later (verified 2026-09-13), so this worker cannot connect; an alarm
 *   brings a fresh one once it has gone idle, and the pages are told what that one found.
 * - `not-installed`: no usable helper answered — host not registered, handshake refused, wrong protocol; `reason`
 *   says which. The guided install is the way out of all of them.
 * - `ready`: the helper answered the handshake; `version` is what it reported and goes into the OCR cache key.
 */
export type HelperStatus =
  | { state: 'permission-missing' }
  | { state: 'restarting' }
  | { state: 'not-installed'; reason?: string }
  | { state: 'ready'; version: string }
export type HelperState = HelperStatus['state']

/** content → background: OCR one image. The bytes were hashed on the content side already; the background looks the cache up by the hash alone */
export interface OcrCall {
  /** The SHA-256 of the image bytes (shared/digest.ts) */
  imageHash: string
  /** The image bytes, base64-encoded */
  image: string
  mime: string
  /** The paper id; cache records are indexed by it (cleared together) */
  paper: string
  /** The session id: queued recognitions are withdrawn on restore / tab close */
  scope?: string
}

export type OcrMessageResponse =
  | { ok: true; result: OcrResult; cached: boolean }
  | { ok: false; error: { kind: ProviderErrorKind; message: string } }

/** The image translation's progress (serialisable like Progress, for the popup): total, entered the viewport, done, failed */
export interface ImageProgress {
  total: number
  requested: number
  done: number
  failed: number
  /** Why it stopped after a configuration-level error (auth / no-key); the popup offers no futile retry by it */
  fatal?: string
}
