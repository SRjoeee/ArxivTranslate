// Extracting and rendering the author area (DESIGN §5.1 / §5.2, 2026-09-06). Two things:
// 1. names become blocks — inside the `.ltx_creator` <span>, the translation is inserted as a sibling and must not break the name list;
// 2. the contact label `.ltx_contact_name` is a void — template-generated and hidden by the site's display:none,
//    so an `.ltx_contact` whose only translatable content is that label is no longer a block, and the page shows no two identical email lines.
import { describe, expect, it } from 'vitest'
import { extract } from '@/core/extractor'
import { serialize } from '@/core/protector'
import { rehydrate } from '@/core/protector/rehydrate'
import { T_CLASS } from '@/core/marks'
import { FOR_ATTR } from '@/core/renderer/attrs'
import { restore } from '@/core/renderer/page'
import { renderText } from '@/core/renderer/translation'
import type { TextBlock } from '@/core/extractor'
import { docOf, frag } from './helpers'

/** The shape of real fixtures (2410.00260: names with footnote superscripts; 2312.17141: “ and ” between authors) */
const AUTHORS = `<div class="ltx_authors">
  <span class="ltx_creator ltx_role_author"><span class="ltx_personname">Vinayak Arannil<sup class="ltx_sup">*</sup> </span><span class="ltx_author_notes"><span class="ltx_author_notes_content"><span class="ltx_contact ltx_role_affiliation">Amazon Web Services </span></span></span></span>
  <span class="ltx_author_before"> and </span>
  <span class="ltx_creator ltx_role_author"><span class="ltx_personname">Brian Street </span></span>
</div>`

const nameBlocks = (doc: Document) =>
  extract(doc).filter((b): b is TextBlock => b.kind === 'text' && b.el.matches('.ltx_personname'))

describe('author names (the 2026-09-06 decision of §5.2)', () => {
  it('the two authors are a block each, the affiliation stays a block of its own, the conjunction is no block', () => {
    const doc = docOf(AUTHORS)
    const blocks = extract(doc)
    const classes = blocks.map(b => b.el.className)
    expect(blocks.filter(b => b.el.matches('.ltx_personname'))).toHaveLength(2)
    expect(blocks.filter(b => b.el.matches('.ltx_contact'))).toHaveLength(1)
    // The conjunction is skip: as a block it would break the name list into one word per line
    expect(classes.some(c => c.includes('ltx_author_before'))).toBe(false)
  })

  it('a footnote superscript inside a name goes through a paired placeholder and comes back in place', () => {
    const doc = docOf(AUTHORS)
    const [first] = nameBlocks(doc)
    const block = serialize(first!.el)
    // <sup> is in neither the protect nor the unit table; it serialises to a paired placeholder
    expect(block.text).toMatch(/^Vinayak Arannil<t id="\d+">\*<\/t>\s*$/)
    expect(block.paired.size).toBe(1)
    const fragment = rehydrate(block.text.replace('Vinayak Arannil', '维纳亚克·阿兰尼尔'), block, doc)
    const holder = doc.createElement('span')
    holder.append(fragment)
    expect(holder.innerHTML).toBe('维纳亚克·阿兰尼尔<sup class="ltx_sup">*</sup> ')
  })

  it('the translation is inserted after the name, still inside .ltx_creator, with the affiliation still following', () => {
    const doc = docOf(AUTHORS)
    const [first] = nameBlocks(doc)
    const node = renderText(first!, frag(doc, '维纳亚克·阿兰尼尔'))
    const creator = doc.querySelector('.ltx_creator')!
    expect(node.parentElement).toBe(creator)
    expect(node.previousElementSibling).toBe(first!.el)
    // The translation inherits the original block's class (§7.1), so it is still a <span>, inline by nature, and does not break the name list
    expect(node.tagName).toBe('SPAN')
    expect(node.className).toBe(`ltx_personname ${T_CLASS}`)
    expect(node.getAttribute(FOR_ATTR)).toBe(first!.id)
    // The affiliation still follows the translation; the order is not disturbed
    expect(node.nextElementSibling?.className).toBe('ltx_author_notes')
  })

  it('after restoring the original the DOM is equal node for node (§7.1)', () => {
    const doc = docOf(AUTHORS)
    const before = doc.documentElement.outerHTML
    for (const block of nameBlocks(doc)) renderText(block, frag(doc, `译:${block.el.textContent}`))
    expect(doc.querySelectorAll(`.${T_CLASS}`)).toHaveLength(2)
    restore(doc)
    expect(doc.documentElement.outerHTML).toBe(before)
  })
})

/** Three kinds of .ltx_contact: label + email only, label + monospace account only, label + a real affiliation */
const CONTACTS = `<div class="ltx_authors"><span class="ltx_creator ltx_role_author"><span class="ltx_personname">A. B. </span><span class="ltx_author_notes"><span class="ltx_author_notes_content">
  <span class="ltx_contact ltx_role_email"><span class="ltx_contact_name">Email: </span><a href="mailto:a@b.edu">a@b.edu</a> </span>
  <span class="ltx_contact ltx_role_affiliation"><span class="ltx_contact_name">Affiliation:&nbsp;</span><span class="ltx_text ltx_font_typewriter">{a, b}@c.com</span></span>
  <span class="ltx_contact ltx_role_affiliation"><span class="ltx_contact_name">Affiliation:&nbsp;</span>University of Southern California </span>
</span></span></span></div>`

describe('the contact label .ltx_contact_name (the 2026-09-06 decision of §5.2)', () => {
  it('an .ltx_contact whose only translatable content is the hidden label is no block: the page would show two identical email lines', () => {
    const doc = docOf(CONTACTS)
    const contacts = [...doc.querySelectorAll('.ltx_contact')]
    const blocks = new Set(extract(doc).map(b => b.el))
    expect(contacts.map(el => blocks.has(el))).toEqual([false, false, true])
  })

  it('an affiliation with real content stays a block, the hidden label kept in place as a void placeholder', () => {
    const doc = docOf(CONTACTS)
    const real = doc.querySelectorAll('.ltx_contact')[2]!
    const block = serialize(real)
    expect(block.text).toMatch(/^<x id="\d+"\/>University of Southern California\s*$/)
    const fragment = rehydrate(block.text.replace('University of Southern California', '南加州大学'), block, doc)
    const holder = doc.createElement('span')
    holder.append(fragment)
    // The label comes back as it was (display:none on the page; the reader sees it on neither side)
    expect(holder.innerHTML).toBe('<span class="ltx_contact_name">Affiliation:&nbsp;</span>南加州大学 ')
  })
})
