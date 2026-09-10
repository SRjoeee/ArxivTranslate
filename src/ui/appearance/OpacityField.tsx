// A percentage on a slider, with the number beside it so the value is readable without dragging.
export function OpacityField({ label, value, min, max, step = 0.05, onChange }: { label: string; value: number; min: number; max: number; step?: number; onChange: (next: number) => void }) {
  return (
    <label className="mb-4 block">
      <span className="mb-1.5 flex items-center justify-between text-[12px] font-semibold text-fg-2">
        {label}
        <span className="tabular-nums text-fg">{Math.round(value * 100)}%</span>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))} className="w-full accent-accent" />
    </label>
  )
}
