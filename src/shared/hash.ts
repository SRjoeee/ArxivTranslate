// 文本指纹（缓存键的组成部分）。按码点而不是 charCodeAt(0)：for…of 按码点迭代，
// 对增补平面字符 charCodeAt(0) 只取高位代理，"😀" 与 "😁" 会同键（Codex 在 #28 指出）。
export function hashText(text: string): string {
  let hash = 5381
  for (const ch of text) hash = ((hash * 33) ^ ch.codePointAt(0)!) >>> 0
  return hash.toString(36)
}
