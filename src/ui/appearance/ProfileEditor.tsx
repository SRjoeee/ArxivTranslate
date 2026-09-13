// One editor for both profile lists: the preview on top, then only the fields that list has.
// Every control writes through `onChange` at once, so the page and the preview move together.
import { Drawer } from '@/ui/Drawer'
import { Button } from '@/ui/Button'
import { Confirm } from '@/ui/Confirm'
import { Switch } from '@/ui/Switch'
import { Field, inputClass } from '@/ui/Field'
import { HL_OPACITY_MAX, HL_OPACITY_MIN, type HighlightProfile, type StyleProfile } from '@/config/appearance'
import { OPACITY_MAX, OPACITY_MIN } from '@/core/renderer'
import { O, profileName } from '@/ui/strings'
import { AdvancedCss } from './AdvancedCss'
import { ColorField } from './ColorField'
import { OpacityField } from './OpacityField'
import { Preview } from './Preview'
import { UnderlineField } from './UnderlineField'

export function StyleEditor({ value, highlight, onChange, onDuplicate, onDelete, onClose }: {
  value: StyleProfile
  highlight: HighlightProfile
  /** Answers with the write, for the boxes that wait for their own (AdvancedCss) */
  onChange: (next: StyleProfile) => unknown
  onDuplicate: () => void
  onDelete: () => void
  onClose: () => void
}) {
  return (
    <Drawer
      title={O.reading.editTitle}
      onClose={onClose}
      footer={<>
        <Button variant="chip" onClick={onDuplicate}>{O.reading.duplicate}</Button>
        <Confirm label={O.reading.delete} confirmLabel={O.services.deleteConfirm} cancelLabel={O.services.cancel} onConfirm={onDelete} />
        <span className="flex-1" />
        <Button variant="solid" onClick={onClose}>{O.reading.done}</Button>
      </>}
    >
      <Preview style={value} highlight={highlight} />
      {/* The shipped profiles are stored under their Chinese names and displayed in the reader's
          language (`profileName`); the field has to show what the grid shows, or an English drawer
          opens on “Same as the original”. Typing is a rename and writes what was typed (Codex on #161) */}
      <Field label={O.reading.name}>
        <input className={inputClass} value={profileName(value, 'styles')} onChange={e => onChange({ ...value, name: e.target.value })} />
      </Field>
      <ColorField label={O.reading.color} value={value.color} onChange={color => onChange({ ...value, color })} emptyLabel={O.reading.followText} />
      <OpacityField label={O.reading.opacity} value={value.opacity} min={OPACITY_MIN} max={OPACITY_MAX} onChange={opacity => onChange({ ...value, opacity })} />
      <UnderlineField underline={value.underline} thickness={value.thickness} onChange={next => onChange({ ...value, ...next })} />
      <div className="mb-4 flex items-center justify-between">
        <span className="flex flex-col">
          <span className="text-[13px] font-semibold">{O.reading.blur}</span>
          <span className="text-[11px] text-fg-2">{O.reading.blurHint}</span>
        </span>
        <Switch checked={value.blur} onChange={blur => onChange({ ...value, blur })} label={O.reading.blur} />
      </div>
      <AdvancedCss value={value.css} onChange={css => onChange({ ...value, css })} />
    </Drawer>
  )
}

export function HighlightEditor({ value, style, onChange, onDuplicate, onDelete, onClose }: {
  value: HighlightProfile
  style: StyleProfile
  onChange: (next: HighlightProfile) => unknown
  onDuplicate: () => void
  onDelete: () => void
  onClose: () => void
}) {
  return (
    <Drawer
      title={O.reading.editTitle}
      onClose={onClose}
      footer={<>
        <Button variant="chip" onClick={onDuplicate}>{O.reading.duplicate}</Button>
        <Confirm label={O.reading.delete} confirmLabel={O.services.deleteConfirm} cancelLabel={O.services.cancel} onConfirm={onDelete} />
        <span className="flex-1" />
        <Button variant="solid" onClick={onClose}>{O.reading.done}</Button>
      </>}
    >
      <Preview style={style} highlight={value} band />
      <Field label={O.reading.name}>
        <input className={inputClass} value={profileName(value, 'highlights')} onChange={e => onChange({ ...value, name: e.target.value })} />
      </Field>
      <ColorField label={O.reading.bandColor} value={value.color} onChange={color => onChange({ ...value, color })} emptyLabel={O.reading.custom} />
      <OpacityField label={O.reading.opacity} value={value.opacity} min={HL_OPACITY_MIN} max={HL_OPACITY_MAX} step={0.01} onChange={opacity => onChange({ ...value, opacity })} />
    </Drawer>
  )
}
