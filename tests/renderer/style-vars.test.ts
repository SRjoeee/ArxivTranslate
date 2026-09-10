// The reader's appearance values (#47, rebuilt in v12): colour, opacity, underline thickness and
// the band. `appearanceRule` turns them into rules that go into the injected sheet — never into an
// inline style on <html>, which restore()'s prefix sweep could not clear (§7.1 would break).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { applyStyle, enable, restore } from '@/core/renderer'
import { TRANSLATION_SELECTOR, appearanceRule, sanitizeColor } from '@/core/renderer/style-preset'
import { BUILT_IN_HIGHLIGHTS, type Look } from '@/config/appearance'
import { docOf } from './helpers'
import { LOOK, lookWith } from './looks'

describe('sanitizeColor', () => {
  it('放行常见写法', () => {
    for (const value of ['#1565c0', '#abc', '#11223344', 'red', 'transparent', 'rgb(21 101 192)', 'oklch(0.6 0.1 250)', 'color-mix(in oklab, currentColor 40%, transparent)']) {
      expect([value, sanitizeColor(value).ok]).toEqual([value, true])
    }
  })

  it('空串合法，表示跟随原文', () => {
    expect(sanitizeColor('   ')).toEqual({ ok: true, color: '' })
  })

  it('十六进制只认 3 / 4 / 6 / 8 位：其余长度浏览器会整条丢掉，存下来等于设置无效', () => {
    for (const value of ['#abc', '#abcd', '#a1b2c3', '#a1b2c3d4']) expect([value, sanitizeColor(value).ok]).toEqual([value, true])
    // 这些过了白名单也写不进渲染：用户会看到设置存住了、页面却没变（Codex 在 #106 指出）
    for (const value of ['#ab', '#abcde', '#a1b2c3d', '#a1b2c3d4e']) expect([value, sanitizeColor(value).ok]).toEqual([value, false])
  })

  it('命名颜色查精确表，不是「一串小写字母就算」', () => {
    for (const value of ['red', 'rebeccapurple', 'darkslategrey', 'transparent', 'currentcolor', 'CurrentColor']) {
      expect([value, sanitizeColor(value).ok]).toEqual([value, true])
    }
    // 这些过了词法形状却不是颜色：存得住、浏览器却整条丢掉声明（Codex 在 #106 指出）
    for (const value of ['banana', 'reddish', 'colour', 'notacolor', 'inherit', 'initial', 'unset', 'revert']) {
      expect([value, sanitizeColor(value).ok]).toEqual([value, false])
    }
  })

  it('挡住会开出新声明或闭合规则的输入', () => {
    // 手填框里写成 "red; opacity: 0" 会多出一条声明；"}" 会提前闭合，后面的内容变成整页规则
    for (const value of ['red; opacity: 0', 'red}', '#fff{', 'url(x)', 'var(--x)', '<script>']) {
      expect([value, sanitizeColor(value).ok]).toEqual([value, false])
    }
  })
})

