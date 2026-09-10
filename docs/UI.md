# UI 契约 — 文案、状态与令牌

界面实现的唯一依据。设计画布（`docs/design/canvas/`）只作参照；两者冲突以本文为准，要改先改这里。
编号规则：`P` popup 状态、`O` 设置页、`I` 页内组件；文案编号 `S-<面>-<序号>`。反馈时直接引用编号。

状态：**草稿，逐节讨论中**。已定的节标 [定]，未定的标 [议]。

---

## 1. 语气规则 [议]

1. **对用户说话，不说系统内部。** 不出现 provider、引擎链、降级、块、会话、fallback、background、fixture 等词；内部概念一律换成 §2 的用户词。
2. **按钮是动词短语，3–5 字。** 翻译本页、显示原文、重试、连接、下载、清空。不用「确定」「OK」这种不说明后果的词。
3. **状态是名词或形容词，2–4 字。** 就绪、翻译中、已暂停、需要设置。
4. **出错只说三件事：发生了什么、影响是什么、你能做什么。** 不写错误码、不猜原因、不道歉。错误码与原始信息放在悬停 `title` 里供排查。
5. **数字只在用户能据此行动时出现。** 「2 段没翻出来 · 重试」可以；「已翻 24 / 已触发 31（共 120）」不行。
6. **一句话说完，≤ 30 字。** 说不完的拆成设置页里的说明文字，popup 里不解释原理。
7. **不用客套与语气词**：请、哦、一下、吧、啦。不用感叹号。单句不加句末句号；两句以上才用句号。
8. **同一概念全站只用一个词**，见 §2。
9. **中英混排留一个空格**；产品名、模型名、API Key 保留原文大小写。
10. **全角标点**，省略号用单字「…」，间隔用「·」。

## 2. 术语对照 [议]

| 内部词（代码 / DESIGN.md） | 用户看到的词 | 备注 |
|---|---|---|
| provider / engine | **翻译服务**（上下文清楚时简称「服务」） | 三家参考产品都用「翻译服务」 |
| `openai-compat` | **AI 模型** | 用户认的是「AI」，不是「LLM」「OpenAI 兼容」 |
| `google-web` | **Google 翻译** | |
| `chrome-builtin` | **Chrome 离线翻译** | |
| fallback / demoted | **已改用 ×××** | 用动作描述，不造名词 |
| block / segment | **段落** | 表格、公式块对用户也是「段落」 |
| translate page | **翻译本页** | |
| restore | **显示原文** | 与「翻译本页」成对；「恢复」暗示出了错 |
| mode: stack / side / only | **上下对照 / 左右对照 / 仅译文**（分段控件里简作 上下 / 左右 / 仅译文） | |
| targetLanguage | **翻译为** | 「译成」偏书面 |
| language pack | **离线语言包** | |
| prompt | **提示词** | AI 用户的通用词 |
| glossary | **术语表** | |
| cache | **已缓存的译文** | 不单说「缓存」 |
| preload margin | **提前翻译的范围** | 刻度：半屏 / 一屏 / 两屏 / 三屏 |
| preload threshold | **开始翻译的时机** | 刻度：刚露出 / 露出一半 / 完全露出 |
| thinking | **深度思考** | 国内 AI 产品的通用叫法 |
| baseURL | **接口地址** | |
| apiKey | **API Key** | 保留英文，用户在服务商那边看到的就是这个 |
| model | **模型** | |
| test connection | **连接** | = 保存 + 验证一句 |
| retry failed | **重试** | |
| fatal / stopped | **已暂停** | 页面上还留着部分译文，所以是「暂停」不是「失败」 |
| image translation / overlay | **图片翻译**；叠加层不命名 | §15 |
| OCR helper | **识别助手** | 用户不需要知道 Native Messaging、Vision、helper |
| `image.modes` | **在这些模式下显示图片译文** | 只影响显示，不重识别 |
| reading typography（#47） | **排版** | 与「译文样式」（装饰）分开：排版管字号、行高、宽度、间距 |
| split view（#83） | **分栏** | 实验功能 |
| hosted free LLM（#97） | **免费 AI 翻译** | 候选；与「AI 模型」（自带 Key）并列 |
| `microsoft`（#98，已实现） | **Microsoft 翻译** | 免费；只能手动选，不进自动改用的备用列表（DESIGN §8.5）。链接与公式都保留，丢的是斜体等行内样式（段首标签会补回，#150） |
| `reading.sentenceHighlight`（#105 / #141） | **对照高亮** | 指到哪句亮哪句；仅译文模式下停留即浮出原文 |

