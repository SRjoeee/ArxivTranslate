# Phase 0 研究记录

日期：2026-09-03 · 对应 DESIGN.md v0.1 · 状态：Phase 0 任务 1–7 全部完成

本文记录 Phase 0 的实测结论。凡与 DESIGN.md 不一致之处，只在此记录并在 §7 提修订建议，不直接改设计。
脚本：`pnpm fixtures:stats`（`scripts/fixtures-stats.ts`，规则覆盖率审计）、`scripts/phase0/fetch-candidates.sh`（候选抓取）、`scripts/phase0/candidate-stats.sh`（粗粒度特征计数）、`scripts/phase0/td-numeric-calib.ts`（§5.3 数值格正则校准）、`scripts/phase0/translator-probe.js`（Translator API 探测）。
Phase 0 尚无测试与构建目标，`pnpm test` / `pnpm build` 从 Phase 1 起生效。

---

## 1. Fixture

10 篇保存在 `tests/fixtures/arxiv/<id>.html`，清单与选择理由见该目录的 `README.md`。覆盖：公式密集（3 篇）、算法/代码块（4 篇）、大表格/数值表（4 篇）、脚注/定理（4 篇）、2023 年 4 篇、2024/2025 各 1 篇、2026 年 4 篇、`.ltx_ERROR` 2 篇（其中 1 篇为转换失败页）。

**关键发现**

1. **线上不存在"早期 LaTeXML 版本"的页面。** 56 篇候选（2023-12 至 2026-09）的生成器注释全部是 `LaTeXML oxide (version 0.7.6)`，2023 年 12 月的论文也不例外；带版本号的 URL（`/html/2312.17127v1`）同样返回 oxide 0.7.6。arXiv 已用新转换器重新生成了历史文章，旧输出不可得。因此"按年份覆盖 LaTeXML 版本差异"这一目标在当前无法通过线上页面达成，规则只需针对 oxide 0.7.6 一个版本；但版本探测与分叉机制仍应保留，以应对将来的再次升级。
2. 并非所有论文都有 HTML：60 篇候选中 4 篇 404（无 LaTeX 源或转换失败未发布）。扩展只需处理有 HTML 的页面，无需额外判断。
3. 转换失败但已发布的页面存在（`2608.30667`）：`<title>` 为 "Untitled Document"，正文只有一个 `.ltx_p`，`.ltx_ERROR` 标出未定义宏。扩展在这类页面上必须安静退出或只翻译能翻译的部分，不能报错。
4. 抓取注意事项：`export.arxiv.org` 的 http 会 301 到 https，curl 需 `-L`；API 的 `[a TO b]` 需 `-g` 关闭 glob；单个请求偶发挂起，必须设 `--max-time`；遵守 3 秒间隔。
5. **旧式 id 的论文也有 HTML**（2026-09-05 curl 核实 Codex #9 的评论）：`/html/hep-th/9901001` 返回完整的 LaTeXML 页面（`article.ltx_document`，标题 "String Junctions and Their Duals…"），`/html/math/0601001` 同样 200。`paperIdFromUrl` 因此要收 `archive[.subject]/YYMMNNN[vN]`。

## 2. 规则覆盖率审计

方法：`pnpm fixtures:stats` 用 happy-dom 解析 10 篇 fixture，规则从 `src/core/rules/latexml.ts`（`RULES_VERSION 0.1.0-phase0`，DESIGN.md §5.1 / §5.2 逐条录入）导入，对翻译根 `article.ltx_document` 内每个非空白文本节点向上找最近的跳过规则祖先 S 与翻译单元祖先 U，归为四类：`unit`（在单元内、无跳过）、`protected`（S 在 U 内部，即块内受保护节点）、`skipped`（S 在 U 之上或无 U）、`uncovered`（两者都无）。完整报表见 `docs/phase0/rules-audit.md`（生成物）。

### 2.1 总览

| fixture | 解析 ms | 文本节点 | unit | protected | skipped | uncovered |
|---|---|---|---|---|---|---|
| 2312.17141 | 238 | 18375 | 19.6% | 51.2% | 29.1% | 14 |
| 2312.17527 | 53 | 4294 | 21.9% | 47.9% | 30.2% | 0 |
| 2401.00418 | 189 | 20524 | 14.5% | 82.4% | 3.2% | 0 |
| 2401.00596 | 53 | 4044 | 49.4% | 47.7% | 3.0% | 1 |
| 2410.00260 | 41 | 1750 | 52.9% | 25.9% | 21.1% | 2 |
| 2507.00150 | 51 | 3551 | 49.1% | 49.7% | 0.8% | 13 |
| 2608.29808 | 121 | 5891 | 59.3% | 10.5% | 30.2% | 0 |
| 2608.30667 | 3 | 4 | 50.0% | 25.0% | 25.0% | 0 |
| 2609.00245 | 618 | 37556 | 12.9% | 49.6% | 37.5% | 0 |
| 2609.00246 | 263 | 16279 | 26.9% | 30.6% | 42.4% | 3 |

2026-09-05 为 side 模式版式回归又抓了两篇（未入上表的统计）：2609.04056（math.OC，定理里只含公式的列表项、右侧沟槽的致谢块）、2609.03768（physics.comp-ph，表格 + 脚注在单列 flex 图里），见 `tests/fixtures/arxiv/README.md`。

合计 112,268 个文本节点，漏网 33 个（0.03%）。happy-dom 解析 1.8 MB 页面 618 ms，可直接用于 Vitest。`protected` 占比高是因为 MathML 内部的 `mo` / `mi` / `mn` / `annotation` 都算文本节点。

### 2.2 (a) 规则中不存在于任何 fixture 的选择器

所有规则都有匹配元素，但 `.ltx_author` 与 `.ltx_date` 在 10 篇里**从未出现**（authors 规则靠同一选择器里的 `.ltx_authors` / `.ltx_contact` 命中）。真实的作者区类名是 `.ltx_authors > .ltx_creator > .ltx_personname` / `.ltx_author_notes` / `.ltx_role_affiliation` / `.ltx_contact`，日期是 `.ltx_dates`（3 篇）。

### 2.3 (b) 漏网文本

33 个节点全部在 frontmatter / backmatter，正文段落零漏网：

