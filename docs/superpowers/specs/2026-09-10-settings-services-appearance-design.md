# Settings page: translation services and appearance — design

Status: draft for review, 2026-09-10. Owner decisions from the review of the rebuilt popup are
recorded as [decided]; everything else is the agent's proposal.

## 1. Goals

- **Readers configure, developers do not show through.** Every string follows UI.md §1 and the
  wording rules of the popup review (product register, real buttons, nothing casual).
- **Progressive disclosure.** A section shows what is needed to choose; adjusting happens one level
  down, in a drawer; the rarely needed lives behind a fold ("更多选项", "高级").
- **Changes take effect at once.** No save button. A drawer commits with one button.
- **The core is untouched.** Extractor, protector, renderer and scheduler keep their contracts; the
  renderer's style contract shrinks (fewer presets) and gains variables, nothing more.

## 2. Translation services [decided]

### 2.1 Model

Two groups, shown as two groups:

- **Built-in services** — fixed, cannot be added or removed: `microsoft`, `google-web`,
  `chrome-builtin`. A built-in LLM joins this group later without a schema change.
- **My services** — user-added, any number, all of one kind for now:

```ts
interface Service {
  id: string            // 'svc-' + 8 random base32 chars; stable for the cache key
  kind: 'openai-compat' // the only kind today; the field exists so native kinds can be added later
  name: string          // what the popup and the list show; defaults to the model's last segment
  baseURL: string
  apiKey: string        // never leaves storage (CLAUDE.md rule 7)
  model: string
  thinking: 'disabled' | 'enabled'
}
```

`config.provider` becomes a string: a built-in id or a service id. `config.services: Service[]`
replaces `config.openaiCompat`. Prompts and the glossary stay global and apply to whichever LLM
service is chosen. No vendor templates (owner, 2026-09-10): a service is a name, an endpoint, a key
and a model, exactly what the single endpoint is today.

### 2.2 Engines, chain, cache

- `getProvider(config)`: a built-in id maps as today; a service id builds `createOpenAICompat` from
  that service. An unknown id (service deleted while chosen) falls back to the first free built-in
  and the popup says so through the ordinary "cannot run" note.
- `buildChain`: unchanged shape — the chosen service first, then the free engines (§8.5).
- `CHAIN_CONFIG_FIELDS`: `openaiCompat` → `services`.
- Cache key: `providerId` is the service id, `model` the service's model. Deleting and re-adding a
  service is a new id, so a cache miss; acceptable.
- `ProviderStatus.providerId` carries the id; `serviceName(id, config)` resolves a service id to
  its name (a new lookup; the built-ins keep their names in `strings.ts`).
- Host permissions: saving a service whose endpoint is not openrouter.ai requests the origin, from
  the drawer's commit button (a user gesture), as the options page does today.

### 2.3 Options page, section 翻译服务

```
翻译服务
  内置服务        [Microsoft 翻译] [Google 翻译] [Chrome 翻译 ▸下载]     ← three cards, radio
  我的服务        ○ DeepSeek V4 Flash   deepseek/deepseek-v4-flash   openrouter.ai   ›
                  ○ 本机 Ollama          qwen3:8b                     127.0.0.1       ›
                  ＋ 添加服务
                  出问题时自动改用免费服务                                       [◉]
  目标语言        简体中文 ⌄                                    ← the popup's searchable menu
  图片翻译        [◉]  识别助手已就绪 0.1.0   /  未安装：安装命令 [复制] 教程
                  在这些模式下显示图片译文  □上下 □左右 □仅译文
```

- Choosing = clicking a card or a row's radio; effective at once.
- A row opens the **service drawer**: 名称 · 接口地址 · API Key (•••• 已保存 + 清除) · 模型 ·
  更多选项 ▸ 深度思考. Footer: 「连接」(saves, requests the origin if needed, verifies with a
  one-line result: 已连接 · {ms} ms / the S-E reason) · 「删除」(confirm). 「添加服务」opens the
  same drawer empty; 「连接」on a new service adds it and chooses it.
- Empty list: one line, 还没有添加服务。添加后即可使用 LLM 翻译。
- Chrome's card: greyed with 「下载」 until the pack is `available` (S-P-40…43 wording).

