# Settings: user-added services and appearance profiles — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the options page on the popup's design system with user-added OpenAI-compatible services and editable appearance profiles (translation style, hover band), effective at once.

**Architecture:** Config v12 replaces the single `openaiCompat` with `services[]` and the preset-based `style` with `appearance` (two profile lists). Engines resolve a service id to an OpenAI-compatible provider whose `id` is the service id, so chain, status and cache keys need no special cases. The renderer's style contract shrinks to two `<html>` attributes plus variables; one `applyStyle` path serves the page and the settings preview. The options page is a nav with four sections and a shared drawer; the appearance editor is a small component family under `src/ui/appearance/`.

**Tech Stack:** WXT + React + TypeScript, Tailwind v4 on the `--axt-*` tokens (`src/styles/ui.css`), zod, Vitest + happy-dom, Playwright e2e.

**Spec:** `docs/superpowers/specs/2026-09-10-settings-services-appearance-design.md`

## Global Constraints

- Everything developer-facing (comments, tests, commits, docs) in English; product copy in Chinese, product register (no 去填 / 去修 / 没翻出来; buttons are nouns or verbs).
- No `helper` / `provider` / `engine` / `fallback` / 降级 in reader-visible strings (`tests/ui/strings.test.ts` guards the popup strings; keep the options page to the same words).
- API keys never enter logs, cache keys, fixtures or git (CLAUDE.md rule 7).
- Prefixes `axt-` / `data-axt-` / `--axt-`; `ltx_*` selectors only in `src/core/rules/latexml.ts` (and `src/styles/*.css`).
- Never `git add -A`; never commit `docs/design/canvas/*`; commit to `ui/phase-1`, no PR (Phase 1 workflow).
- Gate before every commit: `pnpm lint && pnpm test && pnpm build` with real exit codes (`cmd > log; echo $?`).
- Changes take effect at once on the options page; drawers commit with one button (连接 / 完成).
- The DOM invariants of DESIGN §7.1 stay: appearance is attributes on `<html>` and one injected `<style>`.

---

### Task 1: Config v12 — services, appearance profiles, migration

**Files:**
- Create: `src/config/services.ts`
- Create: `src/config/appearance.ts`
- Modify: `src/config/schema.ts` (`provider`, remove `openaiCompat` and `style`, add `services`, `appearance`, `CONFIG_VERSION = 12`, `DEFAULT_CONFIG`)
- Modify: `src/config/storage.ts` (migration 12)
- Test: `tests/config/storage.test.ts`, `tests/config/appearance.test.ts`

**Interfaces:**
- Produces:
  - `services.ts`: `BUILT_IN_SERVICES = ['microsoft', 'google-web', 'chrome-builtin'] as const`, `type BuiltInService`, `isBuiltInService(id: string): id is BuiltInService`, `serviceSchema`, `type Service`, `newServiceId(): string` (`svc-` + 8 chars of `[a-z0-9]`), `serviceOf(config: Pick<Config, 'services'>, id: string): Service | undefined`, `chosenService(config): Service | undefined`, `isLlmChosen(config): boolean`.
  - `appearance.ts`: `UNDERLINES = ['none', 'solid', 'dotted', 'dashed', 'wavy'] as const`, `styleProfileSchema`, `highlightProfileSchema`, `appearanceSchema`, types `StyleProfile`, `HighlightProfile`, `Appearance`, constants `BUILT_IN_STYLES`, `BUILT_IN_HIGHLIGHTS`, `PALETTE` (8 colours), `HL_OPACITY_MIN = 0.05`, `HL_OPACITY_MAX = 0.6`, functions `activeStyle(a: Appearance): StyleProfile`, `activeHighlight(a: Appearance): HighlightProfile`, `newProfileId(prefix: 'style' | 'hl'): string`, `resetBuiltIns(a: Appearance): Appearance`, `duplicateStyle(p: StyleProfile): StyleProfile`.
  - `schema.ts`: `Config.provider: string`, `Config.services: Service[]`, `Config.appearance: Appearance`; `openaiCompat` and `style` are gone.

- [ ] **Step 1: Write the failing tests**

`tests/config/appearance.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { BUILT_IN_HIGHLIGHTS, BUILT_IN_STYLES, PALETTE, activeHighlight, activeStyle, appearanceSchema, resetBuiltIns } from '@/config/appearance'
import { DEFAULT_CONFIG } from '@/config/schema'

describe('appearance profiles', () => {
  it('ships six styles and three highlights, with the follow-original style and the soft green band active', () => {
    expect(BUILT_IN_STYLES.map(s => s.id)).toEqual(['follow', 'green', 'blue', 'amber', 'muted', 'blur'])
    expect(BUILT_IN_HIGHLIGHTS.map(h => h.id)).toEqual(['soft-green', 'sand', 'sky'])
    expect(DEFAULT_CONFIG.appearance.activeStyle).toBe('follow')
    expect(DEFAULT_CONFIG.appearance.activeHighlight).toBe('soft-green')
    expect(PALETTE).toHaveLength(8)
  })
  it('falls back to the first built-in when the active id is gone', () => {
    const a = { ...DEFAULT_CONFIG.appearance, activeStyle: 'deleted', activeHighlight: 'deleted' }
    expect(activeStyle(a).id).toBe('follow')
    expect(activeHighlight(a).id).toBe('soft-green')
  })
  it('reset restores edited and deleted built-ins and keeps the reader\'s own', () => {
    const own = { id: 'style-abc12345', name: '我的', color: '#123456', opacity: 1, underline: 'none' as const, thickness: 1 as const, blur: false, css: '' }
    const a = { ...DEFAULT_CONFIG.appearance, styles: [{ ...BUILT_IN_STYLES[0]!, color: '#ff0000' }, own], highlights: [] }
    const r = resetBuiltIns(a)
    expect(r.styles.map(s => s.id)).toEqual([...BUILT_IN_STYLES.map(s => s.id), own.id])
    expect(r.styles[0]!.color).toBe('')
    expect(r.highlights.map(h => h.id)).toEqual(BUILT_IN_HIGHLIGHTS.map(h => h.id))
  })
  it('rejects a bad colour, an opacity out of range, and a css block with braces', () => {
    const base = DEFAULT_CONFIG.appearance
    const bad = (patch: object) => appearanceSchema.safeParse({ ...base, styles: [{ ...BUILT_IN_STYLES[0]!, ...patch }] }).success
    expect(bad({ color: 'red;' })).toBe(false)
    expect(bad({ opacity: 0.1 })).toBe(false)
    expect(bad({ css: 'color: red }' })).toBe(false)
    expect(bad({ underline: 'double' })).toBe(false)
  })
})
```

