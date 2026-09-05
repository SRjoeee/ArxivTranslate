import { useEffect, useState } from 'react'
import { browser } from 'wxt/browser'
import { LANG_CODES, label as languageLabel, type LangCode } from '@/config/languages'
import { DEFAULT_CONFIG, configSchema, type Config } from '@/config/schema'
import { getConfig, setConfig } from '@/config/storage'
import { THINKING_HOSTS } from '@/providers/thinking'
import { sendMessage } from '@/shared/messages'
import { PromptManager } from './PromptManager'

const SAMPLE = 'Let <x id="1"/> be a <t id="2">connected</t> graph; see <x id="3"/>.'

const PROVIDERS: [Config['provider'], string, string][] = [
  ['openai-compat', 'LLM（OpenAI 兼容端点）', '译文质量最好，需要 API key'],
  ['google-web', 'Google 网页翻译（免费）', '不需要 key，整篇几秒翻完，术语准确度不如 LLM'],
  ['chrome-builtin', 'Chrome 内置翻译（离线）', '不需要 key、不联网，单句十几毫秒；术语准确度不如 LLM，首次使用要在 popup 里下载语言包'],
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

  useEffect(() => {
    getConfig().then(c => {
      setLocal(c)
      setHasStoredKey(c.openaiCompat.apiKey.length > 0)
    })
  }, [])

  const patchOpenAI = (patch: Partial<Config['openaiCompat']>) =>
    setLocal(c => ({ ...c, openaiCompat: { ...c.openaiCompat, ...patch } }))

  async function save() {
    setNotice('')
    try {
      // 先校验再申请权限：字段有错时不该先把 host 权限拿到手（Codex 在 #6 指出）
      const parsed = configSchema.safeParse({ ...config, openaiCompat: { ...config.openaiCompat, apiKey: keyInput || config.openaiCompat.apiKey } })
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
