// 阅读: the two appearance lists (translation styles, hover bands) and when translation starts.
// Everything is immediate: choosing a tile or dragging a slider writes the config, and the page
// being read picks it up through its own config watcher.
import { useRef, useState } from 'react'
import {
  BUILT_IN_HIGHLIGHTS, BUILT_IN_STYLES, type HighlightProfile, type StyleProfile,
  activeHighlight, activeStyle, duplicateHighlight, duplicateStyle, newProfileId, resetBuiltIns,
} from '@/config/appearance'
import { HighlightEditor, StyleEditor } from '@/ui/appearance/ProfileEditor'
import { ProfileGrid } from '@/ui/appearance/ProfileGrid'
import { bandTile, styleTile } from '@/ui/appearance/tiles'
import { Row } from '@/ui/Field'
import { Segmented } from '@/ui/Segmented'
import { Switch } from '@/ui/Switch'
import { O, copyName, S } from '@/ui/strings'
import type { OptionsData } from '../data'

/** The preload margin as screens rather than pixels: a number of pixels means nothing to a reader */
const MARGINS = [450, 900, 1800, 2700]

/**
 * The list with the profile written into it — in place, or appended when the profile is no longer there: deleted in
 * another tab while its drawer was open here, and the list followed (INVENTORY S1). The reader's change is their later
 * word on that profile; a write that found nothing to replace would have dropped it without a trace
 */
const withProfile = <T extends { id: string }>(list: readonly T[], next: T): T[] =>
  list.some(p => p.id === next.id) ? list.map(p => (p.id === next.id ? next : p)) : [...list, next]
const THRESHOLDS = [0, 0.5, 1]
const nearest = (stops: readonly number[], value: number) => stops.reduce((best, s) => (Math.abs(s - value) < Math.abs(best - value) ? s : best), stops[0]!)