In `tests/config/storage.test.ts`, replace every `openaiCompat` reference in the v1…v11 migration tests by the service the migration creates (they all carry `apiKey: 'sk-keep'`), e.g. `expect(c.openaiCompat.apiKey).toBe('sk-keep')` → `expect(c.services[0]?.apiKey).toBe('sk-keep')`, and add:

```ts
  it('v11 to v12: the single endpoint becomes a service and is chosen; presets map to profiles', async () => {
    const v11 = (over: object) => ({
      version: 11, provider: 'openai-compat',
      openaiCompat: { baseURL: 'https://openrouter.ai/api/v1', apiKey: 'sk-keep', model: 'deepseek/deepseek-v4-flash', thinking: 'disabled' },
      targetLanguage: 'cmn', mode: 'side', prompts: { promptId: 'default', patterns: [] },
      preload: { margin: 1000, threshold: 0 }, fallback: { enabled: true }, glossary: [],
      style: { preset: 'none', customCss: '', color: '', opacity: 1, accent: '' }, reading: { sentenceHighlight: true }, image: { enabled: true, modes: ['stack', 'side', 'only'] },
      ...over,
    })
    const load = async (stored: object) => {
      await fakeBrowser.storage.local.set({ config: stored, config$: { v: 11 } })
      vi.resetModules()
      return (await import('@/config/storage')).getConfig()
    }
    const c = await load(v11({}))
    expect(c.version).toBe(CONFIG_VERSION)
    expect(c.services).toHaveLength(1)
    expect(c.services[0]).toMatchObject({ kind: 'openai-compat', name: 'deepseek-v4-flash', apiKey: 'sk-keep', model: 'deepseek/deepseek-v4-flash' })
    expect(c.provider).toBe(c.services[0]!.id)
    expect(c.appearance.activeStyle).toBe('follow')
    expect(c.appearance.activeHighlight).toBe('soft-green')
    // Another provider with the endpoint untouched: no service
    const free = await load(v11({ provider: 'microsoft', openaiCompat: { baseURL: 'https://openrouter.ai/api/v1', apiKey: '', model: 'deepseek/deepseek-v4-flash', thinking: 'disabled' } }))
    expect(free.services).toEqual([])
    expect(free.provider).toBe('microsoft')
    // Presets
    const dashed = await load(v11({ style: { preset: 'dashed-bold', customCss: '', color: '#112233', opacity: 0.8, accent: '' } }))
    expect(dashed.appearance.styles.find(s => s.id === dashed.appearance.activeStyle)).toMatchObject({ underline: 'dashed', thickness: 2, color: '#112233', opacity: 0.8 })
    const blur = await load(v11({ style: { preset: 'blur', customCss: '', color: '', opacity: 1, accent: '' } }))
    expect(blur.appearance.activeStyle).toBe('blur')
    const custom = await load(v11({ style: { preset: 'custom', customCss: 'font-style: italic', color: '', opacity: 1, accent: '' } }))
    expect(custom.appearance.styles.find(s => s.id === custom.appearance.activeStyle)).toMatchObject({ name: '自定义', css: 'font-style: italic' })
    const marker = await load(v11({ style: { preset: 'marker', customCss: '', color: '', opacity: 1, accent: '#ff8800' } }))
    expect(marker.appearance.activeStyle).toBe('follow')
    expect(marker.appearance.highlights.find(h => h.id === marker.appearance.activeHighlight)).toMatchObject({ color: '#ff8800', opacity: 0.22 })
  })
```

- [ ] **Step 2: Run the tests, expect failures** (`pnpm vitest run tests/config`) — the modules do not exist.

- [ ] **Step 3: `src/config/services.ts`**

```ts
// User-added translation services (spec §2). One kind today; the field is there so native kinds
// can be added without a migration.
import { z } from 'zod'
import type { Config } from './schema'

export const BUILT_IN_SERVICES = ['microsoft', 'google-web', 'chrome-builtin'] as const
export type BuiltInService = (typeof BUILT_IN_SERVICES)[number]
export const isBuiltInService = (id: string): id is BuiltInService => (BUILT_IN_SERVICES as readonly string[]).includes(id)

export const SERVICE_ID_RE = /^svc-[a-z0-9]{8}$/

export const serviceSchema = z.object({
  id: z.string().regex(SERVICE_ID_RE),
  kind: z.literal('openai-compat'),
  name: z.string().min(1).max(40),
  baseURL: z.url(),
  /** Stored locally only; never in logs, cache keys or fixtures (CLAUDE.md rule 7) */
  apiKey: z.string(),
  model: z.string().min(1),
  thinking: z.enum(['enabled', 'disabled']).default('disabled'),
})
export type Service = z.infer<typeof serviceSchema>

export function newServiceId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  return `svc-${Array.from(bytes, b => chars[b % chars.length]).join('')}`
}

export function serviceOf(config: Pick<Config, 'services'>, id: string): Service | undefined {
  return config.services.find(s => s.id === id)
}
export const chosenService = (config: Pick<Config, 'services' | 'provider'>) => serviceOf(config, config.provider)
export const isLlmChosen = (config: Pick<Config, 'services' | 'provider'>) => chosenService(config) !== undefined

/** The service's default name: the model's last segment (`deepseek/deepseek-v4-flash` → `deepseek-v4-flash`) */
export const defaultServiceName = (model: string) => model.split('/').pop() || model
```

- [ ] **Step 4: `src/config/appearance.ts`**

