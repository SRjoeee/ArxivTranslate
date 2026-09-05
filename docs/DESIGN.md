# arXiv HTML Translator — 设计文档

版本：v0.6 · 2026-09-04 · 状态：Phase 3 进行中（v0.6 把 provider 请求移到 content 并换用 translateHtml，见 §8.0 / §8.1；v0.5 为 Phase 2 完成，v0.4 为 Phase 2 设计细化，v0.3 改参考代码边界，v0.2 为 Phase 0 实测后修订，v0.1 为 Phase 0 前的基线）

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
3. **两条渲染路径由 provider 的能力位决定，不由引擎类型决定**。markup 路径整块带占位符翻译；runs 路径按行内不可翻译节点切段。Phase 0 / Phase 3 实测 LLM、Google translateHtml、Chrome 内置 Translator 都能保留占位符，因此 v1 的所有 provider 默认走 markup，runs 是占位符校验失败后的兜底（RESEARCH.md §5 / §6）。provider 用 `preservesMarkup` 能力位声明自己走哪条。

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
│  request-queue + batch-queue (per-provider rate) ──► providers/* ──► cache (IndexedDB) │
│  health check + fallback chain                                                         │
└────────────────────────────────────────────────────────────────────────────────────────┘
┌────────────────────────── ui ─────────────────────────────────────────────────────────┐
│  popup: 翻译/恢复、模式切换、引擎选择、进度       options: providers、样式、术语表、缓存管理  │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

**数据流（单个块）**
1. `extractor` 按规则收集所有 Block，打上稳定 id（`data-axt-id`）
2. `scheduler` 只翻进入视口（加预翻译距离）的块；没滚到的块不发请求、不占资源（§10，照搬 Read Frog）
3. 先查缓存；命中直接渲染
4. 未命中：`protector` 把块序列化为 `{text, slots}`；按 provider 的 `preservesMarkup` 决定走 markup 路径（整块带占位符）还是 runs 路径（切段）
5. content 侧移植的 `request-queue` 按 provider 的速率（令牌桶）发请求、`batch-queue` 攒批（§8.0：请求不经过 background）；失败退避、重试、429 暂停、必要时切换 fallback provider
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
  cells?: { el: Element; numeric: boolean }[]   // 仅 table：最外层 .ltx_tabular 内任意深度的 .ltx_td（嵌套 tabular 的格也算），numeric 由 §5.3 判定
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
| `.ltx_title`（不含 `.ltx_title_acknowledgements` / `.ltx_title_keywords`）, `.ltx_subtitle` | 各级标题与副标题。内含 `.ltx_tag`（章节号）需作 void 占位符；定理的 run-in 标题（"Theorem 1."）也在此列 |
| `.ltx_caption` | 图表说明。内含 `.ltx_tag`（"Table 1: "，其中嵌套 `.ltx_text`）需作 void 占位符 |
| `.ltx_note_content` | 脚注正文，作为独立块。脚注是**嵌套块**：整个 `.ltx_note`（标记 + `.ltx_note_outer > .ltx_note_content`）位于段落内部，外层段落把 `.ltx_note` 视为 void 占位符；`.ltx_note_content` 内部的第二个 `.ltx_note_mark` 与 `.ltx_note_type` 作 void |
| （表格） | 不走本表：整张最外层 `.ltx_tabular` 由 §5.3 的 TABLE 规则作为一个单元处理，单元格 `.ltx_td`（含嵌套 tabular 的）是表格块内的段，不是独立块；格内的 `.ltx_p` 由 protector 序列化时走进去（§5.3） |
| `.ltx_bibblock` | 参考文献条目内的片段（作者 / 标题 / 出处）；没有分段的条目用 `.ltx_bibitem` 兜底，见 5.4 |
| `.ltx_acknowledgements` | 致谢。正文是容器里的裸文本，容器本身就是单元；它的 run-in 标题**不单独成块**（2026-09-04 修订），否则外层单元会把标题当 void 占位符克隆一份英文，页面上出现两个英文标题加一段中文正文（实测 2609.00095）。不成块时标题是成对占位符，随外层一起翻、原位还原。`.ltx_keywords` 同理 |
| `.ltx_keywords` | 关键词 |
| `.ltx_contact`, `.ltx_role_affiliation`, `.ltx_role_address`, `.ltx_dates`, `.ltx_date` | 作者的机构、联系方式、日期。**2026-09-04 修订**：作者区从"整块跳过"改为"默认翻译"，只排除姓名与邮箱。原策略会漏掉致谢性质的作者注（如《Attention Is All You Need》的 “†Equal contribution. Listing order is random…”，它在 `.ltx_creator > .ltx_note` 里）|
| `.ltx_role_dedicatory`, `.ltx_item`, `.ltx_marginpar`, `.ltx_indexentry`, `.ltx_cv_item_label`, `.ltx_cv_item_content`, `.ltx_cv_entry_date` | 献词、列表项裸文本、边注、索引词条、CV 字段。这些没在抓过的真实论文里出现，由 `tests/fixtures/arxiv/synthetic-structures.html` 守护（RESEARCH.md §2.12）|

### 5.2 跳过规则（整块不翻）

| 选择器 | 说明 |
|---|---|
| `math`, `.ltx_Math` | MathML 公式（行内的作占位符，块级的整体跳过）|
| `.ltx_equation`, `.ltx_equationgroup` | 行间公式 |
| `.ltx_tag` | 公式编号、章节号、图表号、列表符号、代码行号 |
| `.ltx_listing`, `.ltx_listingline`, `.ltx_listing_data`, `.ltx_verbatim`, `pre`, `code` | 代码、verbatim、隐藏的代码数据。算法框 `figure.ltx_float.ltx_algorithm` / `.ltx_float_algorithm` 内部即 `.ltx_listingline`，由本条覆盖，框内 `.ltx_caption` 正常翻译 |
| `.ltx_text.ltx_font_typewriter` | 等宽文本（视为代码）|
| `.ltx_personname` | 作者姓名：音译后引用检索会失效（2026-09-04 修订：作者区不再整块跳过）|
| `.ltx_author_before`, `.ltx_author_after` | 作者之间的连接词（“ and ”“, ”），单独成块会打断姓名列表 |
| `.ltx_classification` | MSC / ACM 分类号，如 “Primary: 11L07” |
| `.ltx_ERROR`, `.ltx_FATAL`, `.ltx_WARNING`, `.ltx_INFO` | LaTeXML 的转换错误与提示，不是论文内容 |
| `.ltx_pubnotes` | 出版元数据（ACM 模板的 CCS / DOI / 期刊 / 卷期）|
| `svg`, `.ltx_picture` | TikZ 图，实测没有可翻译文字，见 §15.1 |
| `.ltx_ERROR` | LaTeXML 转换错误块（也会出现在转换失败页 "Untitled Document" 上，扩展须安静处理）|
| `.ltx_page_navbar`, `.ltx_TOC` | 导航栏与目录。位于翻译根之外，列出仅供渲染层隐藏用 |

### 5.3 表格 [决定]

整张**最外层** `.ltx_tabular` 作为一个单元处理（fixture 中 58 个 tabular 有 15 个不在 `.ltx_table` 内，所以根不能用 `.ltx_table`；3 个嵌套在另一个 tabular 内，内层归外层单元格；`th` 全部带 `ltx_td`，单元格选择器 `.ltx_td` 即可；239 个 `.ltx_td` 属于公式对齐表，已由 `.ltx_equation` 跳过）：
- side / stack 模式：在原表**下方**插入一份译文克隆表，克隆内逐格翻译，数值格原样复制
- only 模式：隐藏原表，显示克隆表
- 不在单元格内做左右对照
- **单元格是块内的段，格里的翻译单元不另成块**（2026-09-05）：extractor 不下钻表格，所以 protector 序列化单元格时要把格内的 `.ltx_p` / 标题当普通 paired 走进去，而不是像段落里的嵌套单元那样作 void——否则整格只剩一个占位符、文字全丢（实测 2410.00260 表 1 的 38 个格；Codex 在 #5 指出）
- **嵌套 tabular**：内层的格也是外层块的格（`tableCells` 取任意深度）；只装着嵌套表的外层格没有自有文本，按数值格原样复制。渲染时逐格替换前重新定位克隆表里的格——外层格的译文里带着内层表的克隆，先替换外层再替换内层
- **部分失败算失败**：表内有一格翻不出来，已翻出的格照常显示、计入失败数，用户能分辨"翻了一半"与"翻完了"（Codex 在 #9 指出）。原表**保持 `translated`**、另加 `data-axt-partial` 画提示线——直接标 `failed` 会让 only 模式把原表与半份克隆一起露出来（Codex 在 #30 指出）
- 数值格判定（Phase 0 用 5,487 个真实单元格校准，RESEARCH.md §2.6）：**排除 protect / skip 子树后的可见文本**（不能直接用 `textContent`，MathML 的 `annotation` 会混入 TeX 源码；单元格内的 `.ltx_p` 文本计入）满足以下任一即原样复制：
  - `^(?=.*\d)[\s\d.,+\-±×^%()/*eE−–—:;~<>=≤≥∼]+(\s*[a-zA-Zμ°%]{1,4})?$`——必须含数字，避免 `ERROR` 这类以 E 开头的词被当成指数误判
  - `^[✓✗✔✘–—−\-·×*]+$`——纯符号格
  - `^N/A$`
  - 空格与纯公式格直接复制；大写枚举值（`TRUE` / `FALSE` / `UNKNOWN`）交给 provider，不做特判

### 5.4 参考文献 [决定]

- 默认翻译，可在设置里关闭
- **按条目内的片段翻**（2026-09-04 修订）：LaTeXML 把一条参考文献拆成若干 `.ltx_bibblock`（作者 / 标题 / 出处各一段，页面上各占一行），翻译单元是 `.ltx_bibblock` 而不是整条 `.ltx_bibitem`，译文因此只跟在对应的那一行下面，不再整条重复
- **多段条目的第一段是作者列表，跳过**：只有部分模板会标 `.ltx_bib_author`（20 篇实测 13 篇有），所以按位置判断（`isBibAuthorBlock`）。只有一段的条目（natbib 等样式）整段就是引文，不跳过
- only 模式不再整条豁免（见 §7.4）：作者段不翻、自然保留，标题与出处段只显示译文
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

位置：`src/core/protector/`。这是项目最难、最值钱的模块，已原创实现（Phase 2；CLAUDE.md 的移植边界把它列为例外），完整性校验的思路参考了 Read Frog `html-attribute-markers.ts`。

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

1. 译文节点是原块的**下一个兄弟**，标签名与原块相同，class 是**原块的 class 加 `axt-t`**（`p.ltx_p` → `p.ltx_p.axt-t`），带 `data-axt-for="<blockId>"`。复制 class 是为了沿用站点样式：主标题居中与字号、参考文献条目的 grid 列、各级标题字号都由 `ltx_*` 类决定，不复制就全丢（2026-09-03 实测：主标题左对齐错位、`li.axt-t` 落进参考文献 12em 宽的第一列还带圆点）。克隆进译文的任何元素（表格整体、占位符回填的 `.ltx_note` 等）都要剥掉 `id` 与全部 `data-axt-*`
2. 原节点只允许追加 `data-axt-id`、`data-axt-state`、`data-axt-inline` 属性，**不改子树**
3. 全局状态只在 `<html>` 上：`data-axt-on`、`data-axt-mode="side|stack|only"`
4. 恢复原文 = 删除所有 `.axt-t`、删除所有 `data-axt-*` 属性、移除注入的 `<style>`；恢复后 DOM 必须与翻译前逐节点相等（测试守护）

### 7.2 side（左右对照）

- 核心技巧 [2026-09-04 重做；2026-09-05 修订]：配对按结构——**带块标记 `data-axt-id` 的块一律占左栏、右栏等译文**，没有块标记但后面紧跟 `.axt-t` 兄弟的（镜像的原件）同样占左栏。块标记在翻译会话一开始就打上（§10），所以开翻那一刻整页一次性变成两栏、之后不再横向跳动；以前只认 `.axt-t` 兄弟，懒加载下预翻译距离之外的块一直通栏、进入边距才缩到左栏，页面随滚动横向跳（用户反馈）。版式由"这一块在翻译会话里"决定，不由"译文到了没"决定。两条列线**只在 `.ltx_document` 上定义一次**，其余容器用 `grid-template-columns: subgrid` 继承同一组列线并自身通栏；容器内默认通栏，有配对的原件占左栏、`.axt-t` 占右栏：

  ```css
  容器 > *              { grid-column: 1 / -1 }
  容器 > :has(+ .axt-t) { grid-column: 1 }
  容器 > .axt-t         { grid-column: 2 }
  ```

  这样标题、图表说明、参考文献片段不必各写一条规则就都能左右对照。不需要 wrapper，锚点 id 不受影响
- **排除项只能是本身不成网格的元素** [决定]：排除一个祖先并不能阻止它的**后代**去 `subgrid` 那个外来网格。ar5iv 的 `.ltx_enumerate` 曾在排除清单里，结果列表项内的 `.ltx_para` subgrid 了它的编号网格（`12px | 780px`），英文横跨分割线、中文挤成 39px 的窄条（实测 2609.00097）。凡是 ar5iv 自己设成网格的元素（`.ltx_enumerate`、`.ltx_item`、`.ltx_biblist`、`.ltx_bibitem`）必须**接管**，接管后同一份 fixture 的连通率从 750/826 升到 820/826
- **多面板插图不接管** [决定，2026-09-04]：ar5iv 用 `.ltx_flex_figure` / `.ltx_flex_cell` 的 flex 让面板并排。它们内部的分图说明是可翻译块，于是整张图满足 `:has(.axt-t)` 被接管成网格，`> *` 又给每个面板 `grid-column: 1 / -1`，面板从并排变成各占一行、撑满整个文章列（实测 2410.00260：原本 left 321 / 721 各 398 宽，接管后都在 321、798 宽；2312.17141 的三面板同样）。**flex 容器可以放心排除**——后代要 subgrid 得先是网格项，父级是 flex 就够不着外面的轨道，不会重演 `.ltx_enumerate` 那种"排除了却仍被 subgrid"的事故；代价是分格内的配对必须显式降级为堆叠（下一条），否则它们会各自长出隐式两列。排除后实测：三面板恢复并排（225 / 551 / 877），连通率 820/826 → 817/826，少掉的 3 对正是移进分格里堆叠显示的分图说明
- **堆叠区** [决定]：`.ltx_td`、`.ltx_inline-block`、`.ltx_flex_cell` 内部不做左右分栏，配对降级为上下堆叠——它们要么是段内嵌套的容器，要么宽度只有半栏。内层写 `:is(.ltx_para, .ltx_abstract, :has(.axt-t))` 而不是 `:where(...)`，权重要压过 (0,2,1) 的容器规则
- **列表标记要脱离网格流，而且两栏各一份** [决定，2026-09-04]：ar5iv 排标记有三套办法——itemize 用 `li.ltx_item > .ltx_tag { margin-inline-start: -2.5rem }` 悬挂、enumerate 用自己的两列网格加 `grid-area: 1/1`、description 用 `dt { float: inline-start }`。把列表项接管成网格后，这三种都会被**网格项块级化**：标记变成整行的块，单独占一行落在正文上方（实测 2312.17141：89 个列表项全部如此，标记被拉到 388px 宽）。绝对定位的子元素不是网格项、不会被块级化，所以标记改为绝对定位；**镜像标记要落到右栏的槽里**（`inset-inline-start: calc(50% + var(--axt-gap) / 2)`——项目跨满两栏，宽度 = 2×栏宽 + 间距，故 50% + 间距/2 恒等于栏宽 + 间距），否则它和原标记叠在左栏同一处，右栏就没有编号（用户实测反馈）
- **列表缩进只能加在格子内容上** [决定，2026-09-04]：**subgrid 容器自己的 inline padding 会吃掉第一条轨道**。列表容器（`ul` 的 UA `padding-inline-start: 40px`）或列表项带 padding 时，左栏被压窄、右栏顶格，于是"英文有缩进、中文没有"（实测 2312.17141：左栏内容 444px、右栏 484px）。把列表容器与列表项的 inline padding 归零，改为给**格子内容**（`:has(+ .axt-t)` 与 `.axt-t`）各加 2.5rem：格子内容的 padding 只影响自己，不动轨道。实测 89/89 项两栏对称——标记 224 / 732、文字 264 / 772、栏宽 484 / 484
- **脚注在页面右缘只留一份，原文在上译文在下** [决定，2026-09-05，用户拍板]：arXiv 把脚注渲染成挂在**页面右缘**的边注（视口 ≥ 96rem 常驻：`.ltx_note_outer` 用 `float: inline-end` 加负的 `margin-inline-end` 推到文章外；更窄则折叠、hover 弹出）。**那个位置是对的，不要动**。真正要解决的是同一条脚注出现两次：段落译文由占位符协议回填、脚注是受保护节点，于是译文段落里会重建一份原文脚注。`localizeNotes`（`src/core/renderer/notes.ts`）把脚注的译文**从原件搬进那份副本**（副本因此是原文 + 译文上下排），原件那份标上 `data-axt-note="moved"` 由样式隐藏。搬进去之前要**脱掉 ar5iv 的脚注框外壳**：译文节点自己也是 `.ltx_note_content`，套进副本就成了"框里套框"——多一条 `double` 顶边线、多 9.6px 缩进，它自带的标号又是绝对定位的会飞进正文（实测，用户反馈"位置是乱的"）。改挂我们自己的 `.axt-note-t`（`display: block` + 0.35em 上边距）后，边框归零、多余标号 2 → 0。实测 2312.17141：文档 522→2026，边注 2042→2522（在文档之外的页面右缘），side 与 stack 都只剩一份。
  **绕过的两条弯路**（都由用户在真实阅读中打回）：(1) 把边注收进本栏（`margin-inline-end: 0` + 限宽）——正文被挤，而且 ar5iv 给列表项里的脚注写死了 `height: 0; overflow: visible`（它本来挂在文章外不需要占位），收进栏内后内容会盖住下一条列表项（实测框高 32、内容高 90、压住 2 个元素）；(2) 复制译文进副本再用样式隐藏原件里的译文——把一件事拆成 CSS 与 JS 两段，只要这一趟没跑成（切模式、配对数对不上）中文就凭空消失，切到 stack 又变成三份。
  现在的做法两条都避开：位置完全交给 arXiv；搬运是**移动**且自幂等，没搬成时退回"原文 + 译文并排"的旧样子，不丢内容；只隐藏**确实搬走过**的那一份。副本与原件按文档序一一对应，数量对不上就整段跳过
- **脚注要连整棵子树一起排除** [决定，2026-09-05]：ar5iv 把折叠状态写在 `.ltx_note_outer` 的 `display: none` 上。排除清单里只有 `.ltx_note` 自己时，译文一插进脚注内部，`.ltx_note_outer` / `.ltx_note_content` 就满足 `:has(.axt-t)` 被判成容器、改成 `display: grid`——**折叠的脚注被掀开**，165px 高、781px 宽横在正文中间，与中栏译文互相干扰（实测 2312.17141，用户反馈）。样式表里把 `.ltx_note *` 加进排除清单；TS 侧不能并进 `SIDE_CONTAINER`，因为 **happy-dom 的 `:is(.ltx_note *)` 恒为 false**（原生 `.ltx_note *` 正常），并进去会让测试与线上行为不一致——改用 `isSideContainer()` 里的 `closest(SIDE_DENY_SUBTREE)` 判定，运行时一律走这个函数。修后脚注恢复折叠（高 0），译文仍在里面，展开时原文与译文一并可见
- **浮到页面外缘的东西不镜像** [决定，2026-09-05]：出版元数据（`.ltx_pubnotes`：DOI / 期刊 / CCS）与脚注内容都是 ar5iv 用 `float: inline-end` 加负边距浮出文章的。它们没有译文，按"未配对内容"被镜像后：右栏那份的浮动内容落在页面右缘（位置对），**左栏那份却落在右栏上**（实测 2312.17141：内容浮到 1320→1752，压住右栏），页面上还多出一整块重复的元数据（用户反馈）。不镜像之后它自然通栏（`& > *` 的默认放置），浮动内容落回页面右缘 2084→2516，与原版式一致。清单 `MARGIN_ASIDE` 放在 `rules/latexml.ts`（`ltx_*` 只能写在那里）
- **堆叠区里不生成镜像** [决定，2026-09-04]：镜像的意义是"右栏别空着"，而堆叠区（`.ltx_td` / `.ltx_inline-block` / `.ltx_flex_cell`，见 `SIDE_STACK`）根本没有右栏，镜像只会在同一列里多出一份重复。实测 2312.17141 的三面板插图：每个面板的公式被复制了一遍，页面上每个面板的内容出现两次（用户反馈的"布局很奇怪"）。`createMirrors` 因此跳过 `closest(SIDE_STACK)` 的容器
- **行内收缩包裹里的图形要豁免 `max-width`** [决定，2026-09-04]：`.ltx_inline-block` 的宽度由内容决定，而内容（图）的 `max-width: 100%` 又回过头参照它——这个循环被解成一个病态的窄值：实测 2312.17141 的弦图 viewBox 68.3×97.88 被压成 **10.5×97.9**，页面上只剩一个看不清的小点。给 `.ltx_inline-block` 内的 `img` / `svg` 写回 `max-width: none` 后，全页 6 张 `.ltx_picture` 与原版式逐张一致
- **插图整块拆两份** [决定，2026-09-05]：插图里的图与公式没有译文，按块配对右栏就空着；整张图跨两栏又等于放弃对照。因此内含配对**且**内含媒体（`img/svg/math/canvas/video/.ltx_picture`）的 `figure` 整块克隆一份：克隆件里删掉每对的原文成员、只留译文，原件在 side 模式下隐藏内部译文（`[data-axt-split] .axt-t { display: none }`）。两份结构完全相同，行天然对齐（实测 2312.17141 的 8 张图：左栏 224→708、右栏 732→1216、顶差全为 0，副本里残留原文块 0、原件里可见译文 0）。判定用 HTML 标签 `figure` 而不是类名（避开"类名是开放集合"）；表格浮动体不走这条路——它的表本来就有译文克隆，所以要求"内含**游离**媒体"把它排除在外——游离指不在任何翻译块也不在译文里：说明文字里的行内公式也是 `math`，只看"有没有媒体"会把表格浮动体误判成插图（实测 2312.17527 两个表格浮动体全被拆，Codex 在 #26 指出）。副本按译文内容的签名判断是否重建，只数个数在换目标语言重翻时会一直用陈旧副本。两份都进 `SIDE_DENY_SUBTREE`，内部一律交给 ar5iv 自己排，`alignPairMargins` 也跳过它们（克隆件里译文的前一个兄弟不是原文）
- **拆开的插图不缩放** [决定，2026-09-05，用户拍板]：栏窄了让 ar5iv 自己重排——`.ltx_flex_figure` 本身就是 `flex-flow: wrap`，面板会自己竖排（实测：满栏 342px 高 → 半栏 546px，不溢出；另一张 311 → 772）。放不下又不能重排的（宽公式、宽 SVG，实测 8 张里 3 张溢出 78 / 102 / 209px）退化为**栏内横滑**（`overflow: auto hidden`），字号一律不动。放弃的两条路：(1) 把栏宽喂给 ar5iv 的 `--main-width`（它按 `.33/.5 × --main-width` 算面板宽）——实测更糟，面板缩成 160px 还溢出 555px；(2) 像表格那样按档缩放——用户明确要求不破坏原文字号比例
- **镜像也按结构判定** [决定]：容器里没有配对、内部也不含译文的直接子元素都补一份镜像，不再枚举 `.ltx_equation` / `.ltx_graphics`。否则参考文献的序号与作者段、作者姓名、列表编号这些同样没有译文的内容会让右栏空着、左栏内容横跨两栏（实测 2609.00097）。镜像有三道闸，缺一道就会整页重复：翻译根自身也必须"内部含有译文"才算容器（否则翻译**开始前**调用会把摘要、章节整块复制到右栏——实测事故）；带 `data-axt-id` 的块以及**内部还含有块**的元素都不镜像（译文到达后会既有副本又有译文）；镜像随翻译进度去抖重算，而不是进入模式时跑一次
- **容器按结构判定，不按类名枚举** [决定，2026-09-04 重做]：参与配对的容器 = `:has(.axt-t, [data-axt-id])`（含译文或块标记，与镜像的容器判定同一个选择器）减去一小撮明确排除的（译文自身、表格内部、ar5iv 自带两列网格的 `.ltx_enumerate` / `.ltx_description`、行内与预格式化上下文、配对成员本身）。早期版本在 CSS 里列举容器类名，但那是**开放集合**：`.ltx_theorem`（变体名由作者宏生成）、`\resizebox` 的包裹层 `.ltx_transformed_inner`、`.ltx_proof`、`.ltx_author_notes` 都是被用户在页面上逐个发现后才补进去的，补一个漏一个——与 §2.12 里"类名不可枚举"是同一个教训。改成结构判定后实测：2609.00097 右栏元素 250→254、未配对 5→1；2609.00095 108→111，且不引入新的溢出。`tests/renderer/side-layout.test.ts` 用快照记录每份 fixture 里"配对能连到翻译根"的比例与被排除项挡住的数量，往排除清单里加东西会让快照变化，把这类漏洞变成构建期失败
- **只有同行短标题的译文清左边距**：对所有译文清零会压掉 `.ltx_centering` 的 auto 边距，镜像图片会贴着栏首而不是像原图那样居中
- **参考文献条目里没有配对的内容留在左栏**：序号与作者段若按默认通栏，会横跨分割线，读起来像格式错乱
- **栏宽以翻译根的第一条网格轨道为准**：所有容器都是它的 subgrid，栏宽处处相同，比按父容器宽度折半可靠（表格的父级不一定是我们设的容器）
- **译文陆续到达时要重算表格缩放**：`fitTables` 只对有译文兄弟的表格生效，而译文是翻译过程中逐块插入的。进度回调里排一次去抖重算，否则先切 side 再翻译这条路径上表格永远不会被缩（早期实现的漏洞）
- **两栏必须写 `minmax(0, 1fr)`** [决定]：`1fr` 等价于 `minmax(auto, 1fr)`，那个 `auto` 下限是轨道内容的 min-content 宽度。英文列的下限是最长单词（宽表格、长公式同理），中文可以逐字换行、下限接近 0，空间不够时英文列守住下限、中文列被单方面压窄（实测文章列 600px 时两栏 317 / 227）。归零下限后两栏恒等宽（272 / 272），代价是超宽内容溢出自己那栏而不是抢隔壁的宽度——与 §7.2 已记录的宽表格取舍一致
- **容器列表必须用 `:where()` 而不是 `:is()`** [决定]：`:is()` 取列表里最具体那一项的权重，列表里有 `.ltx_itemize > .ltx_item`（两个类），会把容器规则抬到 (0,4,1)，压过 (0,3,1) 的配对规则；于是**直接挂在 `.ltx_document` 下的块**（致谢、摘要）被钉成通栏，译文掉到左列下方（实测 2609.00095）。嵌在容器里的块因为走另一条更具体的选择器反而正常，所以这个错误只在文档直接子元素上显形。`:where()` 权重为 0，配对规则才能覆盖
- **列线必须继承，不能各容器自算** [决定]：早期版本给每个容器都写 `1fr 1fr`，于是每个容器按**自己的宽度**切一半——列表里缩进的段落、`.ltx_biblist` 自带 3em 间距的参考文献条目，分界线都和正文错开（实测同一页出现 720 / 715 / 736 三个位置，视觉上分割带是歪的）。改成 subgrid 后实测 105 个右栏元素全部落在同一条 x 上，为后续画中缝分隔线留出了前提。subgrid 容器要显式写 `column-gap`，否则会用容器自己的间距（`.ltx_biblist` 会偏 12px）
- `.ltx_enumerate` / `.ltx_description` **不加入** subgrid 链：ar5iv 用它们自己的两列网格排序号与术语，改成 subgrid 会毁掉编号；它们内部的配对退化为上下堆叠
- 不支持 subgrid 的环境里 `grid-template-columns: subgrid` 整条声明失效，容器退化为单列网格、配对上下堆叠，不会错乱
- **镜像节点** [决定，2026-09-05 重写]：公式、纯图、列表标记、参考文献序号这些没有译文的内容，右栏会空着、内容横跨两栏打断阅读，因此各插一份副本作为 `.axt-t.axt-mirror` 兄弟。判定按结构（见上文"镜像也按结构判定"），不再枚举选择器；带说明的插图不走镜像而是整块拆两份（见"插图整块拆两份"）。块一标记就生成（见 §10），之后留在 DOM 里由 `html:not([data-axt-mode="side"]) .axt-mirror { display: none }` 控制显隐，模式切换仍然只改 `<html>` 上的一个属性。这是 §7.1 第 2 条的一处放宽：side 模式有一次性 DOM 写入，恢复原文时随 `.axt-t` 一并删除
- 译文在 side 模式下**不压缩上边距**：它与原文同处一行，边距不一致会让两边错位（实测 `h2` 差 19px、`figure` 差 64px）。stack / only 才应用 `margin: 0.25em 0 0`
- **同一行两栏的上边距要抄齐** [决定，2026-09-04]：译文作为下一个兄弟插入，会改写站点 CSS 里**相邻兄弟选择器**的匹配结果。ar5iv 有形如 `.ltx_role_affiliation + .ltx_role_affiliation { margin-top: 8px }` 的规则，而译文复制原块的 class，于是原文的前一个兄弟是上一条**译文**（角色不同 → 0px）、译文的前一个兄弟是自己的**原文**（角色相同 → 8px）；网格里格子的顶端 = 行顶 + 自身 `margin-top`，两栏就差了 8px（实测 2501.00077v1 作者区。对照实验：去掉自身该类、去掉前一个兄弟的该类、或在两者中间插一个节点，8px 都归零）。CSS 没有"取兄弟的计算值"的写法，因此 `alignPairMargins`（`src/core/renderer/pair-margins.ts`）在 side prep 里把原文的计算上边距抄到译文的内联样式上——只写我们自己的节点，不碰原节点（§7.1）。每轮**先擦掉上一轮写的值再量**，否则量到的是自己写进去的，栏宽或站点样式变了就修不回来；离开 side 模式时清空，把边距还给站点样式。实测该页 167 对里只有 2 对需要改写、整轮 1.2ms，稳定后重复调用不再改动
- 文档主标题与它的译文通栏居中，不参与左右配对（像论文页眉）；`.ltx_title` 有 `max-inline-size: 52rem`，文章列变宽后必须 `margin-inline: auto` 才居中；`span.ltx_p`、表格与 inline-block 内的 `.ltx_p` 降级为 stack（ar5iv 样式已把 `.ltx_para` 设为 `display:block`，无冲突）
- `.ltx_para` 内非成对的子元素（行间公式、图表等）设 `grid-column: 1 / -1` 通栏
- 标题、图表说明：降级为上下堆叠（它们的父级是整个 section，做不了 grid）
- 表格：整表克隆置于下方（见 5.3）
- **宽度契约** [决定，2026-09-05 重做两次；2026-09-04 版作废]：arXiv 的 body 是五列网格 `1fr nav article aside 1fr`（主题 `--nav-width: minmax(14rem, 25rem)`、文章 52rem 居中；第 4 列没有命名区域，只给 ar5iv 挂在文章右侧的边注 / 致谢 / 出版说明留位）。side 模式把三列的分配**一起**定，原则是**主内容优先、两侧对称**：`--axt-article-w: clamp(58rem, 62vw, 84rem)`（下限保证两栏各 ≥ 28rem，上限让两栏各 ≤ 40rem、每行约 75 字符）；剩余空间**左右均分**给目录与右侧沟槽，同一个 token `--axt-side-w: clamp(8rem, (100vw - article) / 2, 25rem)`，文章因此始终居中，窗口越宽两侧越展开，封顶 25rem（arXiv 目录的上限）后多余的落到两侧 `1fr` 页边距（`--axt-margin-w`）。三个 token 都是 `100vw` 的闭式函数，依赖列宽的规则直接引用、不需要 JS 量轨道；ar5iv 的 `--main-width` / `--main-width-margin` 跟着文章列走。实测（Playwright，两篇论文一致）：

  | 视口 | 两侧各 | 文章（每栏） | 旧版 导航 / 每栏 / 右侧 |
  |---|---|---|---|
  | 1280 | 176 | 928（436） | 176 / 420 / 176 |
  | 1333 | 203 | 928（436） | 176 / 434 / 176 |
  | 1440 | 256 | 928（436） | 176 / 500 / 176 |
  | 1536 | 292 | 952（448） | 176 / 580 / 176 |
  | 2000 | 380 | 1240（592） | 176 / 756 / 176 |
  | 2560 | 400（页边距 208） | 1344（644） | 176 / 756 / 176 |

  **两次走错的路**：(1) 导航压到 `minmax(8rem, 12rem)`、文章拿 96rem——导航 176px（TOC 条目三行折行）、两栏各 756px（每行 95 字符，超出舒适阅读宽度）、右侧 176px（致谢块被压成窄条）；(2) 按视口给导航 14–25rem、右侧只在 ≥ 96rem 留位——1333px 的窗口里导航 267、右侧 16，整篇被推到右边、没有留白（用户打回："主内容始终要在屏幕中央得到最优的阅读体验，空间够了再用两侧显示目录和脚注"）。**右侧沟槽的几何必须跟 token 走**：ar5iv 的四组规则（`.ltx_note_outer` 按 96 / 109rem 写死 20 / 27rem 两档并用负 `margin-inline-end` 推出文章、`.ltx_pubnotes_content` 与 `.ltx_role_thanks` 的 `min(27rem, (100vw - main) / 2 - 2rem)`、作者区末位单位块的 `inset = (100dvw - main) / 2`）是给 52rem 文章配的，我们的沟槽在 1600px 只有 19rem，照写会溢出视口。这些规则在 `@media (width >= 96rem)` 里按 `--axt-side-w` / `--axt-margin-w` 重写，盒子一律占 `[文章右缘 + 1rem, 文章右缘 + side - 1rem]`，显隐与 hover / focus 交互原样不动；96rem 以下 ar5iv 本来就不显示边注（折叠成 hover 弹出），沟槽只是对称的留白。还没翻译的段落里脚注原件从**左栏**起浮，要再多推一栏加一个栏距（栏宽 = (文章列 − 主题给 `.ltx_page_content` 的 1rem 左右外边距 − 栏距) / 2；`--axt-gap` 因此改用 rem，em 会在脚注的 .85rem 字号里被重新解释），译文到达后副本从右栏起浮、原件隐藏，两种状态实测同落在沟槽里。只覆盖 `--main-width` 不动轨道会横向溢出（隐藏导航栏不会收掉它的轨道，实测 1500px 视口溢出 388px），把轨道归零又会让 TOC 消失，两者都不可取
- 用 `matchMedia('(max-width: 1279px)')` 监听（与 arXiv 主题折叠导航栏的 1280px 断点对齐）：变窄自动切到 stack，变宽切回 side；用户手动选的模式记为偏好，自动降级不覆盖偏好。实现见 `src/core/renderer/responsive.ts` 的 `createModeController`，popup 显示偏好、状态里同时带实际生效的模式

### 7.3 stack（上下对照）

默认布局，译文紧跟原块。不需要额外 CSS，只有译文样式。

- **短标题同行** [决定]：`title` 单元里除文档主标题外、可见文本 ≤ 60 字符的标题，渲染时给原标题与译文都加 `data-axt-inline`，CSS 令两者 `display: inline-block`（inline-block 保留标题自身的上下 margin），译文左边距 0.5em，效果是 "Abstract 摘要" 同行。参考项目把译文塞进原元素内部达到同样效果，我们不改子树，所以用属性 + CSS。主标题保持上下堆叠：它靠 `text-align: center` 居中，inline 后无法居中

### 7.4 only（仅译文）

- 原块 `display: none`（不是删除、不是替换文本节点）；选择器是 `[data-axt-state="translated"]`，所以只隐藏真的有译文的块
- 参考文献条目**不再豁免**（2026-09-04 修订）：条目改为按 `.ltx_bibblock` 分段翻译后（§5.4），作者段本来就不翻、没有 `data-axt-state`，只译文模式下自然保留，条目仍完整可读。旧豁免是整条翻译时代的遗留
- 未翻译成功的块保持原文可见：隐藏规则只匹配 `data-axt-state="translated"`，`pending` / `failed` 不被匹配即可，失败块旁的重试小部件（§7.6）也跟着可见。**不要**写 `display: revert`——revert 会把站点的 display 一并撤销（`.ltx_bibblock` 从 block 变回 inline），2026-09-05 已删（Codex 在 #19 指出）

### 7.5 译文样式

- 参考 KISS 的做法：一组 CSS 预设（下划线、虚线、淡色、引用块、无样式），通过 `--axt-*` 变量实现，用户可自定义 CSS
- 译文节点复制原块 class（§7.1），字体、字号、行高、对齐、grid 位置天然与原块一致，`--axt-*` 预设只做叠加装饰。注入的 `<style>` 排在站点样式之后，`.axt-t` 上**不要**写 `font: inherit` 这类会以同等特异度盖掉站点样式的属性（实测会把摘要标题的 1.4rem 和参考文献的字体覆盖成父级默认值）

### 7.6 等待态：加载圆环 [决定，2026-09-05，照搬 Read Frog]

- 请求发出**之前**先在原块后面插一个 pending 译文节点（`.axt-t.axt-pending`，与原块同标签、同 class，`data-axt-for` 指向原块），里面只有一个 6px 的圆环 `<span class="axt-spinner">`。包裹先插、内容后填，与 §7.1 "译文只作为原块的下一个兄弟"完全一致；译文到达后**被真译文替换**（`renderText` / `renderTable` 开头的 `clearTranslation` 删掉同 `data-axt-for` 的兄弟，删前取消圆环动画）——与"填进同一个节点"效果相同、少一条路径。表格块的 pending 是 `div`，整表克隆到了才是 `table`。短标题的 pending 也按 §7.3 同行
- 圆环照搬 Read Frog `utils/host/translate/ui/spinner.ts`：内联 `!important` 样式（不受站点 CSS 影响）、Web Animations API 转 600ms 一圈、颜色只用一个变量 `--axt-muted`；`prefers-reduced-motion` 时静止；**同时转动的圆环最多 60 个**，超出的是静止环（Read Frog 实测两千多个动画会拖垮主线程）；动画句柄存 WeakMap，删节点前先取消
- 失败：圆环换成错误提示 + "重试"按钮（Shadow DOM 隔离，§技术栈），节点留着；用户取消（恢复原文 / 关闭翻译）：整个 pending 节点删除，不显示错误
- side 模式的整理步骤（拆图、镜像、脚注归位、边距对齐）**只认真正的译文**（不带 `axt-pending` 的 `.axt-t`）：pending 节点的高度与译文无关，拿它算 `translationKey` 或复制脚注只会白做一遍。配对规则 `:has(+ .axt-t)` 对 pending 节点照常生效，原块与圆环各占一栏，译文到达时版式不再跳
- only 模式下 pending 的原块照常可见（隐藏规则只认 `translated`，§7.4），圆环跟在后面
- **失败态**（PR 2b，2026-09-05）：失败块旁插 `.axt-t.axt-error` 小部件——Shadow DOM 里一个"重试"按钮与带原因的"！"（宿主与"！"都带 `title`），原块标 `failed` 画红线。重试 = 把该块再交给 `run.translate`，先删小部件再插 pending；popup 的"重试失败的 N 块"（`axt:retry-failed`）走同一条路。原因由 pipeline 逐段记下（provider 的 kind + message、"译文的占位符与原文对不上"、"已取消"）。Read Frog 的 React + jotai + @tabler/icons + base-ui 版本不搬（§12 取舍）；side 模式下小部件落在右栏，与它的行内错误块位置相当

---

## 8. Provider 接口

位置：`src/providers/`。每个引擎一个文件，禁止跨文件共享未公开接口的细节。

### 8.0 请求跑在 content script [决定，2026-09-04 修订]

provider 的 `fetch` 在 **content script** 里发，background 只保留缓存、配置与跨页面协调。

理由是实测：MV3 的 service worker 会在等待期间被挂起，一条没有任何 I/O 的 `axt:provider-status` 在冷 worker 上要 6.7–77 s（同一 worker 上紧邻的 ping 只要 50 ms），翻译中途还会出现 `A listener indicated an asynchronous response by returning true, but the message channel closed`（RESEARCH.md §6.5）。把请求留在 background 就是在跟 MV3 的生命周期较劲；Read Frog 的 provider 适配层本来就跑在 content（`utils/host/translate/api/*`），FluentRead 用 `platform/http/runtime.ts` 抽象 transport，两家都不把等待放在 worker 里。

- 跨源请求可行性已实测：`translate-pa.googleapis.com` 在页面上下文返回 CORS 响应（RESEARCH.md §6.6）。自定义 LLM 端点由 `optional_host_permissions` + 运行时授权覆盖，与现在设置页的做法一致
- 代价：LLM 的 API key 会进入 content script 的隔离世界内存。页面脚本读不到，但比只留在 background 弱一层，因此 key 仍然**只存 WXT storage、只在发请求时读取、不写日志不写缓存键**（§0 硬规则不变）
- background 仍持有缓存（IndexedDB 按扩展 origin 隔离，跨论文共享）与配置；content 侧只发两类消息：查缓存 / 写缓存。这两类消息即使被 worker 挂起拖慢，也只影响缓存命中，不阻塞翻译

```ts
export interface TranslationProvider {
  id: string                        // 'openai-compat' | 'anthropic' | 'gemini' | 'chrome-builtin' | 'google-web'
  displayName: string
  kind: 'llm' | 'mt' | 'builtin'
  preservesMarkup: boolean          // true → markup 路径；false → runs 路径
  maxBatchChars: number             // 单次请求字符上限
  maxBatchItems: number             // 单次请求段落数上限
  rateLimit?: { rate: number; capacity: number }  // 令牌桶速率；不声明用服务默认的 8/s、突发 20（Read Frog 默认值）
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
| `google-web` | `translate-pa.googleapis.com/v1/translateHtml`，移植 Read Frog `utils/host/translate/api/google.ts`；一次请求多条，body `[[[items...], from, to], "wt_lib"]` | true（实测原样保留 void / paired 占位符）|

`preservesMarkup: true` 的免费引擎仍走 §6.3 的校验，失败后降级 runs；runs 路径退为纯兜底。

`google-web` 取代原定的 `google-gtx`（`translate_a/single`）：2026-09-04 实测 `translateHtml` 一次请求可带 150 条、556 ms 返回且占位符完好，而 gtx 是单条接口（RESEARCH.md §6.6）。gtx 与微软 edge 通道不接（后者 auth 端点已 404，RESEARCH.md §5）。免费引擎的定位是**大批量回归测试**与视口首屏的即时译文，最终译文仍以 LLM 为准：机器翻译会把 "weights" 译成"重量"，术语准确度不够。

### 8.2 LLM 调用约定

- 用 AI SDK 7 的 `generateText` + `Output.object({ schema })`（`generateObject` 已被取代）+ zod schema `{ segments: { id, text }[] }`，让结构校验由 SDK 完成；SDK 自身 `maxRetries: 0`，重试交给移植的 retry policy
- **提示词分两层** [决定，2026-09-05]：`prompt-library.ts` 移植自 Read Frog（模板变量 `{{targetLanguage}}` `{{input}}` `{{paperTitle}}` `{{abstract}}` `{{sectionTitle}}` `{{glossary}}`、内置提示词 `default` / `precision-rewrite`、用户自定义 `patterns`、按 `promptId` 选择、找不到回退 default），负责"怎么翻"；`prompt.ts` 的**协议块**（JSON segments + 占位符规则 + 输出形状）追加在任何 system prompt 之后，负责"怎么收发"，用户自定义提示词也改不掉它。协议是我们的（AI SDK 结构化输出 + zod），比 Read Frog 的文本分隔符批处理稳，不换；Read Frog 的网页摘要要多调一次 LLM，论文自带 abstract 直接用
- **元数据放在用户消息里、带 `<document_metadata>` 定界符并声明为不可信参考**：Read Frog 把它放 system prompt；标题 / 摘要是作者写的，讨论 prompt injection 的论文里可能带着指令样文字，进 system 会被当成同级指令（Codex 在 #28 指出）。协议块同时声明 segment 与元数据都是数据不是指令
- **论文级上下文每批都带**：页面加载时 `paperContext()` 抽一次标题与摘要（摘要去掉 "Abstract" 标题、跳过 MathML `<annotation>` 里的 TeX 源码、截到 1200 字符；必须在翻译前抽，翻译过再抽会把上一轮译文也算进去），经 `RunOptions.context` 进每批 `request.context`，与批次的 `sectionTitle` 合并；代价每批约 300 token 输入
- prompt 带版本号 `PROMPT_VERSION`（提示词库接入升到 2），写入缓存键；**提示词身份 `promptKey`**（内置用 id，自定义带两段分别编码的全文）与**上下文原文**（标题 / 摘要 / 章节 / 术语表，结构化序列化；免费引擎不看上下文，不带）也进缓存键的 SHA-256 载荷——换了提示词、或同一段文字出现在另一篇论文里，都不能命中旧译文。**不先压成 32 位 hash**：DJB2 撞了外层 SHA-256 也分不开（Codex 在 #28 给出实例 `19k04n01vcr73f` / `1efm0uaep90s9`）；配置 v1→v2 迁移补 `prompts` 字段、保留 API key
- 批次按章节切（标题块开启新批次），单批不超过 `maxBatchChars`（默认照 Read Frog：1000 字 / 4 段；速率同样照它的令牌桶默认值 8 请求/秒、突发 20，服务内再按批次键攒 100ms——小批高并发，首屏快）；附带 `sectionTitle` 作上下文；公式密集块单独成批；表格块整表一批（`renderTable` 需要所有单元格一起到）
- 批次失败：对半拆分重试 → 单块 → 标记失败

- **每次请求有上限，超时按可重试错误处理** [决定，2026-09-05；同日改由移植的 request-queue 承担]：没有上限时一个挂住的连接会让整篇翻译永远停在"进行中"——实测 2312.17527 走真实 API：153 块翻了 152 块，最后一块（1600 字、32 个占位符）等了 220s 还没回，`translation done` 永远不打、popup 一直转。上限随字数放大：20 s + 每字 15 ms，最多 120 s（Read Frog 的常量；1000 字的批 35 s，那个 1600 字的块 44 s），request-queue 用 `Promise.race` 加超时并 abort 在飞请求（provider 不配合 signal 也能切断），超时归入 retry-policy 的 `timeout` 类别走重试（默认 2 次），用尽后只这一块标失败

### 8.3 免费引擎约定

- 视为**随时会断**的东西：独立文件、独立错误类型、失败自动切到 fallback 链的下一个
- fallback 链默认：用户选定 provider → `chrome-builtin` → `google-web`
- `google-web` 一次请求多条（默认 100 条 / 8000 字一批），速率压到 2 请求/秒、突发 2（`rateLimit`）——免费端点经不起默认的 8/s；不攒批（Read Frog 的 `shouldUseBatchQueue` 只让 LLM 攒），429 与超时同 §8.2，由 request-queue 统一处理
- **429 暂停整条队列，由移植的 request-queue 提供**（2026-09-05）：并发或速率只是上限，撞上限流的任务自己睡着时其余任务还会往同一端点打（Codex 在 #6 / #10 指出）。request-queue 的做法：暂停时长取 Retry-After 与退避（5 s × 2^连续次数，10% 抖动）的较大者，同一窗口内的多个 429 只计一次连续；暂停期间不派发任何任务，撞上的任务重排到暂停结束时刻；暂停结束时桶里最多留一个旧令牌，其余按速率补——默认 8/s 下 5 s 的暂停会把 20 的容量补满，所以"单探针"只在速率低时成立，这是它的原样行为（#30 里手写的更严格的探针闸已删，按目录搬的规矩不改）；连续 5 个窗口或单任务 8 次 429 就排空整队。`no-key` / `auth` 标成 access-denied 排空整队，`aborted` / `invalid-response` 标不可重试——元数据在 `ProviderError` 构造时按 kind 挂上（no-key、id 对不上都是在 try 之外直接 throw 的），移植的策略不认识这些 kind，曾把 no-key 当未知错误重试 4 次、白等 7 s
- **思考模式默认关闭**（照 KISS 的 THINKING_API_REGISTRY）：按端点域名选字段——OpenRouter `reasoning: { effort: "none" }`、DeepSeek 官方 `thinking: { type: "disabled" }`、百炼 / 硅基流动 `enable_thinking: false`，未登记端点不发；经 AI SDK `providerOptions` 进请求体（`src/providers/thinking.ts`）
- **即时引擎**：`chrome-builtin` 模型就绪时（`availability() === 'available'`）单句 10–20 ms 且离线，用它先渲染视口内的块，用户选定的 LLM 译文到达后原位替换；缓存键含 provider，两者互不覆盖。用户可在设置里关闭

### 8.4 `chrome-builtin` 约定（Phase 0 实测，Chrome 152，RESEARCH.md §6）

- `isAvailable()` 以 `Translator.availability({ sourceLanguage, targetLanguage })` 为准：`available` 直接可用；`downloadable` / `downloading` 需要**用户手势**——只能在 popup 的点击处理函数里调用 `create()` 触发语言包下载，否则抛 `NotAllowedError`；模型就绪后 `create()` 不再需要手势（1 ms）
- 首次下载期间 `availability()` 不会变成 `downloading`，`monitor` 也没有 `downloadprogress` 事件（实测 67 s 内一直是 `downloadable`），UI 用不确定态"正在下载语言包"提示；下载完成后再次 `create()` 才会有 0→1 的进度事件（约 8 s 的本地加载）
- 语言包按语言对独立下载（en→zh 与 en→ja 各一份）
- 译文需归一化句号后的多余空格（「。 」→「。」）
- content script 隔离世界是否同样暴露 `Translator` 待接 `chrome-builtin` 时用真实 content script 验证 [待验证]

---

## 9. 缓存与配置

- 译文缓存：IndexedDB，**Dexie**，移植 FluentRead `services/translation/cache.ts`（键规范化、TTL、容量上限、内存热层），crypto-js 换成 Web Crypto SHA-256（v0.4 修订，原定 idb-keyval）
- 缓存键：`sha256(providerId | model | PROMPT_VERSION | RULES_VERSION | target | renderPath | normalizedText)`；`normalizedText` = NFC 归一化 + 连续空白折成一个空格 + 首尾 trim，占位符文本参与哈希
- 值：`{ text: string; ts: number; paper: string }`，`paper` 用 arXiv id，便于按论文清理和导出。TTL 30 天、上限 20,000 条 / 50 MB、单条 256 KB、内存热层 256 条；缓存只在 background 持有（IndexedDB 按扩展 origin 隔离，跨论文共享），content 侧通过 `axt:cache-get` / `axt:cache-put` 读写；provider 请求本身不经过 background（§8.0）
- **淘汰不扫全库** [决定]：条数与字节数在内存里增量维护（`byteSize` 索引，Dexie schema v2；只用 `orderBy(index).keys()` 读索引键初始化，不反序列化记录），只有真的超过上限才按 `lastAccessedAt` 批量取最旧的条目删除。原版 FluentRead 每次 `set` 都把整库记录读出来求和，一篇论文几百次写入、库到几千条后每次写入都要反序列化整库；MV3 的 service worker 是单线程，其他消息会排在后面等几十秒（实测 fake-indexeddb：2000 条时 5.5 ms/set 且随库线性增长，改后稳定在 0.11 ms/set）
- **坏译文不入库、重发不读库** [决定，2026-09-05]：markup 路径的请求带 `accept` 回调（进程内调用才有，过不了消息边界），translate-service 只把通过占位符校验的译文写进缓存（Codex 在 #30 指出）；占位符校验失败后的单块重发另带 `cache.bypass` 只写不读——老库里可能还有修复前写进去的坏条目，照常读只会原样拿回来、每次都退到 runs 路径（Codex 在 #9 指出），重发成功即覆盖
- 配置：WXT storage，zod schema 带 `version` 与迁移函数（移植 Read Frog `config/storage.ts` + `migration.ts` 的模式）。v1 形状：`{ version, provider: 'openai-compat' | …, openaiCompat: { baseURL, apiKey, model }, targetLanguage: 'zh-CN', mode: 'stack' | 'side' | 'only' }`。API key 只存本地，永不出现在缓存键、日志或测试 fixture 里

---

## 10. 调度 [决定，2026-09-05 重做：照搬 Read Frog 的加载模式，用户拍板；PR 2a 已实现：`scheduler/lazy.ts`、`renderer/pending.ts`、`scheduler/title.ts`、`pipeline/run.ts` 的 `startTranslation`]

**看到哪翻到哪**：只翻视口内与其下方一段距离内的块，没滚到的块不发请求、不占资源。这是 Read Frog 页面翻译**唯一**的模式（`PageTranslationManager`，没有"整篇翻"的开关），做法照搬；它的模块解耦、效果经过验证，能整段搬的整段搬（见 §12 的 `feat/lazy-loading`）。

- 开始翻译时只给所有块打标记（`data-axt-id`、`pending`）并逐块交给一个 `IntersectionObserver`，**不发任何请求**。参数照 Read Frog 的 `pageTranslation.page.preload` 默认值：`rootMargin` **1000px**、`threshold` **0**；设置页暴露为"预翻译距离"（0–10000px，步进 100）与"可见阈值"（0–1），与 Read Frog 同名同义。原先照 FluentRead 的 600px / 0.01 作废
- 块**第一次**进入视口加边距时才发请求，同时 `unobserve`——一次性；视口外的块永远不会被请求。没有"整篇翻完"的后台队列，想整篇就把预翻译距离调大（Read Frog 也是这么做的）
- 同一次 IO 回调里进入的块**攒成一批**：一次滚动会让几十个块同时进入，按 §8.2 的 1000 字 / 4 条切批发出，表格整表一批不变；`planBatches` 只对"这一批进入视口的块"运行，不再预先规划整篇。IO 首次回调是异步的，创建时仍按 `getBoundingClientRect` 同步播种一次，首屏不等回调
- 请求期间原块旁边先插带加载圆环的 pending 节点（§7.6），译文到达后填入；失败换错误提示与"重试"；取消则删除
- **取消**：恢复原文或关闭翻译时带 session id 撤掉排队与在飞的请求（Read Frog `translation-session` + `cancelPageTranslationRequests` 的做法：进程内的 `AbortController` 一起中止，pending 节点连同圆环一起删）；被撤掉的请求的结果即使返回也不渲染、不写缓存
- Read Frog 的 `MutationObserver`（动态页面新增内容）与巨型段落拆分（高于三屏的段落按子段落观察）**不搬**：arXiv 页面是静态的，段落也不会高过三屏；将来接其他站点再说
- popup 的进度语义随之改变：翻译是一个"开着"的状态而不是一次会结束的任务。显示"已翻 / 已进入视口 / 失败"，`total` 只作参考；"翻译中"表示还有在飞的请求，没有在飞的请求即静止，滚动后再次进入"翻译中"

以下不变：

- **插入译文时不做滚动锚定，也不做任何布局读取** [决定，2026-09-05]：视口不跳交给 Chrome 原生 scroll anchoring（`overflow-anchor: auto` 是默认值；实测在视口上方插入 600px，浏览器自动补偿 575px 滚动、锚点位移 0）。早期移植 FluentRead 的 JS 锚定（`elementFromPoint` + `getBoundingClientRect`）每批强制两次全页布局，side 模式下每次 130–150ms、stack 90–100ms（15644 个节点、~700 个 subgrid 容器）；8 个 worker 一百多批下来，全命中缓存的 826 块也要 16.5s，主线程长任务 52 条、每条 ~90ms 首尾相接。去掉后翻译只受网络 / 缓存往返约束
- **进度事件用带最长等待的合并器，不用纯去抖** [决定，2026-09-05]：翻译中每秒几十次进度回调，150ms 去抖计时器一直被重置，side prep 直到整篇翻完才跑（实测 413 个镜像在最后一刻同时出现，之前公式一直居中横跨两栏）。`createCoalescer(fn, { delay: 150, maxWait: 1000 })`：事件再密也至少每秒整理一次
- **镜像不等译文** [决定，2026-09-05]：公式与插图本来就没有译文，等它们所在段落的译文到达才镜像是白等。块标记（`data-axt-id`）在翻译开始的第一刻就写好，镜像的容器判定改为 `:has(.axt-t, [data-axt-id])`，第一趟 prep 就把它们全部镜像；闸 2（带块标记或内部含块的不镜像）不变，整块复制的事故不会重演
- 每个 provider 一对队列（`translate-service`，2026-09-05 已换成整目录移植的 Read Frog `utils/request/`）：`request-queue`（令牌桶，默认 8 请求/秒、突发 20；provider 用 `rateLimit` 覆盖）+ `batch-queue`（1000 字 / 4 条 / 攒 100ms，派发闸让限流期间多攒少发；只有 LLM 攒批）+ `priority-queue` + `cancellation`，测试一起搬；`p-queue` 与 #30 里手写的暂停 / 探针已删。批次键 = provider、模型、提示词、目标语言、渲染路径、上下文（含章节标题，所以不跨章节混批）；provider 报"id 对不上"时按批次错误处理：整批重试 3 次再逐条兜底，request-queue 自己不重试。取消按 scope：每次运行一个 id，恢复原文时先撤 batch-queue 再撤 request-queue（顺序照它的 translation-queues.ts），在飞的 fetch 被 abort，结果回来也不渲染不写缓存
- 失败块的"重试"按钮在错误提示里（§7.6），popup 不再单独列失败块

---

## 11. 测试策略

| 层 | 工具 | 覆盖 |
|---|---|---|
| 规则 | Vitest + happy-dom | 每个 fixture：提取的块数量与 id 列表快照；跳过规则不误伤 |
| 占位符 | Vitest | 序列化 → 假译文 → 回填，往返后受保护节点等价；校验器对各类破坏（丢 id、多 id、嵌套错）都能识别 |
| 渲染 | Vitest + happy-dom | 翻译 → 切换三模式 → 恢复，恢复后 DOM 与原始逐节点相等 |
| provider | Vitest（mock fetch）| 请求拼装与响应解析；免费接口另有可选的 live 测试，默认跳过 |
| 端到端 | Playwright（`pnpm e2e`，`tests/e2e/extension.mjs`，2026-09-05 起） | 起一个装着 `.output/chrome-mv3` 的 Chromium（`channel: 'chromium'` 的新 headless 支持扩展），驱动设置页与 popup、读控制台与网络：google-web 整篇翻完与速率、刷新命中缓存、翻译中途恢复原文（译文与 `data-axt-*` 全清、不再发请求）、错 key 的 auth 排空整队。不碰用户浏览器与 key，LLM 只测错 key 不花钱。**布局断言**在 `tests/e2e/layout.mjs`（`pnpm e2e:layout`，2026-09-05 起）：side 模式在 1440 / 2000px 下不横向溢出、导航 ≥ 14rem、两栏等宽且 ≤ 40rem、右侧沟槽元素落在文章右缘与视口之间、只含公式的列表项与兄弟项标记对齐、单列 flex 图里的表格与脚注左右配对、多面板 flex 图仍并排且无镜像、正文脚注副本落在沟槽里 |
| 手动清单 | 用户在自己的 Chrome | 走真实 key 的 LLM 路径；锚点跳转、脚注弹出、公式渲染、Ctrl+F、打印 |

fixtures 存在 `tests/fixtures/arxiv/<arxiv-id>.html`（10 篇，Phase 0 抓取，覆盖多领域与多结构，含一篇转换失败页；全部为 oxide 0.7.6）。规则测试用 happy-dom 解析，1.8 MB 页面约 0.6 s，可直接跑全量 fixture。

---

## 12. 阶段计划

**Phase 0 — 研究（已完成，产出见 `docs/RESEARCH.md`）**
- [x] 抓 8–10 篇不同年份/领域的 arXiv HTML 存为 fixture，跑 `ltx_*` 类名直方图，校订第 5 节的选择器，结果写入 `docs/RESEARCH.md`
- [x] clone 三个参考仓库到 `reference/`（gitignore），为每个模块写一行"参考哪个文件"，写入 `docs/RESEARCH.md`
- [x] curl 验证 `google-gtx`、微软 `translatetext`、Google `translateHtml` 今天是否可用、是否保留标签（结论：采用 `translateHtml`，见 §8.1）
- [ ] 验证 content script 内能否直接调 `Translator` API（页面主世界已测，RESEARCH.md §6；隔离世界待接 `chrome-builtin` 时验证，§8.4）；模型下载是否需要用户手势（已测：仅首次下载语言包需要）
- [x] 确认 arXiv 主容器与导航栏的选择器，以及 arXiv 自身 JS 是否会与我们冲突

**Phase 1 — 骨架 + 规则（测试先行，三个分支依次合入）**
- `feat/scaffold`：WXT + React 脚手架，四个入口只是壳，Vitest + happy-dom 配好
- `feat/rules`：`latexml.ts` 扩成 §5.6 的完整规则模块，谓词单测 + 数值格边界用例；`pnpm fixtures:stats` 改用 PROTECT_RULES
- `feat/extractor`：§4.1 的块模型与遍历，10 篇 fixture 快照 + 不变量测试（id 唯一、不在 skip 内、有可翻译文本、`extract` 不改 DOM）；content script 加载只 extract，`#axt-debug` 时 mark + 虚线描边，popup 显示块统计

**Phase 2 — 核心闭环（已完成 2026-09-03；五个分支依次合入，边界见 §13；完成标准四项在真实页面实测通过；速度按 KISS / Read Frog 的做法修正——思考模式按端点关闭、1000 字 / 4 段 / 并发 8）**
- `feat/protector`：占位符引擎——`serialize` / `validate` / `rehydrate` / runs 切段；嵌套单元对外层作 void；移植 Read Frog `html-attribute-markers.ts` 的完整性校验改成 `<x id>` / `<t id>` 协议
- `feat/providers`：`TranslationProvider` 接口；`openai-compat`（`@ai-sdk/openai-compatible` + `generateObject`，默认 OpenRouter 端点与便宜快速档模型）；prompt 与 `PROMPT_VERSION`；配置 schema + 迁移；options 页字段。移植 Read Frog `providers/model.ts`（精简到三家）、`retry-policy.ts`、`config/storage.ts` + `migration.ts`；并发 `p-queue`、重试用手写循环配移植的策略（2026-09-05 换成整目录移植的 `utils/request/`，见 §10）
- `feat/cache`：移植 FluentRead `cache.ts`（Dexie），键见 §9
- `feat/renderer`：stack 模式、恢复原文、表格整表克隆置于下方；原创，DOM 逐节点相等测试守护
- `feat/pipeline`：content 提取 → 查缓存 → protector → background 队列 → provider → validate → rehydrate → render → 写缓存；降级链（重试一次 → runs → 标记失败）；popup 翻译 / 恢复 / 进度。Phase 2 按文档序整篇翻，视口优先留 Phase 3
- 完成标准：真实 arXiv 页面 popup 点"翻译"后段落下方出现译文；刷新再点秒出（缓存）；"恢复原文"后 DOM 与翻译前逐节点相等；失败块在 popup 可见

**Phase 3 — 完整 v1**
- provider 请求移到 content（§8.0）；side / only 模式与宽度逻辑；`chrome-builtin` + `google-web` 与 runs 路径；fallback 链；调度与进度；样式预设；术语表；options 页
- `feat/lazy-loading`（§10 / §7.6，2026-09-05 列入）：照搬 Read Frog 的加载模式，按目录搬、不按函数挑（CLAUDE.md 的搬运判定）。
  - **PR 1 `feat/request-queue`（已完成 2026-09-05）**：整目录移植 `utils/request/`（`request-queue` / `batch-queue` / `priority-queue` / `cancellation`，连同它们的测试；同目录的 `retry-policy` 已在）替换 `p-queue` 与 `withRetry`，`translate-service` 按 `background/translation-queues.ts` 的方式组装（rate / capacity / dispatchGate）。纯工具、不碰页面，风险最低，先定下派发接口。scope 取消也一并进了服务（`TranslateService.cancel`），PR 2 的 session id 直接顶替每次运行的 scope
  - **PR 2a `feat/lazy-loading`（已完成 2026-09-05）**：移植 `ui/spinner.ts`、`utils/scheduler.ts`（主线程切片）、`translation-session.ts`；pending 节点 + 圆环（§7.6）；`IntersectionObserver` 一次性触发、按回调攒批、session 取消；`document.title` 翻译；配置 v3 加 `preload`。`PageTranslationManager` 只搬了观察器骨架改绑我们的 `Block[]`（`scheduler/lazy.ts`），启动标记按 12ms 切片；停止时剥掉我们打的标记（§7.1）。脚注块在 ar5iv 里 `height: 0` 或折叠、IO 永远判不可见，挂在所在段落上一起触发（FluentRead 锚点的思路）。e2e 加了"不滚动只翻首屏附近、逐屏滚到底其余跟上"的检查
  - **PR 2b（已完成 2026-09-05）**：设置页的"预翻译距离 / 可见阈值"两个数字框；失败块的重试 / 错误小部件——Read Frog 的是 React 组件挂 Shadow host，依赖 jotai、@tabler/icons-react、base-ui，每个失败块一个 React root（它自己吃过 #1831 的泄漏亏），三个新依赖加逐块 React root 是负担，改用几十行原生 DOM + Shadow DOM 做同样的两个控件；popup 的失败块列表
  - **搬运取舍**（2026-09-05 讨论，用户拍板：无负担就搬、有负面影响才取舍）。一起搬、暂时用不上：跨标签页去重与 `cancelledScopes` 登记（不跑的分支没有代价）、`document.title` 翻译（一个 head 观察器加一条请求）、work pacer（只有好处）。**不搬，各有具体的负面影响**：
    - `MutationObserver`：盯整棵 `documentElement` 的子树 / 属性 / 文本；arXiv 页面本身不动，动的是我们插的几千个节点，它的"自己造成的变化不算"过滤器只认 `read-frog-*` 标记，每批译文都会让它重走一遍甚至判定原文变了去重翻。接了是纯负担；真要接得改成认 `axt-` 前缀，那是改写不是搬
    - 巨型段落拆分（高于三屏的单元按子段落观察）：我们的块里有整表，六百格的表轻松超过三屏，拆开就破坏"整表一块"的模型；`threshold` 0 意味着表顶一进视口就整表触发，收益为零
    - 仅译文模式的原地替换文本节点：违反 §7.1，恢复后 DOM 对不上；我们的 only 模式用 CSS 隐藏已达同样效果
    - 纯文本协议与分隔符批处理：Phase 0 实测公式密集段落要占位符 + 结构化输出才稳（§8.2），换回去是降级
    - 队列放 background：MV3 挂起是实测根因（§8.0），位置不搬，组装方式抄过来
    - 通用 DOM walker（`dom/traversal.ts` / `filter.ts`）：不接线没有代价，但只有 v2 的其他站点才用，参考仓库钉在快照 commit 上、晚搬不损失，留给 v2
  - 每个移植文件带来源行并登记 THIRD_PARTY

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

**许可证 [决定]**：项目以 GPL-3.0 开源，非商业，与三个参考项目同许可证，可直接移植。GPL §5 要求保留声明并标明修改：移植文件的文件头写 `// 移植自 reference/<repo>/<path>@<commit>（GPL-3.0），<YYYY-MM-DD> 移植、有修改`（§5(a) 要求修改声明带相关日期），并在 `docs/THIRD_PARTY.md` 登记。

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
