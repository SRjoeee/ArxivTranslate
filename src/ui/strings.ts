// Every reader-visible string of the extension's pages (docs/UI.md §3). Components hold no Chinese
// literals; a wording change is a change here. The register is that of a product, not a chat:
// nouns for states, verbs for buttons, and an error says what happened and what to do.
import type { ProviderErrorKind } from '@/providers/types'

export const S = {
  brand: 'Readarxiv', // S-P-01
  settings: '设置', // S-P-02, and the button on every note
  notArxiv: '打开 arXiv 论文的 HTML 页面后即可翻译', // S-P-03
  rows: {
    service: '翻译服务', // S-P-10
    language: '目标语言', // S-P-20
    prompt: '提示词', // S-P-47
    highlight: '对照高亮', // S-P-80
    highlightTitle: '悬停时高亮对应句子；仅译文模式下停留可查看原文', // S-P-81
    images: '图片翻译', // S-P-85
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
    stack: '上下', // S-P-70
    side: '左右',
    only: '仅译文',
    stackTitle: '译文紧跟在原文下方', // S-P-71
    sideTitle: '原文与译文并排；窗口较窄时按上下显示', // S-P-72
    onlyTitle: '隐藏原文，参考文献仍保留双语', // S-P-73
    narrow: '窗口较窄，暂按上下显示', // S-P-74
  },
  actionFailed: (message: string) => message, // S-P-90
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

/** provider id → the name a reader sees (§2). The LLM shows the model's last segment (no `deepseek/` prefix). */
export function serviceName(id: string, model?: string): string {
  switch (id) {
    case 'openai-compat':
      return model ? (model.split('/').pop() ?? model) : S.service.llm
    case 'google-web':
      return S.service.google
    case 'chrome-builtin':
      return S.service.chrome
    case 'microsoft':
      return S.service.microsoft
    default:
      return id
  }
}

/** The helper's one-line install for this extension (helper/install-remote.sh, documented in helper/README.md) */
export const HELPER_GUIDE_URL = 'https://github.com/SRjoeee/ArxivTranslate/blob/main/helper/README.md'
export function helperInstallCommand(extensionId: string): string {
  return `curl -fsSL https://raw.githubusercontent.com/SRjoeee/ArxivTranslate/main/helper/install-remote.sh | bash -s -- ${extensionId}`
}
