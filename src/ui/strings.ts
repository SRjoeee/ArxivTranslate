// The reader-visible strings of the extension's pages, in whichever language the interface is set to
// (docs/UI.md §3 and §6). The words themselves live in `src/locales/*`; this module is what picks a
// pack and what everything else imports.
//
// **`S` and `O` are live bindings, not constants.** `setLocale` swaps them, and an importer sees the
// swap because ES modules bind by reference. What does *not* see it is a value computed at module
// load: `const NAMES = { side: S.mode.side }` at the top of a file freezes the pack that happened to
// be current when that file was imported. Build such tables inside the component instead.
//
// The pack is chosen once, before anything renders (`applyLocale`), so nothing on screen is ever
// half translated.
import { BUILT_IN_HIGHLIGHTS, BUILT_IN_STYLES, NAME_MAX } from '@/config/appearance'
import { LANG_CODE_TO_EN_NAME, LANG_CODE_TO_ZH_NAME, type LangCode, label } from '@/config/languages'
import type { FallbackReason } from '@/config/storage'
import { FALLBACK_LOCALE, LOCALES, type Locale, type LocaleCode } from '@/locales'
import type { ProviderErrorKind } from '@/providers/types'

export { PREVIEW_SOURCE, PREVIEW_TARGET } from '@/locales/preview'

/**
 * Which set of language names each interface language uses for the target-language menu. A pack
 * does not carry its own copy of 179 language names — adding a language must stay one small file —
 * so it points at a table instead, and a language without one reads them in English
 */
export const LOCALE_LANGUAGE_NAMES: Record<LocaleCode, Partial<Record<LangCode, string>>> = {
  'zh-CN': LANG_CODE_TO_ZH_NAME,
  en: LANG_CODE_TO_EN_NAME,
}

let currentCode: LocaleCode = FALLBACK_LOCALE
let current: Locale = LOCALES[FALLBACK_LOCALE]

/** The popup's words (docs/UI.md §3.1) */
export let S: Locale['S'] = current.S
/** The settings page's words (docs/UI.md §3.2) */
export let O: Locale['O'] = current.O

/** Swap the pack. Everything already rendered has to be rendered again; see the note above */
export function setLocale(code: LocaleCode): void {
  currentCode = code
  current = LOCALES[code]
  S = current.S
  O = current.O
}

/** Which pack is in use; the settings page marks it in its menu */
export function localeInUse(): LocaleCode {
  return currentCode
}

/**
 * A target language's name for the reader: in the interface's language, with its own name beside it
 * ("日语（日本語）", "Japanese（日本語）"). The two choices are separate (UI.md §6), so the menu of
 * languages has to be readable whichever interface language is set
 */
export function languageName(code: LangCode): string {
  return label(code, LOCALE_LANGUAGE_NAMES[currentCode])
}

/**
 * An appearance profile's name. The ones that ship with the extension are ours, so they follow the
 * interface's language; a profile the reader added, or a shipped one they **renamed**, keeps the
 * name they gave it — which is what "the stored name is still the one it shipped with" tests for
 */
/** The second line of the settings page's fallback notice, in the reader's language (S-O-01) */
export function fallbackText(reason: FallbackReason): string {
  switch (reason.kind) {
    case 'tooNew':
      return O.fallbackWhy.tooNew(reason.stored, reason.supported)
    case 'invalid':
      return O.fallbackWhy.invalid(reason.where, reason.message)
    default:
      return O.fallbackWhy.unknown
  }
}

/**
 * What a duplicate is called: the name as displayed, plus the pack's suffix. **The base gives way,
 * not the suffix** — clipping the finished string would eat the suffix off a name already at the
 * limit and hand back a copy indistinguishable from its source (Codex on #161)
 */
export function copyName(profile: { id: string; name: string }, kind: 'styles' | 'highlights' = 'styles'): string {
  const suffix = O.reading.copySuffix
  const room = NAME_MAX - suffix.length - 1
  return `${profileName(profile, kind).slice(0, Math.max(1, room))} ${suffix}`
}

export function profileName(profile: { id: string; name: string }, kind: 'styles' | 'highlights' = 'styles'): string {
  const shipped = kind === 'styles' ? BUILT_IN_STYLES : BUILT_IN_HIGHLIGHTS
  const original = shipped.find(p => p.id === profile.id)
  if (!original || original.name !== profile.name) return profile.name
  const names: Record<string, string> = kind === 'styles' ? O.reading.builtInStyles : O.reading.builtInHighlights
  return names[profile.id] ?? profile.name
}

/**
 * The order the three modes are offered in (UI.md S-P-70). 左右 comes first: on a wide screen it is
 * the layout most readers stay in. Presentation only — `MODE_VALUES` (config/schema.ts) stays the
 * data order, and both the popup's mode bar and the settings page's image modes read this one
 */
export const MODE_ORDER = ['side', 'stack', 'only'] as const

/** The settings page (docs/UI.md §3.2). Same register as `S`: nouns for states, verbs for buttons */


/** §3.4: ProviderErrorKind → a reader's sentence. `aborted` is the reader's own doing and shows nothing. */


export function reasonText(kind: ProviderErrorKind): string {
  return current.REASON[kind]
}

/** The kinds themselves are the same in every pack; the sentences are what differ */
const KINDS = new Set<string>(Object.keys(LOCALES[FALLBACK_LOCALE].REASON))

/** run.ts writes a fatal error as `${kind}: ${message}`; only a kind from the table counts, anything else is the whole message. */
export function parseFatal(fatal: string): { kind: ProviderErrorKind; message: string } {
  const at = fatal.indexOf(': ')
  if (at > 0) {
    const kind = fatal.slice(0, at)
    if (KINDS.has(kind)) return { kind: kind as ProviderErrorKind, message: fatal.slice(at + 2) }
  }
  return { kind: 'unknown', message: fatal }
}

/** service id → the name a reader sees (§2): built-ins by id, the reader's own by the name they gave */
export function serviceName(id: string, services: readonly { id: string; name: string }[] = []): string {
  switch (id) {
    case 'openai-compat':
      return S.service.llm
    case 'google-web':
      return S.service.google
    case 'chrome-builtin':
      return S.service.chrome
    case 'microsoft':
      return S.service.microsoft
    default:
      return services.find(s => s.id === id)?.name ?? id
  }
}

/**
 * The helper's one-line install for this extension (helper/install-remote.sh, documented in
 * helper/README.md). The ref names the branch the script and the sources are fetched from; it is
 * `main` once this work is there, and a branch name while a change to the helper is under review
 */
const HELPER_REF = 'main'
export const HELPER_GUIDE_URL = `https://github.com/SRjoeee/ArxivTranslate/blob/${HELPER_REF}/helper/README.md`
export function helperInstallCommand(extensionId: string): string {
  return `curl -fsSL https://raw.githubusercontent.com/SRjoeee/ArxivTranslate/${HELPER_REF}/helper/install-remote.sh | bash -s -- ${extensionId} ${HELPER_REF}`
}
