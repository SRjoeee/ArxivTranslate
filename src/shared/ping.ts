import type { AxtResponse } from './messages'

/**
 * background 的 axt:ping 处理函数，抽出来便于单测。
 * at / bootedAt 是墙钟毫秒：调用方拿自己的发送时刻一减，就能分辨"消息投递慢"还是"SW 冷启动"。
 */
export function handlePing(version: string, at = Date.now(), bootedAt = at): AxtResponse<'axt:ping'> {
  return { ok: true, version, at, bootedAt }
}
