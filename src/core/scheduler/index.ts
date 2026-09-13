// Scheduling (DESIGN §10): one-shot viewport observers (translate what comes into view) + the session id + main-thread
// slicing + progress-event coalescing. Scroll anchoring is no longer needed: Chrome's native scroll anchoring
// (overflow-anchor: auto) compensates the scroll when content is inserted above the viewport anyway (measured: 600px
// inserted, anchor displacement 0); the ported JS anchoring forced two full-page layouts per batch, 130–150ms each in
// side mode, the main cause of the main thread being saturated during translation.
export { DEFAULT_PRELOAD, createLazyScheduler, type LazyScheduler, type PreloadOptions } from './lazy'
export { newSessionId } from './session'
export { translateTitle, type TitleTranslator } from './title'
export { createWorkPacer, pauseIfBudgetSpent, yieldToMain } from './pacer'
export { createCoalescer, type Coalescer, type CoalesceOptions } from './coalesce'
