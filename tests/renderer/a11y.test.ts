// 译文节点的无障碍属性。同行的审计（2026-09-06）查的四条——标题跳级、缺 <main>、
// <object> 没标签、表格没 <th>——全是 arXiv/LaTeXML 原始页面就有的，不装扩展也在，
// 而且改它们会违反 §7.1 的 DOM 不变量。真正属于我们的是这里守的几条。
import { describe, expect, it } from 'vitest'
import { extract, type TextBlock } from '@/core/extractor'
import { T_CLASS } from '@/core/marks'
import { LANG_ATTR } from '@/core/renderer/attrs'
import { enable, restore } from '@/core/renderer/page'
import { renderText } from '@/core/renderer/translation'
import { renderPending } from '@/core/renderer/pending'
import { docOf, frag } from './helpers'

describe('译文节点标注语言（同行审计漏掉的一条）', () => {
  it('译文带 lang：页面的 <html lang> 说的是原文，不标的话屏幕阅读器用英文语音念中文', () => {
    const doc = docOf('<p class="ltx_p" id="p1">Hello.</p>')
    doc.documentElement.lang = 'en'
    enable(doc, 'stack', undefined, 'zh-CN')
    const [block] = extract(doc) as TextBlock[]
    const node = renderText(block!, frag(doc, '你好。'))
    expect(node.getAttribute('lang')).toBe('zh-CN')
    // 原文一个字都不动（§7.1）
    expect(block!.el.hasAttribute('lang')).toBe(false)
    expect(doc.documentElement.lang).toBe('en')
  })

  it('语言记在 <html> 上，属于 data-axt-*，恢复原文时跟着清掉', () => {
    const doc = docOf('<p class="ltx_p" id="p1">Hello.</p>')
    const before = doc.documentElement.outerHTML
    enable(doc, 'stack', undefined, 'ja')
    expect(doc.documentElement.getAttribute(LANG_ATTR)).toBe('ja')
    const [block] = extract(doc) as TextBlock[]
    renderText(block!, frag(doc, 'こんにちは。'))
    restore(doc)
    expect(doc.documentElement.outerHTML).toBe(before)
  })

  it('没给语言时不写这个属性：模式切换不该凭空造出一个 lang', () => {
    const doc = docOf('<p class="ltx_p" id="p1">Hello.</p>')
    enable(doc, 'side')
    const [block] = extract(doc) as TextBlock[]
    const node = renderText(block!, frag(doc, '你好。'))
    expect(doc.documentElement.hasAttribute(LANG_ATTR)).toBe(false)
    expect(node.hasAttribute('lang')).toBe(false)
  })
})

describe('纯装饰的副本对屏幕阅读器隐藏', () => {
  it('加载骨架屏带 aria-hidden：逐块的等待状态不该被逐个念出来', () => {
    const doc = docOf('<p class="ltx_p" id="p1">Hello.</p>')
    const [block] = extract(doc) as TextBlock[]
    renderPending(block!)
    const skeleton = doc.querySelector('.axt-skel')!
    expect(skeleton.getAttribute('aria-hidden')).toBe('true')
  })

  it('镜像带 aria-hidden：它是右栏的视觉配平副本，内容与左栏完全相同', async () => {
    const { createMirrors } = await import('@/core/renderer/mirror')
    // 一个已翻译的段落让容器成为镜像容器，一个公式作为镜像目标
    const doc = docOf('<div class="ltx_para"><p class="ltx_p" data-axt-id="p1">A.</p><p class="ltx_p axt-t" data-axt-for="p1">甲。</p><table class="ltx_equation"><tbody><tr><td>x</td></tr></tbody></table></div>')
    const made = createMirrors(doc)
    expect(made).toBeGreaterThan(0)
    const mirrors = [...doc.querySelectorAll('.axt-mirror')]
    expect(mirrors.every(el => el.getAttribute('aria-hidden') === 'true')).toBe(true)
    // aria-hidden 只挡屏幕阅读器，挡不住 Tab：副本里的链接仍在焦点序列里，键盘用户会跳进一个
    // 什么都不播报的装饰副本（A/B 审计在 2401.00596 的参考文献镜像上抓到，issue #72）
    expect(mirrors.every(el => el.hasAttribute('inert'))).toBe(true)
  })

  it('真正的译文不隐藏：它是有信息的内容', () => {
    const doc = docOf('<p class="ltx_p" id="p1">Hello.</p>')
    enable(doc, 'stack', undefined, 'zh-CN')
    const [block] = extract(doc) as TextBlock[]
    const node = renderText(block!, frag(doc, '你好。'))
    expect(node.hasAttribute('aria-hidden')).toBe(false)
    expect(node.classList.contains(T_CLASS)).toBe(true)
  })
})
