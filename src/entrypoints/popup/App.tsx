import { useEffect, useState } from 'react'
import type { BlockStats } from '@/core/extractor/stats'
import { sendMessage, sendToActiveTab } from '@/shared/messages'

const scriptStart = performance.now()

// Phase 1：连通性 + 当前页面的块统计（来自 content script 内存中的 Block[]）。翻译控制从 Phase 2 起加入。
export function App() {
  const [ping, setPing] = useState('连接后台…')
  const [stats, setStats] = useState<BlockStats | null>(null)
  const [statsError, setStatsError] = useState<string | null>(null)

  useEffect(() => {
    // 两行计时：回答"点图标卡一下"——首帧到挂载、background 冷启动往返
    console.debug(`[axt] popup mounted ${Math.round(performance.now() - scriptStart)} ms after script start`)
    const t0 = performance.now()
    sendMessage({ type: 'axt:ping' })
      .then(r => {
        setPing(`后台已连接 v${r.version}`)
        console.debug(`[axt] ping round-trip ${Math.round(performance.now() - t0)} ms`)
      })
      .catch(e => setPing(`后台未响应：${String(e)}`))
    sendToActiveTab({ type: 'axt:stats' })
      .then(setStats)
      .catch(() => setStatsError('当前标签页不是 arXiv HTML 页面，或扩展更新后页面尚未刷新'))
  }, [])

  return (
    <main style={{ minWidth: 260, padding: 12, font: '13px system-ui, sans-serif' }}>
      <h1 style={{ fontSize: 14, margin: '0 0 8px' }}>arXiv HTML Translator</h1>
      <p style={{ margin: '0 0 8px' }}>{ping}</p>
      {stats && <StatsView stats={stats} />}
      {statsError && <p style={{ margin: 0, color: '#666' }}>{statsError}</p>}
    </main>
  )
}

function StatsView({ stats }: { stats: BlockStats }) {
  const units = Object.entries(stats.byUnit).sort((a, b) => b[1] - a[1])
  return (
    <section>
      <p style={{ margin: '0 0 4px' }}>
        块 {stats.total}（文本 {stats.text}，表格 {stats.table}；单元格 {stats.cells}，数值格 {stats.numericCells}）
      </p>
      <table style={{ borderCollapse: 'collapse' }}>
        <tbody>
          {units.map(([unit, n]) => (
            <tr key={unit}>
              <td style={{ paddingRight: 12 }}>{unit}</td>
              <td style={{ textAlign: 'right' }}>{n}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
