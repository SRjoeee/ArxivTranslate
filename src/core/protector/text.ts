// 文本节点的转义 / 反转义，按线上格式分派。不折叠任何空白（§6.2 要求保留公式两侧的细空格）。
//
// **不可伪造性**：校验与回填的正确性依赖「请求文本里出现的每个占位符都必然是我们写进去的」。
// - `tags`：转义 & < >，所以原文里字面的 `<` 到不了线上，`<x>` / `<t>` 必是占位符。
// - `markers`：**无条件**把每个 `@` 翻倍。转义后每段字面文本里的 `@` 个数必为偶数，
//   解码器左到右先吃 `@@`、成对消耗，剩下的单个 `@` 必然是记号的开头，因此无歧义。
//
//   **转义必须与上下文无关**，这是要害。第一版只在「`@` 后面跟着 `[a-z]*[#@]`」时翻倍，看起来更省，
//   但序列化是逐个文本节点转义再拼接的，歧义会在**拼接处**产生：`<p>@<math/></p>` 里的文本节点 `@`
//   单独看后面没东西、不转义，拼上占位符就成了 `@@a#`，分词器读成字面量 `@`，占位符凭空消失
//   （Codex 在 #107 指出）。`tags` 没这个问题，正因为它的转义（`& < >`）也是无条件的。
//   代价实测：12 篇 fixture 的 5992 个块、779160 个 markers 线上字符里只有 5 处 `@`（邮箱与 `@app.route`），
//   翻倍一共多 5 个字符。
//   `markers` 不做 HTML 转义：这条线是纯文本，`<` 不是结构字符，转义只会给引擎添噪声。
import type { WireFormat } from './tokens'

export function escapeText(s: string, format: WireFormat = 'tags'): string {
  if (format === 'markers') return s.replace(/@/g, '@@')
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// nbsp 写成转义序列：字面的 U+00A0 会被文本工具悄悄归一成普通空格（改这个文件时踩过）
const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' }

export function decodeText(s: string, format: WireFormat = 'tags'): string {
  // markers 的 `@@` 已经在 tokenize 里还原；这条线上没有实体，解实体反而会把原文的字面量 `&amp;` 吃掉
  if (format === 'markers') return s
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body: string) => {
    if (body.startsWith('#')) {
      const hex = body[1]?.toLowerCase() === 'x'
      const code = hex ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10)
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match
    }
    return NAMED[body.toLowerCase()] ?? match
  })
}

/**
 * **纯文本往返专用**的反转义：标题（§10）与 OCR 行走的是「escapeText → 翻译 → 这里」，
 * 中间没有分词器，所以 `@@` 得在这一步还原。占位符路径不要用它——那条线的 `@@` 已经在
 * `tokenize` 里还原过，再来一遍会把字面量 `@@` 吃成 `@`（Codex 在 #107 指出这条不对称）。
 * `replace` 与分词器一样从左到右不重叠匹配，所以 `@@@@` → `@@`、`@@@@@` → `@@@`，两边一致
 */
export function unescapeText(s: string, format: WireFormat = 'tags'): string {
  return format === 'markers' ? s.replace(/@@/g, '@') : decodeText(s, format)
}
