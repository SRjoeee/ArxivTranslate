import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isTranslatable } from '@/core/image'
import { looksLikeCode, runsOf } from '@/core/svg'

const FIXTURE_DIR = join(import.meta.dirname, '../fixtures/svg')
const svgOf = (name: string) =>
  new DOMParser().parseFromString(readFileSync(join(FIXTURE_DIR, name), 'utf8'), 'image/svg+xml').documentElement

/** Everything the two fixtures produce that gets past `isTranslatable`, split by what it is. */
const PROSE = [
  'closure',
  'dense',
  'wall time per epoch [ms]',
  'No sanitization forwidth',
  'Pythonto C',
  'Python',
]

const CODE = [
  '1   iflog_counting == 8:',
  '2       self.cms = cmsc.CMS_Log8(width=self.width, depth=self.depth)',
  '1   staticint',
  '2   CMS_VARIANT(_init)(CMS_TYPE*self, PyObject*args, PyObject*kwds){',
  'staticchar*kwlist[] = {"width", "depth", NULL};',
  'uint32_tw;',
  'if(!PyArg_ParseTupleAndKeywords(args, kwds, "II", kwlist,',
  '&w, &self->depth)) {',
  'return-1;}',
  'if(self->depth  < 1 || self->depth > 32) {',
  'char* msg = "Depth must be in the range 1-16";',
  'PyErr_SetString(PyExc_ValueError, msg);}',
  'shortinthash_length = -1;',
  'while(0 != w)',
  'hash_length++, w >>= 1;',
  'if(hash_length < 0)',
  'hash_length = 0;',
  'self->width = 1 << hash_length;',
  'self->hash_mask = self->width -1;',
  'HyperLogLog_init(&self->hll, 16);',
  'self->table = (CMS_CELL_TYPE**) malloc(self->depth * ',
  'sizeof(CMS_CELL_TYPE*));',
  'inti;',
  'for(i = 0; i < self->depth; i++){',
  'self->table[i] = (CMS_CELL_TYPE*)calloc(self->width, ',
  'sizeof(CMS_CELL_TYPE));}',
  'return0;}',
]

describe('what to translate in a figure (#121)', () => {
  it('keeps every label the fixtures draw', () => {
    // `wall time per epoch [ms]` is the one that matters: its brackets are a unit, so the brace
    // rule must not count `[]`
    expect(PROSE.filter(looksLikeCode)).toEqual([])
  })

  it('rejects every source line the fixtures draw', () => {
    expect(CODE.filter(t => !looksLikeCode(t))).toEqual([])
  })

  it('the two lists are exactly what the fixtures produce, nothing invented', () => {
    // Otherwise the corpus above could drift away from the figures it claims to describe and the
    // two tests would go on passing against a fiction
    const seen: string[] = []
    for (const name of ['2609.03768-fig_closure.svg', '2608.29808-bounter-case.svg']) {
      for (const run of runsOf(svgOf(name))) if (isTranslatable(run.text)) seen.push(run.text)
    }
    expect([...seen].sort()).toEqual([...PROSE, ...CODE].sort())
  })

  it('leaves prose that merely mentions punctuation alone', () => {
    for (const text of ['Energy (GeV)', 'Accuracy [%]', 'Fig. 3: results', 'p < 0.05', 'x-axis, log scale', 'Time (s) vs. depth']) {
      expect([text, looksLikeCode(text)]).toEqual([text, false])
    }
  })

  it('catches code that has no punctuation of its own', () => {
    // `int i;` with the space dropped, and a listing gutter that merged into its line
    expect(looksLikeCode('inti;')).toBe(true)
    expect(looksLikeCode('1   staticint')).toBe(true)
  })
})
