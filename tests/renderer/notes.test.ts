// 脚注两栏归位（DESIGN §7.2）。译文段落由占位符协议回填，脚注是受保护节点，
// 于是译文里会重建一份**原文**脚注；这里把该脚注的译文复制进去，页面右缘只挂一份边注。
import { describe, expect, it } from 'vitest'
import { T_CLASS, delocalizeNotes, localizeNotes } from '@/core/renderer'
import { docOf } from './helpers'

/**
 * 一段带脚注的正文：原文段落（内含脚注与脚注译文）+ 段落译文（内含回填出来的脚注副本）。
 * 脚注正文带 data-axt-id：它是提取器登记过的块（`.ltx_note_content` 是一条翻译单元），
 * 译文早晚会到——没有这个标记的脚注是另一回事，见"没登记过的脚注"那几条
 */
const withNote = (translated = true, zh = '中文脚注') => docOf(`
  <p class="ltx_p">body<span class="ltx_note ltx_role_footnote"><sup class="ltx_note_mark">1</sup
    ><span class="ltx_note_outer"><span class="ltx_note_content" data-axt-id="n1"><sup class="ltx_note_mark">1</sup>English note</span
    >${translated ? `<span class="ltx_note_content ${T_CLASS}" data-axt-for="n1"><sup class="ltx_note_mark">1</sup>${zh}</span>` : ''}
    </span></span></p>
  <p class="ltx_p ${T_CLASS}" data-axt-for="p1">正文<span class="ltx_note ltx_role_footnote"><sup class="ltx_note_mark">1</sup
    ><span class="ltx_note_outer"><span class="ltx_note_content"><sup class="ltx_note_mark">1</sup>English note</span
    ></span></span></p>`)

const copy = (doc: Document) => doc.querySelector(`.${T_CLASS} .ltx_note_content`)!
const sourceNote = (doc: Document) => doc.querySelector(`.ltx_p:not(.${T_CLASS}) .ltx_note`)!