export function Reading({ data }: { data: OptionsData }) {
  const { config, patch } = data
  const [editing, setEditing] = useState<{ list: 'style' | 'highlight'; id: string } | null>(null)
  /** The profiles being edited as this tab last saw them: a drawer outlives a deletion made elsewhere (below) */
  const lastStyle = useRef<StyleProfile | undefined>(undefined)
  const lastBand = useRef<HighlightProfile | undefined>(undefined)
  if (!config) return null
  const a = config.appearance
  const style = activeStyle(a)
  const highlight = activeHighlight(a)
  const setAppearance = (fn: (current: typeof a) => typeof a) => void patch(latest => ({ ...latest, appearance: fn(latest.appearance) }))

  // The profile being edited as the configuration has it — or, not there, as this tab last saw it under that id: one
  // deleted in another tab while its drawer is open here (the drawer stays with the reader's draft, and their next
  // change writes the profile back — `withProfile`; the local review of S1, eighth pass), or one just added or
  // duplicated here whose write is still out (`addStyle`, `onDuplicate` seed it). Never another profile's: a copy
  // still out would otherwise open on its original, and the first keystroke would rename that (ninth pass)
  const cached = <T extends { id: string }>(last: T | undefined, id: string) => (last?.id === id ? last : undefined)
  const editingStyle = editing?.list === 'style' ? (a.styles.find(s => s.id === editing.id) ?? cached(lastStyle.current, editing.id)) : undefined
  const editingBand = editing?.list === 'highlight' ? (a.highlights.find(h => h.id === editing.id) ?? cached(lastBand.current, editing.id)) : undefined
  lastStyle.current = editingStyle
  lastBand.current = editingBand

  const addStyle = () => {
    const next: StyleProfile = { ...BUILT_IN_STYLES[0]!, id: newProfileId('style'), name: O.reading.newProfile }
    setAppearance(c => ({ ...c, styles: [...c.styles, next], activeStyle: next.id }))
    lastStyle.current = next
    setEditing({ list: 'style', id: next.id })
  }
  const addBand = () => {
    const next: HighlightProfile = { ...BUILT_IN_HIGHLIGHTS[0]!, id: newProfileId('hl'), name: O.reading.newProfile }
    setAppearance(c => ({ ...c, highlights: [...c.highlights, next], activeHighlight: next.id }))
    lastBand.current = next
    setEditing({ list: 'highlight', id: next.id })
  }
  /** Deleting the chosen profile falls back to the first of the list, never to nothing */
  const removeStyle = (id: string) => {
    setAppearance(c => {
      const styles = c.styles.filter(s => s.id !== id)
      return { ...c, styles, activeStyle: c.activeStyle === id ? styles[0]?.id ?? BUILT_IN_STYLES[0]!.id : c.activeStyle }
    })
    setEditing(null)
  }
  const removeBand = (id: string) => {
    setAppearance(c => {
      const highlights = c.highlights.filter(h => h.id !== id)
      return { ...c, highlights, activeHighlight: c.activeHighlight === id ? highlights[0]?.id ?? BUILT_IN_HIGHLIGHTS[0]!.id : c.activeHighlight }
    })
    setEditing(null)
  }

  return (
    <>
      <ProfileGrid
        kind="styles"
        title={O.reading.styles}
        hint={O.reading.stylesHint}
        items={a.styles}
        activeId={a.activeStyle}
        onChoose={id => setAppearance(c => ({ ...c, activeStyle: id }))}
        onEdit={id => setEditing({ list: 'style', id })}
        onAdd={addStyle}
        onReset={() => setAppearance(c => resetBuiltIns(c, 'styles'))}
        renderTile={profile => <span style={styleTile(profile)} className="text-[13px]">{O.reading.previewTarget}</span>}
      />

      <div className="mb-2 rounded-card border border-line bg-card px-3.5">
        <Row label={S.rows.highlight} hint={S.rows.highlightTitle}>
          <Switch checked={config.reading.sentenceHighlight} onChange={on => void patch(latest => ({ ...latest, reading: { ...latest.reading, sentenceHighlight: on } }))} label={S.rows.highlight} />
        </Row>
      </div>
      <ProfileGrid
        kind="highlights"
        title={O.reading.highlights}
        hint={O.reading.highlightsHint}
        items={a.highlights}
        activeId={a.activeHighlight}
        onChoose={id => setAppearance(c => ({ ...c, activeHighlight: id }))}
        onEdit={id => setEditing({ list: 'highlight', id })}
        onAdd={addBand}
        onReset={() => setAppearance(c => resetBuiltIns(c, 'highlights'))}
        renderTile={profile => <span className="text-[13px]"><span style={bandTile(profile)}>{O.reading.previewTarget}</span></span>}
      />

      <h3 className="mb-1 text-[14px] font-bold">{O.reading.preloadRange}</h3>
      <p className="mb-2 text-[11px] text-fg-2">{O.reading.preloadRangeHint}</p>
      <div className="mb-6">
        <Segmented
          value={String(nearest(MARGINS, config.preload.margin))}
          options={MARGINS.map((m, i) => ({ value: String(m), label: O.reading.preloadStops[i]!, title: O.reading.preloadStops[i]! }))}
          onChange={next => void patch(latest => ({ ...latest, preload: { ...latest.preload, margin: Number(next) } }))}
        />
      </div>

      <h3 className="mb-1 text-[14px] font-bold">{O.reading.threshold}</h3>
      <p className="mb-2 text-[11px] text-fg-2">{O.reading.thresholdHint}</p>
      <Segmented
        value={String(nearest(THRESHOLDS, config.preload.threshold))}
        options={THRESHOLDS.map((t, i) => ({ value: String(t), label: O.reading.thresholdStops[i]!, title: O.reading.thresholdStops[i]! }))}
        onChange={next => void patch(latest => ({ ...latest, preload: { ...latest.preload, threshold: Number(next) } }))}
      />

      {editingStyle && (
        <StyleEditor
          value={editingStyle}
          highlight={highlight}
          onChange={next => setAppearance(c => ({ ...c, styles: withProfile(c.styles, next) }))}
          onDuplicate={() => {
            const copy = duplicateStyle(editingStyle, copyName(editingStyle, 'styles'))
            setAppearance(c => ({ ...c, styles: [...c.styles, copy], activeStyle: copy.id }))
            lastStyle.current = copy
            setEditing({ list: 'style', id: copy.id })
          }}
          onDelete={() => removeStyle(editingStyle.id)}
          onClose={() => setEditing(null)}
        />
      )}
      {editingBand && (
        <HighlightEditor
          value={editingBand}
          style={style}
          onChange={next => setAppearance(c => ({ ...c, highlights: withProfile(c.highlights, next) }))}
          onDuplicate={() => {
            const copy = duplicateHighlight(editingBand, copyName(editingBand, 'highlights'))
            setAppearance(c => ({ ...c, highlights: [...c.highlights, copy], activeHighlight: copy.id }))
            lastBand.current = copy
            setEditing({ list: 'highlight', id: copy.id })
          }}
          onDelete={() => removeBand(editingBand.id)}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  )
}
