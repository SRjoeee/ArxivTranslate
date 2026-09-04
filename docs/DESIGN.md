# arXiv HTML Translator — 设计文档

版本：v0.5 · 2026-09-03 · 状态：Phase 2 完成（核心闭环五分支合入，真实页面验证通过；v0.4 为 Phase 2 设计细化，v0.3 改参考代码边界，v0.2 为 Phase 0 实测后修订，v0.1 为 Phase 0 前的基线）

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
3. **两条渲染路径由 provider 的能力位决定，不由引擎类型决定**。markup 路径整块带占位符翻译；runs 路径按行内不可翻译节点切段。Phase 0 实测 LLM、Google gtx、Chrome 内置 Translator 都能保留占位符，因此 v1 的所有 provider 默认走 markup，runs 是占位符校验失败后的兜底（RESEARCH.md §5 / §6）。provider 用 `preservesMarkup` 能力位声明自己走哪条。

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

### 4.1 块模型 [决定]

```ts
interface Block {
  id: string        // data-axt-id 的值：元素自带 id（LaTeXML 的 S3.p1.1 等，跨加载稳定）优先，否则按文档序 axt-b<n>；重复时加后缀
  kind: 'text' | 'table'
  el: Element       // 原节点，永不修改子树
  unit: string      // 命中的规则 id（p / title / caption / note / bibitem / ack / keywords / table）
  cells?: { el: Element; numeric: boolean }[]   // 仅 table：最外层 .ltx_tabular 内的 .ltx_td，numeric 由 §5.3 判定
}
```

- `extract(doc): Block[]` 纯读，不写 DOM；`markBlocks(blocks)` 才写 `data-axt-id`。**页面加载时只 extract**，`#axt-debug` 或开始翻译时才 mark，未翻译前不动页面。popup 的统计来自 content script 内存中的 `Block[]`，不查 DOM。
- **遍历策略与分类解耦**：从翻译根 DFS，按 `classify(el)` 的类别分别决定"是否产出"与"是否下钻"——`skip` 不产出不下钻；`table` 产出表格块、不下钻（表内 `.ltx_p` 属于单元格，不单独成块）；`unit` 在含可翻译文本时产出文本块、**继续下钻**以发现嵌套单元；`protect` 不产出、默认不下钻，但规则带 `descend: true` 的除外——`.ltx_note` 是 protect-but-descend 的第一例：对外层段落它是 void，内部的 `.ltx_note_content` 仍要被发现为独立块（fixture 中 56 个脚注有 51 个在 `.ltx_p` 内、3 个在 `.ltx_caption` 内）。
- 可翻译文本 = 排除 protect / skip 子树后的文本含 Unicode 字母（`/\p{L}/u`）；只含公式、编号或标点的 `.ltx_p` 不成块。表格同理：没有任何"非数值格且含字母"单元格的表（段落里的空排版 tabular、纯公式表）不成块。

---

## 5. 块模型与规则

以下选择器已用 10 篇 fixture 校订（RESEARCH.md §2，正文文本节点覆盖率 99.97%）。当前 arXiv 线上全部页面由 LaTeXML oxide 0.7.6 生成。规则集中在 `src/core/rules/latexml.ts`。

**翻译根 [决定]**：`article.ltx_document`。根之外的一切——`.ltx_page_navbar`（目录）、arXiv 注入的页头页脚、"报告问题"弹窗、公告条——一律不提取，不需要逐个列选择器（RESEARCH.md §3.1）。

### 5.1 翻译单元

