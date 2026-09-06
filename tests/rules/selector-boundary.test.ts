import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// CLAUDE.md 硬规则 2：任何 ltx_* 选择器只能写在 src/core/rules/latexml.ts，
// 其他 TS 文件通过规则模块访问；唯一例外是 src/styles/*.css（布局要声明式地写在样式表里）。
// 这条规则原来只写在文档里，于是 renderer/side-layout.ts 悄悄攒了 5 处（Codex 在 #22 指出）。

const SRC = join(import.meta.dirname, '../../src')
const RULES_MODULE = join(SRC, 'core/rules/latexml.ts')

/**
 * 剥掉注释，保留字符串。**不能用正则**（Codex 在 #79 指出）：
 * `/\/\*[\s\S]*?\*\//` 会把 `'https://arxiv.org/html/*'` 里的 `/*` 当成块注释开头，
 * 一路吞到下一个 `*​/`——实测 `src/entrypoints/content/index.ts` 240 行里第 18–37 行整段消失，
 * `defineContentScript` 连同初始化代码全被跳过，守卫自己开了个 20 行的天窗。
 *
 * 这个状态机只做一件事：认出真正的注释。字符串（含模板串）原样留下，因为选择器就写在那里。
 * 正则字面量不必单独处理——把 `/` 当除号读，里面的 `ltx_` 照样留在输出里，正是想要的结果；
 * 而 `/a*​/` 这种也不会被误认成注释开头（`/` 后面不是 `*` 或 `/`）。
 */
/** `/` 出现在这些词之后开的是正则，不是除号 */
const EXPR_KEYWORDS = ['return', 'typeof', 'instanceof', 'in', 'of', 'case', 'do', 'else', 'yield', 'await', 'delete', 'void', 'new', 'throw']
/** 这些的括号收尾之后同样期望表达式：`if (ready) /re/.test(x)` */
const CONTROL_KEYWORDS = ['if', 'while', 'for', 'switch', 'catch', 'with']

const wordBefore = (out: string) => /[A-Za-z$_][A-Za-z0-9$_]*$/.exec(out.trimEnd())?.[0]

/**
 * 剥掉注释，保留字符串。**不能用正则**（Codex 在 #79 指出）：
 * `/\/\*[\s\S]*?\*\//` 会把 `'https://arxiv.org/html/*'` 里的 `/*` 当成块注释开头，
 * 一路吞到下一个 `*​/`——实测 `src/entrypoints/content/index.ts` 240 行里第 18–37 行整段消失，
 * `defineContentScript` 连同初始化代码全被跳过，守卫自己开了个 20 行的天窗。
 *
 * 认出真注释要先认出**正则字面量**，它的字符类里可以有 `/*`（`/[/*]/`）。判据是标准那条：
 * 斜杠出现在**期望表达式**的位置时才是正则——标点之后、箭头之后、`return` 这类关键字之后
 * （仓库里 mirror.ts 就写着 `return /\S/.test(…)`），以及 `if (…)` / `while (…)` 的括号收尾之后
 * （Codex 在 #79 / #81 分三轮各找到一个入口，所以这里跟踪括号属于谁，而不只看前一个字符）。
 *
 * 启发式终究可能还有没想到的入口，所以另有两道兜底：块注释找不到收尾就**不吞**（认错时最严重的
 * 后果正是一路吞到文件末尾），以及一条逐文件核对"末尾的代码还在不在"的断言。
 * 比例判据试过，没有判别力——这个项目正常文件的注释占比就能到 67%（side-layout.ts）。
 */
