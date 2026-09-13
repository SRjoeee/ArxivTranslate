import { describe, expect, it } from 'vitest'
import { expectationsFromText, serialize, validate } from '@/core/protector'
import { el } from './helpers'

// 'Let <x id="1"/> be <t id="2">bold</t> per <x id="3"/>.'
const block = () => serialize(el('<p class="ltx_p">Let <math class="ltx_Math"><mi>x</mi></math> be <em class="ltx_emph">bold</em> per <a class="ltx_ref" href="#S2">2</a>.</p>'))
const reason = (translated: string) => {
  const r = validate(translated, block())
  return r.ok ? 'ok' : r.reason
}

describe('validate', () => {
  it('identity and reordering both pass', () => {
    expect(reason('令 <x id="1"/> 为 <t id="2">粗体</t>，见 <x id="3"/>。')).toBe('ok')
    expect(reason('<x id="3"/> 之后，<t id="2">粗体</t> 与 <x id="1"/>')).toBe('ok')
  })

  it('tolerates common spelling variants', () => {
    expect(reason('<x id="1" /> a <t id=\'2\'>b</t> c <x id=3></x>')).toBe('ok')
  })

  it('a void or a paired missing', () => {
    expect(reason('令 <x id="1"/> 为 <t id="2">粗体</t>。')).toBe('missing')
    expect(reason('<x id="1"/> a <x id="3"/>')).toBe('missing')
  })

  it('duplicated', () => {
    expect(reason('<x id="1"/><x id="1"/> <t id="2">a</t> <x id="3"/>')).toBe('duplicate')
    expect(reason('<x id="1"/> <t id="2">a</t><t id="2">b</t> <x id="3"/>')).toBe('duplicate')
  })

  it('an unknown id', () => {
    expect(reason('<x id="1"/> <t id="2">a</t> <x id="3"/> <x id="9"/>')).toBe('unknown')
  })

  it('a paired unclosed or closed once too often', () => {
    expect(reason('<x id="1"/> <t id="2">a <x id="3"/>')).toBe('unbalanced')
    expect(reason('<x id="1"/> <t id="2">a</t></t> <x id="3"/>')).toBe('unbalanced')
  })

  it('void and paired kinds swapped', () => {
    expect(reason('<t id="1">x</t> <t id="2">a</t> <x id="3"/>')).toBe('kind-mismatch')
    expect(reason('<x id="1"/> <x id="2"/> <x id="3"/>')).toBe('kind-mismatch')
  })

  it('paired nesting is valid', () => {
    const b = serialize(el('<p class="ltx_p"><span class="ltx_text">A <em class="ltx_emph">B</em></span></p>'))
    expect(validate('<t id="1">甲 <t id="2">乙</t></t>', b).ok).toBe(true)
    expect(validate('<t id="2">乙</t><t id="1">甲</t>', b).ok).toBe(true)
  })

  it('a failure result carries detail', () => {
    const r = validate('nothing', block())
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.detail).toMatch(/1/)
  })
})

describe('expectationsFromText (issue #42: the expectations are derived from the request text, no accept passed across messages)', () => {
  it('the derived expectations are equivalent to serialize\'s result: the same translation is judged alike on both sides', () => {
    const b = block()
    const derived = expectationsFromText(b.text)
    expect([...derived.slots.keys()].sort()).toEqual([...b.slots.keys()].sort())
    expect([...derived.paired].sort()).toEqual([...b.paired].sort())
    for (const translated of [
      '令 <x id="1"/> 为 <t id="2">粗体</t>，见 <x id="3"/>。',
      '令 <x id="1"/> 为 <t id="2">粗体</t>。',
      '<x id="1"/><x id="1"/> <t id="2">a</t> <x id="3"/>',
      '<x id="1"/> <x id="2"/> <x id="3"/>',
      '<x id="1"/> <t id="2">a</t> <x id="3"/> <x id="9"/>',
      'nothing',
    ]) {
      expect([translated, validate(translated, derived)]).toEqual([translated, validate(translated, b)])
    }
  })

  it('nested paired are recognised too', () => {
    const b = serialize(el('<p class="ltx_p"><span class="ltx_text">A <em class="ltx_emph">B</em></span></p>'))
    const derived = expectationsFromText(b.text)
    expect([...derived.paired].sort()).toEqual([...b.paired].sort())
    expect(derived.slots.size).toBe(b.slots.size)
  })

  it('the runs path\'s plain text has no slots: a tag appearing from nowhere in the translation is judged unknown and may not enter the cache', () => {
    const derived = expectationsFromText('a plain run without placeholders')
    expect(derived.slots.size).toBe(0)
    expect(validate('一段纯译文', derived).ok).toBe(true)
    expect(validate('一段 <x id="1"/> 译文', derived)).toMatchObject({ ok: false, reason: 'unknown' })
  })

  it('an extra </t> is no slot, and the scan is not led astray by it', () => {
    expect(expectationsFromText('a </t> b <x id="4"/>')).toMatchObject({ slots: new Map([[4, null]]), paired: new Set() })
  })
})
