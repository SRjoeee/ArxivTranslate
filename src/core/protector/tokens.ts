// DOM-free tokenizer: split placeholder text into four token types, shared by validate and rehydrate; usable in service workers.
// Inspired by Read Frog html-attribute-markers.ts (string validation without DOM); different protocol, no code ported.

export type Token =
  | { kind: 'text'; text: string }
  | { kind: 'void'; id: number }
  | { kind: 'open'; id: number }
  | { kind: 'close' }

// Accept common model variants: <x id="1"/>, <x id="1" />, single / unquoted IDs, <x id="1"></x>; treat everything else as text.
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
