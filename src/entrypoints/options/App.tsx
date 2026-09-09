import { useCallback, useEffect, useState } from 'react'
import { browser } from 'wxt/browser'
import { LANG_CODES, label as languageLabel, type LangCode } from '@/config/languages'
import { DEFAULT_CONFIG, MODE_VALUES, configSchema, type Config } from '@/config/schema'
import { getConfig, setConfig } from '@/config/storage'
import { THINKING_HOSTS } from '@/providers/thinking'
import { sanitizeCustomCss, type StylePreset } from '@/core/renderer/style-preset'
import { formatGlossaryText, parseGlossary } from '@/providers/glossary'
import { sendMessage } from '@/shared/messages'
import type { HelperStatus } from '@/shared/ocr'
import { PromptManager } from './PromptManager'

/** Grouped presets: the full KISS set plus Read Frog green and tint (§7.5). */
const STYLE_GROUPS: [string, [StylePreset, string][]][] = [
  ['Basic', [['none', 'Match original'], ['muted', 'Muted'], ['green', 'Green (Read Frog default)']]],
  ['Underline', [['underline', 'Solid'], ['dotted', 'Dotted'], ['dashed', 'Dashed'], ['dashed-bold', 'Bold dashed'], ['wavy', 'Wavy'], ['wavy-bold', 'Bold wavy']]],
  ['Border', [['quote', 'Left rule'], ['box', 'Thin border'], ['box-dashed', 'Dashed border']]],
  ['Background', [['marker', 'Marker'], ['marker-gradient', 'Gradient marker'], ['highlight', 'Highlight'], ['tint', 'Tint']]],
  ['Effects', [['gradient', 'Gradient text'], ['colorful', 'Colorful background'], ['glow', 'Glow'], ['blink', 'Pulse'], ['blur', 'Blur (reveal on hover)']]],
  ['Custom', [['custom', 'Custom CSS']]],
]

const STYLE_NOTES: Partial<Record<StylePreset, string>> = {
  none: 'No added decoration',
  green: 'Read Frog’s default translation color makes bilingual text easy to distinguish',
  quote: 'Inline short headings omit the rule to preserve alignment',
  dashed: 'Underlines take no extra space and preserve side-by-side alignment',
  blur: 'Reveal on hover for self-testing and memorization',
  gradient: 'Static gradient; animation was removed after testing showed sustained CPU use',
  custom: 'Enter declarations only; the extension adds selectors',
}

const SAMPLE = 'Let <x id="1"/> be a <t id="2">connected</t> graph; see <x id="3"/>.'

/** Image translation mode gate (§15): same labels as the popup mode buttons. */
const IMAGE_MODES: [Config['mode'], string][] = [['side', 'Side by side'], ['stack', 'Stacked'], ['only', 'Translation only']]

const PROVIDERS: [Config['provider'], string, string][] = [
  ['openai-compat', 'LLM (OpenAI-compatible endpoint)', 'Best translation quality; requires an API key'],
  ['google-web', 'Google web translation (free)', 'No key required; translates a paper in seconds, with less accurate terminology than an LLM'],
  ['chrome-builtin', 'Chrome built-in translation (offline)', 'No key or network required; tens of milliseconds per sentence. Less accurate terminology than an LLM; download the language pack from the popup before first use'],
]

