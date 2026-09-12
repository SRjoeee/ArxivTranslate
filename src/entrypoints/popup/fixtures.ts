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
    ...(state === 'on' ? { running: { provider: 'microsoft', target: 'cmn', engine: 'microsoft', revision: 1 } } : {}),
    ...extra,
  }
}

function provider(over: Partial<ProviderStatus> = {}): ProviderStatus {
  return {
    providerId: 'microsoft',
    available: true,
    maxBatchChars: 4000,
    maxBatchItems: 20,
    renderPath: 'markers',
    targetLanguage: 'cmn',
    promptId: 'default',
    engine: { id: 'microsoft', displayName: 'Microsoft' },
    chain: ['microsoft', 'google-web'],
    demotions: [],
    revision: 1,
    ...over,
  }
}
const llmProvider = (over: Partial<ProviderStatus> = {}) => provider({ providerId: SVC.id, model: SVC.model, renderPath: 'tags', engine: { id: SVC.id, displayName: SVC.name }, chain: [SVC.id, 'microsoft', 'google-web'], ...over })

const base: PopupInput = {
  page: page(), provider: provider(), config, pack: 'available', helper: { state: 'ready', version: '1.0' }, platform: 'mac', menu: null, shortcut: '⌥T', extensionId: 'abcdefghijklmnopabcdefghijklmnop',
}

export const POPUP_FIXTURES: { id: string; name: string; when: string; input: PopupInput }[] = [
  { id: 'P0', name: '非 arXiv / 加载中', when: 'page === null', input: { ...base, page: null } },
  { id: 'P1', name: '就绪', when: 'idle ∧ runnable', input: base },
  { id: 'P2', name: '翻译服务菜单', when: 'menu = service', input: { ...base, menu: 'service', pack: 'downloadable' } },
  { id: 'P3', name: '目标语言菜单', when: 'menu = language', input: { ...base, menu: 'language' } },
  { id: 'P4', name: '翻译中', when: 'on', input: { ...base, page: page({ state: 'on', requested: 31, done: 24, inFlight: 3 }, { preference: 'side', mode: 'side' }) } },
  { id: 'P5', name: '翻译中，有失败', when: 'on ∧ failed > 0 ∧ !fatal', input: { ...base, page: page({ state: 'on', requested: 31, done: 24, failed: 2 }, { images: { total: 6, requested: 3, done: 2, failed: 1 } }) } },
  { id: 'P6', name: '已改用其他服务', when: 'on ∧ engine.demoted', input: { ...base, config: llm, page: page({ state: 'on', requested: 20, done: 11 }, { running: { provider: SVC.id, target: 'cmn', engine: 'google-web', revision: 1 } }), provider: llmProvider({ engine: { id: 'google-web', displayName: 'Google', demoted: { id: SVC.id, displayName: SVC.name, kind: 'auth', message: 'User not found.' } } }) } },
  { id: 'P7', name: 'LLM 未配置，有服务可替代', when: 'idle ∧ !runnable ∧ fallback', input: { ...base, config: llmNoKey, provider: llmProvider({ available: false, fallback: { id: 'microsoft', displayName: 'Microsoft' } }) } },
  { id: 'P8', name: 'LLM 未配置，无服务可替代', when: 'idle ∧ !runnable ∧ !fallback', input: { ...base, config: { ...llmNoKey, fallback: { enabled: false } }, provider: llmProvider({ available: false, chain: ['openai-compat'] }) } },
  { id: 'P9', name: '已暂停', when: 'stopped ∧ fatal', input: { ...base, config: llm, provider: llmProvider(), page: page({ state: 'stopped', requested: 8, done: 0, fatal: 'auth: User not found.' }) } },
  { id: 'P10', name: 'Chrome 翻译语言包下载中', when: 'chrome ∧ pack = downloading', input: { ...base, config: { ...config, provider: 'chrome-builtin' }, provider: provider({ providerId: 'chrome-builtin', available: false, fallback: { id: 'google-web', displayName: 'Google' }, engine: { id: 'chrome-builtin', displayName: 'Chrome' } }), pack: 'downloading' } },
  { id: 'P11', name: '图片翻译已暂停', when: 'images.fatal', input: { ...base, config: llm, provider: llmProvider(), page: page({ state: 'on', requested: 20, done: 12 }, { running: { provider: SVC.id, target: 'cmn', engine: SVC.id, revision: 1 }, images: { total: 6, requested: 2, done: 0, failed: 0, fatal: 'auth: User not found.' } }) } },
  { id: 'P12', name: '窄窗口按上下显示', when: 'mode !== preference', input: { ...base, page: page({ state: 'on', requested: 10, done: 10 }, { preference: 'side', mode: 'stack' }) } },
  { id: 'P13', name: '改选了跑不起来的服务', when: 'on ∧ running ≠ settings ∧ !runnable', input: { ...base, config: llmNoKey, provider: llmProvider({ available: false, fallback: { id: 'microsoft', displayName: 'Microsoft' } }), page: page({ state: 'on', requested: 31, done: 24 }) } },
  { id: 'P14', name: '识别助手未安装', when: 'images.enabled ∧ helper = not-installed', input: { ...base, helper: { state: 'not-installed', reason: 'host not registered' } } },
  { id: 'P14a', name: '识别助手待授权', when: 'images.enabled ∧ helper = permission-missing', input: { ...base, helper: { state: 'permission-missing' } } },
  { id: 'P14b', name: '识别助手授权生效中', when: 'images.enabled ∧ helper = restarting', input: { ...base, helper: { state: 'restarting' } } },
  { id: 'P15', name: '提示词菜单', when: 'llm ∧ menu = prompt', input: { ...base, config: llm, provider: llmProvider(), menu: 'prompt' } },
  { id: 'P16', name: '译文样式菜单', when: 'menu = style', input: { ...base, menu: 'style' } },
]
