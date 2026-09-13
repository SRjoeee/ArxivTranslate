// The popup's state model: the inputs are what a few messages return plus the popup's own UI
// state (which menu is open), the output is "what every element shows right now" (the state table
// of docs/UI.md §4). A pure function with no side effects; the gallery and the tests feed it the
// inputs in fixtures.ts.
//
// Rules in one place: no state pill, the page being translated is said by the primary button; one
// note at a time (paused > replaced > images paused > the chosen service cannot run); the menus
// open at any time, a change while the page is on restarts it in place (data.ts), and only a
// choice that cannot run leaves the page behind the settings.
import { activeStyle } from '@/config/appearance'
import { LANG_CODES, LANG_CODE_TO_EN_NAME, LANG_CODE_TO_LOCALE_NAME, LANG_CODE_TO_ZH_NAME } from '@/config/languages'
import { type Config, DEFAULT_CONFIG } from '@/config/schema'
import { type Service, chosenService, isBuiltInService, isLlmChosen } from '@/config/services'
import type { Mode } from '@/core/renderer'
import { supportsTarget } from '@/providers/microsoft'
import { BUILT_IN_PROMPTS } from '@/providers/prompt-library'
import type { ProviderStatus } from '@/providers/transport'
import type { PageStatus } from '@/shared/messages'
import { pageDecision } from '@/shared/page-action'
import type { HelperStatus } from '@/shared/ocr'
import type { PackState } from '@/shared/pack'
import type { MenuItem } from '@/ui/Menu'
import { styleTile } from '@/ui/appearance/tiles'
import { PREVIEW_TARGET, S, languageLabel, languageName, parseFatal, profileName, reasonText, serviceName } from '@/ui/strings'

export type { PackState }
/** The last row of the service menu: not a service, it opens the settings page */
export const MANAGE_SERVICES = '__manage'
/** The same for the style menu: not a profile, it opens the settings page at the section that holds them */
export const MANAGE_STYLES = '__manage-styles'
export type MenuKind = 'service' | 'language' | 'prompt' | 'style'

/**
 * Whether the popup's 500 ms loop may ask the background for the provider line. Not while a grant is taking effect
 * (ADR-0002): the stale worker is replaced only once it has idled out, and every message to it resets the idle
 * timer — a popup left open on a translating page would keep it alive, and the grant pending, for as long as it
 * stayed open (Codex, local review of #179). The page-status half of the loop goes to the content script and is
 * unaffected
 */
export const pollsBackground = (helper: HelperStatus | null): boolean => helper?.state !== 'restarting'

export interface PopupInput {
  page: PageStatus | null
  /** The saved settings' chain: what a translation started now would run on; null until asked or when the ask failed */
  saved: ProviderStatus | null
  /**
   * The running session's own chain — its engine, its hand-overs — while the page is on; null when the page is off
   * or its status has not come back. Never stood in for by `saved`: the two can describe different chains after a
   * change saved elsewhere, and an unknown session shows as unknown (Codex on #185)
   */
  session: ProviderStatus | null
  config: Config | null
  /** The offline service's language pack; null until asked */
  pack: PackState | null
  /** The image-recognition helper; null until asked */
  helper: HelperStatus | null
  platform: 'mac' | 'other' | null
  /** `chainRevision` of the saved configuration; null until computed. A page whose `running.revision` differs is behind */
  savedRevision: string | null
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
  /** The chosen translation style (S-P-82); the menu lists what the settings page holds */
  style: Row
  highlight: boolean
  images: boolean
  menu: { kind: MenuKind; label: string; items: MenuItem[]; search: boolean } | null
  /**
   * Under the image row while the helper is not ready: the line, and the step the reader can take — `allow` asks
   * for the permission (S-P-86c), `install` opens the guided install, whose command needs `extensionId` (S-P-88);
   * null is a line with nothing to press (macOS only, or a grant still taking effect — S-P-87 / 86d)
   */
  helper: { text: string; step: 'allow' | 'install' | null; extensionId?: string } | null
  note: Note | null
  failed: string | null
  primary: { label: string; action: 'translate' | 'restore' | 'retranslate'; disabled: boolean; shortcut?: string }
  secondary: { label: string; action: 'restore' } | null
  mode: { value: Mode; note: string | null }
}

/**
 * The “not a paper page” screen. **Computed at call time, not at module load**: this module is imported before
 * `applyLocale`, a constant would freeze the fallback language into it, and a Chinese interface would show one English button (Codex on #161)
 */
const empty = (): PopupView => ({
  empty: true,
  service: { value: '' },
  language: { value: '' },
  prompt: null,
  style: { value: '' },
  highlight: true,
  images: true,
  menu: null,
  helper: null,
  note: null,
  failed: null,
  primary: { label: S.primary.translate, action: 'translate', disabled: true },
  secondary: null,
  mode: { value: DEFAULT_CONFIG.mode, note: null },
})

/** A local endpoint needs no key: Ollama and LM Studio answer without one */
const isLoopback = (baseURL: string): boolean => {
  try {
    const host = new URL(baseURL).hostname
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]'
  } catch {
    return false
  }
}
const serviceRuns = (service: Service): boolean => service.apiKey.trim() !== '' || isLoopback(service.baseURL)