## 3. 文案表 [议]

### 3.1 Popup

Revised 2026-09-10 in review (see §4 for the states). Copy is the product's register: nouns for
states, verbs for buttons, no spoken phrases (去填 / 去修 are out), every note gets a real button.

| 编号 | 位置 / 何时 | 文案 | 备注 |
|---|---|---|---|
| S-P-01 | 品牌行 | Readarxiv | [定] 2026-09-10 更名；扩展 manifest `name` 已同步，商店名与 readarxiv.org 待办。品牌标记见 §5.1 |
| S-P-02 | 品牌行齿轮 `aria-label`；每条说明旁的按钮 | 设置 | The one button of every note; opens the options page |
| S-P-03 | 非 arXiv 页 / 页面加载中（P0） | 打开 arXiv 论文的 HTML 页面后即可翻译 | Same sentence for both cases; never "后台未响应" |
| S-P-10 | 服务行标签 | 翻译服务 | The row opens the service menu (S-P-40…46) under itself |
| S-P-11 | 服务行值 | {模型名 / 服务名} | LLM shows the model (`deepseek-v4-flash`), others their name; while replaced (S-P-30) the service in use with the one put aside struck through |
| S-P-20 | 语言行标签 | 目标语言 | The row opens the language menu |
| S-P-21 | 语言行值 | {语言名} | `languages.ts` label |
| S-P-22 | 语言菜单搜索框 | 搜索语言 | Matches the Chinese name, the local name, the English name and the code |
| S-P-23 | 语言菜单无结果 | 没有匹配的语言 | |
| S-P-30 | 说明 · 已改用 | {原服务}：{原因}。本页已改用 {新服务} | A permanent hand-over restarts the whole page on the new service (DESIGN §8.5); reason per S-E |
| S-P-31 | 说明 · 将改用 | {为何不能用}，本次将使用 {服务} | Idle, the chosen service cannot run, another takes over |
| S-P-32 | 说明 · 不能翻译 | {为何不能用} | Idle with nothing to take over, or the page left behind by a choice that cannot run (P13) |
| S-P-32a | {为何不能用} · LLM | LLM 尚未配置 API Key | |
| S-P-32b | {为何不能用} · Chrome | Chrome 翻译的语言包尚未下载 / Chrome 翻译的语言包下载中，约需 1 分钟 | Reachable from the options page only: the popup's item is greyed |
| S-P-32c | {为何不能用} · Microsoft | Microsoft 翻译不支持当前目标语言 | |
| S-P-33 | 说明 · 已暂停 | {原因}。请检查设置后重新翻译 | Reason per S-E |
| S-P-35 | 说明 · 图片翻译已暂停 | 图片翻译已暂停：{原因} | `images.fatal`; shown while text translation continues |
| S-P-40 | 服务菜单 · Chrome 项动作 | 下载 | While `downloadable`; the item is greyed until the pack is there; the click itself starts the download (user gesture) |
| S-P-41 | 服务菜单 · Chrome 项副标题 · 下载中 | 语言包下载中 | Spinner in place of the button; no progress events, so no bar |
| S-P-42 | 服务菜单 · Chrome 项副标题 · 不可用 | 当前不可用 | `unavailable` / `unsupported`, greyed, no button |
| S-P-43 | 服务菜单 · Chrome 项副标题 · 就绪 | 浏览器内置，无需联网 | |
| S-P-44 | 服务菜单 · Microsoft / Google 副标题 | 免费 | Microsoft with an unsupported target: 不支持当前目标语言, greyed |
| S-P-45 | 服务菜单 · LLM 副标题 | {模型名} / 尚未配置 API Key | Selectable without a key; the note S-P-31/32 and its 设置 button follow |
| S-P-46 | 服务菜单 · 名称与顺序 | Microsoft 翻译 · Google 翻译 · LLM · Chrome 翻译 | [定] 2026-09-10; Microsoft is the shipped default |
| S-P-47 | 提示词行 | 提示词 / {名称} | Only while the LLM is chosen; opens the prompt menu |
| S-P-50 | 主按钮 · 未翻译 | 翻译本页 | Shortcut badge: the key Chrome reports for `axt-toggle` (suggested Alt+T); on an enabled 翻译本页 / 重新翻译 only |
| S-P-51 | 主按钮 · 翻译中 | 显示原文 | The only sign that the page is on: no pill |
| S-P-52 | 主按钮 · 已暂停 / 页面落后于设置 | 重新翻译 | Disabled while the saved service cannot run; S-P-53 alongside |
| S-P-53 | 次按钮 | 显示原文 | Text button under S-P-52 |
| S-P-60 | 失败行 | {n} 处翻译失败 | Paragraphs and figures counted together; only when `progress.failed + images.failed > 0` and nothing is fatal |
| S-P-61 | 失败行动作 | 重试 | |
| S-P-70 | 模式分段 | 左右 · 上下 · 仅译文 | `title` S-P-71/72/73。2026-09-11 起 **左右在前**：宽屏下它是主要的读法，排第一位；`MODE_ORDER`（`src/ui/strings.ts`）是这条顺序的唯一出处，设置页的图片翻译模式也照它排 |
| S-P-71 | 模式 `title` · 上下 | 译文紧跟在原文下方 | |
| S-P-72 | 模式 `title` · 左右 | 原文与译文并排；窗口较窄时按上下显示 | |
| S-P-73 | 模式 `title` · 仅译文 | 隐藏原文，参考文献仍保留双语 | |
| S-P-74 | 模式条下备注 · 窄窗口 | 窗口较窄，暂按上下显示 | Only when 左右 is chosen and the page shows 上下 |
| S-P-80 | 对照高亮行 | 对照高亮 | Switch in the card (`reading.sentenceHighlight`); saved at once, live on the page |
| S-P-81 | 对照高亮 `title` | 悬停时高亮对应句子；仅译文模式下停留可查看原文 | |
| S-P-85 | 图片翻译行 | 图片翻译 | Switch in the card (`image.enabled`, v11); saved at once, live on the page; the per-mode list stays on the options page |
| S-P-86 | 图片翻译行下 · 助手未安装（macOS） | 图片翻译需要安装识别助手 | Only while the switch is on and the helper is not detected |
| S-P-87 | 图片翻译行下 · 非 macOS | 图片翻译目前仅支持 macOS | |
| S-P-88 | 助手提示动作 | 复制安装命令 / 已复制 | Copies the one-line install `curl -fsSL …/helper/install-remote.sh \| bash -s -- <extension id>` (helper/README.md) |
| S-P-89 | 助手提示动作 | 教程 | Opens helper/README.md |
| S-P-90 | 动作失败 | {原始信息} | Red line under the primary button (`role=alert`), cleared before the next action |

