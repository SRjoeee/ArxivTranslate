import { extract } from '@/core/extractor'
import { rangesOf, serialize } from '@/core/protector'
;(globalThis as unknown as Record<string, unknown>).__axtProbe = { extract, serialize, rangesOf }
