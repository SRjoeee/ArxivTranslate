import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// CLAUDE.md 硬规则 2：任何 ltx_* 选择器只能写在 src/core/rules/latexml.ts，
// 其他 TS 文件通过规则模块访问；唯一例外是 src/styles/*.css（布局要声明式地写在样式表里）。
// 这条规则原来只写在文档里，于是 renderer/side-layout.ts 悄悄攒了 5 处（Codex 在 #22 指出）。
// 这个测试让它自己说话。

const SRC = join(import.meta.dirname, '../../src')
const RULES_MODULE = join(SRC, 'core/rules/latexml.ts')

/** 去掉块注释与行注释，只留会被执行的代码 */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

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
      .map(f => ({ file: f.slice(SRC.length + 1), hits: [...new Set(code(readFileSync(f, 'utf8')).match(/ltx_[A-Za-z0-9_-]*/g) ?? [])] }))
      .filter(x => x.hits.length > 0)
      .map(x => `${x.file}: ${x.hits.join(', ')}`)
    expect(offenders).toEqual([])
  })

  it('扫到的文件数是合理的——避免走查器自己空转', () => {
    expect(files.length).toBeGreaterThan(30)
  })

  it('注释里的 ltx_ 不算违规：走查器确实在剥注释', () => {
    expect(code('// 这里说 .ltx_para\nconst a = 1')).not.toContain('ltx_')
    expect(code('/** .ltx_note 的说明 */\nconst b = 2')).not.toContain('ltx_')
    // 但代码里的要抓到
    expect(code("const c = '.ltx_p'")).toContain('ltx_p')
  })
})
