// Add or edit one of the reader's services. The form is local until “Connect”: that click saves it,
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
import { PermissionError, ensureHostPermission, releaseHostPermission } from '../permissions'

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
   * The id this drawer is editing. A drawer opened with “Add a service” has none until the first “Connect”
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
   * fallback has to be the **form's** key, not the one this drawer opened with: “Clear” empties the
   * form, and reading the prop instead would write the old key straight back (and after a save,
   * a second “Connect” would undo the new one).
   */
  const keyToSave = () => keyInput || form.apiKey

  const set = (over: Partial<Service>) => setForm(f => ({ ...f, ...over }))

  async function connect() {
    setBusy(true)
    setResult('')
    const t0 = performance.now()
    /** Whether this attempt is what granted the origin, so a failure can give it back */
    let granted = false
    try {
      const saving = id ?? newServiceId()
      const next: Service = { ...form, id: saving, name: form.name.trim() || defaultServiceName(form.model), apiKey: keyToSave() }
      const parsed = serviceSchema.safeParse(next)
      if (!parsed.success) throw new Error(parsed.error.issues.map(i => `${i.path.join('.')}：${i.message}`).join('；'))
      const value = parsed.data
      // Validate before asking for the permission: with a field wrong, the host permission must not be taken first (Codex on #6)
      granted = await ensureHostPermission(value.baseURL)
      await patch(latest => {
        const known = latest.services.some(s => s.id === saving)
        const services = known
          ? latest.services.map(s => (s.id === saving ? value : s))
          : [...latest.services, value]
        // Adding one selects it; editing one does not. The radio beside each row is what chooses,
        // and “Connect” only promises to save and test the endpoint named here — editing a spare service
        // must not quietly change what the next page translates with (Codex on #157)
        return { ...latest, services, provider: known ? latest.provider : saving }
      })
      granted = false // the save went through; the permission belongs to a stored service now
      setId(saving)
      setSavedURL(value.baseURL)
      // The form now holds what storage holds, so a second “Connect” saves the same thing
      setForm(value)
      setKeyInput('')

      // Name the engine: the question is whether *this* endpoint answers, and going down the chain
      // would report success for a broken one (Codex on #59). Ask background to rebuild and wait for
      // its answer, rather than polling for a status that already looks right: editing a service
      // keeps its id, so "the chain reports this id" is true of the old chain too (Codex on #157).
      // No session is moved: a page translating on this service keeps the chain it started on
      await sendMessage({ type: 'axt:engine-ready', id: saving }).catch(() => undefined)
      const current = await getConfig()
      const res = await sendMessage({
        type: 'axt:translate',
        providerId: saving,
        request: { segments: [{ id: 'sample', text: wireFormatOfProvider(saving) === 'markers' ? SAMPLE_MARKERS : SAMPLE_TAGS }], source: 'en', target: current.targetLanguage, context: { sectionTitle: O.services.connect } },
      })
      setResult(res.ok ? O.services.connected(Math.round(performance.now() - t0)) : reasonText(res.error.kind) || res.error.message)
    } catch (e) {
      // Nothing was stored, so an origin this attempt asked for should not stay granted — the
      // schema's service limit and any storage failure both land here (Codex on #157)
      if (granted) await releaseHostPermission(form.baseURL, (await getConfig()).services.map(s => s.baseURL)).catch(() => undefined)
      // The permission request only says which kind; the sentence is in the locale pack (Codex on #161)
      setResult(e instanceof PermissionError
        ? (e.kind === 'badURL' ? O.services.permission.badURL : O.services.permission.denied(e.origin ?? ''))
        : e instanceof Error ? e.message : String(e))
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
    // A page translating in another tab is pinned to the chain it started on, so a deleted service
    // would go on spending its key whenever the reader scrolls (Codex on #157). This is the one
    // action that moves every session: the service has to stop serving everywhere, which outweighs
    // moving an unrelated tab onto another chain
    await sendMessage({ type: 'axt:engine-ready', id: gone, rebindAll: true }).catch(() => undefined)
    // Only deletion gives an origin back, and only **after** the rebind above has taken every
    // session off this service: releasing it first would break the requests still in flight, and an
    // **edit** must keep the origin, because a page pinned to the old chain still fetches it
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
