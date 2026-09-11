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
  /** 是哪一种问题；句子在语言包里，这一层不认识界面语言（Codex 在 #161 指出同类问题） */
  reason: 'noSeparator' | 'emptySource' | 'emptyTarget'
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

  // 一行一条。**分号不作分隔符**：译文里出现分号是正常的（`kernel, 核; 统计学中称核函数`），
  // 当成记录分隔会把它悄悄拆成两条不相干的映射（Codex 在 #52 指出）。DESIGN §8.2 写的也是按行分隔
  const lines = text.split('\n')
  let lineNumber = 0
  for (const rawLine of lines) {
    lineNumber++
    const line = rawLine.trim()
    if (line === '' || line.startsWith('#')) continue
    const match = SEPARATOR.exec(line)
    if (!match) {
      issues.push({ line: lineNumber, text: line, reason: 'noSeparator' })
      continue
    }
    const term = line.slice(0, match.index).trim()
    const translation = line.slice(match.index + 1).trim()
    if (term === '') {
      issues.push({ line: lineNumber, text: line, reason: 'emptySource' })
      continue
    }
    if (translation === '') {
      issues.push({ line: lineNumber, text: line, reason: 'emptyTarget' })
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
  return { entries, issues }
}

/** 回写成文本框里的形式，一行一条 */
export function formatGlossaryText(entries: readonly GlossaryEntry[]): string {
  return entries.map(entry => `${entry.term}, ${entry.translation}`).join('\n')
}

/**
 * 只把**这一段真的用到的**术语发出去（DESIGN §8.2，2026-09-11）。
 *
 * 以前每一批都带上整张表：50 条术语约 300 token，而一批正文也就 1000 字上下——请求可能因此
 * 翻倍，模型的注意力被一堆与本段无关的词分走，缓存键里也带着整张表（改一条术语，全站缓存作废）。
 * 匹配之后：请求只带相关的几条，缓存键只在**用到的**术语变化时才变。
 *
 * 匹配的坑逐条对着 Read Frog 的 `utils/glossary/matcher.ts` 抄了教训（他们为此发过两次修复），
 * 但没有抄它的实现：他们要在 2 万条术语上跑，用的是一条编译好的巨型交替式加索引；
 * 我们的量级是一位读者为一篇论文列的几十条，逐条扫足够，代码少一个数量级、也就少一类错。
 *
 * 抄过来的教训：
 * - **术语里的空白要当成"任意空白"**：用户敲的是 `neural network` 一个空格，页面上可能是两个空格、
 *   软换行、不换行空格（HTML 里到处都是）。编译成 `\s+` 才匹配得上
 * - **两边都先 NFC**：`café` 有一码点与两码点两种写法，看着一样、比起来不等
 * - **词边界要按文字系统给**：`net` 不该命中 `network`，但汉字之间本来就没有空格，
 *   对汉字要求边界等于永远匹配不上
 * - **顺序按术语表，不按出现位置**：同一组术语在不同段落里要渲染成同一段提示词，
 *   否则缓存键会按出现顺序碎掉
 */
export interface GlossaryMatcher {
  /** 这段文字用到的术语，按术语表里的顺序 */
  match(text: string): GlossaryEntry[]
  size: number
}

/**
 * 不用空格分词的文字：这一侧不要求词边界。汉字、日文假名、泰文之外，目标语言表里还有
 * 高棉语（khm）、老挝语（lao）、缅甸语（mya）、藏语（bod）也是连写的——少了它们，
 * 这几种语言的术语夹在正文里永远匹配不上（Codex 在 #163 指出）
 */
const SCRIPTS_WITHOUT_SPACES = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Khmer}\p{Script=Lao}\p{Script=Myanmar}\p{Script=Tibetan}]/u
/** 算作"词内部"的字符：两个词字符挨在一起就不是边界 */
const WORD_CHAR = /[\p{L}\p{N}_]/u

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** 这一侧要不要求词边界：术语的边缘字符是词字符、且不是连写的文字，才要求 */
const needsBoundary = (edge: string | undefined): boolean =>
  edge !== undefined && WORD_CHAR.test(edge) && !SCRIPTS_WITHOUT_SPACES.test(edge)

export function createGlossaryMatcher(entries: readonly GlossaryEntry[]): GlossaryMatcher {
  const compiled = entries
    .map(entry => ({ entry, source: entry.term.normalize('NFC').replace(/\s+/g, ' ').trim() }))
    .filter(({ source }) => source !== '')
    .map(({ entry, source }) => ({
      entry,
      // 术语内部的空白 → `\s+`；`g` 是为了逐个命中位置检查边界
      pattern: new RegExp(source.split(' ').map(escapeRegExp).join('\\s+'), 'giu'),
      left: needsBoundary(source[0]),
      right: needsBoundary(source[source.length - 1]),
    }))

  return {
    size: compiled.length,
    match(rawText: string): GlossaryEntry[] {
      if (rawText === '' || compiled.length === 0) return []
      const text = rawText.normalize('NFC')
      const out: GlossaryEntry[] = []
      for (const { entry, pattern, left, right } of compiled) {
        pattern.lastIndex = 0
        let hit = pattern.exec(text)
        while (hit !== null) {
          const before = text[hit.index - 1]
          const after = text[hit.index + hit[0].length]
          // 边界只按术语自己的两端要求：`net` 不进 `network`，而 `C++`、`(a)` 这种以符号收尾的照常命中
          if ((!left || before === undefined || !WORD_CHAR.test(before)) && (!right || after === undefined || !WORD_CHAR.test(after))) {
            out.push(entry)
            break
          }
          // 命中但边界不对：从下一个字符继续找，别把后面真正的那一处漏掉
          pattern.lastIndex = hit.index + 1
          hit = pattern.exec(text)
        }
      }
      return out
    },
  }
}
