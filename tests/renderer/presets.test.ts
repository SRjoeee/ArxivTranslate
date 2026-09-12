import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BLUR_ATTR, UNDERLINE_ATTR } from '@/core/renderer/attrs'
import { enable, restore } from '@/core/renderer/page'
import { CUSTOM_STYLE_SELECTOR } from '@/core/renderer/style-preset'
import { sanitizeCustomCss } from '@/core/renderer/style-values'
import { UNDERLINES } from '@/config/appearance'
import { docOf } from './helpers'
import { LOOK, lookWith } from './looks'

const CSS = readFileSync(join(import.meta.dirname, '../../src/styles/presets.css'), 'utf8')
/** 注释里也写着属性名，做文本断言前先去掉 */
const RULES = CSS.replace(/\/\*[\s\S]*?\*\//g, '')

describe('译文外观（§7.5）', () => {
  it('四种线型各有一条变量规则，没有别的预设 id 残留', () => {
    for (const underline of UNDERLINES) {
      const has = RULES.includes(`[data-axt-underline="${underline}"]`)
      expect([underline, has]).toEqual([underline, underline !== 'none'])
    }
    // v12 之前每种效果一个 id；现在值全部走变量，属性只剩两个开关
    expect(RULES).not.toContain('data-axt-style')
  })

  it('外观只做叠加装饰，不写会与站点打架的属性（§7.5 的实测教训）', () => {
    // font: inherit 曾把摘要标题的 1.4rem 覆盖成父级默认值；display / margin 会破坏 side 的网格配对
    for (const property of ['font:', 'font-size', 'font-family', 'line-height', 'display:', 'margin:', 'margin-top', 'width:']) {
      expect(RULES).not.toContain(property)
    }
  })

  it('下划线必须显式画到 math / inline-block 上：text-decoration 不传播到原子行内盒', () => {
    // 用户反馈的漏线就是这个：公式与行内盒处虚线断掉（2026-09-05 实测 text-decoration-line 计算值为 none）
    expect(RULES).toMatch(/html\[data-axt-underline\] :is\(\.axt-t[\s\S]*?:is\(math, \.ltx_inline-block, svg, img\)\)/)
  })

  it('共享规则按「有下划线」匹配，不是对所有译文写 text-decoration：否则会把站点给链接画的线抹掉', () => {
    expect(RULES).not.toMatch(/html\[data-axt-on\][^{]*\.axt-t[^{]*\{[^}]*text-decoration/)
  })

  it('线型与线宽都来自变量：粗细由配置的 thickness 决定，颜色跟随文字颜色', () => {
    expect(RULES).toContain('text-decoration-thickness: var(--axt-deco-thickness, 1px)')
    expect(RULES).toContain('text-decoration: underline var(--axt-deco-style) var(--axt-color, var(--axt-deco-color))')
  })

  it('模糊尊重系统的「减少动态效果」：悬停清晰的过渡停掉', () => {
    const reduced = /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/.exec(RULES)
    expect(reduced).not.toBeNull()
    expect(reduced![1]).toMatch(/data-axt-blur[^{]*\{[^}]*transition: none/)
  })

  it('没有持续动画：改样式的动画在长论文上要烧 CPU（Codex 在 #52 指出）', () => {
    // 实测 600 个译文块 4 秒内的主线程任务：glow 的 text-shadow 动画 1028 ms、gradient 的
    // background-position 动画 573 ms。v12 把这些效果整个删掉了，关键帧也不该再有
    expect(RULES).not.toContain('@keyframes')
    expect(RULES).not.toMatch(/animation:\s*axt-/)
  })

  it('装饰一律不落到骨架屏、失败控件与 side 模式的结构性克隆上：它们也带 .axt-t 但不是译文（Codex 在 #52 指出）', () => {
    // 模糊会把镜像到右栏的公式糊掉；透明度会把「重试」按钮一起淡掉
    for (const line of RULES.split('\n')) {
      if (!line.includes('.axt-t')) continue
      const excluded = ['.axt-pending', '.axt-error', '.axt-mirror', '.axt-split'].every(c => line.includes(c))
      expect([line, excluded]).toEqual([line, true])
    }
  })

  it('enable 把下划线与模糊写到 <html>，与模式属性同层', () => {
    const doc = docOf('<p class="ltx_p" id="p1">Text.</p>')
    enable(doc, 'stack', lookWith({ underline: 'wavy', blur: true }))
    expect(doc.documentElement.getAttribute(UNDERLINE_ATTR)).toBe('wavy')
    expect(doc.documentElement.hasAttribute(BLUR_ATTR)).toBe(true)
    expect(doc.documentElement.getAttribute('data-axt-mode')).toBe('stack')
  })

  it('不传外观时这两个属性都不写：模式切换不该动外观', () => {
    const doc = docOf('<p class="ltx_p" id="p1">Text.</p>')
    enable(doc, 'stack')
    expect(doc.documentElement.hasAttribute(UNDERLINE_ATTR)).toBe(false)
    expect(doc.documentElement.hasAttribute(BLUR_ATTR)).toBe(false)
  })

  it('换成不带下划线 / 模糊的配置时属性要拿掉，不能留在上一份的状态里', () => {
    const doc = docOf('<p class="ltx_p" id="p1">Text.</p>')
    enable(doc, 'stack', lookWith({ underline: 'dashed', blur: true }))
    enable(doc, 'stack', LOOK)
    expect(doc.documentElement.hasAttribute(UNDERLINE_ATTR)).toBe(false)
    expect(doc.documentElement.hasAttribute(BLUR_ATTR)).toBe(false)
  })

  it('高级 CSS 被包进我们给的选择器里，改了会重写样式表', () => {
    const doc = docOf('<p class="ltx_p" id="p1">Text.</p>')
    enable(doc, 'stack', lookWith({ css: 'color: #1565c0;' }))
    const sheet = doc.querySelector('style[data-axt-sheet="modes"]')!
    expect(sheet.textContent).toContain(`${CUSTOM_STYLE_SELECTOR} {`)
    expect(sheet.textContent).toContain('color: #1565c0;')
    // 再次 enable 用新的声明：同一个 <style> 元素被更新，不叠加第二份
    enable(doc, 'stack', lookWith({ css: 'color: teal;' }))
    expect(doc.querySelectorAll('style[data-axt-sheet="modes"]')).toHaveLength(1)
    expect(doc.querySelector('style[data-axt-sheet="modes"]')!.textContent).toContain('color: teal;')
  })

  it('声明块只收声明：花括号、@ 规则、`<` 一律拒掉（防手滑，不是安全边界）', () => {
    expect(sanitizeCustomCss('color: red')).toEqual({ ok: true, css: 'color: red' })
    expect(sanitizeCustomCss('')).toEqual({ ok: true, css: '' })
    for (const bad of ['a { color: red }', 'color: red }', '@media print { }', '</style>']) {
      expect([bad, sanitizeCustomCss(bad).ok]).toEqual([bad, false])
    }
  })

  it('恢复原文后 <html> 上的外观属性一起消失（§7.1 第 4 条）', () => {
    const doc = docOf('<p class="ltx_p" id="p1">Hello.</p>')
    const before = doc.documentElement.outerHTML
    enable(doc, 'side', lookWith({ underline: 'wavy', blur: true, color: '#1565c0' }))
    restore(doc)
    expect(doc.documentElement.outerHTML).toBe(before)
  })
})
