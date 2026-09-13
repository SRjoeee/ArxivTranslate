// The translation pipeline: the content side chaining extract → viewport trigger → batches → translate-service → validate → rehydrate → render (§4, §10)
export { paperIdFromUrl } from './paper'
export { planBatches, sectionTitles, type Batch, type Segment } from './batches'
export { startTranslation, type Progress, type RunOptions, type Transport, type TranslationRun } from './run'
