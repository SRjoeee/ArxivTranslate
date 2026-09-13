// One input per row of UI.md §4. Shared by the tests and the gallery; a change to the state table
// starts here.
import { DEFAULT_CONFIG, type Config } from '@/config/schema'
import type { ProviderStatus } from '@/providers/transport'
import type { PageStatus } from '@/shared/messages'
import type { PopupInput } from './view-model'

const SVC = { id: 'svc-abcd1234', kind: 'openai-compat' as const, name: 'deepseek-v4-flash', baseURL: 'https://openrouter.ai/api/v1', apiKey: 'set', model: 'deepseek/deepseek-v4-flash', thinking: 'disabled' as const }
const config: Config = DEFAULT_CONFIG
const llm: Config = { ...DEFAULT_CONFIG, provider: SVC.id, services: [SVC] }
const llmNoKey: Config = { ...DEFAULT_CONFIG, provider: SVC.id, services: [{ ...SVC, apiKey: '' }] }

function page(over: Partial<PageStatus['progress']> = {}, extra: Partial<PageStatus> = {}): PageStatus {
  const state = over.state ?? 'idle'
  return {
    paper: '2409.01234',
    mode: 'stack',
    preference: 'stack',
    progress: { state, total: 120, requested: 0, done: 0, failed: 0, cached: 0, inFlight: 0, ...over },
    epoch: 'doc#1',
    ...(state === 'on' ? { running: { provider: 'microsoft', target: 'cmn', engine: 'microsoft', revision: 'r1' } } : {}),
    ...extra,
  }
}

function provider(over: Partial<ProviderStatus> = {}): ProviderStatus {
  return {
    providerId: 'microsoft',
    chosen: 'microsoft',
    revision: 'r1',
    available: true,
    maxBatchChars: 4000,
    maxBatchItems: 20,
    renderPath: 'markers',
    targetLanguage: 'cmn',
    promptId: 'default',
    engine: { id: 'microsoft' },
    chain: ['microsoft', 'google-web'],
    demotions: [],
    ...over,
  }
}
const llmProvider = (over: Partial<ProviderStatus> = {}) => provider({ providerId: SVC.id, chosen: SVC.id, model: SVC.model, renderPath: 'tags', engine: { id: SVC.id }, chain: [SVC.id, 'microsoft', 'google-web'], ...over })

const base: PopupInput = {
  page: page(), saved: provider(), session: null, config, pack: 'available', helper: { state: 'ready', version: '1.0' }, platform: 'mac', menu: null, shortcut: '⌥T', extensionId: 'abcdefghijklmnopabcdefghijklmnop',
  // The saved settings' digest equals the running page's revision: nothing is behind unless a fixture says so
  savedRevision: 'r1',
}

export const POPUP_FIXTURES: { id: string; name: string; when: string; input: PopupInput }[] = [
  { id: 'P0', name: 'Not arXiv / loading', when: 'page === null', input: { ...base, page: null } },
  { id: 'P1', name: 'Ready', when: 'idle ∧ runnable', input: base },
  { id: 'P2', name: 'Service menu', when: 'menu = service', input: { ...base, menu: 'service', pack: 'downloadable' } },
  { id: 'P3', name: 'Language menu', when: 'menu = language', input: { ...base, menu: 'language' } },
  { id: 'P4', name: 'Translating', when: 'on', input: { ...base, session: provider(), page: page({ state: 'on', requested: 31, done: 24, inFlight: 3 }, { preference: 'side', mode: 'side' }) } },
  { id: 'P5', name: 'Translating, with failures', when: 'on ∧ failed > 0 ∧ !fatal', input: { ...base, session: provider(), page: page({ state: 'on', requested: 31, done: 24, failed: 2 }, { images: { total: 6, requested: 3, done: 2, failed: 1 } }) } },
  { id: 'P6', name: 'Switched to another service', when: 'on ∧ engine.demoted', input: { ...base, config: llm, page: page({ state: 'on', requested: 20, done: 11 }, { running: { provider: SVC.id, target: 'cmn', engine: 'google-web', revision: 'r1' } }), saved: llmProvider(), session: llmProvider({ engine: { id: 'google-web', demoted: { id: SVC.id, kind: 'auth', message: 'User not found.' } } }) } },
  { id: 'P7', name: 'LLM not configured, a fallback available', when: 'idle ∧ !runnable ∧ fallback', input: { ...base, config: llmNoKey, saved: llmProvider({ available: false, fallback: { id: 'microsoft' } }) } },
  { id: 'P8', name: 'LLM not configured, no fallback', when: 'idle ∧ !runnable ∧ !fallback', input: { ...base, config: { ...llmNoKey, fallback: { enabled: false } }, saved: llmProvider({ available: false, chain: ['openai-compat'] }) } },
  { id: 'P9', name: 'Paused', when: 'stopped ∧ fatal', input: { ...base, config: llm, saved: llmProvider(), page: page({ state: 'stopped', requested: 8, done: 0, fatal: 'auth: User not found.' }) } },
  { id: 'P10', name: 'Chrome language pack downloading', when: 'chrome ∧ pack = downloading', input: { ...base, config: { ...config, provider: 'chrome-builtin' }, saved: provider({ providerId: 'chrome-builtin', available: false, fallback: { id: 'google-web' }, engine: { id: 'chrome-builtin' } }), pack: 'downloading' } },
  { id: 'P11', name: 'Image translation paused', when: 'images.fatal', input: { ...base, config: llm, saved: llmProvider(), session: llmProvider(), page: page({ state: 'on', requested: 20, done: 12 }, { running: { provider: SVC.id, target: 'cmn', engine: SVC.id, revision: 'r1' }, images: { total: 6, requested: 2, done: 0, failed: 0, fatal: 'auth: User not found.' } }) } },
  { id: 'P12', name: 'Narrow window shown stacked', when: 'mode !== preference', input: { ...base, session: provider(), page: page({ state: 'on', requested: 10, done: 10 }, { preference: 'side', mode: 'stack' }) } },
  { id: 'P13', name: 'Switched to a service that cannot run', when: 'on ∧ running.revision ≠ savedRevision ∧ !runnable', input: { ...base, savedRevision: 'r2', config: llmNoKey, saved: llmProvider({ available: false, fallback: { id: 'microsoft' } }), session: provider(), page: page({ state: 'on', requested: 31, done: 24 }) } },
  { id: 'P14', name: 'Helper not installed', when: 'images.enabled ∧ helper = not-installed', input: { ...base, helper: { state: 'not-installed', reason: 'host not registered' } } },
  { id: 'P14a', name: 'Helper awaiting permission', when: 'images.enabled ∧ helper = permission-missing', input: { ...base, helper: { state: 'permission-missing' } } },
  { id: 'P14b', name: 'Helper permission taking effect', when: 'images.enabled ∧ helper = restarting', input: { ...base, helper: { state: 'restarting' } } },
  { id: 'P15', name: 'Prompt menu', when: 'llm ∧ menu = prompt', input: { ...base, config: llm, saved: llmProvider(), menu: 'prompt' } },
  { id: 'P16', name: 'Style menu', when: 'menu = style', input: { ...base, menu: 'style' } },
]
