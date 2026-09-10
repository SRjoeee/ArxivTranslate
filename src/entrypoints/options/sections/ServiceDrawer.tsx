// Add or edit one of the reader's services. The form is local until 「连接」: that click saves it,
// asks for the endpoint's origin if it is not one the manifest already has (a permission request
// needs a user gesture), and then translates one sample sentence through that service by name.
import { useState } from 'react'
import { getConfig } from '@/config/storage'
import type { Config } from '@/config/schema'
import { type Service, defaultServiceName, newServiceId, serviceSchema } from '@/config/services'
import { wireFormatOfProvider } from '@/providers/wire-formats'
import { awaitChain } from '@/shared/chain'
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
  /**
   * The id this drawer is editing. A drawer opened with 添加服务 has none until the first 连接
   * saves one — and it has to keep that id, or a second press would generate another and append a
   * duplicate instead of updating what was just saved (Codex on #157)
   */
  const [id, setId] = useState<string | null>(service?.id ?? null)
  /** The endpoint currently in storage for this service, so an origin can be given back when it changes */
  const [savedURL, setSavedURL] = useState<string | null>(service?.baseURL ?? null)
  // An empty box means "leave the stored key alone"; a key is written, never read back
  const [keyInput, setKeyInput] = useState('')
  const [more, setMore] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState('')
  /**
   * The key the form would save right now. An empty box means "leave the stored one alone", so the
   * fallback has to be the **form's** key, not the one this drawer opened with: 清除 empties the
   * form, and reading the prop instead would write the old key straight back (and after a save,
   * a second 连接 would undo the new one).
   */
  const keyToSave = () => keyInput || form.apiKey

  const set = (over: Partial<Service>) => setForm(f => ({ ...f, ...over }))

  async function connect() {
    setBusy(true)
    setResult('')
    const t0 = performance.now()
    try {
      const saving = id ?? newServiceId()
      const next: Service = { ...form, id: saving, name: form.name.trim() || defaultServiceName(form.model), apiKey: keyToSave() }
      const parsed = serviceSchema.safeParse(next)
      if (!parsed.success) throw new Error(parsed.error.issues.map(i => `${i.path.join('.')}：${i.message}`).join('；'))
      // 先校验再申请权限：字段有错时不该先把 host 权限拿到手（Codex 在 #6 指出）
      await ensureHostPermission(parsed.data.baseURL)
      const previous = savedURL
      const saved = await patch(latest => {
        const services = latest.services.some(s => s.id === saving)
          ? latest.services.map(s => (s.id === saving ? parsed.data : s))
          : [...latest.services, parsed.data]
        return { ...latest, services, provider: saving }
      })
      setId(saving)
      setSavedURL(parsed.data.baseURL)
      if (previous) await releaseHostPermission(previous, saved.services.map(s => s.baseURL))
      // The form now holds what storage holds, so a second 连接 saves the same thing
      setForm(parsed.data)
      setKeyInput('')

      // Name the engine: the question is whether *this* endpoint answers, and going down the chain
      // would report success for a broken one (Codex on #59). background rebuilds its chain from a
      // storage event, so wait for it to report this service — otherwise a new one comes back as
      // "not on the current chain" and an edited one is tested at its old endpoint (Codex on #157)
      await awaitChain(s => s.providerId === saving)
      const current = await getConfig()
      const res = await sendMessage({
        type: 'axt:translate',
        providerId: saving,
        request: { segments: [{ id: 'sample', text: wireFormatOfProvider(saving) === 'markers' ? SAMPLE_MARKERS : SAMPLE_TAGS }], source: 'en', target: current.targetLanguage, context: { sectionTitle: O.services.connect } },
      })
      setResult(res.ok ? O.services.connected(Math.round(performance.now() - t0)) : reasonText(res.error.kind) || res.error.message)
    } catch (e) {
      setResult(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!id) return
    const gone = id
    const saved = await patch(latest => ({
      ...latest,
      services: latest.services.filter(s => s.id !== gone),
      // A deleted service cannot stay chosen; the shipped free one takes over
      provider: latest.provider === gone ? 'microsoft' : latest.provider,
    }))
    if (savedURL) await releaseHostPermission(savedURL, saved.services.map(s => s.baseURL))
    onClose()
  }

  return (
    <Drawer
      title={service ? O.services.editTitle : O.services.newTitle}
      onClose={onClose}
      footer={<>
        <Button variant="solid" disabled={busy} onClick={() => void connect()}>{busy ? O.services.connecting : O.services.connect}</Button>
        {id && <Confirm label={O.services.delete} confirmLabel={O.services.deleteConfirm} cancelLabel={O.services.cancel} onConfirm={() => void remove()} />}
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
          <input className={inputClass} type="password" autoComplete="off" value={keyInput} placeholder={form.apiKey ? '••••••••' : 'sk-…'} onChange={e => setKeyInput(e.target.value)} />
          {form.apiKey && <Button variant="text" onClick={() => { setKeyInput(''); set({ apiKey: '' }) }}>{O.services.apiKeyClear}</Button>}
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