| 结构 | 节点 | 处理建议 |
|---|---|---|
| `div.ltx_acknowledgements`（含内部 `.ltx_text`、`a.ltx_ref.ltx_url`） | 12 | 新增翻译单元 |
| `.ltx_pubnotes.ltx_pubnotes_meta > .ltx_pubnote.ltx_role_{ccs,doi,journal,number,publicationmonth}`（ACM 模板的出版元数据，带 `.ltx_note_name` 标签） | 12 | 新增跳过规则 `.ltx_pubnotes` |
| `div.ltx_dates` | 3 | 跳过（替换规则中不存在的 `.ltx_date`） |
| `sup.ltx_note_mark` 直接位于 `.ltx_note.ltx_role_footnotetext` 下 | 2 | `.ltx_note_mark` 进受保护列表（见 2.5） |
| `div.ltx_keywords`（含 `.ltx_text` 子节点） | 2 | 新增翻译单元 |
| `div.ltx_subtitle` | 1 | 并入标题规则 |
| `svg foreignObject > .ltx_foreignobject_content`（TikZ 图内文字） | 1 | 跳过整个 `svg` |

### 2.4 规则冗余与优先级

同一单元元素同时命中多条规则的组合：`p+theorem` 30,607、`p+item+theorem` 9,626、`p+item` 1,830、`p+abstract` 150。§5.1 的 `.ltx_abstract .ltx_p`、`.ltx_item .ltx_p`、`.ltx_theorem .ltx_p, .ltx_proof .ltx_p` 三条**完全被 `.ltx_p` 覆盖**，作为独立规则违反"恰好一条"。建议删除，或改为上下文标记（给 prompt 提供"这是定理/摘要"的信息），不参与块判定。

### 2.5 §6.1 受保护节点必须进规则表

审计只用了 §5.2 的跳过规则，结果暴露出 §6.1 列出的 void 节点目前会被当作段落正文：

| 元素 | 有直接文本的元素数 | 说明 |
|---|---|---|
| `a.ltx_ref`（含 `span.ltx_ref_tag.ltx_text`） | 1045 + 1639 | 交叉引用 "Section 2"、"Theorem 1" 及其编号 |
| `cite.ltx_cite.ltx_citemacro_*` | 713 | 引用标记 |
| `sup.ltx_note_mark` | 112 | 脚注标记，在 `.ltx_note` 外层与 `.ltx_note_content` 内层各出现一次 |

它们要作为 void 占位符写进 `latexml.ts`（`PROTECT_RULES`），与 `.ltx_tag`、`math`、`code`、`.ltx_font_typewriter` 同级。另一个结构性发现：**脚注是嵌套块**——`.ltx_note`（含 mark + `.ltx_note_outer > .ltx_note_content`）整体位于 `.ltx_p` 内部，而 `.ltx_note_content` 本身是翻译单元。提取时外层段落应把整个 `.ltx_note` 视为 void 占位符，脚注正文单独成块；`.ltx_note_content` 内的第二个 `.ltx_note_mark` 与 `.ltx_note_type`（"footnotemark:"，仅 1 篇）作 void。

### 2.6 表格单元格与 §5.3 数值格正则

`scripts/phase0/td-numeric-calib.ts` 对 5,487 个 `.ltx_td` 统计（排除 MathML 子树后的可见文本）：空格 271、纯公式 294、命中初稿正则 3,236（59%）、散文 1,686。初稿正则有两个问题：

- **误判**：字符类里的 `e` / `E`（为指数准备）让以 E 开头的词整体匹配——`ERROR` 90 次、`Esp`、`ESBMC`。修法：要求至少一个数字（前置断言 `(?=.*\d)`）。
- **漏判**：`✓` 167 次、`N/A` 17 次、单字母 `G` / `N` / `Y` / `S`、带括号单位 `(kpc)`、`Au+Au`。修法：增加"纯符号"分支（`✓ ✗ ✔ ✘ – — −`）和 `N/A`。

另有 427 个大写枚举值 `TRUE` / `FALSE` / `UNKNOWN`（单篇）——这是值不是散文，但正则无法与缩写词区分，交给 provider 处理即可（LLM 会保留）。建议的正则：`^(?=.*\d)[\s\d.,+\-±×^%()/*eE−–—:;~<>=≤≥∼]+(\s*[a-zA-Zμ°%]{1,4})?$` 或 `^[✓✗✔✘–—−\-·×*]+$` 或 `^N/A$`。带单位的 `7.7 GeV` 之类命中正确。

### 2.7 代码与算法框

- listing 容器类是 `.ltx_listing`（有时叠加 `.ltx_lstlisting`、`.ltx_lst_language_*`），行是 `.ltx_listingline`，行号是 `.ltx_tag.ltx_tag_listingline`。`.ltx_listing_data`（隐藏的原始代码数据）需要跳过。
- 算法框 `figure.ltx_float.ltx_algorithm`（2 篇）/ `.ltx_float_algorithm`（1 篇）内部是 `.ltx_listingline`，已被 code 规则覆盖；框内 `.ltx_caption` 正常翻译。
- `.ltx_verbatim` 2 篇，`pre` / `code` 标签未在正文中单独出现（等宽文本都是 `.ltx_text.ltx_font_typewriter`，2,488 个元素）。

### 2.8 (c) 类名分布

翻译根内共 255 个 `ltx_*` 类名，仅 2 个（`ltx_Math`、`ltx_p` 级别的基础类）在全部 10 篇出现；长尾主要是模板相关（ACM 的 `ltx_affiliation_*`、`ltx_role_*`）、bibliography 细分（`ltx_bib_*` 20 余个，只在 2609.00246）、定理种类（`ltx_theorem_*`）、listing 语言（`ltx_lst_language_*`）。这些都在已有单元内部，不需要单独规则。因所有 fixture 同为 oxide 0.7.6，此表反映的是内容分布而非版本差异。

### 2.9 SVG 图占比（§15.1）

翻译根内 `svg` 共 164 个，全部是 `svg.ltx_picture`（TikZ），其中 2608.29808 占 114、2312.17141 占 43（大多带 `ltx_markedasmath`，是画出来的公式）；**没有一个含 `<text>`**，文字只以 `foreignObject > .ltx_foreignobject_content` 形式出现且全部 fixture 仅 1 个文本节点。位图 `img.ltx_graphics` 共 13 个（5 篇）。结论：SVG 图在实践中没有可翻译的 DOM 文字，v1 整体跳过 `svg`；§15 的 OCR 路线只对 `img` 有意义。

### 2.10 其他

