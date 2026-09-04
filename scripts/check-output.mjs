// 构建产物体检：Chrome 加载 content script 前会做严格的 UTF-8 校验，
// 文件里出现 Unicode 非字符（U+FFFF 等）就整个扩展拒绝加载，报 "It isn't UTF-8 encoded"。
// 2026-09-04 踩过：content 侧误引入 @/cache/index 把 Dexie 打进包，Dexie 用 "￿" 作键区间上界。
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const OUT = '.output/chrome-mv3'
const CONTENT_DIR = join(OUT, 'content-scripts')

const isNoncharacter = code =>
  (code >= 0xd800 && code <= 0xdfff) || (code >= 0xfdd0 && code <= 0xfdef) || (code & 0xfffe) === 0xfffe || code === 0xfeff

function scan(path) {
  const bytes = readFileSync(path)
  const problems = []
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) problems.push('文件以 BOM 开头')
  let text
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    problems.push('不是合法的 UTF-8')
    return problems
  }
  const found = new Set()
  for (const ch of text) if (isNoncharacter(ch.codePointAt(0))) found.add(`U+${ch.codePointAt(0).toString(16).toUpperCase()}`)
  if (found.size > 0) problems.push(`含 Unicode 非字符 ${[...found].join(', ')}，Chrome 会拒绝加载`)
  return problems
}

let failed = false
for (const name of readdirSync(CONTENT_DIR)) {
  const path = join(CONTENT_DIR, name)
  if (!statSync(path).isFile()) continue
  const problems = scan(path)
  if (problems.length > 0) {
    failed = true
    console.error(`✗ ${path}\n  ${problems.join('\n  ')}`)
  } else {
    console.log(`✓ ${path}`)
  }
}
if (failed) {
  console.error('\ncontent script 无法被 Chrome 加载。常见原因：content 侧引入了只应在 background 使用的模块（如 @/cache 的 Dexie 实现）。')
  process.exit(1)
}
