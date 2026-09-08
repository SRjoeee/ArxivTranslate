import { useCallback, useEffect, useState } from 'react'
import { browser } from 'wxt/browser'
import { LANG_CODES, label as languageLabel, type LangCode } from '@/config/languages'
import { DEFAULT_CONFIG, MODE_VALUES, configSchema, type Config } from '@/config/schema'
import { getConfig, setConfig } from '@/config/storage'
import { getProvider } from '@/providers'
import { supportsTarget } from '@/providers/microsoft'
import { THINKING_HOSTS } from '@/providers/thinking'
import modesCss from '@/styles/modes.css?inline'
import presetsCss from '@/styles/presets.css?inline'
import { OPACITY_MAX, OPACITY_MIN, customStyleRule, sanitizeCustomCss, styleVarsRule, type StylePreset } from '@/core/renderer/style-preset'
import { formatGlossaryText, parseGlossary } from '@/providers/glossary'
import { sendMessage } from '@/shared/messages'
import type { HelperStatus } from '@/shared/ocr'
import { PromptManager } from './PromptManager'

/** 分组显示：整套照搬 KISS 的预设，加上 Read Frog 的绿与淡色底（§7.5） */
const STYLE_GROUPS: [string, [StylePreset, string][]][] = [
  ['基础', [['none', '与原文相同'], ['muted', '淡一档'], ['green', '绿色（Read Frog 默认）']]],
  ['下划线', [['underline', '实线'], ['dotted', '点线'], ['dashed', '虚线'], ['dashed-bold', '粗虚线'], ['wavy', '波浪线'], ['wavy-bold', '粗波浪线']]],
  ['边框', [['quote', '左侧竖线'], ['box', '细边框'], ['box-dashed', '虚线边框']]],
  ['底色', [['marker', '荧光笔'], ['marker-gradient', '渐变荧光笔'], ['highlight', '高亮底'], ['tint', '淡色底']]],
  ['特效', [['gradient', '渐变文字'], ['colorful', '多彩底'], ['glow', '发光'], ['blink', '呼吸'], ['blur', '模糊（悬停清晰）']]],
  ['自定义', [['custom', '自定义 CSS']]],
]

const STYLE_NOTES: Partial<Record<StylePreset, string>> = {
  none: '不加任何装饰',
  green: 'Read Frog 译文的默认配色，对照阅读时最容易区分',
  quote: '同行的短标题译文不加线，否则会把标题挤歪',
  dashed: '下划线类不占空间，左右对照时不影响两栏对齐',
  blur: '悬停才看清，适合自测与背诵',
  gradient: '静态渐变；流动动画会持续占用 CPU，实测后去掉了',
  custom: '只填声明，选择器由扩展补上',
}

/**
 * 连接测试的样本要用**这个引擎实际会收到的线上格式**（§8.5）。微软只保得住 markers，
 * 发标签给它会被 provider 本地挡下，于是「测试连接」永远失败，而正常翻译其实是好的
 *（Codex 在 #115 指出）。格式取引擎自己声明的偏好，不按 id 特判
 */
const SAMPLE_TAGS = 'Let <x id="1"/> be a <t id="2">connected</t> graph; see <x id="3"/>.'
const SAMPLE_MARKERS = 'Let @a# be a connected graph; see @b#.'
const sampleFor = (config: Config) => (getProvider(config).wireFormats[0] === 'markers' ? SAMPLE_MARKERS : SAMPLE_TAGS)

/** 图片翻译的模式闸（§15）：与 popup 的模式按钮同一套叫法 */
const IMAGE_MODES: [Config['mode'], string][] = [['side', '左右对照'], ['stack', '上下对照'], ['only', '仅译文']]

