// The guided install's wait (DESIGN §15.4, issue #102).
//
// Once the reader has pasted the install command into a terminal, no event tells the extension “installed”: the
// install script writes the native host manifest on disk, and Chrome reads it only at the moment of `connectNative`.
// So this probes on a timer.
//
// **Why the reader is not given an “I have installed it” button**: that step pushes a question the program can answer
// itself onto the reader, who is most likely still in the terminal when pressing it — the popup is destroyed the
// moment it loses focus, and they would first have to remember to come back to the extension.
//
// Two MV3 constraints shape it:
// - `setTimeout` **cannot** keep the service worker from being reclaimed; only messages and extension API calls
//   reset the idle timer. Every round here calls `connectNative` (the probe is itself an API call), and a 2-second
//   round is far under the 30-second idle line, so no separate keep-alive is needed — the in-flight keep-alive of
//   helper.ts is for “one request taking tens of seconds”, a different shape.
// - the worker may still be reclaimed for other reasons (the browser reclaiming memory, the extension reloaded). The
//   deadline is therefore written to session storage, and the next worker picks up a wait not yet expired; session
//   rather than local storage: once the browser is closed, this install need not be waited for any more.
import type { HelperStatus } from '@/shared/ocr'

/** The probe interval. The install script itself runs for tens of seconds; this granularity only sets the delay between “installed” and “the page starts translating” */
const DEFAULT_POLL_MS = 2_000
/**
 * How long to wait at most. Past it the reader is most likely no longer installing (the command was not run, failed,
 * or they changed their mind), and probing on would only occupy the worker — the “not detected yet” line in the interface appears after this point too
 */
const DEFAULT_WINDOW_MS = 180_000

export interface HelperWaitDeps {
  /** Probe once more (`recheck` clears the “not installed” record, see HelperClient.status) */
  probe: () => Promise<HelperStatus>
  /** Found: send the message to every tab so the parked bitmaps are released; what a page receives is the status itself */
  announce: (status: HelperStatus) => void | Promise<void>
  now: () => number
  schedule: (run: () => void, ms: number) => number
  cancel: (id: number) => void
  /** Reading and writing the deadline; the wait is picked up by it after the worker was reclaimed */
  load: () => Promise<number | undefined>
  save: (deadline: number | undefined) => Promise<void>
  pollMs?: number
  windowMs?: number
  /** A note when a probe throws; the wait is not interrupted */
  warn?: (message: string, error: unknown) => void
}

export interface HelperWaiter {
  /**
   * Start waiting. **Idempotent**: already waiting, only the deadline is pushed back to a full window — a second copy
   * usually means the first paste did not take, and the reader is owed a full window then, not the one about to expire
   */
  start: () => Promise<void>
  /** The worker just started: a wait in storage not yet expired is picked up */
  resume: () => Promise<void>
  /**
   * This wait's deadline; null when never waited. **It may be past** — then a wait happened and found nothing, and
   * the interface says “not detected yet” after a reopen. Cleared only on a find or a restart
   */
  until: () => number | null
  /** Stop and clear the stored deadline */
  stop: () => Promise<void>
}

export function createHelperWaiter(deps: HelperWaitDeps): HelperWaiter {
  const pollMs = deps.pollMs ?? DEFAULT_POLL_MS
  const windowMs = deps.windowMs ?? DEFAULT_WINDOW_MS
  let deadline: number | null = null
  let timer: number | null = null
  /** No second round while one probe is still out: `connectNative` fails fast, but not guaranteed faster than pollMs */
  let probing = false

  const disarm = () => {
    if (timer !== null) deps.cancel(timer)
    timer = null
  }

  /** The end for good: found, or withdrawn from outside */
  const clear = async (): Promise<void> => {
    disarm()
    deadline = null
    await deps.save(undefined)
  }

  const arm = () => {
    if (timer !== null) return
    timer = deps.schedule(() => {
      timer = null
      void tick()
    }, pollMs)
  }

  const tick = async (): Promise<void> => {
    if (deadline === null) return
    if (deps.now() >= deadline) {
      // At the deadline the rounds stop, but **the expired deadline is kept**: the reader is most likely still in the
      // terminal, and when they come back and reopen the popup the interface has to tell “waited, found nothing” from
      // “never started” — cleared, both are null, and the “not detected yet” line would never appear (Codex on #166)
      disarm()
      return
    }
    // **The next round is scheduled first, then the probe**: scheduled after the probe, one probe hanging would stop the
    // wait silently — no timer left, nobody checking at the deadline. Now the rounds' rhythm and the probes' speed are independent
    arm()
    if (probing) return
    probing = true
    try {
      const status = await deps.probe()
      if (status.state === 'ready') {
        await clear()
        await deps.announce(status)
      } else if (status.state === 'permission-missing') {
        // Nothing can be found without the permission (ADR-0002): this wait is over. The pages ask for the permission
        // before they show the install command, so this only catches a grant withdrawn meanwhile
        await clear()
      } else if (status.state === 'restarting') {
        // This worker cannot connect (it predates the grant). The fresh one the alarm wakes resumes the wait from
        // the deadline in storage, so stop the rounds here — probing would keep this worker alive — but keep the deadline
        disarm()
      }
    } catch (error) {
      // A probe failing on its own (the port just closed, the worker shutting down) must not end the wait: next round
      deps.warn?.('[axt] recognition helper probe failed', error)
    } finally {
      probing = false
    }
  }

  return {
    async start() {
      deadline = deps.now() + windowMs
      await deps.save(deadline)
      arm()
    },
    async resume() {
      if (deadline !== null) return
      const saved = await deps.load()
      // **Judged once more after the read**: the guard is written before the await, and while storage was read the
      // reader may have clicked copy. That click is the newer, explicit action and must not be overwritten by the value
      // read back (an expired one, even) — overwritten, a fresh install would show as timed out from the start (Codex on #166)
      if (deadline !== null || saved === undefined) return
      // An expired one is taken up too, but not probed: the interface relies on it to say “not detected yet”.
      // session storage empties when the browser closes, so it takes no room for long
      deadline = saved
      if (saved > deps.now()) arm()
    },
    until: () => deadline,
    stop: clear,
  }
}