| 选择器 | 说明 |
|---|---|
| `.ltx_p` | 正文段落。`.ltx_para` 是带锚点 id 的容器，`.ltx_p` 才是文本块。摘要、列表项、定理与证明内的段落都由本条覆盖，不单列规则（Phase 0 实测那些规则被完全包含，单列会违反"每个文本节点恰好一条规则"）；"摘要 / 定理"之类的上下文只作为提示信息传给 provider。注意 `.ltx_p` 可能是 `<span>`（表格、inline-block 内），提取与渲染按类名不按标签名 |
| `.ltx_title`, `.ltx_subtitle` | 各级标题与副标题。内含 `.ltx_tag`（章节号）需作 void 占位符；定理的 run-in 标题（"Theorem 1."）也在此列 |
| `.ltx_caption` | 图表说明。内含 `.ltx_tag`（"Table 1: "，其中嵌套 `.ltx_text`）需作 void 占位符 |
| `.ltx_note_content` | 脚注正文，作为独立块。脚注是**嵌套块**：整个 `.ltx_note`（标记 + `.ltx_note_outer > .ltx_note_content`）位于段落内部，外层段落把 `.ltx_note` 视为 void 占位符；`.ltx_note_content` 内部的第二个 `.ltx_note_mark` 与 `.ltx_note_type` 作 void |
| （表格） | 不走本表：整张最外层 `.ltx_tabular` 由 §5.3 的 TABLE 规则作为一个单元处理，单元格 `.ltx_td` 是表格块内的段，不是独立块 |
| `.ltx_bibitem` | 参考文献条目，内含 `.ltx_tag`（可嵌套 `sup` / `span`）作 void，见 5.4 |
| `.ltx_acknowledgements` | 致谢 |
| `.ltx_keywords` | 关键词 |

### 5.2 跳过规则（整块不翻）

| 选择器 | 说明 |
|---|---|
| `math`, `.ltx_Math` | MathML 公式（行内的作占位符，块级的整体跳过）|
| `.ltx_equation`, `.ltx_equationgroup` | 行间公式 |
| `.ltx_tag` | 公式编号、章节号、图表号、列表符号、代码行号 |
| `.ltx_listing`, `.ltx_listingline`, `.ltx_listing_data`, `.ltx_verbatim`, `pre`, `code` | 代码、verbatim、隐藏的代码数据。算法框 `figure.ltx_float.ltx_algorithm` / `.ltx_float_algorithm` 内部即 `.ltx_listingline`，由本条覆盖，框内 `.ltx_caption` 正常翻译 |
| `.ltx_text.ltx_font_typewriter` | 等宽文本（视为代码）|
| `.ltx_authors`, `.ltx_creator`, `.ltx_personname`, `.ltx_author_notes`, `.ltx_role_affiliation`, `.ltx_contact`, `.ltx_dates` | 作者、机构、联系方式、日期（真实页面没有 `.ltx_author` / `.ltx_date`）|
| `.ltx_pubnotes` | 出版元数据（ACM 模板的 CCS / DOI / 期刊 / 卷期）|
| `svg`, `.ltx_picture` | TikZ 图，实测没有可翻译文字，见 §15.1 |
| `.ltx_ERROR` | LaTeXML 转换错误块（也会出现在转换失败页 "Untitled Document" 上，扩展须安静处理）|
| `.ltx_page_navbar`, `.ltx_TOC` | 导航栏与目录。位于翻译根之外，列出仅供渲染层隐藏用 |

### 5.3 表格 [决定]

整张**最外层** `.ltx_tabular` 作为一个单元处理（fixture 中 58 个 tabular 有 15 个不在 `.ltx_table` 内，所以根不能用 `.ltx_table`；3 个嵌套在另一个 tabular 内，内层归外层单元格；`th` 全部带 `ltx_td`，单元格选择器 `.ltx_td` 即可；239 个 `.ltx_td` 属于公式对齐表，已由 `.ltx_equation` 跳过）：
- side / stack 模式：在原表**下方**插入一份译文克隆表，克隆内逐格翻译，数值格原样复制
- only 模式：隐藏原表，显示克隆表
- 不在单元格内做左右对照
- 数值格判定（Phase 0 用 5,487 个真实单元格校准，RESEARCH.md §2.6）：**排除 protect / skip 子树后的可见文本**（不能直接用 `textContent`，MathML 的 `annotation` 会混入 TeX 源码；单元格内的 `.ltx_p` 文本计入）满足以下任一即原样复制：
  - `^(?=.*\d)[\s\d.,+\-±×^%()/*eE−–—:;~<>=≤≥∼]+(\s*[a-zA-Zμ°%]{1,4})?$`——必须含数字，避免 `ERROR` 这类以 E 开头的词被当成指数误判
  - `^[✓✗✔✘–—−\-·×*]+$`——纯符号格
  - `^N/A$`
  - 空格与纯公式格直接复制；大写枚举值（`TRUE` / `FALSE` / `UNKNOWN`）交给 provider，不做特判

