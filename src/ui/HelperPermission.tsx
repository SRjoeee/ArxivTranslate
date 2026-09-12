// The permission step before the guided install (ADR-0002 §1; UI.md S-O-86, S-P-86c). `nativeMessaging` is optional,
// so it is requested from the reader's own click: Chrome shows its prompt and says whether it was granted. Denial is
// a state with its own line, not an error — the button stays for another try. Shared by the popup and the settings
// page, as HelperSetup is: one step, one wording. The line above the button is each surface's own (the popup derives
// it in its view model, the settings page prints it), the way the macOS-only notice is.
//
// A grant lands in a background worker that is already running, and Chrome never adds the API to it; the status
// asked for right after the grant therefore says `restarting`, and the pages show that line until the fresh worker
// reports (background/helper-restart.ts). The request itself is not delayed: the prompt has to come from the click.
import { useState } from 'react'
import { browser } from 'wxt/browser'
import { sendMessage } from '@/shared/messages'
import type { HelperStatus } from '@/shared/ocr'
import { Button } from '@/ui/Button'
import { S } from '@/ui/strings'

export function HelperPermission({ onStatus }: { onStatus: (status: HelperStatus) => void }) {
  const [denied, setDenied] = useState(false)
  const allow = async () => {
    // First thing in the handler: the request has to carry the click's user gesture
    const granted = await browser.permissions.request({ permissions: ['nativeMessaging'] }).catch(() => false)
    setDenied(!granted)
    if (!granted) return
    sendMessage({ type: 'axt:helper-status', recheck: true }).then(onStatus).catch(() => undefined)
  }
  return (
    <>
      <Button variant="solid" className="self-start" onClick={() => void allow()}>{S.helper.allow}</Button>
      {denied && <p role="status" className="text-[11px] leading-relaxed text-accent">{S.helper.denied}</p>}
    </>
  )
}
