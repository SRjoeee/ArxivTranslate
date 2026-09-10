// A labelled row of the settings page: the label above, the control below, an optional hint under
// it. `Row` is the same shape for a control that sits beside its label instead.
import type { ReactNode } from 'react'

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the control is in `children`, which the rule cannot see through; every caller puts an input there
    <label className="mb-4 block">
      <span className="mb-1 block text-[12px] font-semibold text-fg-2">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-fg-2">{hint}</span>}
    </label>
  )
}

export function Row({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <span className="flex min-w-0 flex-col">
        <span className="text-[13px] font-semibold">{label}</span>
        {hint && <span className="text-[11px] text-fg-2">{hint}</span>}
      </span>
      {children}
    </div>
  )
}

export const inputClass = 'w-full rounded-control border border-line bg-card px-3 py-2 text-[13px] text-fg outline-none focus:border-fg-2'
