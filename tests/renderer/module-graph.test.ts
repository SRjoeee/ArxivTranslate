// The renderer's module graph (ADR-0003): nothing inside the renderer imports the façade, and the
// sibling imports form no cycle. Both held only by convention before; `notes.ts` once had to build a
// selector inside a function body because reading a constant at module-initialisation time hit
// `undefined` on an `index ↔ notes` cycle.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const DIR = join(import.meta.dirname, '../../src/core/renderer')
const modules = readdirSync(DIR).filter(f => f.endsWith('.ts')).map(f => f.replace(/\.ts$/, ''))
const importsOf = (name: string): string[] =>
  Array.from(readFileSync(join(DIR, `${name}.ts`), 'utf8').matchAll(/from\s+'\.\/([a-z-]+)'/g), m => m[1]!)
const graph = new Map(modules.map(m => [m, importsOf(m)]))

describe('renderer module graph', () => {
  it('no module inside the renderer imports the façade', () => {
    const offenders = modules.filter(m => m !== 'index' && graph.get(m)!.includes('index'))
    expect(offenders).toEqual([])
  })

  it('every sibling import resolves to a module in the directory', () => {
    for (const [m, deps] of graph) for (const d of deps) expect(modules, `${m} imports ./${d}`).toContain(d)
  })

  it('the sibling-import graph has no cycle', () => {
    const state = new Map<string, 'visiting' | 'done'>()
    const stack: string[] = []
    const cycles: string[] = []
    const visit = (m: string) => {
      if (state.get(m) === 'done') return
      if (state.get(m) === 'visiting') {
        cycles.push([...stack.slice(stack.indexOf(m)), m].join(' → '))
        return
      }
      state.set(m, 'visiting')
      stack.push(m)
      for (const d of graph.get(m) ?? []) visit(d)
      stack.pop()
      state.set(m, 'done')
    }
    for (const m of modules) visit(m)
    expect(cycles).toEqual([])
  })

  it('attrs is a leaf: it imports nothing', () => {
    const src = readFileSync(join(DIR, 'attrs.ts'), 'utf8')
    expect(src).not.toMatch(/^import /m)
  })
})
