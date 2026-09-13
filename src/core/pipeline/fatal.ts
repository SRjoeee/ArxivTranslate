// A failure reason is written as `kind: diagnostic` (run.ts, image/run.ts); this reads it back. In the core so the
// renderer's failure widget and the popup parse it the same way without either reaching into the locale layer.
import { PROVIDER_ERROR_KINDS, type ProviderErrorKind } from '@/providers/types'

const KINDS: ReadonlySet<string> = new Set(PROVIDER_ERROR_KINDS)

/** `kind: message` → its parts; an unrecognised prefix is `unknown` with the whole string as the message */
export function parseFatal(fatal: string): { kind: ProviderErrorKind; message: string } {
  const at = fatal.indexOf(': ')
  if (at > 0) {
    const kind = fatal.slice(0, at)
    if (KINDS.has(kind)) return { kind: kind as ProviderErrorKind, message: fatal.slice(at + 2) }
  }
  return { kind: 'unknown', message: fatal }
}
