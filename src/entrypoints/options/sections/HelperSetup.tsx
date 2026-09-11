// The guided install for the recognition helper (UI.md S-O-30…36). The popup can only afford one
// line and a copy button; this is the page that can walk the reader through it, so the whole thing
// happens here: open Terminal, copy one command, come back and press a button that looks again.
//
// The looking-again is the part that needs the background's help. Once Chrome answers "no such
// native messaging host", the worker remembers it and stops trying — right while nothing changes,
// wrong the moment the reader installs. `recheck` forgets that memory for one probe.
import { useState } from 'react'
import { sendMessage } from '@/shared/messages'
import type { HelperStatus } from '@/shared/ocr'
import { Button } from '@/ui/Button'
import { HELPER_GUIDE_URL, S, helperInstallCommand } from '@/ui/strings'

/** How long 已复制 stays up: long enough to read, short enough not to look stuck */
const COPIED_MS = 1500

export function HelperSetup({ extensionId, onStatus }: { extensionId: string; onStatus: (status: HelperStatus) => void }) {
  const [copied, setCopied] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)
  const [checking, setChecking] = useState(false)
  /** Set once a check has come back empty-handed; cleared when another one starts */
  const [notYet, setNotYet] = useState(false)
  const command = helperInstallCommand(extensionId)

  /**
   * Only after the write lands. A blocked clipboard would otherwise say 已复制 while the reader has
   * nothing to paste, and this is the one step the whole install hangs on (Codex on #161)
   */
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command)
    } catch {
      setCopyFailed(true)
      return
    }
    setCopyFailed(false)
    setCopied(true)
    setTimeout(() => setCopied(false), COPIED_MS)
  }

  const check = async () => {
    setChecking(true)
    setNotYet(false)
    try {
      const status = await sendMessage({ type: 'axt:helper-status', recheck: true })
      onStatus(status)
      // Only say "not yet" while it is still not there: on success the card is replaced by the
      // ready line above, and a stale message under it would contradict what the reader just did
      if (!status.available) setNotYet(true)
    } catch {
      setNotYet(true)
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="flex flex-col gap-3 py-1">
      <p className="text-[13px] font-semibold text-fg">{S.setup.title}</p>
      <p className="text-[12px] leading-relaxed text-fg-2">{S.setup.intro}</p>

      <Step n={1} title={S.setup.step1} hint={S.setup.step1Hint} />

      <Step n={2} title={S.setup.step2} hint={copyFailed ? S.setup.copyFailed : copied ? S.helper.copied : S.setup.step2Hint}>
        {/* The command is a button: the whole block copies, which is what a reader reaches for
            first. It **wraps rather than scrolls** — this is a `curl | bash`, and a reader who
            cannot see the end of the line has no way to decide whether to run it. `select-all` so
            ⌘A inside it still picks only the command */}
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

      <Step n={3} title={S.setup.step3} hint={S.setup.step3Hint}>
        <span className="flex items-center gap-3">
          <Button variant="solid" disabled={checking} onClick={() => void check()}>{checking ? S.setup.checking : S.setup.check}</Button>
          <a className="text-[12px] font-semibold text-fg-2 hover:text-fg" href={HELPER_GUIDE_URL} target="_blank" rel="noreferrer">{S.helper.guide}</a>
        </span>
        {notYet && <span role="status" className="text-[12px] leading-relaxed text-accent">{S.setup.notYet}</span>}
      </Step>
    </div>
  )
}

/** One numbered step: the number in its own column so the titles and their controls line up */
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
