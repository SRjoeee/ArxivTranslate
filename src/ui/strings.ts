// Every reader-visible string of the extension's pages (docs/UI.md §3). Components hold no Chinese
// literals; a wording change is a change here. Numbers follow UI.md's S-P-xx; the tone rules are
// §1: buttons are verbs, states are nouns, an error says what happened, what it means, what to do.
import type { ProviderErrorKind } from '@/providers/types'

export const S = {
  brand: 'Readarxiv', // S-P-01
  settings: '设置', // S-P-02
  notArxiv: '打开一篇 arXiv 论文的 HTML 版本，就可以翻译', // S-P-03
  service: {
    label: '翻译服务', // S-P-10
    ai: 'AI 模型',
    google: 'Google 翻译',
    offline: 'Chrome 离线翻译',
    microsoft: 'Microsoft 翻译', // S-P-49
    hintAi: '译文最准确', // S-P-44
    hintGoogle: '免费，几秒翻完', // S-P-45
    hintOffline: '不联网，速度最快', // S-P-46
    hintMicrosoft: '免费，斜体等样式会丢', // S-P-49
    packDownload: '下载', // S-P-40
    packDownloading: '下载中，约需 1 分钟', // S-P-41
    packUnavailable: '这个语言暂不支持离线翻译', // S-P-42
    packUnsupported: '此版本 Chrome 没有离线翻译', // S-P-43
    prompt: '提示词', // S-P-47
  },
  pill: {
    ready: '就绪', // S-P-12
    busy: '翻译中', // S-P-13
    demoted: '已改用', // S-P-14
    willFallback: '将改用', // S-P-15
    needsSetup: '需要设置', // S-P-16
    paused: '已暂停', // S-P-17
    downloading: '下载中', // S-P-18
  },
  language: { label: '翻译为' }, // S-P-20
  note: {
    // S-P-30: {former service}: {reason}. Later paragraphs use {new service}; technical terms may suffer
    demoted: (from: string, reason: string, to: string) => `${from}：${reason}。后面的段落改用 ${to}，专业术语可能不准`,
    willFallback: (to: string) => `还没有填写 API Key，这次会用 ${to}`, // S-P-31
    needsKey: '还没有填写 API Key，填好就能翻译', // S-P-32
    needsPack: '先下载离线语言包，下好就能翻译', // S-P-32 (offline service)
    paused: (reason: string) => `${reason}。改好设置后点「重新翻译」`, // S-P-33
    configFallback: '设置没能读取，正在用默认设置', // S-P-34
    imagesPaused: (reason: string) => `图片翻译已暂停：${reason}。显示原文、改好设置后再翻译`, // S-P-35
    linkFix: '去修',
    linkFill: '去填',
    linkView: '去查看',
  },
  primary: {
    translate: '翻译本页', // S-P-50
    restore: '显示原文', // S-P-51 / S-P-53
    retranslate: '重新翻译', // S-P-52
    shortcut: '⌥ T',
  },
  failed: {
    // S-P-60: three phrasings, by what there is
    text: (blocks: number, images: number) =>
      blocks > 0 && images > 0 ? `${blocks} 段、${images} 张图没翻出来` : blocks > 0 ? `${blocks} 段没翻出来` : `${images} 张图没翻出来`,
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
  highlight: {
    label: '对照高亮', // S-P-80
    title: '指到哪句亮哪句；仅译文时停留一下会浮出原文', // S-P-81
  },
  actionFailed: (message: string) => message, // S-P-90: a failed action shows its message as one line
} as const

/** §3.4: ProviderErrorKind → a reader's sentence. `aborted` is the reader's own doing and shows nothing. */
const REASON: Record<ProviderErrorKind, string> = {
  'no-key': '还没有填写 API Key',
  auth: 'API Key 无效或已过期',
  'rate-limit': '请求太频繁，稍后自动重试',
  timeout: '翻译超时',
  network: '网络不通',
  'bad-request': '翻译服务拒绝了这个请求',
  'invalid-response': '返回的译文格式不对',
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

/** provider id → the name a reader sees (§2). The AI service shows the model's last segment (no `deepseek/` prefix). */
export function serviceName(id: string, model?: string): string {
  switch (id) {
    case 'openai-compat':
      return model ? (model.split('/').pop() ?? model) : S.service.ai
    case 'google-web':
      return S.service.google
    case 'chrome-builtin':
      return S.service.offline
    case 'microsoft':
      return S.service.microsoft
    default:
      return id
  }
}