- `.ltx_p` 不一定是 `<p>`：`span.ltx_p` 57 个（2 篇，出现在表格与 inline-block 内）。§7.1 "标签名与原块相同"已覆盖；§7.2 的 grid 技巧只能用于 `.ltx_para > p.ltx_p`，其余降级为 stack。
- 翻译根之外的文本只有 `.ltx_page_navbar` 内的目录（`ltx_ref_title`、`ltx_tag_ref`、目录标题里的 math / italic）与 arXiv 页头页脚，验证了"根外一律不提取"。
- 转换失败页 `2608.30667`：4 个文本节点，2 个 unit，脚本无异常；扩展应能在这类页面上安静工作。

### 2.11 RULES_VERSION 0.2.0 复跑（Phase 1 `feat/rules`）

审计脚本改为直接调用规则模块的 `classify()`（优先级 skip > table > unit > protect，`.ltx_note` 作 protect-but-descend），报表已重生成到 `docs/phase0/rules-audit.md`：

- **漏网 0 / 112,268**：致谢、关键词、副标题进 unit；出版元数据、日期、SVG 进 skip；`.ltx_note_mark` 进 protect。
- 无死规则；unit 规则两两互斥（`multi` 为空），"恰好一条"成立。
- 归属变化：`.ltx_ref`（3,253 个文本节点）、`.ltx_cite`（1,872）、`.ltx_note_mark`（114）从段落正文转为受保护节点；表格单元格 4,632 个文本节点归到 `table`；脚注正文 166 个归到嵌套单元 `footnote`，`.ltx_note` 容器本身归属 0。
- unit 占比因此下降（如 2401.00596 从 49.4% 到 26.6%），这是把引用与脚注标记从"待翻译文本"里剔除后的真实数字。

### 2.12 用 CSS 类清单反查规则覆盖（2026-09-04）

起点是一个假设：ar5iv 的 CSS 覆盖了所有区块，可以拿它把规则补全。**实测这个假设不成立。**

把 LaTeXML 仓库 `lib/LaTeXML/resources/CSS` 下全部 15 个样式表（含 `ltx-book.css`、`ltx-amsart.css`、`ltx-apj.css` 等模板专用）、ar5iv 仓库与 arXiv 实际服务的两份合起来，共 **322 个 `ltx_*` 类**。再从 8 个学科抓 20 篇新论文比对：

- **88 个类出现在页面里而所有 CSS 都没有**，且不是边角料：`ltx_Math` 20/20 篇、`ltx_ref_tag` 20/20、`ltx_tag_bibitem` 20/20、`ltx_math_unparsed` 18/20、`ltx_citemacro_cite` 17/20、`ltx_theorem_*` 与 `ltx_bib_*` 两个家族
- 原因是**类名是开放集合**：`ltx_theorem_maintheoremA`、`ltx_theorem_manualconjectureinner`、`ltx_bib_<字段>`、`ltx_citemacro_<宏名>`、`ltx_colspan_8` 都由作者自己的 LaTeX 宏名生成，任何样式表都列不全
- 反方向 **145 个类只在 CSS 里有**，是书稿 / CV / 索引 / 题记等模板专用结构，30 篇真实论文里一次没出现

覆盖率检查（用 `classify()` 逐文本节点判定归属）：**20 篇新论文 + 10 篇 fixture 共 36348 个带文字的节点，未覆盖 1 个**，就是数学论文的 MSC 分类号（`.ltx_classification`），本来也不该翻。

结论：规则不是靠枚举类名做全的，而是靠"容器不需要规则、文本落在 `.ltx_p` 等少数单元里"这个结构性质。CSS 清单的价值在于第三条——那 145 个没见过的结构，已按 LaTeXML 的输出惯例写成 `tests/fixtures/arxiv/synthetic-structures.html`，一跑就暴露出 8 处真实缺口（`.ltx_date`、`.ltx_role_dedicatory`、description 术语的裸文本、`.ltx_marginpar`、`.ltx_indexentry`、CV 字段），已补进规则。

原先报告的漏翻（作者区的致谢性注释）与规则完整性无关，是 §5.2 里"作者区整块跳过"这条策略造成的，已在同一次修订里改为默认翻译。

---

## 3. 容器与导航

### 3.1 页面骨架（oxide 0.7.6 + arXiv 主题 2026-08）

```
body                                  ← ≥1280px 时 display:grid（见 3.2）
├─ header.arxiv-html-header           ← arXiv 注入：logo、nav.html-header-nav
├─ nav.ltx_page_navbar                ← LaTeXML 导航栏，内含 nav.ltx_TOC
├─ div.ltx_page_main
│  └─ div.ltx_page_content
│     └─ article.ltx_document         ← 论文正文，max-width: var(--main-width)
├─ footer.arxiv-html-footer           ← arXiv 注入
├─ footer.ds-site-footer              ← arXiv 注入（站点页脚）
└─ 其他 arXiv 注入：#infobox、#watermark-tr、.keyboard-glossary、#fixed-buttons-container、
   报告问题 modal（.modal-header / .modal-body / .modal-footer，表单 #modal-form）、.ds-announcement
```

主容器判定：以 `article.ltx_document` 为翻译根，`.ltx_page_navbar` 与所有非 `ltx_` 前缀的注入元素一律不进入提取。

### 3.2 宽度控制（决定 side 模式做法）

- 唯一的宽度来源是 CSS 变量 `--main-width`，在 ar5iv 样式的 `:root` 中定义为 `52rem`。
- `.ltx_document { max-width: var(--main-width) }`；`.ltx_page_main { width: 100% }`（不限宽）。
- arXiv 主题在 `@media (min-width: 1280px)` 下把 `body` 设为 `display: grid; grid-template-columns: 1fr var(--nav-width) var(--main-width) var(--nav-width) 1fr`，`--nav-width: minmax(14rem, 25rem)`；`div.ltx_page_main` 落在 `article` 区域，`nav.ltx_page_navbar` 落在 `nav` 区域。
- 因此 **side 模式只需在 `html[data-axt-mode="side"]` 上覆盖 `--main-width`**（如 `min(1600px, 96vw)`），文章列与 `.ltx_document` 同时变宽，无需碰 `.ltx_page_main`。
- 副作用：`--main-width` 还被图片（`.ltx_graphics`、`.ltx_img_*`）、代码块 `.ltx_listing`、单元格 `.ltx_td` 的 `max-width` 以及 ≥96rem 时脚注的绝对定位（`--main-width-margin`）引用，变量放大后这些也会跟着放大。图片变宽通常是可接受的；若不希望，可在 side 模式下把这些规则的 `max-width` 钉回 `52rem`。
- 断点：arXiv 主题 1280px（导航栏/页头折叠，JS 里 `narrowViewport` 同值）；ar5iv 样式另有 46/52/96/109rem 断点，其中 96rem 决定脚注是弹出还是边注。DESIGN.md §7.2 的 1100px 自动降级阈值与这两套断点都不对齐，建议改为 1280px 与 arXiv 一致。

