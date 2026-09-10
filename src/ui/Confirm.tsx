// A destructive action in two clicks, without a modal: the first click swaps the button for
// "confirm" plus "cancel", and the pair goes back on its own after a few seconds.
import { useEffect, useState } from 'react'
import { Button } from './Button'

export function Confirm({ label, confirmLabel, cancelLabel, onConfirm }: { label: string; confirmLabel: string; cancelLabel: string; onConfirm: () => void }) {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const id = setTimeout(() => setArmed(false), 4000)
    return () => clearTimeout(id)
  }, [armed])
  if (!armed) return <Button variant="text" className="!text-accent" onClick={() => setArmed(true)}>{label}</Button>
  return (
    <span className="flex items-center gap-2">
      <Button variant="solid" onClick={() => { setArmed(false); onConfirm() }}>{confirmLabel}</Button>
      <Button variant="text" onClick={() => setArmed(false)}>{cancelLabel}</Button>
    </span>
  )
}
