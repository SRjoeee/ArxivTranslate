import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// 图片叠加层的样式（DESIGN §15.2）：happy-dom 没有布局，这里守规则本身

const CSS = readFileSync(join(import.meta.dirname, '../../src/styles/image.css'), 'utf8')
const RULES = CSS.replace(/\/\*[\s\S]*?\*\//g, '')

describe('image.css', () => {
  it('锚点定位：图声明锚点名、父元素限定作用域并做定位祖先、叠加层用 anchor() / anchor-size() 贴上去', () => {
    expect(RULES).toMatch(/img:has\(\+ \.axt-img\) \{\s*anchor-name: --axt-img;/)
    expect(RULES).toMatch(/:has\(> \.axt-img\) \{\s*position: relative;\s*anchor-scope: --axt-img;/)
    expect(RULES).toMatch(/\.axt-img \{[^}]*position-anchor: --axt-img;[^}]*top: anchor\(top\);[^}]*width: anchor-size\(width\);/)
    // 不支持锚点定位的浏览器整段不生效，叠加层保持隐藏
    expect(RULES).toMatch(/@supports \(top: anchor\(top\)\)/)
  })

  it('脱离配对网格、字号用容器单位、不拦截图上的点击', () => {
    expect(RULES).toMatch(/\.axt-img \{[^}]*grid-column: auto;[^}]*grid-row: auto;/)
    expect(RULES).toMatch(/\.axt-img \{[^}]*container-type: size;/)
    expect(RULES).toMatch(/\.axt-img \{[^}]*pointer-events: none;/)
    expect(RULES).toMatch(/\.axt-img > span \{[^}]*pointer-events: auto;/)
  })

  it('可见性只看 <html> 上的属性，不看叠加层自己的：拆图克隆会把 data-axt-* 全剥掉', () => {
    expect(RULES).not.toMatch(/\[data-axt-img=/)
    for (const mode of ['side', 'stack', 'only']) {
      expect(RULES).toContain(`html[data-axt-mode="${mode}"][data-axt-img-modes~="${mode}"] .axt-img`)
    }
  })

  it('side 下原件里的叠加层隐藏，且这条规则写在显示规则之后（特异度相同，靠顺序赢）', () => {
    const show = RULES.indexOf('html[data-axt-mode="side"][data-axt-img-modes~="side"] .axt-img')
    const hide = RULES.indexOf('html[data-axt-mode="side"] [data-axt-split] .axt-img')
    expect(show).toBeGreaterThan(-1)
    expect(hide).toBeGreaterThan(show)
    // 只限 side：stack 显示原件、only 显示副本，叠加层跟着显示的那份走
    expect(RULES).not.toMatch(/html\[data-axt-mode="(stack|only)"\] \[data-axt-split\] \.axt-img/)
  })

  it('隐藏的基线写在 @supports 之外：不支持锚点定位的浏览器上叠加层也不会掉成图下面的一段文字', () => {
    const supports = RULES.indexOf('@supports')
    const baseline = RULES.search(/\.axt-img \{\s*display: none;\s*\}/)
    expect(baseline).toBeGreaterThan(-1)
    expect(baseline).toBeLessThan(supports)
    // @supports 里面不再有第二份 display: none 基线（显示规则靠属性闸）
    expect(RULES.slice(supports)).not.toMatch(/\n {2}\.axt-img \{[^}]*display: none/)
  })

  it('样式表里没有 ltx_ 选择器：图片叠加层不认站点结构', () => {
    expect(RULES).not.toContain('ltx_')
  })
})
