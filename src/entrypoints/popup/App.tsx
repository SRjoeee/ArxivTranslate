import { useCallback, useEffect, useState } from 'react'
import { browser } from 'wxt/browser'
import type { BlockStats } from '@/core/extractor/stats'
import type { ProviderStatus } from '@/entrypoints/background/translate-handler'
import type { Mode } from '@/core/renderer'
import { sendMessage, sendToActiveTab, type PageStatus } from '@/shared/messages'

const scriptStart = performance.now()

// 翻译 / 恢复 / 进度 + provider 状态 + 模式切换（§7.2）；引擎在设置页选。
export function App() {
  const [ping, setPing] = useState('连接后台…')
  const [provider, setProvider] = useState<ProviderStatus | null>(null)
  const [page, setPage] = useState<PageStatus | null>(null)
  const [stats, setStats] = useState<BlockStats | null>(null)
  const [note, setNote] = useState('')

  const refresh = useCallback(() => {
    sendToActiveTab({ type: 'axt:page-status' }).then(setPage).catch(() => setPage(null))
  }, [])
  const loadStats = useCallback(() => {
    sendToActiveTab({ type: 'axt:stats' }).then(setStats).catch(() => setStats(null))
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
    sendMessage({ type: 'axt:provider-status' }).then(setProvider).catch(() => setProvider(null))
    loadStats()
    refresh()
  }, [refresh, loadStats])

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

  const canTranslate = !!page?.paper && !!provider?.available && !on
  const canRestore = !!page && page.progress.state !== 'idle'

  return (
    <main style={{ minWidth: 280, padding: 12, font: '13px system-ui, sans-serif' }}>
      <h1 style={{ fontSize: 14, margin: '0 0 8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        arXiv HTML Translator
        <button style={{ font: 'inherit', fontSize: 12 }} onClick={() => browser.runtime.openOptionsPage()}>设置</button>
      </h1>
      <p style={{ margin: '0 0 4px', color: '#666' }}>{ping}</p>
      <p style={{ margin: '0 0 8px', color: '#666' }}>
        {provider === null ? '引擎状态未知' : provider.available ? `引擎：${provider.providerId} · ${provider.model ?? ''}` : '未配置 API key，请先到设置页填写'}
      </p>

      {page === null
        ? <p style={{ margin: 0, color: '#666' }}>当前标签页不是 arXiv HTML 页面，或扩展更新后页面尚未刷新</p>
        : (
          <section>
            <p style={{ margin: '0 0 8px' }}>
              <button onClick={translate} disabled={!canTranslate}>{on ? '已开启' : '翻译'}</button>
              {' '}
              <button onClick={restorePage} disabled={!canRestore}>恢复原文</button>
            </p>
            <p style={{ margin: '0 0 8px', display: 'flex', gap: 4, alignItems: 'center' }}>
              <span style={{ color: '#666' }}>对照</span>
              {MODES.map(([m, label, title]) => (
                <button
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
            <ProgressLine page={page} />
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
      {p.fatal && <span style={{ color: '#b00' }}>｜{p.fatal}</span>}
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