### 2.4 Popup

The service menu lists the built-ins, then 我的服务 by name (hint: the model; 尚未配置 API Key when
the key is empty), then 管理翻译服务… which opens the options page. The prompt row shows while a
service (any LLM) is chosen.

## 3. Appearance [decided]

Both lists live in the 阅读 section, one after the other: 译文样式, then 背景高亮.

### 3.1 Translation style profiles

```ts
interface StyleProfile {
  id: string                 // built-ins: fixed ids; user-made: 'style-' + random
  name: string
  color: string              // '' = follow the original text
  opacity: number            // 0.3 … 1
  underline: 'none' | 'solid' | 'dotted' | 'dashed' | 'wavy'
  thickness: 1 | 2           // underline only
  blur: boolean              // blurred until hovered (the one kept effect)
  css: string                // 高级: declarations only, sanitised as today
}
```

Shipped profiles (all in the list from the start, editable, deletable, restored by 重置):

| id | 名称 | what it is |
|---|---|---|
| `follow` | 与原文相同 | color '', opacity 1, no underline — today's `none` |
| `green` | 绿色 | Read Frog's green (`oklch(0.693 0.17 162.48)`), readable on arXiv's white and its dark theme |
| `blue` | 蓝色 | `oklch(0.62 0.15 250)` |
| `amber` | 琥珀 | `oklch(0.7 0.14 70)` |
| `muted` | 淡一档 | color '', opacity 0.7 |
| `blur` | 模糊 | blur true; hover to read — for checking the original first |

Removed with this change: box, box-dashed, quote, marker, marker-gradient, highlight, tint,
gradient, colorful, glow, blink, and the fixed underline presets (underline / dotted / dashed /
dashed-bold / wavy / wavy-bold become the `underline` + `thickness` fields of any profile).

### 3.2 Highlight profiles (the hover band, DESIGN §7.7)

```ts
interface HighlightProfile { id: string; name: string; color: string; opacity: number /* 0.05 … 0.6 */ }
```