```ts
// Appearance profiles (spec §3): the reader's own list of translation styles and hover bands.
// The built-ins are ordinary entries with fixed ids, so they can be edited, deleted and restored.
import { z } from 'zod'
import { COLOR_MAX, OPACITY_MAX, OPACITY_MIN, sanitizeColor, sanitizeCustomCss } from '@/core/renderer/style-preset'

export const UNDERLINES = ['none', 'solid', 'dotted', 'dashed', 'wavy'] as const
export type Underline = (typeof UNDERLINES)[number]
export const HL_OPACITY_MIN = 0.05
export const HL_OPACITY_MAX = 0.6

const colorField = z.string().max(COLOR_MAX).refine(v => sanitizeColor(v).ok, '不是有效的颜色值')
const idField = z.string().min(1).max(40)

export const styleProfileSchema = z.object({
  id: idField,
  name: z.string().min(1).max(40),
  /** '' = follow the original text */
  color: colorField,
  opacity: z.number().min(OPACITY_MIN).max(OPACITY_MAX),
  underline: z.enum(UNDERLINES),
  thickness: z.union([z.literal(1), z.literal(2)]),
  /** Blurred until hovered */
  blur: z.boolean(),
  /** 高级: declarations only; the selector is the extension's */
  css: z.string().max(2000).refine(v => sanitizeCustomCss(v).ok, '只填声明，不写选择器和花括号'),
})
export type StyleProfile = z.infer<typeof styleProfileSchema>

export const highlightProfileSchema = z.object({
  id: idField,
  name: z.string().min(1).max(40),
  /** '' = the default green */
  color: colorField,
  opacity: z.number().min(HL_OPACITY_MIN).max(HL_OPACITY_MAX),
})
export type HighlightProfile = z.infer<typeof highlightProfileSchema>

export const appearanceSchema = z.object({
  styles: z.array(styleProfileSchema).max(50),
  activeStyle: idField,
  highlights: z.array(highlightProfileSchema).max(50),
  activeHighlight: idField,
})
export type Appearance = z.infer<typeof appearanceSchema>

const style = (id: string, name: string, over: Partial<StyleProfile> = {}): StyleProfile =>
  ({ id, name, color: '', opacity: 1, underline: 'none', thickness: 1, blur: false, css: '', ...over })

/** Read Frog's green (custom-translation-node.css); the others were picked against arXiv's white and its dark theme */
export const GREEN = 'oklch(0.693 0.17 162.48)'
export const BUILT_IN_STYLES: readonly StyleProfile[] = [
  style('follow', '与原文相同'),
  style('green', '绿色', { color: GREEN }),
  style('blue', '蓝色', { color: 'oklch(0.62 0.15 250)' }),
  style('amber', '琥珀', { color: 'oklch(0.7 0.14 70)' }),
  style('muted', '淡一档', { opacity: 0.7 }),
  style('blur', '模糊', { blur: true }),
]
export const BUILT_IN_HIGHLIGHTS: readonly HighlightProfile[] = [
  { id: 'soft-green', name: '柔和绿', color: GREEN, opacity: 0.22 },
  { id: 'sand', name: '淡黄', color: 'oklch(0.85 0.12 85)', opacity: 0.3 },
  { id: 'sky', name: '淡蓝', color: 'oklch(0.75 0.12 240)', opacity: 0.25 },
]
/** Eight swatches for text and bands, readable on both arXiv backgrounds */
export const PALETTE: readonly string[] = [GREEN, 'oklch(0.62 0.15 250)', 'oklch(0.7 0.14 70)', 'oklch(0.6 0.18 25)', 'oklch(0.6 0.16 300)', 'oklch(0.7 0.12 190)', 'oklch(0.55 0.02 260)', 'oklch(0.75 0.12 240)']

export const DEFAULT_APPEARANCE: Appearance = { styles: [...BUILT_IN_STYLES], activeStyle: 'follow', highlights: [...BUILT_IN_HIGHLIGHTS], activeHighlight: 'soft-green' }

export const activeStyle = (a: Appearance): StyleProfile => a.styles.find(s => s.id === a.activeStyle) ?? a.styles[0] ?? BUILT_IN_STYLES[0]!
export const activeHighlight = (a: Appearance): HighlightProfile => a.highlights.find(h => h.id === a.activeHighlight) ?? a.highlights[0] ?? BUILT_IN_HIGHLIGHTS[0]!

export function newProfileId(prefix: 'style' | 'hl'): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  return `${prefix}-${Array.from(bytes, b => chars[b % chars.length]).join('')}`
}

/** Built-ins back to their shipped values, in their shipped order, the reader's own after them */
export function resetBuiltIns(a: Appearance): Appearance {
  const builtInStyleIds = new Set(BUILT_IN_STYLES.map(s => s.id))
  const builtInHlIds = new Set(BUILT_IN_HIGHLIGHTS.map(h => h.id))
  return {
    styles: [...BUILT_IN_STYLES, ...a.styles.filter(s => !builtInStyleIds.has(s.id))],
    activeStyle: a.activeStyle,
    highlights: [...BUILT_IN_HIGHLIGHTS, ...a.highlights.filter(h => !builtInHlIds.has(h.id))],
    activeHighlight: a.activeHighlight,
  }
}

export const duplicateStyle = (p: StyleProfile): StyleProfile => ({ ...p, id: newProfileId('style'), name: `${p.name} 副本` })
export const duplicateHighlight = (p: HighlightProfile): HighlightProfile => ({ ...p, id: newProfileId('hl'), name: `${p.name} 副本` })
```

- [ ] **Step 5: `src/config/schema.ts`**

Replace `provider` and `openaiCompat`, and `style`:

```ts
import { BUILT_IN_SERVICES, SERVICE_ID_RE, serviceSchema } from './services'
import { DEFAULT_APPEARANCE, appearanceSchema } from './appearance'

export const CONFIG_VERSION = 12
// …
  /** A built-in id or the id of one of `services` (spec §2) */
  provider: z.string().refine(v => (BUILT_IN_SERVICES as readonly string[]).includes(v) || SERVICE_ID_RE.test(v), '不是有效的翻译服务'),
  services: z.array(serviceSchema).max(20).default([]),
  // …
  /** Appearance profiles (§7.5, v12): the reader's style list and band list */
  appearance: appearanceSchema.default(DEFAULT_APPEARANCE),
```

