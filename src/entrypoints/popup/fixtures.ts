// One input per row of UI.md §4. Shared by the tests and the gallery; a change to the state table
// starts here.
import { DEFAULT_CONFIG, type Config } from '@/config/schema'
import type { ProviderStatus } from '@/providers/transport'
import type { PageStatus } from '@/shared/messages'
import type { PopupInput } from './view-model'

const config: Config = { ...DEFAULT_CONFIG, openaiCompat: { ...DEFAULT_CONFIG.openaiCompat, apiKey: 'set' } }

function page(over: Partial<PageStatus['progress']> = {}, extra: Partial<PageStatus> = {}): PageStatus {
  return {
    paper: '2409.01234',
    mode: 'stack',
    preference: 'stack',
    progress: { state: 'idle', total: 120, requested: 0, done: 0, failed: 0, cached: 0, inFlight: 0, ...over },
    ...extra,
  }
}

function provider(over: Partial<ProviderStatus> = {}): ProviderStatus {
  return {
    providerId: 'openai-compat',
    available: true,
    model: 'deepseek/deepseek-v4-flash',
    maxBatchChars: 4000,
    maxBatchItems: 20,
    renderPath: 'tags',
    engine: { id: 'openai-compat', displayName: 'LLM' },
    chain: ['openai-compat', 'google-web'],
    ...over,
  }
}

const base: PopupInput = { page: page(), provider: provider(), config, configFallback: null, pack: 'available', listOpen: false, shortcut: '⌥T' }

export const POPUP_FIXTURES: { id: string; name: string; when: string; input: PopupInput }[] = [
  { id: 'P0', name: '非 arXiv / 加载中', when: 'page === null', input: { ...base, page: null } },
  { id: 'P1', name: '就绪', when: 'idle ∧ available', input: base },
  { id: 'P2', name: '服务列表展开', when: 'P1 下点服务行', input: { ...base, listOpen: true, pack: 'downloadable' } },
  { id: 'P3', name: '翻译中', when: 'on ∧ failed = 0', input: { ...base, page: page({ state: 'on', requested: 31, done: 24, inFlight: 3 }, { preference: 'side', mode: 'side' }) } },
  { id: 'P4', name: '翻译中，有失败', when: 'on ∧ failed > 0 ∧ !fatal', input: { ...base, page: page({ state: 'on', requested: 31, done: 24, failed: 2 }, { images: { total: 6, requested: 3, done: 2, failed: 1 } }) } },
  { id: 'P5', name: '已改用其他服务', when: 'engine.demoted', input: { ...base, page: page({ state: 'on', requested: 20, done: 11 }), provider: provider({ engine: { id: 'google-web', displayName: 'Google', demoted: { id: 'openai-compat', displayName: 'OpenAI 兼容端点', kind: 'auth', message: 'User not found.' } } }) } },
  { id: 'P6', name: '将改用（首选不可用有兜底）', when: 'idle ∧ !available ∧ fallback', input: { ...base, provider: provider({ available: false, fallback: { id: 'google-web', displayName: 'Google' } }) } },
  { id: 'P7', name: '需要设置（不可用无兜底）', when: '!available ∧ !fallback', input: { ...base, provider: provider({ available: false }) } },
  { id: 'P8', name: '已暂停', when: 'stopped ∧ fatal', input: { ...base, page: page({ state: 'stopped', requested: 8, done: 0, fatal: 'auth: User not found.' }) } },
  { id: 'P9', name: '已停止（显示了原文）', when: 'stopped ∧ !fatal', input: { ...base, page: page({ state: 'stopped', requested: 8, done: 8 }) } },
  { id: 'P10', name: '设置读取失败', when: 'configFallbackReason()', input: { ...base, configFallback: 'Version downgrade detected' } },
  { id: 'P11', name: '离线语言包下载中', when: 'pack = downloading', input: { ...base, config: { ...config, provider: 'chrome-builtin' }, provider: provider({ providerId: 'chrome-builtin', available: false, engine: { id: 'chrome-builtin', displayName: 'Chrome' } }), pack: 'downloading' } },
  { id: 'P12', name: '图片翻译已暂停', when: 'images.fatal', input: { ...base, page: page({ state: 'on', requested: 20, done: 12 }, { images: { total: 6, requested: 2, done: 0, failed: 0, fatal: 'auth: User not found.' } }) } },
  { id: 'P13', name: '窄窗口按上下显示', when: 'mode !== preference', input: { ...base, page: page({ state: 'on', requested: 10, done: 10 }, { preference: 'side', mode: 'stack' }) } },
]
