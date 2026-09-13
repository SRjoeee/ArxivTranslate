// The few reader-facing strings the core renders itself (the failure widget's button and hover sentence). The core
// knows no locale pack (ADR-0008): the host installs them — the extension's `ui/strings.ts` does so on every
// `setLocale` — and an English fallback stands until it does, so a host that never installs any still renders.
import type { ProviderErrorKind } from '@/providers/types'

export interface CoreStrings {
  /** The failure widget's button */
  retry: string
  /** The sentence shown on hovering a failed block, by the failure's kind; empty means “no sentence for it” */
  failureTitle: (kind: ProviderErrorKind) => string
}

let current: CoreStrings = { retry: 'Retry', failureTitle: () => '' }

export const coreStrings = (): CoreStrings => current

export function setCoreStrings(next: CoreStrings): void {
  current = next
}