Remove `STYLE_PRESETS` / `COLOR_MAX` / `OPACITY_*` imports that are no longer needed; `DEFAULT_CONFIG` gets `services: []`, `appearance: DEFAULT_APPEARANCE`, no `openaiCompat`, no `style`. The circular import (`services.ts` imports the `Config` type from `schema.ts`) is type-only; keep it `import type`.

- [ ] **Step 6: migration 12 in `src/config/storage.ts`**

```ts
    // v11 -> v12: user-added services replace the single endpoint; appearance profiles replace the
    // preset. Total: every v11 value maps somewhere (spec §5), so nothing falls back to defaults
    12: (v11: Omit<Config, 'version' | 'services' | 'appearance'> & { version: 11; openaiCompat: { baseURL: string; apiKey: string; model: string; thinking?: 'enabled' | 'disabled' }; style: { preset: string; customCss: string; color: string; opacity: number; accent: string } }) => {
      const { openaiCompat, style, ...rest } = v11
      const edited = openaiCompat.apiKey !== '' || openaiCompat.baseURL !== 'https://openrouter.ai/api/v1' || openaiCompat.model !== 'deepseek/deepseek-v4-flash'
      const wasLlm = v11.provider === 'openai-compat'
      const services = wasLlm || edited
        ? [{ id: newServiceId(), kind: 'openai-compat' as const, name: defaultServiceName(openaiCompat.model), baseURL: openaiCompat.baseURL, apiKey: openaiCompat.apiKey, model: openaiCompat.model, thinking: openaiCompat.thinking ?? 'disabled' }]
        : []
      const provider = wasLlm ? services[0]!.id : v11.provider
      return { ...rest, version: 12 as const, provider, services, appearance: migrateStyle(style) }
    },
```

with, above `configItem`:

```ts
/** v11 `style` → a profile list (spec §5). Underline presets become fields of a copy of 与原文相同; the removed effects keep their colour */
function migrateStyle(style: { preset: string; customCss: string; color: string; opacity: number; accent: string }): Appearance {
  const a: Appearance = { ...DEFAULT_APPEARANCE, styles: [...BUILT_IN_STYLES], highlights: [...BUILT_IN_HIGHLIGHTS] }
  const underline: Record<string, { underline: StyleProfile['underline']; thickness: 1 | 2 }> = {
    underline: { underline: 'solid', thickness: 1 }, dotted: { underline: 'dotted', thickness: 1 }, dashed: { underline: 'dashed', thickness: 1 },
    'dashed-bold': { underline: 'dashed', thickness: 2 }, wavy: { underline: 'wavy', thickness: 1 }, 'wavy-bold': { underline: 'wavy', thickness: 2 },
  }
  const vars = { color: style.color, opacity: style.opacity }
  const own = (name: string, over: Partial<StyleProfile>): string => {
    const id = newProfileId('style')
    a.styles = [...a.styles, { ...BUILT_IN_STYLES[0]!, ...vars, ...over, id, name }]
    return id
  }
  if (style.preset in underline) a.activeStyle = own('下划线', underline[style.preset]!)
  else if (style.preset === 'custom') a.activeStyle = own('自定义', { css: style.customCss })
  else if (style.preset === 'blur' || style.preset === 'green' || style.preset === 'muted') {
    a.activeStyle = style.preset
    a.styles = a.styles.map(s => (s.id === style.preset ? { ...s, ...(style.color ? { color: style.color } : {}), opacity: style.opacity } : s))
  } else {
    a.activeStyle = 'follow'
    a.styles = a.styles.map(s => (s.id === 'follow' ? { ...s, ...vars } : s))
  }
  if (style.accent) {
    const id = newProfileId('hl')
    a.highlights = [...a.highlights, { id, name: '自定义', color: style.accent, opacity: 0.22 }]
    a.activeHighlight = id
  }
  return a
}
```

- [ ] **Step 7: Run `pnpm vitest run tests/config`** — expect green; then `npx tsc --noEmit -p .` will list every consumer of `openaiCompat` / `style` (Tasks 2–7 fix them). Do not commit yet if tsc is red? **Commit anyway on this task's tests** is not acceptable for the gate; so this task ends with Task 2 and Task 3 in the same commit series — see Task 3 Step 8.

---

### Task 2: Engines on N services

**Files:**
- Modify: `src/providers/model.ts` (`OpenAICompatConfig` gains optional `id`, `name`)
- Modify: `src/providers/openai-compat.ts` (`id: config.id ?? 'openai-compat'`, `displayName: config.name ?? 'LLM'`)
- Modify: `src/providers/wire-formats.ts`, `src/providers/index.ts`, `src/providers/transport.ts`
- Modify: `src/ui/strings.ts` (`serviceName(id, services)`)
- Test: `tests/config/storage.test.ts` (provider selection), `tests/providers/transport.test.ts`, `tests/providers/wire-formats.test.ts`, `tests/providers/negotiate.test.ts`

**Interfaces:**
- Produces: `getProvider(config)` resolves a service id; `wireFormatOfProvider(id, services)`; `serviceName(id: string, services?: readonly { id: string; name: string }[]): string`; `CHAIN_CONFIG_FIELDS = ['provider', 'services', 'prompts', 'targetLanguage', 'fallback']`, `VOLATILE_CONFIG_FIELDS = ['version', 'mode', 'glossary', 'appearance', 'preload', 'image', 'reading']`.

