// Helper smoke test (DESIGN §15): communicate with the binary using Chrome Native Messaging frames (4-byte native-endian length + JSON).
// Ping for version, then OCR the reference image and check recognized lines, confidence and normalized coordinates.
// Mac-only; excluded from pnpm test because CI has no helper.
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const BIN = process.env.AXT_HELPER ?? ['release', 'debug'].map(c => join(ROOT, 'helper/.build', c, 'axt-helper')).find(existsSync)
const FIXTURE = join(ROOT, 'helper/Tests/Fixtures/qed3d-string-breaking.png')
// Known words in the reference image. Vision returns lines, so "Dynamical / charge" spans two; merging belongs to the extension. Check words only here.
const EXPECTED = ['Dynamical', 'charge', 'Static', 'Electric', 'membrane', 'Plaquette', 'deformation', 'Processes', 'Production', 'networks']

if (!BIN) {
  console.error('Helper binary not found; run pnpm helper:build first')
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

function send(message, { split = false } = {}) {
  const json = Buffer.from(JSON.stringify(message), 'utf8')
  const header = Buffer.alloc(4)
  header.writeUInt32LE(json.length, 0)
  if (split) {
    // Simulate a short pipe read: split the length prefix across two writes separated by a brief delay (Codex #87).
    child.stdin.write(header.subarray(0, 1))
    setTimeout(() => { child.stdin.write(header.subarray(1)); child.stdin.write(json) }, 30)
  } else child.stdin.write(Buffer.concat([header, json]))
  return new Promise(resolve => waiters.push(resolve))
}

let failed = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failed++
}

const t0 = performance.now()
const ping = await send({ v: 1, cmd: 'ping', id: 'p1' })
check('ping returns version including Vision revision', ping.ok === true && /^\d+\.\d+\.\d+\+vision\d+$/.test(ping.version ?? '') && ping.id === 'p1', JSON.stringify(ping))

const image = readFileSync(FIXTURE).toString('base64')
const t1 = performance.now()
const res = await send({ v: 1, cmd: 'ocr', id: 'o1', image })
const ms = Math.round(performance.now() - t1)
check('ocr returns image dimensions', res.width === 579 && res.height === 699 && res.id === 'o1', `${res.width}×${res.height}, ${ms} ms`)
const lines = res.lines ?? []
check('recognizes at least 12 lines', lines.length >= 12, `${lines.length} lines`)
const texts = lines.map(l => l.text)
const missing = EXPECTED.filter(e => !texts.some(t => t.includes(e)))
check('all key labels present', missing.length === 0, missing.length ? `missing ${missing.join(' / ')}` : texts.slice(0, 8).join(' | '))
// Dump all text/confidence/top-left/bottom-right values to support extension-side merge-rule design.
for (const l of lines) console.log(`  ${l.conf.toFixed(2)}  (${l.quad[0][0].toFixed(3)}, ${l.quad[0][1].toFixed(3)})–(${l.quad[2][0].toFixed(3)}, ${l.quad[2][1].toFixed(3)})  ${JSON.stringify(l.text)}`)
const inRange = lines.every(l => l.quad.length === 4 && l.quad.every(([x, y]) => x >= 0 && x <= 1 && y >= 0 && y <= 1) && l.conf >= 0 && l.conf <= 1)
check('corner coordinates and confidence are within [0, 1]', inRange)
// Top-left origin: "Processes" is near the top, so its quad y should be small.
const processes = lines.find(l => l.text.includes('Processes'))
check('y axis uses top-left origin', !!processes && processes.quad[0][1] < 0.15, processes ? `Processes top-left y = ${processes.quad[0][1].toFixed(3)}` : '')

