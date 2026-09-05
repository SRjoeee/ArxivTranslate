// 术语表的文本形式与结构形式互转（DESIGN §8.2）。
// 形状照 KISS 的 parseAITerms（reference/kiss-translator/src/libs/utils.js@c95bd46）：一行一条、逗号分隔，
// 这里加上制表符（方便从表格粘贴）、注释行与行号级的错误报告——论文术语通常是整段粘进来的，
// 静默丢掉写错的那一行会让用户以为术语生效了。
export interface GlossaryEntry {
  term: string
  translation: string
}

export interface GlossaryIssue {
  /** 从 1 开始，对应用户在文本框里看到的行号 */
  line: number
  text: string
  reason: string
}

export interface ParsedGlossary {
  entries: GlossaryEntry[]
  issues: GlossaryIssue[]
}

/** 一行里第一个逗号（半角或全角）或制表符作分隔：译文本身可能含逗号，只切一次 */
const SEPARATOR = /[,，\t]/

/**
 * 解析术语表文本。空行与 `#` 开头的注释行跳过；
 * 同一 term 后面出现的覆盖前面的，但保持**首次出现**的顺序，改一条译法不会让它跳到表尾
 */
export function parseGlossary(text: string): ParsedGlossary {
  const entries: GlossaryEntry[] = []
  const issues: GlossaryIssue[] = []
  const index = new Map<string, number>()

  // 分号也当换行：KISS 允许 `a, 甲; b, 乙` 写在一行
  const lines = text.split('\n')
  let lineNumber = 0
  for (const rawLine of lines) {
    lineNumber++
    for (const part of rawLine.split(';')) {
      const line = part.trim()
      if (line === '' || line.startsWith('#')) continue
      const match = SEPARATOR.exec(line)
      if (!match) {
        issues.push({ line: lineNumber, text: line, reason: '缺少分隔符，应写成「原文, 译文」' })
        continue
      }
      const term = line.slice(0, match.index).trim()
      const translation = line.slice(match.index + 1).trim()
      if (term === '') {
        issues.push({ line: lineNumber, text: line, reason: '原文为空' })
        continue
      }
      if (translation === '') {
        issues.push({ line: lineNumber, text: line, reason: '译文为空' })
        continue
      }
      const existing = index.get(term)
      if (existing === undefined) {
        index.set(term, entries.length)
        entries.push({ term, translation })
      } else {
        entries[existing] = { term, translation }
      }
    }
  }
  return { entries, issues }
}

/** 回写成文本框里的形式，一行一条 */
export function formatGlossaryText(entries: readonly GlossaryEntry[]): string {
  return entries.map(entry => `${entry.term}, ${entry.translation}`).join('\n')
}
