// 文本节点的转义 / 反转义，按线上格式分派。不折叠任何空白（§6.2 要求保留公式两侧的细空格）。
//
// **不可伪造性**：校验与回填的正确性依赖「请求文本里出现的每个占位符都必然是我们写进去的」。
// - `tags`：转义 & < >，所以原文里字面的 `<` 到不了线上，`<x>` / `<t>` 必是占位符。
// - `markers`：只在 `@` 会引起歧义时把它翻倍，即它后面跟着 `[a-z]*[#@]`——也就是它可能被读成
//   记号 `@abc#`、或被读成转义 `@@` 的头。其余的 `@` 原样过（邮箱 `a@b.com`、装饰器 `@app.route`
//   都不匹配）。解码器左到右先吃 `@@` 再吃记号，因此无歧义。
//   实测 12 篇 fixture 的 5992 个块、956012 个线上字符里只有 5 个 `@`，且没有一个匹配这条转义规则，
//   所以真实语料上的噪声是 0；健全性来自上面的构造，不靠这个统计。
//   `markers` 不做 HTML 转义：这条线是纯文本，`<` 不是结构字符，转义只会给引擎添噪声。
import type { WireFormat } from './tokens'

export function escapeText(s: string, format: WireFormat = 'tags'): string {
  if (format === 'markers') return s.replace(/@(?=[a-z]*[#@])/g, '@@')
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
