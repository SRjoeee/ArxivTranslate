// The renderer's public surface (ADR-0003): exactly what the content entry, the pipeline, the popup
// and the appearance UI use. Nothing inside `src/core/renderer/` imports this file — the module
// graph test keeps it that way — and tests import the module that defines what they test.
export type { BlockState, Mode } from './attrs'
export { STYLE_ATTR } from './attrs'
export { installAnchorFallback } from './anchors'
export { relabelFailed, renderFailed } from './failed'
export { type SentenceHighlight, startSentenceHighlight } from './highlight'
export { clearImageEverywhere, setImageModes } from './image'
export { clearMarginNotes } from './margin-notes'
export { type Look, appearanceSheet, applyStyle, enable, restore, setMode } from './page'
export { clearPairMargins } from './pair-margins'
export { clearAllPending, renderPending } from './pending'
export { createPrep } from './prep'
export { type ModeController, createModeController } from './responsive'
export { registerSentences } from './sentences'
export { OPACITY_MAX, OPACITY_MIN, sanitizeCustomCss } from './style-values'
export { markPartial, renderTable, renderText, setState } from './translation'
