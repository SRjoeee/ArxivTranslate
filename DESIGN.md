# arXiv HTML Translator — 设计文档

版本：v0.1 · 2026-09-03 · 状态：Phase 0 前的基线

本文是项目的唯一事实来源（source of truth）。设计变更先改这里，再改代码。
标记说明：**[决定]** 已定，不再讨论；**[待验证]** Phase 0 需要用实测确认；**[延后]** v1 不做。

---

## 1. 目标与范围

**做什么**：一款专门面向 arXiv Experimental HTML 页面（`https://arxiv.org/html/*`）的 Chrome 翻译扩展。在保留论文结构、公式、代码、链接和交互能力的前提下，提供稳定、可逆、适合长期阅读的全文翻译。

**v1 范围 [决定]**
- 仅 Chrome，仅 `https://arxiv.org/html/*`
- 三种阅读模式：左右对照（side）、上下对照（stack）、仅译文（only），任意切换，随时无损恢复原文
- 翻译引擎：LLM（OpenAI 兼容 / Anthropic / Gemini）+ 免费引擎（Chrome 内置 Translator API 优先，Google gtx 兜底）
- 本地缓存，同一论文重开秒出
- 译文样式预设 + 术语表

**非目标 [延后]**：其他站点、PDF、字幕、TTS、生词本、Firefox/Safari 适配、微软免费通道、DeepLX、图片翻译（设计已定，见 §15）。架构上不排斥，但 v1 一律不做。

---

## 2. 核心判断

arXiv HTML 由 LaTeXML 生成，DOM 高度规整，每个元素都带 `ltx_*` 类名。因此：

1. **不需要通用翻译器那套启发式 DOM walker 和站点规则订阅系统**。用一套针对 LaTeXML 的确定性规则做块切分和跳过判定，规则集中在一个文件里，可版本化。
2. **三种模式共享同一份 DOM，模式切换只改一个 CSS 属性**。译文节点永远作为原块的相邻兄弟插入，从不修改原节点子树。这是可逆性的根基。
3. **LLM 和免费 MT 引擎走两条渲染路径**。LLM 能保留行内标记（占位符），免费引擎只翻纯文本，必须按行内不可翻译节点切段。provider 用 `preservesMarkup` 能力位声明自己走哪条。

---

## 3. 术语

| 术语 | 含义 |
|---|---|
| Block（块） | 一个翻译单元，对应一个 LaTeXML 元素，如 `.ltx_p`、`.ltx_title`、`.ltx_caption` |
| Protected node（受保护节点） | 块内不翻译、必须原样保留的行内节点：公式、引用、代码、脚注标记等 |
| Placeholder（占位符） | 发给模型时替代受保护节点的标签。void 型 `<x id="n"/>`，paired 型 `<t id="n">…</t>` |
| Render path（渲染路径） | `markup`（占位符整块翻译）或 `runs`（按受保护节点切段逐段翻译） |
| Mode（模式） | `side` / `stack` / `only`，由 `html[data-axt-mode]` 控制 |
| Provider | 一个翻译引擎适配器，实现统一接口 |
| Fixture | 保存在仓库里的真实 arXiv HTML 页面，用于测试 |

前缀约定：所有扩展注入的 class、data 属性、CSS 变量统一以 `axt-` / `data-axt-` / `--axt-` 开头。

---

## 4. 整体架构

