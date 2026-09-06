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
}

export interface OcrResult {
  width: number
  height: number
  lines: OcrLine[]
  /** helper 的回应超过大小上限、按置信度丢过行（§15.3）；结果不完整，调用方可据此提示 */
  truncated?: boolean
}

export interface HelperStatus {
  available: boolean
  /** helper 自报的版本；进 OCR 缓存键 */
  version?: string
  /** 不可用时的原因（host 没注册、端口断开……），给设置页显示 */
  reason?: string
}

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
}