### 5.4 参考文献 [决定]

- 默认翻译，可在设置里关闭
- **only 模式下豁免隐藏**，参考文献始终双语（原文被隐藏后对照的前提就没了）
- DOI / URL 本身是 `<a>`，走占位符自动保留
- LLM prompt 固定加一条：人名、期刊名、会议名保留原文

### 5.5 规则版本化

- 规则文件导出 `RULES_VERSION`，写入缓存键
- fixtures 覆盖多个领域与结构（`tests/fixtures/arxiv/README.md`），每篇记录生成器版本；任何规则改动必须通过全部 fixture 测试
- arXiv 已用 LaTeXML oxide 0.7.6 重新生成全部历史文章，线上（含带版本号的 URL）不存在旧版本输出，**年份不是版本代理**；生成器版本变化时重抓 fixture（RESEARCH.md §1）
- 若不同 LaTeXML 版本差异大到需要分叉，按 `rules/latexml-v1.ts`、`rules/latexml-v2.ts` + 探测函数处理，不要在一个文件里堆 if

### 5.6 规则接口与优先级 [决定]

`src/core/rules/latexml.ts` 只导出数据表与纯函数，不含遍历（遍历在 extractor，见 §4.1）：

- 表：`UNIT_RULES`（§5.1）、`TABLE_RULES = { root: '.ltx_tabular', cell: '.ltx_td' }`（§5.3，根取最外层）、`SKIP_RULES`（§5.2 中块级整体不翻的部分）、`PROTECT_RULES`（§6.1 的 void 节点，每条可带 `descend` 标志）。`math` 只出现在 PROTECT——行间公式已由 `.ltx_equation` 整块跳过。paired 节点规则（§6.1）由 Phase 2 的 protector 加入本文件
- 函数：`documentRoot(doc)`、`classify(el) → { kind: 'skip' | 'table' | 'unit' | 'protect'; rule: string } | null`、`isNumericCell(visibleText)`
- **优先级**：同一元素命中多类时取 `skip > table > unit > protect`。`skip` 命中出现在翻译单元内部时（如段落里的 `.ltx_ERROR`，fixture 中有 1 例），对该单元等价于 void
- `RULES_VERSION` 随任何表或函数的行为变化递增，进缓存键

---

## 6. 占位符引擎

位置：`src/core/protector/`。这是项目最难、最值钱的模块，必须原创，读 Read Frog 与 KISS 的实现后再动手。

### 6.1 节点分类

| 类型 | 占位符 | 节点 |
|---|---|---|
| void | `<x id="n"/>` | 行内 `math`、`.ltx_ref`（含内部 `.ltx_ref_tag`）、`.ltx_cite`、`.ltx_tag`、`code`、`.ltx_font_typewriter`、整个 `.ltx_note`（脚注正文另行成块）、`.ltx_note_mark`、`.ltx_note_type`、行内图片、`svg`、`br`。**必须以 `PROTECT_RULES` 写进 `latexml.ts`**——Phase 0 审计发现仅靠 §5.2 的跳过规则时，`.ltx_ref` / `.ltx_cite` / `.ltx_note_mark` 会被当作段落正文（fixture 中合计 3,500+ 个元素，RESEARCH.md §2.5）|
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

`preservesMarkup: false` 的引擎专用，同时也是 markup 路径校验失败后的兜底。v1 的三个免费引擎实测都保留占位符（RESEARCH.md §5 / §6），runs 在 v1 主要以兜底身份存在，但实现不能省：
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

