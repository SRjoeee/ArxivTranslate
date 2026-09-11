import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ABS_LINK_CLASS, AUTO_TRANSLATE_HASH, injectBilingualLink, relabelBilingualLink } from '@/core/abstract/link'
import { LOCALES } from '@/locales'

// 摘要页的双语入口（issue #146）。fixture 是真实的 arxiv.org/abs 页面：插入点靠的是 arXiv 自己的
// 标记，只有对着真标记测才说明得了问题
const PAGE = readFileSync(join(import.meta.dirname, '../fixtures/abs/1706.03762.html'), 'utf8')
const pageOf = (html = PAGE) => new DOMParser().parseFromString(html, 'text/html')
// 文案来自语言包（UI.md §6）：这里取中文那份，链接的行为与写什么字无关
const LABEL = LOCALES['zh-CN'].S.page.abstractLink(LOCALES['zh-CN'].S.brand)

describe('摘要页的双语入口（#146）', () => {
  it('换界面语言之后，已经插好的那条链接跟着改写（Codex 在 #161 指出）', () => {
    const doc = pageOf()
    expect(injectBilingualLink(doc, LABEL)).toBe(true)
    const en = LOCALES.en.S.page.abstractLink(LOCALES.en.S.brand)
    expect(relabelBilingualLink(doc, en)).toBe(true)
    expect(doc.querySelector(`.${ABS_LINK_CLASS}`)?.textContent).toBe(en)
    // 没有这条链接的页面上什么也不做，不抛错
    expect(relabelBilingualLink(pageOf(), en)).toBe(false)
  })

  it('插在 arXiv 自己的 HTML 链接后面，指向它给的那个 URL 加上自动开始的 hash', () => {
    const doc = pageOf()
    const html = doc.querySelector<HTMLAnchorElement>('#latexml-download-link')!
    expect(injectBilingualLink(doc, LABEL)).toBe(true)

    const link = doc.querySelector<HTMLAnchorElement>(`.${ABS_LINK_CLASS}`)!
    expect(link.textContent).toBe(LABEL)
    // **用 arXiv 给的 href**：它带着版本号（v7），自己拼 id 会指到错的版本
    expect(link.getAttribute('href')).toBe(`${html.href}${AUTO_TRANSLATE_HASH}`)
    expect(link.getAttribute('href')).toContain('/html/1706.03762v7')
    // 位置：紧跟在 HTML 那一条后面，还在同一个列表里
    expect(html.closest('li')!.nextElementSibling!.contains(link)).toBe(true)
    expect(link.closest('ul')).toBe(html.closest('ul'))
  })

  it('没有 HTML 版的论文什么都不插', () => {
    // 那类论文的摘要页上根本没有这个元素——不是「链接指向空」，是整条不存在
    const doc = pageOf()
    doc.querySelector('#latexml-download-link')!.closest('li')!.remove()
    expect(injectBilingualLink(doc, LABEL)).toBe(false)
    expect(doc.querySelector(`.${ABS_LINK_CLASS}`)).toBeNull()
  })

  it('跑第二遍不会插出第二条', () => {
    const doc = pageOf()
    expect(injectBilingualLink(doc, LABEL)).toBe(true)
    expect(injectBilingualLink(doc, LABEL)).toBe(false)
    expect(doc.querySelectorAll(`.${ABS_LINK_CLASS}`)).toHaveLength(1)
  })

  it('除了插进去的那一条，页面一个字节都没动', () => {
    // 摘要页不归 §7.1 管（那条讲的是全文页），但同一套规矩：只加自己的节点，不碰别人的
    const doc = pageOf()
    const before = doc.body.outerHTML
    injectBilingualLink(doc, LABEL)
    const inserted = doc.querySelector(`.${ABS_LINK_CLASS}`)!.closest('li')!
    inserted.remove()
    expect(doc.body.outerHTML).toBe(before)
  })
})