/** Whether the chosen service can run on its own, decided from the settings (no round trip, no stale chain) */
export function runnable(config: Config, pack: PackState | null): boolean {
  const own = chosenService(config)
  if (own) return serviceRuns(own)
  // A service id naming nothing: a popup left open while another tab deleted it. `getProvider`
  // falls back to a built-in, so saying "usable" here would have the reader believe their LLM is
  // translating while something else is (Codex on #157)
  if (!isBuiltInService(config.provider)) return false
  switch (config.provider) {
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
  if (chosenService(config)) return S.note.llmNoKey
  if (!isBuiltInService(config.provider)) return S.note.serviceGone
  switch (config.provider) {
    case 'chrome-builtin':
      return pack === 'downloading' ? S.note.chromeDownloading : S.note.chromeNoPack
    case 'microsoft':
      return S.note.microsoftUnsupported
    default:
      return ''
  }
}

export function derivePopupView(input: PopupInput): PopupView {
  const { page, saved, session, config, pack, helper, platform, menu, shortcut, extensionId, savedRevision } = input
  if (page === null) return empty()
  if (config === null) return { ...empty(), empty: false, mode: { value: page.preference, note: null } }

  const progress = page.progress
  const on = progress.state === 'on'
  const paused = progress.state === 'stopped' && progress.fatal !== undefined
  const canRun = runnable(config, pack)
  const demoted = on ? session?.engine.demoted : undefined
  // The page runs on settings other than the saved ones. A change made here restarts the page at
  // once (data.ts), so this is what is left: a choice that cannot start, and a change made from
  // another tab, which leaves this page pinned to the session it began (Codex on #157). Either way
  // the reader is offered “Translate again” — enabled when the saved settings can actually run. The rule is
  // the toggle's too (shared/page-action.ts): the page's revision against the saved settings' digest
  const decision = pageDecision(page, { revision: savedRevision, canRun, fallback: !!saved?.fallback }) ?? { action: 'translate' as const, behind: false, enabled: canRun || !!saved?.fallback }
  const { action, behind } = decision
  const named = (id: string) => serviceName(id, config.services)

  const service: Row = demoted && session
    ? { value: named(session.engine.id), replaced: named(demoted.id) }
    : { value: named(config.provider) }
  const language: Row = { value: languageName(config.targetLanguage) }
  // The prompt decides how an LLM translates; the free services do not read it
  const prompt: Row | null = isLlmChosen(config) ? { value: promptName(config) } : null
  // How the translation looks. The page applies a change straight away, so this needs no restart
  const style: Row = { value: profileName(activeStyle(config.appearance)) }

  const note: Note | null = paused ? { text: S.note.paused(reasonText(parseFatal(progress.fatal ?? '').kind)), settings: true }
    : demoted && session ? { text: S.note.replaced(named(demoted.id), reasonText(demoted.kind), named(session.engine.id)), settings: true }
    : page.images?.fatal ? { text: S.note.imagesPaused(reasonText(parseFatal(page.images.fatal).kind)), settings: true }
    : !canRun && (!on || behind)
      ? { text: !on && saved?.fallback ? S.note.willFallback(cannotRunWhy(config, pack), named(saved.fallback.id)) : S.note.cannotRun(cannotRunWhy(config, pack)), settings: true }
      : null

  const failedCount = progress.failed + (page.images?.failed ?? 0)
  const failed = failedCount > 0 && progress.state !== 'idle' && !progress.fatal && !page.images?.fatal ? S.failed.text(failedCount) : null

  const primary: PopupView['primary'] = { label: action === 'restore' ? S.primary.restore : action === 'retranslate' ? S.primary.retranslate : S.primary.translate, action, disabled: !decision.enabled }
  // On every action the key actually performs, “Show original” included: ⌥T translates a page that is not
  // translated and restores one that is, so the badge belongs on both faces of the same button
  // (user 2026-09-11). A paused session retries rather than restores, which is what its label says
  if (!primary.disabled && shortcut) primary.shortcut = shortcut
  const secondary = behind || paused ? { label: S.primary.restore, action: 'restore' as const } : null

  const helperHint: PopupView['helper'] = !config.image.enabled || helper === null || helper.state === 'ready' || platform === null ? null
    : platform !== 'mac' ? { text: S.helper.macOnly, step: null }
    : helper.state === 'permission-missing' ? { text: S.helper.permission, step: 'allow' }
    : helper.state === 'restarting' ? { text: S.helper.enabling, step: null }
    : { text: S.helper.install, step: 'install', extensionId }

  return {
    empty: false,
    service,
    language,
    prompt,
    style,
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
          name: languageLabel(code),
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
    case 'style':
      // Whatever the settings page holds, in its order: the reader's own profiles sit among the
      // built-in ones there, and a second order here would make the same list read as two lists.
      // Each name carries the same sample sentence the settings tiles use, drawn in that style —
      // the names alone ("Muted", "Blurred") do not show what they do
      return {
        kind,
        label: S.rows.style,
        search: false,
        items: [
          ...config.appearance.styles.map(p => ({
            id: p.id,
            name: profileName(p),
            hint: PREVIEW_TARGET,
            preview: styleTile(p),
            selected: p.id === config.appearance.activeStyle,
          })),
          // The same position and role as in the service menu: the last row is not a style but the way in to managing them (S-P-83)
          { id: MANAGE_STYLES, name: S.rows.manageStyles, selected: false },
        ],
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
    // The reader's own sit where the contract puts the LLM: after the two free services and before
    // Chrome (UI.md S-P-46). Then the way to the page where they are managed
    ...config.services.map(s => ({ id: s.id, name: s.name, hint: serviceRuns(s) ? s.model : S.service.llm_noKey, selected: config.provider === s.id })),
    chrome(),
    { id: MANAGE_SERVICES, name: S.service.manage, selected: false },
  ]
}

