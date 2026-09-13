// The recognition helper's guided install (UI.md S-O-27, DESIGN §15.4). The popup and the settings page **share this
// one component**: both have the same thing to say, and two versions would only drift apart.
//
// Two steps: open a terminal, run the command. **No third step** — the old “I have installed it” button pushed a
// question the program can answer itself onto the reader, who is most likely still in the terminal when pressing it.
// After the copy the background probes on a timer, broadcasts on detection, and the figures waiting on the page start translating of themselves (§15.4).
//
// The waiting state lives in the background, not here: the popup is destroyed the moment it loses focus, so this
// component is gone the instant the reader switches to the terminal; on reopening, one `axt:helper-await` question picks the same wait up again.
import { useEffect, useState } from 'react'
import { browser } from 'wxt/browser'
import { sendMessage } from '@/shared/messages'
import type { HelperStatus } from '@/shared/ocr'
import { HELPER_GUIDE_URL, S, helperInstallCommand } from '@/ui/strings'

/** How long “Copied” stays: long enough to read, not so long it looks stuck */
const COPIED_MS = 1500

export function HelperSetup({ extensionId }: { extensionId: string }) {
  const [copied, setCopied] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)
  /** Until when to wait; null when not waiting. Comes from the background, not this component's state */
  const [until, setUntil] = useState<number | null>(null)
  /** This window ran out without a detection */
  const [timedOut, setTimedOut] = useState(false)
  const command = helperInstallCommand(extensionId)

  // Ask once on mount: the reader may have copied, switched to the terminal, and come back to reopen (the popup is destroyed on losing focus)
  useEffect(() => {
    let alive = true
    void sendMessage({ type: 'axt:helper-await' })
      .then(({ until: deadline }) => { if (alive) setUntil(deadline) })
      .catch(() => undefined)
    return () => { alive = false }
  }, [])

  // Say so once this window has run out. The deadline the background gave, not a local timer:
  // after a reopen, how much is left is its call
  useEffect(() => {
    if (until === null) return
    setTimedOut(false)
    const left = until - Date.now()
    if (left <= 0) { setTimedOut(true); return }
    const timer = setTimeout(() => setTimedOut(true), left)
    return () => clearTimeout(timer)
  }, [until])

  // The background broadcasts the state it finds (`axt:helper-state`); the page's data layer takes it and this
  // component is replaced by the ready state. What is left to do here is to stop the wait line at once — the reader may see
  // the frame before the parent re-renders
  useEffect(() => {
    const onState = (message: unknown) => {
      const m = message as { type?: string; status?: HelperStatus } | null
      if (m?.type === 'axt:helper-state' && m.status?.state === 'ready') setUntil(null)
    }
    browser.runtime.onMessage.addListener(onState)
    return () => browser.runtime.onMessage.removeListener(onState)
  }, [])

  /**
   * Say “Copied” only after the write succeeded. Said regardless with the clipboard blocked, the reader would in
   * fact hold nothing, and this is the one step of the whole install left hanging (Codex on #161)
   */
  const copy = async () => {
    // Copying starts the wait: the reader is about to switch to the terminal, and this component is gone by then.
    // **It starts with the clipboard blocked too** — that path's hint says to select the command and copy it by hand; the
    // reader does, installs, and nobody is probing: the figures waiting on the page wait forever, and the confirm button is gone (Codex on #166)
    const beginWaiting = () => void sendMessage({ type: 'axt:helper-await', start: true })
      .then(({ until: deadline }) => setUntil(deadline))
      .catch(() => undefined)
    try {
      await navigator.clipboard.writeText(command)
    } catch {
      setCopyFailed(true)
      beginWaiting()
      return
    }
    setCopyFailed(false)
    setCopied(true)
    setTimeout(() => setCopied(false), COPIED_MS)
    beginWaiting()
  }

  return (
    <div className="flex min-w-0 flex-col gap-2.5">
      <p className="text-[13px] font-semibold text-fg">{S.setup.title}</p>
      <p className="text-[12px] leading-relaxed text-fg-2">{S.setup.intro}</p>

      <Step n={1} title={S.setup.step1} hint={S.setup.step1Hint} />

      <Step n={2} title={S.setup.step2} hint={copyFailed ? S.setup.copyFailed : copied ? S.helper.copied : S.setup.step2Hint}>
        {/* The whole command is one button: it is the first thing the reader will click. **Wrapped, not scrolled
            sideways** — this is a `curl | bash`, and with the end out of sight there is no telling whether to run it.
            `select-all` makes ⌘A land on the command rather than the whole page */}
        <button
          type="button"
          onClick={() => void copy()}
          title={S.helper.copy}
          className="flex w-full cursor-pointer items-start gap-2 rounded-control bg-bg px-3 py-2.5 text-left font-mono text-[11px] leading-relaxed text-fg ring-1 ring-line"
        >
          <span aria-hidden="true" className="shrink-0 text-fg-2">$</span>
          <code className="min-w-0 flex-1 select-all break-all whitespace-pre-wrap">{command}</code>
        </button>
      </Step>

      {/* This line is the crux of the whole flow: it replaces the “I have installed it” button, and by it the reader knows
          they may walk away. Waiting and timed out are two wordings in one place, no change of interface — the reader
          need not compare progress across two places. **Nothing is said before the copy**: step two's hint already says “Click to copy”, and saying it again is noise */}
      {(until !== null || timedOut) && (
        <p role="status" className={`text-[11px] leading-relaxed ${timedOut ? 'text-accent' : 'text-fg-2'}`}>
          {timedOut ? S.setup.notYet : S.setup.waiting}
        </p>
      )}

      <a className="self-start text-[12px] font-semibold text-fg-2 hover:text-fg" href={HELPER_GUIDE_URL} target="_blank" rel="noreferrer">{S.helper.guide}</a>
    </div>
  )
}

/** A numbered step: the number is a column of its own, so the title and the control below it line up */
function Step({ n, title, hint, children }: { n: number; title: string; hint: string; children?: React.ReactNode }) {
  return (
    <div className="flex gap-2.5">
      <span aria-hidden="true" className="mt-px flex size-[18px] shrink-0 items-center justify-center rounded-full bg-control text-[11px] font-semibold text-fg-2">{n}</span>
      <span className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="text-[12px] font-semibold text-fg">{title}</span>
        <span className="text-[11px] leading-relaxed text-fg-2">{hint}</span>
        {children}
      </span>
    </div>
  )
}
