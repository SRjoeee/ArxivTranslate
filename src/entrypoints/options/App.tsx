import { useCallback, useEffect, useState } from 'react'
import { browser } from 'wxt/browser'
import { LANG_CODES, label as languageLabel, type LangCode } from '@/config/languages'
import { DEFAULT_CONFIG, configSchema, type Config } from '@/config/schema'
import { getConfig, setConfig } from '@/config/storage'
import { THINKING_HOSTS } from '@/providers/thinking'
import { sanitizeCustomCss, type StylePreset } from '@/core/renderer/style-preset'
import { formatGlossaryText, parseGlossary } from '@/providers/glossary'
import { sendMessage } from '@/shared/messages'
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

const SAMPLE = 'Let <x id="1"/> be a <t id="2">connected</t> graph; see <x id="3"/>.'

const PROVIDERS: [Config['provider'], string, string][] = [
  ['openai-compat', 'LLM（OpenAI 兼容端点）', '译文质量最好，需要 API key'],
  ['google-web', 'Google 网页翻译（免费）', '不需要 key，整篇几秒翻完，术语准确度不如 LLM'],
]

// Phase 2：provider 配置 + 连接测试。样式预设、术语表、缓存管理在 Phase 3。
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
  const [cacheNote, setCacheNote] = useState('')

  const loadCacheStats = useCallback(async () => {
    try {
      setCache(await sendMessage({ type: 'axt:cache-stats' }))
    } catch {
      setCache(null)
    }
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
      const res = await sendMessage({
        type: 'axt:translate',
        request: { segments: [{ id: 'sample', text: SAMPLE }], source: 'en', target: config.targetLanguage, context: { sectionTitle: '连接测试' } },
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
        {cache === null ? '读取中…' : `已缓存 ${cache.entries} 条 · ${(cache.bytes / 1024 / 1024).toFixed(2)} MB`}
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