// AXT_SMOKE_DUMP=<path>: save raw JSON (the source of tests/fixtures/ocr/ data for merge/filter unit tests).
if (process.env.AXT_SMOKE_DUMP) {
  const { writeFileSync, mkdirSync } = await import('node:fs')
  const { dirname } = await import('node:path')
  mkdirSync(dirname(process.env.AXT_SMOKE_DUMP), { recursive: true })
  writeFileSync(process.env.AXT_SMOKE_DUMP, `${JSON.stringify({ width: res.width, height: res.height, lines }, null, 1)}\n`)
  console.log(`Saved ${process.env.AXT_SMOKE_DUMP}`)
}

// Repeat OCR in the same process: first use loads the Vision model; later calls measure steady-state time.
const t2 = performance.now()
const again = await send({ v: 1, cmd: 'ocr', id: 'o1b', image })
const ms2 = Math.round(performance.now() - t2)
check('second recognition has the same result count', (again.lines ?? []).length === lines.length, `${ms2} ms (first ${ms} ms)`)

// EXIF orientation (Codex #87): a JPEG with pixels rotated 90° and orientation 6 displays like the PNG in browsers.
// Helper dimensions/coordinates must match the PNG too, since Vision normalizes against the upright image.
const jpeg = readFileSync(join(ROOT, 'helper/Tests/Fixtures/qed3d-string-breaking-exif6.jpg')).toString('base64')
const exif = await send({ v: 1, cmd: 'ocr', id: 'o3', image: jpeg })
check('EXIF orientation 6 JPEG reports display dimensions', exif.width === 579 && exif.height === 699, `${exif.width}×${exif.height}`)
const near = (a, b) => Math.abs(a - b) < 0.02
const pairs = ['Processes', 'Static charge', 'Odd sites'].map(word => [lines.find(l => l.text.includes(word)), (exif.lines ?? []).find(l => l.text.includes(word))])
const aligned = pairs.every(([a, b]) => a && b && near(a.quad[0][0], b.quad[0][0]) && near(a.quad[0][1], b.quad[0][1]) && near(a.quad[2][0], b.quad[2][0]) && near(a.quad[2][1], b.quad[2][1]))
check('EXIF orientation 6 JPEG coordinates match PNG (±0.02)', aligned, pairs.map(([a, b]) => `${a?.text}: png (${a?.quad[0].map(v => v.toFixed(3))}) jpg (${b?.quad[0].map(v => v.toFixed(3)) ?? 'missing'})`).join('; '))

const shortRead = await send({ v: 1, cmd: 'ping', id: 'p2' }, { split: true })
check('reads the full length prefix across short reads', shortRead.ok === true && shortRead.id === 'p2')

// Animated images: helper recognizes frame 0 only and must report frame count so the extension can skip overlays (Codex #89).
const gif = readFileSync(join(ROOT, 'helper/Tests/Fixtures/two-frames.gif')).toString('base64')
const animated = await send({ v: 1, cmd: 'ocr', id: 'g1', image: gif })
check('two-frame GIF reports frames: 2', animated.frames === 2 && animated.id === 'g1', `frames=${animated.frames}`)
check('static PNG reports frames: 1', res.frames === 1)

const bad = await send({ v: 1, cmd: 'ocr', id: 'o2', image: '!!!' })
check('invalid base64 returns an error envelope without crashing', bad.error?.code === 'bad-base64' && bad.id === 'o2', JSON.stringify(bad.error))
const unknown = await send({ v: 1, cmd: 'nope', id: 'u1' })
check('unknown command returns bad-request', unknown.error?.code === 'bad-request')
const wrongV = await send({ v: 2, cmd: 'ping', id: 'v2' })
check('protocol mismatch returns unsupported-protocol', wrongV.error?.code === 'unsupported-protocol' && wrongV.id === 'v2', JSON.stringify(wrongV.error))
const noV = await send({ cmd: 'ping', id: 'v0' })
check('missing protocol version is rejected', noV.error?.code === 'unsupported-protocol')

child.stdin.end()
await new Promise(resolve => child.on('close', resolve))
console.log(`${failed === 0 ? 'All passed' : `${failed} checks failed`}; total ${Math.round(performance.now() - t0)} ms`)
process.exit(failed === 0 ? 0 : 1)