### 3.3 arXiv 自带 JS 的行为（`/static/browse/0.3.4/js/arxiv-html-papers-*.js`，268 行）

- 只触碰三处 DOM：`html` 的 `data-theme` / `data-toc-display` / `data-reading-mode` 属性（偏好存 localStorage：`ar5iv_theme`、`arxiv_html_paper_toc_display`、`arxiv_html_paper_reading_mode`）；`.ltx_page_navbar > nav.ltx_TOC` 的显示切换；`.ltx_page_content` 上的 `mouseup` 监听，把选区 `innerHTML` 存起来供"报告问题"表单使用。
- **没有** MutationObserver，**没有** MathJax（页面 0 次出现，公式是原生 MathML），**没有** 脚注 JS。
- 脚注弹出纯 CSS：<96rem 时 `.ltx_note:focus-within > .ltx_note_outer` 弹出；≥96rem 时 `.ltx_note.ltx_role_footnotetext .ltx_note_outer` 绝对定位成边注。译文克隆脚注标记后，克隆体同样能触发弹出（结构相同即可），无需额外处理。
- 冲突面：几乎没有。唯一交集是用户选中译文后点"报告问题"，选区 HTML 会带上 `.axt-t` 节点，无害。
- 页头脚本 `arxiv-header.js` 只管站点横幅与公告，与正文无关。
- 页面内联 `<script>` 只做上述偏好属性的早期恢复；内联 `<style>` 仅 535 字节。

### 3.4 阅读模式与我们的模式的关系

arXiv 的 `data-reading-mode=enabled` 会隐藏 `header.arxiv-html-header` 与 `.ltx_page_navbar`。我们的 side 模式如需隐藏导航栏，直接设 `html[data-axt-mode="side"] .ltx_page_navbar { display:none }` 即可，不要写 arXiv 的属性（那会被它持久化到 localStorage）。

### 3.5 列表与多面板图的站点规则（2026-09-05，`ar5iv.0.9.1.min.css`）

样式入口 `/static/browse/0.3.4/css/arxiv-html-papers-20260823.css` 只有两行 `@import`：`ar5iv.0.9.1.min.css` 进 `layer(ar5iv)`，`arxiv-html-papers-theme-20260807.css` 进 `layer(arxiv-theme)`（抓取要 `curl -L`）。与 side 模式列表排版直接相关的：

- `li.ltx_item > .ltx_tag { display: inline; margin-inline-start: -2.5rem; padding-inline-end: .5rem; text-align: end }`——itemize 的标记悬挂 2.5rem，modes.css 里标记槽的 2.5rem 由此而来
- `.ltx_enumerate { display: grid; grid-template-columns: max-content minmax(0, 1fr); column-gap: .5em; padding-inline-start: 0 }`，`.ltx_enumerate > .ltx_item { display: grid; grid-template-columns: subgrid; grid-column: 1 / -1 }`——enumerate 的编号列按**内容宽度**，长标签（"(Assumption 1)"）在原版式里不会溢出；我们固定 2.5rem 的绝对定位槽会（Codex #25），但站点**没有** `--ltx-enum-leftmargin` 之类的变量可取，按变量取宽的提议不成立
- 嵌套列表的缩进只有 `.ltx_item > .ltx_para > :is(.ltx_enumerate, .ltx_itemize, .ltx_description) { margin-inline-start: var(--space-xs) }` 加内层自己的编号列；side 模式把标记改成绝对定位后这一层缩进丢了（Codex #25，2609.00245 的 (k.i) 列表），留给真实浏览器布局测试那批一起处理

与 side 模式**宽度契约**直接相关的（2026-09-05 补，DESIGN §7.2）：

- 主题 `body { grid-template-columns: 1fr var(--nav-width) var(--main-width) var(--nav-width) 1fr; grid-template-areas: "... . nav article . ." }`，`--nav-width: minmax(14rem, 25rem)`；第 4 列无命名区域。实测原生：1280px 时 `0 224 832 224 0`，≥ 1800px 时导航封顶 400
- `.ltx_page_content { margin: 1rem }`（主题覆盖 ar5iv 的 `var(--space-xl) var(--space-sm)`）——文章列减 2rem 才是两栏可用宽
- ar5iv 右侧沟槽：`.ltx_note_outer` 只在 `@media (width >= 96rem)` 显示（`float: inline-end; padding-inline-end: 3rem; position: relative`），宽度按断点写死：`96rem < width <= 109rem` 为 `width: 20rem; margin-inline-end: -24rem`，`> 109rem` 为 `27rem / -31rem`；`< 96rem` 时 `display: none`，`:focus-within` 弹出。`.ltx_note.ltx_role_footnotetext .ltx_note_outer { position: absolute; inset-inline-start: var(--main-width-margin) }`（`--main-width-margin: 54rem`，全站只有这一处用它）
- `.ltx_pubnotes.ltx_pubnotes_meta .ltx_pubnotes_content { float: inline-end; width: min(27rem, calc((100vw - var(--main-width)) / 2 - 2rem)); margin-inline-end: calc(1rem - (100vw - var(--main-width)) / 2) }`；`.ltx_note.ltx_note_frontmatter.ltx_role_thanks` 同样的宽度，`position: absolute; inset-inline-end: calc(1rem - (100vw - var(--main-width)) / 2)`（参照文章盒子右缘）；作者区 `.ltx_authors ... :last-child.ltx_role_affiliation / .ltx_role_address { position: absolute; width: min(var(--main-width), 100dvw); inset-inline-start: max(0px, calc((100dvw - var(--main-width)) / 2)) }`。四组都假设文章居中、两侧沟槽等宽
- 主题 `@media (max-width: 1279px)` 把导航栏改成 `position: fixed` 的抽屉（与 `responsive.ts` 切 stack 的断点一致）
- `ltx_flex_size_N`：LaTeXML 给 flex 图格子标的份数，`size_1` 整栏、`size_2` 半栏、`size_3` 三分之一栏；fixture 里 21 个 size_1、13 个 size_2/3，单列 flex 图（所有格子都是 size_1）常见于表格加脚注（2609.03768v1 的 Table 1）