Removed 2026-09-10: the state pills (S-P-12…18) and the config-fallback note (S-P-34; the options page announces it).

### 3.2 设置页

Rebuilt 2026-09-10 (spec `docs/superpowers/specs/2026-09-10-settings-services-appearance-design.md`).
Four sections behind a left navigation; there is no save button — every control writes as it
changes, and the two drawers commit with one button.

| 编号 | 位置 | 文案 | 备注 |
|---|---|---|---|
| S-O-01 | 导航 | 翻译服务 · 阅读 · 提示词与术语 · 数据 | The hash keeps the place (`#services` …) |
| S-O-02 | 设置读取失败 | 设置读取失败，当前使用默认设置；已保存的 API Key 与服务选择均未生效。请重新填写。 | Top of every section, with the reason under it; the popup no longer carries this state |
| S-O-10 | 内置服务 | 内置服务 | Three cards with a radio each: Microsoft 翻译 · Google 翻译 · Chrome 翻译, the popup's names and hints (S-P-44…46) |
| S-O-11 | Chrome 卡动作 | 下载 | While the pack is `downloadable`; the card cannot be chosen until it is there (S-P-40…43) |
| S-O-12 | 我的服务 | 我的服务 | The reader's own, any number; each row is 名称 · 模型 · 主机名 |
| S-O-13 | 我的服务 · 空 | 还没有添加服务。添加后即可使用 LLM 翻译。 | |
| S-O-14 | 我的服务 · 动作 | 添加服务 / 编辑 | Both open the same drawer |
| S-O-15 | 服务抽屉 | 添加服务 / 编辑服务 | 名称 · 接口地址 · API Key · 模型 · 更多选项 ▸ 深度思考 |
| S-O-16 | 接口地址说明 | OpenRouter、DeepSeek、Ollama 等 OpenAI 兼容接口 | One kind of service; no vendor templates (owner, 2026-09-10) |
| S-O-17 | API Key · 已保存 | •••••••• | 「清除」beside it; an empty box means "leave it alone" |
| S-O-18 | API Key 说明 | 本机地址可以不填 | Only for localhost / 127.0.0.1 |
| S-O-19 | 抽屉动作 | 连接 / 连接中… | Saves, requests the origin if needed, then translates one sample through this service by name |
| S-O-20 | 连接结果 | 已连接 · {ms} ms | Failure shows the S-E reason |
| S-O-21 | 抽屉动作 · 删除 | 删除 → 确认删除 · 取消 | Two clicks, no modal; a deleted service that was chosen falls back to Microsoft 翻译 |
| S-O-22 | 自动改用 | 出问题时自动改用免费服务 / API Key 失效、额度用尽或断网时，翻译不会停下 | 默认开 |
| S-O-23 | 目标语言 | 目标语言 | The popup's searchable menu (S-P-22/23) |
| S-O-24 | 图片翻译 | 图片翻译 / 译文叠在图上，鼠标悬停查看原文 | The switch the popup shows (S-P-85) |
| S-O-25 | 识别助手 | 正在检测识别助手… / 识别助手已就绪 {版本} / 图片翻译需要安装识别助手 | The install line carries 复制安装命令 and 教程 (S-P-86…89) |
| S-O-26 | 图片模式 | 在这些模式下显示图片译文 / 只影响显示：切到没勾的模式时叠加层隐藏，切回来再显示，不重新识别 | 上下 · 左右 · 仅译文 |
| S-O-40 | 译文样式 | 译文样式 / 选中的样式立即生效 | A grid of tiles; the chosen one carries a pencil |
| S-O-41 | 列表动作 | 添加配置 / 重置 | 重置 restores the built-ins and keeps the reader's own |
| S-O-42 | 内置样式 | 与原文相同 · 绿色 · 蓝色 · 琥珀 · 淡一档 · 模糊 | Ordinary entries: editable and deletable |
| S-O-43 | 编辑抽屉 | 编辑配置 | 预览 · 名称 · 文字颜色 · 透明度 · 下划线（+ 线宽）· 悬停前模糊 · 高级 |
| S-O-44 | 颜色控件 | 跟随原文 / 自定义 | Eight swatches plus the browser's picker |
| S-O-45 | 下划线 | 无 · 实线 · 点线 · 虚线 · 波浪 | 线宽 1px · 2px appears once a line is chosen |
| S-O-46 | 模糊 | 悬停前模糊 / 译文先糊着，鼠标停上去才清晰，适合自测 | |
| S-O-47 | 高级 | 高级 / 只填声明，不写选择器和花括号；字体与字号仍随论文 | Folded; an invalid block says why on the spot |
| S-O-48 | 抽屉动作 | 复制一份 · 删除 · 完成 | |
| S-O-49 | 背景高亮 | 背景高亮 / 悬停时来标出对应句子的底色 | Same grid and editor, fields 底色 + 透明度; 内置：柔和绿 · 淡黄 · 淡蓝 |
| S-O-50 | 提前翻译的范围 | 提前翻译的范围 / 屏幕下方多远的段落先翻；越近越省费用 | 半屏 · 一屏 · 两屏 · 三屏 |
| S-O-51 | 开始翻译的时机 | 开始翻译的时机 / 段落露出多少才开始翻 | 刚露出 · 露出一半 · 完全露出 |
| S-O-60 | 提示词与术语 · 非 LLM | 只对 LLM 服务生效 | A line at the top; the section stays usable |
| S-O-61 | 提示词 | 提示词 | The existing prompt manager on the tokens |
| S-O-62 | 术语表 | 术语表 / 每行「原文, 译文」，让同一篇里的译法一致 | 右上 {n} 条；saved as typed, but only when the whole table parses |
| S-O-63 | 术语表错误 | 第 {n} 行{原因} | Under the box, per line |
| S-O-70 | 数据 · 缓存 | 已缓存的译文 / {n} 条 · {size} MB | 换了服务、模型或提示词会自动分开存，通常不用清 |
| S-O-71 | 读取失败 | 没能读取缓存 | Never shown as 「0 条」 |
| S-O-72 | 清空 | 清空 → 确认清空 · 取消 / 已清空 | Two clicks; the result clears after 2 s |

