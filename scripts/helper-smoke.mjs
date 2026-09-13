// The helper's smoke test (DESIGN §15): talks to the binary in Chrome Native Messaging's frame format (a 4-byte native-endian
// length + JSON) — ping for the version, then send the reference image to OCR and check the recognised lines, confidences and normalised coordinates.
// Meaningful on a Mac only; CI has no helper, so it is not part of pnpm test.
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const BIN = process.env.AXT_HELPER ?? ['release', 'debug'].map(c => join(ROOT, 'helper/.build', c, 'axt-helper')).find(existsSync)
const FIXTURE = join(ROOT, 'helper/Tests/Fixtures/qed3d-string-breaking.png')
// Words known to be in the reference image; Vision returns by line, and a label wrapped in the image ("Dynamical / charge") is two lines — merging is the extension's job, so only words are looked up here
const EXPECTED = ['Dynamical', 'charge', 'Static', 'Electric', 'membrane', 'Plaquette', 'deformation', 'Processes', 'Production', 'networks']

if (!BIN) {
  console.error('helper binary not found; run pnpm helper:build first')
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
    // Imitates a pipe's short read: the length prefix written in two parts with a beat in between (the case Codex raised on #87)
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
check('ping returns the version with the Vision revision', ping.ok === true && /^\d+\.\d+\.\d+\+vision\d+$/.test(ping.version ?? '') && ping.id === 'p1', JSON.stringify(ping))

const image = readFileSync(FIXTURE).toString('base64')
const t1 = performance.now()
const res = await send({ v: 1, cmd: 'ocr', id: 'o1', image })
const ms = Math.round(performance.now() - t1)
check('ocr returns the image size', res.width === 579 && res.height === 699 && res.id === 'o1', `${res.width}×${res.height}, ${ms} ms`)
const lines = res.lines ?? []
check('at least 12 lines recognised', lines.length >= 12, `${lines.length} lines`)
const texts = lines.map(l => l.text)
const missing = EXPECTED.filter(e => !texts.some(t => t.includes(e)))
check('every key label present', missing.length === 0, missing.length ? `missing ${missing.join(' / ')}` : texts.slice(0, 8).join(' | '))
// Dump every line (text, confidence, top-left and bottom-right) for designing the extension side's merge rules
for (const l of lines) console.log(`  ${l.conf.toFixed(2)}  (${l.quad[0][0].toFixed(3)}, ${l.quad[0][1].toFixed(3)})–(${l.quad[2][0].toFixed(3)}, ${l.quad[2][1].toFixed(3)})  ${JSON.stringify(l.text)}`)
const inRange = lines.every(l => l.quad.length === 4 && l.quad.every(([x, y]) => x >= 0 && x <= 1 && y >= 0 && y <= 1) && l.conf >= 0 && l.conf <= 1)
check('corner coordinates and confidences all in [0, 1]', inRange)
// Top-left origin: the heading "Processes" is in the upper part of the image, so the quad's y should be small
const processes = lines.find(l => l.text.includes('Processes'))
check('the y axis is flipped to a top-left origin', !!processes && processes.quad[0][1] < 0.15, processes ? `top-left y of Processes = ${processes.quad[0][1].toFixed(3)}` : '')

// AXT_SMOKE_DUMP=<path>: save the raw result as JSON (the fixtures in tests/fixtures/ocr/ came from this, giving the merge / filter unit tests real data)
if (process.env.AXT_SMOKE_DUMP) {
  const { writeFileSync, mkdirSync } = await import('node:fs')
  const { dirname } = await import('node:path')
  mkdirSync(dirname(process.env.AXT_SMOKE_DUMP), { recursive: true })
  writeFileSync(process.env.AXT_SMOKE_DUMP, `${JSON.stringify({ width: res.width, height: res.height, lines }, null, 1)}\n`)
  console.log(`saved ${process.env.AXT_SMOKE_DUMP}`)
}

// A second recognition in the same process: the first has to load Vision's model, only then is the timing steady state
const t2 = performance.now()
const again = await send({ v: 1, cmd: 'ocr', id: 'o1b', image })
const ms2 = Math.round(performance.now() - t2)
check('the second recognition agrees', (again.lines ?? []).length === lines.length, `${ms2} ms (first ${ms} ms)`)

// EXIF orientation (Codex on #87): the same image stored as a JPEG with the pixels rotated 90° and orientation 6 displays the same as the PNG in a browser,
// and the size and coordinates the helper reports must agree with the PNG run (Vision normalises by the upright image)
const jpeg = readFileSync(join(ROOT, 'helper/Tests/Fixtures/qed3d-string-breaking-exif6.jpg')).toString('base64')
const exif = await send({ v: 1, cmd: 'ocr', id: 'o3', image: jpeg })
check('a JPEG with EXIF orientation 6: the size is reported in display orientation', exif.width === 579 && exif.height === 699, `${exif.width}×${exif.height}`)
const near = (a, b) => Math.abs(a - b) < 0.02
const pairs = ['Processes', 'Static charge', 'Odd sites'].map(word => [lines.find(l => l.text.includes(word)), (exif.lines ?? []).find(l => l.text.includes(word))])
const aligned = pairs.every(([a, b]) => a && b && near(a.quad[0][0], b.quad[0][0]) && near(a.quad[0][1], b.quad[0][1]) && near(a.quad[2][0], b.quad[2][0]) && near(a.quad[2][1], b.quad[2][1]))
check('a JPEG with EXIF orientation 6: coordinates agree with the PNG (±0.02)', aligned, pairs.map(([a, b]) => `${a?.text}: png (${a?.quad[0].map(v => v.toFixed(3))}) jpg (${b?.quad[0].map(v => v.toFixed(3)) ?? 'missing'})`).join('; '))

const shortRead = await send({ v: 1, cmd: 'ping', id: 'p2' }, { split: true })
check('a length prefix arriving in two parts (a short read) is still read in full', shortRead.ok === true && shortRead.id === 'p2')

// Animations: the helper recognises frame 0 only, so the frame count has to be reported for the extension to skip them (Codex on #89)
const gif = readFileSync(join(ROOT, 'helper/Tests/Fixtures/two-frames.gif')).toString('base64')
const animated = await send({ v: 1, cmd: 'ocr', id: 'g1', image: gif })
check('a two-frame GIF reports frames: 2', animated.frames === 2 && animated.id === 'g1', `frames=${animated.frames}`)
check('a static PNG reports frames: 1', res.frames === 1)

const bad = await send({ v: 1, cmd: 'ocr', id: 'o2', image: '!!!' })
check('bad base64 gets an error envelope rather than a crash', bad.error?.code === 'bad-base64' && bad.id === 'o2', JSON.stringify(bad.error))
const unknown = await send({ v: 1, cmd: 'nope', id: 'u1' })
check('an unknown command gets bad-request', unknown.error?.code === 'bad-request')
const wrongV = await send({ v: 2, cmd: 'ping', id: 'v2' })
check('a protocol version mismatch gets unsupported-protocol', wrongV.error?.code === 'unsupported-protocol' && wrongV.id === 'v2', JSON.stringify(wrongV.error))
const noV = await send({ cmd: 'ping', id: 'v0' })
check('a missing protocol version is refused too', noV.error?.code === 'unsupported-protocol')

child.stdin.end()
await new Promise(resolve => child.on('close', resolve))
console.log(`${failed === 0 ? 'all passed' : `${failed} failed`}; total ${Math.round(performance.now() - t0)} ms`)
process.exit(failed === 0 ? 0 : 1)
