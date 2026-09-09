// Placeholder engine (DESIGN §6): serialize → translate → validate → rehydrate; free engines or validation failures use splitRuns / joinRuns.
export { VOID_DENSE_THRESHOLD, serialize, type ProtectedBlock } from './serialize'
export { PlaceholderIntegrityError, expectationsFromText, validate, type IntegrityReason, type PlaceholderExpectations, type ValidationResult } from './validate'
export { rehydrate } from './rehydrate'
export { joinRuns, splitRuns, type RunItem, type RunLayout } from './runs'
export { tokenize, type Token } from './tokens'
export { decodeText, escapeText } from './text'
