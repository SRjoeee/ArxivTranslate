// Every reader-visible string of the extension's pages (docs/UI.md §3). Components hold no Chinese
// literals; a wording change is a change here. The register is that of a product, not a chat:
// nouns for states, verbs for buttons, and an error says what happened and what to do.
import type { ProviderErrorKind } from '@/providers/types'

export const S = {
  brand: 'Read arXiv', // S-P-01
  settings: '设置', // S-P-02, and the button on every note
  notArxiv: '打开 arXiv 论文的 HTML 页面后即可翻译', // S-P-03
  rows: {
    service: '翻译服务', // S-P-10
    language: '目标语言', // S-P-20
    prompt: '提示词', // S-P-47
    highlight: '对照高亮', // S-P-80
    highlightTitle: '悬停时高亮对应句子；仅译文模式下停留可查看原文', // S-P-81
    images: '图片翻译', // S-P-85
    style: '译文样式', // S-P-86；与设置页「阅读 · 译文样式」同名，两处是同一件事
  },
  service: {
    microsoft: 'Microsoft 翻译',
    google: 'Google 翻译',
    llm: 'LLM',
    chrome: 'Chrome 翻译',
    free: '免费', // S-P-44
    chrome_ready: '浏览器内置，无需联网', // S-P-46
    llm_noKey: '尚未配置 API Key', // S-P-45: the LLM item's hint until a key is set
    microsoft_unsupported: '不支持当前目标语言',
    chrome_download: '下载', // S-P-40
    chrome_downloading: '语言包下载中', // S-P-41
    chrome_unavailable: '当前不可用', // S-P-42 / S-P-43
    manage: '管理翻译服务…', // S-P-48: the last row of the menu, opens the settings page
  },
  menu: {
    searchLanguages: '搜索语言', // S-P-22
    noMatch: '没有匹配的语言', // S-P-23
  },
  note: {
    // S-P-30: {service put aside}: {reason}. The page now runs on {service in use}
    replaced: (from: string, reason: string, to: string) => `${from}：${reason}。本页已改用 ${to}`,
    // S-P-31: {why the chosen service cannot run}, this time {service} will be used
    willFallback: (why: string, to: string) => `${why}，本次将使用 ${to}`,
    // S-P-32: the chosen service cannot run and nothing takes over; the reason alone
    cannotRun: (why: string) => why,
    llmNoKey: 'LLM 尚未配置 API Key',
    chromeNoPack: 'Chrome 翻译的语言包尚未下载',
    chromeDownloading: 'Chrome 翻译的语言包下载中，约需 1 分钟',
    microsoftUnsupported: 'Microsoft 翻译不支持当前目标语言',
    serviceGone: '选中的翻译服务已被删除，请重新选择', // S-P-32d
    paused: (reason: string) => `${reason}。请检查设置后重新翻译`, // S-P-33
    imagesPaused: (reason: string) => `图片翻译已暂停：${reason}`, // S-P-35
  },
  helper: {
    install: '图片翻译需要安装识别助手', // S-P-86, macOS
    macOnly: '图片翻译目前仅支持 macOS', // S-P-87
    copy: '复制安装命令', // S-P-88
    copied: '已复制',
    guide: '教程', // S-P-89
  },
  primary: {
    translate: '翻译本页', // S-P-50
    restore: '显示原文', // S-P-51 / S-P-53
    retranslate: '重新翻译', // S-P-52
  },
  failed: {
    text: (n: number) => `${n} 处翻译失败`, // S-P-60
    retry: '重试', // S-P-61
  },
  mode: {
    stack: '上下', // S-P-70；顺序见 MODE_ORDER
    side: '左右',
    only: '仅译文',
    stackTitle: '译文紧跟在原文下方', // S-P-71
    sideTitle: '原文与译文并排；窗口较窄时按上下显示', // S-P-72
    onlyTitle: '隐藏原文，参考文献仍保留双语', // S-P-73
    narrow: '窗口较窄，暂按上下显示', // S-P-74
  },
  actionFailed: (message: string) => message, // S-P-90
} as const

/**
 * The order the three modes are offered in (UI.md S-P-70). 左右 comes first: on a wide screen it is
 * the layout most readers stay in. Presentation only — `MODE_VALUES` (config/schema.ts) stays the
 * data order, and both the popup's mode bar and the settings page's image modes read this one
 */
