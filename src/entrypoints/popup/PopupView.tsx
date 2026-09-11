// Renders the view model's output and nothing else; every action goes through props, so the
// gallery can feed the same component the fixtures. Layout (reviewed 2026-09-10): the service and
// language card, the prompt row for the LLM, then bubbles for anything that needs attention, the
// primary button, the mode bar, and the two small switches under it.
import type { ReactNode } from 'react'
import { useRef } from 'react'
import type { Mode } from '@/core/renderer'
import { BrandMark } from '@/ui/BrandMark'
import { Button } from '@/ui/Button'
import { Menu } from '@/ui/Menu'
import { Segmented } from '@/ui/Segmented'
import { MODE_ORDER, S } from '@/ui/strings'
import { Switch } from '@/ui/Switch'
import type { PopupActions } from './data'
import type { MenuKind, PopupView as View } from './view-model'

/** Only the marks are constant; the words come from the pack in use, which is chosen after this
 *  module is imported (see the note at the top of ui/strings.ts) */
const MODE_ICONS: Record<Mode, ReactNode> = { side: <SideIcon />, stack: <StackIcon />, only: <OnlyIcon /> }
// The bar follows MODE_ORDER, the one place the order is decided (UI.md S-P-70)
const modes = () => MODE_ORDER.map(value => ({
  value,
  label: S.mode[value],
  title: S.mode[`${value}Title` as const],
  icon: MODE_ICONS[value],
}))

const CARD = 'rounded-card bg-card shadow-[0_1px_2px_rgba(30,30,36,0.06)]'

export function PopupView({ view, error, copied, actions }: { view: View; error: string | null; copied: boolean; actions: PopupActions }) {
  return (
    <main className="flex w-[320px] flex-col gap-3 bg-bg p-4 font-ui text-[13px] text-fg">
      <header className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <BrandMark />
          <span className="text-[14px] font-bold">{S.brand}</span>
        </div>
        <button type="button" aria-label={S.settings} title={S.settings} onClick={() => actions.openOptions()} className="cursor-pointer text-fg-2 hover:text-fg">
          <GearIcon />
        </button>
      </header>

      {view.empty ? (
        <p className={`${CARD} p-3.5 leading-relaxed text-fg-2`}>{S.notArxiv}</p>
      ) : (
        <>
          <section className={CARD}>
            <MenuRow kind="service" label={S.rows.service} row={view.service} view={view} actions={actions} />
            <MenuRow kind="language" label={S.rows.language} row={view.language} view={view} actions={actions} last />
          </section>
          {view.prompt && (
            <section className={CARD}>
              <MenuRow kind="prompt" label={S.rows.prompt} row={view.prompt} view={view} actions={actions} compact last />
            </section>
          )}

          {view.note && (
            <Bubble>
              <span className="font-semibold text-accent">{view.note.text}</span>
              {view.note.settings && <Button variant="solid" onClick={() => actions.openOptions()}>{S.settings}</Button>}
            </Bubble>
          )}
          {view.failed && (
            <Bubble>
              <span className="font-bold text-accent">{view.failed}</span>
              <Button variant="solid" onClick={actions.retryFailed}>{S.failed.retry}</Button>
            </Bubble>
          )}
          {view.helper && (
            <div className={`${CARD} flex flex-col gap-2 px-3.5 py-3 text-[12px] leading-relaxed`}>
              <span className="text-fg-2">{view.helper.text}</span>
              {view.helper.command && (
                <span className="flex items-center gap-3">
                  <Button variant="solid" onClick={actions.copyInstallCommand}>{copied ? S.helper.copied : S.helper.copy}</Button>
                  <Button variant="text" onClick={actions.openGuide}>{S.helper.guide}</Button>
                </span>
              )}
            </div>
          )}

          {/* aria-label keeps the accessible name at the label alone, badge or not (the e2e suites find the button by name) */}
          <Button variant={view.primary.action === 'restore' ? 'secondary' : 'primary'} disabled={view.primary.disabled} aria-label={view.primary.label} onClick={actions[view.primary.action]}>
            {view.primary.label}
            {view.primary.shortcut && (
              // `current`: the chip reads on the red 翻译本页 and on the plain 显示原文 alike, where a
              // white chip would disappear into the button
              <kbd className="rounded-[6px] bg-current/15 px-1.5 py-0.5 font-ui text-[11px] font-semibold">{view.primary.shortcut}</kbd>
            )}
          </Button>
          {view.secondary && <Button variant="text" className="self-center" onClick={actions[view.secondary.action]}>{view.secondary.label}</Button>}

          <Segmented value={view.mode.value} options={modes()} onChange={actions.chooseMode} />
          {view.mode.note && <p className="px-1 text-[11px] text-fg-2">{view.mode.note}</p>}

          {/* The three reading choices on one row: two switches and the way in to the styles. The
              row is what the menu is measured against — a menu the width of the 译文样式 button
              alone would be a column of clipped names (S-P-82) */}
          <ReadingRow view={view} actions={actions} />
        </>
      )}

      {error && <p role="alert" className="px-1 text-[12px] text-accent">{S.actionFailed(error)}</p>}
    </main>
  )
}

/** A separate rounded block for anything that needs attention: text on the left, its button on the right */
function Bubble({ tone = 'alert', children }: { tone?: 'alert' | 'neutral'; children: ReactNode }) {
  return (
    <div className={`flex items-center justify-between gap-3 rounded-card px-3.5 py-3 text-[12px] leading-relaxed ${tone === 'alert' ? 'bg-accent-soft' : CARD}`}>
      {children}
    </div>
  )
}

