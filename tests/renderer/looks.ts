// The renderer's appearance input, for tests: the shipped defaults plus a helper that edits the
// active style the way the settings page does.
import { BUILT_IN_HIGHLIGHTS, BUILT_IN_STYLES, type Look, type StyleProfile } from '@/config/appearance'

export const LOOK: Look = { style: BUILT_IN_STYLES[0]!, highlight: BUILT_IN_HIGHLIGHTS[0]! }

export const lookWith = (over: Partial<StyleProfile>, highlight = BUILT_IN_HIGHLIGHTS[0]!): Look =>
  ({ style: { ...BUILT_IN_STYLES[0]!, ...over }, highlight })
