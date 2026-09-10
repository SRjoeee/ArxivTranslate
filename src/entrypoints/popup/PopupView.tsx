// Renders the view model's output and nothing else; every action goes through props, so the
// gallery can feed the same component the fixtures
import { LANG_CODES, type LangCode, label } from '@/config/languages'
import type { Mode } from '@/core/renderer'
import { Button } from '@/ui/Button'
import { PillView } from '@/ui/Pill'
import { Segmented } from '@/ui/Segmented'
import { Spinner } from '@/ui/Spinner'
import { S } from '@/ui/strings'
import { Switch } from '@/ui/Switch'
import type { PopupActions } from './data'
import type { PopupView as View } from './view-model'

const MODES: { value: Mode; label: string; title: string }[] = [
  { value: 'stack', label: S.mode.stack, title: S.mode.stackTitle },
  { value: 'side', label: S.mode.side, title: S.mode.sideTitle },
  { value: 'only', label: S.mode.only, title: S.mode.onlyTitle },
]

const NOTE_TONE = { alert: 'bg-accent-soft text-accent', warn: 'bg-warn-soft text-warn' } as const
const CARD = 'rounded-card bg-card shadow-[0_1px_2px_rgba(30,30,36,0.06)]'

export function PopupView({ view, error, actions }: { view: View; error: string | null; actions: PopupActions }) {
  return (
    <main className="flex w-[320px] flex-col gap-3 bg-bg p-4 font-ui text-[13px] text-fg">
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
        <p className="rounded-card bg-card p-3.5 leading-relaxed text-fg-2">{S.notArxiv}</p>
      ) : (
        <>
          <section className={CARD}>
            {view.list ? <ServiceList view={view} actions={actions} /> : <ServiceRows view={view} actions={actions} />}
            {view.note && (
              <p className={`flex items-start justify-between gap-3 rounded-b-card px-3.5 py-2.5 text-[12px] leading-relaxed ${NOTE_TONE[view.note.tone]}`}>
                <span>{view.note.text}</span>
                {view.note.link && (
                  <button type="button" onClick={actions.openOptions} className="shrink-0 cursor-pointer font-semibold underline-offset-2 hover:underline">
                    {view.note.link} →
                  </button>
                )}
              </p>
            )}
          </section>

          {view.failed && (
            <div className={`flex items-center justify-between px-3.5 py-2.5 text-[12px] font-semibold ${CARD}`}>
              <span>{view.failed}</span>
              <Button variant="chip" onClick={actions.retryFailed}>{S.failed.retry}</Button>
            </div>
          )}

          <Button variant={view.primary.action === 'translate' ? 'primary' : 'secondary'} disabled={view.primary.disabled} onClick={actions[view.primary.action]}>
            {view.primary.label}
            {view.primary.action === 'translate' && !view.primary.disabled && (
              <kbd className="rounded-[6px] bg-white/20 px-1.5 py-0.5 font-ui text-[11px] font-semibold">{S.primary.shortcut}</kbd>
            )}
          </Button>
          {view.secondary && <Button variant="text" className="self-center" onClick={actions[view.secondary.action]}>{view.secondary.label}</Button>}

          <Segmented value={view.mode.value} options={MODES} onChange={actions.chooseMode} />
          {view.mode.note && <p className="px-1 text-[11px] text-fg-2">{view.mode.note}</p>}

          {/* S-P-80: the hover highlight, next to the mode bar; saved at once and live on the page */}
          <div className="flex items-center justify-between px-1" title={view.highlight.title}>
            <span className="text-[12px] font-semibold text-fg-2">{view.highlight.label}</span>
            <Switch checked={view.highlight.on} onChange={actions.setHighlight} label={view.highlight.label} />
          </div>
        </>
      )}

      {error && <p role="alert" className="px-1 text-[12px] text-accent">{S.actionFailed(error)}</p>}
    </main>
  )
}

