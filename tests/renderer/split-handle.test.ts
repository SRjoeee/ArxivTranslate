import { describe, expect, it } from 'vitest'
import { DEFAULT_PCT, DRAGGING_ATTR, HANDLE_CLASS, SPLIT_PCT_VAR, applySplit, installSplitHandle, readSplit } from '@/core/renderer'
import { docOf } from './helpers'

const page = '<div class="ltx_para"><p class="ltx_p" id="p1">One.</p></div>'
  + '<div class="ltx_para"><p class="ltx_p" id="p2">Two.</p></div>'
const root = (doc: Document) => doc.querySelector('article.ltx_document') as HTMLElement

describe('拖动分栏的手柄（实验，issue #83）', () => {
  it('比例夹在 15–85 之间：两栏都要留得住内容', () => {
    const doc = docOf(page)
    expect(applySplit(root(doc), 50)).toBe(50)
    expect(applySplit(root(doc), 3)).toBe(15)
    expect(applySplit(root(doc), 140)).toBe(85)
    expect(applySplit(root(doc), 68.24)).toBe(68.2)
  })

  it('两条轨道之和恒为 100，间距由 column-gap 单独占位', () => {
    const doc = docOf(page)
    applySplit(root(doc), 68.2)
    expect(root(doc).style.getPropertyValue('--axt-split-l')).toBe('68.2fr')
    expect(root(doc).style.getPropertyValue('--axt-split-r')).toBe('31.8fr')
    expect(root(doc).style.getPropertyValue(SPLIT_PCT_VAR)).toBe('68.2')
    expect(readSplit(root(doc))).toBe(68.2)
  })

  it('手柄插在最前面：配对规则里的 :last-child / :nth-last-child(2) 都从尾部数，不能被挤位', () => {
    const doc = docOf(page)
    const before = [...root(doc).children].map(el => el.id)
    installSplitHandle(doc)
    const children = [...root(doc).children]
    expect(children[0]!.classList.contains(HANDLE_CLASS)).toBe(true)
    // 原有子元素的相对次序与末尾位置都没变
    expect(children.slice(1).map(el => el.id)).toEqual(before)
    expect(children.at(-1)!.classList.contains(HANDLE_CLASS)).toBe(false)
  })

  it('幂等：装第二次不会多出一个手柄', () => {
    const doc = docOf(page)
    installSplitHandle(doc)
    installSplitHandle(doc)
    expect(doc.querySelectorAll(`.${HANDLE_CLASS}`)).toHaveLength(1)
  })

  it('用配置里的初始比例', () => {
    const doc = docOf(page)
    installSplitHandle(doc, { initial: 62 })
    expect(readSplit(root(doc))).toBe(62)
  })

  it('卸载后清干净：手柄没了，三个变量也擦掉，style 属性不留空壳（§7.1）', () => {
    const doc = docOf(page)
    const off = installSplitHandle(doc, { initial: 70 })
    expect(root(doc).getAttribute('style')).toContain('--axt-split-l')
    off()
    expect(doc.querySelectorAll(`.${HANDLE_CLASS}`)).toHaveLength(0)
    expect(root(doc).hasAttribute('style')).toBe(false)
    expect(doc.documentElement.hasAttribute(DRAGGING_ATTR)).toBe(false)
  })

  it('双击复位到一半，并把结果交出去存', () => {
    const doc = docOf(page)
    const committed: number[] = []
    installSplitHandle(doc, { initial: 70, onCommit: pct => committed.push(pct) })
    doc.querySelector(`.${HANDLE_CLASS}`)!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    expect(readSplit(root(doc))).toBe(DEFAULT_PCT)
    expect(committed).toEqual([DEFAULT_PCT])
  })

  it('键盘也能调：方向键一格、按住 Shift 五格、Home 复位', () => {
    const doc = docOf(page)
    const committed: number[] = []
    installSplitHandle(doc, { initial: 50, onCommit: pct => committed.push(pct) })
    const handle = doc.querySelector(`.${HANDLE_CLASS}`)!
    const key = (init: KeyboardEventInit) => handle.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }))
    key({ key: 'ArrowRight' })
    expect(readSplit(root(doc))).toBe(51)
    key({ key: 'ArrowLeft', shiftKey: true })
    expect(readSplit(root(doc))).toBe(46)
    key({ key: 'Home' })
    expect(readSplit(root(doc))).toBe(DEFAULT_PCT)
    // 不相干的键不动它，也不上报
    key({ key: 'a' })
    expect(committed).toEqual([51, 46, DEFAULT_PCT])
  })

  it('是个 separator，读屏软件念得出来', () => {
    const doc = docOf(page)
    installSplitHandle(doc)
    const handle = doc.querySelector(`.${HANDLE_CLASS}`)!
    expect(handle.getAttribute('role')).toBe('separator')
    expect(handle.getAttribute('aria-orientation')).toBe('vertical')
    expect(handle.getAttribute('aria-label')).toBeTruthy()
    expect((handle as HTMLElement).tabIndex).toBe(0)
  })
})