- 核心技巧：`.ltx_para { display: grid; grid-template-columns: 1fr 1fr; column-gap: 1.5em }`。原文 `.ltx_p` 与译文 `p.axt-t` 是相邻兄弟，自动成对落在同一行；不需要 wrapper，`.ltx_para` 上的锚点 id 不受影响。**只对 `.ltx_para > p.ltx_p` 生效**；`span.ltx_p`、表格与 inline-block 内的 `.ltx_p` 降级为 stack（ar5iv 样式已把 `.ltx_para` 设为 `display:block`，无冲突）
- `.ltx_para` 内非成对的子元素（行间公式、图表等）设 `grid-column: 1 / -1` 通栏
- 标题、图表说明：降级为上下堆叠（它们的父级是整个 section，做不了 grid）
- 表格：整表克隆置于下方（见 5.3）
- **宽度** [决定]：进入 side 时在 `html[data-axt-mode="side"]` 上覆盖 CSS 变量 `--main-width: min(1600px, 96vw)`。arXiv 页面的文章列宽（≥1280px 时 body 是 `grid-template-columns: 1fr var(--nav-width) var(--main-width) var(--nav-width) 1fr` 的网格）与 `.ltx_document` 的 `max-width` 都只由这个变量决定，`.ltx_page_main` 本身是 `width:100%`（RESEARCH.md §3.2）。同时隐藏 `.ltx_page_navbar`（用我们自己的属性选择器，不要写 arXiv 的 `data-reading-mode`，那会被它持久化）。注意 `--main-width` 还控制图片、代码块、单元格的 max-width 与 ≥96rem 时脚注边注的定位，需要时把这些钉回 `52rem`
- 用 `matchMedia('(max-width: 1279px)')` 监听（与 arXiv 主题折叠导航栏的 1280px 断点对齐）：变窄自动切到 stack，变宽切回 side；用户手动选的模式记为偏好，自动降级不覆盖偏好

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
| `openai-compat` | Vercel AI SDK `@ai-sdk/openai-compatible` 的 `createOpenAICompatible({ baseURL })`，覆盖 OpenRouter（默认端点）、DeepSeek、Ollama 等；默认模型取便宜快速档，设置页可改 | true |
| `anthropic` | AI SDK `@ai-sdk/anthropic` | true |
| `gemini` | AI SDK `@ai-sdk/google` | true |
| `chrome-builtin` | `Translator` API（Chrome 138+ 桌面），类型来自 `@types/dom-chromium-ai`，约定见 §8.4 | true（实测保留标签与 void / paired 占位符）|
| `google-gtx` | `translate.googleapis.com/translate_a/single?client=gtx`，必须从 background 发请求；返回 `{sentences:[{trans,orig}]}`，多句需拼接 | true（实测保留占位符）|

`preservesMarkup: true` 的免费引擎仍走 §6.3 的校验，失败后降级 runs；runs 路径退为纯兜底。Google `translateHtml`（`translate-pa.googleapis.com/v1/translateHtml`）可用但译文质量与占位符位置差于 gtx，不作为 provider；微软 edge 通道 auth 端点已 404，不接（RESEARCH.md §5）。

### 8.2 LLM 调用约定

- 用 AI SDK 7 的 `generateText` + `Output.object({ schema })`（`generateObject` 已被取代）+ zod schema `{ segments: { id, text }[] }`，让结构校验由 SDK 完成；SDK 自身 `maxRetries: 0`，重试交给移植的 retry policy
- system prompt 固定要素：学术论文翻译；占位符标签必须原样保留、不可增删改；人名/期刊名/会议名保留原文；术语表优先；只返回译文
- prompt 带版本号 `PROMPT_VERSION`，写入缓存键
- 批次按章节切（标题块开启新批次），单批不超过 `maxBatchChars`（默认照 Read Frog：1000 字 / 4 段，provider 并发 8——小批高并发，首屏快）；附带 `sectionTitle` 作上下文；公式密集块单独成批；表格块整表一批（`renderTable` 需要所有单元格一起到）
- 批次失败：对半拆分重试 → 单块 → 标记失败

### 8.3 免费引擎约定

- 视为**随时会断**的东西：独立文件、独立错误类型、失败自动切到 fallback 链的下一个
- fallback 链默认：用户选定 provider → `chrome-builtin` → `google-gtx`
- `google-gtx` 单块一请求，并发 4，指数退避处理 429
- **思考模式默认关闭**（照 KISS 的 THINKING_API_REGISTRY）：按端点域名选字段——OpenRouter `reasoning: { effort: "none" }`、DeepSeek 官方 `thinking: { type: "disabled" }`、百炼 / 硅基流动 `enable_thinking: false`，未登记端点不发；经 AI SDK `providerOptions` 进请求体（`src/providers/thinking.ts`）
- **即时引擎**：`chrome-builtin` 模型就绪时（`availability() === 'available'`）单句 10–20 ms 且离线，用它先渲染视口内的块，用户选定的 LLM 译文到达后原位替换；缓存键含 provider，两者互不覆盖。用户可在设置里关闭

