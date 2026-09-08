// 用户可调的装饰参数（#47）：颜色、透明度、高亮色。规则由 styleVarsRule 生成、注入进那张表，
// 不写 <html> 的内联 style——那样 restore() 的前缀通扫清不掉，§7.1 的恒等就破了。
import { describe, expect, it } from 'vitest'
import { applyStyle, enable, restore } from '@/core/renderer'
import { OPACITY_MAX, TRANSLATION_SELECTOR, sanitizeColor, styleVarsRule } from '@/core/renderer/style-preset'
import { docOf } from './helpers'

const BASE = { preset: 'none' as const, customCss: '' }

describe('sanitizeColor', () => {
  it('放行常见写法', () => {
    for (const value of ['#1565c0', '#abc', '#11223344', 'red', 'transparent', 'rgb(21 101 192)', 'oklch(0.6 0.1 250)', 'color-mix(in oklab, currentColor 40%, transparent)']) {
      expect([value, sanitizeColor(value).ok]).toEqual([value, true])
    }
  })

  it('空串合法，表示跟随原文', () => {
    expect(sanitizeColor('   ')).toEqual({ ok: true, color: '' })
  })

  it('挡住会开出新声明或闭合规则的输入', () => {
    // 手填框里写成 "red; opacity: 0" 会多出一条声明；"}" 会提前闭合，后面的内容变成整页规则
    for (const value of ['red; opacity: 0', 'red}', '#fff{', 'url(x)', 'var(--x)', '<script>']) {
      expect([value, sanitizeColor(value).ok]).toEqual([value, false])
    }
  })
})

describe('styleVarsRule', () => {
  it('默认值一条声明都不产生：外观必须与这个功能实现之前逐像素相同', () => {
    expect(styleVarsRule({ color: '', opacity: OPACITY_MAX, accent: '' })).toBe('')
    expect(styleVarsRule({})).toBe('')
  })

  it('颜色与透明度作用在“真正的译文”上，排除圆环、失败控件、镜像与拆图副本', () => {
    const css = styleVarsRule({ color: '#1565c0', opacity: 0.8 })
    expect(css).toContain(TRANSLATION_SELECTOR)
    expect(css).toContain('--axt-color: #1565c0;')
    expect(css).toContain('opacity: 0.8;')
    // 镜像与拆图副本是**原文**的视觉克隆，不该套译文的颜色与透明度（§7.5 的同一条界线）
    for (const cls of ['.axt-pending', '.axt-error', '.axt-mirror', '.axt-split']) {
      expect([cls, css.includes(cls)]).toEqual([cls, true])
    }
  })

  it('高亮色写在 html[data-axt-on] 上，与译文那条分开', () => {
    const css = styleVarsRule({ accent: '#e91e63' })
    expect(css).toContain('html[data-axt-on] {')
    expect(css).toContain('--axt-accent: #e91e63;')
    expect(css).not.toContain('opacity:')
  })

  it('非法颜色被丢掉而不是原样写进规则', () => {
    expect(styleVarsRule({ color: 'red; opacity: 0' })).toBe('')
  })

  it('透明度不会低于下限：手滑调到看不见时兜住', () => {
    expect(styleVarsRule({ opacity: 0 })).toContain('opacity: 0.3;')
  })
})

describe('注入与恢复', () => {
  it('用户的颜色排在预设之后，覆盖 muted / green 写的 --axt-color', () => {
    const doc = docOf('<p class="ltx_p" id="p1">Hello.</p>')
    enable(doc, 'stack', { preset: 'muted', customCss: '', color: '#1565c0', opacity: OPACITY_MAX, accent: '' })
    const css = doc.querySelector('style[data-axt-sheet]')!.textContent ?? ''
    // presets.css 里 muted 也写 --axt-color，选择器形状与特异度相同，靠顺序取胜
    expect(css.lastIndexOf('--axt-color: #1565c0')).toBeGreaterThan(css.indexOf('[data-axt-style="muted"]'))
  })

  it('自定义声明块仍有最后的发言权', () => {
    const doc = docOf('<p class="ltx_p" id="p1">Hello.</p>')
    enable(doc, 'stack', { ...BASE, preset: 'custom', customCss: 'color: teal;', color: '#1565c0', opacity: OPACITY_MAX, accent: '' })
    const css = doc.querySelector('style[data-axt-sheet]')!.textContent ?? ''
    expect(css.indexOf('color: teal;')).toBeGreaterThan(css.indexOf('--axt-color: #1565c0'))
  })

  it('applyStyle 只重算那张表，不动任何节点；没开翻译时返回 false', () => {
    const doc = docOf('<p class="ltx_p" id="p1">Hello.</p>')
    expect(applyStyle(doc, { ...BASE, color: '#1565c0' })).toBe(false)
    enable(doc, 'stack', BASE)
    const body = doc.body.outerHTML
    expect(applyStyle(doc, { ...BASE, preset: 'quote', color: '#1565c0', opacity: 0.8 })).toBe(true)
    expect(doc.documentElement.getAttribute('data-axt-style')).toBe('quote')
    expect(doc.querySelector('style[data-axt-sheet]')!.textContent).toContain('--axt-color: #1565c0')
    // 只改注入表与 <html> 上的属性，body 一个字节都没变
    expect(doc.body.outerHTML).toBe(body)
    // 仍然只有一张表
    expect(doc.querySelectorAll('style[data-axt-sheet]')).toHaveLength(1)
  })

  it('恢复原文后 DOM 与翻译前逐字相等（§7.1 第 4 条）', () => {
    const doc = docOf('<p class="ltx_p" id="p1">Hello.</p>')
    const before = doc.documentElement.outerHTML
    enable(doc, 'side', { ...BASE, preset: 'marker', color: '#1565c0', opacity: 0.6, accent: '#e91e63' })
    applyStyle(doc, { ...BASE, color: 'red', opacity: 0.4, accent: 'blue' })
    restore(doc)
    expect(doc.documentElement.outerHTML).toBe(before)
  })
})
