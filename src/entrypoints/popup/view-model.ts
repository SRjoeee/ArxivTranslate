// The popup's state model: the inputs are what a few messages return plus the popup's own UI
// state (which menu is open), the output is "what every element shows right now" (the state table
// of docs/UI.md §4). A pure function with no side effects; the gallery and the tests feed it the
// inputs in fixtures.ts.
//
// Rules in one place: no state pill, the page being translated is said by the primary button; one
// note at a time (paused > replaced > images paused > the chosen service cannot run); the menus
// open at any time, a change while the page is on restarts it in place (data.ts), and only a
// choice that cannot run leaves the page behind the settings.
import { LANG_CODES, LANG_CODE_TO_EN_NAME, LANG_CODE_TO_LOCALE_NAME, LANG_CODE_TO_ZH_NAME, type LangCode, label } from '@/config/languages'
import { type Config, DEFAULT_CONFIG } from '@/config/schema'
import type { Mode } from '@/core/renderer'
import { supportsTarget } from '@/providers/microsoft'
import { BUILT_IN_PROMPTS } from '@/providers/prompt-library'
import type { ProviderStatus } from '@/providers/transport'
import type { PageStatus } from '@/shared/messages'
import type { HelperStatus } from '@/shared/ocr'
import type { PackState } from '@/shared/pack'
import type { MenuItem } from '@/ui/Menu'
import { HELPER_GUIDE_URL, S, helperInstallCommand, parseFatal, reasonText, serviceName } from '@/ui/strings'

export type { PackState }
export type MenuKind = 'service' | 'language' | 'prompt'

export interface PopupInput {
  page: PageStatus | null
  provider: ProviderStatus | null
  config: Config | null
  /** The offline service's language pack; null until asked */
  pack: PackState | null
  /** The image-recognition helper; null until asked */
  helper: HelperStatus | null
  platform: 'mac' | 'other' | null
  /** Which menu is open (the popup's own state) */
  menu: MenuKind | null
  /** The translate shortcut as Chrome reports it; null when unbound or unknown */
  shortcut: string | null
  extensionId: string
}

export interface Row { value: string; replaced?: string }
/** A note under the card; `settings` adds the button that opens the options page */
export interface Note { text: string; settings: boolean }

export interface PopupView {
  empty: boolean
  service: Row
  language: Row
  /** Only while the LLM is the chosen service */
  prompt: Row | null
  highlight: boolean
  images: boolean
  menu: { kind: MenuKind; label: string; items: MenuItem[]; search: boolean } | null
  /** Under the image row when the helper is missing: how to install it (macOS) or that it is macOS-only */
  helper: { text: string; command?: string; guide?: string } | null
  note: Note | null
  failed: string | null
  primary: { label: string; action: 'translate' | 'restore' | 'retranslate'; disabled: boolean; shortcut?: string }
  secondary: { label: string; action: 'restore' } | null
  mode: { value: Mode; note: string | null }
}

const EMPTY: PopupView = {
  empty: true,
  service: { value: '' },
  language: { value: '' },
  prompt: null,
  highlight: true,
  images: true,
  menu: null,
  helper: null,
  note: null,
  failed: null,
  primary: { label: S.primary.translate, action: 'translate', disabled: true },
  secondary: null,
  mode: { value: 'stack', note: null },
}

/** Whether the chosen service can run on its own, decided from the settings (no round trip, no stale chain) */
export function runnable(config: Config, pack: PackState | null): boolean {
  switch (config.provider) {
    case 'openai-compat':
      return config.openaiCompat.apiKey !== ''
    case 'chrome-builtin':
      return pack === 'available'
    case 'microsoft':
      return supportsTarget(config.targetLanguage)
    default:
      return true
  }
}

/** Why it cannot (S-P-31 / S-P-32) */
function cannotRunWhy(config: Config, pack: PackState | null): string {
  switch (config.provider) {
    case 'openai-compat':
      return S.note.llmNoKey
    case 'chrome-builtin':
      return pack === 'downloading' ? S.note.chromeDownloading : S.note.chromeNoPack
    case 'microsoft':
      return S.note.microsoftUnsupported
    default:
      return ''
  }
}

const modelName = (config: Config) => serviceName('openai-compat', config.openaiCompat.model)

