// The offline service's language pack (DESIGN §8.4), shared by the popup and the options page.
// Both are extension pages, where the Translator API is available directly.
import { toBcp47 } from '@/config/languages'
import { BUILTIN_SOURCE_LANGUAGE } from '@/providers/chrome-builtin'

export type PackState = 'unsupported' | 'available' | 'downloadable' | 'downloading' | 'unavailable'

type TranslatorGlobal = {
  availability(o: { sourceLanguage: string; targetLanguage: string }): Promise<string>
  create(o: { sourceLanguage: string; targetLanguage: string }): Promise<unknown>
}
const translatorApi = () => (globalThis as { Translator?: TranslatorGlobal }).Translator

export async function packState(target: string): Promise<PackState> {
  const api = translatorApi()
  if (!api) return 'unsupported'
  try {
    return (await api.availability({ sourceLanguage: BUILTIN_SOURCE_LANGUAGE, targetLanguage: toBcp47(target) })) as PackState
  } catch {
    return 'unavailable'
  }
}

/**
 * Download the pack. **Must run from the click itself**: with availability at `downloadable`,
 * create() without a user gesture throws NotAllowedError (RESEARCH §6.1). During a first download
 * availability() keeps answering `downloadable` and the monitor emits no progress (measured: 67 s),
 * so callers show an indeterminate state until this resolves. Returns false when there is no API
 */
export async function downloadPack(target: string): Promise<boolean> {
  const api = translatorApi()
  if (!api) return false
  await api.create({ sourceLanguage: BUILTIN_SOURCE_LANGUAGE, targetLanguage: toBcp47(target) })
  return true
}
