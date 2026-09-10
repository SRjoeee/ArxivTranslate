// A toggle as a `switch` button (aria-checked), styled on the tokens. `text` puts the words inside
// the button, beside the track, so the whole thing is one control (no label without an input)
export function Switch({ checked, onChange, label, small = false, text, title }: { checked: boolean; onChange: (next: boolean) => void; label: string; small?: boolean; text?: string; title?: string }) {
  const track = small ? 'h-[18px] w-[30px]' : 'h-[20px] w-[34px]'
  const knob = small ? 'size-[14px]' : 'size-[16px]'
  const shift = small ? 'left-[14px]' : 'left-[16px]'
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={title}
      onClick={() => onChange(!checked)}
      className="flex shrink-0 cursor-pointer items-center gap-2"
    >
      <span className={`relative shrink-0 rounded-full transition-colors ${track} ${checked ? 'bg-accent' : 'bg-control'}`}>
        <span aria-hidden="true" className={`absolute top-[2px] rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.25)] transition-[left] ${knob} ${checked ? shift : 'left-[2px]'}`} />
      </span>
      {text && <span>{text}</span>}
    </button>
  )
}