// Phase 2: provider settings and connection testing. Styles, glossary and cache management follow in Phase 3.
export function App() {
  const [config, setLocal] = useState<Config>(DEFAULT_CONFIG)
  const [hasStoredKey, setHasStoredKey] = useState(false)
  // Empty means keep the stored key; keys are write-only and never displayed.
  const [keyInput, setKeyInput] = useState('')
  const [notice, setNotice] = useState('')
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState('')
  // Glossary stays as text in the form and is parsed on save (bulk pasting is faster than editing rows).
  const [glossaryText, setGlossaryText] = useState('')
  const [cache, setCache] = useState<{ entries: number; bytes: number } | null>(null)
  const [cacheError, setCacheError] = useState('')
  const [cacheNote, setCacheNote] = useState('')
  /** Local OCR helper status (§15.4): disable the image translation section if undetected. */
  const [helper, setHelper] = useState<HelperStatus | null>(null)

  const loadCacheStats = useCallback(async () => {
    try {
      const res = await sendMessage({ type: 'axt:cache-stats' })
      // Report read failures: showing zero cached entries would falsely imply an empty cache (Codex #52).
      if (res.ok) { setCache({ entries: res.entries, bytes: res.bytes }); setCacheError('') }
      else { setCache(null); setCacheError(res.message) }
    } catch (e) {
      setCache(null)
      setCacheError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    sendMessage({ type: 'axt:helper-status' }).then(setHelper).catch(() => setHelper({ available: false, reason: 'Extension background did not respond' }))
  }, [])

  useEffect(() => {
    getConfig().then(c => {
      setLocal(c)
      setHasStoredKey(c.openaiCompat.apiKey.length > 0)
      setGlossaryText(formatGlossaryText(c.glossary))
    })
    void loadCacheStats()
    // Translation happens in other tabs: refresh when settings regains focus so counts do not remain at their initial values.
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
      // Custom CSS accepts declarations only: braces can alter the whole paper layout in ways that are hard to diagnose.
      if (config.style.preset === 'custom') {
        const css = sanitizeCustomCss(config.style.customCss)
        if (!css.ok) throw new Error(`Custom style: ${css.reason}`)
      }
      // Report malformed glossary lines by number; silently dropping them would imply the terms were applied.
      const glossary = parseGlossary(glossaryText)
      if (glossary.issues.length > 0) {
        throw new Error(`Glossary: ${glossary.issues.map(i => `line ${i.line}: ${i.reason}`).join('; ')}`)
      }
      // Validate before requesting permissions; invalid fields should not grant host access (Codex #6).
      const parsed = configSchema.safeParse({ ...config, glossary: glossary.entries, openaiCompat: { ...config.openaiCompat, apiKey: keyInput || config.openaiCompat.apiKey } })
      if (!parsed.success) throw new Error(parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '))
      const next = parsed.data
      const previous = await getConfig()
      // Free endpoints supply CORS headers and need no host permission; request it only for LLMs.
      if (next.provider === 'openai-compat') await ensureHostPermission(next.openaiCompat.baseURL)
      await setConfig(next)
      await releaseHostPermission(previous.openaiCompat.baseURL, next.openaiCompat.baseURL)
      setLocal(next)
      setHasStoredKey(next.openaiCompat.apiKey.length > 0)
      setKeyInput('')
      setGlossaryText(formatGlossaryText(next.glossary))
      setNotice('Saved')
    } catch (e) {
      setNotice(`Save failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  /**
   * Empty means keep; deletion requires an explicit action (Codex #6).
   * Modify stored config only: unsaved form changes (e.g. Base URL) must not bypass validation or permission requests through this action (Codex #30).
   */
  async function clearKey() {
    setNotice('')
    try {
      const stored = await getConfig()
      await setConfig({ ...stored, openaiCompat: { ...stored.openaiCompat, apiKey: '' } })
      setLocal(c => ({ ...c, openaiCompat: { ...c.openaiCompat, apiKey: '' } }))
      setHasStoredKey(false)
      setKeyInput('')
      setNotice('API key cleared')
    } catch (e) {
      setNotice(`Could not clear API key: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  async function testConnection() {
    setTesting(true)
    setTestResult('')
    const t0 = performance.now()
    try {
      const res = await sendMessage({
        type: 'axt:translate',
        // Name the engine explicitly: connection testing asks whether this endpoint works; fallback could falsely report success.
        // Use the saved engine, not the form value: the button promises saved settings, and background builds its chain from storage.
        // An unsaved selection could test the wrong engine or report that it is absent from the chain (Codex #59).
        providerId: (await getConfig()).provider,
        request: { segments: [{ id: 'sample', text: SAMPLE }], source: 'en', target: config.targetLanguage, context: { sectionTitle: 'Connection test' } },
      })
      const ms = Math.round(performance.now() - t0)
      setTestResult(res.ok
        ? `${res.result.segments[0]?.text ?? ''} (${ms} ms, ${res.result.model ?? ''})`
        : `Failed: ${res.error.kind} — ${res.error.message}`)
    } catch (e) {
      setTestResult(`Failed: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setTesting(false)
    }
  }


  /** Clear the entire cache: settings has no current paper id, so only global clearing is available (§9). */
  async function clearCache() {
    if (!window.confirm('Clear all cached translations? Translating again will send new requests to the engine.')) return
    setCacheNote('')
    try {
      const result = await sendMessage({ type: 'axt:cache-clear', paper: undefined })
      if (!result.ok) throw new Error(result.message)
      setCacheNote(`Deleted ${result.removed} entries`)
      await loadCacheStats()
    } catch (e) {
      setCacheNote(`Could not clear cache: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const field = { display: 'block', width: '100%', boxSizing: 'border-box' as const, padding: '6px 8px', font: 'inherit', marginTop: 4 }
  const label = { display: 'block', marginBottom: 14 }

  return (
    <main style={{ maxWidth: 640, margin: '40px auto', font: '14px system-ui, sans-serif', lineHeight: 1.5 }}>
      <h1 style={{ fontSize: 18 }}>arXiv HTML Translator · Settings</h1>

      <h2 style={{ fontSize: 15, marginTop: 24 }}>Translation engine</h2>
      <label style={label}>
        Engine
        <select style={field} value={config.provider} onChange={e => setLocal(c => ({ ...c, provider: e.target.value as Config['provider'] }))}>
          {PROVIDERS.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        <small style={{ color: '#666' }}>{PROVIDERS.find(([id]) => id === config.provider)?.[2]}</small>
      </label>

      <h2 style={{ fontSize: 15, marginTop: 24, opacity: config.provider === 'openai-compat' ? 1 : 0.5 }}>OpenAI-compatible endpoint</h2>
      <label style={label}>
        Base URL
        <input style={field} value={config.openaiCompat.baseURL} onChange={e => patchOpenAI({ baseURL: e.target.value })} placeholder="https://openrouter.ai/api/v1" disabled={config.provider !== 'openai-compat'} />
        <small style={{ color: '#666' }}>OpenRouter, DeepSeek, Ollama, etc. Saving a domain other than openrouter.ai requests access permission.</small>
      </label>
      <label style={label}>
        API key{hasStoredKey ? ' (configured; leave blank to keep)' : ''}
        <input style={field} type="password" value={keyInput} onChange={e => setKeyInput(e.target.value)} autoComplete="off" placeholder={hasStoredKey ? '••••••••' : 'sk-…'} disabled={config.provider !== 'openai-compat'} />
        {hasStoredKey && <button type="button" style={{ marginTop: 4, font: 'inherit', fontSize: 12 }} onClick={clearKey}>Clear stored key</button>}
        <small style={{ display: 'block', color: '#666' }}>Optional for local endpoints (localhost / 127.0.0.1)</small>
      </label>
      <label style={label}>
        Model
        <input style={field} value={config.openaiCompat.model} onChange={e => patchOpenAI({ model: e.target.value })} placeholder="deepseek/deepseek-v4-flash" disabled={config.provider !== 'openai-compat'} />
      </label>
      <label style={label}>
        Thinking mode
        <select style={field} value={config.openaiCompat.thinking} onChange={e => patchOpenAI({ thinking: e.target.value as Config['openaiCompat']['thinking'] })} disabled={config.provider !== 'openai-compat'}>
          <option value="disabled">Off (default)</option>
          <option value="enabled">On</option>
        </select>
        <small style={{ color: '#666' }}>Reasoning is unnecessary and can slow batches by 10×. {thinkingHint(config.openaiCompat.baseURL)}</small>
      </label>
      <label style={label}>
        Target language
        <select style={field} value={config.targetLanguage} onChange={e => setLocal(c => ({ ...c, targetLanguage: e.target.value as LangCode }))}>
          {LANG_CODES.map(code => <option key={code} value={code}>{languageLabel(code)}</option>)}
        </select>
      </label>

      <h2 style={{ fontSize: 15, marginTop: 24, opacity: config.provider === 'openai-compat' ? 1 : 0.5 }}>Prompts (LLM engines)</h2>
      <small style={{ display: 'block', color: '#666', marginBottom: 8 }}>Controls translation style. The extension always appends the mandatory JSON segment and placeholder protocol. Changing prompts invalidates cached translations.</small>
      <PromptManager value={config.prompts} onChange={prompts => setLocal(c => ({ ...c, prompts }))} />

      <label style={{ ...label, marginTop: 20 }}>
        <input type="checkbox" checked={config.fallback.enabled} onChange={e => setLocal(c => ({ ...c, fallback: { enabled: e.target.checked } }))} />
        {' '}Automatically fall back when an engine fails
        <small style={{ display: 'block', color: '#666' }}>
          Switch to a free engine if the key expires, quota runs out or the network fails, keeping translation running. Free engines can misread technical terms (such as treating model weights as physical weight); the popup shows the active engine. When disabled, failures stop translation and display an error.
        </small>
      </label>

      <h2 style={{ fontSize: 15, marginTop: 24, opacity: config.provider === 'openai-compat' ? 1 : 0.5 }}>Glossary</h2>
      <small style={{ display: 'block', color: '#666', marginBottom: 8 }}>
        One entry per line: “source, translation”, separated by a comma or tab. Lines starting with <code>#</code> are comments. Each batch includes the glossary for consistent terminology.
        LLM engines only; free engines ignore it. Changes invalidate cached translations. Current entries: {parseGlossary(glossaryText).entries.length} (maximum 200).
      </small>
      <textarea
        style={{ ...field, minHeight: 120, fontFamily: 'ui-monospace, monospace', fontSize: 12, marginTop: 0 }}
        value={glossaryText}
        onChange={e => setGlossaryText(e.target.value)}
        placeholder={'weights, 权重\nattention head, 注意力头\n# Lines starting with # are comments'}
        disabled={config.provider !== 'openai-compat'}
      />

      <h2 style={{ fontSize: 15, marginTop: 24 }}>Translation style</h2>
      <label style={label}>
        Appearance
        <select style={field} value={config.style.preset} onChange={e => setLocal(c => ({ ...c, style: { ...c.style, preset: e.target.value as StylePreset } }))}>
          {STYLE_GROUPS.map(([group, items]) => (
            <optgroup key={group} label={group}>
              {items.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </optgroup>
          ))}
        </select>
        <small style={{ color: '#666' }}>{STYLE_NOTES[config.style.preset] ?? 'Decoration only; translations keep the paper’s font and size'}</small>
      </label>
      {config.style.preset === 'custom' && (
        <label style={label}>
          Custom declarations
          <textarea
            style={{ ...field, minHeight: 70, fontFamily: 'ui-monospace, monospace', fontSize: 12 }}
            value={config.style.customCss}
            onChange={e => setLocal(c => ({ ...c, style: { ...c.style, customCss: e.target.value } }))}
            placeholder="color: #1565c0; opacity: 0.95;"
          />
          <small style={{ display: 'block', color: '#666' }}>
            Enter only the declarations inside braces; the extension adds selectors. Do not include braces, <code>@</code> rules or tags.
            Translations inherit the original font and size; properties such as <code>font-size</code> can disrupt the paper’s layout.
          </small>
        </label>
      )}

      <h2 style={{ fontSize: 15, marginTop: 24, opacity: helper?.available ? 1 : 0.5 }}>Image translation (Mac)</h2>
      <small style={{ display: 'block', color: '#666', marginBottom: 8 }}>
        {helper === null ? 'Detecting local OCR helper…'
          : helper.available ? `Helper ${helper.version ?? ''} detected. Local Vision OCR reads bitmap text; translations appear over the image. SVGs are not translated.`
          : `Helper not detected${helper.reason ? ` (${helper.reason})` : ''}. See helper/README.md in the repository for installation. Page text translation still works without it.`}
      </small>
      <fieldset style={{ border: 0, padding: 0, margin: '0 0 14px' }} disabled={!helper?.available}>
        <legend style={{ padding: 0 }}>Translate images in these modes</legend>
        {IMAGE_MODES.map(([mode, name]) => (
          <label key={mode} style={{ display: 'inline-block', marginRight: 16 }}>
            <input
              type="checkbox"
              checked={config.image.modes.includes(mode)}
              onChange={e => setLocal(c => ({ ...c, image: { modes: MODE_VALUES.filter(m => (m === mode ? e.target.checked : c.image.modes.includes(m))) } }))}
            />
            {' '}{name}
          </label>
        ))}
        <small style={{ display: 'block', color: '#666', marginTop: 4 }}>Display only: overlays hide in unchecked modes and reappear when you switch back, without repeating OCR.</small>
      </fieldset>

      <h2 style={{ fontSize: 15, marginTop: 24 }}>Translation range</h2>
      <label style={label}>
        Preload distance (pixels)
        <input style={field} type="number" min={0} max={10000} step={100} value={config.preload.margin} onChange={e => setLocal(c => ({ ...c, preload: { ...c.preload, margin: Number(e.target.value) } }))} />
        <small style={{ color: '#666' }}>How far below the screen to translate ahead. Smaller values reduce API costs. Changes apply when translation next starts.</small>
      </label>
      <label style={label}>
        Visibility threshold (0 to 1)
        <input style={field} type="number" min={0} max={1} step={0.1} value={config.preload.threshold} onChange={e => setLocal(c => ({ ...c, preload: { ...c.preload, threshold: Number(e.target.value) } }))} />
        <small style={{ color: '#666' }}>Visible fraction of a paragraph required to trigger translation; 0 triggers at the viewport edge.</small>
      </label>

      <p>
        <button type="button" onClick={save}>Save</button>
        {' '}
        <button type="button" onClick={testConnection} disabled={testing}>{testing ? 'Testing…' : 'Test connection (saved settings)'}</button>
        {' '}
        <span>{notice}</span>
      </p>
      {testResult && <p style={{ padding: 8, background: '#f4f4f4', borderRadius: 4 }}>{testResult}</p>}

      <h2 style={{ fontSize: 15, marginTop: 24 }}>Translation cache</h2>
      <p style={{ margin: '0 0 4px', fontSize: 13 }}>
        {cache !== null
          ? `${cache.entries} cached entries · ${(cache.bytes / 1024 / 1024).toFixed(2)} MB`
          : cacheError === '' ? 'Loading…' : `Could not read cache: ${cacheError}`}
      </p>
      <small style={{ display: 'block', color: '#666', marginBottom: 8 }}>
        Cache entries are separated by engine, model, prompt and glossary. Changing any of these prevents old translation hits, so manual clearing is usually unnecessary.
      </small>
      <p>
        <button type="button" onClick={clearCache}>Clear all cache</button>
        {' '}
        <span style={{ color: '#666', fontSize: 12 }}>{cacheNote}</span>
      </p>
    </main>
  )
}

/** Only registered endpoints receive thinking fields (thinking.ts); explain that other endpoints ignore this setting. */
function thinkingHint(baseURL: string): string {
  let host = ''
  try {
    host = new URL(baseURL).hostname
  } catch {
    return ''
  }
  return THINKING_HOSTS.includes(host)
    ? `Sends the thinking setting in the format required by ${host}`
    : `${host} is not registered (supported: ${THINKING_HOSTS.join(', ')}). No thinking field is sent; endpoint defaults apply.`
}

function originPattern(url: string): string | null {
  try {
    return `${new URL(url).origin}/*`
  } catch {
    return null
  }
}

/** Custom endpoints require host permission for their origin; Save supplies the user gesture. */
async function ensureHostPermission(baseURL: string) {
  const origin = originPattern(baseURL)
  if (!origin) throw new Error('Invalid Base URL')
  if (await browser.permissions.contains({ origins: [origin] })) return
  const granted = await browser.permissions.request({ origins: [origin] })
  if (!granted) throw new Error(`Access permission not granted for ${origin}`)
}

/** Revoke the previous origin when changing endpoints to avoid accumulating permissions; keep manifest-declared permissions (Codex #6). */
async function releaseHostPermission(previousURL: string, currentURL: string) {
  const previous = originPattern(previousURL)
  if (!previous || previous === originPattern(currentURL)) return
  if ((browser.runtime.getManifest().host_permissions ?? []).includes(previous)) return
  await browser.permissions.remove({ origins: [previous] }).catch(() => undefined)
}
