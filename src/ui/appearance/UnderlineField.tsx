// The underline of a style profile: which line, and how thick when there is one.
import { UNDERLINES, type Underline } from '@/config/appearance'
import { Segmented } from '@/ui/Segmented'
import { O } from '@/ui/strings'

const NAMES: Record<Underline, string> = { none: '无', solid: '实线', dotted: '点线', dashed: '虚线', wavy: '波浪' }

export function UnderlineField({ underline, thickness, onChange }: { underline: Underline; thickness: 1 | 2; onChange: (next: { underline: Underline; thickness: 1 | 2 }) => void }) {
  return (
    <div className="mb-4">
      <div className="mb-1.5 text-[12px] font-semibold text-fg-2">{O.reading.underline}</div>
      <Segmented
        value={underline}
        options={UNDERLINES.map(u => ({ value: u, label: NAMES[u], title: NAMES[u] }))}
        onChange={next => onChange({ underline: next, thickness })}
      />
      {underline !== 'none' && (
        <div className="mt-2">
          <div className="mb-1.5 text-[12px] font-semibold text-fg-2">{O.reading.thickness}</div>
          <Segmented
            value={String(thickness) as '1' | '2'}
            options={[{ value: '1' as const, label: '1px', title: '1px' }, { value: '2' as const, label: '2px', title: '2px' }]}
            onChange={next => onChange({ underline, thickness: next === '2' ? 2 : 1 })}
          />
        </div>
      )}
    </div>
  )
}
