// Renders the view model's output and nothing else; every action goes through props, so the
// gallery can feed the same component the fixtures. One card holds the rows (service, language,
// prompt, the two switches); a menu opens under its row; notes and the buttons sit below the card.
import type { ReactNode } from 'react'
import type { Mode } from '@/core/renderer'
import { Button } from '@/ui/Button'
import { Menu } from '@/ui/Menu'
import { Segmented } from '@/ui/Segmented'
import { S } from '@/ui/strings'
import { Switch } from '@/ui/Switch'
import type { PopupActions } from './data'
import type { MenuKind, PopupView as View } from './view-model'

const MODES: { value: Mode; label: string; title: string }[] = [
  { value: 'stack', label: S.mode.stack, title: S.mode.stackTitle },
  { value: 'side', label: S.mode.side, title: S.mode.sideTitle },
  { value: 'only', label: S.mode.only, title: S.mode.onlyTitle },
]

const CARD = 'rounded-card bg-card shadow-[0_1px_2px_rgba(30,30,36,0.06)]'

export function PopupView({ view, error, copied, actions }: { view: View; error: string | null; copied: boolean; actions: PopupActions }) {
  // An open menu overlays the rows below it; the padding keeps that much document below the card
  // in flow, so the popup window grows to fit and nothing is clipped
  const room = view.menu ? 'pb-[280px]' : ''
  return (
    <main className={`flex w-[320px] flex-col gap-3 bg-bg p-4 font-ui text-[13px] text-fg ${room}`}>
      <header className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          {/* The brand mark: a glyph used as an icon, not copy — the only Chinese literal outside strings.ts */}
          <span aria-hidden="true" className="flex size-[26px] items-center justify-center rounded-[8px] bg-accent text-[12px] font-bold text-white">译</span>
          <span className="text-[14px] font-bold">{S.brand}</span>
        </div>
        <button type="button" aria-label={S.settings} title={S.settings} onClick={actions.openOptions} className="cursor-pointer text-fg-2 hover:text-fg">
          <GearIcon />
        </button>
      </header>

      {view.empty ? (
        <p className={`${CARD} p-3.5 leading-relaxed text-fg-2`}>{S.notArxiv}</p>
      ) : (
        <>
          <section className={CARD}>
            <MenuRow kind="service" label={S.rows.service} row={view.service} view={view} actions={actions} />
            <MenuRow kind="language" label={S.rows.language} row={view.language} view={view} actions={actions} />
            {view.prompt && <MenuRow kind="prompt" label={S.rows.prompt} row={view.prompt} view={view} actions={actions} />}
            <SwitchRow label={S.rows.highlight} title={S.rows.highlightTitle} checked={view.highlight} onChange={actions.setHighlight} />
            <SwitchRow label={S.rows.images} checked={view.images} onChange={actions.setImages} last={!view.helper} />
            {view.helper && (
              <div className="flex flex-col gap-2 px-3.5 pb-3 text-[12px] leading-relaxed text-fg-2">
                <span>{view.helper.text}</span>
                {view.helper.command && (
                  <div className="flex items-center gap-2">
                    <Button variant="chip" onClick={actions.copyInstallCommand}>{copied ? S.helper.copied : S.helper.copy}</Button>
                    <Button variant="text" onClick={actions.openGuide}>{S.helper.guide}</Button>
                  </div>
                )}
              </div>
            )}
          </section>

          {view.note && (
            <div className={`${CARD} flex items-center justify-between gap-3 px-3.5 py-2.5 text-[12px] leading-relaxed text-fg`}>
              <span>{view.note.text}</span>
              {view.note.settings && <Button variant="chip" onClick={actions.openOptions}>{S.settings}</Button>}
            </div>
          )}

          {view.failed && (
            <div className={`${CARD} flex items-center justify-between px-3.5 py-2.5 text-[12px] font-semibold`}>
              <span>{view.failed}</span>
              <Button variant="chip" onClick={actions.retryFailed}>{S.failed.retry}</Button>
            </div>
          )}

          {/* aria-label keeps the accessible name at the label alone, badge or not (the e2e suites find the button by name) */}
          <Button variant={view.primary.action === 'restore' ? 'secondary' : 'primary'} disabled={view.primary.disabled} aria-label={view.primary.label} onClick={actions[view.primary.action]}>
            {view.primary.label}
            {view.primary.shortcut && (
              <kbd className="rounded-[6px] bg-white/20 px-1.5 py-0.5 font-ui text-[11px] font-semibold">{view.primary.shortcut}</kbd>
            )}
          </Button>
          {view.secondary && <Button variant="text" className="self-center" onClick={actions[view.secondary.action]}>{view.secondary.label}</Button>}

          <Segmented value={view.mode.value} options={MODES} onChange={actions.chooseMode} />
          {view.mode.note && <p className="px-1 text-[11px] text-fg-2">{view.mode.note}</p>}
        </>
      )}

      {error && <p role="alert" className="px-1 text-[12px] text-accent">{S.actionFailed(error)}</p>}
    </main>
  )
}

/** A row that opens a menu under itself: label above the value, chevron on the right */
function MenuRow({ kind, label, row, view, actions }: { kind: MenuKind; label: string; row: { value: string; replaced?: string }; view: View; actions: PopupActions }) {
  const open = view.menu?.kind === kind
  return (
    <div className="relative border-b border-line">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? actions.closeMenu() : actions.openMenu(kind))}
        className="flex w-full cursor-pointer items-center justify-between px-3.5 py-3 text-left"
      >
        <span className="flex min-w-0 flex-col gap-px">
          <span className="text-[11px] font-semibold text-fg-2">{label}</span>
          <span className="truncate font-semibold">
            {row.value}
            {row.replaced && <span className="ml-1.5 font-medium text-fg-2 line-through">{row.replaced}</span>}
          </span>
        </span>
        <Chevron up={open} />
      </button>
      {open && view.menu && (
        <Menu
          items={view.menu.items}
          label={view.menu.label}
          search={view.menu.search}
          searchPlaceholder={S.menu.searchLanguages}
          empty={S.menu.noMatch}
          onSelect={id => {
            if (kind === 'service') actions.chooseService(id as Parameters<PopupActions['chooseService']>[0])
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

function SwitchRow({ label, title, checked, onChange, last = false }: { label: string; title?: string; checked: boolean; onChange: (on: boolean) => void; last?: boolean }) {
  return (
    <div className={`flex items-center justify-between px-3.5 py-3 ${last ? '' : 'border-b border-line'}`} title={title}>
      <span className="font-semibold">{label}</span>
      <Switch checked={checked} onChange={onChange} label={label} />
    </div>
  )
}

function Chevron({ up = false }: { up?: boolean }): ReactNode {
  return <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-fg-2/60"><path d={up ? 'm18 15-6-6-6 6' : 'm6 9 6 6 6-6'} /></svg>
}
function GearIcon() {
  return <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>
}
