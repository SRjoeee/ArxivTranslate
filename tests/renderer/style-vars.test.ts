// 用户可调的装饰参数（#47）：颜色、透明度、高亮色。规则由 styleVarsRule 生成、注入进那张表，
// 不写 <html> 的内联 style——那样 restore() 的前缀通扫清不掉，§7.1 的恒等就破了。
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
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
  const all = (v: Parameters<typeof styleVarsRule>[0]) => { const r = styleVarsRule(v); return r.base + r.overrides }

  it('默认值一条声明都不产生：外观必须与这个功能实现之前逐像素相同', () => {
    expect(all({ color: '', opacity: OPACITY_MAX, accent: '' })).toBe('')
    expect(all({})).toBe('')
  })

  it('颜色与透明度作用在“真正的译文”上，排除圆环、失败控件、镜像与拆图副本', () => {
    const css = all({ color: '#1565c0', opacity: 0.8 })
    expect(css).toContain(TRANSLATION_SELECTOR)
    expect(css).toContain('--axt-color: #1565c0;')
    expect(css).toContain('opacity: 0.8;')
    // 镜像与拆图副本是**原文**的视觉克隆，不该套译文的颜色与透明度（§7.5 的同一条界线）
    for (const cls of ['.axt-pending', '.axt-error', '.axt-mirror', '.axt-split']) {
      expect([cls, css.includes(cls)]).toEqual([cls, true])
    }
  })

  it('高亮色两个角色都写：只写 --axt-accent 的话对 marker / highlight / glow 无效', () => {
    const css = all({ accent: '#e91e63' })
    expect(css).toContain('html[data-axt-on] {')
    // --axt-accent 管下划线与边框族，--axt-green 管 marker / marker-gradient / highlight / glow / green。
    // 少写一个，「高亮颜色」这个控件就对叫「高亮」的那几个预设没反应（Codex 在 #106 指出）
    expect(css).toContain('--axt-accent: #e91e63;')
    expect(css).toContain('--axt-green: #e91e63;')
    expect(css).not.toContain('opacity:')
  })

  it('透明度用「顶层真译文」，不让嵌套的脚注译文把它乘两遍', () => {
    // side 模式的 localizeNotes 会把 .axt-note-t.axt-t 插进段落译文内部；两层都匹配的话
    // 下限 0.3 会渲染成 0.09。Chrome 实测这条选择器：顶层 0.5、嵌套脚注 1、拆图副本 1、副本内真译文 0.5
    expect(styleVarsRule({ opacity: 0.5 }).base).toContain(':not(:where(')
    // 颜色那条不需要这道排除：--axt-color 是继承属性，嵌套不会叠加
    expect(styleVarsRule({ color: '#1565c0' }).overrides).not.toContain(':not(:where(')
  })

  it('透明度落在 base、颜色落在 overrides：两段要分别排在预设的两侧', () => {
    const r = styleVarsRule({ color: '#1565c0', opacity: 0.5, accent: '#e91e63' })
    // base 在 presets.css 之前 → blur / blink 能覆盖基线并在自己的公式里乘上 --axt-opacity
    expect(r.base).toContain('--axt-opacity: 0.5;')
    expect(r.base).toContain('opacity: var(--axt-opacity, 1);')
    expect(r.base).not.toContain('--axt-color')
    // overrides 在之后 → 赢过 muted / green 写的 --axt-color
    expect(r.overrides).toContain('--axt-color: #1565c0;')
    expect(r.overrides).toContain('--axt-green: #e91e63;')
    expect(r.overrides).not.toContain('opacity:')
  })

  it('非法颜色被丢掉而不是原样写进规则', () => {
    expect(all({ color: 'red; opacity: 0' })).toBe('')
  })

  it('透明度不会低于下限：手滑调到看不见时兜住', () => {
    expect(all({ opacity: 0 })).toContain('--axt-opacity: 0.3;')
  })
})

describe('注入与恢复', () => {
  // vitest 里 `?inline` 的 CSS 导入解析成**空字符串**（vitest.config 的 css: false），
  // 所以「生成的规则 vs presets.css 的先后」在单测里断言不了——拿 indexOf 去比会恒为 -1、断言恒真。
  // 这里改成断言两件能真正验到的事：注入表内部 base 在 overrides 之前；presets.css 的文本契约。
  // 真正的层叠效果由浏览器实测覆盖（blur 滑杆 0.5 → computed 0.375；blink 比值 0.5）
  it('注入表里 base 在 overrides 之前', () => {
    const doc = docOf('<p class="ltx_p" id="p1">Hello.</p>')
    enable(doc, 'stack', { ...BASE, preset: 'blur', color: '#1565c0', opacity: 0.5, accent: '#e91e63' })
    const css = doc.querySelector('style[data-axt-sheet]')!.textContent ?? ''
    expect(css.indexOf('--axt-opacity: 0.5;')).toBeGreaterThanOrEqual(0)
    expect(css.indexOf('--axt-opacity: 0.5;')).toBeLessThan(css.indexOf('--axt-color: #1565c0;'))
    // 把返回的对象直接塞进模板串会留下这个（实测在设置页的预览上发生过）
    expect(css).not.toContain('[object Object]')
  })

  it('presets.css 里 blur 与 blink 消费 --axt-opacity，而不是把它顶掉', () => {
    const css = readFileSync(join(import.meta.dirname, '../../src/styles/presets.css'), 'utf8')
    const rules = css.replace(/\/\*[\s\S]*?\*\//g, '')
    // blur 自带 0.75、blink 的关键帧动画改 opacity（动画永远压过普通声明）：
    // 两者都必须乘上用户的值，否则滑杆对它们无效（Codex 在 #106 指出）
    expect(rules).toContain('calc(var(--axt-opacity, 1) * 0.75)')
    expect(rules).toContain('calc(var(--axt-opacity, 1) * 0.45)')
    // 不能再有写死的裸 opacity 数值，那会把用户的值顶掉
    expect(rules).not.toMatch(/opacity:\s*0?\.\d+;/)
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
