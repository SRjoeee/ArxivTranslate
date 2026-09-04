import type { AxtResponse } from './messages'

/** background 的 axt:ping 处理函数，抽出来便于单测 */
export function handlePing(version: string): AxtResponse<'axt:ping'> {
  return { ok: true, version }
}
