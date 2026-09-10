// The popup's state model: the inputs are what a few messages return, the output is "what every
// element looks like right now" (the state table of docs/UI.md §4). A pure function with no side
// effects; the gallery and the tests feed it the inputs in fixtures.ts. Stacking rules: one note at
// a time, by priority S-P-34 > S-P-33 > S-P-30 > S-P-35 > S-P-31 / S-P-32; while translation is
// running, the service row and the language row cannot be opened.
import { type Config, DEFAULT_CONFIG } from '@/config/schema'
import { label } from '@/config/languages'
import type { Mode } from '@/core/renderer'
import { BUILT_IN_PROMPTS } from '@/providers/prompt-library'
import type { ProviderStatus } from '@/providers/transport'
import type { PageStatus } from '@/shared/messages'
import { S, parseFatal, reasonText, serviceName } from '@/ui/strings'

export type PackState = 'unsupported' | 'available' | 'downloadable' | 'downloading' | 'unavailable'

export interface PopupInput {
  page: PageStatus | null
  provider: ProviderStatus | null
  config: Config | null
  /** What `configFallbackReason()` returned; non-null means neither the key nor the service choice took effect */
  configFallback: string | null
  pack: PackState | null
  /** Whether the service list is open (the UI's own state) */
  listOpen: boolean
  /** The translate shortcut as Chrome reports it (platform-formatted); null when unbound or unknown */
  shortcut: string | null
}

export type Tone = 'ok' | 'busy' | 'warn' | 'alert' | 'muted'
export interface Pill { text: string; tone: Tone; spinning?: boolean }
export interface Note { text: string; tone: 'alert' | 'warn'; link?: string }
export interface ServiceOption {
  id: Config['provider']
  name: string
  hint: string
  selected: boolean
  disabled: boolean
  /** The offline service's language pack: ready = show "download", busy = spinner */
  download?: 'ready' | 'busy'
}

export interface PopupView {
  empty: boolean
  service: { name: string; replaced?: string; pill: Pill; canOpen: boolean }
  note: Note | null
  language: { label: string; code: Config['targetLanguage']; canOpen: boolean }
  list: { options: ServiceOption[]; prompts: { id: string; name: string }[] | null; promptId: string } | null
  failed: string | null
  /** S-P-50: the shortcut badge rides only on an enabled translate button, and only when bound */
  primary: { label: string; action: 'translate' | 'restore'; disabled: boolean; shortcut?: string }
  secondary: { label: string; action: 'restore' } | null
  mode: { value: Mode; note: string | null }
  /** S-P-80: the hover highlight, a front-page toggle that takes effect on the page at once */
  highlight: { on: boolean; label: string; title: string }
}

const HIGHLIGHT = { label: S.highlight.label, title: S.highlight.title }

const EMPTY: PopupView = {
  empty: true,
  service: { name: '', pill: { text: '', tone: 'muted' }, canOpen: false },
  note: null,
  language: { label: '', code: DEFAULT_CONFIG.targetLanguage, canOpen: false },
  list: null,
  failed: null,
  primary: { label: S.primary.translate, action: 'translate', disabled: true },
  secondary: null,
  mode: { value: 'stack', note: null },
  highlight: { on: true, ...HIGHLIGHT },
}

