// DOM-free 分词器：把带占位符的字符串切成四种 token，validate 与 rehydrate 共用，可在 service worker 里跑。
// 借鉴 Read Frog html-attribute-markers.ts 的思路（字符串级校验，不依赖 DOM），协议不同，未移植代码。

export type Token =
  | { kind: 'text'; text: string }
  | { kind: 'void'; id: number }
  | { kind: 'open'; id: number }
  | { kind: 'close' }

// 容忍模型常见写法：<x id="1"/>、<x id="1" />、单引号 / 无引号、<x id="1"></x>；其余一律当文本
const TOKEN_RE = /<x\s+id\s*=\s*(?:"(\d+)"|'(\d+)'|(\d+))\s*(?:\/>|>\s*<\/x\s*>)|<t\s+id\s*=\s*(?:"(\d+)"|'(\d+)'|(\d+))\s*>|<\/t\s*>/g

export function tokenize(s: string): Token[] {
  const out: Token[] = []
  let last = 0
  for (const m of s.matchAll(TOKEN_RE)) {
    const index = m.index ?? 0
    if (index > last) out.push({ kind: 'text', text: s.slice(last, index) })
    if (m[0].startsWith('</')) out.push({ kind: 'close' })
    else if (m[0].startsWith('<x')) out.push({ kind: 'void', id: Number(m[1] ?? m[2] ?? m[3]) })
    else out.push({ kind: 'open', id: Number(m[4] ?? m[5] ?? m[6]) })
    last = index + m[0].length
  }
  if (last < s.length) out.push({ kind: 'text', text: s.slice(last) })
  return out
}