## 4. 参考文件地图（DESIGN.md §4 各模块）

仓库在 `reference/`（gitignore，只读）：kiss-translator@c95bd46、read-frog@9b44f82、FluentRead@536a819。核心模块只借鉴设计思路。

| 模块 | 参考 |
|---|---|
| `rules` / `extractor` | Read Frog `src/utils/host/dom/filter.ts`（块/行内节点判定的一整套谓词）、`dom/traversal.ts`（`walkAndLabelElement`）、`translate/core/translation-walker.ts`。KISS `src/libs/rules.js` 是站点规则订阅体系，v1 不需要 |
| `protector`（占位符） | KISS `src/apis/trans.js`（`genSystemPrompt` / `genUserPrompt`，placetag 思路）与 `src/libs/translator.js`；Read Frog `translate/html-attribute-markers.ts`（标记完整性校验，`assertHtmlAttributeMarkerIntegrity`）、`translate/translation-output-normalization.ts` |
| `renderer` | Read Frog `translate/core/translation-modes.ts`（双语 / 仅译文两条路径）、`translate/dom/translation-text-swap.ts`（仅译文模式的原文快照与校验回滚）、`translate/dom/translation-insertion.ts`、`translate/dom/translation-cleanup.ts`；FluentRead `src/features/full-page-translation/content/renderer.ts`、`layout.ts` |
| 译文样式预设 | KISS `src/config/styles.js`（18 种预设常量）、`src/libs/style.js`（`builtinStylesMap`）、`src/hooks/CustomStyles.js` |
| `scheduler` | FluentRead `src/features/full-page-translation/content/runtime.ts`（IntersectionObserver 渐进翻译，含无布局盒目标的处理）、`content/viewportStability.ts`、`src/services/translation/requestScheduler.ts`、`queue.ts`；Read Frog `src/utils/request/request-queue.ts`、`batch-queue.ts`、`retry-policy.ts`（429 退避策略）、`src/entrypoints/background/translation-queues.ts` |
| `providers`（LLM） | Read Frog `src/utils/providers/model.ts`（AI SDK 模型工厂）、`src/entrypoints/background/llm-generate-text.ts`、`translate/api/ai.ts`；KISS `src/apis/trans.js`（`genOpenAI` / `genClaude` / `genGemini` 的请求拼装） |
| `google-gtx` / `translateHtml` | Read Frog `translate/api/google-legacy.ts`（gtx）、`translate/api/google.ts`（translateHtml）；KISS `src/apis/trans.js`（`genGoogle` / `genGoogle2`）、`src/config/api.js`（端点表） |
| `chrome-builtin` | KISS `src/libs/builtinAI.js`（`Translator.availability` / `create` 的封装与降级） |
| `cache` | FluentRead `src/services/translation/cache.ts`（键规范化、TTL、容量上限、内存热层 + Dexie）、`src/app/background/handlers/translationCache.ts`；Read Frog `translate/in-memory-translation-cache.ts`；KISS `src/libs/cache.js`、`cacheDigest.js` |
| `config` | Read Frog `src/utils/config/storage.ts`、`migration.ts`、`migration-scripts/`（带版本号的迁移函数） |
| UI / Shadow DOM | Read Frog `src/entrypoints/side.content/index.tsx`、`selection.content/index.tsx`（WXT `createShadowRootUi`）；FluentRead `entrypoints/shadowBridge.content.ts` |
| WXT 工程配置 | Read Frog `wxt.config.ts`、`vitest.config.ts` |

## 5. 免费接口存活性（2026-09-03）

| 接口 | 状态 | 返回格式 | 标签保留 |
|---|---|---|---|
| Google gtx `GET translate.googleapis.com/translate_a/single?client=gtx&dt=t&dj=1&sl=en&tl=zh-CN&q=…` | 200 | `{sentences:[{trans,orig,backend}], src, spell}`；多句时需拼接 `sentences[].trans` | **保留**。样本：5 个 void `<x id="n"/>`、paired `<t id="1">…<x id="2"/>…</t>` 嵌套，全部 id 无增无减、嵌套合法、位置合理 |
| Google translateHtml `POST translate-pa.googleapis.com/v1/translateHtml` | 200 | 请求 `[[[texts…], from, to], "wt_lib"]`，header `Content-Type: application/json+protobuf` + `X-Goog-API-Key`（KISS 配置内置的公开 key，见 `reference/kiss-translator/src/config/api.js`）；返回 `[[trans…]]`，天然支持批量 | 保留，但语义位置差（首个样本把 `<x id="1"/>` 挪到句尾、`</em>` 吞掉句号），译文质量明显低于 gtx |
| 微软 `edge.microsoft.com/translate/auth` → `translatetext` | auth 404，翻译 401 | — | 未测。Read Frog 仍在用该端点，可能需要特定 header；v1 不接，仅记录 |

**对 DESIGN.md 的含义**：gtx 在样本中可靠保留了占位符，`google-gtx` 有条件声明 `preservesMarkup: true` 走 markup 路径，由 validator 兜底（失败再降级 runs）；translateHtml 不值得作为独立 provider。见 §7。

## 6. Chrome 内置 Translator API（2026-09-03，Chrome 152，macOS）

探测脚本 `scripts/phase0/translator-probe.js`（本次通过 Claude in Chrome 在 `arxiv.org/html/2410.00260` 页面主世界执行，逻辑相同）。

### 6.1 可用性与用户手势

| 步骤 | 结果 |
|---|---|
| `'Translator' in self` / `'LanguageDetector' in self` | 均为 `true`；`isSecureContext` true |
| `Translator.availability({en→zh})` 初始 | `downloadable`（en→ja / de / fr / zh-Hant / ko 同样 `downloadable`，语言包按语言对独立下载） |
| 无手势 `create()`（模型未下载） | 抛 `NotAllowedError: Requires a user gesture when availability is "downloading" or "downloadable"` |
| 带手势 `create()`（模拟点击，`navigator.userActivation.isActive === true`） | 成功，耗时 **66.9 s**（即语言包下载）；**下载期间 `availability()` 一直返回 `downloadable` 而非 `downloading`** |
| 下载完成后再次 `create()` | 8.6 s，`monitor` 收到 15 个 `downloadprogress` 事件（`loaded` 0→1，`total` 为 1，即归一化进度），说明二次 create 仍有一段本地加载 |
| 模型就绪后无手势 `create()` | 成功，1 ms；`availability()` 为 `available` |
| `LanguageDetector.availability()` | `available` |

