// 作者姓名的提取与渲染（DESIGN §5.1 / §5.2，2026-09-06）。姓名在 `.ltx_creator` 这个 <span> 里，
// 译文作兄弟节点插进去，不能把姓名列表挤断，也不能挡住后面的机构信息。
import { describe, expect, it } from 'vitest'
import { extract } from '@/core/extractor'
import { serialize } from '@/core/protector'
import { rehydrate } from '@/core/protector/rehydrate'
import { FOR_ATTR, T_CLASS, renderText, restore } from '@/core/renderer'
import type { TextBlock } from '@/core/extractor'
import { docOf, frag } from './helpers'

/** 真实 fixture 的形状（2410.00260：姓名带脚注上标；2312.17141：作者之间有 “ and ”） */
const AUTHORS = `<div class="ltx_authors">
  <span class="ltx_creator ltx_role_author"><span class="ltx_personname">Vinayak Arannil<sup class="ltx_sup">*</sup> </span><span class="ltx_author_notes"><span class="ltx_author_notes_content"><span class="ltx_contact ltx_role_affiliation">Amazon Web Services </span></span></span></span>
  <span class="ltx_author_before"> and </span>
  <span class="ltx_creator ltx_role_author"><span class="ltx_personname">Brian Street </span></span>
</div>`

const nameBlocks = (doc: Document) =>
  extract(doc).filter((b): b is TextBlock => b.kind === 'text' && b.el.matches('.ltx_personname'))

describe('作者姓名（§5.2 的 2026-09-06 决定）', () => {
  it('两位作者各成一块，机构照旧单独成块，连接词不成块', () => {
    const doc = docOf(AUTHORS)
    const blocks = extract(doc)
    const classes = blocks.map(b => b.el.className)
    expect(blocks.filter(b => b.el.matches('.ltx_personname'))).toHaveLength(2)
    expect(blocks.filter(b => b.el.matches('.ltx_contact'))).toHaveLength(1)
    // 连接词是 skip：成块的话姓名列表会被拆成一行一个词
    expect(classes.some(c => c.includes('ltx_author_before'))).toBe(false)
  })

  it('姓名里的脚注上标走成对占位符，原位还原', () => {
    const doc = docOf(AUTHORS)
    const [first] = nameBlocks(doc)
    const block = serialize(first!.el)
    // <sup> 不在 protect / unit 表里，序列化成成对占位符
    expect(block.text).toMatch(/^Vinayak Arannil<t id="\d+">\*<\/t>\s*$/)
    expect(block.paired.size).toBe(1)
    const fragment = rehydrate(block.text.replace('Vinayak Arannil', '维纳亚克·阿兰尼尔'), block, doc)
    const holder = doc.createElement('span')
    holder.append(fragment)
    expect(holder.innerHTML).toBe('维纳亚克·阿兰尼尔<sup class="ltx_sup">*</sup> ')
  })

  it('译文插在原名之后、仍在 .ltx_creator 里，机构信息仍跟在后面', () => {
    const doc = docOf(AUTHORS)
    const [first] = nameBlocks(doc)
    const node = renderText(first!, frag(doc, '维纳亚克·阿兰尼尔'))
    const creator = doc.querySelector('.ltx_creator')!
    expect(node.parentElement).toBe(creator)
    expect(node.previousElementSibling).toBe(first!.el)
    // 译文沿用原块的 class（§7.1），所以还是个 <span>，天然行内，不会把姓名列表挤断
    expect(node.tagName).toBe('SPAN')
    expect(node.className).toBe(`ltx_personname ${T_CLASS}`)
    expect(node.getAttribute(FOR_ATTR)).toBe(first!.id)
    // 机构信息仍排在译文之后，顺序没被打乱
    expect(node.nextElementSibling?.className).toBe('ltx_author_notes')
  })

  it('恢复原文后 DOM 逐节点相等（§7.1）', () => {
    const doc = docOf(AUTHORS)
    const before = doc.documentElement.outerHTML
    for (const block of nameBlocks(doc)) renderText(block, frag(doc, `译:${block.el.textContent}`))
    expect(doc.querySelectorAll(`.${T_CLASS}`)).toHaveLength(2)
    restore(doc)
    expect(doc.documentElement.outerHTML).toBe(before)
  })
})
