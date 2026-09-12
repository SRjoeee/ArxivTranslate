import type { Config } from '@/config/schema'
import { chainConfigChanged, type TranslationTransport } from '@/providers/transport'

export interface Built {
  config: Config
  transport: TranslationTransport
}

export interface ChainHolderDeps {
  /** Build the chain from a configuration, or from the stored one when none is given */
  load: (config?: Config) => Promise<Built>
}

/**
 * The chain in force — one per worker, shared by every tab (§8.2's cross-tab budget). Built lazily: the worker
 * is rebuilt on every wake-up, and probing the engines just to clear a cache is not worth it.
 *
 * Builds overlap: a rebuild can start while another is still probing engines. `current()` therefore answers
 * with the build in force **at the moment it resolves**, not the one in force when it was asked — a mover that
 * awaited a superseded build would move the sessions back onto it and retire the chain actually in force
 * (the local review of ADR-0005, sixth pass)
 */
export interface ChainHolder {
  current(): Promise<TranslationTransport>
  /** Rebuild and make the result the chain in force: the reader's explicit actions (`axt:engine-ready`) */
  activate(config?: Config): Promise<Built>
  /**
   * A configuration change. Only the fields that shape the chain rebuild it: the content script writes the
   * configuration on every display-mode switch, usually while a page is translating, and an indiscriminate
   * rebuild would clear the token bucket and the hand-over records with it (`chainConfigChanged` has the table).
   * A failed build is retried by the next change. Nothing happens before the first build — that one reads the
   * stored configuration itself
   */
  onConfig(next: Config): void
}

export function createChainHolder(deps: ChainHolderDeps): ChainHolder {
  let active: Promise<Built> | null = null
  const activate = (config?: Config): Promise<Built> => {
    active = deps.load(config)
    return active
  }
  return {
    activate,
    async current() {
      for (;;) {
        const promise = active ?? activate()
        const built = await promise
        if (promise === active) return built.transport
      }
    },
    onConfig(next) {
      if (!active) return
      active = active.then(
        built => (chainConfigChanged(built.config, next) ? deps.load(next) : { config: next, transport: built.transport }),
        () => deps.load(next),
      )
    },
  }
}
