// 翻译流水线：content 侧把 extract → 视口触发 → 批次 → translate-service → validate → rehydrate → render 串起来（§4、§10）
export { paperIdFromUrl } from './paper'
export { planBatches, sectionTitles, type Batch, type Segment } from './batches'
export { startTranslation, type Progress, type RunOptions, type Transport, type TranslationRun } from './run'
