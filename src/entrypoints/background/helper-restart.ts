// A permission granted while the background worker runs (ADR-0002). Chrome adds an API to a context when the context
// is created, never later: `runtime.connectNative` stays undefined in a worker that predates the grant (probe of
// 2026-09-13 — `permissions.remove` in a live worker left the function in place; the bindings code refreshes
// namespaces on a permission change, not objects already instantiated). The way out is a fresh worker: an alarm set
// past the idle limit wakes one once this worker has died, and the pages learn what it found. Nothing else restarts
// a worker without tearing the extension down (`runtime.reload` closes every extension page and orphans the content
// scripts of the papers being read).
import type { HelperStatus } from '@/shared/ocr'

export interface HelperRestartDeps {
  /** Re-probe from scratch (`recheck`) */
  probe: () => Promise<HelperStatus>
  /**
   * Set the alarm. It must fire after the worker's idle limit (30 s) — one that lands in the same worker is an event
   * that resets the limit, and the worker would never die
   */
  arm: () => void
  /** What the fresh worker found, for the pages (and the tabs, when ready) */
  announce: (status: HelperStatus) => void
  /**
   * Take down the subscriptions fed by activity that is not ours while this worker waits to be replaced: a tab
   * update from any tab is an event, and every event resets the idle timer — a tab whose title ticks would keep the
   * stale worker alive for good. The fresh worker registers them anew at start-up. Called on every stale answer,
   * so it has to be idempotent
   */
  quiesce?: () => void
}

export interface HelperRestart {
  /** A status was just answered: arm when it says this worker is stale */
  noticed(status: HelperStatus): void
  /** The alarm fired: probe again. A stale answer means this is still the old worker — arm again */
  fired(): Promise<void>
}

export function createHelperRestart(deps: HelperRestartDeps): HelperRestart {
  const stale = () => {
    deps.quiesce?.()
    deps.arm()
  }
  return {
    noticed(status) {
      if (status.state === 'restarting') stale()
    },
    async fired() {
      const status = await deps.probe()
      if (status.state === 'restarting') stale()
      else deps.announce(status)
    },
  }
}
