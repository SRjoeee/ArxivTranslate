// Add or edit one of the reader's services. The form is local until 「连接」: that click saves it,
// asks for the endpoint's origin if it is not one the manifest already has (a permission request
// needs a user gesture), and then translates one sample sentence through that service by name.
import { useState } from 'react'
import { getConfig } from '@/config/storage'
import type { Config } from '@/config/schema'
import { type Service, defaultServiceName, newServiceId, serviceSchema } from '@/config/services'
import { wireFormatOfProvider } from '@/providers/wire-formats'
import { sendMessage } from '@/shared/messages'
import { Button } from '@/ui/Button'
import { Confirm } from '@/ui/Confirm'
import { Drawer } from '@/ui/Drawer'
import { Field, inputClass } from '@/ui/Field'
import { Switch } from '@/ui/Switch'
import { O, reasonText } from '@/ui/strings'
import { ensureHostPermission, releaseHostPermission } from '../permissions'

/** The sample says whether the endpoint keeps our placeholders, so it is written in this service's wire format */
const SAMPLE_TAGS = 'Let <x id="1"/> be a <t id="2">connected</t> graph; see <x id="3"/>.'
const SAMPLE_MARKERS = 'Let @a# be a connected graph; see @b#.'

const BLANK: Omit<Service, 'id'> = { kind: 'openai-compat', name: '', baseURL: 'https://openrouter.ai/api/v1', apiKey: '', model: '', thinking: 'disabled' }

const isLoopback = (baseURL: string): boolean => {
  try {
    const host = new URL(baseURL).hostname
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]'
  } catch {
    return false
  }
}

export function ServiceDrawer({ service, patch, onClose }: {
  /** null = a new one */
  service: Service | null
  patch: (fn: (latest: Config) => Config) => Promise<Config>
  onClose: () => void
}) {
  const [form, setForm] = useState<Omit<Service, 'id'>>(service ? { ...service } : BLANK)
  // An empty box means "leave the stored key alone"; a key is written, never read back
  const [keyInput, setKeyInput] = useState('')
  const [more, setMore] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState('')
  const stored = service?.apiKey ?? ''

  const set = (over: Partial<Service>) => setForm(f => ({ ...f, ...over }))

  async function connect() {
    setBusy(true)
    setResult('')
    const t0 = performance.now()
    try {
      const id = service?.id ?? newServiceId()
      const next: Service = { ...form, id, name: form.name.trim() || defaultServiceName(form.model), apiKey: keyInput || stored }
      const parsed = serviceSchema.safeParse(next)
      if (!parsed.success) throw new Error(parsed.error.issues.map(i => `${i.path.join('.')}：${i.message}`).join('；'))
      // 先校验再申请权限：字段有错时不该先把 host 权限拿到手（Codex 在 #6 指出）
      await ensureHostPermission(parsed.data.baseURL)
      const previous = service?.baseURL
      const saved = await patch(latest => {
        const services = service ? latest.services.map(s => (s.id === id ? parsed.data : s)) : [...latest.services, parsed.data]
        return { ...latest, services, provider: id }
      })
      if (previous) await releaseHostPermission(previous, saved.services.map(s => s.baseURL))
      setKeyInput('')

      // Name the engine: the question is whether *this* endpoint answers, and going down the chain
      // would report success for a broken one (Codex on #59). background reads storage, so this
      // must run after the save
      const current = await getConfig()
      const res = await sendMessage({
        type: 'axt:translate',
        providerId: id,
        request: { segments: [{ id: 'sample', text: wireFormatOfProvider(id) === 'markers' ? SAMPLE_MARKERS : SAMPLE_TAGS }], source: 'en', target: current.targetLanguage, context: { sectionTitle: O.services.connect } },
      })
      setResult(res.ok ? O.services.connected(Math.round(performance.now() - t0)) : reasonText(res.error.kind) || res.error.message)
    } catch (e) {
      setResult(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!service) return
    const saved = await patch(latest => ({
      ...latest,
      services: latest.services.filter(s => s.id !== service.id),
      // A deleted service cannot stay chosen; the shipped free one takes over
      provider: latest.provider === service.id ? 'microsoft' : latest.provider,
    }))
    await releaseHostPermission(service.baseURL, saved.services.map(s => s.baseURL))
    onClose()
  }

  return (
    <Drawer
      title={service ? O.services.editTitle : O.services.newTitle}
      onClose={onClose}
      footer={<>
        <Button variant="solid" disabled={busy} onClick={() => void connect()}>{busy ? O.services.connecting : O.services.connect}</Button>
        {service && <Confirm label={O.services.delete} confirmLabel={O.services.deleteConfirm} cancelLabel={O.services.cancel} onConfirm={() => void remove()} />}
        {result && <span className="min-w-0 flex-1 truncate text-right text-[12px] text-fg-2">{result}</span>}
      </>}
    >
      <Field label={O.services.name}>
        <input className={inputClass} value={form.name} placeholder={O.services.namePlaceholder} onChange={e => set({ name: e.target.value })} />
      </Field>
      <Field label={O.services.baseURL} hint={O.services.baseURLHint}>
        <input className={inputClass} value={form.baseURL} placeholder="https://openrouter.ai/api/v1" onChange={e => set({ baseURL: e.target.value })} />
      </Field>
      <Field label={O.services.apiKey} hint={isLoopback(form.baseURL) ? O.services.apiKeyLocalHint : undefined}>
        <span className="flex items-center gap-2">
          <input className={inputClass} type="password" autoComplete="off" value={keyInput} placeholder={stored ? '••••••••' : 'sk-…'} onChange={e => setKeyInput(e.target.value)} />
          {stored && <Button variant="text" onClick={() => { setKeyInput(''); set({ apiKey: '' }) }}>{O.services.apiKeyClear}</Button>}
        </span>
      </Field>
      <Field label={O.services.model}>
        <input className={inputClass} value={form.model} placeholder="deepseek/deepseek-v4-flash" onChange={e => set({ model: e.target.value })} />
      </Field>
      <button type="button" aria-expanded={more} onClick={() => setMore(v => !v)} className="flex cursor-pointer items-center gap-1 text-[12px] font-semibold text-fg-2">
        <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={more ? 'rotate-90' : ''}><path d="m9 6 6 6-6 6" /></svg>
        {O.services.more}
      </button>
      {more && (
        <div className="mt-3 flex items-center justify-between">
          <span className="flex flex-col">
            <span className="text-[13px] font-semibold">{O.services.thinking}</span>
            <span className="text-[11px] text-fg-2">{O.services.thinkingHint}</span>
          </span>
          <Switch checked={form.thinking === 'enabled'} onChange={on => set({ thinking: on ? 'enabled' : 'disabled' })} label={O.services.thinking} />
        </div>
      )}
    </Drawer>
  )
}
