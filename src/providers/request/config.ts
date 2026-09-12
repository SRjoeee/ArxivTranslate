// Ported from reference/read-frog/src/types/config/translate.ts@9b44f82 (GPL-3.0), 2026-09-05, modified: only the
// four fields and lower bounds request-queue / batch-queue read, not the whole config module. Also used by the
// setQueueOptions / setBatchConfig hot-update entry points.
import { z } from 'zod'

export const MIN_TRANSLATE_RATE = 0.01
export const MIN_TRANSLATE_CAPACITY = 1
export const MIN_BATCH_CHARACTERS = 1
export const MIN_BATCH_ITEMS = 1

export const requestQueueConfigSchema = z.object({
  capacity: z.number().gte(MIN_TRANSLATE_CAPACITY),
  rate: z.number().gte(MIN_TRANSLATE_RATE),
  // 本项目新增（issue #43）：0 / 负数 / NaN 会让「在飞数 < 上限」永远不成立，队列直接卡死；
  // 总时限同理，非正数等于每个任务一入队就过期（Codex 在 #56 指出）
  maxConcurrent: z.number().int().positive().optional(),
  maxTotalMs: z.number().positive().optional(),
})

export const batchQueueConfigSchema = z.object({
  maxCharactersPerBatch: z.number().gte(MIN_BATCH_CHARACTERS),
  maxItemsPerBatch: z.number().gte(MIN_BATCH_ITEMS),
})

export type RequestQueueConfig = z.infer<typeof requestQueueConfigSchema>
export type BatchQueueConfig = z.infer<typeof batchQueueConfigSchema>
