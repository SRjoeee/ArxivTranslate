// 从右往左的目标语言（§7.1）：`lang` 说的是"哪种语言"，段落的基方向由 `dir` 定。
// 不写 `dir` 的话译文继承 arXiv 的 ltr，句末标点、数字、拉丁词、公式全排在错的一侧
// （实测 2509.10652v3 译成阿拉伯语：「مساهمات متساوية.」渲染成「مساهمات .متساوية」）。
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { RTL_LANGUAGES, isRtl, isRtlTag, toBcp47 } from '@/config/languages'
import { extract, type TableBlock, type TextBlock } from '@/core/extractor'
import { DIR_ATTR, LANG_ATTR, enable, renderTable, renderText } from '@/core/renderer'
import { TABLE_RULES } from '@/core/rules/latexml'
import { docOf, frag } from './helpers'

describe('RTL 语言表', () => {
  it('13 种从右往左的语言，两种写法都认', () => {
    expect(RTL_LANGUAGES.size).toBe(13)
    for (const code of ['arb', 'heb', 'pes', 'urd', 'uig', 'ckb']) {
      expect([code, isRtl(code)]).toEqual([code, true])
      expect([code, isRtlTag(toBcp47(code))]).toEqual([code, true])
    }
    // 三个没有两字母码的（回落成 639-3 发给引擎）同样要认出来
    for (const code of ['prs', 'pbu', 'skr']) expect([code, isRtlTag(toBcp47(code))]).toEqual([code, true])
    for (const code of ['cmn', 'eng', 'jpn', 'rus', 'kmr']) {
      expect([code, isRtl(code)]).toEqual([code, false])
      expect([code, isRtlTag(toBcp47(code))]).toEqual([code, false])
    }
  })

  it('大小写与地区子标签都不影响判定', () => {
    expect(isRtlTag('AR')).toBe(true)
    expect(isRtlTag('ar-EG')).toBe(true)
    expect(isRtlTag('zh-Hans')).toBe(false)
  })

  // Codex 在 #163 指出：zlm 发出去的标签是 ms-Arab（爪夷文），按主子标签判会漏成 ltr；
  // 而把 ms 直接当成 RTL 主子标签又会把拉丁字母的马来语误判成 rtl。文字子标签在场就由它说话
  it('文字子标签比主语言更能定方向：ms-Arab 是 rtl，ms 不是', () => {
    expect(toBcp47('zlm')).toBe('ms-Arab')
    expect(isRtl('zlm')).toBe(true)
    expect(isRtlTag('ms-Arab')).toBe(true)
    expect(isRtlTag('MS-ARAB')).toBe(true)
    expect(isRtlTag('ms')).toBe(false)
    expect(isRtlTag('ms-MY')).toBe(false)
  })

  it('RTL 语言配上拉丁文字就是 ltr，反向也成立', () => {
    expect(isRtlTag('ur-Latn')).toBe(false)
    expect(isRtlTag('ar-Latn-EG')).toBe(false)
    expect(isRtlTag('he-Hebr')).toBe(true)
    // 四位但以数字开头的是变体子标签，不是文字：别拿它当 script 判
    expect(isRtlTag('ar-1901')).toBe(true)
  })
})

describe('译文节点的 dir', () => {
  const blockOf = (doc: Document) => (extract(doc) as TextBlock[])[0]!

  it('RTL 目标：<html> 记一次，译文节点逐个抄', () => {
    const doc = docOf('<div class="ltx_para"><p class="ltx_p" id="p1">Equal contributions.</p></div>')
    enable(doc, 'stack', undefined, 'ar')
    expect(doc.documentElement.getAttribute(DIR_ATTR)).toBe('rtl')
    const node = renderText(blockOf(doc), frag(doc, 'مساهمات متساوية.'))
    expect(node.getAttribute('dir')).toBe('rtl')
    expect(node.getAttribute('lang')).toBe('ar')
    // 原节点一个属性都不多（§7.1 只允许 data-axt-*）
    expect(blockOf(doc).el.hasAttribute('dir')).toBe(false)
  })

  it('从左往右的目标：一个 dir 都不写', () => {
    const doc = docOf('<div class="ltx_para"><p class="ltx_p" id="p1">Text.</p></div>')
    enable(doc, 'stack', undefined, 'zh')
    expect(doc.documentElement.hasAttribute(DIR_ATTR)).toBe(false)
    expect(renderText(blockOf(doc), frag(doc, '文本。')).hasAttribute('dir')).toBe(false)
  })

  it('换目标语言时标记要跟着走，否则中文译文还挂着上一轮的 rtl', () => {
    const doc = docOf('<div class="ltx_para"><p class="ltx_p" id="p1">Text.</p></div>')
    enable(doc, 'stack', undefined, 'he')
    expect(doc.documentElement.getAttribute(DIR_ATTR)).toBe('rtl')
    enable(doc, 'stack', undefined, 'zh')
    expect(doc.documentElement.hasAttribute(DIR_ATTR)).toBe(false)
    expect(doc.documentElement.getAttribute(LANG_ATTR)).toBe('zh')
  })
})

