// Busy → idle detection for one run (ADR-0006's follow-up). Translation has no end (§10): each transition from busy
// to idle traces one line, and the e2e suites read those lines (`session idle`, `images idle`). Each run keeps its
// own notion of busy — the text run counts requests in flight, the image run what is requested and not yet settled —
// and its own line; the detection is what they share.

export interface IdleTraceDeps {
  now: () => number
  trace: (line: string) => void
}

/** Feed it every progress report; it traces `line(progress, msSinceCreation)` once per busy → idle transition */
export function createIdleTrace<P>(deps: IdleTraceDeps, busy: (progress: P) => boolean, line: (progress: P, ms: number) => string): (progress: P) => void {
  const t1 = deps.now()
  let wasBusy = false
  return progress => {
    const isBusy = busy(progress)
    if (wasBusy && !isBusy) deps.trace(line(progress, Math.round(deps.now() - t1)))
    wasBusy = isBusy
  }
}
