import { describe, expect, it } from 'vitest'
import { BUILT_IN_HIGHLIGHTS, BUILT_IN_STYLES, PALETTE, activeHighlight, activeStyle, appearanceSchema, resetBuiltIns } from '@/config/appearance'
import { DEFAULT_CONFIG } from '@/config/schema'

describe('appearance profiles', () => {
  it('ships six styles and three highlights, with the follow-original style and the soft green band active', () => {
    expect(BUILT_IN_STYLES.map(s => s.id)).toEqual(['follow', 'green', 'blue', 'amber', 'muted', 'blur'])
    expect(BUILT_IN_HIGHLIGHTS.map(h => h.id)).toEqual(['soft-green', 'sand', 'sky'])
    expect(DEFAULT_CONFIG.appearance.activeStyle).toBe('follow')
    expect(DEFAULT_CONFIG.appearance.activeHighlight).toBe('soft-green')
    expect(PALETTE).toHaveLength(8)
  })
  it('falls back to the first built-in when the active id is gone', () => {
    const a = { ...DEFAULT_CONFIG.appearance, activeStyle: 'deleted', activeHighlight: 'deleted' }
    expect(activeStyle(a).id).toBe('follow')
    expect(activeHighlight(a).id).toBe('soft-green')
  })
  it("reset restores edited and deleted built-ins of one list and keeps the reader's own", () => {
    const own = { id: 'style-abc12345', name: '我的', color: '#123456', opacity: 1, underline: 'none' as const, thickness: 1 as const, blur: false, css: '' }
    const editedBand = { ...BUILT_IN_HIGHLIGHTS[0]!, opacity: 0.5 }
    const a = { ...DEFAULT_CONFIG.appearance, styles: [{ ...BUILT_IN_STYLES[0]!, color: '#ff0000' }, own], highlights: [editedBand] }
    const r = resetBuiltIns(a, 'styles')
    expect(r.styles.map(s => s.id)).toEqual([...BUILT_IN_STYLES.map(s => s.id), own.id])
    expect(r.styles[0]!.color).toBe('')
    // The other grid has its own reset; resetting styles must not undo an edited band
    expect(r.highlights).toEqual([editedBand])
    const b = resetBuiltIns(a, 'highlights')
    expect(b.highlights.map(h => h.id)).toEqual(BUILT_IN_HIGHLIGHTS.map(h => h.id))
    expect(b.highlights[0]!.opacity).toBe(BUILT_IN_HIGHLIGHTS[0]!.opacity)
    expect(b.styles).toEqual(a.styles)
  })
  it('rejects a bad colour, an opacity out of range, a css block with braces, an unknown underline', () => {
    const base = DEFAULT_CONFIG.appearance
    const bad = (patch: object) => appearanceSchema.safeParse({ ...base, styles: [{ ...BUILT_IN_STYLES[0]!, ...patch }] }).success
    expect(bad({ color: 'red;' })).toBe(false)
    expect(bad({ opacity: 0.1 })).toBe(false)
    expect(bad({ css: 'color: red }' })).toBe(false)
    expect(bad({ underline: 'double' })).toBe(false)
    expect(bad({})).toBe(true)
  })
})