Shipped: `soft-green` 柔和绿 (today's band: the green at 22%), `sand` 淡黄, `sky` 淡蓝. The on/off
switch stays where it is (`reading.sentenceHighlight`: popup and settings).

### 3.3 Renderer contract

`applyStyle(doc, appearance)` writes, on `<html>`:

- `data-axt-underline="solid|dotted|dashed|wavy"` when the active style has one, else absent;
  `data-axt-blur` when blur; `data-axt-style` is retired.
- Variables through `styleVarsRule`: `--axt-color`, `--axt-opacity`, `--axt-deco-thickness`,
  `--axt-hl-color`, `--axt-hl-opacity`. `--axt-accent` is retired (the underline uses
  `--axt-color`, falling back to `currentColor`); `--axt-green` stays as the default band colour.
- `presets.css` shrinks to: the colour/opacity rule, the underline rule keyed by
  `html[data-axt-underline]` (the atomic-inline-box discipline stays), the blur rule keyed by
  `html[data-axt-blur]`. `highlight.css` reads `--axt-hl-color` / `--axt-hl-opacity`.
- The custom rule (`customStyleRule`) applies whenever the active profile's `css` is non-empty,
  regardless of the other fields.
- The DOM invariants of §7.1 are untouched: everything is attributes on `<html>` and one
  `<style>` element, as today.

### 3.4 The editor component

`src/ui/appearance/` — one editor for both lists, shaped by `fields`:

```
┌ 编辑样式 ──────────────────────────────┐
│ ┌ preview (iframe with the real sheets) ┐│  ← the same technique as today's preview
│ │ 原文一句 … / 译文一句 …                ││     (real `html[data-axt-*]` + variables)
│ └───────────────────────────────────────┘│
│ 名称   [绿色            ]                 │
│ 文字颜色  ● ● ● ● ● ● ● ●  [自定义 ▾] 跟随原文 │  ← ColorField: palette + native picker
│ 透明度    ────────●──  90%                │  ← OpacityField
│ 下划线    无 · 实线 · 点线 · 虚线 · 波浪    │  ← UnderlineField (segmented)
│           粗细  1px · 2px                  │     (only when a line is chosen)
│ 悬停前模糊  [○]                            │
│ 高级 ▸  CSS 声明                           │  ← AdvancedCss (folded)
│                          [复制一份] [删除] │
└────────────────────────────────────────────┘
```

Components: `ProfileEditor` (drawer shell, preview, footer), `ColorField`, `OpacityField`,
`UnderlineField`, `AdvancedCss`, `ProfileGrid` (the list: mini preview tiles with the name, the
active one checked, a pencil on it; toolbar 添加 / 重置). The highlight editor uses
`ProfileEditor` with `fields: ['color', 'opacity']` and a preview that shows the band over a
sentence. Every control writes to the profile at once; the preview follows the same
`applyStyle` code path, so what is shown is what the page gets.

Palette: eight colours picked for arXiv's light and dark backgrounds, the same eight for text and
bands (band colours are shown at their opacity). A ninth swatch opens the native colour input.

## 4. Options page structure

Left navigation, four sections, 640 px content column, the popup's tokens and dark mode:

1. **翻译服务** — §2.3.
2. **阅读** — 译文样式 (§3.1 grid), 背景高亮 (§3.2 grid) with the 对照高亮 switch above it,
   提前翻译的范围 (半屏 · 一屏 · 两屏 · 三屏), 开始翻译的时机 (刚露出 · 露出一半 · 完全露出).
3. **提示词与术语** — prompt list (built-ins 查看, custom 编辑, 新建, the drawer editor), 术语表
   with per-line errors. Greyed (still clickable) while no LLM service is chosen.
4. **数据** — 已缓存的译文 {n} 条 · {size} MB, 清空 (confirm); the diagnostics export (#156) later.

Immediate effect everywhere; drawers commit with 连接 / 完成. A small 已保存 toast is not needed:
the control itself shows the new value.

## 5. Config migration v11 → v12

| v11 | v12 |
|---|---|
| `provider: 'openai-compat'`, `openaiCompat: {…}` | one `Service` (`svc-…`, name = the model's last segment) in `services`; `provider` = its id |
| `provider: 'openai-compat'` with default `openaiCompat` and no key | the same service, empty key: the reader's choice is kept, the popup says 尚未配置 API Key |
| any other `provider`, `openaiCompat` untouched | `services: []` |
| any other `provider`, `openaiCompat` edited | the service is created but not chosen |
| `style.preset` ∈ underline kinds | the shipped profile `follow` copied to `style-1` with that underline (+ thickness 2 for the -bold kinds) and the v11 colour / opacity; active |
| `style.preset` = `blur` | active `blur` |
| `style.preset` = `green` / `muted` / `none` | active `green` / `muted` / `follow`, v11 colour / opacity applied to it |
| `style.preset` = `custom` | `style-1` 自定义 with `css`, colour, opacity; active |
| other presets (box, marker…) | active `follow`, colour / opacity kept; the effect is gone (release note) |
| `style.accent` set | a highlight profile `hl-1` 自定义 with that colour at 0.22, active; else `soft-green` |
| `reading.sentenceHighlight` | unchanged |

The migration is total (every v11 value maps to something) so no configuration falls back to
defaults.

## 6. Tests

- Unit: schema + migration table above; `getProvider` for service ids and for a deleted id;
  `chainConfigChanged` with `services`; `applyStyle` attributes and variables for each field;
  `presets.test.ts` rewritten to the three rules; the migration of every v11 preset.
- Options page: a pure view model for each section is not planned (the sections are forms); the
  editor's field → CSS mapping is unit-tested through `applyStyle`.
- e2e: `extension.mjs`, `layout.mjs`, `image.mjs`, `a11y.mjs`, `local-endpoint.mjs` drive the
  options page through 保存 / 已保存 (51 places) and the engine `<select>` (8 places); they are
  rewritten to the cards, the drawer and immediate effect. The style e2e (外观 select) moves to
  the grid.

## 7. Out of scope

Vendor templates for services; native Anthropic / Gemini kinds; 排版 (#47); 分栏 (#83); the
hosted free LLM (#97); the diagnostics export (#156).
