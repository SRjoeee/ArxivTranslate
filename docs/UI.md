# UI contract — copy, states and tokens

> Translated into English on 2026-09-13 as part of the repository-wide English sweep; the content is the frozen record and is unchanged.

The single basis for the interface implementation. The design canvas (`docs/design/canvas/`) is reference only; where the two conflict this document wins, and a change starts here.
Numbering: `P` popup states, `O` the options page, `I` in-page components; copy ids are `S-<surface>-<number>`. Cite the ids directly in feedback.

Status: **implemented** — the copy of §3, the tokens of §5 and the language of §6 are in `src/ui/strings.ts`, `src/locales/` and `src/styles/ui.css`; the [open] marks of §1, §2, §3 and §5 dated from the drafting and were changed to [implemented] on 2026-09-13. Settled sections are marked [decided].

---

## 1. Tone rules [implemented; marked 2026-09-13]

1. **Speak to the user, not about the system's insides.** No provider, engine chain, fallback, block, session, background, fixture and the like; every internal concept takes the user word of §2.
2. **Buttons are verb phrases, 3–5 characters.** 翻译本页, 显示原文, 重试, 连接, 下载, 清空. Never “确定” or “OK”, words that say nothing about the consequence.
3. **States are nouns or adjectives, 2–4 characters.** 就绪, 翻译中, 已暂停, 需要设置.
4. **An error says three things only: what happened, what it affects, what you can do.** No error codes, no guessing at causes, no apologies. The error code and the raw message go into the hover `title` for diagnosis.
5. **A number appears only where the user can act on it.** “2 段没翻出来 · 重试” is fine; “已翻 24 / 已触发 31（共 120）” is not.
6. **One sentence, ≤ 30 characters.** What does not fit becomes explanatory text on the options page; the popup explains no mechanism.
7. **No pleasantries and no modal particles**: 请, 哦, 一下, 吧, 啦. No exclamation marks. A single sentence takes no final full stop; two or more sentences do.
8. **One word per concept across the whole product**, see §2.
9. **A space between Chinese and Latin text**; product names, model names and “API Key” keep their original casing.
10. **Full-width punctuation**; the ellipsis is the single character “…”, the separator “·”.

## 2. Terminology [implemented; marked 2026-09-13]

