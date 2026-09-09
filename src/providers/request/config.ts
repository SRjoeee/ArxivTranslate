// Queue validation: keep only the four fields and lower bounds used by request-queue/batch-queue from Read Frog types/config/translate.ts,
// without importing its entire configuration module. Used by setQueueOptions/setBatchConfig hot updates.
import { z } from 'zod'

export const MIN_TRANSLATE_RATE = 0.01
export const MIN_TRANSLATE_CAPACITY = 1
export const MIN_BATCH_CHARACTERS = 1
export const MIN_BATCH_ITEMS = 1

export const requestQueueConfigSchema = z.object({
  capacity: z.number().gte(MIN_TRANSLATE_CAPACITY),
  rate: z.number().gte(MIN_TRANSLATE_RATE),
  // Project addition (issue #43): 0, negative or NaN limits make inFlight < limit permanently false and stall the queue.
  // Likewise, nonpositive total deadlines expire every task immediately on enqueue (Codex #56).
  maxConcurrent: z.number().int().positive().optional(),
  maxTotalMs: z.number().positive().optional(),
})

export const batchQueueConfigSchema = z.object({
  maxCharactersPerBatch: z.number().gte(MIN_BATCH_CHARACTERS),
  maxItemsPerBatch: z.number().gte(MIN_BATCH_ITEMS),
})

export type RequestQueueConfig = z.infer<typeof requestQueueConfigSchema>
export type BatchQueueConfig = z.infer<typeof batchQueueConfigSchema>
