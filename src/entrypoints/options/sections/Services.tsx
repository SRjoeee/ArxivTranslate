// 翻译服务: the three built-in services as cards, then the reader's own as a list, then the target
// language and image translation. Choosing is one click and takes effect at once.
import { useState } from 'react'
import { LANG_CODES, LANG_CODE_TO_EN_NAME, LANG_CODE_TO_LOCALE_NAME, LANG_CODE_TO_ZH_NAME, type LangCode, label } from '@/config/languages'
import { MODE_VALUES } from '@/config/schema'
import type { Service } from '@/config/services'
import { supportsTarget } from '@/providers/microsoft'
import { Button } from '@/ui/Button'
import { MenuField } from '@/ui/MenuField'
import { Row } from '@/ui/Field'
import { Switch } from '@/ui/Switch'
import { HELPER_GUIDE_URL, O, S, helperInstallCommand } from '@/ui/strings'
import type { OptionsData } from '../data'
import { ServiceDrawer } from './ServiceDrawer'

const MODE_NAMES: Record<(typeof MODE_VALUES)[number], string> = { stack: S.mode.stack, side: S.mode.side, only: S.mode.only }
/** The radio's own look, so the control the reader clicks is the control itself */
const RADIO = 'size-3.5 shrink-0 appearance-none rounded-full border-[1.5px] border-line checked:border-[5px] checked:border-accent disabled:opacity-40'

