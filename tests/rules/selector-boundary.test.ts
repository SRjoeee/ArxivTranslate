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
function stripComments(text: string): string {
  let out = ''
  let i = 0
  while (i < text.length) {
    const c = text[i]!
    const next = text[i + 1]
    if (c === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i++
      continue
    }
    if (c === '/' && next === '*') {
      i += 2
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++
      i += 2
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
      continue
    }
    out += c
    i++
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

  it('转义引号不会让字符串提前结束', () => {
    expect(ltxIn(`const a = 'it\\'s /* not a comment */ .ltx_p'`)).toEqual(['ltx_p'])
  })
})