### 3.3 页内组件

| 编号 | 位置 | 文案 | 备注 |
|---|---|---|---|
| S-I-01 | 加载中 | （无文字） | 转环 + 骨架线 |
| S-I-02 | 失败块 | {S-E 原因} · 重试 | 原始信息在 `title` |
| S-I-03 | 已改用提示（视口右下角） | 已改用 Google 翻译 · 去查看 | 出现一次，可关闭，8 秒后淡出；「去查看」→ 设置 · 翻译服务 |
| S-I-04 | 图片叠加层 | （译文本身） | 白色半透明圆角框盖在原文字上，悬停显示原文；等待 / 失败不建节点（§15） |
| S-I-05 | 分栏手柄（#83，实验） | （无文字） | 中缝悬停出现，拖动改列宽，双击复位 |

### 3.4 错误原因（S-E）

`ProviderErrorKind` → 用户句。用于 S-P-30/33、S-O-28、S-I-02。

| kind | 用户句 | 用户能做什么 |
|---|---|---|
| `no-key` | 还没有填写 API Key | 去设置 |
| `auth` | API Key 无效或已过期 | 去设置 |
| `rate-limit` | 请求太频繁，稍后自动重试 | 不用做什么 |
| `timeout` | 翻译超时 | 重试 |
| `network` | 网络不通 | 重试 |
| `bad-request` | 翻译服务拒绝了这个请求 | 悬停看原始信息 |
| `invalid-response` | 返回的译文格式不对 | 重试 |
| `unknown` | 翻译失败 | 重试 |
| `aborted` | （不显示） | 用户自己取消的 |

