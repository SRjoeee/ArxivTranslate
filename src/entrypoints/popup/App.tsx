import { useEffect, useState } from 'react'
import { sendMessage } from '@/shared/messages'

// Phase 1 骨架：只显示与 background 的连通性；翻译控制在 Phase 2 起加入
export function App() {
  const [status, setStatus] = useState('连接后台…')
  useEffect(() => {
    sendMessage({ type: 'axt:ping' })
      .then(r => setStatus(`后台已连接 v${r.version}`))
      .catch(e => setStatus(`后台未响应：${String(e)}`))
  }, [])
  return (
    <main style={{ minWidth: 240, padding: 12, font: '13px system-ui, sans-serif' }}>
      <h1 style={{ fontSize: 14, margin: '0 0 8px' }}>arXiv HTML Translator</h1>
      <p style={{ margin: 0 }}>{status}</p>
    </main>
  )
}