describe('appearanceRule', () => {
  const all = (look: Look) => { const r = appearanceRule(look); return r.base + r.overrides }
  const band = (over: Partial<(typeof BUILT_IN_HIGHLIGHTS)[number]>) => ({ ...BUILT_IN_HIGHLIGHTS[0]!, ...over })

  it('默认外观只写高亮的两个变量：译文本身与这个功能实现之前逐像素相同', () => {
    const css = all(LOOK)
    expect(css).toContain('--axt-hl-mix: 22%;')
    expect(css).toContain(`--axt-hl-color: ${BUILT_IN_HIGHLIGHTS[0]!.color};`)
    expect(css).not.toContain('--axt-color:')
    expect(css).not.toContain('opacity:')
  })

  it('颜色与透明度作用在“真正的译文”上，排除圆环、失败控件、镜像与拆图副本', () => {
    const css = all(lookWith({ color: '#1565c0', opacity: 0.8 }))
    expect(css).toContain(TRANSLATION_SELECTOR)
    expect(css).toContain('--axt-color: #1565c0;')
    expect(css).toContain('opacity: 0.8;')
    // 镜像与拆图副本是**原文**的视觉克隆，不该套译文的颜色与透明度（§7.5 的同一条界线）
    for (const cls of ['.axt-pending', '.axt-error', '.axt-mirror', '.axt-split']) {
      expect([cls, css.includes(cls)]).toEqual([cls, true])
    }
  })

  it('高亮配置写成颜色 + 百分比：色带的浓淡由 color-mix 消费', () => {
    const css = all({ style: LOOK.style, highlight: band({ color: '#e91e63', opacity: 0.3 }) })
    expect(css).toContain('html[data-axt-on] {')
    expect(css).toContain('--axt-hl-color: #e91e63;')
    expect(css).toContain('--axt-hl-mix: 30%;')
  })

  it('高亮浓淡被夹在 schema 的上下限内：手滑调到看不见或糊成一片时兜住', () => {
    expect(all({ style: LOOK.style, highlight: band({ opacity: 0 }) })).toContain('--axt-hl-mix: 5%;')
    expect(all({ style: LOOK.style, highlight: band({ opacity: 1 }) })).toContain('--axt-hl-mix: 60%;')
  })

  it('线宽只在真的画了线时写：没有下划线的配置不该留下一个悬空变量', () => {
    expect(all(lookWith({ underline: 'wavy', thickness: 2 }))).toContain('--axt-deco-thickness: 2px;')
    expect(all(lookWith({ underline: 'none', thickness: 2 }))).not.toContain('--axt-deco-thickness')
    expect(all(lookWith({ underline: 'wavy', thickness: 1 }))).not.toContain('--axt-deco-thickness')
  })

  it('透明度用「顶层真译文」，不让嵌套的脚注译文把它乘两遍', () => {
    // side 模式的 localizeNotes 会把 .axt-note-t.axt-t 插进段落译文内部；两层都匹配的话
    // 下限 0.3 会渲染成 0.09。Chrome 实测这条选择器：顶层 0.5、嵌套脚注 1、拆图副本 1、副本内真译文 0.5
    expect(appearanceRule(lookWith({ opacity: 0.5 })).base).toContain(':not(:where(')
    // 颜色那条不需要这道排除：--axt-color 是继承属性，嵌套不会叠加
    expect(appearanceRule(lookWith({ color: '#1565c0' })).overrides).not.toContain(':not(:where(')
  })

  it('透明度落在 base、颜色与高亮落在 overrides：两段要分别排在样式表的两侧', () => {
    const r = appearanceRule({ style: { ...LOOK.style, color: '#1565c0', opacity: 0.5 }, highlight: band({ color: '#e91e63' }) })
    // base 在 presets.css 之前 → 模糊规则能覆盖基线并在自己的公式里乘上 --axt-opacity
    expect(r.base).toContain('--axt-opacity: 0.5;')
    expect(r.base).toContain('opacity: var(--axt-opacity, 1);')
    expect(r.base).not.toContain('--axt-color')
    // overrides 在之后 → 赢过样式表里的任何默认值
    expect(r.overrides).toContain('--axt-color: #1565c0;')
    expect(r.overrides).toContain('--axt-hl-color: #e91e63;')
    expect(r.overrides).not.toContain('opacity: var')
  })

  it('非法颜色被丢掉而不是原样写进规则', () => {
    expect(all(lookWith({ color: 'red; opacity: 0' }))).not.toContain('--axt-color')
  })

  it('透明度不会低于下限：手滑调到看不见时兜住', () => {
    expect(all(lookWith({ opacity: 0 }))).toContain('--axt-opacity: 0.3;')
  })
})

