// DOM-free 分词器：把带占位符的字符串切成四种 token，validate / rehydrate / splitRuns 共用，可在 service worker 里跑。
// 借鉴 Read Frog html-attribute-markers.ts 的思路（字符串级校验，不依赖 DOM），协议不同，未移植代码。
//
// 两种线上格式（DESIGN §6.1）：
// - `tags`：`<x id="1"/>` / `<t id="1">…</t>`。表达力全，LLM 与 Google 都保得住内联样式。
// - `markers`：`@a#`，纯文本、只有 void。给那些会把标签撕烂的免费引擎用——实测微软 Edge 端点
//   在 tags 上 0%（400 个占位符全丢），在 markers 上 98% 块 / 99.3% 记号；Google 两种都 ~99%。
//   成对记号实测只有 70.6%，不可用，所以这个格式下成对占位符一律拍平（丢内联样式，不丢内容）。

export type WireFormat = 'tags' | 'markers'

export type Token =
  | { kind: 'text'; text: string }
  | { kind: 'void'; id: number }
  | { kind: 'open'; id: number }
  | { kind: 'close' }

// 容忍模型常见写法：<x id="1"/>、<x id="1" />、单引号 / 无引号、<x id="1"></x>；其余一律当文本
const TAG_RE = /<x\s+id\s*=\s*(?:"(\d+)"|'(\d+)'|(\d+))\s*(?:\/>|>\s*<\/x\s*>)|<t\s+id\s*=\s*(?:"(\d+)"|'(\d+)'|(\d+))\s*>|<\/t\s*>/g

// `@@` 是字面 `@` 的转义（见 text.ts 的 escapeText），必须排在记号之前匹配，否则 `@@a#` 会被读成记号
const MARKER_RE = /@@|@([a-z]+)#/g

/** id → 双射二十六进制字母（1→a、26→z、27→aa）。用字母而不是数字：MT 引擎会把数字重排、合并、加千分位 */
export function toAlpha(id: number): string {
  let n = id
  let out = ''
  while (n > 0) {
    const r = (n - 1) % 26
    out = String.fromCharCode(97 + r) + out
    n = (n - 1 - r) / 26
  }
  return out
}

export function fromAlpha(s: string): number {
  let n = 0
  for (let i = 0; i < s.length; i++) n = n * 26 + (s.charCodeAt(i) - 96)
  return n
}

export function tokenize(s: string, format: WireFormat = 'tags'): Token[] {
  const out: Token[] = []
  let last = 0
  const push = (t: Token) => {
    // 合并相邻文本：`@@` 的反转义会在真文本中间切出碎片，下游按节点比对时不该看出差别
    const prev = out[out.length - 1]
    if (t.kind === 'text' && prev?.kind === 'text') prev.text += t.text
    else out.push(t)
  }
  const re = format === 'markers' ? MARKER_RE : TAG_RE
  re.lastIndex = 0
  for (const m of s.matchAll(re)) {
    const index = m.index ?? 0
    if (index > last) push({ kind: 'text', text: s.slice(last, index) })
    if (format === 'markers') {
      if (m[0] === '@@') push({ kind: 'text', text: '@' })
      else push({ kind: 'void', id: fromAlpha(m[1]!) })
    } else if (m[0].startsWith('</')) push({ kind: 'close' })
    else if (m[0].startsWith('<x')) push({ kind: 'void', id: Number(m[1] ?? m[2] ?? m[3]) })
    else push({ kind: 'open', id: Number(m[4] ?? m[5] ?? m[6]) })
    last = index + m[0].length
  }
  if (last < s.length) push({ kind: 'text', text: s.slice(last) })
  return out
}

/** 写出一个 void 占位符 */
export function writeVoid(id: number, format: WireFormat): string {
  return format === 'markers' ? `@${toAlpha(id)}#` : `<x id="${id}"/>`
}