| Internal word (code / DESIGN.md) | What the user sees | Notes |
|---|---|---|
| provider / engine | **翻译服务** (shortened to “服务” where the context is clear) | All three reference products say “翻译服务” |
| `openai-compat` | **AI 模型** | Users recognise “AI”, not “LLM” or “OpenAI-compatible” |
| `google-web` | **Google 翻译** | |
| `chrome-builtin` | **Chrome 离线翻译** | |
| fallback / demoted | **已改用 ×××** | Described as an action, no coined noun |
| block / segment | **段落** | Tables and equation blocks are “段落” to the user too |
| translate page | **翻译本页** | |
| restore | **显示原文** | Pairs with “翻译本页”; “恢复” implies something went wrong |
| mode: stack / side / only | **上下对照 / 左右对照 / 仅译文** (in the segmented control simply 上下 / 左右 / 仅译文) | |
| targetLanguage | **翻译为** | “译成” reads bookish |
| language pack | **离线语言包** | |
| prompt | **提示词** | The common word among AI users |
| glossary | **术语表** | |
| cache | **已缓存的译文** | Never “缓存” on its own |
| preload margin | **提前翻译的范围** | Steps: 半屏 / 一屏 / 两屏 / 三屏 |
| preload threshold | **开始翻译的时机** | Steps: 刚露出 / 露出一半 / 完全露出 |
| thinking | **深度思考** | The common name in Chinese AI products |
| baseURL | **接口地址** | |
| apiKey | **API Key** | Kept in English; it is what the user sees at the vendor |
| model | **模型** | |
| test connection | **连接** | = save + verify one sentence |
| retry failed | **重试** | |
| fatal / stopped | **已暂停** | Part of the translation is still on the page, so “paused”, not “failed” |
| image translation / overlay | **图片翻译**; the overlay has no name | §15 |
| OCR helper | **识别助手** | The user need not know Native Messaging, Vision or helper |
| `image.modes` | **在这些模式下显示图片译文** | Affects display only, no re-recognition |
| reading typography (#47) | **排版** | Kept apart from “译文样式” (decoration): typography covers font size, line height, width, spacing |
| split view (#83) | **分栏** | Experimental |
| hosted free LLM (#97) | **免费 AI 翻译** | Candidate; alongside “AI 模型” (own key) |
| `microsoft` (#98, implemented) | **Microsoft 翻译** | Free; chosen by hand only, never in the automatic fallback list (DESIGN §8.5). Links and formulas survive; what is lost is inline styling such as italics (a leading label is restored, #150) |
| `reading.sentenceHighlight` (#105 / #141) | **对照高亮** | The sentence under the pointer lights up; in translation-only mode, dwelling brings the original up |

## 3. Copy tables [implemented; marked 2026-09-13]

### 3.1 Popup

Revised 2026-09-10 in review (see §4 for the states). Copy is the product's register: nouns for
states, verbs for buttons, no spoken phrases (去填 / 去修 are out), every note gets a real button.

| Id | Where / when | Copy | Notes |
|---|---|---|---|
| S-P-01 | Brand row | Read arXiv | [decided; 2026-09-11 set as two words, upheld on the 09-12 re-check] **The reader sees the name with a space**, arXiv in its official casing. The repository (`SRjoeee/ReadarXiv`) and the domain (readarxiv.org) can only use the unspaced form, **which is no basis for the display name** — two spellings of one product; never change this row after the repository name (on 2026-09-12 that nearly happened). The roadmap #155's “the product becomes Readarxiv” speaks of that identity, not of this string. The extension manifest `name`, the three pages' `<title>` and the toolbar tooltip all follow this row; the store name is pending. The brand mark is in §5.1 |
| S-P-02 | Gear in the brand row, `aria-label`; the button beside every note | 设置 | The one button of every note; opens the options page |
| S-P-03 | Not an arXiv page / page loading (P0) | 打开 arXiv 论文的 HTML 页面后即可翻译 | Same sentence for both cases; never "后台未响应" |
| S-P-10 | Service row label | 翻译服务 | The row opens the service menu (S-P-40…46) under itself |
| S-P-11 | Service row value | {模型名 / 服务名} | LLM shows the model (`deepseek-v4-flash`), others their name; while replaced (S-P-30) the service in use with the one put aside struck through |
| S-P-20 | Language row label | 目标语言 | The row opens the language menu |
| S-P-21 | Language row value | {语言名} | `languages.ts` label |
| S-P-22 | Language menu search box | 搜索语言 | Matches the Chinese name, the local name, the English name and the code |
| S-P-23 | Language menu, no results | 没有匹配的语言 | |
| S-P-30 | Note · switched | {原服务}：{原因}。本页已改用 {新服务} | A permanent hand-over restarts the whole page on the new service (DESIGN §8.5); reason per S-E |
| S-P-31 | Note · will switch | {为何不能用}，本次将使用 {服务} | Idle, the chosen service cannot run, another takes over |
| S-P-32 | Note · cannot translate | {为何不能用} | Idle with nothing to take over, or the page left behind by a choice that cannot run (P13) |
| S-P-32a | {为何不能用} · LLM | LLM 尚未配置 API Key | |
| S-P-32b | {为何不能用} · Chrome | Chrome 翻译的语言包尚未下载 / Chrome 翻译的语言包下载中，约需 1 分钟 | Reachable from the options page only: the popup's item is greyed |
| S-P-32c | {为何不能用} · Microsoft | Microsoft 翻译不支持当前目标语言 | |
| S-P-33 | Note · paused | {原因}。请检查设置后重新翻译 | Reason per S-E |
| S-P-35 | Note · image translation paused | 图片翻译已暂停：{原因} | `images.fatal`; shown while text translation continues |
| S-P-40 | Service menu · Chrome item action | 下载 | While `downloadable`; the item is greyed until the pack is there; the click itself starts the download (user gesture) |
| S-P-41 | Service menu · Chrome item subtitle · downloading | 语言包下载中 | Spinner in place of the button; no progress events, so no bar |
| S-P-42 | Service menu · Chrome item subtitle · unavailable | 当前不可用 | `unavailable` / `unsupported`, greyed, no button |
| S-P-43 | Service menu · Chrome item subtitle · ready | 浏览器内置，无需联网 | |
| S-P-44 | Service menu · Microsoft / Google subtitle | 免费 | Microsoft with an unsupported target: 不支持当前目标语言, greyed |
| S-P-45 | Service menu · LLM subtitle | {模型名} / 尚未配置 API Key | Selectable without a key; the note S-P-31/32 and its 设置 button follow |
| S-P-46 | Service menu · names and order | Microsoft 翻译 · Google 翻译 · LLM · Chrome 翻译 | [decided] 2026-09-10; Microsoft is the shipped default |
| S-P-47 | Prompt row | 提示词 / {名称} | Only while the LLM is chosen; opens the prompt menu |
| S-P-50 | Primary button · not translated | 翻译本页 | Shortcut badge: the key Chrome reports for `axt-toggle` (suggested Alt+T). **On every enabled face of the button** (2026-09-11): the key translates an untranslated page and restores a translated one, so 显示原文 carries it too; a paused session's 重新翻译 is what the key does there. Chrome reports nothing when another extension — or another copy of this one — already holds the combination, and then no badge is drawn |
| S-P-51 | Primary button · translating | 显示原文 | The only sign that the page is on: no pill. Carries the same shortcut badge as S-P-50 |
| S-P-52 | Primary button · paused / page behind the settings | 重新翻译 | Disabled while the saved service cannot run; S-P-53 alongside |
| S-P-53 | Secondary button | 显示原文 | Text button under S-P-52 |
| S-P-60 | Failure line | {n} 处翻译失败 | Paragraphs and figures counted together; only when `progress.failed + images.failed > 0` and nothing is fatal |
| S-P-61 | Failure line action | 重试 | |
| S-P-70 | Mode segments | 左右 · 上下 · 仅译文 | `title` S-P-71/72/73. Since 2026-09-11 **左右 comes first**: on a wide screen it is the main way to read, so it takes first place; `MODE_ORDER` (`src/ui/strings.ts`) is the single source of that order, and the options page's image translation modes follow it too. **A fresh install defaults to 左右 as well** (owner, 2026-09-11): on a wide screen it is the main way to read, and in a narrow window the page falls back to 上下 by itself (S-P-74) |
| S-P-71 | Mode `title` · 上下 | 译文紧跟在原文下方 | |
| S-P-72 | Mode `title` · 左右 | 原文与译文并排；窗口较窄时按上下显示 | |
| S-P-73 | Mode `title` · 仅译文 | 隐藏原文，参考文献仍保留双语 | |
| S-P-74 | Remark under the mode bar · narrow window | 窗口较窄，暂按上下显示 | Only when 左右 is chosen and the page shows 上下 |
| S-P-80 | Hover highlight row | 对照高亮 | Switch in the card (`reading.sentenceHighlight`); saved at once, live on the page |
| S-P-81 | Hover highlight `title` | 悬停时高亮对应句子；仅译文模式下停留可查看原文 | |
| S-P-82 | Translation style · same row as the two switches | 译文样式 | [decided, 2026-09-11, the reader's final word] The last row is 对照高亮 · 图片翻译 · 译文样式 side by side — all three are "how this reads". The entry is plain text plus a chevron; the **preview is inside the menu**, where each style draws the shared sample sentence (§5.1's `PREVIEW_TARGET`) in itself — 淡一档 and 模糊 mean nothing as names. The list is `appearance.styles`, in the settings page's order, under the same name it has there. **The menu opens upward**: this row sits at the foot of the popup and the window does not grow to fit a panel below it. The page's config watcher redraws in the new style, so nothing restarts |
| S-P-83 | Translation style menu · last row | 管理译文样式… | [decided, 2026-09-11, proposed by the reader] The same role as the service menu's “管理翻译服务…”: the menu's last row is not a style but the way in to managing them, so it carries no preview and takes no part in selection. Styles live in the options page's **阅读** section, so this row opens straight onto that section (`options.html#reading`) — `openOptionsPage` passes no hash, and landing in the “翻译服务” section is worse than one extra tab; the entries without a section (the gear at the top right, the “设置” in a note) still use `openOptionsPage`, which brings the tab already open to the front |
| S-P-85 | Image translation row | 图片翻译 | Switch in the card (`image.enabled`, v11); saved at once, live on the page; the per-mode list stays on the options page |
| S-P-86 | Under the image translation row · helper not installed (macOS) | 图片翻译需要安装识别助手 | Only while the switch is on and the helper is not detected |
| S-P-86b | Under the image translation row · awaiting permission (macOS) | 图片翻译需要允许扩展与识别助手通信 | [2026-09-13, ADR-0002] `nativeMessaging` became an optional permission; this row appears before S-P-86 |
| S-P-86c | Permission action | 允许 | [2026-09-13, ADR-0002] This click starts Chrome's permission prompt (`src/ui/HelperPermission.tsx`, shared with the options page); after a refusal the button stays |
| S-P-86d | Under the image translation row · permission taking effect | 已允许，稍后自动生效 | [2026-09-13, ADR-0002] The transitional state while the grant lands in an already running background; nothing to press, the card follows up by itself once the new worker is up |
| S-P-87 | Under the image translation row · not macOS | 图片翻译目前仅支持 macOS | |
| S-P-88 | Helper hint action | 安装 | [decided, 2026-09-12] Unfolds the S-O-27 guide in place, without jumping to the options page or opening a new window. Replaces the former two buttons “复制安装命令 · 教程” — the guide carries the command block and the tutorial link itself |
| S-P-90 | Action failed | {原始信息} | Red line under the primary button (`role=alert`), cleared before the next action |

Removed 2026-09-10: the state pills (S-P-12…18) and the config-fallback note (S-P-34; the options page announces it).

### 3.2 Options page

Rebuilt 2026-09-10 (spec `docs/superpowers/specs/2026-09-10-settings-services-appearance-design.md`).
Four sections behind a left navigation; there is no save button — every control writes as it
changes, and the two drawers commit with one button.

| Id | Where | Copy | Notes |
|---|---|---|---|
| S-O-01 | Navigation | 翻译服务 · 阅读 · 提示词与术语 · 数据 | The hash keeps the place (`#services` …) |
| S-O-02 | Settings could not be read | 设置读取失败，当前使用默认设置；已保存的 API Key 与服务选择均未生效。请重新填写。 | Top of every section, with the reason under it; the popup no longer carries this state |
| S-O-05 | Sidebar · interface language | 界面语言 / 跟随浏览器 | [decided, 2026-09-11] Under the navigation, away from the target language: the two are two different things (§6). A change reloads the whole page |
| S-O-10 | Built-in services | 内置服务 | Three cards with a radio each: Microsoft 翻译 · Google 翻译 · Chrome 翻译, the popup's names and hints (S-P-44…46) |
| S-O-11 | Chrome card action | 下载 | While the pack is `downloadable`; the card cannot be chosen until it is there (S-P-40…43) |
| S-O-12 | My services | 我的服务 | The reader's own, any number; each row is 名称 · 模型 · 主机名 |
| S-O-13 | My services · empty | 还没有添加服务。添加后即可使用 LLM 翻译。 | |
| S-O-14 | My services · actions | 添加服务 / 编辑 | Both open the same drawer |
| S-O-15 | Service drawer | 添加服务 / 编辑服务 | 名称 · 接口地址 · API Key · 模型 · 更多选项 ▸ 深度思考 |
| S-O-16 | Endpoint address hint | OpenRouter、DeepSeek、Ollama 等 OpenAI 兼容接口 | One kind of service; no vendor templates (owner, 2026-09-10) |
| S-O-17 | API Key · saved | •••••••• | “清除” beside it; an empty box means "leave it alone" |
| S-O-18 | API Key hint | 本机地址可以不填 | Only for localhost / 127.0.0.1 |
| S-O-19 | Drawer action | 连接 / 连接中… | Saves, requests the origin if needed, then translates one sample through this service by name |
| S-O-20 | Connection result | 已连接 · {ms} ms | Failure shows the S-E reason |
| S-O-21 | Drawer action · delete | 删除 → 确认删除 · 取消 | Two clicks, no modal; a deleted service that was chosen falls back to Microsoft 翻译 |
| S-O-22 | Automatic switch | 出问题时自动改用免费服务 / API Key 失效、额度用尽或断网时，翻译不会停下 | On by default |
| S-O-23 | Target language | 目标语言 | The popup's searchable menu (S-P-22/23) |
| S-O-24 | Image translation | 图片翻译 / 译文叠在图上，鼠标悬停查看原文 | The switch the popup shows (S-P-85) |
| S-O-25 | Helper · detecting / ready | 正在检测识别助手… / 识别助手已就绪 {版本} | |
| S-O-27 | Helper · not installed (macOS) | 安装识别助手 / 图片翻译在本机识别图中的文字。识别助手仅需安装一次，后续自动生效。 | [decided, 2026-09-12, revised from the three-step version of 09-11] **Two steps and done** (`src/ui/HelperSetup.tsx`). **The popup and the options page share this one component**: both say the same thing, and two versions would only drift |
| S-O-27a | Step one | 打开「终端」 / ⌘ 空格，输入 Terminal 后回车 | |
| S-O-27b | Step two | 在终端中执行以下命令 / 点击复制 → 已复制 | The whole command is one button; a click anywhere copies it. **Wrapped rather than scrolled sideways**: this is a `curl \| bash`, and with the end out of sight there is no telling whether to run it |
| S-O-27c | Waiting | 执行完成后自动生效，无需返回此处 | [decided, 2026-09-12] **Replaces the former “我已经装好了” button**: after the install the background detects it by itself (DESIGN §15.4), and the reader need not come back to the extension. Copying starts the wait |
| S-O-27d | Not detected after 3 minutes | 尚未检测到识别助手。请确认命令已执行完毕且未出现报错。 | Replaces S-O-27c in place, no change of interface; the command block stays clickable and can be copied again at any time |
| S-O-86 | Helper · awaiting permission (macOS) | 图片翻译需要允许扩展与识别助手通信 / 允许 | [2026-09-13, ADR-0002] The permission button, before S-O-27; `src/ui/HelperPermission.tsx` shared with the popup |
| S-O-86a | Permission refused | 未允许。允许后才能识别图中的文字 | One line of explanation in place; the button stays |
| S-O-86b | Permission taking effect | 已允许，稍后自动生效 | Transitional; the background's new worker broadcasts the state once up, and this section follows by itself |
| S-O-26 | Image modes | 在这些模式下显示图片译文 / 只影响显示：切到没勾的模式时叠加层隐藏，切回来再显示，不重新识别 | 上下 · 左右 · 仅译文 |
| S-O-40 | Translation style | 译文样式 / 选中的样式立即生效 | A grid of tiles; the chosen one carries a pencil |
| S-O-41 | List actions | 添加配置 / 重置 | 重置 restores the built-ins and keeps the reader's own |
| S-O-42 | Built-in styles | 与原文相同 · 绿色 · 蓝色 · 琥珀 · 淡一档 · 模糊 | Ordinary entries: editable and deletable |
| S-O-43 | Edit drawer | 编辑配置 | 预览 · 名称 · 文字颜色 · 透明度 · 下划线（+ 线宽）· 悬停前模糊 · 高级 |
| S-O-44 | Colour control | 跟随原文 / 自定义 | Eight swatches plus the browser's picker |
| S-O-45 | Underline | 无 · 实线 · 点线 · 虚线 · 波浪 | 线宽 1px · 2px appears once a line is chosen |
| S-O-46 | Blur | 悬停前模糊 / 译文先糊着，鼠标停上去才清晰，适合自测 | |
| S-O-47 | Advanced | 高级 / 只填声明，不写选择器和花括号；字体与字号仍随论文 | Folded; an invalid block says why on the spot |
| S-O-48 | Drawer actions | 复制一份 · 删除 · 完成 | |
| S-O-49 | Background highlight | 背景高亮 / 悬停时来标出对应句子的底色 | Same grid and editor, fields 底色 + 透明度; built-ins: 柔和绿 · 淡黄 · 淡蓝 |
| S-O-50 | Preload range | 提前翻译的范围 / 屏幕下方多远的段落先翻；越近越省费用 | 半屏 · 一屏 · 两屏 · 三屏 |
| S-O-51 | When translation starts | 开始翻译的时机 / 段落露出多少才开始翻 | 刚露出 · 露出一半 · 完全露出 |
| S-O-60 | Prompts and glossary · not an LLM | 只对 LLM 服务生效 | A line at the top; the section stays usable |
| S-O-61 | Prompts | 提示词 | The existing prompt manager on the tokens |
| S-O-62 | Glossary | 术语表 / 每行「原文, 译文」，让同一篇里的译法一致 | Top right {n} 条; saved as typed, but only when the whole table parses |
| S-O-63 | Glossary error | 第 {n} 行{原因} | Under the box, per line |
| S-O-70 | Data · cache | 已缓存的译文 / {n} 条 · {size} MB | 换了服务、模型或提示词会自动分开存，通常不用清 |
| S-O-71 | Read failed | 没能读取缓存 | Never shown as 「0 条」 |
| S-O-72 | Clear | 清空 → 确认清空 · 取消 / 已清空 | Two clicks; the result clears after 2 s |

### 3.3 In-page components

| Id | Where | Copy | Notes |
|---|---|---|---|
| S-I-01 | Loading | (no text) | The skeleton: one to three faint red bars sized by the paper's font size, breathing as a whole (DESIGN §7.6). The original mock-up's spinner is gone — a placeholder the size of the translation says “where and how much” better than a 6px ring |
| S-I-02 | Failed block | {S-E 原因} · 重试 | The raw message in `title` |
| S-I-03 | Switched notice (bottom right of the viewport) | 已改用 Google 翻译 · 去查看 | Appears once, dismissable, fades after 8 seconds; “去查看” → Settings · 翻译服务 |
| S-I-04 | Image overlay | (the translation itself) | A white translucent rounded box over the original text; hover shows the original; no node while waiting or failed (§15) |
| S-I-05 | Split-view handle (#83, experimental) | (no text) | Appears on hovering the gutter; drag changes the column width, double-click resets |

### 3.4 Error reasons (S-E)

`ProviderErrorKind` → the user sentence. Used by S-P-30/33, S-O-20, S-I-02 (corrected 2026-09-13: the connection result is S-O-20; there is no S-O-28).

| kind | User sentence | What the user can do |
|---|---|---|
| `no-key` | 还没有填写 API Key | Go to settings |
| `auth` | API Key 无效或已过期 | Go to settings |
| `rate-limit` | 请求太频繁，稍后自动重试 | Nothing |
| `timeout` | 翻译超时 | Retry |
| `network` | 网络不通 | Retry |
| `bad-request` | 翻译服务拒绝了这个请求 | Hover for the raw message |
| `invalid-response` | 返回的译文格式不对 | Retry |
| `unknown` | 翻译失败 | Retry |
| `aborted` | (not shown) | The user cancelled it |

---

## 4. Popup state table [decided, 2026-09-10 revised on ui/phase-1]

Columns are elements, cells what they show, "—" absent. Conditions use the code's fields. The card
holds the rows 翻译服务 / 目标语言 / 提示词 (LLM only) / 对照高亮 / 图片翻译 in every state but P0;
the rows open at any time.

| Id | State | Condition | Service row value | Note | Failure line | Primary button | Secondary button |
|---|---|---|---|---|---|---|---|
| P0 | Not arXiv / loading | `page === null` | — | S-P-03 (own card) | — | — | — |
| P1 | Ready | idle ∧ runnable | value | — | — | 翻译本页 | — |
| P2 | Service menu | menu = service | value | as the state | — | as the state | — |
| P3 | Language menu | menu = language | value | as the state | — | as the state | — |
| P4 | Translating | on | value | — | — | 显示原文 | — |
| P5 | Translating, with failures | on ∧ failed > 0 ∧ !fatal | value | — | S-P-60 + 重试 | 显示原文 | — |
| P6 | Switched to another service | on ∧ `engine.demoted` | the new service's name, the old struck through | S-P-30 + 设置 | per failed | 显示原文 | — |
| P7 | The chosen service cannot run, a fallback available | idle ∧ !runnable ∧ fallback | value | S-P-31 + 设置 | — | 翻译本页 | — |
| P8 | The chosen service cannot run, no fallback | idle ∧ !runnable ∧ !fallback | value | S-P-32 + 设置 | — | 翻译本页 **disabled** | — |
| P9 | Paused | stopped ∧ fatal | value | S-P-33 + 设置 | — | 重新翻译 | 显示原文 |
| P10 | Chrome language pack downloading | chrome ∧ pack = downloading | value | S-P-31 (32b) + 设置 | — | per fallback | — |
| P11 | Image translation paused | `images.fatal` | per text state | S-P-35 + 设置 | text only | per text state | — |
| P12 | Narrow window | `mode !== preference` | value | as the state | — | as the state | — |
| P13 | Page behind the settings | on ∧ `running` ≠ settings ∧ !runnable | value (the saved one) | S-P-32 + 设置 | — | 重新翻译 **disabled** | 显示原文 |
| P14 | Helper not installed | `image.enabled` ∧ helper = not-installed | value | S-P-86/87 under the image row | — | as the state | — |
| P14a | Helper awaiting permission | `image.enabled` ∧ helper = permission-missing [2026-09-13, ADR-0002] | value | S-P-86b/c under the image row | — | as the state | — |
| P14b | Helper permission taking effect | `image.enabled` ∧ helper = restarting [2026-09-13, ADR-0002] | value | S-P-86d under the image row | — | as the state | — |
| P15 | Prompt menu | llm ∧ menu = prompt | value | as the state | — | as the state | — |

Rules:
- `runnable` is decided from the settings alone (LLM: a key; Chrome: the pack is `available`;
  Microsoft: the target is supported; Google: always), never from a possibly stale chain.
- One note at a time: S-P-33 > S-P-30 > S-P-35 > S-P-31 / S-P-32. Every note carries the 设置 button.
- A change of service, language or prompt while the page is on **restarts it in place** once the
  background reports the saved values (DESIGN §8.5): paragraphs are swapped as they are requested
  again, cached ones at once. A choice that cannot run only saves → P13. The two switches are
  applied by the page's config watcher, nothing restarts.
- A permanent hand-over (missing or rejected key) restarts the page on the service that took over,
  so P6 shows one service for the whole page, not "the rest of the paragraphs".
- The primary button is the only sign that the page is on. No counts anywhere.
- The failure line counts paragraphs and figures together (S-P-60).
- S-P-74 depends on `mode !== preference` only.
- A menu is fixed-positioned under its row and pinned to the bottom of the popup window, so the
  window keeps its size while it is open; the list scrolls inside that room. The row toggles it,
  a click outside or Escape closes it.
- Layout: the service/language card, the prompt row (LLM), then a separate bubble for anything
  that needs attention (note with 设置, failures with 重试, the helper hint with 安装, which opens
  the guided install in place),
  the primary button, the mode bar, and the two small switches under it.
- Dev-only information (background version, block stats, raw `fatal` text) lives only in the
  dev-build gallery.

## 5. Tokens [implemented; marked 2026-09-13]

Names and the two value sets first; Tailwind v4 `@theme` and the in-page Shadow DOM share one set of CSS variables, prefixed `--axt-`.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--axt-bg` | #f5f5f7 | #1c1c1e | Page ground |
| `--axt-card` | #ffffff | #2c2c2e | Card |
| `--axt-fg` | #1e1e24 | #f2f2f7 | Body text |
| `--axt-fg-2` | #7c7c89 | #8e8e93 | Secondary text, labels |
| `--axt-line` | #ececf0 | #3a3a3c | Dividers |
| `--axt-control` | #e9e9ee | #3a3a3c | Segmented control ground |
| `--axt-accent` | #b31b1b | #d63c3c | arXiv red; primary button, selected state |
| `--axt-accent-soft` | #fbecec | #3b1f1f | Red pill ground, failure line ground |
| `--axt-ok` | #1f8a4c | #30d158 | Ready |
| `--axt-ok-soft` | #e8f5ec | #1f3a29 | Ready pill ground |
| `--axt-warn` | #b8860b | #ffd60a | Will switch |
| `--axt-warn-soft` | #fbf3dc | #3a3214 | Will-switch note ground |
| `--axt-radius-card` | 14px | | |
| `--axt-radius-control` | 10px | | Segments, inputs |
| `--axt-radius-pill` | 999px | | The implementation uses `rounded-full` directly |
| `--axt-font` | system-ui, PingFang SC, Noto Sans SC | | Implemented as Tailwind's `--font-ui` (`@theme inline`); the system font stack for now, whether to bundle Manrope is §8; in-page components do not use it and follow the paper |

The dark values are a first draft starting from Apple's system greys, tuned against the real popup at implementation. Whether the in-page components' dark mode follows the arXiv page's own dark style: [to verify].

### 5.1 The brand mark [decided, 2026-09-11]

An open book: the left page dark grey with an `A`, the right page arXiv red with a `文`. It ships in
**two shapes**, because the two surfaces it lands on are different, and one shape cannot serve both.

| Vector | Shape | Where it goes |
|---|---|---|
| `public/icon/mark.svg` | the bare book with a white outline, no tile: the identity itself | `public/icon/mark-{16,32,48}.png`, declared as `action.default_icon` in `wxt.config.ts` — the toolbar button, the three pages' `<link rel="icon">`, and the brand row of the popup and the settings sidebar through `src/ui/BrandMark.tsx`. Everywhere the mark stands on its own, in other words. A white tile in those places reads as a sticker; the outline is what keeps it legible on a light and a dark surface alike |
| `public/icon/tile.svg` | the same book on a white rounded tile, the app-icon shape | `public/icon/{16,32,48,96,128}.png` (WXT fills the manifest's `icons` from those names) for the extensions page, the install dialog and the store — the places that frame an icon in a card of their own |
| `docs/brand/store-icon-128.png` | 96 of tile artwork inset in a 128 canvas | uploaded by hand to the store listing, which wants the inset rather than a full-bleed icon. Never shipped inside the extension |

`pnpm icons` renders every PNG from the two vectors; the PNGs are committed, so an ordinary build
needs neither the script nor a browser.

The mark is decorative wherever it appears: the name sits beside it as text, so it carries `alt=""`.

At 16 px the two glyphs lose their strokes. Both shapes ship at that size anyway: a retina toolbar
picks the 32, the silhouette and the two colours still identify it, and one mark at every size beats
two that differ. A simplified 16 is the fallback if it ever reads badly in the wild.

## 6. Interface language [decided, 2026-09-11]

**The interface language and the target language are two different things.** The target language is what the paper is translated into; the interface language is what the buttons and notes are written in. A reader may translate the paper
into Japanese and want a Japanese interface, or an English interface with the paper in Japanese; neither should be decided for them by the other. So the two controls sit far apart:
the target language inside “翻译服务”, the interface language under the navigation (S-O-05).

**The user is a non-English reader.** Someone who reads English needs no translator on arXiv. English is only the fallback — until a language has been written,
a paper reader can mostly get by in English for a while. So adding a language has to be cheap: one file, one line in `LOCALES`, everything else follows.

| Where | Content |
|---|---|
| `src/locales/zh-CN.ts` | Simplified Chinese, and **the source of the type**: the other packs are written in its shape, and a missing key fails to compile |
| `src/locales/en.ts` | English, the fallback |
| `src/locales/index.ts` | The language table, each language's own name, `pickLocale` (the reader's choice → the browser's exact code → the same language → English) |
| `src/ui/strings.ts` | Runtime: `S` / `O` are **live bindings**, `setLocale` swaps the pack |
| `src/ui/apply-locale.ts` | The three pages and the paper page each call it once **before the first render** |
| `public/_locales/` | Only the two strings Chrome itself displays: the description on the extensions page / in the store, and the shortcut description. Only the browser reads them, and only the browser picks their language |

- **Config v13 adds `uiLanguage`**: `auto` follows the browser (`browser.i18n.getUILanguage()`, not `accept-languages` —
  someone reading English papers has English in their language list, which does not mean they want an English interface). After a change the options page reloads whole: the copy is read once before the first frame,
  and a half-Chinese half-English interface looks far worse than half a second's delay.
- **`S` / `O` are live bindings, not constants.** A value computed at module top level does not follow a change (`const NAMES = { side: S.mode.side }` freezes
  the language of the moment of import); such tables go inside components and are computed per render. `tests/ui/locales.test.ts` guards this: after switching to English
  it checks every popup state for Chinese leaking through.
- **The styles and background highlights shipped with the extension take their names from the interface language**; once the reader has renamed one, the reader's name is used (`profileName`).
  A configuration the reader added always keeps the name they wrote.
- **The target language's name is written in the interface language too**: the menu shows 「日语（日本語）」 / "Japanese (日本語)", the parentheses following
  the outer half, never mixing full-width and half-width. When an interface language has no table of language names the English names are read — adding a language need not start with 179 language names.
  **The row shows one name only** (`languageName`); the native name appears in the menu only (`languageLabel`) [decided, 2026-09-11, user feedback]:
  the row is one line of the interface, and where there is only one line, "Simplified Mandarin Chinese (简体中…)" is cut off mid-word in the English interface,
  while the Chinese interface, whose two names happen to coincide, shows a clean 「简体中文」 — a defect of the English side alone. Finding a language goes by the native name,
  and that is the menu's business.
- **The language names in the interface and the ones sent to the model are two tables**: `LANG_CODE_TO_EN_NAME` holds the ISO 639-3 scholarly names
  (coded as "individual languages"), just right for the model — `Simplified Mandarin Chinese` is not the least ambiguous; for the reader it is a mouthful,
  and no product writes it so. `LANG_CODE_TO_EN_UI_NAME` overrides 14 entries on top of it (`Chinese (Simplified)`, `Arabic`,
  `Greek`, `Pashto`…), for the interface only. The base table is not changed because it enters the prompt: changing it means bumping `PROMPT_VERSION`
  and voiding the whole LLM cache, not worth it for a name. Directional words that really distinguish (`Western Frisian`, `Northern Sotho`) stay; parentheses
  naming a script (`Uzbek (Cyrillic)`, `Malay (Jawi)`) stay too — the reader really does get that script.

## 7. Entries DESIGN.md needs to change

> 2026-09-13: items (2), (3) and (5) below are now reflected in DESIGN §8.4, §8.0 and §10 (corrections dated the same day); item (1) is stale — the shipped default is Microsoft (S-P-46, `DEFAULT_CONFIG.provider`); the rest stand as listed.

- ~~§8.1 the default provider becomes `google-web` (usable on first open)~~ — stale, the default is Microsoft
- §8.4 language pack download entry: the popup's service list + the options page's service card, both click gestures
- §9 “测试连接” folds into “连接”: `setConfig` first, then a one-sentence test translation naming the current provider; what is tested is the form's values
- §9 configuration writes: every control but the AI model form saves as it changes; the global save goes
- §10 the preload parameters appear in the UI as steps, mapped internally to margin / threshold
- §7.6 a new in-page “switched” notice (single instance, Shadow DOM)
- The error reason mapping table (§3.4) goes next to `providers/types.ts`
- §15.4 when `nativeMessaging` becomes an optional permission, the options page gains the S-O-86 permission button (decided, to be done at distribution) → [2026-09-13] done during the rebuild (ADR-0002): one “允许” on the popup card and one on the options page
- #47 typography settings enter the config schema (new field, version bump), stored apart from §7.5's translation styles

## 8. Feature coverage list

Every feature added on the main line is registered here first; a feature without a place is not designed yet.

| Feature | Source | Status | Where | Ids |
|---|---|---|---|---|
| Whole-page translation / show original | §10 | done | popup primary button; context menu (#146); shortcut Alt+T (the same toggle) | S-P-50…53, P1–P9 |
| The three comparison modes | §7 | done | popup mode bar; no in-page control | S-P-70…74 |
| Translation services (four built-in, the reader's own) + fallback chain | §8 | done | popup service card / Settings · 翻译服务 | S-P-10…46, S-O-10…23 (ids reconciled with §3 on 2026-09-13) |
| Offline language pack download | §8.4 | done | popup service list + settings service card | S-P-40…43 |
| Prompt library (built-in / custom / import and export) | §8.2 | done | Settings · 提示词与术语; popup sub-row | S-O-60…61, S-P-47 |
| Glossary | §8.2 | done | Settings · 提示词与术语 | S-O-62…63 |
| Translation styles (a configured list since v12) + custom CSS | §7.5 | done | Settings · 阅读 | S-O-40…48 |
| Preload range / timing | §10 | done | Settings · 阅读 | S-O-50…51 |
| Cache statistics / clear | §9 | done | Settings · 数据 | S-O-70…72 |
| Config read-failure notice | §9 | done | top of the settings page (the popup's S-P-34 removed 2026-09-10) | S-O-02 |
| Thinking switch | §8.2 | done | Settings · 更多选项 | S-O-30 |
| Skeleton while loading / failed block retry | §7.6 | done | in page | S-I-01…02 |
| **Image translation**: helper detection, multi-select modes, progress, pause, retry | §15, PR #87–89 | done | Settings · a section under 翻译服务; popup failure line and card note; in-page overlay | S-O-24…27d, S-P-35 / 60, S-I-04, P11, P14…P14b |
| Helper permission button | §15.4, ADR-0002 | done [2026-09-13] | popup card; Settings · 图片翻译 | S-O-86…86b, S-P-86b…d |
| **Reading typography** (font size / line height / width / spacing / colour / presets / reset) | #47 | decided, not built | Settings · 阅读 · typography card | — (no id yet; S-O-47 names the advanced CSS box since the renumbering) |
| Split-view dragging | #83 | experimental | in-page handle; one “恢复居中” in settings | S-I-05 (the settings entry has no id yet) |
| Free AI translation (hosted) | #97 | candidate | fourth item of the service list | — (no ids yet) |
| Microsoft translation | #98 | done | the service list (the shipped default) | S-P-32c / 44 / 46, S-O-10 |
| Hover highlight (sentence highlight on hover + the original floating up in translation-only mode) | #105 / #141 | done | popup card switch; Settings · 阅读 | S-P-80…81 |
| Image translation switch + helper install hint | §15 | done (2026-09-10) | popup card switch and helper hint; Settings · 图片翻译 | S-P-85…88, S-O-24…27d |
| Translation services the reader adds | §8.5 | done (2026-09-10, config v12) | Settings · 翻译服务; popup service menu | S-O-12…22, S-P-45 / 46 |
| Configuration lists for translation appearance and background highlight | §7.5 | done (2026-09-10, config v12) | Settings · 阅读 | S-O-40…49 |
| In-page “switched” notice | proposed here | undecided | in page | S-I-03 |
| Reading toolbar | canvas proposal | undecided | in page | — |
| Background connectivity / block statistics | existing popup | removed | nowhere — the gallery never showed them, and `axt:ping` / `axt:stats` had no sender (noted 2026-09-13; pruned with INVENTORY §4.4) | — |

## 9. Open for discussion

1. ~~The product name.~~ [decided] Display name **Read arXiv** (named 2026-09-10, changed to two words on 09-11, upheld on the 09-12 re-check); the repository and the domain use the unspaced `ReadarXiv` / readarxiv.org. Three places name one product; changing one does not change another.
2. The name “AI 模型” vs “AI 翻译”.
3. ~~P8 paused: primary button “重新翻译” + secondary “显示原文”, or one only?~~ [decided] Both: S-P-52 and S-P-53 shipped (marked 2026-09-13).
4. ~~Whether the language row opens a native `<select>` (first-letter jump) or a searchable list — measure the native one inside the popup first.~~ [decided] A searchable list: S-P-22 / S-P-23 shipped (marked 2026-09-13).
5. Whether to build the in-page “switched” notice; without it the user only learns the translation quality changed by opening the popup.
6. ~~The name “识别助手”.~~ [decided] Kept; it is the name throughout the shipped copy (marked 2026-09-13).
7. The field range and preset names of the typography card (#47); re-check against the issue's acceptance items before implementing.
8. Whether to bundle Manrope (about 60 KB woff2, Latin glyphs only); currently the system font stack.