### 8.4 `chrome-builtin` 约定（Phase 0 实测，Chrome 152，RESEARCH.md §6）

- `isAvailable()` 以 `Translator.availability({ sourceLanguage, targetLanguage })` 为准：`available` 直接可用；`downloadable` / `downloading` 需要**用户手势**——只能在 popup 的点击处理函数里调用 `create()` 触发语言包下载，否则抛 `NotAllowedError`；模型就绪后 `create()` 不再需要手势（1 ms）
- 首次下载期间 `availability()` 不会变成 `downloading`，`monitor` 也没有 `downloadprogress` 事件（实测 67 s 内一直是 `downloadable`），UI 用不确定态"正在下载语言包"提示；下载完成后再次 `create()` 才会有 0→1 的进度事件（约 8 s 的本地加载）
- 语言包按语言对独立下载（en→zh 与 en→ja 各一份）
- 译文需归一化句号后的多余空格（「。 」→「。」）
- content script 隔离世界是否同样暴露 `Translator` 待 Phase 1 用真实 content script 验证 [待验证]

---

## 9. 缓存与配置

- 译文缓存：IndexedDB，**Dexie**，移植 FluentRead `services/translation/cache.ts`（键规范化、TTL、容量上限、内存热层），crypto-js 换成 Web Crypto SHA-256（v0.4 修订，原定 idb-keyval）
- 缓存键：`sha256(providerId | model | PROMPT_VERSION | RULES_VERSION | target | renderPath | normalizedText)`；`normalizedText` = NFC 归一化 + 连续空白折成一个空格 + 首尾 trim，占位符文本参与哈希
- 值：`{ text: string; ts: number; paper: string }`，`paper` 用 arXiv id，便于按论文清理和导出。TTL 30 天、上限 20,000 条 / 50 MB、单条 256 KB、内存热层 256 条；缓存只在 background 持有（IndexedDB 按 origin 隔离），查询并进 `axt:translate`：background 先查缓存，只把未命中的段落发给 provider
- **淘汰不扫全库** [决定]：条数与字节数在内存里增量维护（`byteSize` 索引，Dexie schema v2；只用 `orderBy(index).keys()` 读索引键初始化，不反序列化记录），只有真的超过上限才按 `lastAccessedAt` 批量取最旧的条目删除。原版 FluentRead 每次 `set` 都把整库记录读出来求和，一篇论文几百次写入、库到几千条后每次写入都要反序列化整库；MV3 的 service worker 是单线程，其他消息会排在后面等几十秒（实测 fake-indexeddb：2000 条时 5.5 ms/set 且随库线性增长，改后稳定在 0.11 ms/set）
- 配置：WXT storage，zod schema 带 `version` 与迁移函数（移植 Read Frog `config/storage.ts` + `migration.ts` 的模式）。v1 形状：`{ version, provider: 'openai-compat' | …, openaiCompat: { baseURL, apiKey, model }, targetLanguage: 'zh-CN', mode: 'stack' | 'side' | 'only' }`。API key 只存本地，永不出现在缓存键、日志或测试 fixture 里

---

## 10. 调度

- `IntersectionObserver` 给视口内及其前后各一屏的块最高优先级（参数照 FluentRead：`rootMargin: '600px 0px'`、`threshold: 0.01`，Read Frog 同为 600px）；批次队列每次取批时优先取含临近视口块的批次。IO 首次回调是异步的，而运行循环一开始就同步取走并发数个批次，所以追踪器创建时先按 `getBoundingClientRect` 同步播种一次临近集合，之后以 IO 为准
- 插入译文时用移植自 FluentRead 的滚动锚定保持视口不跳；锚定按**批**做一次而不是按块（锚定的 `elementFromPoint` / `getBoundingClientRect` 都强制布局，MathML 重的页面按块锚定会把主线程卡住几十秒，实测 2609.00062）
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

