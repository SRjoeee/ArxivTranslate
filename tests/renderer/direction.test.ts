// 从右往左的目标语言（§7.1）：`lang` 说的是"哪种语言"，段落的基方向由 `dir` 定。
// 不写 `dir` 的话译文继承 arXiv 的 ltr，句末标点、数字、拉丁词、公式全排在错的一侧
// （实测 2509.10652v3 译成阿拉伯语：「مساهمات متساوية.」渲染成「مساهمات .متساوية」）。
import { describe, expect, it } from 'vitest'
import { RTL_LANGUAGES, isRtl, isRtlTag, toBcp47 } from '@/config/languages'
import { extract, type TextBlock } from '@/core/extractor'
import { DIR_ATTR, LANG_ATTR, enable, renderText } from '@/core/renderer'
import { docOf, frag } from './helpers'

describe('RTL 语言表', () => {
  it('12 种从右往左的语言，两种写法都认', () => {
    expect(RTL_LANGUAGES.size).toBe(12)
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
