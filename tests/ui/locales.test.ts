import { describe, expect, it } from 'vitest'
import { LOCALES, LOCALE_CODES, LOCALE_NAMES, pickLocale } from '@/locales'
import { POPUP_FIXTURES } from '@/entrypoints/popup/fixtures'
import { derivePopupView } from '@/entrypoints/popup/view-model'
import { S, localeInUse, setLocale } from '@/ui/strings'

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
  it('每种语言都在表里有自己的名字，代码与包一一对应', () => {
    expect(LOCALE_CODES.length).toBeGreaterThan(1)
    for (const code of LOCALE_CODES) {
      expect(LOCALE_NAMES[code], code).toBeTruthy()
      expect(LOCALES[code], code).toBeTruthy()
    }
  })

  it('每个包的键完全一致：少一个键在类型上就过不了，这里守的是运行时也一致', () => {
    const paths = (code: (typeof LOCALE_CODES)[number]) => leaves(LOCALES[code]).map(([p]) => p).sort()
    const first = paths(LOCALE_CODES[0]!)
    for (const code of LOCALE_CODES.slice(1)) expect(paths(code), code).toEqual(first)
  })

  it('英文包里不留中文：漏译会直接漏成中文，类型检查看不出来', () => {
    for (const [path, text] of leaves(LOCALES.en)) {
      // The preview sentence is the one exception: it is a sample of a *translation*, so it stays
      // in the language being previewed
      if (path.endsWith('previewTarget')) continue
      expect(HAN.test(text), `${path}: ${text}`).toBe(false)
    }
  })

  it('中文包里不留占位的英文句子（品牌名、协议词与示例除外）', () => {
    const allowed = /^(S\.brand|S\.service\.(llm|microsoft|google|chrome)|O\.services\.(apiKey|namePlaceholder|baseURLHint)|O\.reading\.previewSource|S\.setup\.step1|S\.setup\.step1Hint)/
    for (const [path, text] of leaves(LOCALES['zh-CN'])) {
      if (allowed.test(path) || text === '') continue
      // 一句纯 ASCII 的中文文案基本只可能是忘了翻
      expect(/[A-Za-z]/.test(text) && !HAN.test(text), `${path}: ${text}`).toBe(false)
    }
  })

  it('pickLocale：读者选定的优先，其次浏览器的精确码，再次同语言，最后英文', () => {
    expect(pickLocale('zh-CN', ['en'])).toBe('zh-CN')
    expect(pickLocale('auto', ['zh-CN', 'en'])).toBe('zh-CN')
    expect(pickLocale(undefined, ['en-GB'])).toBe('en')
    // 繁体也先落到中文包：比英文近
    expect(pickLocale('auto', ['zh-TW'])).toBe('zh-CN')
    expect(pickLocale('auto', ['fr-FR'])).toBe('en')
    // 一个已经不存在的代码不该把界面卡住
    expect(pickLocale('kl-GL', ['fr'])).toBe('en')
  })

  it('setLocale 之后 popup 的每个状态都跟着换语言，没有一句留在原来的包里', () => {
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