/** A row that opens a menu under itself. Big: label above the value. Compact: label left, value right */
function MenuRow({ kind, label, row, view, actions, compact = false, last = false }: { kind: MenuKind; label: string; row: { value: string; replaced?: string }; view: View; actions: PopupActions; compact?: boolean; last?: boolean }) {
  const open = view.menu?.kind === kind
  const anchor = useRef<HTMLDivElement>(null)
  // The value is truncated when it is long — a language's full name runs to "Simplified Mandarin
  // Chinese (简体中文)" — so the whole of it is on the row for a reader who needs to check
  const value = (
    <span title={row.value} className="truncate font-semibold">
      {row.value}
      {row.replaced && <span className="ml-1.5 font-medium text-fg-2 line-through">{row.replaced}</span>}
    </span>
  )
  return (
    <div ref={anchor} className={last ? '' : 'border-b border-line'}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? actions.closeMenu() : actions.openMenu(kind))}
        className={`flex w-full cursor-pointer items-center justify-between px-3.5 text-left ${compact ? 'py-2.5' : 'py-3'}`}
      >
        {compact ? (
          <>
            <span className="text-[12px] font-semibold text-fg-2">{label}</span>
            <span className="flex min-w-0 items-center gap-2">{value}<Chevron up={open} /></span>
          </>
        ) : (
          <>
            <span className="flex min-w-0 flex-col gap-px">
              <span className="text-[11px] font-semibold text-fg-2">{label}</span>
              {value}
            </span>
            <Chevron up={open} />
          </>
        )}
      </button>
      {open && view.menu && (
        <Menu
          anchor={anchor}
          items={view.menu.items}
          label={view.menu.label}
          search={view.menu.search}
          searchPlaceholder={S.menu.searchLanguages}
          empty={S.menu.noMatch}
          onSelect={id => {
            if (kind === 'service') actions.chooseService(id)
            else if (kind === 'language') actions.chooseLanguage(id as Parameters<PopupActions['chooseLanguage']>[0])
            else actions.choosePrompt(id)
          }}
          onAction={() => actions.downloadPack()}
          onClose={actions.closeMenu}
        />
      )}
    </div>
  )
}

/**
 * The last row of the popup: 对照高亮, 图片翻译 and the way in to 译文样式, side by side. All three
 * are "how this reads", as against the card at the top, which is what translates (S-P-82).
 *
 * The **row** is the menu's anchor, not the button: the menu is then as wide as the card above it
 * rather than as wide as four characters. The button is passed as the trigger, so pressing it again
 * closes the menu while a click on either switch closes it and still toggles the switch.
 */
function ReadingRow({ view, actions }: { view: View; actions: PopupActions }) {
  const open = view.menu?.kind === 'style'
  const anchor = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  return (
    <div ref={anchor} className="flex items-center justify-between gap-2 px-1 text-[12px] font-semibold text-fg-2">
      <Switch small checked={view.highlight} onChange={actions.setHighlight} label={S.rows.highlight} text={S.rows.highlight} title={S.rows.highlightTitle} />
      <Switch small checked={view.images} onChange={actions.setImages} label={S.rows.images} text={S.rows.images} />
      <button
        ref={trigger}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        title={view.style.value}
        onClick={() => (open ? actions.closeMenu() : actions.openMenu('style'))}
        className={`flex shrink-0 cursor-pointer items-center gap-1 ${open ? 'text-fg' : 'hover:text-fg'}`}
      >
        {S.rows.style}
        <Chevron up={open} />
      </button>
      {open && view.menu && (
        <Menu
          anchor={anchor}
          trigger={trigger}
          items={view.menu.items}
          label={view.menu.label}
          search={false}
          empty={S.menu.noMatch}
          onSelect={actions.chooseStyle}
          onClose={actions.closeMenu}
        />
      )}
    </div>
  )
}

function Chevron({ up = false }: { up?: boolean }): ReactNode {
  return <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-fg-2/60"><path d={up ? 'm18 15-6-6-6 6' : 'm6 9 6 6 6-6'} /></svg>
}
// The three mode marks (the reviewer's, 2026-09-10). The 仅译文 lines are drawn in the card colour
// rather than white so they stay visible on the light fill of a selected segment in dark mode
function StackIcon() {
  return <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"><rect x="3.5" y="3.5" width="17" height="17" rx="3.5" /><path d="M3.5 12h17v5a3.5 3.5 0 0 1-3.5 3.5H7A3.5 3.5 0 0 1 3.5 17z" fill="currentColor" stroke="none" /></svg>
}
function SideIcon() {
  return <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"><rect x="3.5" y="3.5" width="17" height="17" rx="3.5" /><path d="M12 3.5h5A3.5 3.5 0 0 1 20.5 7v10a3.5 3.5 0 0 1-3.5 3.5h-5z" fill="currentColor" stroke="none" /></svg>
}
function OnlyIcon() {
  return <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none"><rect x="3.5" y="3.5" width="17" height="17" rx="3.5" fill="currentColor" /><path d="M7.5 9h9M7.5 12.5h9M7.5 16h5" stroke="var(--axt-card)" strokeWidth="1.6" strokeLinecap="round" /></svg>
}
function GearIcon() {
  return <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>
}
