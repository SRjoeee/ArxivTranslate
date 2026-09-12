// 图片翻译的共享类型（DESIGN §15）：content 发 OCR 请求、background 调 helper、两边都要认同一份形状。
// 这里不引用 Dexie 与 provider，content 的包不能带上它们（§8.0）。
import type { ProviderErrorKind } from '@/providers/types'

/** Native Messaging 的 host 名（helper/install.sh 写进 manifest 的那个） */
export const HELPER_HOST = 'io.github.srjoeee.arxivtranslate'
/** 与 helper/Sources/axt-helper/main.swift 的 PROTOCOL 一致 */
export const HELPER_PROTOCOL = 1

/** 归一化四角，左上原点：[左上, 右上, 右下, 左下]（§15.3） */
export type Quad = [[number, number], [number, number], [number, number], [number, number]]

export interface OcrLine {
  text: string
  quad: Quad
  /** Vision 的置信度 0–1 */
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
  /** helper 的回应超过大小上限、按置信度丢过行（§15.3）；结果不完整，调用方可据此提示 */
  truncated?: boolean
  /** 图片的帧数；> 1 是动图，helper 只识别了第 0 帧，扩展不给动图叠译文 */
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

/** content → background：给一张图做 OCR。图片字节已经在 content 侧哈希过，background 只按它查缓存 */
export interface OcrCall {
  /** 图片字节的 SHA-256（shared/digest.ts） */
  imageHash: string
  /** base64 编码的图片字节 */
  image: string
  mime: string
  /** 论文 id，缓存记录按它索引（清缓存时一起清） */
  paper: string
  /** 会话 id：恢复原文 / 关标签页时撤掉排队的识别 */
  scope?: string
}

export type OcrMessageResponse =
  | { ok: true; result: OcrResult; cached: boolean }
  | { ok: false; error: { kind: ProviderErrorKind; message: string } }

/** 图片翻译的进度（与 Progress 同样可序列化，popup 显示用）：总数、进入过视口的、翻完的、失败的 */
export interface ImageProgress {
  total: number
  requested: number
  done: number
  failed: number
  /** 配置级错误（auth / no-key）后停下的原因；popup 据此不再给无效的重试 */
  fatal?: string
}
