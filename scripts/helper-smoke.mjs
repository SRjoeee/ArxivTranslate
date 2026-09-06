// helper 的冒烟测试（DESIGN §15）：按 Chrome Native Messaging 的帧格式（4 字节本机字节序长度 + JSON）
// 与二进制对话——ping 取版本，再把参考图送去 OCR，检查识别出的行、置信度与归一化坐标。
// 只在 Mac 上有意义；CI 没有 helper，不进 pnpm test。
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const BIN = process.env.AXT_HELPER ?? ['release', 'debug'].map(c => join(ROOT, 'helper/.build', c, 'axt-helper')).find(existsSync)
const FIXTURE = join(ROOT, 'helper/Tests/Fixtures/qed3d-string-breaking.png')
// 参考图里确定存在的词；Vision 按行返回，图里换行的标签（"Dynamical / charge"）是两行，合并是扩展侧的事，这里只按词查
const EXPECTED = ['Dynamical', 'charge', 'Static', 'Electric', 'membrane', 'Plaquette', 'deformation', 'Processes', 'Production', 'networks']

if (!BIN) {
  console.error('没有找到 helper 二进制，先跑 pnpm helper:build')
  process.exit(2)
}

const child = spawn(BIN, [], { stdio: ['pipe', 'pipe', 'inherit'] })
let buffer = Buffer.alloc(0)
const waiters = []
child.stdout.on('data', chunk => {
  buffer = Buffer.concat([buffer, chunk])
  while (buffer.length >= 4) {
    const length = buffer.readUInt32LE(0)
    if (buffer.length < 4 + length) break
    const message = JSON.parse(buffer.subarray(4, 4 + length).toString('utf8'))
    buffer = buffer.subarray(4 + length)
    waiters.shift()?.(message)
  }
})

function send(message) {
  const json = Buffer.from(JSON.stringify(message), 'utf8')
  const header = Buffer.alloc(4)
  header.writeUInt32LE(json.length, 0)
  child.stdin.write(Buffer.concat([header, json]))
  return new Promise(resolve => waiters.push(resolve))
}

let failed = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failed++
}

const t0 = performance.now()
const ping = await send({ v: 1, cmd: 'ping', id: 'p1' })
check('ping 回版本', ping.ok === true && typeof ping.version === 'string' && ping.id === 'p1', JSON.stringify(ping))

const image = readFileSync(FIXTURE).toString('base64')
const t1 = performance.now()
const res = await send({ v: 1, cmd: 'ocr', id: 'o1', image })
const ms = Math.round(performance.now() - t1)
check('ocr 回图的尺寸', res.width === 579 && res.height === 699 && res.id === 'o1', `${res.width}×${res.height}，${ms} ms`)
const lines = res.lines ?? []
check('识别出至少 12 行', lines.length >= 12, `${lines.length} 行`)
const texts = lines.map(l => l.text)
const missing = EXPECTED.filter(e => !texts.some(t => t.includes(e)))
check('关键标签都在', missing.length === 0, missing.length ? `缺 ${missing.join(' / ')}` : texts.slice(0, 8).join(' | '))
// 全部行倒出来（文字、置信度、左上与右下），给扩展侧设计合并规则用
for (const l of lines) console.log(`  ${l.conf.toFixed(2)}  (${l.quad[0][0].toFixed(3)}, ${l.quad[0][1].toFixed(3)})–(${l.quad[2][0].toFixed(3)}, ${l.quad[2][1].toFixed(3)})  ${JSON.stringify(l.text)}`)
const inRange = lines.every(l => l.quad.length === 4 && l.quad.every(([x, y]) => x >= 0 && x <= 1 && y >= 0 && y <= 1) && l.conf >= 0 && l.conf <= 1)
check('四角坐标与置信度都在 [0, 1]', inRange)
// 左上原点：标题 "Processes" 在图的上部，quad 的 y 应该小
const processes = lines.find(l => l.text.includes('Processes'))
check('y 轴已翻成左上原点', !!processes && processes.quad[0][1] < 0.15, processes ? `Processes 的左上 y = ${processes.quad[0][1].toFixed(3)}` : '')

// AXT_SMOKE_DUMP=<path>：把原始结果存成 JSON（tests/fixtures/ocr/ 里的 fixture 就是这么来的，给合并 / 过滤规则的单测用真数据）
if (process.env.AXT_SMOKE_DUMP) {
  const { writeFileSync, mkdirSync } = await import('node:fs')
  const { dirname } = await import('node:path')
  mkdirSync(dirname(process.env.AXT_SMOKE_DUMP), { recursive: true })
  writeFileSync(process.env.AXT_SMOKE_DUMP, `${JSON.stringify({ width: res.width, height: res.height, lines }, null, 1)}\n`)
  console.log(`已存 ${process.env.AXT_SMOKE_DUMP}`)
}

// 同一进程第二次识别：首次要加载 Vision 的模型，之后才是稳态耗时
const t2 = performance.now()
const again = await send({ v: 1, cmd: 'ocr', id: 'o1b', image })
const ms2 = Math.round(performance.now() - t2)
check('第二次识别结果一致', (again.lines ?? []).length === lines.length, `${ms2} ms（首次 ${ms} ms）`)

// EXIF 方向（Codex 在 #87 指出）：同一张图存成像素转了 90°、方向位为 6 的 JPEG，浏览器显示与 PNG 相同，
// helper 报的尺寸与坐标也必须与 PNG 那次一致（Vision 按转正后的图归一化）
const jpeg = readFileSync(join(ROOT, 'helper/Tests/Fixtures/qed3d-string-breaking-exif6.jpg')).toString('base64')
const exif = await send({ v: 1, cmd: 'ocr', id: 'o3', image: jpeg })
check('EXIF 方向 6 的 JPEG：尺寸按显示方向报', exif.width === 579 && exif.height === 699, `${exif.width}×${exif.height}`)
const near = (a, b) => Math.abs(a - b) < 0.02
const pairs = ['Processes', 'Static charge', 'Odd sites'].map(word => [lines.find(l => l.text.includes(word)), (exif.lines ?? []).find(l => l.text.includes(word))])
const aligned = pairs.every(([a, b]) => a && b && near(a.quad[0][0], b.quad[0][0]) && near(a.quad[0][1], b.quad[0][1]) && near(a.quad[2][0], b.quad[2][0]) && near(a.quad[2][1], b.quad[2][1]))
check('EXIF 方向 6 的 JPEG：坐标与 PNG 一致（±0.02）', aligned, pairs.map(([a, b]) => `${a?.text}: png (${a?.quad[0].map(v => v.toFixed(3))}) jpg (${b?.quad[0].map(v => v.toFixed(3)) ?? '缺'})`).join('; '))

const bad = await send({ v: 1, cmd: 'ocr', id: 'o2', image: '!!!' })
check('坏 base64 回错误信封而不是崩', bad.error?.code === 'bad-base64' && bad.id === 'o2', JSON.stringify(bad.error))
const unknown = await send({ v: 1, cmd: 'nope', id: 'u1' })
check('未知命令回 bad-request', unknown.error?.code === 'bad-request')

child.stdin.end()
await new Promise(resolve => child.on('close', resolve))
console.log(`${failed === 0 ? '全部通过' : `${failed} 项失败`}；总耗时 ${Math.round(performance.now() - t0)} ms`)
process.exit(failed === 0 ? 0 : 1)
