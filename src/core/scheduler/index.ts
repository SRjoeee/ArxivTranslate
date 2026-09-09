// Scheduling (DESIGN §10): one-shot viewport observer + session ID + main-thread slicing + progress coalescing.
// JS scroll anchoring is unnecessary: Chrome's native overflow-anchor: auto compensates for insertions above the viewport
// (600 px inserted, 0 px anchor shift). Ported JS anchoring forced two full-page layouts per batch,
// each taking 130–150 ms in side mode, dominating main-thread time during translation.
export { DEFAULT_PRELOAD, createLazyScheduler, type LazyScheduler, type PreloadOptions } from './lazy'
export { beginSession, endSession, getSessionId } from './session'
export { translateTitle, type TitleTranslator } from './title'
export { createWorkPacer, pauseIfBudgetSpent, yieldToMain } from './pacer'
export { createCoalescer, type Coalescer, type CoalesceOptions } from './coalesce'