const PROVIDERS: [Config['provider'], string, string][] = [
  ['openai-compat', 'LLM（OpenAI 兼容端点）', '译文质量最好，需要 API key'],
  ['google-web', 'Google 网页翻译（免费）', '不需要 key，整篇几秒翻完，术语准确度不如 LLM'],
  ['chrome-builtin', 'Chrome 内置翻译（离线）', '不需要 key、不联网，单句十几毫秒；术语准确度不如 LLM，首次使用要在 popup 里下载语言包'],
  ['microsoft', '微软翻译（免费）', '不需要 key；只保得住纯文本记号，所以内联样式（斜体等）会丢，公式与链接不受影响'],
]

// Phase 2：provider 配置 + 连接测试。样式预设、术语表、缓存管理在 Phase 3。
/**
 * 预览：用**真实的**注入表渲染一段示例。
 *
 * 必须是 iframe 而不是 Shadow DOM（Codex 在 #106 指出）：预设与生成的规则都以 `html[data-axt-*]` 开头，
 * 而 shadow 边界外的 `<html>` 是匹配不到的——放 shadow root 里等于一条规则都不生效。
 * iframe 里有真的文档根，属性写在它的 `<html>` 上，与真实页面完全同构；顺带天然隔离，
 * 不怕预设的规则漏到设置页自身。`modesCss` 也要带上：`--axt-color` 是由它消费的
 */
function StylePreview({ style }: { style: Config['style'] }) {
  // 两段要落在预设的两侧，顺序与 renderer 的 styleSheet() 一致——拼错了预览就与真实页面不一致
  const vars = styleVarsRule(style)
  const srcDoc = `<!doctype html><html data-axt-on data-axt-style="${style.preset}"><head><meta charset="utf-8">`
    + `<style>${modesCss}\n${vars.base}${presetsCss}\n${vars.overrides}${customStyleRule(style.customCss)}`
    + 'body{margin:0;padding:10px 12px;font:14px/1.7 system-ui;color:#333}</style></head><body>'
    // 预设只匹配 .axt-t，不需要站点类名——写 ltx_* 会违反硬规则 2（选择器只在规则模块里）
    + '<p>The Fourier transform is bounded.</p>'
    + '<p class="axt-t" lang="zh-CN">傅里叶变换是有界的。</p>'
    + '</body></html>'
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>预览</div>
      <iframe title="译文样式预览" srcDoc={srcDoc} style={{ width: '100%', height: 96, border: '1px solid #ddd', borderRadius: 4 }} />
    </div>
  )
}