**结论**：用户手势只在需要下载语言包时才必需。扩展的 `isAvailable()` 应以 `availability()` 为准：`available` → 直接可用；`downloadable` → 需要在 popup 的点击处理函数里调用 `create()` 触发下载，并向用户展示进度（`monitor` 只在下载已完成后的 create 里给出进度事件，首次下载期间进度事件为空，需用"正在下载"的不确定态提示）。

### 6.2 翻译行为（模型就绪后）

| 输入 | 耗时 | 输出 |
|---|---|---|
| 纯文本一句 | 9 ms | 「当图表连接时，定理 1 的证明是微不足道的。」 |
| 含 `<a href="#x">`、`<em>`、`<x id="1"/>` | 15 ms | 三种标签全部保留，`href` 与 `id` 原样；标签内文字被翻译且小写化（"theorem 1"） |
| 5 个 void 占位符 | 19 ms | 全部保留、顺序正确 |
| paired 嵌套 void | 15 ms | 嵌套合法，id 无增无减 |
| 四句整段（约 90 词） | 18 ms | 逐句翻译，质量可读；句间产生「。 」（句号后多一个空格），需归一化 |
| `inputQuota` / `measureInputUsage()` | — | `null` / `0`，无配额限制信号 |

**对 DESIGN.md 的含义**：`chrome-builtin` 在所有样本中保留了占位符与 HTML 标签，与 gtx 一样有条件声明 `preservesMarkup: true`，runs 路径只作 validator 失败后的兜底；单句延迟 10–20 ms，远快于任何网络引擎，适合作为视口内首屏的即时引擎。

### 6.3 未覆盖

- ~~content script 的隔离世界是否同样暴露 `Translator`~~ **已实测（2026-09-05，Chrome 153）**：用一个只做探测的临时扩展（不改本项目源码）在 `arxiv.org/html/*` 注入 content script，隔离世界里 `'Translator' in self` 与 `'LanguageDetector' in self` 均为 `true`、`isSecureContext` 为 `true`、`Translator.availability({en→zh})` 与同页主世界同为 `downloadable`（en→ja 亦然）。Web API 确实不受 world 隔离影响，`chrome-builtin` 可以直接在 content script 里用。
- 语言包大小未测（Chrome 不暴露字节数，`total` 恒为 1）；67 s 的下载时长对应本机网络，仅作量级参考。

### 6.4 service worker 里也有 `Translator`（2026-09-05，Chrome 153，Playwright 装载当前构建）

Codex 在 #50 断言 MV3 的 background service worker 不暴露 `Translator`，据此推论 background 侧的可用性判断永远报「不可用」。实测相反：

| 上下文 | `'Translator' in self` | `Translator.availability({ en → zh })` |
|---|---|---|
| background service worker | true（function） | `downloadable` |
| popup 页面 | true（function） | `downloadable` |

worker 里的可用性结果与窗口上下文一致，`createStatusHandler` 在 background 判断 chrome-builtin 是否可用是准确的。仍然成立的边界：worker 里没有用户手势，语言包为 `downloadable` 时 `create()` 抛 `NotAllowedError`，所以下载入口只能放在 popup 的点击处理函数里（DESIGN §8.4）。

## 6.5 MV3 service worker 是当前延迟的根因（2026-09-04）

页面加载后要等几十秒才开始翻译，逐层测下来结论如下（日志见 content 的 `[axt] start:`）：

| 现象 | 数据 |
|---|---|
| `axt:ping` 往返（background 只回一个常量） | 投递 0–51 ms，SW 年龄 0 s |
| 紧接着的 `axt:provider-status`（无网络请求，只读配置 + 判断有没有 key） | 6.7 s / 13.5 s / 77 s（冷 worker），4 ms（热 worker） |
| 其中 handler 内部 | 6663 ms（投递 0 ms，回程 13 ms） |
| 翻译中途 | `Error: A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received` |

同一个刚启动的 worker 上，前一条消息 50 ms、后一条 6.7 秒，且 handler 内部没有任何 I/O。加上那条"通道在收到响应前关闭"的报错，指向 **MV3 的 service worker 在等待期间被挂起 / 回收**，与我们的代码无关。缓存写入扫全库（§9）确实是个真缺陷，也已修复，但不是这次延迟的根因，之前的判断作废。

**参考项目怎么绕开**：Read Frog 把 provider 的 `fetch` 放在 **content script**（`utils/host/translate/api/*.ts` 由 host content 调用），service worker 完全不在请求链路上。FluentRead 有 `platform/http/runtime.ts` 抽象，可替换 transport。

## 6.6 Google translateHtml 免费接口实测（2026-09-04，页面上下文）

端点与参数照 Read Frog `utils/host/translate/api/google.ts`：`POST https://translate-pa.googleapis.com/v1/translateHtml`，`Content-Type: application/json+protobuf`，`X-Goog-API-Key`（公开常量），body `[[[items...], from, to], "wt_lib"]`。

| 批量 | 耗时 | 结果 |
|---|---|---|
| 2 条 | 307 ms | 全部返回 |
| 20 条 | 183 ms | 全部返回 |
| 60 条 | 250 ms | 全部返回 |
| 150 条 | 556 ms | 全部返回 |

两个关键结论：

1. **可在页面 / content script 上下文直接调用**，响应带 CORS（`response.type === "cors"`），不需要经过 background。
2. **原样保留我们的占位符**：`Let <x id="1"/> be a <t id="2">connected</t> graph` → `让<x id="1"/>成为<t id="2">连接</t>图表`。void 与 paired 占位符、id 全部完好，所以它走 **markup 路径**，`preservesMarkup: true`，不需要 runs 兜底。DESIGN §8 里把 `google-gtx` 预设为 `preservesMarkup: false` 需要修订。

对比：一篇 159 块的论文用 LLM 走了 190 s，用这个接口按 150 条一批只需约 1 s。译文质量是机器翻译水准（"weights" 译成"重量"），适合大批量回归测试与首屏即时显示，不适合替代 LLM 做最终译文。

---

## 6.7 请求执行位置：content 侧 fetch 受 CORS 与混合内容双重约束（2026-09-05，issue #42）

**方法**：本地起两个只有 CORS 头不同、其余完全一样的 OpenAI 兼容端点（`/v1/chat/completions` 带 `Access-Control-Allow-Origin: *` 并应答预检；`/nocors/...` 不带任何 CORS 头），用 Playwright 装载一个探针扩展（`host_permissions` 覆盖端点），分别从 **background service worker**、**content script 隔离世界**、**页面主世界** 发同一个带 `Authorization` 头的 POST，服务端记录 Origin、预检与状态。探针在会话临时目录，不进仓库。