- [ ] **Step 1: tests** — in `tests/config/storage.test.ts` 'provider 选择' block: build a config with `services: [{ id: 'svc-abcd1234', kind: 'openai-compat', name: 'Mine', baseURL: 'https://openrouter.ai/api/v1', apiKey: 'sk-x', model: 'x/y', thinking: 'disabled' }]` and `provider: 'svc-abcd1234'`; expect `getProvider(c).id === 'svc-abcd1234'` and `displayName === 'Mine'`; with `provider: 'svc-gone0000'` expect `getProvider(c).id === 'microsoft'`. `buildChain` expectations: `['svc-abcd1234', 'google-web']`. In `transport.test.ts` the `withChain` config gets the same service and `provider: 'svc-abcd1234'`; the engine stub ids `'openai-compat'` → `'svc-abcd1234'`; status `model` expectation `'x/y'`; `CHAIN_CONFIG_FIELDS` test: `services` change rebuilds, `appearance` does not.

- [ ] **Step 2: `model.ts`** — `export interface OpenAICompatConfig { id?: string; name?: string; baseURL: string; apiKey: string; model: string; thinking?: 'enabled' | 'disabled' }`.

- [ ] **Step 3: `openai-compat.ts`** — `id: config.id ?? 'openai-compat'`, `displayName: config.name ?? 'LLM'`, `wireFormats: WIRE_FORMATS['openai-compat']`.

- [ ] **Step 4: `wire-formats.ts`**

```ts
export const WIRE_FORMATS: Record<BuiltInService | 'openai-compat', readonly WireFormat[]> = { 'openai-compat': ['tags'], 'google-web': ['tags', 'markers'], 'chrome-builtin': ['tags'], microsoft: ['markers'] }
/** A service id (svc-…) is the OpenAI-compatible kind; built-ins by id */
export const wireFormatOfProvider = (provider: string): WireFormat => (WIRE_FORMATS[(isBuiltInService(provider) ? provider : 'openai-compat')][0] ?? 'tags')
```

- [ ] **Step 5: `providers/index.ts`**

```ts
export function getProvider(config: Config): TranslationProvider {
  const service = serviceOf(config, config.provider)
  if (service) return createOpenAICompatProvider(service, { prompts: config.prompts })
  switch (config.provider) {
    case 'google-web': return createGoogleWebProvider()
    case 'chrome-builtin': return createChromeBuiltinProvider(config.targetLanguage)
    default: return createMicrosoftProvider(config.targetLanguage) // a deleted service id lands on the shipped default
  }
}
```

- [ ] **Step 6: `transport.ts`** — `const chosen = chosenService(config); const model = chosen?.model;` and `getModel: async () => (engine.id === chosen?.id ? chosen.model : undefined)`; field lists as in Interfaces.

- [ ] **Step 7: `strings.ts`** — `serviceName(id, services = [])`: built-ins by id (`S.service.*`), else `services.find(s => s.id === id)?.name ?? id`. Update `tests/ui/strings.test.ts` accordingly (`serviceName('svc-abcd1234', [{ id: 'svc-abcd1234', name: 'Mine' }]) === 'Mine'`).

- [ ] **Step 8: Run `pnpm vitest run tests/providers tests/config tests/ui`** — green. tsc still red (renderer, content, popup, options): continue with Task 3.

---

### Task 3: Appearance renderer contract

**Files:**
- Modify: `src/core/renderer/style-preset.ts` (remove `STYLE_PRESETS`, `DECORATION_PRESETS`, `STYLE_ATTR_NAME`, `StyleVars`, `styleVarsRule`; add `UNDERLINE_ATTR = 'data-axt-underline'`, `BLUR_ATTR = 'data-axt-blur'`, `appearanceRule(appearance: Appearance): { base: string; overrides: string }`; `customStyleRule` targets `TRANSLATION_SELECTOR`)
- Modify: `src/styles/presets.css` (three rules), `src/styles/highlight.css` (band colour from `--axt-hl-color` / `--axt-hl-mix`)
- Modify: `src/core/renderer/index.ts` (`Appearance` in place of `StyleOptions`; `setStylePreset` → `setAppearanceAttrs`; `applyStyle(doc, appearance)`; `enable(doc, mode, appearance?, lang?)`; export `appearanceSheet(appearance)` for the settings preview)
- Modify: `src/core/pipeline/run.ts` (`appearance?: Appearance` instead of `style`)
- Modify: `src/entrypoints/content/index.ts` (`Appearance` from `activeAppearance(config)`; watcher compares it)
- Create: `src/config/appearance.ts` gets `activeAppearance(config: Pick<Config, 'appearance'>): Appearance` — wait, `Appearance` already names the profile lists; name the render input **`Look`**: `interface Look { style: StyleProfile; highlight: HighlightProfile }`, `lookOf(config): Look`.
- Test: `tests/renderer/presets.test.ts` (rewrite), `tests/renderer/style-vars.test.ts` (rewrite the `styleVarsRule` block as `appearanceRule`)

**Interfaces:**
- Produces: `type Look`, `lookOf(config)`, `appearanceRule(look): { base; overrides }`, `applyStyle(doc, look): boolean`, `enable(doc, mode, look?, lang?)`, `appearanceSheet(look): string`, attributes `data-axt-underline="solid|dotted|dashed|wavy"`, `data-axt-blur`, variables `--axt-color`, `--axt-opacity`, `--axt-deco-thickness`, `--axt-hl-color`, `--axt-hl-mix`.

- [ ] **Step 1: tests** — `presets.test.ts`:

```ts
it('the sheet has one rule per underline value, keyed by the attribute, and draws onto atomic inline boxes', () => {
  for (const u of ['solid', 'dotted', 'dashed', 'wavy']) expect(RULES).toContain(`[data-axt-underline="${u}"]`)
  const shared = /html\[data-axt-underline\] :is\(\.axt-t[\s\S]*?:is\(math, \.ltx_inline-block, svg, img\)\)/.exec(RULES)
  expect(shared).not.toBeNull()
})
it('blur is keyed by its own attribute and multiplies the opacity', () => {
  expect(RULES).toMatch(/html\[data-axt-blur\][^{]*\{[^}]*filter: blur/)
  expect(RULES).toMatch(/calc\(var\(--axt-opacity, 1\) \* 0\.75\)/)
})
it('no preset ids remain', () => { expect(RULES).not.toContain('data-axt-style') })
```