---

## 4. Popup 状态表 [定，2026-09-10 revised on ui/phase-1]

Columns are elements, cells what they show, "—" absent. Conditions use the code's fields. The card
holds the rows 翻译服务 / 目标语言 / 提示词 (LLM only) / 对照高亮 / 图片翻译 in every state but P0;
the rows open at any time.

| 编号 | 状态 | 判定 | 服务行值 | 说明 | 失败行 | 主按钮 | 次按钮 |
|---|---|---|---|---|---|---|---|
| P0 | 非 arXiv / 加载中 | `page === null` | — | S-P-03 (own card) | — | — | — |
| P1 | 就绪 | idle ∧ runnable | 值 | — | — | 翻译本页 | — |
| P2 | 翻译服务菜单 | menu = service | 值 | as the state | — | as the state | — |
| P3 | 目标语言菜单 | menu = language | 值 | as the state | — | as the state | — |
| P4 | 翻译中 | on | 值 | — | — | 显示原文 | — |
| P5 | 翻译中，有失败 | on ∧ failed > 0 ∧ !fatal | 值 | — | S-P-60 + 重试 | 显示原文 | — |
| P6 | 已改用其他服务 | on ∧ `engine.demoted` | 新服务名，旧名划线 | S-P-30 + 设置 | per failed | 显示原文 | — |
| P7 | 所选服务不能用，有服务替代 | idle ∧ !runnable ∧ fallback | 值 | S-P-31 + 设置 | — | 翻译本页 | — |
| P8 | 所选服务不能用，无替代 | idle ∧ !runnable ∧ !fallback | 值 | S-P-32 + 设置 | — | 翻译本页 **禁用** | — |
| P9 | 已暂停 | stopped ∧ fatal | 值 | S-P-33 + 设置 | — | 重新翻译 | 显示原文 |
| P10 | Chrome 语言包下载中 | chrome ∧ pack = downloading | 值 | S-P-31 (32b) + 设置 | — | per fallback | — |
| P11 | 图片翻译已暂停 | `images.fatal` | per text state | S-P-35 + 设置 | text only | per text state | — |
| P12 | 窄窗口 | `mode !== preference` | 值 | as the state | — | as the state | — |
| P13 | 页面落后于设置 | on ∧ `running` ≠ settings ∧ !runnable | 值 (the saved one) | S-P-32 + 设置 | — | 重新翻译 **禁用** | 显示原文 |
| P14 | 识别助手未安装 | `image.enabled` ∧ !helper.available | 值 | S-P-86/87 under the image row | — | as the state | — |
| P15 | 提示词菜单 | llm ∧ menu = prompt | 值 | as the state | — | as the state | — |

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
  that needs attention (note with 设置, failures with 重试, the helper hint with 复制安装命令 / 教程),
  the primary button, the mode bar, and the two small switches under it.