| 执行位置 | 端点带 CORS 头 | 端点不带 CORS 头 | 服务端看到的 Origin / 预检 |
|---|---|---|---|
| background service worker | 200 | **200** | `chrome-extension://<id>`，**没有预检** |
| content script（隔离世界） | 200（先发 `OPTIONS` 预检） | **`TypeError: Failed to fetch`** | 页面 origin（`http://localhost:8898`），预检发出、响应缺 CORS 头即失败 |
| 页面主世界 | 同 content script | 同 content script | 同上 |

再把页面换成真实的 `https://arxiv.org/html/...`、端点保持 `http://127.0.0.1`：页面里的 fetch 直接 `Failed to fetch`，**请求根本没有离开浏览器**（服务端日志为空），background 照常 200。这是混合内容拦截，在 CORS 之前生效，与端点有没有 CORS 头无关。

**结论**：
1. MV3 下 `host_permissions` **不会**解除 content script 的 CORS 约束：content 的请求带页面 origin、走预检，与页面主世界完全一致（Chrome 85 起的行为，官方文档 developer.chrome.com/docs/extensions/develop/concepts/network-requests）。
2. background 的请求带扩展 origin、不走预检，不带 CORS 头的端点也能用。
3. `https` 页面不能调 `http` 端点：本地 Ollama（`http://localhost:11434`）从 content 侧**不可达**，从 background 可达。CLAUDE.md 列出的 Ollama 在当前架构下只有设置页的连接测试（走 background）能通过，正式翻译（走 content）必然失败——两条路径行为不一致，正是 issue #42 指出的问题。
4. 对 OpenRouter / DeepSeek 这类公开 API，content 侧能否直连取决于对方是否长期给浏览器发 CORS 头，这是我们控制不了的外部条件；background 不依赖它。

**§6.5 的一处错误**：那节写「Read Frog 把 provider 的 fetch 放在 content script、service worker 完全不在请求链路上」。核对参考快照：`utils/host/translate/translate-text.ts:360` 通过 `sendMessage("enqueueTranslateRequest", …)` 把请求发给 background，`entrypoints/background/translation-queues.ts:490` 在 worker 里排队并真正调用模型——Read Frog 的请求**就是在 background 执行的**，只是把等待与队列也放在那里。§6.5 关于 worker 冷启动 6.7–77 s 的测量本身仍有效，但「参考项目怎么绕开」那段的依据不成立，DESIGN §8.0 引用它作为把请求移到 content 的理由之一也随之失效。

**冷启动延迟的重测（2026-09-05，Playwright + 当前 main 构建）**：从 popup 页面计时 `axt:ping`、`axt:provider-status`（冷 / 热）与 `chrome.storage.local.get`，四轮（启动后 + 三次闲置 36 s 后）全部落在 **0–5 ms**：

| 轮次 | 测前 worker 存活 | ping | provider-status 冷 | 热 | storage |
|---|---|---|---|---|---|
| 启动后 | 1 | 5 ms | 1 ms | 1 ms | 0 ms |
| 闲置 36 s ×3 | 1 / 1 / 1 | 1 ms | 1 ms | 0–1 ms | 0 ms |

两点结论：(1) `getConfig()` + `getProvider()` + `isAvailable()` 这条路径的**稳态成本约 1 ms**，§6.5 看到的 6.7–77 s 不是代码本身的开销；(2) **Playwright 环境里 worker 从不被回收**（三次闲置后存活数仍为 1——被调试器附着的 service worker 不受 MV3 空闲回收），CDP 的 `ServiceWorker` 域在浏览器级会话上也不可用，所以 §6.5 那种「冷 worker」在这里**造不出来**，三段拆分无法在自动化环境完成。**真实 Chrome 的冷启动重测（2026-09-06，Chrome 152，用户的浏览器，Claude in Chrome 驱动，构建 `c24ebbd`）**：关掉扩展的所有页面、闲置 40 s（超过 MV3 的 30 s 空闲回收），再重载论文页并读 content 日志。当前架构下 content 在启动路径上唯一发给 background 的消息是 `axt:cache-get`，所以「13 块全部命中缓存」的耗时就是**冷 worker 上一次消息往返 + IndexedDB 读**的上界：

| 轮次 | `start: ready` | `session idle`（13 块全部缓存命中） | 读缓存超时警告 / channel closed |
|---|---|---|---|
| 首次加载（热） | 33 ms | 1633 ms（13 请求，1 命中，走 google-web） | 无 |
| 闲置 40 s #1 | 4 ms | 77 ms | 无 |
| 闲置 40 s #2 | 22 ms | 81 ms | 无 |
| 闲置 40 s #3 | 21 ms | 77 ms | 无 |

三轮冷启动的 background 往返都在 80 ms 以内，1.5 s 的读缓存预算一次没触发。**§6.5 记录的 6.7–77 s 在当前代码上重现不出来**——那次测量发生在缓存写入还会扫全库的版本（§9 已修），而且当时 `provider-status` 走的是 background，现在启动路径根本不经过它。结论：worker 冷启动本身不是延迟来源，§8.0「把请求移到 content」的**延迟**理由不成立；它的 **CORS / 混合内容**代价则已被本节实测坐实。仍未覆盖：popup 打开时的 `axt:provider-status`（浏览器工具打不开 popup），需要用户手动确认冷启动后「翻译」按钮是否会灰几秒。

**顺带发现（同一次实测）**：用户的 Chrome 里存着 v7 配置（之前试过设置页分支的构建），而加载的构建是 v6 的，`@wxt-dev/storage` 报 `Version downgrade detected (v7 -> v6)` 拒绝迁移，`getConfig()` 校验失败回退默认值——API key 被静默忽略，链落到 google-web，用户看不出区别。这是 Codex 在 #52 指出的「一条术语让整份配置回退」的同一类问题，只是触发条件换成了「装了旧构建」。值得在 DESIGN §9 记一条：回退默认值时至少要在 popup 上显式提示，不能静默。

## 7. DESIGN.md 修订清单

按章节排列。每条只提建议，是否采纳由设计文档决定。