`style-vars.test.ts` (`appearanceRule`): default look (follow + soft-green) produces only the band variables; colour goes to `overrides` on `TRANSLATION_SELECTOR`; opacity to `base` on `TOP_TRANSLATION_SELECTOR`; thickness 2 emits `--axt-deco-thickness: 2px`; highlight `{ color: '#ff8800', opacity: 0.3 }` emits `--axt-hl-color: #ff8800; --axt-hl-mix: 30%`; bad colour dropped; `enable` + `applyStyle` set/remove `data-axt-underline` and `data-axt-blur`; the custom block still comes last.

- [ ] **Step 2: `style-preset.ts`**

```ts
export const UNDERLINE_ATTR = 'data-axt-underline'
export const BLUR_ATTR = 'data-axt-blur'
export const CUSTOM_STYLE_SELECTOR = TRANSLATION_SELECTOR // the reader's declarations apply to the active profile, whatever else it sets

export function appearanceRule(look: Look): { base: string; overrides: string } {
  const color = sanitizeColor(look.style.color)
  const hl = sanitizeColor(look.highlight.color)
  const opacity = look.style.opacity
  const dimmed = Number.isFinite(opacity) && opacity < OPACITY_MAX
  const base = dimmed ? `${TOP_TRANSLATION_SELECTOR} {\n--axt-opacity: ${Math.max(OPACITY_MIN, opacity)};\nopacity: var(--axt-opacity, 1);\n}\n` : ''
  const on: string[] = [`--axt-hl-mix: ${Math.round(Math.min(HL_OPACITY_MAX, Math.max(HL_OPACITY_MIN, look.highlight.opacity)) * 100)}%;`]
  if (hl.ok && hl.color !== '') on.push(`--axt-hl-color: ${hl.color};`)
  if (look.style.thickness === 2) on.push('--axt-deco-thickness: 2px;')
  let overrides = `html[data-axt-on] {\n${on.join('\n')}\n}\n`
  if (color.ok && color.color !== '') overrides += `${TRANSLATION_SELECTOR} {\n--axt-color: ${color.color};\n}\n`
  return { base, overrides }
}
```

(`Look` and the HL limits come from `@/config/appearance`; `style-preset.ts` importing `config/appearance` while `appearance.ts` imports `sanitizeColor` from here is a cycle — break it by moving `sanitizeColor`, `sanitizeCustomCss`, `COLOR_MAX`, `OPACITY_MIN/MAX` into `src/core/renderer/style-values.ts` and re-exporting them from `style-preset.ts`.)

- [ ] **Step 3: `presets.css`** — keep the header comment's two disciplines; body:

```css
html[data-axt-on] { --axt-green: oklch(0.693 0.17 162.48); }
/* colour follows --axt-color when the profile sets one */
html[data-axt-on] .axt-t:not(.axt-pending, .axt-error, .axt-mirror, .axt-split) { color: var(--axt-color, inherit); }
html[data-axt-underline="solid"] { --axt-deco-style: solid; }
html[data-axt-underline="dotted"] { --axt-deco-style: dotted; }
html[data-axt-underline="dashed"] { --axt-deco-style: dashed; }
html[data-axt-underline="wavy"] { --axt-deco-style: wavy; }
html[data-axt-underline] :is(.axt-t:not(.axt-pending, .axt-error, .axt-mirror, .axt-split), .axt-t:not(.axt-pending, .axt-error, .axt-mirror, .axt-split) :is(math, .ltx_inline-block, svg, img)) {
  text-decoration: underline var(--axt-deco-style) var(--axt-color, color-mix(in oklab, currentColor 40%, transparent));
  text-underline-offset: 0.25em;
  text-decoration-thickness: var(--axt-deco-thickness, 1px);
}
/* blur (kept from the old presets; the nesting guard stays) */
html[data-axt-blur] .axt-t:not(…):not(:where(…) *) { filter: blur(4px); opacity: calc(var(--axt-opacity, 1) * 0.75); transition: … }
html[data-axt-blur] .axt-t:not(…):hover:not(:where(…) *) { filter: blur(0); opacity: var(--axt-opacity, 1); }
@media (prefers-reduced-motion: reduce) { html[data-axt-blur] .axt-t:not(…) { transition: none; } }
```

Check the old `muted` / `green` rules for how `color` was written on the translation (they set `--axt-color` and `color: var(--axt-color)`); keep that mechanism: the colour rule above is what makes `--axt-color` visible.

- [ ] **Step 4: `highlight.css`** — `background-color: color-mix(in oklab, var(--axt-hl-color, var(--axt-green, currentColor)) var(--axt-hl-mix, 22%), transparent);`

- [ ] **Step 5: `renderer/index.ts`**

```ts
export type { Look } from '@/config/appearance'
function styleSheet(look?: Look): string { const vars = look ? appearanceRule(look) : { base: '', overrides: '' }; const custom = look ? customStyleRule(look.style.css) : ''; return `${modesCss}\n${vars.base}${presetsCss}\n${imageCss}\n${highlightCss}\n${vars.overrides}${custom}` }
export const appearanceSheet = (look: Look) => styleSheet(look)
export function setAppearanceAttrs(doc: Document, look: Look): void {
  const html = doc.documentElement
  if (look.style.underline === 'none') html.removeAttribute(UNDERLINE_ATTR); else html.setAttribute(UNDERLINE_ATTR, look.style.underline)
  if (look.style.blur) html.setAttribute(BLUR_ATTR, ''); else html.removeAttribute(BLUR_ATTR)
}
export function applyStyle(doc: Document, look: Look): boolean { /* as today, with setAppearanceAttrs */ }
export function enable(doc: Document, mode: Mode, look?: Look, lang?: string): void { /* as today */ }
```

`restore()` already strips every `data-axt-*` attribute from `<html>`; confirm with `tests/renderer/restore.test.ts`.

