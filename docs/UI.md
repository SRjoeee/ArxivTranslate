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
| S-P-01 | 品牌行 | Read arXiv | [定] 2026-09-11 定为分写、arXiv 照官方大小写；扩展 manifest `name`、三个页面的 `<title>` 与工具栏提示都同步了，商店名与 readarxiv.org 待办。品牌标记见 §5.1 |
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
| S-P-50 | 主按钮 · 未翻译 | 翻译本页 | Shortcut badge: the key Chrome reports for `axt-toggle` (suggested Alt+T). **On every enabled face of the button** (2026-09-11): the key translates an untranslated page and restores a translated one, so 显示原文 carries it too; a paused session's 重新翻译 is what the key does there. Chrome reports nothing when another extension — or another copy of this one — already holds the combination, and then no badge is drawn |
| S-P-51 | 主按钮 · 翻译中 | 显示原文 | The only sign that the page is on: no pill. Carries the same shortcut badge as S-P-50 |
| S-P-52 | 主按钮 · 已暂停 / 页面落后于设置 | 重新翻译 | Disabled while the saved service cannot run; S-P-53 alongside |
| S-P-53 | 次按钮 | 显示原文 | Text button under S-P-52 |
| S-P-60 | 失败行 | {n} 处翻译失败 | Paragraphs and figures counted together; only when `progress.failed + images.failed > 0` and nothing is fatal |
| S-P-61 | 失败行动作 | 重试 | |
| S-P-70 | 模式分段 | 左右 · 上下 · 仅译文 | `title` S-P-71/72/73。2026-09-11 起 **左右在前**：宽屏下它是主要的读法，排第一位；`MODE_ORDER`（`src/ui/strings.ts`）是这条顺序的唯一出处，设置页的图片翻译模式也照它排。**新装的默认也是左右**（用户 2026-09-11）：宽屏下它是主要读法，窗口窄时页面自己退回上下（S-P-74） |
| S-P-71 | 模式 `title` · 上下 | 译文紧跟在原文下方 | |
| S-P-72 | 模式 `title` · 左右 | 原文与译文并排；窗口较窄时按上下显示 | |
| S-P-73 | 模式 `title` · 仅译文 | 隐藏原文，参考文献仍保留双语 | |
| S-P-74 | 模式条下备注 · 窄窗口 | 窗口较窄，暂按上下显示 | Only when 左右 is chosen and the page shows 上下 |
| S-P-80 | 对照高亮行 | 对照高亮 | Switch in the card (`reading.sentenceHighlight`); saved at once, live on the page |
| S-P-81 | 对照高亮 `title` | 悬停时高亮对应句子；仅译文模式下停留可查看原文 | |
| S-P-82 | 译文样式 · 与两个开关同一行 | 译文样式 | [定，2026-09-11，读者定稿] The last row is 对照高亮 · 图片翻译 · 译文样式 side by side — all three are "how this reads". The entry is plain text plus a chevron; the **preview is inside the menu**, where each style draws the shared sample sentence (§5.1 的 `PREVIEW_TARGET`) in itself — 淡一档 and 模糊 mean nothing as names. The list is `appearance.styles`, in the settings page's order, under the same name it has there. **The menu opens upward**: this row sits at the foot of the popup and the window does not grow to fit a panel below it. The page's config watcher redraws in the new style, so nothing restarts |
| S-P-83 | 译文样式菜单 · 最后一行 | 管理译文样式… | [定，2026-09-11，读者提出] 与服务菜单的「管理翻译服务…」同一个角色：菜单的最后一行不是一种样式，而是去管理它们的入口，所以不带预览、不参与选中。样式住在设置页的**阅读**一节，因此这一行直接开到那一节（`options.html#reading`）——`openOptionsPage` 递不进 hash，落在「翻译服务」那一节比多开一个标签页更糟；不带分节的入口（右上角齿轮、提示里的「设置」）仍用 `openOptionsPage`，它会把已经开着的那个标签页拉到前面 |
| S-P-85 | 图片翻译行 | 图片翻译 | Switch in the card (`image.enabled`, v11); saved at once, live on the page; the per-mode list stays on the options page |
| S-P-86 | 图片翻译行下 · 助手未安装（macOS） | 图片翻译需要安装识别助手 | Only while the switch is on and the helper is not detected |
| S-P-87 | 图片翻译行下 · 非 macOS | 图片翻译目前仅支持 macOS | |
| S-P-88 | 助手提示动作 | 安装 | [定，2026-09-12] 就地展开 S-O-27 的引导，不跳设置页、不开新窗口。取代了原来的「复制安装命令 · 教程」两个按钮——引导自己带命令块与教程链接 |
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
| S-O-05 | 侧栏 · 界面语言 | 界面语言 / 跟随浏览器 | [定，2026-09-11] 导航下面，离目标语言远一点：两者是两件事（§6）。改完整页重载 |
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
| S-O-25 | 识别助手 · 检测中 / 已就绪 | 正在检测识别助手… / 识别助手已就绪 {版本} | |
| S-O-27 | 识别助手 · 未安装（macOS） | 安装识别助手 / 图片翻译在本机识别图中的文字。识别助手仅需安装一次，后续自动生效。 | [定，2026-09-12，改自 09-11 的三步版] **两步走完**（`src/ui/HelperSetup.tsx`）。**popup 与设置页共用这一个组件**：两处说的是同一件事，分两套写法只会漂移 |
| S-O-27a | 步骤一 | 打开「终端」 / ⌘ 空格，输入 Terminal 后回车 | |
| S-O-27b | 步骤二 | 在终端中执行以下命令 / 点击复制 → 已复制 | 命令整块是一个按钮，点击任意位置均可复制。**折行显示而非横向滚动**：这是一条 `curl \| bash`，看不到结尾便无从判断是否应当执行 |
| S-O-27c | 等待中 | 执行完成后自动生效，无需返回此处 | [定，2026-09-12] **取代了原来的「我已经装好了」按钮**：装完由 background 自己检测（DESIGN §15.4），读者不必回到扩展。复制即开始等 |
| S-O-27d | 3 分钟未检测到 | 尚未检测到识别助手。请确认命令已执行完毕且未出现报错。 | 在 S-O-27c 原处换成这一句，不切换界面；命令块始终可点，随时可重新复制 |
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
| S-I-01 | 加载中 | （无文字） | 骨架屏：一到三条按论文字号排的红色淡条，整体呼吸（DESIGN §7.6）。原设计稿的转环去掉了——一块与译文同大小的占位比一个 6px 的环多说了「在哪、有多少」 |
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