```
┌────────────────────────── content script (arxiv.org/html/*) ──────────────────────────┐
│                                                                                        │
│  extractor ──► scheduler ──► [cache?] ──► protector ──► (msg to background) ──► ...    │
│      │              │                         │                                        │
│   rules.ts    IntersectionObserver      serialize block                                │
│                                          → {text, slots}                               │
│                                                                                        │
│  ... ──► validator ──► rehydrator ──► renderer ──► DOM (sibling insert + CSS attr)      │
│                                            │                                           │
│                                         restore                                        │
└────────────────────────────────────────────────────────────────────────────────────────┘
                                   │ runtime message │
┌────────────────────────── background (service worker) ────────────────────────────────┐
│  queue (p-queue, per-provider concurrency) ──► providers/* ──► cache (IndexedDB)       │
│  health check + fallback chain                                                         │
└────────────────────────────────────────────────────────────────────────────────────────┘
┌────────────────────────── ui ─────────────────────────────────────────────────────────┐
│  popup: 翻译/恢复、模式切换、引擎选择、进度       options: providers、样式、术语表、缓存管理  │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

**数据流（单个块）**
1. `extractor` 按规则收集所有 Block，打上稳定 id（`data-axt-id`）
2. `scheduler` 视口优先排队；不可见的块在后台顺序翻完整篇
3. 先查缓存；命中直接渲染
4. 未命中：`protector` 把块序列化为 `{text, slots}`；按 provider 的 `preservesMarkup` 决定走 markup 路径（整块带占位符）还是 runs 路径（切段）
5. background 的 `queue` 按 provider 并发上限发请求；失败退避、重试、必要时切换 fallback provider
6. `validator` 校验占位符完整性；失败 → 单块重试一次 → 降级 runs 路径
7. `rehydrator` 把占位符换回受保护节点的克隆（剥掉 `id` 属性）
8. `renderer` 把译文节点插为原块的下一个兄弟，写入缓存
9. 模式切换、恢复原文，都不经过以上流程，纯 DOM/CSS 操作

---

## 5. 块模型与规则 [待验证]

以下选择器是基于对 LaTeXML 输出的已知认识写的初稿，**必须在 Phase 0 用真实页面校验**，并可能按 LaTeXML 版本分叉。规则集中在 `src/core/rules/latexml.ts`。

### 5.1 翻译单元

| 选择器 | 说明 |
|---|---|
| `.ltx_p` | 正文段落。注意 `.ltx_para` 是容器（带锚点 id），`.ltx_p` 才是文本块 |
| `.ltx_title` | 各级标题。内含 `.ltx_tag`（章节号）需作 void 占位符 |
| `.ltx_abstract .ltx_p` | 摘要 |
| `.ltx_caption` | 图表说明。内含 `.ltx_tag`（"Figure 1:"）需作 void 占位符 |
| `.ltx_item .ltx_p` | 列表项内段落 |
| `.ltx_note_content` | 脚注正文，作为独立块 |
| `.ltx_td`（含散文的） | 表格单元格，见 5.3 |
| `.ltx_bibitem` | 参考文献条目，见 5.4 |
| `.ltx_theorem .ltx_p` / `.ltx_proof .ltx_p` | 定理与证明内的段落（通常已被 `.ltx_p` 覆盖，列出以防特殊结构）|

### 5.2 跳过规则（整块不翻）

| 选择器 | 说明 |
|---|---|
| `math`, `.ltx_Math` | MathML 公式（行内的作占位符，块级的整体跳过）|
| `.ltx_equation`, `.ltx_equationgroup` | 行间公式 |
| `.ltx_tag` | 公式编号、章节号、图表号 |
| `.ltx_listing`, `.ltx_listingline`, `.ltx_verbatim`, `pre`, `code` | 代码、算法、verbatim |
| `.ltx_text.ltx_font_typewriter` | 等宽文本（视为代码）|
| `.ltx_page_navbar`, `.ltx_TOC` | 导航栏与目录 |
| `.ltx_authors`, `.ltx_author`, `.ltx_contact`, `.ltx_date` | 作者、机构、日期 |
| `.ltx_ERROR` | LaTeXML 转换错误块 |
| arXiv 自己注入的页头/页脚/报告问题按钮 | Phase 0 确认选择器 |

### 5.3 表格 [决定]

整张 `.ltx_tabular`（或其 `.ltx_table` 容器）作为一个单元处理：
- side / stack 模式：在原表**下方**插入一份译文克隆表，克隆内逐格翻译，数值格原样复制
- only 模式：隐藏原表，显示克隆表
- 不在单元格内做左右对照
- 数值格判定正则（初稿）：`^[\s\d.,+\-±×^%()/*eE−–—:;~<>=≤≥∼]+(\s*[a-zA-Zμ°%]{1,4})?$`，匹配即跳过；Phase 0 用 fixture 校准

### 5.4 参考文献 [决定]

- 默认翻译，可在设置里关闭
- **only 模式下豁免隐藏**，参考文献始终双语（原文被隐藏后对照的前提就没了）
- DOI / URL 本身是 `<a>`，走占位符自动保留
- LLM prompt 固定加一条：人名、期刊名、会议名保留原文

### 5.5 规则版本化

- 规则文件导出 `RULES_VERSION`，写入缓存键
- fixtures 覆盖多个年份和领域；任何规则改动必须通过全部 fixture 测试
- 若不同 LaTeXML 版本差异大到需要分叉，按 `rules/latexml-v1.ts`、`rules/latexml-v2.ts` + 探测函数处理，不要在一个文件里堆 if

---

## 6. 占位符引擎

位置：`src/core/protector/`。这是项目最难、最值钱的模块，必须原创，读 Read Frog 与 KISS 的实现后再动手。

### 6.1 节点分类

| 类型 | 占位符 | 节点 |
|---|---|---|
| void | `<x id="n"/>` | 行内 `math`、`.ltx_ref`、`.ltx_cite`、`code`、`.ltx_font_typewriter`、脚注标记 `.ltx_note` 的可见部分、行内图片、`br` |
| paired | `<t id="n">…</t>` | 带文字的 `a`、`.ltx_text.ltx_font_italic/bold/...`、`em`、`strong`、其他带可翻译文字的 `span` |
| text | 直接出现在文本里 | 文本节点 |

### 6.2 序列化

```ts
interface ProtectedBlock {
  blockId: string
  text: string                       // 带占位符的文本
  slots: Map<number, Node>           // id → 原节点引用
  paired: Set<number>                // 哪些 id 是 paired
}
```

- 占位符 id 在块内从 1 递增
- 保留 `&nbsp;` 与细空格（`\u2009`）在公式两侧的位置，序列化时不 trim 内部空白
- 一个块内 void 占位符超过阈值（初值 40）时，视为公式密集块，仍走 markup 路径但单独成批

### 6.3 校验

译文必须满足，否则视为失败：
- void id 集合与原文完全一致，每个恰好出现一次
- paired 标签成对且嵌套合法
- 没有出现原文中不存在的 id

失败处理：单块重试一次（prompt 里追加"占位符必须原样保留"的强调）→ 仍失败则降级为 runs 路径 → runs 也失败则该块标记为未翻译并在 UI 显示

### 6.4 回填

- 占位符替换为 `slots` 里节点的**克隆**（`cloneNode(true)`）
- 克隆时剥掉子树内所有 `id` 属性，避免重复 id 破坏锚点；`href` 保留
- 三种模式都用克隆，原节点永远不动（only 模式是隐藏原块，不是搬走节点）

### 6.5 runs 路径

免费 MT 引擎（`preservesMarkup: false`）专用：
- 以 void 节点为分隔，把块切成若干文本段（paired 节点内的文字并入所在段，丢失其样式）
- 每段单独翻译，按原顺序拼回，void 节点克隆插回原位
- 已知代价：被公式打断的句子各翻各的；这是可接受的降级
- 缓存键含 `renderPath`，两条路径的译文不互相复用

---

## 7. 三模式渲染

位置：`src/core/renderer/` + `src/styles/modes.css`。

### 7.1 DOM 不变量 [决定]

1. 译文节点是原块的**下一个兄弟**，带 `class="axt-t"`、`data-axt-for="<blockId>"`，标签名与原块相同（`.ltx_p` → `p.axt-t`）
2. 原节点只允许追加 `data-axt-id`、`data-axt-state` 属性，**不改子树**
3. 全局状态只在 `<html>` 上：`data-axt-on`、`data-axt-mode="side|stack|only"`
4. 恢复原文 = 删除所有 `.axt-t`、删除所有 `data-axt-*` 属性、移除注入的 `<style>`；恢复后 DOM 必须与翻译前逐节点相等（测试守护）

### 7.2 side（左右对照）

- 核心技巧：`.ltx_para { display: grid; grid-template-columns: 1fr 1fr; column-gap: 1.5em }`。原文 `.ltx_p` 与译文 `p.axt-t` 是相邻兄弟，自动成对落在同一行；不需要 wrapper，`.ltx_para` 上的锚点 id 不受影响
- `.ltx_para` 内非成对的子元素（行间公式、图表等）设 `grid-column: 1 / -1` 通栏
- 标题、图表说明：降级为上下堆叠（它们的父级是整个 section，做不了 grid）
- 表格：整表克隆置于下方（见 5.3）
- **宽度** [决定]：进入 side 时覆盖 arXiv 主容器的 `max-width: min(1600px, 96vw)`（具体类名 Phase 0 确认，预期为 `.ltx_page_main` / `.ltx_page_content` 一层），隐藏 `.ltx_page_navbar`
- 用 `matchMedia('(max-width: 1100px)')` 监听：变窄自动切到 stack，变宽切回 side；用户手动选的模式记为偏好，自动降级不覆盖偏好

### 7.3 stack（上下对照）

默认布局，译文紧跟原块。不需要额外 CSS，只有译文样式。

### 7.4 only（仅译文）

- 原块 `display: none`（不是删除、不是替换文本节点）
- 参考文献条目豁免（保持双语）
- 未翻译成功的块保持原文可见

### 7.5 译文样式

- 参考 KISS 的做法：一组 CSS 预设（下划线、虚线、淡色、引用块、无样式），通过 `--axt-*` 变量实现，用户可自定义 CSS
- 译文继承原块字体大小和行高，不引入新字体

---

## 8. Provider 接口

位置：`src/providers/`。每个引擎一个文件，禁止跨文件共享未公开接口的细节。

```ts
export interface TranslationProvider {
  id: string                        // 'openai-compat' | 'anthropic' | 'gemini' | 'chrome-builtin' | 'google-gtx'
  displayName: string
  kind: 'llm' | 'mt' | 'builtin'
  preservesMarkup: boolean          // true → markup 路径；false → runs 路径
  maxBatchChars: number             // 单次请求字符上限
  concurrency: number               // 并发上限（交给 p-queue）
  isAvailable(): Promise<boolean>   // 健康检查：key 是否配置、端点是否可达、内置模型是否可用
  translate(req: TranslateRequest): Promise<TranslateResult>
}

export interface TranslateRequest {
  segments: { id: string; text: string }[]
  source: 'en'                      // v1 固定
  target: string                    // BCP-47，如 'zh-CN' | 'ja'
  context?: {
    paperTitle?: string
    sectionTitle?: string
    glossary?: { term: string; translation: string }[]
  }
}

export interface TranslateResult {
  segments: { id: string; text: string }[]
  provider: string
  model?: string
}
```

### 8.1 v1 providers [决定]

| id | 实现 | preservesMarkup |
|---|---|---|
| `openai-compat` | Vercel AI SDK `createOpenAI({ baseURL })`，覆盖 DeepSeek、Ollama、OpenRouter 等 | true |
| `anthropic` | AI SDK `@ai-sdk/anthropic` | true |
| `gemini` | AI SDK `@ai-sdk/google` | true |
| `chrome-builtin` | `Translator` API（Chrome 138+ 桌面），类型来自 `@types/dom-chromium-ai` | false |
| `google-gtx` | `translate.googleapis.com/translate_a/single?client=gtx`，必须从 background 发请求 | false [待验证] |

### 8.2 LLM 调用约定

- 用 AI SDK `generateObject` + zod schema `{ segments: { id, text }[] }`，让结构校验由 SDK 完成
- system prompt 固定要素：学术论文翻译；占位符标签必须原样保留、不可增删改；人名/期刊名/会议名保留原文；术语表优先；只返回译文
- prompt 带版本号 `PROMPT_VERSION`，写入缓存键
- 批次按章节切，单批不超过 `maxBatchChars`；附带 `sectionTitle` 作上下文
- 批次失败：对半拆分重试 → 单块 → 标记失败

### 8.3 免费引擎约定

- 视为**随时会断**的东西：独立文件、独立错误类型、失败自动切到 fallback 链的下一个
- fallback 链默认：用户选定 provider → `chrome-builtin` → `google-gtx`
- `google-gtx` 单块一请求，并发 4，指数退避处理 429
- Phase 0 顺带核实 Google 的 `translateHtml` 接口是否可用且保留标签；若可用，可新增一个 `preservesMarkup: true` 的免费 provider，runs 路径退为纯兜底

---

## 9. 缓存与配置

- 译文缓存：IndexedDB，`idb-keyval`（v1 足够；需要查询/导出时再升 Dexie）
- 缓存键：`sha256(providerId | model | PROMPT_VERSION | RULES_VERSION | target | renderPath | normalizedText)`
- 值：`{ text: string; ts: number; paper: string }`，`paper` 用 arXiv id，便于按论文清理和导出
- 配置：WXT storage，带 schema 版本与迁移函数；API key 只存本地，永不出现在缓存键或日志里

---

## 10. 调度

- `IntersectionObserver` 给视口内及其前后各一屏的块最高优先级
- 其余块按文档顺序在后台排队，一篇论文最终全部翻完
- 每个 provider 一个 `p-queue` 实例，并发上限来自 provider 声明
- popup 显示进度（已翻 / 总数 / 失败数），失败块可单击重试

---

## 11. 测试策略

| 层 | 工具 | 覆盖 |
|---|---|---|
| 规则 | Vitest + happy-dom | 每个 fixture：提取的块数量与 id 列表快照；跳过规则不误伤 |
| 占位符 | Vitest | 序列化 → 假译文 → 回填，往返后受保护节点等价；校验器对各类破坏（丢 id、多 id、嵌套错）都能识别 |
| 渲染 | Vitest + happy-dom | 翻译 → 切换三模式 → 恢复，恢复后 DOM 与原始逐节点相等 |
| provider | Vitest（mock fetch）| 请求拼装与响应解析；免费接口另有可选的 live 测试，默认跳过 |
| 端到端 | 手动清单 | 真实 arXiv 页面：锚点跳转、脚注弹出、公式渲染、Ctrl+F、打印 |

fixtures 存在 `tests/fixtures/arxiv/<arxiv-id>.html`，Phase 0 抓取。

---

## 12. 阶段计划

**Phase 0 — 研究（产出为文件，约 1 天）**
- [ ] 抓 8–10 篇不同年份/领域的 arXiv HTML 存为 fixture，跑 `ltx_*` 类名直方图，校订第 5 节的选择器，结果写入 `docs/RESEARCH.md`
- [ ] clone 三个参考仓库到 `reference/`（gitignore），为每个模块写一行"参考哪个文件"，写入 `docs/RESEARCH.md`
- [ ] curl 验证 `google-gtx`、微软 `translatetext`、Google `translateHtml` 今天是否可用、是否保留标签
- [ ] 验证 content script 内能否直接调 `Translator` API，模型下载是否需要用户手势
- [ ] 确认 arXiv 主容器与导航栏的选择器，以及 arXiv 自身 JS 是否会与我们冲突

**Phase 1 — 骨架 + 规则（测试先行）**
- WXT + React 脚手架；`extractor` + `rules` + fixture 测试

**Phase 2 — 核心闭环**
- `protector` + `validator` + `rehydrator`；`openai-compat` provider；stack 模式渲染；恢复；缓存

**Phase 3 — 完整 v1**
- side / only 模式与宽度逻辑；`chrome-builtin` + `google-gtx` 与 runs 路径；fallback 链；调度与进度；样式预设；术语表；options 页

**Phase 4 — 打磨**
- 更多 fixture 与规则修正；性能；导出/导入缓存；发布

---

## 13. 参考项目与借鉴边界

| 项目 | 借鉴什么 | 不借鉴什么 |
|---|---|---|
| KISS Translator | 译文样式预设与自定义 CSS；富文本翻译的占位符思路；免费引擎适配器的请求拼装方式 | 站点规则订阅系统；油猴脚本双构建（v1 不需要）|
| Read Frog | WXT 工程配置；AI SDK provider 抽象；Shadow DOM UI 隔离；批处理与重试流程；仅译文模式的标记处理 | 语言学习、字幕、TTS、生词本 |
| FluentRead | 渐进式翻译与缓存策略；悬浮球交互 | Vue 技术栈 |

**边界 [决定]**：核心模块（`rules`、`protector`、`renderer`、`scheduler`）必须原创，只借鉴设计思路。外壳（工程配置、provider 拼装、UI 组件）可以参考实现，但逐字复制不超过零散几行，且注明来源。

**许可证 [决定]**：项目以 GPL-3.0 开源，非商业。上述边界的目的不是规避 GPL，而是让核心代码天然干净，将来若需调整许可证只需替换外壳。

---

## 14. 已知风险

| 风险 | 应对 |
|---|---|
| LaTeXML 版本差异导致规则失效 | fixture 覆盖多年份；规则版本化；探测函数分叉 |
| 免费接口被上游关闭 | provider 可插拔 + fallback 链 + 内置 Translator 作为无网络依赖的底 |
| LLM 破坏占位符 | 三级降级：重试 → runs → 标记失败 |
| 克隆节点导致重复 id | 克隆时剥离 `id` |
| side 模式在窄屏不可读 | matchMedia 自动降级 |
| arXiv 自身 JS（脚注、导航）与注入节点冲突 | Phase 0 实测；只插兄弟节点、不动原节点的策略本身就把冲突面压到最小 |

---

## 15. 图片翻译 [延后]

v1 不实现，但架构与协议在此定下，将来加功能不改扩展主体。

### 15.1 判断

- Safari 的图片翻译 = Live Text（Vision 框架 OCR）+ Translation 框架，第三方都能调用
- **helper 只做 OCR，翻译和叠加层留在扩展里**。理由：Apple Translation 框架在 macOS 15 上只能通过 SwiftUI `.translationTask` 拿到 session，macOS 26 才有无 UI 的 `TranslationSession(installedSource:target:)`，且要求语言包已安装；而扩展已有完整翻译管线，LLM 还能拿图注做上下文。helper 越薄，平台相关的面越小
- 非 Mac 平台退化为多模态 LLM 直接读图给文字与坐标（坐标精度较低，可接受）
- 少数 arXiv 图是 SVG，文字本来就在 DOM 里，按普通块翻译，不走 OCR；规则审计时统计占比

### 15.2 架构

```
content script                                axt-helper (Swift, 独立仓库)
  fetch <img> → blob → base64                    Vision VNRecognizeTextRequest
        │                                              │
        ├──(chrome.runtime.connectNative)──► stdio JSON ┤
        │                                              │
        ◄── {lines:[{text, bbox, conf}]} ──────────────┘
        │
        ├─► 文字走现有 provider（context 带图注与所属章节）
        └─► renderer 在 <img> 上叠 `.axt-img-overlay` 绝对定位标签层，hover 显示原文
```

- 图片翻译结果同样进缓存，键里加 `imageHash`
- 叠加层遵守 §7.1 不变量：只在 `<img>` 外包一层定位容器或使用兄弟节点，不改 `<img>` 本身；恢复时整层移除

### 15.3 消息协议（Native Messaging）

请求（扩展 → helper）：
```json
{ "v": 1, "cmd": "ocr", "id": "req-1", "image": "<base64 png/jpeg>", "langs": ["en"] }
```
响应（helper → 扩展）：
```json
{ "v": 1, "id": "req-1", "width": 1200, "height": 800,
  "lines": [ { "text": "Accuracy (%)", "bbox": [0.12, 0.05, 0.20, 0.03], "conf": 0.98 } ] }
```
- `bbox` 为归一化 `[x, y, w, h]`，原点左上
- 另有 `{ "cmd": "ping" }` → `{ "ok": true, "version": "..." }` 用于能力检测
- 大小限制：helper → 扩展每条不超过 1 MB（文字框远小于此）；扩展 → helper 可以很大（图片方向正好合适）
- 错误：`{ "v":1, "id":"...", "error": { "code": "...", "message": "..." } }`

### 15.4 helper

- Swift，~100–200 行：读 stdin 长度前缀 JSON、解码图片、跑 Vision、写 stdout
- 需要签名与公证；安装时注册 host manifest 到 `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/<name>.json`，`allowed_origins` 绑定扩展 id
- 分发用 pkg 或 Homebrew；扩展启动时 `ping` 检测，检测不到则不显示图片翻译入口
- 后话：helper 存在后可顺手加 `apple-translate` provider（`preservesMarkup: false`，Mac 专属、离线），macOS 15 上需用透明窗口承载 SwiftUI 的变通方案（参考 SystemTranslation 库），macOS 26 可直接初始化

### 15.5 参考

- Native Messaging 范本：KeePassXC-Browser + keepassxc-proxy
- Vision OCR 现成代码：macOCR、TRex、ocrmac
- 叠加层无现成库，逻辑简单：按 bbox 放半透明标签，字号按框高自适应
