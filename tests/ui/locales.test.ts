import { describe, expect, it } from 'vitest'
import { LOCALES, LOCALE_CODES, LOCALE_NAMES, isLocaleCode, pickLocale } from '@/locales'
import { POPUP_FIXTURES } from '@/entrypoints/popup/fixtures'
import { derivePopupView } from '@/entrypoints/popup/view-model'
import { S, copyName, localeInUse, setLocale } from '@/ui/strings'
import { NAME_MAX } from '@/config/appearance'
import { styleTile } from '@/ui/appearance/tiles'

/** Every leaf of a pack, with the path that leads to it, so a failure names the key */
function leaves(value: unknown, path = ''): [string, string][] {
  if (typeof value === 'string') return [[path, value]]
  // A sentence built from parts: call it with stand-ins to see the words around them
  if (typeof value === 'function') return [[path, String((value as (...a: unknown[]) => string)(1, 'A', 'B'))]]
  if (Array.isArray(value)) return value.flatMap((v, i) => leaves(v, `${path}[${i}]`))
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([k, v]) => leaves(v, path ? `${path}.${k}` : k))
  return []
}

const HAN = /\p{Script=Han}/u

describe('locale packs', () => {
  it('every language has its own name in the table, codes and packs one to one', () => {
    expect(LOCALE_CODES.length).toBeGreaterThan(1)
    for (const code of LOCALE_CODES) {
      expect(LOCALE_NAMES[code], code).toBeTruthy()
      expect(LOCALES[code], code).toBeTruthy()
    }
  })

  it('every pack has exactly the same keys: a missing key fails the types, guarded here at runtime too', () => {
    const paths = (code: (typeof LOCALE_CODES)[number]) => leaves(LOCALES[code]).map(([p]) => p).sort()
    const first = paths(LOCALE_CODES[0]!)
    for (const code of LOCALE_CODES.slice(1)) expect(paths(code), code).toEqual(first)
  })

  it('no Chinese left in the English pack: an untranslated entry leaks straight through as Chinese, and the type check cannot see it', () => {
    for (const [path, text] of leaves(LOCALES.en)) {
      // The preview sentence is the one exception: it is a sample of a *translation*, so it stays
      // in the language being previewed
      if (path.endsWith('previewTarget')) continue
      expect(HAN.test(text), `${path}: ${text}`).toBe(false)
    }
  })

  it('no placeholder English sentences left in the Chinese pack (brand names, protocol words and examples excepted)', () => {
    // Sentences assembled from parameters alone excepted: called with placeholders their result is naturally all English
    const allowed = /^(S\.brand|S\.service\.(llm|microsoft|google|chrome)|O\.services\.(apiKey|namePlaceholder|baseURLHint)|O\.reading\.previewSource|S\.setup\.step1|S\.setup\.step1Hint|O\.fallbackWhy\.invalid)/
    for (const [path, text] of leaves(LOCALES['zh-CN'])) {
      if (allowed.test(path) || text === '') continue
      // A Chinese copy string of pure ASCII can hardly be anything but forgotten
      expect(/[A-Za-z]/.test(text) && !HAN.test(text), `${path}: ${text}`).toBe(false)
    }
  })

  it('the abstract page\'s link carries the current product name in every language: the old name was once hard-coded in that entry (Codex on #161)', () => {
    for (const code of LOCALE_CODES) {
      const { S } = LOCALES[code]
      expect(S.page.abstractLink(S.brand), code).toContain(S.brand)
      expect(S.page.abstractLink(S.brand), code).not.toMatch(/ArxivTranslate/)
    }
  })

  it('pickLocale: the reader\'s choice first, then the browser\'s exact code, then the same language, finally English', () => {
    expect(pickLocale('zh-CN', ['en'])).toBe('zh-CN')
    expect(pickLocale('auto', ['zh-CN', 'en'])).toBe('zh-CN')
    expect(pickLocale(undefined, ['en-GB'])).toBe('en')
    // Traditional lands on the Chinese pack first too: closer than English
    expect(pickLocale('auto', ['zh-TW'])).toBe('zh-CN')
    expect(pickLocale('auto', ['fr-FR'])).toBe('en')
    // A code that no longer exists must not lock up the interface
    expect(pickLocale('kl-GL', ['fr'])).toBe('en')
    // `in` recognises names on Object.prototype: then LOCALES[value] is a function and the whole page fails to render
    for (const trap of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      expect(isLocaleCode(trap), trap).toBe(false)
      expect(pickLocale(trap, ['fr']), trap).toBe('en')
    }
  })

  it('after setLocale every state of the popup changes language, not one sentence left in the previous pack', () => {
    setLocale('en')
    expect(localeInUse()).toBe('en')
    for (const f of POPUP_FIXTURES) {
      for (const [path, text] of leaves(derivePopupView(f.input))) {
        // A language's own name is meant to be in its own script — 「Japanese (日本語)」 — and the
        // sample sentence is a sample of a translation
        if (path.includes('previewTarget') || path.includes('hint') || path.startsWith('language') || path.startsWith('menu.items')) continue
        expect(HAN.test(text), `${f.id} ${path}: ${text}`).toBe(false)
      }
    }
    setLocale('zh-CN')
    expect(S.primary.translate).toBe('翻译本页')
  })
})

