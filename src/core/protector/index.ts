// The placeholder engine (DESIGN §6): serialize → translate → validate → rehydrate; a free engine, or a failed validation, goes through splitRuns / joinRuns.
export { VOID_DENSE_THRESHOLD, serialize, type ProtectedBlock } from './serialize'
export { PlaceholderIntegrityError, expectationsFromText, validate, type IntegrityReason, type PlaceholderExpectations, type ValidationResult } from './validate'
export { rehydrate } from './rehydrate'
export { joinRuns, splitRuns, type RunItem, type RunLayout } from './runs'
export { fromAlpha, toAlpha, tokenize, writeVoid, type Token, type WireFormat } from './tokens'
export { decodeText, escapeText, unescapeText } from './text'
export { MARKER_RE, TAG_RE } from './tokens'
export { indexSpans, nodeOffsetAt, rangesOf, scanTokens, spanAt, wireOffsetAt, type PositionedToken, type SpanIndex, type WireSpan } from './offsets'