## 6. 界面语言 [定，2026-09-11]

**界面语言与目标语言是两件事。** 目标语言是论文被译成什么，界面语言是按钮和说明用什么写。读者可能把论文
译成日语、界面也要日语，也可能界面用英文而论文译成日语；哪一个都不该由另一个替他决定。所以两个控件离得远：
目标语言在「翻译服务」里，界面语言在导航下面（S-O-05）。

**用户是非英语读者。** 读英文的人在 arXiv 上不需要翻译器。英文只是兜底——某种语言还没写出来时，
读论文的人多半能用英文顶一阵。所以加一种语言必须便宜：一个文件，`LOCALES` 里一行，别的都跟着走。

| 位置 | 内容 |
|---|---|
| `src/locales/zh-CN.ts` | 简体中文，也是**类型的来源**：其余语言包按它的形状写，少一个键编译不过 |
| `src/locales/en.ts` | 英文，兜底 |
| `src/locales/index.ts` | 语言表、每种语言自己的名字、`pickLocale`（读者选定 → 浏览器精确码 → 同语言 → 英文） |
| `src/ui/strings.ts` | 运行时：`S` / `O` 是**活绑定**，`setLocale` 换包 |
| `src/ui/apply-locale.ts` | 三个页面与论文页在**首次渲染之前**各调一次 |
| `public/_locales/` | 只有 Chrome 自己显示的两条：扩展管理页 / 商店的说明，与快捷键说明。它们只有浏览器读得到，也只能由浏览器挑语言 |