- [ ] **Step 6: `run.ts`** — `appearance?: Look` in `RunOptions`; `enable(doc, options.mode, options.appearance, …)`. **`content/index.ts`** — `let look: Look = lookOf(DEFAULT_CONFIG)`; `adoptStyle(next: Look)`; watcher: `const next = lookOf(config); if (JSON.stringify(next) === JSON.stringify(look)) return; look = next; applyStyle(document, look)`; `startTranslation({ …, appearance: look })`. `lookOf` in `appearance.ts`: `({ style: activeStyle(c.appearance), highlight: activeHighlight(c.appearance) })`.

- [ ] **Step 7: Run `pnpm vitest run tests/renderer tests/pipeline`** — green. **Step 8:** `npx tsc --noEmit -p .` now lists only options, popup and their tests. Stub the options page to compile (Task 4 replaces it): temporarily make `src/entrypoints/options/App.tsx` export a placeholder `App` returning `<main>设置</main>` — no: do Tasks 4–7 before the first commit? Too long without a commit. **Decision:** commit Tasks 1–3 together once `pnpm test` is green with the popup's `view-model.ts` / `fixtures.ts` minimally adapted (Task 7's data shape: `serviceName(id, config.services)`, `isLlmChosen(config)`, runnable via `chosenService`) and the old options page reduced to compile: replace its `openaiCompat` / `style` code paths by the new fields in the smallest way (services list → first service editable as before; style select → the six profiles). This keeps the suite green between tasks; Task 4 rewrites the page anyway.

```bash
git add src/config src/providers src/core/renderer src/styles src/core/pipeline/run.ts src/entrypoints/content/index.ts src/entrypoints/popup src/entrypoints/options src/ui/strings.ts tests
git commit -m "feat(config): v12 — user-added services and appearance profiles; engines and renderer follow"
```

---

### Task 4: Options page shell, data layer, 翻译服务 section

**Files:**
- Create: `src/entrypoints/options/data.ts` (`useOptionsData`), `src/entrypoints/options/Nav.tsx`, `src/entrypoints/options/sections/Services.tsx`, `src/entrypoints/options/sections/ServiceDrawer.tsx`, `src/entrypoints/options/permissions.ts` (moved `ensureHostPermission` / `releaseHostPermission` / `originPattern`), `src/ui/Drawer.tsx`, `src/ui/Confirm.tsx` (two-step delete), `src/ui/Field.tsx` (label + input + hint)
- Modify: `src/entrypoints/options/App.tsx` (nav + section switch), `src/entrypoints/options/main.tsx` (import `@/styles/ui.css`), `src/entrypoints/options/index.html` (title `Readarxiv · 设置`)
- Modify: `src/ui/strings.ts` (an `O` object for the options page copy, spec §2.3 words)

**Interfaces:**
- `useOptionsData(): { config: Config | null; patch(fn: (c: Config) => Config): Promise<Config>; provider: ProviderStatus | null; reloadProvider(); pack: PackState | null; checkPack(target); downloadPack(); helper: HelperStatus | null; cache: { entries; bytes } | null | 'error'; clearCache(); awaitChain(settled) }` — `patch` reads the latest stored config, applies, writes, sets local state (the popup's rule from Codex #39).
- `Drawer({ open, title, onClose, children, footer })` — right-side panel, backdrop click and Escape close, `role="dialog"`.
- `Confirm({ label, onConfirm })` — first click shows 「确认{label}」+「取消」for 4 s.
- `ServiceDrawer({ service: Service | null, onSaved(next: Service), onDeleted(id), onClose })`.

- [ ] **Step 1: `data.ts`** — pattern of `popup/data.ts`: `getConfig` on mount, `patch`, `axt:provider-status`, `packState` / `downloadPack` from `@/shared/pack`, `axt:helper-status`, `axt:cache-stats` / `axt:cache-clear`, `awaitChain` copied from the popup (or move it to `src/shared/chain.ts` and import in both — do that).

- [ ] **Step 2: `Services.tsx`** — layout per spec §2.3:
  - three built-in cards (`role="radio"` buttons, `aria-checked`), names/hints from `S.service`; the Chrome card shows the pack line and a 「下载」 button when `downloadable`, a spinner when `downloading`, and is disabled unless `available`.
  - 我的服务 list: rows `<button role="radio">` (name · model · host) + a 「›」 edit button opening the drawer; 「添加服务」; the fallback switch line; empty-state sentence.
  - 目标语言: the popup's `Menu` behind a row button (reuse `MenuRow`? the popup's is private — lift a `MenuField` into `src/ui/MenuField.tsx` used by both).
  - 图片翻译: `Switch` + helper line (`识别助手已就绪 {version}` / `未安装` + command + 教程) + the three mode checkboxes.