fixtures 存在 `tests/fixtures/arxiv/<arxiv-id>.html`（10 篇，Phase 0 抓取，覆盖多领域与多结构，含一篇转换失败页；全部为 oxide 0.7.6）。规则测试用 happy-dom 解析，1.8 MB 页面约 0.6 s，可直接跑全量 fixture。

---

## 12. 阶段计划

**Phase 0 — 研究（已完成，产出见 `docs/RESEARCH.md`）**
- [x] 抓 8–10 篇不同年份/领域的 arXiv HTML 存为 fixture，跑 `ltx_*` 类名直方图，校订第 5 节的选择器，结果写入 `docs/RESEARCH.md`
- [x] clone 三个参考仓库到 `reference/`（gitignore），为每个模块写一行"参考哪个文件"，写入 `docs/RESEARCH.md`
- [x] curl 验证 `google-gtx`、微软 `translatetext`、Google `translateHtml` 今天是否可用、是否保留标签
- [x] 验证 content script 内能否直接调 `Translator` API，模型下载是否需要用户手势
- [x] 确认 arXiv 主容器与导航栏的选择器，以及 arXiv 自身 JS 是否会与我们冲突

**Phase 1 — 骨架 + 规则（测试先行，三个分支依次合入）**
- `feat/scaffold`：WXT + React 脚手架，四个入口只是壳，Vitest + happy-dom 配好
- `feat/rules`：`latexml.ts` 扩成 §5.6 的完整规则模块，谓词单测 + 数值格边界用例；`pnpm fixtures:stats` 改用 PROTECT_RULES
- `feat/extractor`：§4.1 的块模型与遍历，10 篇 fixture 快照 + 不变量测试（id 唯一、不在 skip 内、有可翻译文本、`extract` 不改 DOM）；content script 加载只 extract，`#axt-debug` 时 mark + 虚线描边，popup 显示块统计

**Phase 2 — 核心闭环（已完成 2026-09-03；五个分支依次合入，边界见 §13；完成标准四项在真实页面实测通过；速度按 KISS / Read Frog 的做法修正——思考模式按端点关闭、1000 字 / 4 段 / 并发 8）**
- `feat/protector`：占位符引擎——`serialize` / `validate` / `rehydrate` / runs 切段；嵌套单元对外层作 void；移植 Read Frog `html-attribute-markers.ts` 的完整性校验改成 `<x id>` / `<t id>` 协议
- `feat/providers`：`TranslationProvider` 接口；`openai-compat`（`@ai-sdk/openai-compatible` + `generateObject`，默认 OpenRouter 端点与便宜快速档模型）；prompt 与 `PROMPT_VERSION`；配置 schema + 迁移；options 页字段。移植 Read Frog `providers/model.ts`（精简到三家）、`retry-policy.ts`、`config/storage.ts` + `migration.ts`；并发 `p-queue`，重试 `p-retry` 配移植的策略
- `feat/cache`：移植 FluentRead `cache.ts`（Dexie），键见 §9
- `feat/renderer`：stack 模式、恢复原文、表格整表克隆置于下方；原创，DOM 逐节点相等测试守护
- `feat/pipeline`：content 提取 → 查缓存 → protector → background 队列 → provider → validate → rehydrate → render → 写缓存；降级链（重试一次 → runs → 标记失败）；popup 翻译 / 恢复 / 进度。Phase 2 按文档序整篇翻，视口优先留 Phase 3
- 完成标准：真实 arXiv 页面 popup 点"翻译"后段落下方出现译文；刷新再点秒出（缓存）；"恢复原文"后 DOM 与翻译前逐节点相等；失败块在 popup 可见

**Phase 3 — 完整 v1**
- side / only 模式与宽度逻辑；`chrome-builtin` + `google-gtx` 与 runs 路径；fallback 链；调度与进度；样式预设；术语表；options 页

**Phase 4 — 打磨**
- 更多 fixture 与规则修正；性能；导出/导入缓存；发布

**v2 — 其他论文站点**
- extractor 站点适配器接口；移植 Read Frog 的通用启发式 walker 作为第二个适配器；按站点补 fixture 与规则

---

## 13. 参考项目与借鉴边界

