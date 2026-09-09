// Author extraction and rendering (DESIGN §5.1 / §5.2, 2026-09-06). Two requirements:
// 1. Names form blocks inside ltx_creator spans; translated siblings must not break the name list.
// 2. Template-generated ltx_contact_name labels are void because site CSS hides them with display:none.
//    A contact whose only translatable text is that label no longer forms a block, avoiding duplicate email addresses.
import { describe, expect, it } from 'vitest'
import { extract } from '@/core/extractor'
import { serialize } from '@/core/protector'
import { rehydrate } from '@/core/protector/rehydrate'
import { FOR_ATTR, T_CLASS, renderText, restore } from '@/core/renderer'
import type { TextBlock } from '@/core/extractor'
import { docOf, frag } from './helpers'

/** Real fixture structure: 2410.00260 has name footnote superscripts; 2312.17141 joins authors with " and " */
const AUTHORS = `<div class="ltx_authors">
  <span class="ltx_creator ltx_role_author"><span class="ltx_personname">Vinayak Arannil<sup class="ltx_sup">*</sup> </span><span class="ltx_author_notes"><span class="ltx_author_notes_content"><span class="ltx_contact ltx_role_affiliation">Amazon Web Services </span></span></span></span>
  <span class="ltx_author_before"> and </span>
  <span class="ltx_creator ltx_role_author"><span class="ltx_personname">Brian Street </span></span>
</div>`

const nameBlocks = (doc: Document) =>
  extract(doc).filter((b): b is TextBlock => b.kind === 'text' && b.el.matches('.ltx_personname'))

describe('author names (§5.2 decision, 2026-09-06)', () => {
  it('each author forms a block, affiliations remain independent blocks, and conjunctions do not form blocks', () => {
    const doc = docOf(AUTHORS)
    const blocks = extract(doc)
    const classes = blocks.map(b => b.el.className)
    expect(blocks.filter(b => b.el.matches('.ltx_personname'))).toHaveLength(2)
    expect(blocks.filter(b => b.el.matches('.ltx_contact'))).toHaveLength(1)
    // Conjunctions are skipped; making them blocks would split the name list into one word per line.
    expect(classes.some(c => c.includes('ltx_author_before'))).toBe(false)
  })

  it('footnote superscripts in names use paired placeholders and are restored in place', () => {
    const doc = docOf(AUTHORS)
    const [first] = nameBlocks(doc)
    const block = serialize(first!.el)
    // sup is neither protected nor a unit, so it becomes a paired placeholder.
    expect(block.text).toMatch(/^Vinayak Arannil<t id="\d+">\*<\/t>\s*$/)
    expect(block.paired.size).toBe(1)
    const fragment = rehydrate(block.text.replace('Vinayak Arannil', '维纳亚克·阿兰尼尔'), block, doc)
    const holder = doc.createElement('span')
    holder.append(fragment)
    expect(holder.innerHTML).toBe('维纳亚克·阿兰尼尔<sup class="ltx_sup">*</sup> ')
  })

  it('translations follow original names inside ltx_creator with affiliation information still afterward', () => {
    const doc = docOf(AUTHORS)
    const [first] = nameBlocks(doc)
    const node = renderText(first!, frag(doc, '维纳亚克·阿兰尼尔'))
    const creator = doc.querySelector('.ltx_creator')!
    expect(node.parentElement).toBe(creator)
    expect(node.previousElementSibling).toBe(first!.el)
    // Translations inherit original classes (§7.1) and remain inline spans without breaking the name list.
    expect(node.tagName).toBe('SPAN')
    expect(node.className).toBe(`ltx_personname ${T_CLASS}`)
    expect(node.getAttribute(FOR_ATTR)).toBe(first!.id)
    // Affiliation information retains its position after the translation.
    expect(node.nextElementSibling?.className).toBe('ltx_author_notes')
  })

  it('restoration produces a node-for-node identical DOM (§7.1)', () => {
    const doc = docOf(AUTHORS)
    const before = doc.documentElement.outerHTML
    for (const block of nameBlocks(doc)) renderText(block, frag(doc, `译:${block.el.textContent}`))
    expect(doc.querySelectorAll(`.${T_CLASS}`)).toHaveLength(2)
    restore(doc)
    expect(doc.documentElement.outerHTML).toBe(before)
  })
})

/** Three contact shapes: label plus email, label plus monospace account, and label plus real affiliation */
const CONTACTS = `<div class="ltx_authors"><span class="ltx_creator ltx_role_author"><span class="ltx_personname">A. B. </span><span class="ltx_author_notes"><span class="ltx_author_notes_content">
  <span class="ltx_contact ltx_role_email"><span class="ltx_contact_name">Email: </span><a href="mailto:a@b.edu">a@b.edu</a> </span>
  <span class="ltx_contact ltx_role_affiliation"><span class="ltx_contact_name">Affiliation:&nbsp;</span><span class="ltx_text ltx_font_typewriter">{a, b}@c.com</span></span>
  <span class="ltx_contact ltx_role_affiliation"><span class="ltx_contact_name">Affiliation:&nbsp;</span>University of Southern California </span>
</span></span></span></div>`

describe('contact labels ltx_contact_name (§5.2 decision, 2026-09-06)', () => {
  it('contacts with only a hidden translatable label do not form blocks, avoiding duplicate email addresses', () => {
    const doc = docOf(CONTACTS)
    const contacts = [...doc.querySelectorAll('.ltx_contact')]
    const blocks = new Set(extract(doc).map(b => b.el))
    expect(contacts.map(el => blocks.has(el))).toEqual([false, false, true])
  })

  it('affiliations with real text still form blocks and preserve hidden labels as void placeholders', () => {
    const doc = docOf(CONTACTS)
    const real = doc.querySelectorAll('.ltx_contact')[2]!
    const block = serialize(real)
    expect(block.text).toMatch(/^<x id="\d+"\/>University of Southern California\s*$/)
    const fragment = rehydrate(block.text.replace('University of Southern California', '南加州大学'), block, doc)
    const holder = doc.createElement('span')
    holder.append(fragment)
    // Return the label unchanged; display:none hides it on both sides.
    expect(holder.innerHTML).toBe('<span class="ltx_contact_name">Affiliation:&nbsp;</span>南加州大学 ')
  })
})
