// side 模式的布局守卫（DESIGN §7.2）。
// 这里不测样式效果（happy-dom 没有布局引擎），测的是**结构覆盖**：
// 每个译文节点到翻译根之间的每一层，要么是配对容器，要么在明确排除的清单里。
// 早期版本用类名白名单挑容器，于是 .ltx_theorem、.ltx_transformed_inner、.ltx_proof、
// .ltx_author_notes 一个个漏，每次都得等用户在页面上发现。这条测试把那类漏洞变成构建期失败。
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { extract } from '@/core/extractor'
import { DOCUMENT_ROOT } from '@/core/rules/latexml'
import { SIDE_DENY, SIDE_DENY_SUBTREE, SIDE_STACK, T_CLASS, isSideContainer } from '@/core/renderer'
import { docOf } from './helpers'

const FIXTURE_DIR = join(import.meta.dirname, '../fixtures/arxiv')
const CSS = readFileSync(join(import.meta.dirname, '../../src/styles/modes.css'), 'utf8')
/** 注释里也写着选择器（讲取舍用的），做文本断言前先去掉 */
const RULES = CSS.replace(/\/\*[\s\S]*?\*\//g, '')

/** 从样式表里取出容器判定，样式表是唯一事实来源，改了这里测试自动跟上 */
function selectorsFromCss(): { container: string; deny: string } {
  const match = /:where\(:has\(\.axt-t\):not\(:is\(([\s\S]*?)\)\)\)/.exec(CSS)
  if (!match) throw new Error('modes.css 里找不到容器判定选择器')
  const deny = match[1]!.replace(/\s+/g, ' ').trim()
  return { container: `:has(.${T_CLASS}):not(:is(${deny}))`, deny }
}

/** 模拟渲染：给每个块插一个译文兄弟，形状与 renderText 一致 */
function fakeTranslate(doc: Document): number {
  let n = 0
  for (const block of extract(doc)) {
    const node = doc.createElement(block.el.tagName)
    node.className = `${block.el.className} ${T_CLASS}`.trim()
    node.setAttribute('data-axt-for', block.id)
    node.textContent = '译文'
    block.el.after(node)
    n++
  }
  return n
}

describe('side 模式的容器覆盖', () => {
  const { container, deny } = selectorsFromCss()
  const files = readdirSync(FIXTURE_DIR).filter(f => f.endsWith('.html')).sort()

  it('样式表里的排除清单与 side-layout.ts 保持一致（TS 是事实来源）', () => {
    const parts = (v: string) => v.split(',').map(x => x.trim()).filter(Boolean)
    const normalize = (v: string[]) => [...new Set(v)].sort().join(',')
    // 子树排除在样式表里写成 `X, X *` 两条；TS 侧由 isSideContainer 用 closest 实现
    //（happy-dom 的 :is(X *) 恒为 false，并进 SIDE_CONTAINER 会让测试与线上行为不一致）
    const subtrees = parts(SIDE_DENY_SUBTREE).flatMap(x => [x, `${x} *`])
    expect(normalize(parts(deny))).toBe(normalize([...parts(SIDE_DENY), ...subtrees]))
  })

  it('排除项只允许是本身不成网格的元素：ar5iv 自己的网格必须接管而不是排除', () => {
    // 排除一个网格祖先挡不住后代 subgrid 它的轨道（实测 2609.00097 的有序列表）
    for (const grid of ['.ltx_enumerate', '.ltx_biblist', '.ltx_bibitem', '.ltx_item']) {
      expect(SIDE_DENY).not.toContain(grid)
    }
  })

  it('多面板插图不接管：flex 容器与分格都不算配对容器', () => {
    // ar5iv 用 flex 让面板并排，接管成网格后每个面板各占一行、撑满文章列（实测 2410.00260）
    let checked = 0
    for (const file of files) {
      const doc = new DOMParser().parseFromString(readFileSync(join(FIXTURE_DIR, file), 'utf8'), 'text/html')
      const root = doc.querySelector(DOCUMENT_ROOT)
      if (!root) continue
      fakeTranslate(doc)
      const flex = Array.from(root.querySelectorAll('.ltx_flex_figure, .ltx_flex_cell'))
      checked += flex.length
      expect(flex.filter(el => el.matches(container)).map(el => el.className)).toEqual([])
    }
    expect(checked).toBeGreaterThan(0) // fixture 里确实有多面板插图，这条测试不是空跑
  })

  it('列表标记要脱离网格流，并且两栏各挂一份', () => {
    // happy-dom 没有布局引擎，这里守的是规则本身；效果的实测记录在 DESIGN §7.2
    expect(RULES).toMatch(/&\.ltx_item > \.ltx_tag \{[^}]*position: absolute/)
    // 镜像标记要落到右栏的槽里，否则它和原标记叠在左栏，右栏没有编号
    expect(RULES).toMatch(/&\.ltx_item > \.ltx_tag\.axt-t \{[^}]*inset-inline-start: calc\(50% \+ var\(--axt-gap\) \/ 2\)/)
  })

  it('列表缩进只能加在格子内容上：subgrid 容器自己的 inline padding 会吃掉第一条轨道', () => {
    // 加在列表容器 / 列表项上会让左栏窄一截、右栏顶格（实测 2312.17141：左 444 / 右 484）
    expect(RULES).toMatch(/&:is\(\.ltx_itemize, \.ltx_enumerate, \.ltx_description\) \{\s*padding-inline-start: 0/)
    expect(RULES).toMatch(/&\.ltx_item:has\(> \.ltx_tag\) \{[^}]*padding-inline-start: 0/)
    expect(RULES).toMatch(/&\.ltx_item :where\(:has\(\+ \.axt-t\), \.axt-t\):not\(\.ltx_tag\) \{\s*padding-inline-start: 2\.5rem/)
  })

  it('堆叠区清单：样式表与 side-layout.ts 保持一致（TS 是事实来源）', () => {
    const stack = /:is\(([^)]*)\)[^{]*\{\s*display: block/.exec(RULES)
    const normalize = (v: string) => v.split(',').map(x => x.trim()).filter(Boolean).sort().join(',')
    expect(normalize(stack?.[1] ?? '')).toBe(normalize(SIDE_STACK))
  })

  it('行内收缩包裹里的图形要豁免 max-width：否则宽度会解成病态的窄值', () => {
    expect(RULES).toMatch(/\.ltx_inline-block :is\(img, svg\) \{\s*max-width: none/)
  })

  it('脚注内部永远不算配对容器：改它的 display 会把 ar5iv 折叠的脚注掀开', () => {
    // ar5iv 把折叠状态写在 .ltx_note_outer 的 display:none 上；容器规则一命中就把它改成 grid，
    // 脚注被掀开横在正文中间（实测 2312.17141：165px 高、781px 宽，与中栏译文互相干扰）
    const doc = docOf(`<div class="ltx_para"><span class="ltx_note"><span class="ltx_note_outer">
      <span class="ltx_note_content"><span class="ltx_p">note</span
      ><span class="ltx_p ${T_CLASS}" data-axt-for="1">脚注译文</span></span></span></span></div>`)
    const content = doc.querySelector('.ltx_note_content')!
    expect(content.matches(container)).toBe(true) // 只看选择器的话它够格当容器
    expect(isSideContainer(content)).toBe(false) // 子树排除把它挡在外面
  })

  it('脚注只留一份：译文搬进副本后，原件那份由样式隐藏', () => {
    // 边注挂在页面右缘是 arXiv 自己的排法，不要改；要解决的是同一条脚注出现两次
    expect(RULES).toMatch(/\.ltx_note\[data-axt-note="moved"\] > \.ltx_note_outer \{\s*display: none/)
    // 别再把边注收进本栏：正文被挤、列表项还会被 ar5iv 写死的 height:0 盖住
    expect(RULES).not.toMatch(/\.ltx_note_outer \{[^}]*margin-inline-end: 0/)
    // 搬进副本的译文另起一行，且不再套一层脚注框
    expect(RULES).toMatch(/\.axt-note-t \{[^}]*display: block/)
  })

  for (const file of files) {
    it(`${file}：配对能否连到翻译根，快照记录被排除项挡住的数量`, () => {
      const doc = new DOMParser().parseFromString(readFileSync(join(FIXTURE_DIR, file), 'utf8'), 'text/html')
      const root = doc.querySelector(DOCUMENT_ROOT)
      if (!root) return
      const total = fakeTranslate(doc)
      expect(total).toBeGreaterThan(0)

      // 一个配对只有在祖先链每一层都是容器时才会真的左右分栏；
      // 链上出现被排除的元素就会退化为上下堆叠。快照记录每类排除项挡住了多少，
      // 往排除清单里加东西、或者容器判定退回白名单，这里的数字都会变。
      let connected = 0
      const blockedBy = new Map<string, number>()
      for (const node of Array.from(doc.querySelectorAll(`.${T_CLASS}`))) {
        let cur = node.parentElement
        let blocker: string | null = null
        while (cur && cur !== root) {
          if (!cur.matches(container)) {
            blocker = Array.from(cur.classList).find(c => c.startsWith('ltx_')) ?? cur.tagName.toLowerCase()
            break
          }
          cur = cur.parentElement
        }
        if (blocker === null) connected++
        else blockedBy.set(blocker, (blockedBy.get(blocker) ?? 0) + 1)
      }

      expect({
        connected: `${connected}/${total}`,
        blockedBy: Object.fromEntries([...blockedBy].sort((a, b) => b[1] - a[1])),
      }).toMatchSnapshot()
    })
  }
})