| 项目 | 借鉴什么 | 不借鉴什么 |
|---|---|---|
| KISS Translator | 译文样式预设与自定义 CSS；富文本翻译的占位符思路；免费引擎适配器的请求拼装方式 | 站点规则订阅系统；油猴脚本双构建（v1 不需要）|
| Read Frog | WXT 工程配置；AI SDK provider 抽象；Shadow DOM UI 隔离；批处理与重试流程；仅译文模式的标记处理 | 语言学习、字幕、TTS、生词本 |
| FluentRead | 渐进式翻译与缓存策略；悬浮球交互 | Vue 技术栈 |

**边界 [决定，v0.3 修订]**：默认优先移植三个参考项目的成熟实现——它们已迭代多年，能整段拿来用的就拿来用，移植后按本项目命名与目录改造。原创的例外只有三种：(1) arXiv 适配（`rules/latexml.ts`、`extractor` 的 LaTeXML 路径，Phase 1 已完成）；(2) `renderer`——三个项目的译文渲染都改动、包裹或替换原节点（Read Frog 把译文追加进原元素、仅译文模式直接改文本节点；FluentRead 用 host 包裹原节点；KISS `replaceWith` 替换），与 §7.1 的 DOM 不变量冲突；(3) 移植会与不变量冲突或让代码变乱时改写并说明理由。各模块的移植来源见 RESEARCH.md §4。

**许可证 [决定]**：项目以 GPL-3.0 开源，非商业，与三个参考项目同许可证，可直接移植。GPL §5 要求保留声明并标明修改：移植文件的文件头写 `// 移植自 reference/<repo>/<path>@<commit>（GPL-3.0），有修改`，并在 `docs/THIRD_PARTY.md` 登记。

**面向其他论文站点 [v2]**：extractor 以"站点适配器"接口组织，LaTeXML 适配器是第一个；通用启发式 walker（移植 Read Frog `dom/filter.ts`、`dom/traversal.ts`）作为第二个适配器在 v2 接入其他站点。v1 范围（§1）不变。

---

## 14. 已知风险

| 风险 | 应对 |
|---|---|
| LaTeXML 版本升级导致规则失效（当前线上统一为 oxide 0.7.6，历史文章已重转） | fixture 记录生成器版本，版本变化时重抓；规则版本化；探测函数分叉 |
| 免费接口被上游关闭 | provider 可插拔 + fallback 链 + 内置 Translator 作为无网络依赖的底 |
| LLM 破坏占位符 | 三级降级：重试 → runs → 标记失败 |
| 克隆节点导致重复 id | 克隆时剥离 `id` |
| side 模式在窄屏不可读 | matchMedia 自动降级 |
| arXiv 自身 JS 与注入节点冲突 | Phase 0 实测无冲突面：arXiv 脚本只碰 `<html>` 属性、目录开关与"报告问题"的选区捕获，无 MutationObserver / MathJax，脚注弹出纯 CSS（RESEARCH.md §3.3）。风险低 |

---

## 15. 图片翻译 [延后]

v1 不实现，但架构与协议在此定下，将来加功能不改扩展主体。

### 15.1 判断

- Safari 的图片翻译 = Live Text（Vision 框架 OCR）+ Translation 框架，第三方都能调用
- **helper 只做 OCR，翻译和叠加层留在扩展里**。理由：Apple Translation 框架在 macOS 15 上只能通过 SwiftUI `.translationTask` 拿到 session，macOS 26 才有无 UI 的 `TranslationSession(installedSource:target:)`，且要求语言包已安装；而扩展已有完整翻译管线，LLM 还能拿图注做上下文。helper 越薄，平台相关的面越小
- 非 Mac 平台退化为多模态 LLM 直接读图给文字与坐标（坐标精度较低，可接受）
- arXiv 的 SVG 图全是 TikZ 输出的 `svg.ltx_picture`（10 篇 fixture 共 164 个，多为画出来的公式），实测没有 `<text>`，文字只以 `foreignObject` 出现且极少（全部 fixture 仅 1 个文本节点），v1 整体跳过（§5.2）；OCR 路线只针对位图 `img.ltx_graphics`（fixture 中 13 个，RESEARCH.md §2.9）

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