export function derivePopupView(input: PopupInput): PopupView {
  const { page, provider, config, pack, helper, platform, menu, shortcut, extensionId } = input
  if (page === null) return EMPTY
  if (config === null) return { ...EMPTY, empty: false, mode: { value: page.preference, note: null } }

  const progress = page.progress
  const on = progress.state === 'on'
  const paused = progress.state === 'stopped' && progress.fatal !== undefined
  const canRun = runnable(config, pack)
  const demoted = on ? provider?.engine.demoted : undefined
  // The page runs on other settings than the saved ones, and the saved ones cannot start: the only
  // case a change does not restart the page at once (data.ts), so the only case the reader sees it
  const behind = on && page.running !== undefined && !canRun
    && (page.running.provider !== config.provider || page.running.target !== config.targetLanguage)
  const model = config.openaiCompat.model

  const service: Row = demoted && provider
    ? { value: serviceName(provider.engine.id, model), replaced: serviceName(demoted.id, model) }
    : { value: serviceName(config.provider, model) }
  const language: Row = { value: label(config.targetLanguage) }
  const prompt: Row | null = config.provider === 'openai-compat' ? { value: promptName(config) } : null

  const note: Note | null = paused ? { text: S.note.paused(reasonText(parseFatal(progress.fatal ?? '').kind)), settings: true }
    : demoted && provider ? { text: S.note.replaced(serviceName(demoted.id, model), reasonText(demoted.kind), serviceName(provider.engine.id, model)), settings: true }
    : page.images?.fatal ? { text: S.note.imagesPaused(reasonText(parseFatal(page.images.fatal).kind)), settings: true }
    : !canRun && (!on || behind)
      ? { text: !on && provider?.fallback ? S.note.willFallback(cannotRunWhy(config, pack), serviceName(provider.fallback.id)) : S.note.cannotRun(cannotRunWhy(config, pack)), settings: true }
      : null

  const failedCount = progress.failed + (page.images?.failed ?? 0)
  const failed = failedCount > 0 && progress.state !== 'idle' && !progress.fatal && !page.images?.fatal ? S.failed.text(failedCount) : null

  const primary: PopupView['primary'] = on && !behind ? { label: S.primary.restore, action: 'restore', disabled: false }
    : behind ? { label: S.primary.retranslate, action: 'retranslate', disabled: true }
    : paused ? { label: S.primary.retranslate, action: 'retranslate', disabled: !canRun && !provider?.fallback }
    : { label: S.primary.translate, action: 'translate', disabled: !canRun && !provider?.fallback }
  if (primary.action !== 'restore' && !primary.disabled && shortcut) primary.shortcut = shortcut
  const secondary = behind || paused ? { label: S.primary.restore, action: 'restore' as const } : null

  const helperHint: PopupView['helper'] = config.image.enabled && helper !== null && !helper.available && platform !== null
    ? platform === 'mac'
      ? { text: S.helper.install, command: helperInstallCommand(extensionId), guide: HELPER_GUIDE_URL }
      : { text: S.helper.macOnly }
    : null

  return {
    empty: false,
    service,
    language,
    prompt,
    highlight: config.reading.sentenceHighlight,
    images: config.image.enabled,
    menu: menu === null ? null : menuOf(menu, config, pack),
    helper: helperHint,
    note,
    failed,
    primary,
    secondary,
    mode: { value: page.preference, note: page.mode !== page.preference ? S.mode.narrow : null },
  }
}

function promptName(config: Config): string {
  const id = config.prompts.promptId
  return BUILT_IN_PROMPTS[id]?.name ?? config.prompts.patterns.find(p => p.id === id)?.name ?? id
}

function menuOf(kind: MenuKind, config: Config, pack: PackState | null): NonNullable<PopupView['menu']> {
  switch (kind) {
    case 'service':
      return { kind, label: S.rows.service, search: false, items: serviceItems(config, pack) }
    case 'language':
      return {
        kind,
        label: S.rows.language,
        search: true,
        items: LANG_CODES.map(code => ({
          id: code,
          name: label(code),
          keywords: `${LANG_CODE_TO_EN_NAME[code]} ${LANG_CODE_TO_LOCALE_NAME[code]} ${LANG_CODE_TO_ZH_NAME[code]} ${code}`,
          selected: code === config.targetLanguage,
        })),
      }
    case 'prompt':
      return {
        kind,
        label: S.rows.prompt,
        search: false,
        items: [...Object.values(BUILT_IN_PROMPTS), ...config.prompts.patterns].map(p => ({ id: p.id, name: p.name, selected: p.id === config.prompts.promptId })),
      }
  }
}

/** UI.md §2: Microsoft, Google, LLM, Chrome. Only Chrome and an unsupported language disable an item; the LLM without a key stays selectable and gets the settings note */
function serviceItems(config: Config, pack: PackState | null): MenuItem[] {
  const microsoftOk = supportsTarget(config.targetLanguage)
  const chrome = (): MenuItem => {
    const base = { id: 'chrome-builtin', name: S.service.chrome, selected: config.provider === 'chrome-builtin' }
    switch (pack) {
      case 'available':
        return { ...base, hint: S.service.chrome_ready }
      case 'downloadable':
        return { ...base, hint: S.service.chrome_ready, disabled: true, action: { label: S.service.chrome_download } }
      case 'downloading':
        return { ...base, hint: S.service.chrome_downloading, disabled: true, action: { label: S.service.chrome_download, busy: true } }
      case 'unsupported':
      case 'unavailable':
        return { ...base, hint: S.service.chrome_unavailable, disabled: true }
      default:
        return { ...base, hint: S.service.chrome_ready, disabled: true }
    }
  }
  return [
    { id: 'microsoft', name: S.service.microsoft, hint: microsoftOk ? S.service.free : S.service.microsoft_unsupported, selected: config.provider === 'microsoft', disabled: !microsoftOk },
    { id: 'google-web', name: S.service.google, hint: S.service.free, selected: config.provider === 'google-web' },
    { id: 'openai-compat', name: S.service.llm, hint: config.openaiCompat.apiKey ? modelName(config) : S.service.llm_noKey, selected: config.provider === 'openai-compat' },
    chrome(),
  ]
}

export const LANGUAGE_CODES: readonly LangCode[] = LANG_CODES
export const DEFAULT_LANGUAGE = DEFAULT_CONFIG.targetLanguage
