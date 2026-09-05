import { useCallback, useEffect, useState } from 'react'
import { browser } from 'wxt/browser'
import type { BlockStats } from '@/core/extractor/stats'
import type { ProviderStatus } from '@/entrypoints/background/translate-handler'
import type { Mode } from '@/core/renderer'
import { getConfig, setConfig } from '@/config/storage'
import type { Config } from '@/config/schema'
import { BUILTIN_SOURCE_LANGUAGE } from '@/providers/chrome-builtin'
import { BUILT_IN_PROMPTS } from '@/providers/prompt-library'
import { toBcp47 } from '@/config/languages'
import { sendMessage, sendToActiveTab, type PageStatus } from '@/shared/messages'

const scriptStart = performance.now()

// 翻译 / 恢复 / 进度 + provider 状态 + 模式切换（§7.2）；引擎在设置页选。
export function App() {
  const [ping, setPing] = useState('连接后台…')
  const [provider, setProvider] = useState<ProviderStatus | null>(null)
  const [page, setPage] = useState<PageStatus | null>(null)
  const [stats, setStats] = useState<BlockStats | null>(null)
  const [note, setNote] = useState('')
  const [config, setLocalConfig] = useState<Config | null>(null)
  /** Chrome 内置翻译的语言包状态（§8.4）：downloadable 时要在点击处理函数里 create() 才有用户手势 */
  const [pack, setPack] = useState<'unsupported' | 'available' | 'downloadable' | 'downloading' | 'unavailable' | null>(null)
  const [packNote, setPackNote] = useState('')

  const refresh = useCallback(() => {
    sendToActiveTab({ type: 'axt:page-status' }).then(setPage).catch(() => setPage(null))
  }, [])
  const loadStats = useCallback(() => {
    sendToActiveTab({ type: 'axt:stats' }).then(setStats).catch(() => setStats(null))
  }, [])
  /** 引擎可用性。语言包下载完、设置改过之后都要重查，否则"翻译"按钮停在挂载时的旧状态 */
  const loadProvider = useCallback(() => {
    sendMessage({ type: 'axt:provider-status' }).then(setProvider).catch(() => setProvider(null))
  }, [])
  /** 语言包状态（§8.4）：popup 是扩展页面，Translator 在这里同样可用，不必绕 content script */
  const checkPack = useCallback(async (target: string) => {
    const api = (globalThis as { Translator?: { availability(o: { sourceLanguage: string; targetLanguage: string }): Promise<string> } }).Translator
    if (!api) return setPack('unsupported')
    try {
      const state = await api.availability({ sourceLanguage: BUILTIN_SOURCE_LANGUAGE, targetLanguage: toBcp47(target) })
      setPack(state as 'available' | 'downloadable' | 'downloading' | 'unavailable')
    } catch {
      setPack('unavailable')
    }
  }, [])

  useEffect(() => {
    console.debug(`[axt] popup mounted ${Math.round(performance.now() - scriptStart)} ms after script start`)
    const t0 = performance.now()
    sendMessage({ type: 'axt:ping' })
      .then(r => {
        setPing(`后台已连接 v${r.version}`)
        console.debug(`[axt] ping round-trip ${Math.round(performance.now() - t0)} ms`)
      })
      .catch(e => setPing(`后台未响应：${String(e)}`))
    loadProvider()
    getConfig().then(config => {
      setLocalConfig(config)
      void checkPack(config.targetLanguage)
    }).catch(() => setLocalConfig(null))
    loadStats()
    refresh()
  }, [refresh, loadStats, checkPack, loadProvider])

  // 页面还在加载时 content script 尚未注入（document_idle），首问会"没有接收方"；
  // 隔 500 ms 再问几次，别一开就判定"不是 arXiv 页面"（Codex 在 #3 指出）
  useEffect(() => {
    if (page !== null) return
    let attempts = 0
    const id = setInterval(() => {
      if (++attempts > 6) {
        clearInterval(id)
        return
      }
      refresh()
      loadStats()
    }, 500)
    return () => clearInterval(id)
  }, [page, refresh, loadStats])

  // 翻译开着时每 500 ms 轮询进度：滚动会继续触发，没有"翻完"的终点（§10）
  const on = page?.progress.state === 'on'
  useEffect(() => {
    if (!on) return
    const id = setInterval(refresh, 500)
    return () => clearInterval(id)
  }, [on, refresh])

  async function translate() {
    setNote('')
    try {
      const r = await sendToActiveTab({ type: 'axt:translate-page' })
      if (!r.started) setNote(r.reason ?? '无法开始')
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e))
    }
    refresh()
  }

  const MODES: [Mode, string, string][] = [
    ['stack', '上下', '译文紧跟原文，任何宽度都能用'],
    ['side', '左右', '需要较宽的窗口；窄了自动退回上下'],
    ['only', '仅译文', '隐藏原文，参考文献仍保持双语'],
  ]

  async function chooseMode(mode: Mode) {
    setNote('')
    try {
      const r = await sendToActiveTab({ type: 'axt:set-mode', mode })
      if (r.mode !== r.preference) setNote(`窗口偏窄，已按上下对照显示（选的是${MODES.find(([m]) => m === r.preference)?.[1] ?? r.preference}）`)
      refresh()
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e))
    }
  }

  async function retryFailed() {
    setNote('')
    try {
      const r = await sendToActiveTab({ type: 'axt:retry-failed' })
      setNote(`已重新提交 ${r.retried} 块`)
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e))
    }
    refresh()
  }

  /**
   * 提示词切换（对应 Read Frog popup 的 translate-prompt-selector）：立即落盘，下次点"翻译"生效。
   * 只改 prompts，其余字段以**此刻存着的**为准：切换对照模式是 content script 写的配置，popup 挂载时的快照已经过期，
   * 整个写回会把模式改回去（Codex 在 #39 指出）
   */
  async function choosePrompt(promptId: string) {
    try {
      const latest = await getConfig()
      const next = { ...latest, prompts: { ...latest.prompts, promptId } }
      setLocalConfig(next)
      await setConfig(next)
      if (on) setNote('提示词已保存，恢复原文后再点"翻译"生效')
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e))
    }
  }

  /**
   * 下载语言包。**必须由点击直接触发**：availability 是 downloadable 时无手势 create() 抛 NotAllowedError（RESEARCH §6.1）。
   * 首次下载期间 availability() 一直是 downloadable、monitor 也没有进度事件（实测 67 s），所以只给不确定态提示
   */
  async function downloadPack() {
    if (!config) return
    const api = (globalThis as { Translator?: { create(o: { sourceLanguage: string; targetLanguage: string }): Promise<unknown> } }).Translator
    if (!api) return
    setPack('downloading')
    setPackNote('正在下载语言包，首次约需 1 分钟…')
    try {
      await api.create({ sourceLanguage: BUILTIN_SOURCE_LANGUAGE, targetLanguage: toBcp47(config.targetLanguage) })
      setPackNote('已就绪，可以直接点"翻译"')
      await checkPack(config.targetLanguage)
      // 重查引擎可用性：不查的话"翻译"按钮会停在下载前的状态，要关掉 popup 再开一次才可点
      loadProvider()
    } catch (e) {
      setPackNote(`下载失败：${e instanceof Error ? e.message : String(e)}`)
      await checkPack(config.targetLanguage)
    }
  }

  async function restorePage() {
    setNote('')
    try {
      const r = await sendToActiveTab({ type: 'axt:restore-page' })
      setNote(`已恢复原文（移除 ${r.removedNodes} 个译文节点）`)
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e))
    }
    refresh()
  }

  // 首选引擎不可用但链上有兜底时照样能翻（§8.5）：不看 fallback 的话会出现「有 Google 兜底、按钮却是灰的」
  const canTranslate = !!page?.paper && (!!provider?.available || !!provider?.fallback) && !on
  const canRestore = !!page && page.progress.state !== 'idle'

  return (
    <main style={{ minWidth: 280, padding: 12, font: '13px system-ui, sans-serif' }}>
      <h1 style={{ fontSize: 14, margin: '0 0 8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        arXiv HTML Translator
        <button type="button" style={{ font: 'inherit', fontSize: 12 }} onClick={() => browser.runtime.openOptionsPage()}>设置</button>
      </h1>
      <p style={{ margin: '0 0 4px', color: '#666' }}>{ping}</p>
      <p style={{ margin: '0 0 8px', color: '#666' }}>
        {provider === null
          ? '引擎状态未知'
          : provider.available
            ? `引擎：${provider.providerId} · ${provider.model ?? ''}`
            : provider.fallback
              ? `${provider.providerId} 不可用，将使用${provider.fallback.displayName}`
              : provider.providerId === 'chrome-builtin'
                ? '内置翻译的语言包还没准备好，点下面的按钮下载'
                : '未配置 API key，请先到设置页填写'}
      </p>

      {page === null
        ? <p style={{ margin: 0, color: '#666' }}>当前标签页不是 arXiv HTML 页面，或扩展更新后页面尚未刷新</p>
        : (
          <section>
            <p style={{ margin: '0 0 8px' }}>
              <button type="button" onClick={translate} disabled={!canTranslate}>{on ? '已开启' : '翻译'}</button>
              {' '}
              <button type="button" onClick={restorePage} disabled={!canRestore}>恢复原文</button>
            </p>
            <p style={{ margin: '0 0 8px', display: 'flex', gap: 4, alignItems: 'center' }}>
              <span style={{ color: '#666' }}>对照</span>
              {MODES.map(([m, label, title]) => (
                <button
                  type="button"
                  key={m}
                  title={title}
                  onClick={() => chooseMode(m)}
                  aria-pressed={page.preference === m}
                  style={{ font: 'inherit', fontWeight: page.preference === m ? 700 : 400 }}
                >
                  {label}
                </button>
              ))}
            </p>
            {config?.provider === 'openai-compat' && (
              <p style={{ margin: '0 0 8px', display: 'flex', gap: 4, alignItems: 'center' }}>
                <span style={{ color: '#666' }}>提示词</span>
                <select style={{ font: 'inherit', fontSize: 12, flex: 1 }} value={config.prompts.promptId} onChange={e => choosePrompt(e.target.value)}>
                  {Object.values(BUILT_IN_PROMPTS).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  {config.prompts.patterns.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </p>
            )}
            {page.engine?.demoted && (
              <p style={{ margin: '0 0 8px', padding: 6, background: '#fff4e5', borderRadius: 4, fontSize: 12, lineHeight: 1.5 }}>
                {page.engine.demoted.displayName}不可用（{page.engine.demoted.kind}），已降级到{page.engine.displayName}。
                译文质量不如 LLM；修好设置后恢复原文再翻即可切回
              </p>
            )}
            {(pack === 'downloadable' || pack === 'downloading' || packNote) && (
              <p style={{ margin: '0 0 8px', fontSize: 12, color: '#666' }}>
                {pack === 'downloadable' && (
                  <button type="button" style={{ font: 'inherit', fontSize: 12 }} onClick={downloadPack}>下载离线语言包</button>
                )}
                {pack === 'downloading' && <span>正在下载…</span>}
                {packNote && <span style={{ display: 'block', marginTop: 4 }}>{packNote}</span>}
              </p>
            )}
            <ProgressLine page={page} />
            {page.progress.failed > 0 && page.progress.state !== 'idle' && (
              <p style={{ margin: '6px 0 0' }}>
                <button type="button" style={{ font: 'inherit', fontSize: 12 }} onClick={retryFailed}>重试失败的 {page.progress.failed} 块</button>
              </p>
            )}
          </section>
        )}
      {note && <p style={{ margin: '8px 0 0', color: '#b00' }}>{note}</p>}
      {stats && <StatsLine stats={stats} />}
    </main>
  )
}

function ProgressLine({ page }: { page: PageStatus }) {
  const p = page.progress
  // 看到哪翻到哪（§10）：显示"已翻 / 已进入视口（共多少）"，翻译是开着的状态，没有"翻完"
  const counts = `已翻 ${p.done} / 已触发 ${p.requested}（共 ${p.total}）${p.failed ? `，失败 ${p.failed}` : ''}${p.cached ? `，缓存命中 ${p.cached}` : ''}`
  const text = p.state === 'idle' ? '未翻译'
    : p.state === 'on' ? `${counts}${p.inFlight > 0 ? ' · 翻译中…' : ' · 就绪，滚动继续翻'}`
    : `已停止：${counts}`
  return (
    <p style={{ margin: 0 }}>
      {text}
      {p.fatal && <span style={{ color: '#b00' }}>｜{p.fatal}。修好配置后点"翻译"继续</span>}
    </p>
  )
}

function StatsLine({ stats }: { stats: BlockStats }) {
  return (
    <p style={{ margin: '8px 0 0', color: '#666', fontSize: 12 }}>
      块 {stats.total}（文本 {stats.text}，表格 {stats.table}；单元格 {stats.cells}，数值格 {stats.numericCells}）
    </p>
  )
}
