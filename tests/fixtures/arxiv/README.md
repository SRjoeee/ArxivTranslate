# arXiv HTML fixtures

Phase 0 抓取的真实 `https://arxiv.org/html/<id>` 页面，原样保存（未做任何清洗），用于规则、占位符与渲染测试。
版权归各论文作者所有，此处仅作测试数据；抓取日期 2026-09-03。

抓取与统计脚本：`scripts/phase0/fetch-candidates.sh`（按类别 + 日期查 API 并下载）、`scripts/phase0/candidate-stats.sh`（特征计数）。
所有 fixture 的生成器均为 `LaTeXML oxide (version 0.7.6)`，包括 2023 年的论文——见 `docs/RESEARCH.md` §1。

| id | 提交日期 | 主分类 | 大小 | 特征计数（grep） | 选择理由 |
|---|---|---|---|---|---|
| 2312.17141 | 2023-12-28 | cs.PL | 1.5 MB | math 1971 · eqn 445 · thm 144 · proof 29 · svg 53 · listing 28 | 行内公式密集 + 定理/证明 + SVG 图 |
| 2312.17527 | 2023-12-29 | cs.PL | 315 KB | listing 65 · algo 3 · thm 36 · typewriter 115 · td 84 | 算法框与代码块 |
| 2401.00418 | 2023-12-31 | math.CO | 901 KB | math 1737 · td 823 · tabular 17 · thm 82 · proof 26 | 数学 + 大表格 |
| 2401.00596 | 2023-12-31 | hep-ph | 292 KB | note 15 · ref 511 · cite 248 · bib 89 | 脚注密集 + 引用/参考文献多 |
| 2410.00260 | 2024-09-30 | cs.CL | 246 KB | listing 19 · algo 1 · td 148 · typewriter 172 | 2024 中间年份；代码 + 表格 |
| 2507.00150 | 2025-06-30 | astro-ph.GA | 291 KB | td 700 · note 10 · math 421 | 2025；数值表 + 脚注 |
| 2608.29808 | 2026-08-30 | cs.CR | 886 KB | listing 241 · algo 5 · td 1899 · **ERROR 2** · svg 124 · typewriter 768 | 2026；代码/算法/大表/`.ltx_ERROR`/SVG 齐全 |
| 2609.00245 | 2026-08-31 | math.AP | 1.7 MB | math 2131 · eqn 446 · thm 148 · proof 41 · note 11 · ref 1827 | 2026；公式最密集 + 定理 + 脚注 |
| 2609.00246 | 2026-08-31 | cs.PL | 1.4 MB | td 1603 · listing 254 · typewriter 1457 · thm 60 | 2026；代码密集 + 大表格 |
| 2608.30667 | 2026-08-31 | cs.DS | 20 KB | **ERROR 2** · 仅 1 个 `.ltx_p` · 标题 "Untitled Document" | 转换失败页，边界用例（扩展不得挂掉） |

计数口径：`math`=`<math` 出现次数；`eqn`=`ltx_equation`；`listing`=`ltx_listingline`；`algo`=`ltx_float_algorithm|ltx_algorithm`；`td`=`ltx_td`；`note`=`ltx_note_content`；`thm`=`ltx_theorem`；`svg`=`<svg`。粗粒度 grep，仅用于选片，精确审计见 `docs/RESEARCH.md` §2。

## synthetic-structures.html（合成，非真实论文）

LaTeXML / ar5iv 的样式表里有 145 个类没在抓过的 30 篇真实论文里出现（书稿、CV、索引、题记等模板专用，见 RESEARCH.md §2.12）。
这份文件按 LaTeXML 的输出惯例把其中会带正文的结构各写一份：卷/章/小节标题、题记、引用块、description 列表、边注、
索引词条、CV 条目、子图说明、verbatim、算法框、转换错误提示。它守护的是"没见过的结构不会漏翻"，
新增结构时同时更新 RESEARCH.md §2.12。