describe('注入与恢复', () => {
  // vitest 里 `?inline` 的 CSS 导入解析成**空字符串**（vitest.config 的 css: false），
  // 所以「生成的规则 vs presets.css 的先后」在单测里断言不了——拿 indexOf 去比会恒为 -1、断言恒真。
  // 这里改成断言两件能真正验到的事：注入表内部 base 在 overrides 之前；presets.css 的文本契约。
  // 真正的层叠效果由浏览器实测覆盖（模糊配上滑杆 0.5 → computed 0.375）
  it('注入表里 base 在 overrides 之前', () => {
    const doc = docOf('<p class="ltx_p" id="p1">Hello.</p>')
    enable(doc, 'stack', lookWith({ blur: true, color: '#1565c0', opacity: 0.5 }))
    const css = doc.querySelector('style[data-axt-sheet]')!.textContent ?? ''
    expect(css.indexOf('--axt-opacity: 0.5;')).toBeGreaterThanOrEqual(0)
    expect(css.indexOf('--axt-opacity: 0.5;')).toBeLessThan(css.indexOf('--axt-color: #1565c0;'))
    // 把返回的对象直接塞进模板串会留下这个（实测在设置页的预览上发生过）
    expect(css).not.toContain('[object Object]')
  })

  it('会叠加的声明只作用于顶层译文，嵌套的脚注译文不再乘第二遍', () => {
    // opacity / filter 都作用于整棵子树：side 模式的 .axt-note-t.axt-t 嵌在段落译文里，
    // 两层都匹配就会相乘。Chrome 实测（滑杆 0.5）：改前 outer/nested 都是 0.375 且各挨一次
    // blur(4px)，改后 nested 是 1 / none（Codex 在 #106 指出）
    const css = readFileSync(join(import.meta.dirname, '../../src/styles/presets.css'), 'utf8')
    const rules = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@media[^{]*\{/g, '')
    const offenders: string[] = []
    for (const m of rules.matchAll(/([^{}]*\.axt-t[^{}]*)\{([^{}]*)\}/g)) {
      const [, selector, body] = m
      // 逐条声明解析，不用带负向先行的正则：`\s*` 会回溯成零宽，让 (?!none) 在空格处求值而恒真
      const compounds = body!.split(';').some(decl => {
        const [prop, ...rest] = decl.split(':')
        return ['opacity', 'filter', 'animation'].includes(prop!.trim()) && rest.join(':').trim() !== 'none'
      })
      if (!compounds) continue
      if (!selector!.includes(':not(:where(')) offenders.push(selector!.trim())
    }
    expect(offenders).toEqual([])
  })

  it('presets.css 里模糊消费 --axt-opacity，而不是把它顶掉', () => {
    const css = readFileSync(join(import.meta.dirname, '../../src/styles/presets.css'), 'utf8')
    const rules = css.replace(/\/\*[\s\S]*?\*\//g, '')
    // 模糊自带 0.75，必须乘上用户的值，否则滑杆对它无效（Codex 在 #106 指出）
    expect(rules).toContain('calc(var(--axt-opacity, 1) * 0.75)')
    // 不能再有写死的裸 opacity 数值，那会把用户的值顶掉
    expect(rules).not.toMatch(/opacity:\s*0?\.\d+;/)
  })

  it('高级声明块仍有最后的发言权', () => {
    const doc = docOf('<p class="ltx_p" id="p1">Hello.</p>')
    enable(doc, 'stack', lookWith({ css: 'color: teal;', color: '#1565c0' }))
    const css = doc.querySelector('style[data-axt-sheet]')!.textContent ?? ''
    expect(css.indexOf('color: teal;')).toBeGreaterThan(css.indexOf('--axt-color: #1565c0'))
  })

  it('applyStyle 只重算那张表，不动任何节点；没开翻译时返回 false', () => {
    const doc = docOf('<p class="ltx_p" id="p1">Hello.</p>')
    expect(applyStyle(doc, lookWith({ color: '#1565c0' }))).toBe(false)
    enable(doc, 'stack', LOOK)
    const body = doc.body.outerHTML
    expect(applyStyle(doc, lookWith({ underline: 'dotted', color: '#1565c0', opacity: 0.8 }))).toBe(true)
    expect(doc.documentElement.getAttribute('data-axt-underline')).toBe('dotted')
    expect(doc.querySelector('style[data-axt-sheet]')!.textContent).toContain('--axt-color: #1565c0')
    // 只改注入表与 <html> 上的属性，body 一个字节都没变
    expect(doc.body.outerHTML).toBe(body)
    // 仍然只有一张表
    expect(doc.querySelectorAll('style[data-axt-sheet]')).toHaveLength(1)
  })

  it('恢复原文后 DOM 与翻译前逐字相等（§7.1 第 4 条）', () => {
    const doc = docOf('<p class="ltx_p" id="p1">Hello.</p>')
    const before = doc.documentElement.outerHTML
    enable(doc, 'side', lookWith({ underline: 'wavy', color: '#1565c0', opacity: 0.6 }))
    applyStyle(doc, lookWith({ blur: true, color: 'red', opacity: 0.4 }))
    restore(doc)
    expect(doc.documentElement.outerHTML).toBe(before)
  })
})