- Dev-only information (background version, block stats, raw `fatal` text) lives only in the
  dev-build gallery.

## 5. 令牌 [议]

先定名与两套值，Tailwind v4 `@theme` 与页内 Shadow DOM 共用同一份 CSS 变量；前缀 `--axt-`。

| 令牌 | 浅色 | 深色 | 用途 |
|---|---|---|---|
| `--axt-bg` | #f5f5f7 | #1c1c1e | 页面底 |
| `--axt-card` | #ffffff | #2c2c2e | 卡片 |
| `--axt-fg` | #1e1e24 | #f2f2f7 | 正文 |
| `--axt-fg-2` | #7c7c89 | #8e8e93 | 次要文字、标签 |
| `--axt-line` | #ececf0 | #3a3a3c | 分隔线 |
| `--axt-control` | #e9e9ee | #3a3a3c | 分段控件底 |
| `--axt-accent` | #b31b1b | #d63c3c | arXiv 红，主按钮、选中态 |
| `--axt-accent-soft` | #fbecec | #3b1f1f | 红色药丸底、失败行底 |
| `--axt-ok` | #1f8a4c | #30d158 | 就绪 |
| `--axt-ok-soft` | #e8f5ec | #1f3a29 | 就绪药丸底 |
| `--axt-warn` | #b8860b | #ffd60a | 将改用 |
| `--axt-warn-soft` | #fbf3dc | #3a3214 | 将改用说明底 |
| `--axt-radius-card` | 14px | | |
| `--axt-radius-control` | 10px | | 分段、输入框 |
| `--axt-radius-pill` | 999px | | 实装直接用 `rounded-full` |
| `--axt-font` | system-ui, PingFang SC, Noto Sans SC | | 实装为 Tailwind 的 `--font-ui`（`@theme inline`）；先用系统字体栈，是否内置 Manrope 见 §8；页内组件不用，跟随论文 |

深色值是从苹果系统灰起的初稿，实装时对着真 popup 调。页内组件的深色是否跟随 arXiv 页面自身的深色样式：[待验证]。

### 5.1 The brand mark [定，2026-09-11]

An open book: the left page dark grey with an `A`, the right page arXiv red with a `文`. One vector,
`public/icon/logo.svg`, is the source for everything else.

| Where | What | Who reads it |
|---|---|---|
| `public/icon/{16,32,48,96,128}.png` | rendered from the vector by `pnpm icons` | WXT fills the manifest's `icons` from the file names; Chrome uses them for the toolbar, the extensions page and the install dialog |
| `public/icon/logo.svg` | the vector, shipped | the popup's brand row and the settings sidebar draw it through `src/ui/BrandMark.tsx`; the three extension pages point their `<link rel="icon">` at the 32 |
| `docs/brand/store-icon-128.png` | 96 of artwork inset in a 128 canvas | uploaded by hand to the store listing, which wants the inset rather than a full-bleed icon. Never shipped inside the extension |

The mark is decorative wherever it appears: the name sits beside it as text, so it carries `alt=""`.

At 16 px the two glyphs lose their strokes. It is shipped at that size anyway: a retina toolbar picks
the 32, the shape and the two colours still identify it, and one mark at every size beats two marks
that differ. A simplified 16 is the fallback if it ever reads badly in the wild.

## 6. 需要改 DESIGN.md 的条目

- §8.1 默认 provider 改为 `google-web`（首次打开即可用）
- §8.4 语言包下载入口：popup 服务列表 + 设置页服务卡，两处都是点击手势
- §9 「测试连接」并入「连接」：先 `setConfig` 再指名当前 provider 试译一句；测的是表单值
- §9 配置写入：除 AI 模型表单外所有控件即改即存，去掉全局保存
- §10 预翻译参数在 UI 上以刻度呈现，内部映射 margin / threshold
- §7.6 新增页内「已改用」提示（单实例、Shadow DOM）
- 错误原因映射表（§3.4）放进 `providers/types.ts` 旁
- §15.4 `nativeMessaging` 改可选权限时，设置页加 S-O-86 授权按钮（已决定，分发时做）
- #47 排版设置进入 config schema（新字段，升版本），与 §7.5 译文样式分开存

## 7. 功能覆盖清单

主线每加一个功能先在这里登记一行；没有落点的功能不算设计完成。

