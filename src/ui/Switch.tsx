// A toggle as a `switch` button (aria-checked), styled on the tokens; the label is the caller's
export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (next: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-[20px] w-[34px] shrink-0 cursor-pointer rounded-full transition-colors ${checked ? 'bg-accent' : 'bg-control'}`}
    >
      <span aria-hidden="true" className={`absolute top-[2px] size-[16px] rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.25)] transition-[left] ${checked ? 'left-[16px]' : 'left-[2px]'}`} />
    </button>
  )
}