/** Collapsed: the service row and the language row */
function ServiceRows({ view, actions }: { view: View; actions: PopupActions }) {
  const { service, language } = view
  return (
    <>
      <button type="button" disabled={!service.canOpen} onClick={actions.toggleList} className="flex w-full cursor-pointer items-center justify-between border-b border-line px-3.5 py-3 text-left disabled:cursor-default">
        <span className="flex flex-col gap-px">
          <span className="text-[11px] font-semibold text-fg-2">{S.service.label}</span>
          <span className="font-semibold">
            {service.name}
            {service.replaced && <span className="ml-1.5 font-medium text-fg-2 line-through">{service.replaced}</span>}
          </span>
        </span>
        <span className="flex items-center gap-2">
          <PillView pill={service.pill} />
          {service.canOpen && <Chevron />}
        </span>
      </button>
      <LanguageRow view={view} actions={actions} enabled={language.canOpen} />
    </>
  )
}

/** Expanded: the four services and the language row on the same card (UI.md P2) */
function ServiceList({ view, actions }: { view: View; actions: PopupActions }) {
  const list = view.list!
  return (
    <>
      <button type="button" onClick={actions.toggleList} className="flex w-full cursor-pointer items-center justify-between border-b border-line px-3.5 py-2.5 text-[11px] font-semibold text-fg-2">
        {S.service.label}
        <Chevron up />
      </button>
      {list.options.map(o => (
        <div key={o.id} className="border-b border-line">
          <div className="flex items-center justify-between gap-2 pr-3.5">
            <button type="button" disabled={o.disabled} onClick={() => actions.chooseProvider(o.id)} className={`flex min-w-0 flex-1 cursor-pointer items-center justify-between px-3.5 py-2.5 text-left disabled:cursor-default ${o.disabled ? 'text-fg-2' : ''}`}>
              <span className="flex flex-col gap-px">
                <span className="font-semibold">{o.name}</span>
                <span className="text-[11px] font-medium text-fg-2">{o.hint}</span>
              </span>
              {o.selected && <Check />}
            </button>
            {/* The download sits beside the option, not inside it: a button in a button is invalid HTML */}
            {o.download === 'ready' && <Button variant="chip" onClick={actions.downloadPack}>{S.service.packDownload}</Button>}
            {o.download === 'busy' && <Spinner className="text-accent" />}
          </div>
          {o.id === 'openai-compat' && list.prompts && (
            <label className="flex items-center justify-between px-3.5 pb-2.5 text-[12px] text-fg-2">
              {S.service.prompt}
              <select value={list.promptId} onChange={e => actions.choosePrompt(e.target.value)} className="rounded-control bg-control px-2 py-1 text-[12px] font-semibold text-fg">
                {list.prompts.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
          )}
        </div>
      ))}
      <LanguageRow view={view} actions={actions} enabled />
    </>
  )
}

/**
 * The language row keeps a native select even when collapsed (UI.md P1 shows "value + arrow"):
 * the select has its own arrow and opens in one click. 179 entries, so first-letter jumps and the
 * keyboard are the browser's. [to verify] Chrome's stylable select in a popup window
 */
function LanguageRow({ view, actions, enabled }: { view: View; actions: PopupActions; enabled: boolean }) {
  const { language } = view
  return (
    <div className="flex items-center justify-between px-3.5 py-3">
      <span className="flex flex-col gap-px">
        <span className="text-[11px] font-semibold text-fg-2">{S.language.label}</span>
        {!enabled && <span className="font-semibold">{language.label}</span>}
      </span>
      {enabled && (
        <select aria-label={S.language.label} value={language.code} onChange={e => actions.chooseLanguage(e.target.value as LangCode)} className="max-w-[160px] rounded-control bg-control px-2 py-1 text-[12px] font-semibold text-fg">
          {LANG_CODES.map(code => <option key={code} value={code}>{label(code)}</option>)}
        </select>
      )}
    </div>
  )
}

function Chevron({ up = false }: { up?: boolean }) {
  return <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="text-fg-2/60"><path d={up ? 'm18 15-6-6-6 6' : 'm6 9 6 6 6-6'} /></svg>
}
function Check() {
  return <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="text-accent"><path d="M20 6 9 17l-5-5" /></svg>
}
function GearIcon() {
  return <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>
}