| 功能 | 来源 | 状态 | 落点 | 编号 |
|---|---|---|---|---|
| 整页翻译 / 显示原文 | §10 | 已实现 | popup 主按钮；右键菜单（#146）；快捷键 Alt+T（同一开关） | S-P-50…53，P1–P9 |
| 三种对照模式 | §7 | 已实现 | popup 模式条；页内无控件 | S-P-70…74 |
| 三个翻译服务 + 降级链 | §8 | 已实现 | popup 服务卡 / 设置 · 翻译服务 | S-P-10…46，S-O-10…31 |
| 离线语言包下载 | §8.4 | 已实现 | popup 服务列表 + 设置服务卡 | S-P-40…43 |
| 提示词库（内置 / 自定义 / 导入导出） | §8.2 | 已实现 | 设置 · 提示词与术语；popup 子行 | S-O-50…58，S-P-47 |
| 术语表 | §8.2 | 已实现 | 设置 · 提示词与术语 | S-O-60…61 |
| 译文样式预设 + 自定义 CSS | §7.5 | 已实现 | 设置 · 阅读 | S-O-41…44 |
| 预翻译范围 / 时机 | §10 | 已实现 | 设置 · 阅读 | S-O-45…46 |
| 缓存统计 / 清空 | §9 | 已实现 | 设置 · 数据 | S-O-71…74 |
| 配置读取失败提示 | §9 | 已实现 | popup 卡内说明 | S-P-34，P10 |
| 深度思考开关 | §8.2 | 已实现 | 设置 · 更多选项 | S-O-30 |
| 加载环 / 失败块重试 | §7.6 | 已实现 | 页内 | S-I-01…02 |
| **图片翻译**：识别助手检测、模式多选、进度、暂停、重试 | §15，PR #87–89 | 已实现 | 设置 · 翻译服务下方一节；popup 失败行与卡内说明；页内叠加层 | S-O-80…87，S-P-35 / 60，S-I-04，P12–P13 |
| 识别助手授权按钮 | §15.4 | 已定，分发时 | 设置 · 图片翻译 | S-O-86 |
| **阅读排版**（字号 / 行高 / 宽度 / 间距 / 颜色 / 预设 / 恢复默认） | #47 | 已定未做 | 设置 · 阅读 · 排版卡 | S-O-47 |
| 分栏拖动 | #83 | 实验 | 页内手柄；设置里一个「恢复居中」 | S-I-05，S-O-48 |
| 免费 AI 翻译（托管） | #97 | 候选 | 服务列表第四项 | S-P-48，S-O-15 |
| Microsoft 翻译 | #98 | 已实现 | 服务列表第四项 | S-P-49，S-O-16 |
| 对照高亮（悬停句子高亮 + 仅译文悬浮原文） | #105 / #141 | 已实现 | popup 卡内开关；设置 · 阅读 | S-P-80…81 |
| 图片翻译开关 + 识别助手安装提示 | §15 | 已实现（2026-09-10） | popup 卡内开关与助手提示；设置 · 图片翻译 | S-P-85…89，S-O-24…26 |
| 读者自己添加的翻译服务 | §8.5 | 已实现（2026-09-10，配置 v12） | 设置 · 翻译服务；popup 服务菜单 | S-O-12…22，S-P-46/48 |
| 译文外观与背景高亮的配置列表 | §7.5 | 已实现（2026-09-10，配置 v12） | 设置 · 阅读 | S-O-40…49 |
| 页内「已改用」提示 | 本文提案 | 待定 | 页内 | S-I-03 |
| 阅读工具条 | 画布提案 | 待定 | 页内 | — |
| 后台连通 / 块统计 | 现有 popup | 开发态 | 只在开发构建样例页 | — |

## 8. 待讨论

1. ~~产品名。~~ [定] Readarxiv（2026-09-10）。
2. 「AI 模型」这个叫法 vs 「AI 翻译」。
3. P8 已暂停：主按钮「重新翻译」+ 次按钮「显示原文」，还是只留一个？
4. 语言行点开是原生 `<select>`（首字母跳转）还是带搜索的列表——先实测原生在 popup 里的表现。
5. 页内「已改用」提示要不要做；不做的话用户只有打开 popup 才知道译文质量变了。
6. 「识别助手」这个叫法。
7. 排版卡（#47）的字段范围和预设名，实现前要按 issue 的验收项再核一遍。
8. 是否内置 Manrope（约 60 KB woff2，只影响 Latin 字形）；现在是系统字体栈。
