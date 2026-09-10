// A segmented control made of aria-pressed buttons rather than radios: the existing e2e suites
// (layout / image / a11y) find the mode buttons with getByRole('button', { name })
export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string; title: string }[]; onChange: (value: T) => void }) {
  return (
    <div className="flex rounded-[10px] bg-control p-[3px] text-[12px] font-semibold">
      {options.map(o => (
        <button
          type="button"
          key={o.value}
          title={o.title}
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
          className={`flex-1 cursor-pointer rounded-[8px] py-1.5 text-center ${o.value === value ? 'bg-card text-fg shadow-[0_1px_2px_rgba(0,0,0,0.08)]' : 'text-fg-2'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
