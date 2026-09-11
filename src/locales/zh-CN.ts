// 简体中文：本项目的第一套界面文案，也是所有语言包的类型来源（其余语言包必须与它同形，缺一个键就编译不过）。
// 语气是产品的语气，不是聊天的语气：状态用名词，按钮用动词，出错要说清发生了什么、该怎么办。
// 文案编号见 docs/UI.md §3。
import type { ProviderErrorKind } from '@/providers/types'
import { PREVIEW_SOURCE, PREVIEW_TARGET } from './preview'

const S = {
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
    style: '译文样式', // S-P-82；与设置页「阅读 · 译文样式」同名，两处是同一件事
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
  /** The guided install on the settings page (S-O-30…36). The popup keeps the one-line version above */
  setup: {
    title: '安装识别助手',
    intro: '图片翻译要在本机识别图里的文字。装一次，之后都不用管。',
    step1: '打开「终端」',
    step1Hint: '按 ⌘ 空格，输入 Terminal，回车',
    step2: '粘贴这行命令，按回车',
    step2Hint: '点命令即可复制',
    step3: '装完回到这里',
    step3Hint: '命令跑完会打印一行「已安装」',
    copyFailed: '没能复制。请手动选中这行命令再复制',
    check: '我已经装好了',
    checking: '检测中…',
    notYet: '还没检测到。确认命令跑完没有报错，然后再试一次',
    done: '识别助手已就绪',
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
  /** 论文页里的文字（S-I）与右键菜单，与 popup 用同一套语言包 */
  page: {
    retry: '重试', // S-I-02
    menuToggle: '翻译本页 / 显示原文', // 右键菜单（issue #146）
    alreadyOn: '翻译已开启，滚动会继续翻',
    sessionOver: '这次翻译已经停止',
    notPaper: '不是 arXiv HTML 页面',
    nothingToTranslate: '这一页没有可翻译的内容',
    abstractLink: (brand: string) => `双语版本（${brand}）`, // 摘要页的入口（issue #146）
    backendSilent: '扩展后台没有响应',
    noService: '未配置 API key，请先到设置页填写',
  },
} as const

const O = {
  title: '设置',
  nav: { services: '翻译服务', reading: '阅读', prompts: '提示词与术语', data: '数据' },
  /** S-O-05：界面语言。与「目标语言」是两件事，所以放在导航下面，离得远一点 */
  uiLanguage: '界面语言',
  uiLanguageAuto: '跟随浏览器',
  /** 配置读不出来时那条说明的下半句（config/storage.ts 只报成因，不写句子） */
  fallbackWhy: {
    tooNew: (stored: number, supported: number) => `存储里的配置是 v${stored}，这个版本只认到 v${supported}（可能装过更新的版本）`,
    invalid: (where: string, message: string) => (where ? `${where}：${message}` : message),
    unknown: '未知原因',
  },
  fallbackNotice: '设置读取失败，当前使用默认设置；已保存的 API Key 与服务选择均未生效。请重新填写。',
  services: {
    builtIn: '内置服务',
    mine: '我的服务',
    empty: '还没有添加服务。添加后即可使用 LLM 翻译。',
    add: '添加服务',
    edit: '编辑',
    imagesHint: '译文叠在图上，鼠标悬停查看原文',
    imageModes: '在这些模式下显示图片译文',
    imageModesHint: '只影响显示：切到没勾的模式时叠加层隐藏，切回来再显示，不重新识别',
    detecting: '正在检测识别助手…',
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
    newProfile: '新配置',
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
    underlines: { none: '无', solid: '实线', dotted: '点线', dashed: '虚线', wavy: '波浪' },
    thickness: '线宽',
    blur: '悬停前模糊',
    blurHint: '译文先糊着，鼠标停上去才清晰，适合自测',
    advanced: '高级',
    advancedHint: '只填声明，不写选择器和花括号；字体与字号仍随论文',
    duplicate: '复制一份',
    /** 复制出来的那份叫什么：显示名 + 这个后缀（config/appearance.ts 的 duplicateStyle） */
    copySuffix: '副本',
    delete: '删除',
    done: '完成',
    preloadRange: '提前翻译的范围',
    preloadRangeHint: '屏幕下方多远的段落先翻；越近越省费用',
    preloadStops: ['半屏', '一屏', '两屏', '三屏'],
    threshold: '开始翻译的时机',
    thresholdHint: '段落露出多少才开始翻',
    thresholdStops: ['刚露出', '露出一半', '完全露出'],
    /** 随扩展一起发的那几份配置的名字（`BUILT_IN_STYLES` / `BUILT_IN_HIGHLIGHTS`）：它们是我们的，
     *  不是读者写的，所以跟着界面语言走；读者改过名字之后就用读者的 */
    builtInStyles: { follow: '与原文相同', green: '绿色', blue: '蓝色', amber: '琥珀', muted: '淡一档', blur: '模糊' },
    builtInHighlights: { 'soft-green': '柔和绿', sand: '淡黄', sky: '淡蓝' },
    preview: '预览',
    previewSource: PREVIEW_SOURCE,
    previewTarget: PREVIEW_TARGET,
  },
  prompts: {
    /** 提示词管理（S-O-6x）：内置一份、读者自己一份，变量按钮插到光标处 */
    manager: {
      view: '查看',
      viewTitle: '查看内置提示词',
      copy: '复制并自定义',
      /** 复制内置提示词时新的那份叫什么（与外观配置的 copySuffix 是同一件事，标点各随各的语言） */
      copyOf: (name: string) => `${name}（副本）`,
      copyTitle: '复制并自定义',
      custom: '自定义',
      edit: '编辑',
      editTitle: '编辑提示词',
      remove: '删除',
      removeConfirm: (name: string) => `删除提示词「${name}」？`,
      create: '新建',
      createTitle: '新建提示词',
      /** 导入提示词文件失败的两种情形（providers/prompt-file.ts 只报是哪一种） */
      importFailed: {
        notJson: '这个文件不是合法的 JSON',
        badShape: '文件格式不对：应是 [{ "name", "systemPrompt", "prompt" }] 这样的数组，name 与 prompt 必填',
      },
      importFile: '导入 JSON',
      exportMine: '导出自定义',
      imported: (n: number) => `已导入 ${n} 条`,
      saved: '已保存',
      added: '已加入列表',
      addToList: '加入列表',
      close: '关闭',
      cancel: '取消',
      nameEmpty: '名称不能为空',
      promptEmpty: '用户提示词不能为空',
      systemPrompt: 'System prompt（收发协议会自动追加在它后面，改不掉）',
      userPrompt: '用户提示词',
      name: '名称',
      insert: '插入变量：',
      /** 随扩展一起发的两份提示词的说明，按 id 取（`BUILT_IN_PROMPT_DESCRIPTIONS` 的位置） */
      builtIn: {
        default: '通用学术翻译：术语用既定译法，人名、期刊名、代码与链接保留原文',
        'precision-rewrite': '"翻译即改写"：摆脱原文句法、消除翻译腔，按目标语言的表达习惯重写，术语与格式照旧',
      },
      tokens: {
        targetLanguage: '目标语言的英文名',
        input: '待翻译的 JSON 段落（用户消息里必须有）',
        paperTitle: '论文标题',
        abstract: '论文摘要',
        sectionTitle: '当前章节标题',
        glossary: '术语表',
      },
    },
    title: '提示词', glossaryTooBig: '术语表太长，超出上限后没有保存；请减少条目或缩短内容', glossary: '术语表', glossaryHint: '每行「原文, 译文」，让同一篇里的译法一致', glossaryCount: (n: number) => `${n} 条`, onlyLlm: '只对 LLM 服务生效',
    /** 术语表逐行的问题（providers/glossary.ts 只报是哪一种） */
    glossaryIssue: {
      /** 整句由包来拼：标点是语言的一部分，「第 1 行缺少分隔符」与 "Line 1: ..." 拼法不同 */
      noSeparator: (n: number) => `第 ${n} 行缺少分隔符，应写成「原文, 译文」`,
      emptySource: (n: number) => `第 ${n} 行原文为空`,
      emptyTarget: (n: number) => `第 ${n} 行译文为空`,
    },
    glossaryPlaceholder: 'token, 词元\nembedding, 嵌入' },
  close: '关闭',
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
export const zh = { S, O, REASON } as const