describe('what a pack is read at', () => {
  it('the empty state is computed at call time: the module loads before applyLocale, and a constant would freeze the fallback language (Codex on #161)', () => {
    setLocale('zh-CN')
    const zhEmpty = derivePopupView({ page: null, saved: null, session: null, config: null, pack: null, helper: null, platform: null, menu: null, shortcut: null, extensionId: 'x', savedRevision: null })
    expect(zhEmpty.primary.label).toBe(LOCALES['zh-CN'].S.primary.translate)
    setLocale('en')
    const enEmpty = derivePopupView({ page: null, saved: null, session: null, config: null, pack: null, helper: null, platform: null, menu: null, shortcut: null, extensionId: 'x', savedRevision: null })
    expect(enEmpty.primary.label).toBe(LOCALES.en.S.primary.translate)
    setLocale('zh-CN')
  })
})

describe('copy names', () => {
  it('copying a long name gives way on the name, not the suffix: otherwise the copy shares the original\'s name (Codex on #161)', () => {
    setLocale('zh-CN')
    const long = { id: 'x', name: 'あ'.repeat(40) }
    const copy = copyName(long)
    expect(copy.length).toBeLessThanOrEqual(NAME_MAX)
    expect(copy.endsWith(LOCALES['zh-CN'].O.reading.copySuffix)).toBe(true)
    expect(copy).not.toBe(long.name)
    setLocale('en')
    const en = copyName(long)
    expect(en.length).toBeLessThanOrEqual(NAME_MAX)
    expect(en.endsWith(LOCALES.en.O.reading.copySuffix)).toBe(true)
    setLocale('zh-CN')
  })

  it('the per-line glossary problem sentence is assembled by the pack, Chinese and English punctuation each their own', () => {
    for (const code of LOCALE_CODES) {
      const text = LOCALES[code].O.prompts.glossaryIssue.noSeparator(2)
      expect(text, code).toContain('2')
      // 「第 2 行缺少…」 / "Line 2 has no separator…": the two parts must not be glued together directly
      expect(text, code).not.toMatch(/2[A-Za-z]/)
    }
  })
})

describe('style previews', () => {
  it('advanced declarations are drawn into the preview too: a style that works through css only must not look unstyled in the menu (Codex on #161)', () => {
    const plain = styleTile({ id: 'p', name: 'p', color: '', opacity: 1, underline: 'none', thickness: 1, blur: false, css: '' })
    const bold = styleTile({ id: 'b', name: 'b', color: '', opacity: 1, underline: 'none', thickness: 1, blur: false, css: 'font-weight: 600; letter-spacing: .02em' })
    expect(bold).not.toEqual(plain)
    expect(bold).toMatchObject({ fontWeight: '600', letterSpacing: '.02em' })
    // Custom properties keep their names; that is how React writes them
    expect(styleTile({ id: 'v', name: 'v', color: '', opacity: 1, underline: 'none', thickness: 1, blur: false, css: '--x: 3px' })).toMatchObject({ '--x': '3px' })
    // The later one wins, matching the order of the injected sheet on the page
    expect(styleTile({ id: 'o', name: 'o', color: 'red', opacity: 1, underline: 'none', thickness: 1, blur: false, css: 'color: blue' }).color).toBe('blue')
    // `!important` passes the sanitiser and the page accepts it, but the CSSOM does not take a priority written inside the value:
    // drop the priority, keep the declaration, or the preview drops this one quietly (Codex on #161)
    expect(styleTile({ id: 'i', name: 'i', color: '', opacity: 1, underline: 'none', thickness: 1, blur: false, css: 'color: red !important' }).color).toBe('red')
    expect(styleTile({ id: 'i2', name: 'i2', color: '', opacity: 1, underline: 'none', thickness: 1, blur: false, css: 'font-weight: 700 ! IMPORTANT' })).toMatchObject({ fontWeight: '700' })
    // Layout properties stay out of the preview: the sanitiser lets `position: fixed` through, on the paper that is the reader's own business,
    // but the sample is drawn inside the popup and would cover it (Codex on #161)
    const escaping = styleTile({ id: 'e', name: 'e', color: '', opacity: 1, underline: 'none', thickness: 1, blur: false, css: 'position: fixed; inset: 0; z-index: 9999; width: 100vw; display: block; transform: scale(9); margin: 40px; color: teal' })
    expect(escaping).toMatchObject({ color: 'teal' })
    for (const gone of ['position', 'inset', 'zIndex', 'width', 'display', 'transform', 'margin']) expect(escaping, gone).not.toHaveProperty(gone)
    // Nor anything that inflates the box: a 1000px font size would make one row thousands of pixels tall, and the other options out of reach
    const huge = styleTile({ id: 'h', name: 'h', color: '', opacity: 1, underline: 'none', thickness: 1, blur: false, css: 'font-size: 1000px; line-height: 1000px; padding: 500px; border-bottom-width: 400px; font-weight: 700' })
    expect(huge).toMatchObject({ fontWeight: '700' })
    for (const gone of ['fontSize', 'lineHeight', 'padding', 'borderBottomWidth']) expect(huge, gone).not.toHaveProperty(gone)
    // The safety net: whatever happens, no row is made taller
    expect(huge.maxHeight).toBeTruthy()
    expect(huge.overflow).toBe('hidden')
  })
})