| # | 条目 | 建议 | 依据 |
|---|---|---|---|
| 1 | §5 整节 [待验证] | 选择器经 10 篇 fixture 校订，正文覆盖率 99.97%，可去掉 [待验证] 标记，按下列各条修订 | §2 |
| 2 | §5.1 `.ltx_abstract .ltx_p`、`.ltx_item .ltx_p`、`.ltx_theorem .ltx_p, .ltx_proof .ltx_p` | 完全被 `.ltx_p` 覆盖，删除；如需给 prompt 提供"摘要/定理"上下文，改为上下文标记而非块规则 | §2.4 |
| 3 | §5.1 新增翻译单元 | `.ltx_acknowledgements`、`.ltx_keywords`；`.ltx_subtitle` 并入标题规则 | §2.3 |
| 4 | §5.1 `.ltx_p` 的标签名 | 注明 `.ltx_p` 可能是 `<span>`（表格、inline-block 内），提取与渲染按类名不按标签名 | §2.10 |
| 5 | §5.1 / §6.1 脚注 | 脚注是嵌套块：`.ltx_note` 整体在段落内作 void 占位符，`.ltx_note_content` 单独成块；其内部的 `.ltx_note_mark`、`.ltx_note_type` 作 void | §2.5 |
| 6 | §5.2 `.ltx_author`、`.ltx_date` | 真实页面不存在。替换为 `.ltx_creator, .ltx_personname, .ltx_author_notes, .ltx_role_affiliation, .ltx_dates`；保留 `.ltx_authors`、`.ltx_contact` | §2.2 |
| 7 | §5.2 新增跳过规则 | `.ltx_pubnotes`（出版元数据）、`svg, .ltx_picture`（TikZ 图）、`.ltx_listing_data`（隐藏代码数据） | §2.3 / §2.7 / §2.9 |
| 8 | §5.2 "arXiv 注入的页头/页脚" | 不列选择器，改为"`article.ltx_document` 之外一律不提取"；导航栏 `.ltx_page_navbar` 也在根外 | §3.1 / §2.10 |
| 9 | §5.3 数值格正则 | 加 `(?=.*\d)` 修复 `ERROR` 类误判；加纯符号分支与 `N/A`。校准数据：59% 命中、31% 散文 | §2.6 |
| 10 | §5.5 / §14 LaTeXML 版本分叉 | 线上只有 oxide 0.7.6（历史文章已重转），无法用真实页面覆盖多版本。保留探测函数与分叉机制；"fixture 覆盖多年份"改为"fixture 记录生成器版本，版本变化时重抓" | §1 |
| 11 | §6.1 void 节点列表 | 确认 `.ltx_ref`（含 `.ltx_ref_tag`）、`.ltx_cite`、`.ltx_note_mark` 必须以规则形式写进 `latexml.ts`，否则会被当作段落正文（合计 3,500+ 个元素） | §2.5 |
| 12 | §7.2 宽度：覆盖 `.ltx_page_main` 的 max-width | 改为在 `html[data-axt-mode="side"]` 上覆盖 CSS 变量 `--main-width`；注意变量放大对图片、代码块、单元格与 ≥96rem 边注定位的连带影响 | §3.2 |
| 13 | §7.2 自动降级阈值 1100px | 改为 1280px，与 arXiv 主题断点对齐 | §3.2 |
| 14 | §7.2 grid 技巧适用范围 | 只对 `.ltx_para > p.ltx_p` 生效；`span.ltx_p`、表格内、inline-block 内降级为 stack | §2.10 |
| 15 | §8.1 `google-gtx` preservesMarkup: false [待验证] | 实测两组样本占位符全部保留、嵌套合法，建议改为 `true`，runs 路径退为 validator 失败后的兜底 | §5 |
| 16 | §8.3 translateHtml 新增 provider 的设想 | 可用但译文质量与占位符位置差于 gtx，不建议新增 | §5 |
| 17 | §8.1 `chrome-builtin` preservesMarkup: false | 实测保留 HTML 标签与 void / paired 占位符，建议同 gtx 改为 `true`；`isAvailable()` 以 `availability()` 为准，`downloadable` 时必须在用户手势（popup 点击）内调用 `create()` 触发下载，首次下载无进度事件、`availability()` 不变为 `downloading`，UI 用不确定态提示；译文需归一化「。 」 | §6 |
| 21 | §8.3 fallback 链默认顺序 | `chrome-builtin` 单句 10–20 ms 且离线，建议在模型已就绪时把它排在用户选定的 LLM 之前作为视口首屏的即时引擎，LLM 结果到达后替换（缓存键含 provider，两者不冲突）；是否采纳取决于对译文质量的取舍 | §6.2 |
| 18 | §11 fixture 覆盖多年份 | 改为"覆盖多领域与多结构"，年份不再是版本代理 | §1 |
| 19 | §14 arXiv 自身 JS 冲突 | 实测无冲突面（无 MutationObserver / MathJax / 脚注 JS，脚注弹出纯 CSS），风险可降为低 | §3.3 |
| 22 | §8 / §10 provider 请求跑在 background | 实测 MV3 的 service worker 会在等待中被挂起，一条无 I/O 的 `provider-status` 冷启动要 6.7–77 s，翻译中途出现"消息通道关闭"报错。建议照 Read Frog 把 provider 的 fetch 移到 content script，background 只保留缓存与配置 | §6.5 |
| 23 | §8 `google-gtx` 用 `translate_a/single`、`preservesMarkup: false` | 改用 Read Frog 的 `translate-pa.googleapis.com/v1/translateHtml`：实测保留占位符，`preservesMarkup: true`，批量 150 条 556 ms | §6.6 |
| 20 | §15.1 SVG 图文字按普通块翻译 | 实测 SVG 全是 TikZ `svg.ltx_picture`，无 `<text>`，foreignObject 文字极少。v1 整体跳过 SVG；OCR 路线只针对 `img.ltx_graphics` | §2.9 |
| 24 | §8.0 请求跑在 content script | 实测 content 侧 fetch 受 CORS 与混合内容约束（§6.7）：不带 CORS 头的端点、`http` 的本地端点（Ollama）从 content 不可达，从 background 可达；连接测试走 background、正式翻译走 content，两条路径行为不一致。且 §8.0 引用的「Read Frog 在 content 发请求」核对为误读。建议：抽离 transport，默认在 background 执行请求（无 CORS、无混合内容、key 不进页面世界），content 只保留调度；先按 issue #42 要求重测冷启动延迟的三段分布，确认 §6.5 的 6.7–77 s 不是我们自己的 storage / 初始化开销，再定 | §6.7 |