- [ ] **Step 3: `ServiceDrawer.tsx`** — local form state; 连接 = validate with `serviceSchema` → `ensureHostPermission(baseURL)` (for a non-openrouter origin) → `patch` (add or replace the service; choose it) → `releaseHostPermission(previous, next)` → `awaitChain(s => s.providerId === id)` → `axt:translate` sample (as today's `testConnection`, sample text `SAMPLE_TAGS`) → result line 已连接 · {ms} ms or the reason via `reasonText`. 删除 = `Confirm` → `patch` removing the service; if it was chosen, `provider` = `'microsoft'`.
- [ ] **Step 4: `App.tsx`** — `<Nav sections=… active onChange />` + section switch; hash `#services|#reading|#prompts|#data` keeps the place.
- [ ] **Step 5:** `pnpm lint && pnpm test && pnpm build`; open `options.html` in Playwright (`node_modules/.cache/axt/` script like the popup's) and screenshot; commit `feat(options): navigation, data layer and the services section`.

---

### Task 5: Appearance editor components and the 阅读 section

**Files:**
- Create: `src/ui/appearance/Preview.tsx` (iframe: `appearanceSheet(look)` + `html[data-axt-on][data-axt-underline…]` attributes, the two sample paragraphs, a band over the second sentence when `showBand`), `ColorField.tsx` (palette swatches + native `<input type="color">` + 「跟随原文」/「默认」chip), `OpacityField.tsx` (range + %), `UnderlineField.tsx` (Segmented 无·实线·点线·虚线·波浪 + thickness 1px·2px), `AdvancedCss.tsx` (fold + textarea + validation line), `ProfileEditor.tsx` (Drawer shell: preview, 名称, the fields chosen by `fields`, footer 复制一份 · 删除 · 完成), `ProfileGrid.tsx` (tiles with mini preview: the sample word 译文 rendered inline with the profile's colour/underline/opacity, or a band swatch; active tile checked; a pencil on the active tile; toolbar 添加 · 重置)
- Create: `src/entrypoints/options/sections/Reading.tsx`
- Test: `tests/ui/appearance.test.ts` — pure helpers: `tileStyle(profile)` (inline style for a tile), the preload stop mapping `stopOf(margin)` / `marginOf(stop)`.

**Interfaces:**
- `ProfileGrid<T extends { id; name }>({ items, activeId, onChoose(id), onEdit(id), onAdd(), onReset(), renderTile(item) })`.
- `ProfileEditor` props: `{ kind: 'style' | 'highlight'; value: StyleProfile | HighlightProfile; onChange(next); onDuplicate(); onDelete(); onClose() }` — every field change calls `onChange` (immediate effect); the section's `patch` writes it.
- Preload stops: margin `[450, 900, 1800, 2700]` ↔ 半屏 · 一屏 · 两屏 · 三屏; threshold `[0, 0.5, 1]` ↔ 刚露出 · 露出一半 · 完全露出; a stored value snaps to the nearest stop for display.

- [ ] Steps: write the helper tests (tile style: colour, underline, opacity; stop mapping) → implement components → `Reading.tsx` = 译文样式 grid + editor, 对照高亮 switch, 背景高亮 grid + editor, the two sliders → gate → screenshot → commit `feat(options): appearance profiles with a visual editor, and the reading section`.

---

### Task 6: 提示词与术语 and 数据 sections

**Files:**
- Create: `src/entrypoints/options/sections/Prompts.tsx` (PromptManager restyled on the tokens — keep its logic; glossary textarea, `parseGlossary` on change, per-line errors, saved on blur when valid), `src/entrypoints/options/sections/Data.tsx` (cache line, `Confirm` 清空, 已清空 for 2 s, 没能读取缓存 on error)
- Modify: `src/entrypoints/options/PromptManager.tsx` (class names only)

- [ ] Steps: implement → gate → commit `feat(options): prompts, glossary and data sections`.

---

### Task 7: Popup — services from the config, 管理翻译服务…

**Files:**
- Modify: `src/entrypoints/popup/view-model.ts` (`serviceItems`: built-ins, then `config.services` (hint: model, or 尚未配置 API Key when `apiKey === ''` and not loopback), then `{ id: '__manage', name: S.service.manage }`; `runnable` for a service: key set or loopback; `prompt` row when `isLlmChosen`), `data.ts` (`chooseService('__manage')` → `openOptions()`), `fixtures.ts` (services in the LLM fixtures), `src/ui/strings.ts` (`S.service.manage = '管理翻译服务…'`)
- Test: `tests/popup/view-model.test.ts` (P2 items: 4 built-in/user rows + manage; a service row's hint; the manage item is never selected)

- [ ] Steps: tests → implement → gate → commit `feat(popup): the reader's services in the menu`.

---

### Task 8: e2e rewrite

**Files:**
- Create: `tests/e2e/options-page.mjs` — helpers over the new page:
  - `openSection(options, 'services' | 'reading' | 'prompts' | 'data')`
  - `chooseBuiltIn(options, id)` — clicks the card by its name (`Microsoft 翻译` / `Google 翻译` / `Chrome 翻译`)
  - `addService(options, { name, baseURL, apiKey, model })` — 添加服务 → fill by labels 名称 / 接口地址 / API Key / 模型 → 连接 → wait for `已连接` or the result line; returns the row
  - `chooseServiceByName(options, name)`
  - `setSwitch(options, label, on)` — `getByRole('switch', { name })`
  - `chooseStyle(options, name)` — tile by name
  - `setPreload(options, { margin, threshold })` — the two sliders
- Modify: `tests/e2e/extension.mjs`, `layout.mjs`, `image.mjs`, `a11y.mjs`, `local-endpoint.mjs` — every 保存 / 已保存 pair and every `select >> nth=0` per the line lists below.

Line lists (before this change): extension.mjs 235–283, 296–337, 362–364, 465–467, 629–642, 756–757, 952–972, 1007–1008, 1073–1075; layout.mjs 39–49; image.mjs 112–123, 192–195; a11y.mjs 244–246; local-endpoint.mjs 117–121.

- [ ] Steps: helpers → rewrite each site → `pnpm build && pnpm e2e:layout && pnpm e2e` (and `e2e:image` if the helper is registered) → commit `test(e2e): drive the rebuilt options page`.

---

### Task 9: Docs and wrap-up

- `docs/UI.md` §3.2 rewritten to the implemented page (S-O ids, product words); §5 tokens unchanged; §7 coverage rows for services and appearance.
- `docs/DESIGN.md`: §7.5 appearance contract (attributes + variables; the removed presets and why), §8.5 services (`services[]`, service ids as engine ids), the config list gains v12.
- `docs/THIRD_PARTY.md`: note that the KISS-derived presets except blur were removed on 2026-09-10.
- Memory: the merge-time `HELPER_REF` note stays; add "appearance profiles model" to the Phase 1 progress.
- Commit `docs: services and appearance in the contract and the design`.

## Self-review

- Spec coverage: §2.1–2.4 → Tasks 1, 2, 4, 7; §3.1–3.4 → Tasks 1, 3, 5; §4 → Tasks 4–6; §5 → Task 1; §6 → Tasks 1–3, 5, 8; §7 out of scope.
- Placeholders: Task 3 Step 3 abbreviates the blur selectors with `…` — copy them from the current `presets.css` lines 146–157 verbatim.
- Type consistency: `Look` (render input) vs `Appearance` (the lists) named in Task 3 and used in Tasks 5–6; `serviceName(id, services)` in Tasks 2 and 7; `Confirm`, `Drawer`, `MenuField` defined in Task 4 and used in 5–6.
