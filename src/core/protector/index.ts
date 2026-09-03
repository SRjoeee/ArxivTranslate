// 占位符引擎（DESIGN §6）：serialize → 翻译 → validate → rehydrate；免费引擎或校验失败走 splitRuns / joinRuns。
export { VOID_DENSE_THRESHOLD, serialize, type ProtectedBlock } from './serialize'
export { PlaceholderIntegrityError, validate, type IntegrityReason, type ValidationResult } from './validate'
export { rehydrate } from './rehydrate'
export { joinRuns, splitRuns, type RunItem, type RunLayout } from './runs'
export { tokenize, type Token } from './tokens'
export { decodeText, escapeText } from './text'