export const MODE_ORDER = ['side', 'stack', 'only'] as const

/** The settings page (docs/UI.md §3.2). Same register as `S`: nouns for states, verbs for buttons */
export const O = {
  title: '设置',
  nav: { services: '翻译服务', reading: '阅读', prompts: '提示词与术语', data: '数据' },
  fallbackNotice: '设置读取失败，当前使用默认设置；已保存的 API Key 与服务选择均未生效。请重新填写。',
  services: {
    builtIn: '内置服务',
    mine: '我的服务',
    empty: '还没有添加服务。添加后即可使用 LLM 翻译。',
    add: '添加服务',
    edit: '编辑',
    autoFallback: '出问题时自动改用免费服务',
    autoFallbackHint: 'API Key 失效、额度用尽或断网时，翻译不会停下',
    name: '名称',
    namePlaceholder: '例如 DeepSeek V4 Flash',
    baseURL: '接口地址',
    baseURLHint: 'OpenRouter、DeepSeek、Ollama 等 OpenAI 兼容接口',
    apiKey: 'API Key',
    apiKeyStored: '已保存',
    apiKeyClear: '清除',
    apiKeyLocalHint: '本机地址可以不填',
    model: '模型',
    more: '更多选项',
    thinking: '深度思考',
    thinkingHint: '翻译不需要推理，开启会明显变慢',
    connect: '连接',
    connecting: '连接中…',
    connected: (ms: number) => `已连接 · ${ms} ms`,
    delete: '删除',
    deleteConfirm: '确认删除',
    cancel: '取消',
    newTitle: '添加服务',
    editTitle: '编辑服务',
  },
  reading: {
    styles: '译文样式',
    stylesHint: '选中的样式立即生效',
    highlights: '背景高亮',
    highlightsHint: '悬停时用来标出对应句子的底色',
    add: '添加配置',
    reset: '重置',
    resetHint: '把内置配置恢复原样，自己添加的保留',
    editTitle: '编辑配置',
    name: '名称',
    color: '文字颜色',
    bandColor: '底色',
    followText: '跟随原文',
    custom: '自定义',
    opacity: '透明度',
    underline: '下划线',
    thickness: '线宽',
    blur: '悬停前模糊',
    blurHint: '译文先糊着，鼠标停上去才清晰，适合自测',
    advanced: '高级',
    advancedHint: '只填声明，不写选择器和花括号；字体与字号仍随论文',
    duplicate: '复制一份',
    delete: '删除',
    done: '完成',
    preloadRange: '提前翻译的范围',
    preloadRangeHint: '屏幕下方多远的段落先翻；越近越省费用',
    preloadStops: ['半屏', '一屏', '两屏', '三屏'],
    threshold: '开始翻译的时机',
    thresholdHint: '段落露出多少才开始翻',
    thresholdStops: ['刚露出', '露出一半', '完全露出'],
    preview: '预览',
    previewSource: 'The Fourier transform is bounded.',
    previewTarget: '傅里叶变换是有界的。',
  },
  prompts: { title: '提示词', glossaryTooBig: '术语表太长，超出上限后没有保存；请减少条目或缩短内容', glossary: '术语表', glossaryHint: '每行「原文, 译文」，让同一篇里的译法一致', glossaryCount: (n: number) => `${n} 条`, onlyLlm: '只对 LLM 服务生效' },
  data: {
    cache: '已缓存的译文',
    cacheHint: '换了服务、模型或提示词会自动分开存，通常不用清',
    cacheLine: (entries: number, mb: string) => `${entries} 条 · ${mb} MB`,
    cacheError: '没能读取缓存',
    clear: '清空',
    clearConfirm: '确认清空',
    cleared: '已清空',
  },
} as const

/** §3.4: ProviderErrorKind → a reader's sentence. `aborted` is the reader's own doing and shows nothing. */
const REASON: Record<ProviderErrorKind, string> = {
  'no-key': '尚未配置 API Key',
  auth: 'API Key 无效或已过期',
  'rate-limit': '请求过于频繁，稍后自动重试',
  timeout: '翻译超时',
  network: '网络连接失败',
  'bad-request': '翻译服务拒绝了请求',
  'invalid-response': '译文格式无效',
  unknown: '翻译失败',
  aborted: '',
}

export function reasonText(kind: ProviderErrorKind): string {
  return REASON[kind]
}

const KINDS = new Set<string>(Object.keys(REASON))

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