function stripComments(text: string): string {
  let out = ''
  let i = 0
  /** 上一个有意义的字符 */
  let prev = ''
  /** 每一层括号是不是 if / while / for 这类控制语句开的 */
  const parens: boolean[] = []
  /** 上一个 `)` 收的是不是控制语句的括号 */
  let afterControlParen = false
  const expectsExpression = () =>
    prev === '' || '(,=:[!&|?+-*%~^{};'.includes(prev) || out.trimEnd().endsWith('=>')
    || EXPR_KEYWORDS.includes(wordBefore(out) ?? '') || afterControlParen
  while (i < text.length) {
    const c = text[i]!
    const next = text[i + 1]
    if (c === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i++
      continue
    }
    if (c === '/' && next !== '*' && expectsExpression()) {
      out += c
      i++
      let inClass = false
      while (i < text.length) {
        const r = text[i]!
        if (r === '\\') { out += r + (text[i + 1] ?? ''); i += 2; continue }
        out += r
        i++
        if (r === '[') inClass = true
        else if (r === ']') inClass = false
        else if (r === '/' && !inClass) break
        else if (r === '\n') break // 没闭合就当它不是正则，别把整份文件吞了
      }
      prev = '/'
      afterControlParen = false
      continue
    }
    if (c === '/' && next === '*') {
      let j = i + 2
      while (j < text.length && !(text[j] === '*' && text[j + 1] === '/')) j++
      // 找不到收尾说明这不是注释——多半是某个没认出来的正则字面量。**不吞**：
      // 一路吞到文件末尾正是最严重的那种失效（守卫全绿、违规全漏，Codex 在 #79 / #81 反复指出）
      if (j >= text.length) { out += c; i++; if (!/\s/.test(c)) prev = c; continue }
      i = j + 2
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c
      out += c
      i++
      while (i < text.length) {
        if (text[i] === '\\') { out += text[i]! + (text[i + 1] ?? ''); i += 2; continue }
        out += text[i]!
        if (text[i] === quote) { i++; break }
        i++
      }
      prev = quote
      afterControlParen = false
      continue
    }
    if (c === '(') parens.push(CONTROL_KEYWORDS.includes(wordBefore(out) ?? ''))
    out += c
    i++
    if (c === ')') afterControlParen = parens.pop() ?? false
    else if (!/\s/.test(c)) afterControlParen = false
    if (!/\s/.test(c)) prev = c
  }
  return out
}

const ltxIn = (text: string) => [...new Set(stripComments(text).match(/ltx_[A-Za-z0-9_-]*/g) ?? [])]


function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const full = join(dir, e.name)
    if (e.isDirectory()) return walk(full)
    return /\.tsx?$/.test(e.name) ? [full] : []
  })
}

describe('ltx_* 选择器只能出现在规则模块里（CLAUDE.md 硬规则 2）', () => {
  const files = walk(SRC).filter(f => f !== RULES_MODULE)

  it('规则模块之外的 TS / TSX 代码里没有 ltx_ 字面量', () => {
    const offenders = files
      .map(f => ({ file: f.slice(SRC.length + 1), hits: ltxIn(readFileSync(f, 'utf8')) }))
      .filter(x => x.hits.length > 0)
      .map(x => `${x.file}: ${x.hits.join(', ')}`)
    expect(offenders).toEqual([])
  })

  it('扫到的文件数是合理的——避免走查器自己空转', () => {
    expect(files.length).toBeGreaterThan(30)
  })

  it('每个文件的最后一行代码都还在——吞到文件末尾就是认错了', () => {
    // 认错一个 `/*` 最严重的后果是一路吞到文件结尾。逐个文件核对末尾的可执行内容还在不在
    const truncated = files
      .map(f => ({ file: f.slice(SRC.length + 1), text: readFileSync(f, 'utf8') }))
      .map(x => ({ ...x, tail: x.text.trimEnd().split('\n').at(-1)?.trim() ?? '' }))
      .filter(x => x.tail !== '' && !stripComments(x.text).includes(x.tail))
      .map(x => `${x.file}: 末尾的 ${JSON.stringify(x.tail.slice(0, 40))} 被吞了`)
    expect(truncated).toEqual([])
  })
})