export function derivePopupView(input: PopupInput): PopupView {
  const { page, provider, config, configFallback, pack, listOpen, shortcut } = input
  if (page === null) return EMPTY

  const progress = page.progress
  const on = progress.state === 'on'
  const paused = progress.state === 'stopped' && progress.fatal !== undefined
  const demoted = provider?.engine.demoted
  const providerId = config?.provider ?? provider?.providerId ?? 'openai-compat'
  const model = provider?.model ?? config?.openaiCompat.model
  const available = provider?.available ?? false
  const fallback = provider?.fallback
  const downloading = providerId === 'chrome-builtin' && pack === 'downloading'
  const loading = provider === null || config === null

  // The service row: while replaced, the service actually in use, with the preferred one struck
  const service = demoted && provider
    ? { name: serviceName(provider.engine.id, model), replaced: demoted.displayName }
    : { name: serviceName(providerId, model) }

  // The pill carries every state in one place, and never a count
  const pill: Pill = configFallback !== null ? { text: S.pill.needsSetup, tone: 'muted' }
    : paused ? { text: S.pill.paused, tone: 'muted' }
    : demoted ? { text: S.pill.demoted, tone: 'alert' }
    : on ? { text: S.pill.busy, tone: 'busy', spinning: true }
    : downloading ? { text: S.pill.downloading, tone: 'muted', spinning: true }
    : loading ? { text: '', tone: 'muted' }
    : available ? { text: S.pill.ready, tone: 'ok' }
    : fallback ? { text: S.pill.willFallback, tone: 'warn' }
    : { text: S.pill.needsSetup, tone: 'muted' }

  // The note inside the card: one at a time, by priority
  const note: Note | null = configFallback !== null ? { text: S.note.configFallback, tone: 'alert', link: S.note.linkView }
    : paused ? { text: S.note.paused(reasonText(parseFatal(progress.fatal ?? '').kind)), tone: 'alert' }
    : demoted && provider ? { text: S.note.demoted(demoted.displayName, reasonText(demoted.kind), serviceName(provider.engine.id, model)), tone: 'alert', link: S.note.linkFix }
    : page.images?.fatal ? { text: S.note.imagesPaused(reasonText(parseFatal(page.images.fatal).kind)), tone: 'alert' }
    : !on && !loading && !available && fallback ? { text: S.note.willFallback(serviceName(fallback.id)), tone: 'warn', link: S.note.linkFill }
    : !on && !loading && !available && !downloading ? { text: providerId === 'chrome-builtin' ? S.note.needsPack : S.note.needsKey, tone: 'warn', link: S.note.linkFill }
    : null

  const canOpen = !on && !loading
  const language = { label: config ? label(config.targetLanguage) : '', code: config?.targetLanguage ?? DEFAULT_CONFIG.targetLanguage, canOpen }

  const list = listOpen && canOpen && config ? {
    options: [
      { id: 'openai-compat' as const, name: S.service.ai, hint: S.service.hintAi, selected: providerId === 'openai-compat', disabled: false },
      { id: 'google-web' as const, name: S.service.google, hint: S.service.hintGoogle, selected: providerId === 'google-web', disabled: false },
      offlineOption(providerId, pack),
      { id: 'microsoft' as const, name: S.service.microsoft, hint: S.service.hintMicrosoft, selected: providerId === 'microsoft', disabled: false },
    ],
    prompts: providerId === 'openai-compat'
      ? [...Object.values(BUILT_IN_PROMPTS), ...config.prompts.patterns].map(p => ({ id: p.id, name: p.name }))
      : null,
    promptId: config.prompts.promptId,
  } : null

  const failedBlocks = progress.failed
  const failedImages = page.images?.failed ?? 0
  const failed = failedBlocks + failedImages > 0 && progress.state !== 'idle' && !progress.fatal && !page.images?.fatal
    ? S.failed.text(failedBlocks, failedImages)
    : null

  const primary: PopupView['primary'] = on ? { label: S.primary.restore, action: 'restore', disabled: false }
    : paused ? { label: S.primary.retranslate, action: 'translate', disabled: false }
    : { label: S.primary.translate, action: 'translate', disabled: loading || downloading || !(available || fallback) }
  if (primary.action === 'translate' && !primary.disabled && shortcut) primary.shortcut = shortcut
  const secondary = paused ? { label: S.primary.restore, action: 'restore' as const } : null

  return {
    empty: false,
    service: { ...service, pill, canOpen },
    note,
    language,
    list,
    failed,
    primary,
    secondary,
    mode: { value: page.preference, note: page.mode !== page.preference ? S.mode.narrow : null },
    highlight: { on: config?.reading.sentenceHighlight ?? true, ...HIGHLIGHT },
  }
}

function offlineOption(providerId: string, pack: PackState | null): ServiceOption {
  const selected = providerId === 'chrome-builtin'
  switch (pack) {
    case 'unsupported':
      return { id: 'chrome-builtin', name: S.service.offline, hint: S.service.packUnsupported, selected, disabled: true }
    case 'unavailable':
      return { id: 'chrome-builtin', name: S.service.offline, hint: S.service.packUnavailable, selected, disabled: true }
    case 'downloadable':
      return { id: 'chrome-builtin', name: S.service.offline, hint: S.service.hintOffline, selected, disabled: false, download: 'ready' }
    case 'downloading':
      return { id: 'chrome-builtin', name: S.service.offline, hint: S.service.packDownloading, selected, disabled: false, download: 'busy' }
    default:
      return { id: 'chrome-builtin', name: S.service.offline, hint: S.service.hintOffline, selected, disabled: false }
  }
}