- **配置 v13 加 `uiLanguage`**：`auto` 跟随浏览器（`browser.i18n.getUILanguage()`，不是 `accept-languages`——
  读英文论文的人语言列表里有英文，不代表他要英文界面）。改这个值之后设置页整页重载：文案在首帧之前读一次，
  半中半英的界面比慢半秒难看得多。
- **`S` / `O` 是活绑定，不是常量。** 模块顶层算出来的值不跟着换（`const NAMES = { side: S.mode.side }` 会把
  导入那一刻的语言冻住），这类表要放进组件里按渲染算。`tests/ui/locales.test.ts` 守着这条：换成英文之后
  逐个 popup 状态检查有没有中文漏出来。
- **随扩展一起发的样式与背景高亮，名字跟着界面语言走**；读者改过名字之后就用读者的（`profileName`）。
  读者自己添加的配置永远用他自己写的名字。
- **目标语言的名字也跟着界面语言写**：菜单里是「日语（日本語）」/ "Japanese (日本語)"，括号跟着
  外面那半句走，全角半角不混用。一种界面语言没有语言名表时读英文名——加语言不必先翻 179 个语言名。
  **行里只写一个名字**（`languageName`），母语名只在菜单里出现（`languageLabel`）[定，2026-09-11，用户反馈]：
  行是界面的一行，只有一行的地方，英文界面下 "Simplified Mandarin Chinese (简体中…)" 会拦腰截断，
  而中文界面因为两个名字恰好相同、显示的是干净的「简体中文」——这是英文界面单边的毛病。找语言靠母语名，
  那是菜单的事。
- **界面里的语言名与发给模型的语言名是两张表**：`LANG_CODE_TO_EN_NAME` 是 ISO 639-3 的学名
  （编的是"语言个体"），对模型正好——`Simplified Mandarin Chinese` 半点不含糊；对读者太拗口，
  没有产品这么写。`LANG_CODE_TO_EN_UI_NAME` 在它之上覆盖 14 条（`Chinese (Simplified)`、`Arabic`、
  `Greek`、`Pashto`…），只作用于界面。不改底表是因为它进 prompt，改了要升 `PROMPT_VERSION`、
  让全站 LLM 缓存作废，为一个名字不值当。方位词是真区分的（`Western Frisian`、`Northern Sotho`）保留；
  带文字的括号（`Uzbek (Cyrillic)`、`Malay (Jawi)`）也保留——读者拿到的确实是那种文字。

## 7. 需要改 DESIGN.md 的条目

- §8.1 默认 provider 改为 `google-web`（首次打开即可用）
- §8.4 语言包下载入口：popup 服务列表 + 设置页服务卡，两处都是点击手势
- §9 「测试连接」并入「连接」：先 `setConfig` 再指名当前 provider 试译一句；测的是表单值
- §9 配置写入：除 AI 模型表单外所有控件即改即存，去掉全局保存
- §10 预翻译参数在 UI 上以刻度呈现，内部映射 margin / threshold
- §7.6 新增页内「已改用」提示（单实例、Shadow DOM）
- 错误原因映射表（§3.4）放进 `providers/types.ts` 旁
- §15.4 `nativeMessaging` 改可选权限时，设置页加 S-O-86 授权按钮（已决定，分发时做）
- #47 排版设置进入 config schema（新字段，升版本），与 §7.5 译文样式分开存

## 8. 功能覆盖清单

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

## 9. 待讨论

1. ~~产品名。~~ [定] Read arXiv（2026-09-10 定名，2026-09-11 改为分写）。
2. 「AI 模型」这个叫法 vs 「AI 翻译」。
3. P8 已暂停：主按钮「重新翻译」+ 次按钮「显示原文」，还是只留一个？
4. 语言行点开是原生 `<select>`（首字母跳转）还是带搜索的列表——先实测原生在 popup 里的表现。
5. 页内「已改用」提示要不要做；不做的话用户只有打开 popup 才知道译文质量变了。
6. 「识别助手」这个叫法。
7. 排版卡（#47）的字段范围和预设名，实现前要按 issue 的验收项再核一遍。
8. 是否内置 Manrope（约 60 KB woff2，只影响 Latin 字形）；现在是系统字体栈。
