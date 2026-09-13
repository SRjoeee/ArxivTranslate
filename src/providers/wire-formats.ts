// Which wire formats each engine keeps (DESIGN §8.5). **Pure data, importing no engine implementation** — the
// settings page must not drag the whole AI SDK into its bundle for the one question “does the sample use tags or
// markers” (measured: 43 kB reading from here, 276 kB through `getProvider(config).wireFormats`; Codex on #115).
//
// This is **the single source of truth**: the engine factories read it in turn instead of each writing literals, so nothing drifts.
import type { WireFormat } from '@/core/protector'
import { type BuiltInService, isBuiltInService } from '@/config/services'

export const WIRE_FORMATS: Record<BuiltInService | 'openai-compat', readonly WireFormat[]> = {
  'openai-compat': ['tags'],
  'google-web': ['tags', 'markers'],
  'chrome-builtin': ['tags'],
  microsoft: ['markers'],
}

/** The first-choice format this engine sends; the negotiation is `buildChain`'s, this only answers “what is the first choice” */
/** A reader's service id (svc-…) is the OpenAI-compatible kind; built-ins by their id */
export const wireFormatOfProvider = (provider: string): WireFormat => WIRE_FORMATS[isBuiltInService(provider) ? provider : 'openai-compat'][0] ?? 'tags'
