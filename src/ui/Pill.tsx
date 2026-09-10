import type { Pill } from '@/entrypoints/popup/view-model'
import { Spinner } from './Spinner'

const TONE: Record<Pill['tone'], string> = {
  ok: 'bg-ok-soft text-ok',
  busy: 'bg-accent-soft text-accent',
  alert: 'bg-accent-soft text-accent',
  warn: 'bg-warn-soft text-warn',
  muted: 'bg-control text-fg-2',
}

export function PillView({ pill }: { pill: Pill }) {
  if (pill.text === '') return null
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ${TONE[pill.tone]}`}>
      {pill.spinning ? <Spinner /> : <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />}
      {pill.text}
    </span>
  )
}