export function Services({ data, extensionId }: { data: OptionsData; extensionId: string }) {
  const { config, patch, pack, fetchPack, helper } = data
  /** null = closed, 'new' = the add form, otherwise the service being edited */
  const [editing, setEditing] = useState<'new' | string | null>(null)
  const [copied, setCopied] = useState(false)
  if (!config) return null

  const chrome = (): { hint: string; disabled: boolean; action?: 'download' | 'busy' } => {
    switch (pack) {
      case 'available': return { hint: S.service.chrome_ready, disabled: false }
      case 'downloadable': return { hint: S.service.chrome_ready, disabled: true, action: 'download' }
      case 'downloading': return { hint: S.service.chrome_downloading, disabled: true, action: 'busy' }
      case null: return { hint: S.service.chrome_ready, disabled: true }
      default: return { hint: S.service.chrome_unavailable, disabled: true }
    }
  }
  const microsoftOk = supportsTarget(config.targetLanguage)
  const chromeState = chrome()
  const cards = [
    { id: 'microsoft', name: S.service.microsoft, hint: microsoftOk ? S.service.free : S.service.microsoft_unsupported, disabled: !microsoftOk },
    { id: 'google-web', name: S.service.google, hint: S.service.free, disabled: false },
    { id: 'chrome-builtin', name: S.service.chrome, ...chromeState },
  ]
  const choose = (id: string) => void patch(latest => ({ ...latest, provider: id }))
  const editingService: Service | null = editing && editing !== 'new' ? config.services.find(s => s.id === editing) ?? null : null

  return (
    <>
      <h3 className="mb-2 text-[14px] font-bold">{O.services.builtIn}</h3>
      <div className="mb-6 grid grid-cols-3 gap-2">
        {cards.map(card => (
          <div key={card.id} className={`relative rounded-card border bg-card p-3 ${config.provider === card.id ? 'border-accent' : 'border-line'}`}>
            <label className="block cursor-pointer has-disabled:cursor-default">
              <span className="flex items-center gap-2">
                {/* A real radio, styled rather than hidden: visible controls are the ones a reader
                    and a test can both click. The name alone is its accessible name — the label
                    also carries the hint */}
                <input type="radio" name="axt-service" aria-label={card.name} checked={config.provider === card.id} disabled={card.disabled} onChange={() => choose(card.id)} className={RADIO} />
                <span className="text-[13px] font-semibold">{card.name}</span>
              </span>
              <span className="mt-0.5 block pl-[22px] text-[11px] text-fg-2">{card.hint}</span>
            </label>
            {'action' in card && card.action === 'download' && <Button variant="chip" className="mt-2" onClick={() => void fetchPack()}>{S.service.chrome_download}</Button>}
            {'action' in card && card.action === 'busy' && <span className="mt-2 block text-[11px] text-fg-2">{S.service.chrome_downloading}</span>}
          </div>
        ))}
      </div>

      <div className="mb-2 flex items-end justify-between">
        <h3 className="text-[14px] font-bold">{O.services.mine}</h3>
        <Button variant="chip" onClick={() => setEditing('new')}>{O.services.add}</Button>
      </div>
      <div className="mb-4 overflow-hidden rounded-card border border-line bg-card">
        {config.services.length === 0 && <p className="px-3.5 py-3 text-[12px] text-fg-2">{O.services.empty}</p>}
        {config.services.map((service, i) => (
          <div key={service.id} className={`flex items-center gap-2 ${i > 0 ? 'border-t border-line' : ''}`}>
            <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 px-3.5 py-3">
              <input type="radio" name="axt-service" aria-label={service.name} checked={config.provider === service.id} onChange={() => choose(service.id)} className={RADIO} />
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-[13px] font-semibold">{service.name}</span>
                <span className="truncate text-[11px] text-fg-2">{service.model} · {hostOf(service.baseURL)}</span>
              </span>
            </label>
            <Button variant="text" className="mr-2" onClick={() => setEditing(service.id)}>{O.services.edit}</Button>
          </div>
        ))}
      </div>
      <Row label={O.services.autoFallback} hint={O.services.autoFallbackHint}>
        <Switch checked={config.fallback.enabled} onChange={on => void patch(latest => ({ ...latest, fallback: { enabled: on } }))} label={O.services.autoFallback} />
      </Row>

      <h3 className="mb-2 mt-8 text-[14px] font-bold">{S.rows.language}</h3>
      <MenuField
        label={S.rows.language}
        value={label(config.targetLanguage)}
        search
        searchPlaceholder={S.menu.searchLanguages}
        empty={S.menu.noMatch}
        items={LANG_CODES.map(code => ({
          id: code,
          name: label(code),
          keywords: `${LANG_CODE_TO_EN_NAME[code]} ${LANG_CODE_TO_LOCALE_NAME[code]} ${LANG_CODE_TO_ZH_NAME[code]} ${code}`,
          selected: code === config.targetLanguage,
        }))}
        onSelect={id => void patch(latest => ({ ...latest, targetLanguage: id as LangCode }))}
      />

      <h3 className="mb-2 mt-8 text-[14px] font-bold">{S.rows.images}</h3>
      <div className="rounded-card border border-line bg-card px-3.5">
        <Row label={S.rows.images} hint="译文叠在图上，鼠标悬停查看原文">
          <Switch checked={config.image.enabled} onChange={on => void patch(latest => ({ ...latest, image: { ...latest.image, enabled: on } }))} label={S.rows.images} />
        </Row>
        <div className="border-t border-line py-3 text-[12px] leading-relaxed text-fg-2">
          {helper === null ? '正在检测识别助手…'
            : helper.available ? `识别助手已就绪 ${helper.version ?? ''}`
            : (
              <span className="flex flex-col gap-2">
                <span>{S.helper.install}</span>
                <span className="flex items-center gap-3">
                  <Button variant="solid" onClick={() => { void navigator.clipboard.writeText(helperInstallCommand(extensionId)); setCopied(true); setTimeout(() => setCopied(false), 1500) }}>{copied ? S.helper.copied : S.helper.copy}</Button>
                  <a className="text-[12px] font-semibold text-fg-2 hover:text-fg" href={HELPER_GUIDE_URL} target="_blank" rel="noreferrer">{S.helper.guide}</a>
                </span>
              </span>
            )}
        </div>
        <fieldset className="border-0 border-t border-line p-0 py-3">
          <legend className="p-0 text-[12px] font-semibold text-fg-2">在这些模式下显示图片译文</legend>
          <span className="mt-2 flex gap-4">
            {MODE_VALUES.map(mode => (
              <label key={mode} className="flex cursor-pointer items-center gap-1.5 text-[12px]">
                <input
                  type="checkbox"
                  className="accent-accent"
                  checked={config.image.modes.includes(mode)}
                  // The value has to be read here, not inside `patch`: that callback runs after a
                  // round trip through storage, by which time React has repainted the box from the
                  // config it still holds and `e.target.checked` is the old value again
                  onChange={e => { const on = e.target.checked; void patch(latest => ({ ...latest, image: { ...latest.image, modes: MODE_VALUES.filter(m => (m === mode ? on : latest.image.modes.includes(m))) } })) }}
                />
                {MODE_NAMES[mode]}
              </label>
            ))}
          </span>
          <span className="mt-2 block text-[11px] text-fg-2">只影响显示：切到没勾的模式时叠加层隐藏，切回来再显示，不重新识别</span>
        </fieldset>
      </div>

      {editing && <ServiceDrawer service={editingService} patch={patch} onClose={() => setEditing(null)} />}
    </>
  )
}

const hostOf = (url: string): string => {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}