describe('剥注释不能吞掉代码（Codex 在 #79 指出）', () => {
  it('注释里的 ltx_ 不算违规，代码里的要抓到', () => {
    expect(ltxIn('// 这里说 .ltx_para\nconst a = 1')).toEqual([])
    expect(ltxIn('/** .ltx_note 的说明 */\nconst b = 2')).toEqual([])
    expect(ltxIn("const c = '.ltx_p'")).toEqual(['ltx_p'])
    // 模板串同样算字符串
    expect(ltxIn('const d = `.ltx_td`')).toEqual(['ltx_td'])
  })

  it('字符串里的 /* 不是注释开头：后面的代码必须留下', () => {
    // 正则版会从 URL 里的 /* 一路吞到下一个 */，把 const e 整行吃掉
    const src = "const url = 'https://arxiv.org/html/*'\n/* 普通注释 */\nconst e = '.ltx_abstract'"
    expect(ltxIn(src)).toEqual(['ltx_abstract'])
    expect(stripComments(src)).toContain('const e')
    expect(stripComments(src)).not.toContain('普通注释')
  })

  it('真实文件上不丢内容：content 入口的 defineContentScript 还在', () => {
    // 正则版在这个文件上吞掉第 18–37 行，其中就有整个 defineContentScript 调用
    const text = readFileSync(join(SRC, 'entrypoints/content/index.ts'), 'utf8')
    expect(text).toContain('defineContentScript')
    expect(stripComments(text)).toContain('defineContentScript')
    // 而注释确实被剥掉了
    expect(stripComments(text)).not.toContain('注入 arxiv.org/html/*')
  })

  it('正则字面量与除号不会被当成注释', () => {
    expect(stripComments('const r = /a*/\nconst s = 1')).toContain('const s')
    expect(ltxIn('const r = /ltx_[a-z]+/')).toEqual(['ltx_'])
    expect(stripComments('const q = a / b\nconst t = 2')).toContain('const t')
  })

  it('return / 箭头之后的正则也要认出来（Codex 在 #81 第二轮指出）', () => {
    // 仓库里 mirror.ts 就有 `return /\S/.test(…)` 这种写法
    for (const prefix of ['return', 'const f = () =>', 'if (x) return', 'yield']) {
      const src = `${prefix} /[/*]/\nconst z = '.ltx_theorem'`
      expect(stripComments(src)).toContain('const z')
      expect(ltxIn(src)).toEqual(['ltx_theorem'])
    }
  })

  it('正则的字符类里带 /* 也不会吞掉后面的代码（Codex 在 #81 指出）', () => {
    // `/[/*]/` 的字符类里就有 slash-star；当成块注释开头的话，后面没有 */ 就整份文件作废
    const src = "const re = /[/*]/\nconst z = '.ltx_theorem'"
    expect(stripComments(src)).toContain('const z')
    expect(ltxIn(src)).toEqual(['ltx_theorem'])
  })

  it('控制语句的括号之后也是正则位置（Codex 在 #81 第三轮指出）', () => {
    // 后面**跟一个真注释**，这样"未闭合就不吞"那道兜底救不了：认不出正则的话，
    // 字符类里的 slash-star 会一路吞到真注释的收尾，中间的代码全没
    for (const prefix of ['if (ready)', 'while (x)', 'for (;;)', 'if (a && b)']) {
      const src = `${prefix} /[/*]/.test(v)\nconst z = '.ltx_theorem'\n/* 真注释 */`
      expect(stripComments(src)).toContain('const z')
      expect(ltxIn(src)).toEqual(['ltx_theorem'])
    }
  })

  it('未闭合的块注释一律不吞：启发式万一还有漏网的入口，也不会整份文件作废', () => {
    // 正常代码里不存在未闭合的块注释，遇到它基本可以断定是把某个正则认错了。
    // 宁可把注释文字当代码（顶多误报），也不能静默吞掉后面的违规（Codex 在 #79 / #81 反复指出）
    const src = "const a = 1\n/* 这里没有收尾\nconst z = '.ltx_p'"
    expect(stripComments(src)).toContain('const z')
  })

  it('函数调用的括号之后是除号，不是正则', () => {
    // `f(x) / 2` 里的斜杠必须当除号，否则会把后面的代码吃进"正则"
    const src = "const n = f(x) / 2\nconst z = '.ltx_caption'"
    expect(ltxIn(src)).toEqual(['ltx_caption'])
  })

  it('没闭合的斜杠不会把整份文件吞掉', () => {
    const src = "const a = 1 / 2\nconst b = '.ltx_caption'"
    expect(ltxIn(src)).toEqual(['ltx_caption'])
  })

  it('转义引号不会让字符串提前结束', () => {
    expect(ltxIn(`const a = 'it\\'s /* not a comment */ .ltx_p'`)).toEqual(['ltx_p'])
  })
})
