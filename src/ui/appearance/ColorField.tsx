// A colour as swatches plus the browser's own picker. The empty value is a choice of its own
// ("follow the original"), so it is a swatch too rather than a checkbox beside the control.
import { PALETTE } from '@/config/appearance'
import { O } from '@/ui/strings'

export function ColorField({ label, value, onChange, emptyLabel }: { label: string; value: string; onChange: (next: string) => void; emptyLabel: string }) {
  return (
    <fieldset className="mb-4 border-0 p-0">
      <legend className="mb-1.5 p-0 text-[12px] font-semibold text-fg-2">{label}</legend>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-label={emptyLabel}
          aria-pressed={value === ''}
          title={emptyLabel}
          onClick={() => onChange('')}
          className={`h-7 rounded-full px-2.5 text-[11px] font-semibold ${value === '' ? 'bg-accent text-white' : 'bg-control text-fg-2'}`}
        >
          {emptyLabel}
        </button>
        {PALETTE.map(color => (
          <button
            key={color}
            type="button"
            aria-label={color}
            aria-pressed={value === color}
            onClick={() => onChange(color)}
            style={{ background: color }}
            className={`size-7 rounded-full ${value === color ? 'ring-2 ring-fg ring-offset-2 ring-offset-bg' : 'ring-1 ring-line'}`}
          />
        ))}
        {/* The browser's picker for anything else; it always yields #rrggbb, which the sanitiser accepts */}
        <label className="flex h-7 cursor-pointer items-center gap-1.5 rounded-full bg-control px-2.5 text-[11px] font-semibold text-fg-2">
          {O.reading.custom}
          <input
            type="color"
            aria-label={`${label} ${O.reading.custom}`}
            value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#1565c0'}
            onChange={e => onChange(e.target.value)}
            className="size-4 cursor-pointer border-0 bg-transparent p-0"
          />
        </label>
      </div>
    </fieldset>
  )
}