// 表格走 renderTable，不经 renderText——这条路上 `lang` 与 `dir` 原本都漏了
// （Codex 在 #163 指出 `dir`；`lang` 是同一处的同一个洞，屏幕阅读器会用英文语音念表里的中文）
describe('译文表格单元格的 lang / dir', () => {
  const table =
    '<figure class="ltx_table" id="F1"><table class="ltx_tabular" id="T1"><tbody>'
    + '<tr><th class="ltx_td ltx_th" id="h1">Model</th><td class="ltx_td">91.2</td></tr>'
    + '</tbody></table><figcaption class="ltx_caption">Table 1</figcaption></figure>'
  const tableOf = (doc: Document) => extract(doc).find(b => b.kind === 'table') as TableBlock

  it('RTL 目标：换过内容的格带 dir 与 lang，表本身不带——带了会连列序一起翻转', () => {
    const doc = docOf(table)
    enable(doc, 'stack', undefined, 'ar')
    const t = tableOf(doc)
    const node = renderTable(t, new Map([[t.cells[0]!.el, frag(doc, 'نموذج')]]))
    expect(node.hasAttribute('dir')).toBe(false)
    const cells = Array.from(node.querySelectorAll(TABLE_RULES.cell))
    expect(cells[0]!.getAttribute('dir')).toBe('rtl')
    expect(cells[0]!.getAttribute('lang')).toBe('ar')
    // 没换内容的数值格保持原样：那里装的还是原文
    expect(cells[1]!.hasAttribute('dir')).toBe(false)
    expect(cells[1]!.hasAttribute('lang')).toBe(false)
    // 原表一个属性都不多（§7.1）
    expect(t.cells[0]!.el.hasAttribute('dir')).toBe(false)
    expect(t.cells[0]!.el.hasAttribute('lang')).toBe(false)
  })

  it('LTR 目标：只写 lang，不写 dir', () => {
    const doc = docOf(table)
    enable(doc, 'stack', undefined, 'zh')
    const t = tableOf(doc)
    const node = renderTable(t, new Map([[t.cells[0]!.el, frag(doc, '模型')]]))
    const cell = node.querySelectorAll(TABLE_RULES.cell)[0]!
    expect(cell.getAttribute('lang')).toBe('zh')
    expect(cell.hasAttribute('dir')).toBe(false)
  })
})

// happy-dom 没有双向算法，这里守规则本身（§7.1）
describe('modes.css 的 RTL 规则', () => {
  const RULES = readFileSync(join(import.meta.dirname, '../../src/styles/modes.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

  it('受保护的原文原子在 rtl 译文里都按 ltr 排，并且互相隔离', () => {
    const rule = /html\[data-axt-dir="rtl"\] \.axt-t :is\(([^)]*)\) \{([^}]*)\}/.exec(RULES)
    expect(rule).not.toBeNull()
    // 公式之外，占位符回填进来的原文原子同样要管：行内代码、打字机体、引用、URL，
    // 以及边注副本里那段英文原文（Codex 在 #163 指出原来只管了公式）
    for (const sel of ['math', '.ltx_Math', '.ltx_ref', '.ltx_url', '.ltx_listing', 'code', '.ltx_font_typewriter', '.axt-note-s']) {
      expect([sel, rule![1]!.includes(sel)]).toEqual([sel, true])
    }
    expect(rule![2]).toMatch(/direction:\s*ltr/)
    // isolate 才能让 `f(x)` 末尾的中性字符不被周围的 rtl 拉走
    expect(rule![2]).toMatch(/unicode-bidi:\s*isolate/)
  })
})
