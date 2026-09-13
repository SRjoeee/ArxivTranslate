// Ported from reference/read-frog/src/types/config/translate.ts@9b44f82 (GPL-3.0), 2026-09-05, modified: only the
// request-queue fields and their lower bounds, not the whole config module; the batch-queue schema went with the
// hot-update setters (ADR-0001 §9), the batch limits are the provider's to set.
import { z } from 'zod'

export const MIN_TRANSLATE_RATE = 0.01
export const MIN_TRANSLATE_CAPACITY = 1

export const requestQueueConfigSchema = z.object({
  capacity: z.number().gte(MIN_TRANSLATE_CAPACITY),
  rate: z.number().gte(MIN_TRANSLATE_RATE),
  // Added in this project (issue #43): 0 / negative / NaN would make “in flight < cap” never hold and the queue would
  // stall for good; the total limit likewise — a non-positive one expires every task the moment it is enqueued (Codex on #56)
  maxConcurrent: z.number().int().positive().optional(),
  maxTotalMs: z.number().positive().optional(),
})