export function App() {
  const [config, setLocal] = useState<Config>(DEFAULT_CONFIG)
  const [hasStoredKey, setHasStoredKey] = useState(false)
  // 空串表示"不改动已存的 key"；密钥只写不回显
  const [keyInput, setKeyInput] = useState('')
  const [notice, setNotice] = useState('')
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState('')
  // 术语表在页面里是文本，保存时才解析成结构（成批粘贴比逐行编辑快）
  const [glossaryText, setGlossaryText] = useState('')
  const [cache, setCache] = useState<{ entries: number; bytes: number } | null>(null)
  const [cacheError, setCacheError] = useState('')
  const [cacheNote, setCacheNote] = useState('')
  /** 本机 OCR helper 的状态（§15.4）：没检测到就把图片翻译一节灰掉 */
  const [helper, setHelper] = useState<HelperStatus | null>(null)

  const loadCacheStats = useCallback(async () => {
    try {
      const res = await sendMessage({ type: 'axt:cache-stats' })
      // 读不到就说读不到：把失败显示成「已缓存 0 条」会让用户以为缓存是空的（Codex 在 #52 指出）
      if (res.ok) { setCache({ entries: res.entries, bytes: res.bytes }); setCacheError('') }
      else { setCache(null); setCacheError(res.message) }
    } catch (e) {
      setCache(null)
      setCacheError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    sendMessage({ type: 'axt:helper-status' }).then(setHelper).catch(() => setHelper({ available: false, reason: '扩展后台未响应' }))
  }, [])

  useEffect(() => {
    getConfig().then(c => {
      setLocal(c)
      setHasStoredKey(c.openaiCompat.apiKey.length > 0)
      setGlossaryText(formatGlossaryText(c.glossary))
    })
    void loadCacheStats()
    // 翻译发生在别的标签页：切回设置页时重新读一次，否则显示的永远是打开那一刻的数字
    const onVisible = () => { if (!document.hidden) void loadCacheStats() }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [loadCacheStats])

  const patchOpenAI = (patch: Partial<Config['openaiCompat']>) =>
    setLocal(c => ({ ...c, openaiCompat: { ...c.openaiCompat, ...patch } }))

  async function save() {
    setNotice('')
    try {
      // 自定义 CSS 只接受声明块：写了花括号会把整篇论文的排版改掉，而且很难看出原因
      if (config.style.preset === 'custom') {
        const css = sanitizeCustomCss(config.style.customCss)
        if (!css.ok) throw new Error(`自定义样式：${css.reason}`)
      }
      // 写错的术语行要报行号，不能静默丢掉——用户会以为术语已经生效
      const glossary = parseGlossary(glossaryText)
      if (glossary.issues.length > 0) {
        throw new Error(`术语表：${glossary.issues.map(i => `第 ${i.line} 行${i.reason}`).join('；')}`)
      }
      // 先校验再申请权限：字段有错时不该先把 host 权限拿到手（Codex 在 #6 指出）
      const parsed = configSchema.safeParse({ ...config, glossary: glossary.entries, openaiCompat: { ...config.openaiCompat, apiKey: keyInput || config.openaiCompat.apiKey } })
      if (!parsed.success) throw new Error(parsed.error.issues.map(i => `${i.path.join('.')}：${i.message}`).join('；'))
      const next = parsed.data
      const previous = await getConfig()
      // 免费端点自带 CORS，不需要 host 权限；只有走 LLM 时才申请
      if (next.provider === 'openai-compat') await ensureHostPermission(next.openaiCompat.baseURL)
      await setConfig(next)
      await releaseHostPermission(previous.openaiCompat.baseURL, next.openaiCompat.baseURL)
      setLocal(next)
      setHasStoredKey(next.openaiCompat.apiKey.length > 0)
      setKeyInput('')
      setGlossaryText(formatGlossaryText(next.glossary))
      setNotice('已保存')
    } catch (e) {
      setNotice(`保存失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }

  /**
   * 留空只表示"不改"，删除要有显式动作（Codex 在 #6 指出）。
   * 只动已存的那份：表单里未保存的改动（比如换了 Base URL）不能借这个动作绕过校验与权限申请（Codex 在 #30 指出）
   */
  async function clearKey() {
    setNotice('')
    try {
      const stored = await getConfig()
      await setConfig({ ...stored, openaiCompat: { ...stored.openaiCompat, apiKey: '' } })
      setLocal(c => ({ ...c, openaiCompat: { ...c.openaiCompat, apiKey: '' } }))
      setHasStoredKey(false)
      setKeyInput('')
      setNotice('已清除 API key')
    } catch (e) {
      setNotice(`清除失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }

  async function testConnection() {
    setTesting(true)
    setTestResult('')
    const t0 = performance.now()
    try {
      // 已保存的那份配置：引擎与样本格式都从它取，与 background 建链时读到的一致
      const saved = await getConfig()
      const res = await sendMessage({
        type: 'axt:translate',
        // 指名引擎：测试连接问的是「这个端点通不通」，走降级链的话端点坏了也会显示成功。
        // 用**已保存的**那个而不是表单里的——按钮上写着「用已保存的配置」，而 background 也是从
        // storage 读配置建链；拿未保存的下拉值去指名，轻则测错引擎，重则报「不在当前链上」（Codex 在 #59 指出）
        providerId: saved.provider,
        request: { segments: [{ id: 'sample', text: sampleFor(saved) }], source: 'en', target: saved.targetLanguage, context: { sectionTitle: '连接测试' } },
      })
      const ms = Math.round(performance.now() - t0)
      setTestResult(res.ok
        ? `${res.result.segments[0]?.text ?? ''}（${ms} ms，${res.result.model ?? ''}）`
        : `失败：${res.error.kind} — ${res.error.message}`)
    } catch (e) {
      setTestResult(`失败：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setTesting(false)
    }
  }


  /** 清空整库。设置页拿不到当前论文 id，所以只做全局清空（§9） */
  async function clearCache() {
    if (!window.confirm('清空全部译文缓存？之后重新翻译会重新请求引擎。')) return
    setCacheNote('')
    try {
      const result = await sendMessage({ type: 'axt:cache-clear', paper: undefined })
      if (!result.ok) throw new Error(result.message)
      setCacheNote(`已删除 ${result.removed} 条`)
      await loadCacheStats()
    } catch (e) {
      setCacheNote(`清空失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const field = { display: 'block', width: '100%', boxSizing: 'border-box' as const, padding: '6px 8px', font: 'inherit', marginTop: 4 }
  const label = { display: 'block', marginBottom: 14 }

  return (
    <main style={{ maxWidth: 640, margin: '40px auto', font: '14px system-ui, sans-serif', lineHeight: 1.5 }}>
      <h1 style={{ fontSize: 18 }}>arXiv HTML Translator · 设置</h1>

      <h2 style={{ fontSize: 15, marginTop: 24 }}>翻译引擎</h2>
      <label style={label}>
        引擎
        <select style={field} value={config.provider} onChange={e => setLocal(c => ({ ...c, provider: e.target.value as Config['provider'] }))}>
          {PROVIDERS.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        <small style={{ color: '#666' }}>{PROVIDERS.find(([id]) => id === config.provider)?.[2]}</small>
        {/* 语言闸要在**选的时候**说清楚（#98）：isAvailable() 为假只会让链默默降级到 Google，
            popup 那句「不可用」讲不出「因为微软不支持这门语言」。179 个目标语言里它支持 108 个 */}
        {config.provider === 'microsoft' && !supportsTarget(config.targetLanguage) && (
          <small style={{ color: '#b00', display: 'block', marginTop: 4 }}>
            微软翻译不支持当前的目标语言（{languageLabel(config.targetLanguage)}）。
            {config.fallback.enabled
              ? '翻译时会自动改用降级链上的免费引擎。'
              : '而且降级链是关掉的，翻译会直接失败。'}
            换一种目标语言，或直接选别的引擎。
          </small>
        )}
      </label>

      <h2 style={{ fontSize: 15, marginTop: 24, opacity: config.provider === 'openai-compat' ? 1 : 0.5 }}>OpenAI 兼容端点</h2>
      <label style={label}>
        Base URL
        <input style={field} value={config.openaiCompat.baseURL} onChange={e => patchOpenAI({ baseURL: e.target.value })} placeholder="https://openrouter.ai/api/v1" disabled={config.provider !== 'openai-compat'} />
        <small style={{ color: '#666' }}>OpenRouter、DeepSeek、Ollama 等；非 openrouter.ai 的域名保存时会申请访问权限</small>
      </label>
      <label style={label}>
        API key{hasStoredKey ? '（已配置，留空则不改）' : ''}
        <input style={field} type="password" value={keyInput} onChange={e => setKeyInput(e.target.value)} autoComplete="off" placeholder={hasStoredKey ? '••••••••' : 'sk-…'} disabled={config.provider !== 'openai-compat'} />
        {hasStoredKey && <button type="button" style={{ marginTop: 4, font: 'inherit', fontSize: 12 }} onClick={clearKey}>清除已存的 key</button>}
        <small style={{ display: 'block', color: '#666' }}>本机端点（localhost / 127.0.0.1）可以不填</small>
      </label>
      <label style={label}>
        模型
        <input style={field} value={config.openaiCompat.model} onChange={e => patchOpenAI({ model: e.target.value })} placeholder="deepseek/deepseek-v4-flash" disabled={config.provider !== 'openai-compat'} />
      </label>
      <label style={label}>
        思考模式
        <select style={field} value={config.openaiCompat.thinking} onChange={e => patchOpenAI({ thinking: e.target.value as Config['openaiCompat']['thinking'] })} disabled={config.provider !== 'openai-compat'}>
          <option value="disabled">关闭（默认，翻译不需要推理，开着每批慢一个数量级）</option>
          <option value="enabled">开启</option>
        </select>
        <small style={{ color: '#666' }}>{thinkingHint(config.openaiCompat.baseURL)}</small>
      </label>
      <label style={label}>
        目标语言
        <select style={field} value={config.targetLanguage} onChange={e => setLocal(c => ({ ...c, targetLanguage: e.target.value as LangCode }))}>
          {LANG_CODES.map(code => <option key={code} value={code}>{languageLabel(code)}</option>)}
        </select>
      </label>

      <h2 style={{ fontSize: 15, marginTop: 24, opacity: config.provider === 'openai-compat' ? 1 : 0.5 }}>提示词（LLM 引擎）</h2>
      <small style={{ display: 'block', color: '#666', marginBottom: 8 }}>决定"怎么翻"；收发协议（JSON 段落与占位符规则）由扩展自动追加，任何提示词都改不掉。换提示词后旧译文不再命中缓存</small>
      <PromptManager value={config.prompts} onChange={prompts => setLocal(c => ({ ...c, prompts }))} />

      <label style={{ ...label, marginTop: 20 }}>
        <input type="checkbox" checked={config.fallback.enabled} onChange={e => setLocal(c => ({ ...c, fallback: { enabled: e.target.checked } }))} />
        {' '}引擎失败时自动降级
        <small style={{ display: 'block', color: '#666' }}>
          key 失效、额度用尽或网络异常时自动切到免费引擎，整页翻译不会停死；免费引擎的术语准确度不如 LLM（会把 weights 译成"重量"），popup 会提示当前用的是哪个引擎。关掉则失败时停下并报错
        </small>
      </label>

      <h2 style={{ fontSize: 15, marginTop: 24, opacity: config.provider === 'openai-compat' ? 1 : 0.5 }}>术语表</h2>
      <small style={{ display: 'block', color: '#666', marginBottom: 8 }}>
        每行一条「原文, 译文」，逗号或制表符分隔，<code>#</code> 开头是注释。随每批一起发给模型，让同一篇里的术语译法统一。
        只对 LLM 引擎有效，免费引擎不看术语表；改动会让已缓存的译文失效。当前 {parseGlossary(glossaryText).entries.length} 条（上限 200）
      </small>
      <textarea
        style={{ ...field, minHeight: 120, fontFamily: 'ui-monospace, monospace', fontSize: 12, marginTop: 0 }}
        value={glossaryText}
        onChange={e => setGlossaryText(e.target.value)}
        placeholder={'weights, 权重\nattention head, 注意力头\n# 以 # 开头的行是注释'}
        disabled={config.provider !== 'openai-compat'}
      />

      <h2 style={{ fontSize: 15, marginTop: 24 }}>译文样式</h2>
      <label style={label}>
        外观
        <select style={field} value={config.style.preset} onChange={e => setLocal(c => ({ ...c, style: { ...c.style, preset: e.target.value as StylePreset } }))}>
          {STYLE_GROUPS.map(([group, items]) => (
            <optgroup key={group} label={group}>
              {items.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </optgroup>
          ))}
        </select>
        <small style={{ color: '#666' }}>{STYLE_NOTES[config.style.preset] ?? '译文只加装饰，字体与字号仍随论文原样'}</small>
      </label>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 14 }}>
        <div style={{ ...label, marginBottom: 0 }}>
          <label htmlFor="axt-color" style={{ display: 'block' }}>文字颜色</label>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
            <input type="color" id="axt-color" style={{ width: 44, height: 28, padding: 0 }}
              value={config.style.color || '#333333'}
              onChange={e => setLocal(c => ({ ...c, style: { ...c.style, color: e.target.value } }))} />
            <label style={{ fontWeight: 'normal', display: 'flex', alignItems: 'center', gap: 4 }}>
              <input type="checkbox" checked={config.style.color === ''}
                onChange={e => setLocal(c => ({ ...c, style: { ...c.style, color: e.target.checked ? '' : '#333333' } }))} />
              跟随原文
            </label>
          </span>
        </div>
        <div style={{ ...label, marginBottom: 0 }}>
          <label htmlFor="axt-accent" style={{ display: 'block' }}>高亮颜色</label>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
            <input type="color" id="axt-accent" style={{ width: 44, height: 28, padding: 0 }}
              value={config.style.accent || '#808080'}
              onChange={e => setLocal(c => ({ ...c, style: { ...c.style, accent: e.target.value } }))} />
            <label style={{ fontWeight: 'normal', display: 'flex', alignItems: 'center', gap: 4 }}>
              <input type="checkbox" checked={config.style.accent === ''}
                onChange={e => setLocal(c => ({ ...c, style: { ...c.style, accent: e.target.checked ? '' : '#808080' } }))} />
              {/* 不叫「跟随正文」：只有下划线族的 --axt-accent 是 currentColor 派生的，
                  marker / highlight / glow 用的 --axt-green 是写死的绿，不跟正文走（Codex 在 #106 指出） */}
              预设默认色
            </label>
          </span>
        </div>
        <label style={{ ...label, marginBottom: 0, minWidth: 180 }}>
          透明度 {config.style.opacity.toFixed(2)}
          <input type="range" min={OPACITY_MIN} max={OPACITY_MAX} step={0.05} value={config.style.opacity}
            style={{ display: 'block', width: '100%', marginTop: 8 }}
            onChange={e => setLocal(c => ({ ...c, style: { ...c.style, opacity: Number(e.target.value) } }))} />
        </label>
        <button type="button" style={{ alignSelf: 'end', padding: '6px 10px' }}
          onClick={() => setLocal(c => ({ ...c, style: { ...c.style, color: '', opacity: OPACITY_MAX, accent: '' } }))}>
          恢复默认
        </button>
      </div>
      <StylePreview style={config.style} />
      {config.style.preset === 'custom' && (
        <label style={label}>
          自定义声明
          <textarea
            style={{ ...field, minHeight: 70, fontFamily: 'ui-monospace, monospace', fontSize: 12 }}
            value={config.style.customCss}
            onChange={e => setLocal(c => ({ ...c, style: { ...c.style, customCss: e.target.value } }))}
            placeholder="color: #1565c0; opacity: 0.95;"
          />
          <small style={{ display: 'block', color: '#666' }}>
            只填花括号里的声明，扩展会补上选择器。不要写花括号、<code>@</code> 规则或标签。
            译文继承原文的字体与字号，写 <code>font-size</code> 这类属性会破坏站点排版
          </small>
        </label>
      )}

      <h2 style={{ fontSize: 15, marginTop: 24, opacity: helper?.available ? 1 : 0.5 }}>图片翻译（Mac）</h2>
      <small style={{ display: 'block', color: '#666', marginBottom: 8 }}>
        {helper === null ? '正在检测本机 OCR helper…'
          : helper.available ? `已检测到 helper ${helper.version ?? ''}。位图里的文字由本机 Vision 识别，译文叠在图上；SVG 不翻`
          : `未检测到 helper${helper.reason ? `（${helper.reason}）` : ''}。安装方法见仓库 helper/README.md；没装时整页翻译照常，只是不翻图`}
      </small>
      <fieldset style={{ border: 0, padding: 0, margin: '0 0 14px' }} disabled={!helper?.available}>
        <legend style={{ padding: 0 }}>在哪些模式下翻译图片</legend>
        {IMAGE_MODES.map(([mode, name]) => (
          <label key={mode} style={{ marginRight: 16 }}>
            <input
              type="checkbox"
              checked={config.image.modes.includes(mode)}
              onChange={e => setLocal(c => ({ ...c, image: { modes: MODE_VALUES.filter(m => (m === mode ? e.target.checked : c.image.modes.includes(m))) } }))}
            />
            {' '}{name}
          </label>
        ))}
        <small style={{ display: 'block', color: '#666', marginTop: 4 }}>只影响显示：切到没勾的模式时叠加层隐藏，切回来再显示，不重新识别</small>
      </fieldset>

      <h2 style={{ fontSize: 15, marginTop: 24 }}>翻译范围</h2>
      <label style={label}>
        预翻译距离（像素）
        <input style={field} type="number" min={0} max={10000} step={100} value={config.preload.margin} onChange={e => setLocal(c => ({ ...c, preload: { ...c.preload, margin: Number(e.target.value) } }))} />
        <small style={{ color: '#666' }}>屏幕下方多远的段落提前翻译。越小越省 API 费用；改动在下次开始翻译时生效</small>
      </label>
      <label style={label}>
        可见阈值（0 到 1）
        <input style={field} type="number" min={0} max={1} step={0.1} value={config.preload.threshold} onChange={e => setLocal(c => ({ ...c, preload: { ...c.preload, threshold: Number(e.target.value) } }))} />
        <small style={{ color: '#666' }}>段落露出多少比例才翻译；0 表示碰到边缘就翻</small>
      </label>

      <p>
        <button type="button" onClick={save}>保存</button>
        {' '}
        <button type="button" onClick={testConnection} disabled={testing}>{testing ? '测试中…' : '测试连接（用已保存的配置）'}</button>
        {' '}
        <span>{notice}</span>
      </p>
      {testResult && <p style={{ padding: 8, background: '#f4f4f4', borderRadius: 4 }}>{testResult}</p>}

      <h2 style={{ fontSize: 15, marginTop: 24 }}>译文缓存</h2>
      <p style={{ margin: '0 0 4px', fontSize: 13 }}>
        {cache !== null
          ? `已缓存 ${cache.entries} 条 · ${(cache.bytes / 1024 / 1024).toFixed(2)} MB`
          : cacheError === '' ? '读取中…' : `读取缓存失败：${cacheError}`}
      </p>
      <small style={{ display: 'block', color: '#666', marginBottom: 8 }}>
        缓存按引擎、模型、提示词、术语表分开存；换了其中任何一样都不会命中旧译文，通常不需要手动清
      </small>
      <p>
        <button type="button" onClick={clearCache}>清空全部缓存</button>
        {' '}
        <span style={{ color: '#666', fontSize: 12 }}>{cacheNote}</span>
      </p>
    </main>
  )
}

/** 只有登记过的端点会带思考字段（thinking.ts），其他端点开关无效，提前说清 */
function thinkingHint(baseURL: string): string {
  let host = ''
  try {
    host = new URL(baseURL).hostname
  } catch {
    return ''
  }
  return THINKING_HOSTS.includes(host)
    ? `会按 ${host} 的字段格式发送开关`
    : `${host} 未登记（支持：${THINKING_HOSTS.join('、')}），不发送思考字段，按端点默认行为`
}

function originPattern(url: string): string | null {
  try {
    return `${new URL(url).origin}/*`
  } catch {
    return null
  }
}

/** 自定义端点需要该 origin 的 host 权限；保存按钮就是用户手势 */
async function ensureHostPermission(baseURL: string) {
  const origin = originPattern(baseURL)
  if (!origin) throw new Error('Base URL 不合法')
  if (await browser.permissions.contains({ origins: [origin] })) return
  const granted = await browser.permissions.request({ origins: [origin] })
  if (!granted) throw new Error(`未授予对 ${origin} 的访问权限`)
}

/** 换了端点就收回旧 origin 的权限，免得越换越多；manifest 里固定申请的不收（Codex 在 #6 指出） */
async function releaseHostPermission(previousURL: string, currentURL: string) {
  const previous = originPattern(previousURL)
  if (!previous || previous === originPattern(currentURL)) return
  if ((browser.runtime.getManifest().host_permissions ?? []).includes(previous)) return
  await browser.permissions.remove({ origins: [previous] }).catch(() => undefined)
}