describe('localizeNotes', () => {
  it('译文复制进副本：一份边注里原文在上、译文在下', () => {
    const doc = withNote()
    expect(localizeNotes(doc)).toBe(1)
    const box = copy(doc).closest('.ltx_note_outer')!
    expect(box.textContent).toContain('English note')
    expect(box.textContent).toContain('中文脚注')
    expect(box.textContent!.indexOf('English')).toBeLessThan(box.textContent!.indexOf('中文'))
  })

  it('放进去的译文要脱掉脚注框外壳，且不带标号与块标记', () => {
    // .ltx_note_content 带 double 顶边线与缩进，自带的标号还是绝对定位的（实测会飞进正文）
    const doc = withNote()
    localizeNotes(doc)
    const placed = doc.querySelector('.axt-note-t')!
    expect(placed.classList.contains('ltx_note_content')).toBe(false)
    expect(placed.querySelectorAll('.ltx_note_mark, .ltx_tag')).toHaveLength(0)
    expect(placed.getAttributeNames().some(n => n.startsWith('data-axt-'))).toBe(false)
  })

  it('gathers the copy\'s own original into .axt-note-s with the marks outside, so only mode can hide it (reported 2026-09-10)', () => {
    // The copy is a clone from a placeholder with no block mark, so the [data-axt-state="translated"]
    // rule never reaches it; bare text nodes cannot be hidden by CSS, hence the wrapper
    const doc = withNote()
    localizeNotes(doc)
    const c = copy(doc)
    const wrapper = c.querySelector(':scope > .axt-note-s')!
    expect(wrapper).not.toBeNull()
    expect(wrapper.textContent).toBe('English note')
    // The marks remain direct children of the copy; the translation follows the wrapper
    expect(c.querySelector(':scope > .ltx_note_mark')).not.toBeNull()
    expect(wrapper.querySelector('.ltx_note_mark')).toBeNull()
    expect(c.lastElementChild!.classList.contains('axt-note-t')).toBe(true)
    // Idempotent: a second run adds no second wrapper
    localizeNotes(doc)
    expect(c.querySelectorAll('.axt-note-s')).toHaveLength(1)
    // 放进去的译文里，标号藏着而不是删掉（镜像句子登记要两棵树同构），所以 textContent 里有第二个 1
    expect(c.querySelector<HTMLElement>('.axt-note-t sup')?.hidden).toBe(true)
    expect(c.textContent).toBe('1English note1中文脚注')
  })

  it('keeps the marks in front: the wrapper starts after the last mark, tag and whitespace included', () => {
    // ar5iv: `<sup class="ltx_note_mark">1</sup> <span class="ltx_tag ltx_tag_note">1</span> text` (54 of 58 fixture notes)
    const doc = docOf(`
      <p class="ltx_p">body<span class="ltx_note ltx_role_footnote"><sup class="ltx_note_mark">1</sup
        ><span class="ltx_note_outer"><span class="ltx_note_content"><sup class="ltx_note_mark">1</sup> <span class="ltx_tag ltx_tag_note">1</span> English note</span
        ><span class="ltx_note_content ${T_CLASS}" data-axt-for="n1"><sup class="ltx_note_mark">1</sup>中文脚注</span></span></span></p>
      <p class="ltx_p ${T_CLASS}" data-axt-for="p1">正文<span class="ltx_note ltx_role_footnote"><sup class="ltx_note_mark">1</sup
        ><span class="ltx_note_outer"><span class="ltx_note_content"><sup class="ltx_note_mark">1</sup> <span class="ltx_tag ltx_tag_note">1</span> English note</span
        ></span></span></p>`)
    localizeNotes(doc)
    const c = copy(doc)
    const order = Array.from(c.childNodes).map(n => (n.nodeType === 1 ? ((n as Element).classList.contains('axt-note-t') ? 'axt-note-t' : (n as Element).className.split(' ')[0]) : '#')).join(' ')
    expect(order).toBe('ltx_note_mark # ltx_tag axt-note-s axt-note-t')
    expect(c.querySelector('.axt-note-s')!.textContent).toBe(' English note')
  })

  it('does not localise a skeleton or a failure widget: they are .axt-t siblings too', () => {
    for (const cls of ['axt-pending', 'axt-error']) {
      const doc = docOf(`
        <p class="ltx_p">body<span class="ltx_note ltx_role_footnote"><sup class="ltx_note_mark">1</sup
          ><span class="ltx_note_outer"><span class="ltx_note_content"><sup class="ltx_note_mark">1</sup>English note</span
          ><span class="ltx_note_content ${T_CLASS} ${cls}" data-axt-for="n1">…</span></span></span></p>
        <p class="ltx_p ${T_CLASS}" data-axt-for="p1">正文<span class="ltx_note ltx_role_footnote"><sup class="ltx_note_mark">1</sup
          ><span class="ltx_note_outer"><span class="ltx_note_content"><sup class="ltx_note_mark">1</sup>English note</span
          ></span></span></p>`)
      expect(localizeNotes(doc)).toBe(0)
      expect(copy(doc).querySelector('.axt-note-t, .axt-note-s')).toBeNull()
      expect(sourceNote(doc).hasAttribute('data-axt-note')).toBe(false)
    }
  })

  it('does not wrap before the translation arrives: the stylesheet hides an original only beside a translation, so nothing is lost', () => {
    const doc = withNote(false)
    localizeNotes(doc)
    expect(copy(doc).querySelector('.axt-note-s')).toBeNull()
  })

  it('原件那份标上 data-axt-note 由样式整框隐藏；副本那份不标', () => {
    const doc = withNote()
    localizeNotes(doc)
    expect(sourceNote(doc).hasAttribute('data-axt-note')).toBe(true)
    expect(doc.querySelector(`.${T_CLASS} .ltx_note`)!.hasAttribute('data-axt-note')).toBe(false)
  })

  it('是复制不是移动：原件里的译文留在原处，二次翻译时 renderText 才找得到旧译文去替换', () => {
    // 搬走的话，旧副本会随段落译文一起被删，脚注译文就丢了（Codex 在 #26 指出）
    const doc = withNote()
    localizeNotes(doc)
    expect(doc.querySelectorAll(`.ltx_note_content.${T_CLASS}`)).toHaveLength(1)
    expect(sourceNote(doc).querySelector(`.${T_CLASS}`)!.textContent).toContain('中文脚注')
  })

  it('删段落译文前撤销归位：原件不再被隐藏，脚注不会在所有模式下消失（Codex 在 #30 指出）', () => {
    const doc = withNote()
    localizeNotes(doc)
    expect(sourceNote(doc).hasAttribute('data-axt-note')).toBe(true)
    const paragraph = doc.querySelector(`.ltx_p:not(.${T_CLASS})`)!
    expect(delocalizeNotes(paragraph)).toBe(1)
    expect(sourceNote(doc).hasAttribute('data-axt-note')).toBe(false)
  })

  it('删脚注译文前撤销归位：外层段落译文里的副本译文一并删掉，原件露出来', () => {
    const doc = withNote()
    localizeNotes(doc)
    doc.querySelector(`.ltx_p:not(.${T_CLASS})`)!.setAttribute('data-axt-id', 'p1')
    const noteBlock = sourceNote(doc).querySelector(`.ltx_note_content:not(.${T_CLASS})`)!
    expect(delocalizeNotes(noteBlock)).toBe(1)
    expect(sourceNote(doc).hasAttribute('data-axt-note')).toBe(false)
    expect(doc.querySelector('.axt-note-t')).toBeNull()
    // 没归位过的块：什么都不做
    expect(delocalizeNotes(noteBlock)).toBe(0)
  })

  it('二次翻译：段落译文被整个换掉后，新副本再次归位', () => {
    const doc = withNote()
    localizeNotes(doc)
    // renderText 换掉段落译文：旧的（含已归位副本）删掉，插一个新的、副本又是原文
    const old = doc.querySelector(`.ltx_p.${T_CLASS}`)!
    const fresh = old.cloneNode(true) as Element
    fresh.querySelector('.axt-note-t')!.remove()
    old.replaceWith(fresh)
    expect(localizeNotes(doc)).toBe(1)
    expect(copy(doc).querySelector('.axt-note-t')!.textContent).toContain('中文脚注')
  })

  it('译文内容变了（换目标语言重翻）就换新的，不会一直用旧副本', () => {
    const doc = withNote()
    localizeNotes(doc)
    sourceNote(doc).querySelector(`.${T_CLASS}`)!.append('（修订）')
    expect(localizeNotes(doc)).toBe(1)
    expect(copy(doc).querySelectorAll('.axt-note-t')).toHaveLength(1)
    expect(copy(doc).querySelector('.axt-note-t')!.textContent).toContain('修订')
  })

  it('没跑这一趟也不丢内容：原件里仍是原文 + 译文', () => {
    const doc = withNote()
    const source = doc.querySelector(`.ltx_p:not(.${T_CLASS})`)!
    expect(source.textContent).toContain('English note')
    expect(source.textContent).toContain('中文脚注')
    expect(sourceNote(doc).hasAttribute('data-axt-note')).toBe(false)
  })

  it('脚注还没翻到就先不动，等下一轮', () => {
    const doc = withNote(false)
    expect(localizeNotes(doc)).toBe(0)
    expect(copy(doc).textContent).toContain('English note')
    expect(sourceNote(doc).hasAttribute('data-axt-note')).toBe(false)
  })

  /** 一条没被提取器登记的脚注：正文全是 URL，没有字母可翻，所以永远不会有译文（2509.10652v3 的 1–6 号） */
  const unregistered = (copyText = 'https://chat.openai.com') => docOf(`
    <p class="ltx_p" data-axt-id="p1">body<span class="ltx_note ltx_role_footnote"><sup class="ltx_note_mark">1</sup
      ><span class="ltx_note_outer"><span class="ltx_note_content"><sup class="ltx_note_mark">1</sup> <span class="ltx_tag ltx_tag_note">1</span> <a class="ltx_ref ltx_url">https://chat.openai.com</a></span
      ></span></span></p>
    <p class="ltx_p ${T_CLASS}" data-axt-for="p1">正文<span class="ltx_note ltx_role_footnote"><sup class="ltx_note_mark">1</sup
      ><span class="ltx_note_outer"><span class="ltx_note_content"><sup class="ltx_note_mark">1</sup> <span class="ltx_tag ltx_tag_note">1</span> <a class="ltx_ref ltx_url">${copyText}</a></span
      ></span></span></p>`)

  it('没登记过的脚注（正文全是 URL）：副本逐字相同，原件标记隐藏，页面右缘只剩一份', () => {
    // 译文永远不会到，等下去的结果是同一条边注画两遍（用户 2026-09-11 在 2509.10652v3 上反馈）
    const doc = unregistered()
    expect(localizeNotes(doc)).toBe(1)
    expect(sourceNote(doc).hasAttribute('data-axt-note')).toBe(true)
    // 副本没有译文可放，原样留着（不包 .axt-note-s：只有 only 模式要藏原文时才需要）
    expect(copy(doc).querySelector('.axt-note-t')).toBeNull()
    expect(copy(doc).textContent).toContain('https://chat.openai.com')
    expect(localizeNotes(doc)).toBe(0) // 幂等
  })

  it('副本被引擎改过字就两份都留着：宁可重复也不丢内容', () => {
    const doc = unregistered('https://chat.openai.com/zh')
    expect(localizeNotes(doc)).toBe(0)
    expect(sourceNote(doc).hasAttribute('data-axt-note')).toBe(false)
  })

  it('幂等：内容没变第二遍什么都不做', () => {
    const doc = withNote()
    expect(localizeNotes(doc)).toBe(1)
    expect(localizeNotes(doc)).toBe(0)
    expect(copy(doc).querySelectorAll('.axt-note-t')).toHaveLength(1)
  })

  it('数量对不上就整段跳过，宁可留原文也不张冠李戴', () => {
    const doc = withNote()
    const t = doc.querySelector(`.ltx_p.${T_CLASS}`)!
    const extra = doc.createElement('span')
    extra.className = 'ltx_note_content'
    extra.textContent = 'stray'
    t.append(extra)
    expect(localizeNotes(doc)).toBe(0)
  })
})
