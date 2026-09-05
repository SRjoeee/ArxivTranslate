import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CUSTOM_STYLE_SELECTOR, STYLE_PRESETS, STYLE_ATTR_NAME, customStyleRule, enable, restore, sanitizeCustomCss } from '@/core/renderer'
import { docOf } from './helpers'

const CSS = readFileSync(join(import.meta.dirname, '../../src/styles/presets.css'), 'utf8')
/** 注释里也写着属性名，做文本断言前先去掉 */
const RULES = CSS.replace(/\/\*[\s\S]*?\*\//g, '')

describe('样式预设（§7.5）', () => {
  it('每个预设都有对应规则，none 只是"不加装饰"所以没有规则', () => {
    for (const preset of STYLE_PRESETS) {
      const has = RULES.includes(`html[data-axt-style="${preset}"]`)
      // none 是默认（不写规则）；custom 的规则由 customStyleRule 运行时拼
      expect(has).toBe(preset !== 'none' && preset !== 'custom')
    }
  })

  it('预设只做叠加装饰，不写会与站点打架的属性（§7.5 的实测教训）', () => {
    // font: inherit 曾把摘要标题的 1.4rem 覆盖成父级默认值；display / margin 会破坏 side 的网格配对
    for (const property of ['font:', 'font-size', 'font-family', 'line-height', 'display:', 'margin:', 'margin-top', 'width:']) {
      expect(RULES).not.toContain(property)
    }
  })

  it('quote 不加在行内标题译文上：会把「Abstract 摘要」这类同行标题挤歪', () => {
    expect(RULES).toMatch(/html\[data-axt-style="quote"\] \.axt-t:not\(\[data-axt-inline\]\)/)
  })

  it('enable 把预设写到 <html>，与模式属性同层', () => {
    const doc = docOf('<p class="ltx_p" id="p1">Text.</p>')
    enable(doc, 'stack', { preset: 'quote', customCss: '' })
    expect(doc.documentElement.getAttribute(STYLE_ATTR_NAME)).toBe('quote')
    expect(doc.documentElement.getAttribute('data-axt-mode')).toBe('stack')
  })

  it('不传样式时不写这个属性：模式切换不该动样式', () => {
    const doc = docOf('<p class="ltx_p" id="p1">Text.</p>')
    enable(doc, 'stack')
    expect(doc.documentElement.hasAttribute(STYLE_ATTR_NAME)).toBe(false)
  })

  it('自定义 CSS 被包进我们给的选择器里，改了会重写样式表', () => {
    const doc = docOf('<p class="ltx_p" id="p1">Text.</p>')
    enable(doc, 'stack', { preset: 'custom', customCss: 'color: #1565c0;' })
    const sheet = doc.querySelector('style[data-axt-sheet="modes"]')!
    expect(sheet.textContent).toContain(`${CUSTOM_STYLE_SELECTOR} {`)
    expect(sheet.textContent).toContain('color: #1565c0;')
    // 再次 enable 用新的自定义 CSS：同一个 <style> 元素被更新，不叠加第二份
    enable(doc, 'stack', { preset: 'custom', customCss: 'color: red;' })
    expect(doc.querySelectorAll('style[data-axt-sheet="modes"]')).toHaveLength(1)
    expect(doc.querySelector('style[data-axt-sheet="modes"]')!.textContent).toContain('color: red;')
  })

  it('恢复原文把样式表和属性一起清掉，DOM 逐节点相等（§7.1）', () => {
    const doc = docOf('<p class="ltx_p" id="p1">Text.</p>')
    const before = doc.documentElement.outerHTML
    enable(doc, 'side', { preset: 'quote', customCss: '' })
    restore(doc)
    expect(doc.documentElement.outerHTML).toBe(before)
  })
})

describe('sanitizeCustomCss', () => {
  it('普通声明放行，首尾空白去掉', () => {
    expect(sanitizeCustomCss('  color: #1565c0; opacity: .9;  ')).toEqual({ ok: true, css: 'color: #1565c0; opacity: .9;' })
    expect(sanitizeCustomCss('')).toEqual({ ok: true, css: '' })
    expect(sanitizeCustomCss('   ')).toEqual({ ok: true, css: '' })
  })

  it('花括号被拒：一个多余的括号会把整篇论文的排版改掉，而且很难看出原因', () => {
    expect(sanitizeCustomCss('color: red; } body { display: none;')).toMatchObject({ ok: false })
    expect(sanitizeCustomCss('.foo { color: red; }')).toMatchObject({ ok: false })
  })

  it('@ 规则与 < 被拒', () => {
    expect(sanitizeCustomCss('@import url(x)')).toMatchObject({ ok: false })
    expect(sanitizeCustomCss('color: red; </style>')).toMatchObject({ ok: false })
  })

  it('customStyleRule：空串不产生空规则，非法输入不产生规则', () => {
    expect(customStyleRule('')).toBe('')
    expect(customStyleRule('   ')).toBe('')
    expect(customStyleRule('color: red; }')).toBe('')
    expect(customStyleRule('color: red;')).toBe(`${CUSTOM_STYLE_SELECTOR} {\ncolor: red;\n}\n`)
  })
})
