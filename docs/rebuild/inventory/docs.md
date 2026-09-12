<!-- Raw inventory written by a read-only agent on 2026-09-12 against main @ e6de3e1 — one merge before the v0.3.0-mvp baseline (8cfd771). PR #168 later touched src/core/rules/latexml.ts, src/core/extractor/index.ts, src/core/renderer/{index,pending,failed}.ts and src/styles/modes.css, so line numbers in those files have shifted slightly. Kept verbatim (Chinese) as the evidence behind docs/rebuild/INVENTORY.md, which lists the claims that were spot-checked. Delete this file when the rebuild retires the code it describes. -->

# docs audit — started 2026-09-11T20:36:20Z

工作树 HEAD=e6de3e1 == origin/main，干净。

## 1. 文档地图

| 文件 | 行数 | 用途 | 最近实质修改 | 被引用处（文件名 / 章节号） |
|---|---|---|---|---|
| `CLAUDE.md` | 220 | 项目级 agent 指令：技术栈、目录、硬规则、移植边界、工作流、Phase 0 任务、命令、agent skills | `ed456b3 2026-09-09 docs: qualify the run counts…` | DESIGN.md、RESEARCH.md、三份 superpowers plan/spec；代码注释 8 处（`config/schema.ts`、`config/services.ts`、`core/marks.ts`、`renderer/side-layout.ts`、`rules/latexml.ts`、`scheduler/title.ts`、`providers/microsoft.ts`、`tests/rules/selector-boundary.test.ts`，多为引用「硬规则 N」） |
| `CONTEXT.md` | **不存在** | CLAUDE.md §Domain docs 与 `docs/agents/domain.md` 声称的「仓库根 CONTEXT.md + docs/adr/」 | — | 仅 CLAUDE.md、docs/agents/domain.md 提到；`docs/adr/` 目录同样不存在 |
| `docs/DESIGN.md` | 1015 | 唯一事实来源（自称）：范围、块模型、规则、占位符、三模式渲染、provider、缓存、调度、测试、阶段计划、图片翻译 | `7b6ab60 2026-09-12 docs(design): the guided install moves into the popup…` | 代码 / 测试里 `§N.N` 引用约 **560 处**（§7.1 58、§7.2 30、§15.5 29、§10 25、§8.6 18…），覆盖 src 下几乎每个模块；`helper/README.md`、`helper/main.swift` 也引 |
| `docs/RESEARCH.md` | 767 | Phase 0 实测结论 + 后续实测（选择器校订、参考文件地图、接口存活、Translator API、MV3 存活、CORS、SVG 字形） | `265689e 2026-09-09 docs(research): say what the space-glyph ratio…` | DESIGN.md 大量引用；代码 `rules/latexml.ts`、`svg/glyphs.ts`、`svg/runs.ts`、`google-web.ts`、`renderer/responsive.ts`；`tests/fixtures/arxiv/README.md`、`tests/rules/latexml.test.ts` |
| `docs/UI.md` | 382 | UI 契约（popup / 设置页 / 语言 / 状态机 / 需求编号 S-P-xx 等） | `b053887 2026-09-12 docs(ui): the displayed name keeps its space…` | DESIGN.md §4.0b、两份 plan、spec；代码 30 处（popup / options / locales / ui / strings / e2e）以 `UI.md §N` 引用 |
| `docs/THIRD_PARTY.md` | 38 | GPL §5 来源登记表 | `020e42e 2026-09-11 feat(renderer): a skeleton…` | CLAUDE.md、DESIGN.md §12/§13、`styles/presets.css` |
| `docs/agents/codex-review.md` | 83 | Codex 审查流程与信号 | `67711a5 2026-09-09 docs: size PRs by measured review cost…` | CLAUDE.md、popup plan |
| `docs/agents/domain.md` | 51 | 领域文档布局（CONTEXT.md + ADR） | `eccef7a 2026-09-03 初始提交`（从未改过） | 仅 CLAUDE.md |
| `docs/agents/issue-tracker.md` | 45 | GitHub Issues 用法 | `eccef7a 2026-09-03 初始提交` | 仅 CLAUDE.md |
| `docs/agents/triage-labels.md` | 15 | 五个 triage 标签 | `eccef7a 2026-09-03 初始提交` | 仅 CLAUDE.md |
| `docs/phase0/rules-audit.md` | 656 | Phase 0 规则覆盖率审计脚本的生成报告 | `c38ddf0 2026-09-04 fix(rules): stop double-translating…` | CLAUDE.md、RESEARCH.md |
| `docs/superpowers/plans/2026-09-07-popup-ui.md` | 1447 | popup 重建实施计划（Phase 1 UI 集成分支用） | `cc48ee1 2026-09-10 docs(ui): sync the contract and plan…` | 无人引用 |
| `docs/superpowers/plans/2026-09-10-settings-services-appearance.md` | 587 | 设置页（服务 + 外观）实施计划 | `bfaa3b2 2026-09-10` | UI.md 引用其 spec |
| `docs/superpowers/specs/2026-09-10-settings-services-appearance-design.md` | 223 | 设置页设计 spec | `b3458da 2026-09-10` | UI.md、对应 plan |
| `docs/brand/store-icon-128.png` | 二进制 | 商店图标 | `a9473c5 2026-09-11` | — |

合计 Markdown 5529 行。CLAUDE.md 目录树里的 `docs/` 只列了 `DESIGN.md RESEARCH.md`，UI.md / THIRD_PARTY.md / agents / phase0 / superpowers 都没登记。

<!-- section 1 done -->

## 2. 陈述核对

图例：✅ 与代码一致 · ❌ 与代码不符 · ⚠️ 无法核实 / 部分成立 · 🗑 描述的东西已不存在。行号均指 HEAD e6de3e1 的文件。

### 2.0 CLAUDE.md

| 位置 | 断言 | 状态 | 证据 |
|---|---|---|---|
| L1 | 标题「arXiv HTML Translator」 | ❌ | 产品名已定为 Read arXiv（UI.md S-P-01，`wxt.config.ts:21` manifest `name: 'Read arXiv'`）；`package.json` 仍叫 `arxiv-html-translator@0.0.0` |
| L6 | RESEARCH.md「存放 Phase 0 的实测结论」 | ⚠️ | RESEARCH.md 后半（§5.1、§6.4–6.11）是 2026-09-05～09-09 的后续实测，早已不止 Phase 0 |
| L16 | LLM 调用：`@ai-sdk/openai-compatible` / `@ai-sdk/anthropic` / `@ai-sdk/google` | ❌ | `package.json` 只有 `ai` + `@ai-sdk/openai-compatible`；DESIGN §8.1 已决定 anthropic / gemini 不实现 |
| L14–24 技术栈表 | 未提 Tailwind | ❌ | `tailwindcss` + `@tailwindcss/vite` 在 devDependencies，`wxt.config.ts` 加载了插件，popup / options 全用它 |
| L15 | 注入页面的浮层用 WXT `createShadowRootUi` | ❌ | `src/` 里没有任何 `createShadowRootUi` 调用；只有 `renderer/failed.ts` 用原生 `attachShadow`（DESIGN §12 PR 2b 明确「改用几十行原生 DOM + Shadow DOM」） |
| L18 | 队列移植 Read Frog `utils/request/` | ✅ | `src/providers/request/{request-queue,batch-queue,retry-policy,priority-queue,cancellation}.ts` 带来源头 |
| L19 | 缓存 Dexie，移植 FluentRead | ✅ | `src/cache/store.ts` 文件头 |
| L22 | `@types/dom-chromium-ai` | ✅ | devDependencies |
| L24 | Biome only linter；`src/providers/request/**` override | ✅ | `biome.json` 676 字节，未细查 override（⚠️） |
| L26 | 「浏览器目标 Chrome 138+」（reminder 版 CLAUDE.md 有此句；HEAD 版无） | ⚠️ | HEAD 的 CLAUDE.md 没有这句；DESIGN §8.1 写内置翻译要 138+，manifest `minimum_chrome_version: '131'`——两个数字并存，文档没有解释「131 装得上但内置翻译不可用」 |
| L33–58 目录结构 | `entrypoints/content.ts`、`background.ts` | ❌ | 实际是 `entrypoints/content/{index,debug}.ts`、`entrypoints/background/{index,context-menu,helper,helper-await,ocr,sessions}.ts`，另有 `abstract.content.ts`、`gallery/` |
| 同上 | `providers/openai-compat.ts anthropic.ts gemini.ts chrome-builtin.ts google-gtx.ts` | ❌ | 实际：`openai-compat.ts chrome-builtin.ts google-web.ts microsoft.ts`；无 anthropic / gemini / google-gtx |
| 同上 | 未列 `core/image/`、`core/svg/`、`core/sentences/`、`core/pipeline/`、`core/abstract/`、`core/marks.ts`、`shared/`、`ui/`、`locales/`、`helper/`（Swift）、`scripts/`、`styles/{highlight,image,ui}.css` | ❌ | 都存在（见 §1 地图）；目录树反映的是 Phase 1 前的设想 |
| 同上 | `docs/ DESIGN.md RESEARCH.md` | ❌ | 还有 UI.md、THIRD_PARTY.md、agents/、phase0/、superpowers/、brand/ |
| L65 硬规则 1 | 原节点只允许追加 `data-axt-*`，全局状态只在 `<html>` | ✅ | `renderer/index.ts` `restore()`；§7.7 已把「色带层 / 悬浮面板挂在 `<body>`」记为放宽 |
| L66 硬规则 2 | `ltx_*` 只在 `rules/latexml.ts` + `styles/*.css` | ✅ | `tests/rules/selector-boundary.test.ts` 扫描守护 |
| L67 硬规则 3 | provider 的 `preservesMarkup` 决定 markup / runs | ❌ | 字段早已改为 `wireFormats: readonly WireFormat[]`（`providers/types.ts:66`），路径是 tags / markers / runs 三条（DESIGN §2.3）；`preservesMarkup` 在 `src/` 里已不存在 |
| L68 硬规则 4 | `chrome-builtin`、`google-gtx` 各自独立文件 | ❌ | `google-gtx` 从未实现，现为 `google-web.ts` + `microsoft.ts` |
| L70 硬规则 6 | 缓存键含 `providerId | model | PROMPT_VERSION | RULES_VERSION | target | renderPath | normalizedText` | ⚠️ | 实际键还含 `CACHE_KEY_VERSION | promptKey | context`（`cache/key.ts:1,70-88`）；「必须包含」仍成立，但列表不全 |
| L71 硬规则 7 | API key 只存 WXT storage | ✅ | `config/schema.ts:46` 注释、`cache/key.ts` |
| L80 | protector 「Phase 1 / 2 已完成」 | ✅ | — |
| L81 | 来源标注模板为英文 `// Ported from …` | ❌ | 26 个带来源行的文件全部是中文模板 `// 移植自 …`，0 个英文；本行自己也承认「已有文件在下次实质改动时一并换」——与 DESIGN §13 L863 的中文模板互相矛盾（见 §3） |
| L88 | 「超过 100 行的模块先 plan mode」 | ⚠️ | 流程规则，无法从代码核实；见 §4 |
| L89–107 | PR 体量与 Codex 轮次统计表 | ⚠️ | 历史数据（2026-09-08），作为规则依据保留在 CLAUDE.md 里 |
| L139 | 闸门 `pnpm typecheck && pnpm lint && pnpm test && pnpm build` | ✅ | `package.json` 四个脚本都在；`.github/` 有 CI（未细查） |
| L141–142 | 「遇到 [待验证] 先实测写进 RESEARCH.md」 | ⚠️ | DESIGN.md 里已经**没有任何** `[待验证]` 标记（grep 仅命中 L6 的图例说明）；RESEARCH.md 有 2 处未闭合（见 §2.1 末） |
| L164–181 Phase 0 任务 | 七项任务 | 🗑 | RESEARCH.md L3「Phase 0 任务 1–7 全部完成」；DESIGN §12 也标已完成 |
| L173 | 「顺带统计 SVG 图占比（见 DESIGN.md §15.1）」 | 🗑 | 已做（RESEARCH §2.9），且结论后来被 §6.11 / §15.5 / §15.6 推翻扩展 |
| L199 | `pnpm fixtures:stats # Phase 0 的类名直方图脚本（待创建）` | ❌ | 脚本 `scripts/fixtures-stats.ts` 早已存在并多次重跑（RESEARCH §2.11） |
| L187–200 常用命令 | 缺 `e2e:image`、`e2e:placeholders`、`helper:build`、`helper:smoke`、`icons`、`check:output`、`zip` | ❌ | `package.json` scripts |
| L208 | Issue tracker：`docs/agents/issue-tracker.md` | ⚠️ | 文件是 mattpocock skills 的通用模板（提到 `/wayfinder`、`/triage`、`wayfinder:map` 标签），从未按本仓库改写 |
| L216 | 五个 triage 标签 | ⚠️ | 无法核实 GitHub 上是否真建了这些标签（本次未访问网络）；文件也是模板 |
| L220 | 「单上下文布局：仓库根 `CONTEXT.md` + `docs/adr/`」 | 🗑 | 两者都不存在；`domain.md` 自己写「不存在就静默跳过」 |

补充：reminder 里的 CLAUDE.md（旧版）与 HEAD 的差异——旧版有「浏览器目标 Chrome 138+」段、「不写跨浏览器降级分支」、闸门只有三步、来源行模板是中文；HEAD 版加了 PR 体量表、四步闸门、英文规则、英文模板。用户记忆里也记着「reminder 里的 CLAUDE.md 是旧版」。

<!-- section 2.0 done -->

### 2.1 DESIGN.md §0–§6（头部、范围、核心判断、术语、架构、规则、占位符）

| 位置 | 断言 | 状态 | 证据 |
|---|---|---|---|
| L1 | 标题「arXiv HTML Translator — 设计文档」 | ❌ | 产品名 Read arXiv（`wxt.config.ts:21`、UI.md S-P-01） |
| L3 | 「版本 v0.6 · 2026-09-04 · Phase 3 进行中；v0.6 把 provider 请求移到 content」 | ❌ | 头部从 09-04 起没再更新；正文 §8.0（09-06）已把请求搬回 background，头部仍写「移到 content」；最后一次实质修改是 2026-09-12（`7b6ab60`） |
| L6 | 「[待验证] Phase 0 需要用实测确认」 | 🗑 | 全文已无 `[待验证]` 标记；图例仍留着 |
| L17 | 免费引擎「Chrome 内置优先，`google-web` 兜底」 | ✅ | `providers/index.ts:29` `FREE_ENGINES = [chrome-builtin, google-web]` |
| L17 | 「原定的 gtx 已被它取代」 | ✅ | 无 `google-gtx` 文件 |
| L20 | 图片翻译：位图经 Native Messaging 调 Vision OCR | ✅ | `helper/`、`background/ocr.ts`、`core/image/` |
| L22 | 非目标：「非 Mac 平台的图片翻译退化路径」延后 | ✅ | 无多模态读图实现（RESEARCH §6.10 记为 #91 待做） |
| L32 | 三条路径 tags / markers / runs；`wireFormats` 按偏好排序的集合 | ✅ | `providers/types.ts:66`、`wire-formats.ts:9`、`cache/key.ts` `RenderPath` |
| L45 | 模式由 `html[data-axt-mode]` 控制 | ✅ | `data-axt-mode` 48 处 |
| L58 | 架构图：`[cache?]` 在 content 一侧 | ❌ | 与同节 L81「缓存与请求同在 background，content 不碰 IndexedDB」及 §8.0 矛盾；图未随 09-06 搬迁更新 |
| L73 | popup「引擎选择、进度」；options「providers、样式、术语表、缓存管理」 | ⚠️ | 大体对；但 UI.md §4 规定「No counts anywhere」，popup 已无进度数字；options 四节是「翻译服务 · 阅读 · 提示词与术语 · 数据」 |
| L89–97 §4.0b | 五个入口：popup / 命令 `axt-toggle`（Alt+T）/ 右键菜单 `documentUrlPatterns` / `#axt-translate` / 摘要页链接取 arXiv 的 href | ✅ | `wxt.config.ts:43`、`background/context-menu.ts:11-15,100`、`content/index.ts:465`、`core/abstract/link.ts:12,30` |
| L101–108 §4.1 | `Block { id, kind: 'text'\|'table', el, unit, cells? }` | ✅ | `extractor/index.ts` 拆成 `TextBlock` / `TableBlock` 两个接口，字段等价；`cells: Cell[]` 带 `numeric` |
| L111 | `extract` 纯读；`#axt-debug` 才 mark | ✅ | `content/index.ts:464` |
| L112 | `.ltx_note` 是 protect-but-descend 第一例 | ✅ | `latexml.ts:138` `descend: true` |
| L119 | 「已用 10 篇 fixture 校订」 | ⚠️ | 现在 12 篇真实 + 1 篇合成；后文（L158 等）已改说 12 篇，本句未更新 |
| L119 | 规则集中在 `src/core/rules/latexml.ts` | ✅ | `RULES_VERSION = '0.10.1'` |
| L121 | 翻译根 `article.ltx_document` | ✅ | `DOCUMENT_ROOT` L17 |
| L127–137 §5.1 表 | 各翻译单元选择器 | ✅ | `UNIT_RULES` L31–57 逐条对应；代码另有 `bibitem: .ltx_bibitem:not(:has(.ltx_bibblock))`（表里 L132 已提「兜底」） |
| L143 | `math, .ltx_Math` 列为跳过规则 | ⚠️ | 实际在 `PROTECT_RULES`（L133）；§5.6 L224 自己也说「`math` 只出现在 PROTECT」——§5.2 表把 protect 与 skip 混列 |
| L145 | `.ltx_tag` 跳过 | ⚠️ | 同上，在 PROTECT（L136），且带名 tag 参与翻译 |
| L147 | `.ltx_text.ltx_font_typewriter` 跳过 | ⚠️ | 在 PROTECT（`tt`，L137） |
| L150 与 L153 | `.ltx_ERROR` 列了两次 | ⚠️ | 冗余行 |
| L152 | `svg, .ltx_picture` 「TikZ 图，实测没有可翻译文字，见 §15.1」 | ❌ | 代码注释已改为「里面的标签由图片管线叠加（§15.6）」（`latexml.ts:95`）；§15.6 L1003 记录 199 个真实带字标签。表格行未同步 |
| L156–162 | 作者姓名翻译，`RULES_VERSION` 升到 0.7.0 | ✅（历史） | 现为 0.10.1 |
| L164–170 | `.ltx_contact_name` 作 void，0.7.1 | ✅ | `latexml.ts:144` |
| L170 | 「1400 多个单元测试能在 happy-dom 里跑完整条提取链」 | ⚠️ | 本次 `pnpm test` 结果见 §7（后台任务） |
| L172 | `.ltx_nodisplay` 作 void，`RULES_VERSION` → 0.10.1 | ✅ | `latexml.ts:11,152` |
| L175 | `.ltx_tag_item` 进 `NAMED_TAGS` | ✅ | L127 |
| L176 | `isBibAuthorBlock` 已删除 | ✅ | `src/` 无此符号 |
| L177 | 带环境名的 tag 参与翻译；`ROMAN_ID`；升到 0.6.2 | ✅ | `NAMED_TAGS` L115–129、`isNamedTag` L227 |
| L181 | `TABLE_RULES = { root: '.ltx_tabular', cell: '.ltx_td' }` | ✅ | L60 |
| L187 | 部分失败：原表保持 `translated` 另加 `data-axt-partial` | ✅ | `renderer/index.ts:48,151` |
| L189–191 | 数值格三条正则 | ✅ | `isNumericCell` L436：`NUMERIC_CELL` / `SYMBOL_CELL` / `NA_CELL`（未逐字比对正则体，⚠️） |
| L196 | 参考文献「默认翻译，**可在设置里关闭**」 | ❌ | `config/schema.ts` 没有任何参考文献开关；options 四节里也没有 |
| L197–198 | 按 `.ltx_bibblock` 翻；`isBibAuthorBlock` / `bib-authors` 删除 | ✅ | `UNIT_RULES` L42 |
| L208 | 年份 `.ltx_bib_year`「**装在自己的成对占位符里**」 | ❌ | `latexml.ts:153-158`：`bib-year` 已改为 `PROTECT_RULES` 的 void（理由：成对占位符内容仍会被改写，Codex #74）；§6.1 的 void 列表也没登记它 |
| L215–218 §5.5 | `RULES_VERSION` 进缓存键；版本分叉按 `latexml-v1.ts` | ✅ / ⚠️ | 进键 ✅（`cache/key.ts:6`）；分叉从未需要 |
| L224–227 §5.6 | 导出 `UNIT_RULES` `TABLE_RULES` `SKIP_RULES` `PROTECT_RULES`、`documentRoot` `classify` `isNumericCell`；优先级 skip > table > unit > protect | ✅ | `latexml.ts` L31/60/85/132/237/372/436；`classify` L237–247 按该顺序 |
| L233 | protector 原创实现 | ✅ | `src/core/protector/*` 无来源头 |
| L239 §6.1 void 列表 | `math` `.ltx_ref` `.ltx_cite` `.ltx_tag` `code` `.ltx_font_typewriter` `.ltx_note` `.ltx_note_mark` `.ltx_note_type` `.ltx_contact_name` `.ltx_nodisplay` 行内图片 `svg` `br` | ⚠️ | `PROTECT_RULES` 另有 `.ltx_bib_year`、`.ltx_indexrefs`、`img`；`code` / `svg` 是走 SKIP 规则「单元内等价 void」。列表不全但方向一致 |
| L246–252 §6.2 | `ProtectedBlock { blockId, format, text, slots, paired }` | ⚠️ | `serialize.ts:11-19` 有 `format text slots paired voidCount`，**没有 `blockId`**（id 在 pipeline 的 segment 上） |
| L255 | `markers` id 编成双射二十六进制字母 | ✅ | `tokens.ts:24-38` |
| L257 | 段首标签回填（issue #150） | ✅ | `protector/label.ts` `restoreLeadingLabel`、`LABEL_FORMATTING` |
| L258 | `escapeText` / `unescapeText` 纯文本往返 | ✅ | `protector/text.ts`（导出名未逐一核，⚠️） |
| L263 | void 超过阈值 40 → 单独成批 | ✅ | `VOID_DENSE_THRESHOLD = 40`（`serialize.ts:38`）、`pipeline/batches.ts:90` |
| L272 §6.3 | 校验失败：单块重试一次 → runs → 标记失败 | ✅ | `pipeline/run.ts:212-231` |
| L274 | `pnpm e2e:placeholders` 存在 | ✅ | `package.json`、`tests/e2e/placeholders.mjs` |
| L278–280 §6.4 | 克隆剥 `id`；`stripInjected` 删 `on*` 与 `javascript:` / `data:text/html` | ✅ | `core/marks.ts:36,72` |
| L285 §6.5 | `FUNCTIONAL_INLINE = a[href]` | ✅ | `latexml.ts:254` |
| L287 | 「v1 的三个免费引擎」 | ⚠️ | 现在是三个（chrome-builtin / google-web / microsoft），但 microsoft 只保 markers、不是「都保留占位符」的那一类 |

<!-- section 2.1 done -->

### 2.2 DESIGN.md §7（三模式渲染）

| 位置 | 断言 | 状态 | 证据 |
|---|---|---|---|
| L301 | 译文节点 = 下一个兄弟，同标签名，class 加 `axt-t`，`data-axt-for` | ✅ | `renderer/index.ts` `renderText`；`tests/renderer/restore.test.ts` |
| L302 | 原节点只追加 `data-axt-id` / `data-axt-state` / `data-axt-inline` | ⚠️ | 还会追加 `data-axt-partial`（L187 自己承认）、`data-axt-note="moved"`（L325）、`data-axt-identity`（L432）、`data-axt-split`、`data-axt-fit`——原节点上的属性集合早已超出这三个；不变量的精神（只加 `data-axt-*`）仍成立 |
| L303 | 全局状态只在 `<html>`：`data-axt-on / mode / lang / dir` | ⚠️ | 还有 `data-axt-underline`、`data-axt-blur`、`data-axt-img-modes`（§7.5 / §15 各自记了） |
| L304 | 译文写 `dir`；`RTL_LANGUAGES` / `RTL_PRIMARY` / `RTL_SCRIPTS` | ✅ | `config/languages.ts:991-1018`，`renderer/index.ts:198-202` |
| L305 | 表格 `lang` / `dir` 打在换过内容的格上 | ✅ | `renderer/index.ts:263-264` |
| L307 | 恢复 = 删 `.axt-t` 与 `.axt-img`、删 `data-axt-*`、移除注入 `<style>` | ✅ | `restore()` + `marks.ts`（另删 `HL_CLASS` / `PEEK_CLASS` 层，§7.7 已记） |
| L311–320 §7.2 | subgrid 两栏、`:has(+ .axt-t)` 配对、接管 ar5iv 网格 | ✅ | `styles/modes.css`（未逐条比对选择器，⚠️） |
| L321 | 多面板 flex 图不接管 `MULTI_PANEL_FLEX` | ✅ | `side-layout.ts:20`、`latexml.ts:333` |
| L325 | `localizeNotes`、`data-axt-note="moved"`、`.axt-note-t` | ✅ | `renderer/notes.ts` |
| L329 | `renderer/margin-notes.ts` 手工堆叠、`clearMarginNotes` | ✅ | 存在 |
| L332 | `isSideContainer()` 用 `closest(SIDE_DENY_SUBTREE)` | ✅ | `side-layout.ts:38,53` |
| L333 | `MARGIN_ASIDE` 在 `rules/latexml.ts` | ✅ | L316 |
| L335 | `.ltx_inline-block:not(.ltx_transformed_outer)` 豁免 | ✅ | `latexml.ts:343,349` |
| L336 | `fitTables` 量两张取 max | ⚠️ | `table-fit.ts` 存在；细节未读 |
| L338 | `splitFigures`、`REAL_TRANSLATION` 排除 mirror / split | ✅ | `split-figures.ts:33` |
| L346 | `FIT_TARGETS` 含 `table.ltx_eqn_table` | ✅ | `latexml.ts:63-67` |
| L362–366 | `fitTables` 只读量法、`resetFitCache`、`FitDeps.columnWidth` | ✅ | `table-fit.ts` 导出 |
| L368–385 | 增量 prep、`createCoalescer<T>`、`RunOptions.onRendered`、`readPairMargins` / `writePairMargins` | ✅ | `scheduler/coalesce.ts:29`、`pair-margins.ts` |
| L398–407 | 宽度契约 `--axt-side-w` / `--axt-article-w` / `--axt-margin-w`、`--axt-gap` 用 rem | ✅ | `modes.css` 变量出现 15 / 7 / 3 / 7 次 |
| L408 | `matchMedia('(max-width: 1279px)')`、`createModeController` | ✅ | `responsive.ts:6,35` |
| L410–412 | `SIDE_LAYOUT` 归规则模块；`selector-boundary.test.ts` 扫 `src/` | ✅ | `latexml.ts:331`、测试文件存在 |
| L416 §7.3 | 「stack **默认布局**」 | ❌ | `DEFAULT_CONFIG.mode = 'side'`（`config/schema.ts:110`，2026-09-11 用户拍板，UI.md S-P-70）；§7.3 与 §9 L747「`mode: 'stack' \| 'side' \| 'only'`」都没更新默认值 |
| L418 | 短标题 ≤ 60 字符同行，`data-axt-inline` | ✅ | `latexml.ts:368` `isInlineTitleCandidate`、属性 8 处 |
| L422–426 | 块标记一次性写完不切片；状态属性仍切片 | ✅ | `pipeline/run.ts:144`（「同步写完还顺带解决了 halted() 的竞态」） |
| L428–436 | `observerThresholds` 5% 网格、钳到可达上限 | ✅ | `scheduler/lazy.ts:33-39,102-106` |
| L432 | 译文与原文相同打 `data-axt-identity` | ✅ | 属性 3 处 |
| L440 §7.4 | only 模式隐藏 `[data-axt-state="translated"]` | ✅ | `modes.css`（未逐行核，⚠️） |
| L445–449 | `renderer/anchors.ts` 三个监听 | ✅ | `installAnchorFallback` |
| L455–475 §7.4b | 译文标 `lang`；镜像与骨架屏 `aria-hidden` + `inert`；`tests/e2e/a11y.mjs` | ✅ | `mirror.ts:68`、`skeleton.ts:62`、e2e 文件 |
| L464 | 「本项目 131 的下限」 | ✅ | `wxt.config.ts:31` `minimum_chrome_version: '131'` |
| L479–481 §7.5 | v12 外观：`data-axt-underline` / `data-axt-blur` + 五个变量；`appearanceRule()`；`presets.css` 缩到三条；`data-axt-style` 与 `--axt-accent` 退役 | ✅ | `style-preset.ts` `appearanceRule`、`presets.css`（下划线 / 模糊 / 默认变量三组）；`data-axt-style` 只剩 3 处**注释**（`renderer/index.ts:53,76`、`content/index.ts:87`）——注释是陈旧的 |
| L483–488 | 「原始记录（2026-09-05 的预设方案）」20 种预设、`glow` / `gradient` 改静态 | 🗑 | 明确标为历史；但仍占 §7.5 一半篇幅，且 L487「共享规则**只列出下划线类的 id**」等纪律已被 v12 的 `html[data-axt-underline]` 写法取代 |
| L489–493 | 「装饰参数可调 … 写进 config（v9）」；「实现上不改 `modes.css` 与 `presets.css`：`styleVarsRule()` … 覆盖 `muted` / `green` 写的 `--axt-color` 与 `html[data-axt-on]` 上的 `--axt-accent`」；「`style` 变了就调 `applyStyle()`——只重算注入表的内容与 `data-axt-style`」 | ❌ | v12 后 `config.style` 不存在（`schema.ts` 是 `appearance`），`styleVarsRule` 不存在（只有 `appearanceRule`），`data-axt-style` 不再写，`presets.css` 已重写。这段没有标「历史」，读起来像现行设计 |
| L494 | 预设选择器 `.axt-t:not(.axt-pending, .axt-error, .axt-mirror, .axt-split)` | ✅ | `presets.css` 共享规则 |
| L495 | 高级 CSS 只接受声明块 | ✅ | UI.md S-O-47；`style-values.ts` `sanitizeColor`（声明块校验未核，⚠️） |
| L499–508 §7.6 | 骨架屏 `.axt-skel` / `.axt-skel-line`、`--axt-skel`、上限 60、Web Animations、`prefers-reduced-motion` | ✅ | `skeleton.ts:7-8,14,33,74`、`modes.css:14-47` |
| L508 | 失败态 `.axt-t.axt-error` Shadow DOM 小部件；`axt:retry-failed` | ✅ | `renderer/failed.ts`、消息 3 处 |
| L529 | 「`minimum_chrome_version` 是 131」 | ✅ | 与 L920 矛盾（见 §3） |
| L531 | 句边界「目前只有微软报」 | ⚠️ | L555 同节说「微软，以及 #137 之后的 Google」；`providers/sentence-markers.ts` 存在（§8.6 的标记方案）——L531 未随 #137 更新 |
| L532 | 登记进 `renderer/sentences.ts` 的 `WeakMap` | ✅ | 文件存在，`mirrorPair` 导出 |
| L539 | 「颜色跟随 `--axt-green` … `styleVarsRule` 从 `config.style.accent` 改写它——一个颜色控件」；「开关 `config.reading.sentenceHighlight`」 | ❌ / ✅ | `--axt-green` 仍是默认底色（`presets.css:26`、`highlight.css:39`），但改写它的是 v12 的背景高亮配置 `--axt-hl-color` / `--axt-hl-mix`，`styleVarsRule` / `config.style.accent` 已不存在；开关 ✅（`schema.ts:83`） |
| L542–555 | only 模式悬浮原文 `axt-peek`、驻留 600 ms、宽限 120 ms、`inert` | ✅ | `peek.ts:30` `PEEK_DWELL_MS = 600`、`highlight.ts:41,62`、`marks.ts` `PEEK_CLASS` |

### 2.3 DESIGN.md §8–§10（Provider、缓存配置、调度）

| 位置 | 断言 | 状态 | 证据 |
|---|---|---|---|
| L565 | content 只发三种消息 `axt:translate` / `axt:cancel-scope` / `axt:provider-status` | ❌ | content 还发 `axt:ocr`、`axt:helper-status`、`axt:page-status` 应答、`axt:stats`、`axt:ping` 等（`shared/messages.ts` 共 17 种）；「翻译相关只这三种」勉强成立 |
| L569–571 | 搬回 background 的理由与 RESEARCH §6.7 / §6.8 | ✅ | 与 RESEARCH 一致 |
| L576 | 「产物从 428.95 kB 降到 152.47 kB」 | ⚠️ | 历史数字；现在 content 又加了图片 / SVG / 高亮 / peek，未复测 |
| L578–585 | `pnpm e2e:local-endpoint` | ✅ | 脚本存在 |
| L589–594 | `TranslationTransport { translate, cancel, status }` | ⚠️ | `providers/transport.ts` 存在；接口成员未逐一核 |
| L597–598 | `createLocalTransport` / `createMessageTransport`（`shared/transport.ts`） | ✅ | 文件存在 |
| L600 | 指名引擎 `TranslateCall.providerId` 不走降级链 | ⚠️ | 未读实现 |
| L604 | `id: 'openai-compat' \| 'anthropic' \| 'gemini' \| 'chrome-builtin' \| 'google-web'` | ❌ | `types.ts:58` 是 `id: string`；实际取值含 `microsoft` 与读者的服务 id（§8.5 L721），`anthropic` / `gemini` 不存在 |
| L606–612 | `kind` / `wireFormats` / `maxBatchChars` / `maxBatchItems` / `rateLimit` / `isAvailable` / `translate` | ✅ | `types.ts:55-80`；另有 `maxConcurrent`（L77，§8.3 提了）、`promptKey`（L88）、`cacheId`（L95）未进接口示例 |
| L615–624 | `TranslateRequest { segments, source: 'en', target, context: { paperTitle, sectionTitle, glossary } }` | ⚠️ | 代码 `TranslateContext` 还有 `abstract`（L23）；`TranslatedSegment` 带 `alignment`（§8.6 的产物，DESIGN 全文没有 §8.6 这一节——见 §7 待核实） |
| L637 | `openai-compat` 「覆盖 OpenRouter（默认端点）… 默认模型取便宜快速档」 | ❌ | v12 起没有默认端点与默认模型：`services: []`、`DEFAULT_CONFIG.provider = 'microsoft'`；「厂商模板不做」（L721）；`host_permissions` 里的 `openrouter.ai` 是遗留 |
| L638–639 | `anthropic` / `gemini` 行 | 🗑 | L646 已说暂不实现「表里保留作为接口形状说明」 |
| L640 | `chrome-builtin` `['tags']`，Chrome 138+ | ✅ | `wire-formats.ts`；138 与 manifest 131 的关系见 §3 |
| L641 | `google-web` `['tags','markers']` | ✅ | `wire-formats.ts` |
| L642 | `microsoft` `['markers']` | ✅ | 同上 |
| L648 | `microsoft` 不进 `FREE_ENGINES` | ✅ | `providers/index.ts:29-34` |
| L648 末 | 「§8.5 的协商是顺序相关的，#103 之前要先改成首选决定格式」 | ❌ | §8.5 L727–732 已记 2026-09-09 改成顺序无关，`providers/index.ts` 注释同；本句是改之前写的，没删 |
| L650 | 免费引擎语言支持复用 `isAvailable()` | ✅ | `microsoft.ts` 支持表 |
| L652 | 「微软 edge 通道已接入」 | ✅ | — |
| L656 | AI SDK 7 `generateText` + `Output.object`，`maxRetries: 0` | ⚠️ | `openai-compat.ts` 未读；`ai@^7.0.91` 在依赖 |
| L657 | 两层提示词：`prompt-library.ts` `default` / `precision-rewrite`；`prompt.ts` `PROTOCOL_BLOCK` | ✅ | `prompt-library.ts:13-14`、`prompt.ts:18` |
| L659 | `<document_metadata>` 定界 | ✅ | `prompt-library.ts:21-28` |
| L660 | 术语表上限 200 / 120 / 200 / 6000，`GLOSSARY_LIMITS`，`normalizeGlossary`，`PROMPT_VERSION` 升到 4 | ✅ | `schema.ts:16,26`、`prompt.ts:15` |
| L661 | 论文级上下文截到 1200 字符 | ⚠️ | `pipeline/paper.ts` 未见 1200 字面量（可能改名或常量化） |
| L662 | 缓存键含 `promptKey` 与上下文 | ✅ | `cache/key.ts:1,40` |
| L667 | `CHAIN_CONFIG_FIELDS` = `provider / openaiCompat / prompts / targetLanguage / fallback` | ❌ | 现为 `['provider','services','prompts','targetLanguage','fallback']`（`transport.ts:179`）；`openaiCompat` v12 已改 `services` |
| L668 | 失败响应带 `partial` | ✅ | `run.ts:242` |
| L669–671 | `createGlossaryMatcher` 逐段匹配 | ✅ | `providers/glossary.ts` |
| L672 | 批次 1000 字 / 4 段；速率 8/s 突发 20；攒 100ms | ✅ | `openai-compat.ts:57-58`、`translate-service.ts:109,135` |
| L675 | `ProviderError.isolatable` 按 kind 默认值 | ✅ | `types.ts:134-143` |
| L678 | 超时 20 s + 15 ms/字，上限 120 s | ✅ | `translate-service.ts:137` |
| L682 | `google-web` `maxConcurrent: 2`，`rate: 20 / capacity: 8` | ✅ | `google-web.ts:85-86` |
| L696–697 | `isolatable`、HTTP 状态映射 429 / 401 / 403 / 4xx→`bad-request` | ✅ | `http-errors.ts:13-17` |
| L699 | fallback 链默认 `chrome-builtin` → `google-web` | ✅ | `FREE_ENGINES` |
| L700 | `google-web`「速率压到 2 请求/秒、突发 2 … **不攒批**（只让 LLM 攒）」 | ❌ | 与 L682 / L665 矛盾；代码 `rate 20 / capacity 8 / maxConcurrent 2`，每个 provider 都建 `BatchQueue`（`translate-service.ts:183-186`） |
| L701 | 429 暂停整条队列 | ✅ | `request-queue.ts`（移植原样） |
| L702 | 思考模式按端点域名发字段 | ✅ | `thinking.ts:15-18` |
| L703 | 「**即时引擎**：`chrome-builtin` 就绪时先渲染视口内的块，LLM 译文到达后原位替换 … 用户可在设置里关闭」 | ❌ | 没有这条实现：链是失败才降级（`fallback.ts`），没有「先内置后 LLM 替换」的双写；配置里没有对应开关。是 RESEARCH §7 第 21 条建议被当成已定设计写进来的 |
| L707–713 §8.4 | `isAvailable()` 只认 `available`；`BUILTIN_MAX_ITEMS = 20`；会话创建 60 s 超时；按语言对缓存会话 | ✅ | `chrome-builtin.ts:29,37,102` |
| L710 | 「content 调 `FallbackService.reset()` 撤销降级记录」 | ❌ | `fallback.ts:38`「没有 `reset()`」；§8.5 L734 也说没有；`axt:engine-ready` 改为重建整条链 |
| L710 | 「下载入口因此只放在 popup 的点击处理函数里」 | ⚠️ | 设置页的 Chrome 卡也有「下载」（`options/sections/Services.tsx:31`，UI.md S-O-11）；两处都是用户手势，结论不变 |
| L713 | 隔离世界暴露 `Translator` 已实测 | ✅ | RESEARCH §6.3 |
| L721 §8.5 | `config.services[]`，`getProvider` 按服务 id 造 OpenAI 兼容引擎 | ✅ | `providers/index.ts:11-13`、`services.ts` |
| L722 | `buildChain` 两道过滤 | ✅ | `providers/index.ts:59` |
| L723 | `axt:translate-page { restart }`、`onProvider` | ✅ | `messages.ts:43`、`run.ts:56` |
| L724 | `providers/fallback.ts` 约 110 行 | ⚠️ | 未数 |
| L725 | 冷却 60 s；`no-key` / `auth` 永久 | ✅ | `fallback.ts:55,61` |
| L734 | `FallbackService` 没有 `reset()` | ✅ | `fallback.ts:38` |
| L735 | 配置 v5 `fallback.enabled` 默认开 | ✅ | `schema.ts:72` |
| L739 §9 | Dexie，移植 FluentRead | ✅ | `cache/store.ts` |
| L740 | 键 `sha256(providerId \| model \| PROMPT_VERSION \| RULES_VERSION \| target \| renderPath \| normalizedText)`；「`CACHE_KEY_VERSION` 升到 3，改名时再升到 4」 | ❌ | 实际键还含 `promptKey`、`context`（同节 L662 说了）；`CACHE_KEY_VERSION = 6`（`key.ts:70`），5、6 两次升版没记 |
| L740 | `providerId` 取 `cacheId ?? id`，`openai-compat:<origin><path>` | ⚠️ | `types.ts:95` `cacheId` 存在；v12 后服务 id 本身就是 provider id，`openai-compat:` 前缀是否仍用未核 |
| L741 | TTL 30 天 / 20,000 条 / 50 MB / 256 KB / 热层 256 | ✅ | `store.ts:42-46` |
| L742 | `axt:cache-stats` / `axt:cache-clear`，统计前 `cleanup()` | ✅ | 消息各 3 处 |
| L743 | `byteSize` 索引 Dexie v2 | ✅ | `store.ts:58` |
| L744 | `CACHE_READ_BUDGET_MS` 2 s | ✅ | `translate-service.ts:116` |
| L745 | 取消后不写缓存 `cancelledScopes` | ✅ | `translate-service.ts:226` |
| L746 | `expectationsFromText`、`cache.bypass` | ✅ | `translate-service.ts:15,58` |
| L747 | 配置版本 v1…v12 | ❌ | `CONFIG_VERSION = 13`（v13 加 `uiLanguage`，UI.md §6 记了、DESIGN 没记）；v10 的用途（微软接入后升版防降级）也没记；「v1 形状 `provider: 'openai-compat' \| …`」已成历史 |
| L749 | `configFallbackReason()`，popup 顶部红色警告 | ⚠️ | 函数 ✅（`storage.ts:115`）；UI.md L114 说 popup 的 S-P-34 已移除、改在设置页顶部（S-O-02）——DESIGN 未更新 |
| L753 §10 | `scheduler/lazy.ts`、`renderer/pending.ts`、`scheduler/title.ts`、`pipeline/run.ts` | ✅ | 均存在 |
| L757 | `rootMargin` 1000 / `threshold` 0；设置页「预翻译距离（0–10000px，步进 100）与可见阈值（0–1）」 | ⚠️ | 默认 ✅（`lazy.ts:56`）；设置页 UI 已改成刻度（半屏 / 一屏 / 两屏 / 三屏；刚露出 / 露出一半 / 完全露出，`Reading.tsx:98-109`，UI.md S-O-50/51），不再是数字框 |
| L761 | 「pending 节点（§7.6）… 圆环」 | ⚠️ | 本节仍多处说「圆环」（L762、L783 无），§7.6 已改骨架屏 |
| L768 | 不做滚动锚定 | ✅ | 无 `elementFromPoint` 锚定代码（未 grep，⚠️） |
| L769 | `createCoalescer(fn, { delay: 150, maxWait: 1000 })` 攒脏集合 | ✅ | `coalesce.ts` |
| L771 | `maxConcurrent` 8、`maxTotalMs` 180 s，默认值在 `translate-service` | ✅ | `translate-service.ts:125-126` |
| L783 | 「`batch-queue`（… **只有 LLM 攒批**）」 | ❌ | 与 L665 矛盾；每个 provider 都攒 |
| L783 | `p-queue` 与手写暂停已删 | ✅ | `package.json` 无 `p-queue` |

<!-- section 2.2-2.3 done -->

### 2.4 DESIGN.md §11–§15（测试、阶段计划、借鉴边界、风险、图片翻译）

| 位置 | 断言 | 状态 | 证据 |
|---|---|---|---|
| L793 | 反例测试文件 `pipeline/run.test.ts`、`protector/runs.test.ts`、`protector/rehydrate.test.ts`（A03）、`core/marks.test.ts`、`protector/clone.test.ts` | ✅ | 全部存在；`rehydrate.test.ts:41`「【已知行为，待 A03】」 |
| L794 | `pnpm e2e:placeholders` | ✅ | — |
| L798 | `tests/e2e/extension.mjs`、`local-endpoint.mjs`、`layout.mjs` | ✅ | 存在；另有 `image.mjs`、`options-page.mjs` 未在本表登记 |
| L799 | `tests/e2e/a11y.mjs` | ✅ | — |
| L802 | 「fixtures 10 篇」 | ❌ | 12 篇 + `synthetic-structures.html` |
| L170（§5.2） | 「1400 多个单元测试」 | ⚠️ | 本次实跑：109 个文件、**1518** 个测试通过（28 s） |
| L808–813 §12 Phase 0 | 「已完成」；但 L812 仍是 `[ ]`「隔离世界待接 `chrome-builtin` 时验证」 | ❌ | RESEARCH §6.3 已于 2026-09-05 实测完成，§8.4 L713 也写了；复选框没勾 |
| L815–818 Phase 1 | `feat/scaffold` / `feat/rules` / `feat/extractor` 分支计划 | 🗑 | 已完成的计划，无勾选状态；「`pnpm fixtures:stats` 改用 PROTECT_RULES」已做 |
| L820–826 Phase 2 | 「`openai-compat`（… + `generateObject`）」 | 🗑 | §8.2 L656 已说 `generateObject` 被 `Output.object` 取代；`p-queue` 也已删 |
| L828–829 Phase 3 | 「provider 请求移到 content（§8.0）」 | ❌ | §8.0 已反转为 background；本行未改 |
| L829 | 「side / only 模式与宽度逻辑；`chrome-builtin` + `google-web` 与 runs 路径；fallback 链；调度与进度；样式预设；术语表；options 页」 | ⚠️ | 全部已实现，但列表没有完成标记，读者分不清「计划」与「现状」 |
| L831–841 | PR 1 / 2a / 2b 与搬运取舍 | ✅（历史） | 与 THIRD_PARTY 一致 |
| L843–847 Phase 4 / v2 | 「更多 fixture 与规则修正；性能；导出 / 导入缓存；发布」 | ⚠️ | 无进展记录；缓存导入导出没有实现 |
| L855–859 §13 表 | 五个参考项目 | ✅ | THIRD_PARTY 项目表一致 |
| L861 | 「arXiv 适配 … Phase 1 已完成」 | ✅ | — |
| L863 | GPL 头模板 `// 移植自 reference/<repo>/<path>@<commit>（GPL-3.0），<YYYY-MM-DD> 移植、有修改` | ✅（代码） / ❌（与 CLAUDE.md 矛盾） | 26 个文件全是此格式；CLAUDE.md L81 改成了英文模板 |
| L863 | 「项目以 GPL-3.0 开源」 | ❌ | 仓库根**没有 LICENSE 文件**（`ls LICENSE*` 无结果），`package.json` 也无 `license` 字段；#167 待办 |
| L873 | LaTeXML 版本风险：「探测函数分叉」 | ⚠️ | 无探测函数实现（从未需要） |
| L877 | 窄屏 `matchMedia` 自动降级 | ✅ | `responsive.ts` |
| L884 | 「helper 没检测到时只有位图不翻，SVG 照常——**设置项不再整节灰掉**」 | ✅ | `schema.ts:88` 注释同 |
| L884 | 「不做单张图的入口」 | ✅ | 无对应 UI |
| L891 | 内联 `svg.ltx_picture`「实测没有 `<text>`、文字只以 `foreignObject` 出现且极少，跳过」 | ❌ | §15.6 L1003：199 个带词的 `foreignObject`，已接入图片管线；§15.1 这句没随 §15.6 改 |
| L894 | 「叠加层移植 `xulihang/ImageTrans_chrome_extension`（GPL-3.0）`getImage.js` 里的 DOM 渲染段（`fitBoxFontSize`、`detectBackgroundColor`、换行、圆角框）」 | ⚠️ | `renderer/image.ts` / `image/boxes.ts` 文件头**没有** ImageTrans 来源行，THIRD_PARTY 也没有对应文件行（只在项目表列了快照）；§15.2 L911 又说「ImageTrans 那种 JS 二分量字号 … 不用」。要么实际是重写（应改文档），要么漏登记（GPL §5 问题） |
| L909 | OCR 缓存按 `imageHash \| helper 版本` 存进同一个 Dexie 库 | ⚠️ | `background/ocr.ts` 存在，键形状未核 |
| L910 | `.axt-img` 不带 `.axt-t`，`marks.ts` 认它 | ✅ | `data-axt-img-modes` 7 处、`marks.ts` |
| L911 | CSS 锚点定位 Chrome ≥131 | ✅ | `wxt.config.ts:31` |
| L920 | 「`wxt.config.ts` **没写最低 Chrome 版本**，装到旧 Chromium 上也不能坏页面」 | ❌ | `wxt.config.ts:31` `minimum_chrome_version: '131'`（注释写明是 Codex 在 #99 指出后加的）；与 §7.7 L529、§7.4b L464 矛盾 |
| L929–942 §15.3 | 协议 `v`、`ping`→`version`、`frames`、`truncated`、`unsupported-protocol` | ✅ | `helper/main.swift:11,18,31,76,102,149-153` |
| L946 | helper「Swift，~100–200 行」 | ✅ | 167 行 |
| L947 | host manifest 在 `<用户数据目录>/NativeMessagingHosts/` | ✅（实测记录） | e2e `.profile-image/NativeMessagingHosts` 存在 |
| L948 | 「检测不到则**设置项灰掉**、图片翻译静默不跑」 | ❌ | 与 L884「不再整节灰掉」矛盾；UI.md S-P-86 / S-O-27 是「显示安装引导」 |
| L949 | `nativeMessaging` 暂作必需权限 | ✅ | `wxt.config.ts:40` `permissions: ['storage','nativeMessaging','contextMenus']` |
| L952–959 | 安装引导在 popup 里走完；`src/ui/HelperSetup.tsx`；`axt:helper-await` 2 s 一轮、上限 3 分钟；session storage | ✅ | 文件与消息存在；`background/helper-await.ts` |
| L960 | 「后话：`apple-translate` provider」 | ⚠️ | 未做，纯设想 |
| L980–989 §15.5 | `src/core/svg/glyphs.ts` 产出 `OcrLine[]`；分解矩阵 `atan2(b,a)`；祖先带 `transform` 的字形跳过；`len` / `thick` 盒子；`src/core/svg/runs.ts` 认代码 | ✅ | `glyphs.ts:73-85`、`renderer/image.ts:38-39,109-118`、`svg/runs.ts` |
| L986 | 「v1 只画 90° 的倍数 … **现在**每一段都画」 | ✅ | `glyphs.ts` 已无 `quarterTurn`（RESEARCH §6.11 L628 的前向引用已过期） |
| L993–1010 §15.6 | `foreignObject` 标签走图片管线；`proseText`；不合并相邻行；去重；`pictureTexts` 不读几何 | ✅ | `svg/foreign.ts`、`latexml.ts:401 proseText`、`FIGURE_SELECTORS.pictureText` |
| L1011 | 「15.5b 参考」排在 15.6 之后 | ⚠️ | 编号错位 |
| 全文 | **代码引用了 DESIGN 里不存在的 §8.6**（句子对齐 / 句子标记，issue #105）：`cache/key.ts:49,65`、`providers/types.ts:11,82`、`translate-service.ts` 7 处、`pipeline/sentences.ts`、`pipeline/run.ts:172`、`microsoft.ts:175`、`rules/latexml.ts:283`、两个测试文件 | ❌ | DESIGN 的 §8 只有 8.0–8.5（见标题清单）；§7.7 L531 也写「§8.6 / `providers/alignment.ts`」。这一整块设计（句边界由引擎报或由服务层插标记、`CACHE_KEY_VERSION` 5→6 的理由、`alignment` 字段）**只存在于代码注释里** |

### 2.5 RESEARCH.md

| 位置 | 断言 | 状态 | 证据 |
|---|---|---|---|
| L3 | 「对应 DESIGN.md v0.1 · Phase 0 任务 1–7 全部完成」 | ⚠️ | 头部从未更新；文件内容延伸到 2026-09-09 |
| L7 | 「Phase 0 尚无测试与构建目标，`pnpm test` / `pnpm build` 从 Phase 1 起生效」 | 🗑 | 早已生效 |
| L13 | 「10 篇」 | ⚠️ | L42 补了 2 篇；总数 12 |
| L25 | `RULES_VERSION 0.1.0-phase0` | ✅（历史） | 现 0.10.1 |
| L101 §2.9 | 「SVG 图在实践中没有可翻译的 DOM 文字，v1 整体跳过 `svg`；§15 的 OCR 路线只对 `img` 有意义」 | ❌ | DESIGN §15.5（外链 SVG 走字形读取）、§15.6（内联 TikZ 的 `foreignObject` 199 个带词标签，2026-09-11）；`latexml.ts:95` 注释已改。§6.11 L473–476 还在说「§2.9 对内联 SVG 仍成立」——也被 §15.6 推翻 |
| L160 §3.2 | 「side 模式只需在 `html[data-axt-mode="side"]` 上覆盖 `--main-width`」 | ❌ | DESIGN §7.2 L407 实测「只覆盖 `--main-width` 不动轨道会横向溢出」，改为三个 token 重写 body 网格 |
| L162 | 「§7.2 的 1100px 自动降级阈值 … 建议改为 1280px」 | ✅（已采纳） | `responsive.ts:6` `(max-width: 1279px)` |
| L200–212 §4 地图 | 「`google-gtx` / `translateHtml`」行 | ⚠️ | gtx 未接；地图本身仍有参考价值 |
| L280 | 「gtx 有条件声明 `preservesMarkup: true` … translateHtml 不值得作为独立 provider」 | ❌ | 同文件 §6.6 与 §7 第 23 行反转：采用 translateHtml、gtx 不接；`preservesMarkup` 字段已不存在 |
| L344 §6.5 | 「Read Frog 把 provider 的 fetch 放在 content script」 | ❌（已自我更正） | §6.7 L395 更正；§6.5 整节已加删除线说明 |
| L392 | 「CLAUDE.md 列出的 Ollama … 正式翻译（走 content）必然失败」 | ⚠️ | 历史状态；已按 §7 第 24 行修复（background）；本句没标「已修」 |
| L413 | 「这张表测的不是冷启动」**[待验证]** | ⚠️ 未闭合 | 没有后续测量 |
| L434 | 「只覆盖 fetch 正在飞这一种等待」**[待验证]** | ⚠️ 未闭合 | 429 退避期间 worker 存活未测 |
| L436 | 「background 里 `Translator.create()` 没测成 … 等语言包就绪时补测」 | ⚠️ 未闭合 | — |
| L594–597, L628–630 §6.11 | 前向引用 `glyphs.ts` 「skips any glyph with a transformed ancestor」、「`quarterTurn` … where the decision now lives」 | ✅ / 🗑 | 前者 ✅（`glyphs.ts:92`）；`quarterTurn` 已被 2026-09-11「每一段都画」取代，符号不存在 |
| L616–627 | 「Recommendation for v1: place the quarter turns, drop the rest」 | 🗑 | DESIGN §15.5 L986 已推翻 |
| L735–767 §7 | 修订清单 | 见本文 §5 | — |

### 2.6 UI.md

| 位置 | 断言 | 状态 | 证据 |
|---|---|---|---|
| L6 | 「状态：草稿，逐节讨论中」；§1 / §2 / §3 / §5 标 [议] | ❌ | §3 文案、§5 令牌、§6 语言都已实现（`src/ui/strings.ts`、`src/styles/ui.css`、`src/locales/`），[议] 标签与「草稿」已不反映现状 |
| L27 | 「三家参考产品都用『翻译服务』」 | ⚠️ | 无法核实 |
| L53 | 排版（#47）「已定未做」 | ✅ | 无实现 |
| L68 S-P-01 | manifest `name` 跟着「Read arXiv」 | ✅ | `wxt.config.ts:21` |
| L93 S-P-50 | 快捷键 badge 取 `commands.getAll()` | ⚠️ | `popup/data.ts` 未读 |
| L99 S-P-70 | `MODE_ORDER` 左右在前，默认左右 | ✅ | `strings.ts:112` `['side','stack','only']`、`schema.ts:110` |
| L107 S-P-83 | 「管理译文样式…」开到 `options.html#reading` | ⚠️ | popup 源码 grep 未见 `#reading` 字面量（可能拼接） |
| L114 | S-P-12…18 状态药丸与 S-P-34 已移除 | ✅ | §8 功能表 L356 仍写「配置读取失败提示 … popup 卡内说明 S-P-34，P10」——自相矛盾 |
| L124 S-O-01 | 四节 `#services / #reading / #prompts / #data` | ✅ | `options/App.tsx:16` `SECTIONS` |
| L126 S-O-05 | 界面语言 v13 | ✅ | `schema.ts:97` |
| L128 S-O-11 | 设置页 Chrome 卡「下载」 | ✅ | `Services.tsx:31` |
| L143–147 S-O-27 | 两步引导、共用 `HelperSetup.tsx`、自动检测 | ✅ | 文件与 `helper-await` 存在 |
| L151 S-O-42 | 内置样式六种 | ⚠️ | `appearance.ts` 内置高亮三种 ✅（柔和绿 / 淡黄 / 淡蓝）；样式六种未逐一核 |
| L159–160 S-O-50/51 | 刻度：半屏…三屏；刚露出…完全露出 | ✅ | `Reading.tsx:98-109` |
| L181 | S-E 映射用于 S-O-28 | ❌ | §3.2 没有 S-O-28（连接结果是 S-O-20） |
| L183–193 §3.4 | `ProviderErrorKind` 九种 → 用户句 | ✅ | `types.ts:98` 九种；`locales/zh-CN.ts:280` |
| L197–220 §4 | P0–P15 | ⚠️ | `popup/fixtures.ts` 有 17 处 `P<n>` 引用；未逐状态核 |
| L247–266 §5 | 令牌 `--axt-accent #b31b1b / #d63c3c` 等 | ✅ | `ui.css:18,35,52`；「[议]」标签过期 |
| L268 | 「页内组件的深色是否跟随 arXiv 页面自身的深色样式：[待验证]」 | ⚠️ 未闭合 | DESIGN §7.7 L546 提到 arXiv 主题 `data-theme` 由站点切、面板颜色从页面读——部分回答了，UI.md 未更新 |
| L290–327 §6 | 语言包文件、`pickLocale`、`uiLanguage` | ✅ | `src/locales/{zh-CN,en,index}.ts`、`ui/apply-locale.ts`、`public/_locales/` |
| L329–339 §7 需要改 DESIGN 的条目 | (1) 默认 provider 改 `google-web` | ❌ | 代码默认 `microsoft`（`schema.ts:105`），UI.md 自己的 S-P-46 也说 Microsoft 是默认；本条过期 |
| 同上 | (2) 语言包下载入口 popup + 设置页 | ⚠️ | 已实现两处；DESIGN §8.4 仍写「只放在 popup」 |
| 同上 | (3)(4) 「测试连接」并入「连接」、即改即存 | ⚠️ | 已实现（S-O-19）；DESIGN §8.0 L565、§9 仍说「测试连接」「设置页保存」 |
| 同上 | (5) 预翻译参数刻度 | ⚠️ | 已实现；DESIGN §10 L757 仍写数字框 |
| 同上 | (6) 页内「已改用」提示 | ⚠️ | §8 L369「待定」，§9 第 5 条仍在讨论 |
| 同上 | (7) 错误映射表放 `providers/types.ts` 旁 | ⚠️ | 实际放在 `locales/zh-CN.ts`（随界面语言走，更合理），未回写 |
| 同上 | (8) `nativeMessaging` 改可选 + S-O-86 | ⚠️ | 未做（分发时） |
| 同上 | (9) #47 排版进 schema | ⚠️ | 未做 |
| L345–371 §8 功能表 | 编号列大面积与 §3 不符：`S-O-41…44`（样式）、`S-O-45…46`（预翻译）、`S-O-50…58`（提示词）、`S-O-60…61`（术语）、`S-O-71…74`（缓存）、`S-O-30`（思考）、`S-O-80…87`（图片）、`S-P-34 / P10`（配置回退）、`S-P-48 / S-P-49`（免费 AI / Microsoft）、`P12–P13`（图片） | ❌ | §3.2 重编号后（S-O-40…49 样式、S-O-50/51 预翻译、S-O-61/62 提示词术语、S-O-70…72 缓存、S-O-24…27 图片）没有回改 §8；「三个翻译服务」现为四个内置 + 读者服务；「加载环」已是骨架屏；「译文样式预设」已是配置列表 |
| L373–382 §9 待讨论 | 第 3 条（P8 两个按钮）、第 4 条（语言行原生 select 还是搜索列表） | ⚠️ 已定未删 | §4 P9 已定两个按钮；S-P-22 已定搜索菜单 |

### 2.7 THIRD_PARTY.md、docs/agents/*、docs/phase0/*、docs/superpowers/*

| 位置 | 断言 | 状态 | 证据 |
|---|---|---|---|
| THIRD_PARTY L3 | 「每个移植文件的文件头也写有同样的来源行」 | ✅ | 26 个文件带 `// 移植自 …` |
| THIRD_PARTY L19–36 | 17 行登记 | ⚠️ 不全 | 文件头自称移植 / 照搬 / 改写而**未登记**的：`src/core/scheduler/lazy.ts`（「Read Frog PageTranslationManager 的观察器骨架，改绑」）、`src/core/scheduler/title.ts`（「Read Frog page-translation.ts 里 document.title 那一段的改写」）、`src/providers/thinking.ts`（「照搬 KISS 的 THINKING_API_REGISTRY」）、`src/providers/glossary.ts`（「形状照 KISS 的 parseAITerms」）、`src/config/storage.ts`（「借鉴」）、`src/providers/request/config.ts`（同目录移植）；`renderer/image.ts` / `image/boxes.ts` 与 DESIGN §15.1 声称的 ImageTrans 移植关系不明（见 §2.4）。THIRD_PARTY 项目表列了 ImageTrans 快照却没有任何文件行 |
| THIRD_PARTY L29 | `skeleton.ts` 「样式移到 `styles/modes.css`」 | ✅ | `modes.css:26-47` |
| THIRD_PARTY L33 | `presets.css` v12 删减 | ✅ | 文件头一致 |
| codex-review.md | 审查信号与流程 | ⚠️ | 流程文档，与代码无关；内容自洽，但全部依赖「PR + Codex bot」这一工作流（重建期若不走 PR 则整份失效，见 §4） |
| domain.md | `CONTEXT.md` / `CONTEXT-MAP.md` / `docs/adr/`；`/domain-modeling`、`/grill-with-docs`、`/improve-codebase-architecture` | 🗑 | 三个文件 / 目录都不存在；引用的 skill 名是 mattpocock/skills 的，仓库从未使用；从初始提交起一字未改 |
| issue-tracker.md | `/wayfinder`、`/triage`、`wayfinder:map` 标签、「PRs as a request surface: no」 | 🗑 | 通用模板，从未按本仓库改；本仓库实际用 issues + 路线图 #155，无 wayfinder |
| triage-labels.md | 五个标签 | ⚠️ | 模板；标签是否真在 GitHub 建过未核（本次不访问网络） |
| phase0/rules-audit.md L4 | 「RULES_VERSION 0.4.0，11 篇，112320 个文本节点」 | 🗑 | 生成物停在 0.4.0（2026-09-04）；现 0.10.1、13 个 fixture 文件；`pnpm fixtures:stats` 随时可重生成，无需入库 |
| superpowers/plans/2026-09-07-popup-ui.md | 「直接提交到集成分支 `ui/phase-1`，不开 PR」 | 🗑 | 计划已执行完（PR #163–#168 已合），1447 行执行清单无保留价值；引用 `docs/design/canvas/Main.dc.html`（gitignore，工作树里没有） |
| superpowers/plans/2026-09-10-settings-services-appearance.md、specs/… | 配置 v12 计划与 spec | 🗑 / ⚠️ | 已执行；spec 里「[decided]」的决定（无厂商模板、即改即存、内置项可删）有些只在这里有记录，DESIGN §7.5 / §8.5 只写了结论没写理由 |

<!-- section 2 done -->

## 3. 相互矛盾

同一件事两种说法。「实际情况」以 HEAD 代码为准。

| # | A 位置 | B 位置 | 两种说法 | 实际情况 |
|---|---|---|---|---|
| 1 | RESEARCH L101（§2.9）、L473–476（§6.11「§2.9 对内联 SVG 仍成立」）；DESIGN L152（§5.2）、L891（§15.1） | DESIGN L1003（§15.6） | A：SVG / TikZ 图没有可翻译文字，v1 整体跳过；B：170 张内联图 954 个 `foreignObject` 里 199 个带真正的词，已接入图片管线 | B 是现状：`svg/foreign.ts` 存在，`latexml.ts:95` 注释已改；A 四处未同步 |
| 2 | DESIGN L3（头部「v0.6 把 provider 请求移到 content」）、L58（架构图 `[cache?]` 在 content）、L829（Phase 3「provider 请求移到 content」） | DESIGN L563–577（§8.0）、L81、L741 | A：请求与缓存在 content；B：全部在 background | B（`shared/transport.ts` 只是消息代理；`background/index.ts` 持链与 Dexie） |
| 3 | DESIGN L710（§8.4「content 调 `FallbackService.reset()`」） | DESIGN L734（§8.5「`FallbackService` 没有 `reset()`」）；`fallback.ts:38` | 有 / 没有 `reset()` | 没有；`axt:engine-ready` 重建整条链 |
| 4 | DESIGN L700（§8.3「google-web 速率压到 2 请求/秒、突发 2；**不攒批**（只让 LLM 攒）」）、L783（§10「只有 LLM 攒批」） | DESIGN L682（§8.3「`maxConcurrent: 2`，`rate: 20 / capacity: 8`」）、L665（§8.2「每个 provider 都建 `BatchQueue`」） | 两套数字、攒不攒批相反 | `google-web.ts:85-86` rate 20 / capacity 8 / maxConcurrent 2；`translate-service.ts:183-186` 每个 provider 都攒 |
| 5 | DESIGN L920（§15.2「`wxt.config.ts` 没写最低 Chrome 版本」） | DESIGN L464（§7.4b「本项目 131 的下限」）、L529（§7.7「`minimum_chrome_version` 是 131」）；`wxt.config.ts:31` | 有没有最低版本 | 有，131 |
| 6 | DESIGN L640（§8.1 内置翻译「Chrome 138+」）、L911（「内置翻译 API 已要求 138+」）；旧版 CLAUDE.md「浏览器目标 Chrome 138+」 | `wxt.config.ts:31` 131；DESIGN L464 / L529 | 138 还是 131 | 安装下限 131（锚点定位），内置翻译在 131–137 上只是 `isAvailable()` 为假；文档从未把两个数字放在一起解释 |
| 7 | DESIGN L884（§15「helper 没检测到时 … 设置项**不再**整节灰掉」） | DESIGN L948（§15.4「检测不到则设置项灰掉、图片翻译静默不跑」） | 灰 / 不灰 | 不灰：显示安装引导（UI.md S-P-86、S-O-27，`HelperSetup.tsx`） |
| 8 | DESIGN L648（§8.1「§8.5 的协商是顺序相关的，#103 之前要先改成首选决定格式」） | DESIGN L727–732（§8.5「格式由首选引擎决定，顺序无关」，2026-09-09）；`providers/index.ts` 注释 | 顺序相关 / 无关 | 已顺序无关；L648 是改之前的话 |
| 9 | DESIGN L416（§7.3「stack 默认布局」）、L747（§9 v1 形状） | `config/schema.ts:110` `mode: 'side'`；UI.md L99（S-P-70「新装的默认也是左右」） | 默认 stack / side | side（2026-09-11 用户拍板） |
| 10 | DESIGN L863（§13 GPL 头模板中文「移植自 …」） | CLAUDE.md L81（英文「Ported from …」） | 两种模板 | 26 个文件全是中文模板；英文模板 0 个 |
| 11 | CLAUDE.md L16（`@ai-sdk/anthropic` / `@ai-sdk/google`）、L47（`anthropic.ts gemini.ts`） | DESIGN L646（§8.1「暂不实现」）；`package.json` | 有 / 无这两个 provider | 无 |
| 12 | CLAUDE.md L67（硬规则 3 `preservesMarkup`） | DESIGN L32、L43–44（`wireFormats` 集合，三条路径）；`providers/types.ts:66` | 布尔位 / 集合 | 集合；`preservesMarkup` 已不存在 |
| 13 | CLAUDE.md L47、L68（`google-gtx`） | DESIGN L17、L652（gtx 不接，`google-web`） | gtx / translateHtml | translateHtml（`google-web.ts`） |
| 14 | CLAUDE.md L15（注入浮层用 WXT `createShadowRootUi`） | DESIGN L833（PR 2b「改用几十行原生 DOM + Shadow DOM」）；`renderer/failed.ts` | 用 / 不用 WXT 的 Shadow UI | 不用；原生 `attachShadow` |
| 15 | CLAUDE.md L220（「仓库根 `CONTEXT.md` + `docs/adr/`」） | `docs/agents/domain.md` L11（「不存在就静默跳过」）；文件系统 | 有 / 无 | 无 |
| 16 | DESIGN L757（§10 设置页「预翻译距离（0–10000px，步进 100）」「可见阈值（0–1）」数字框） | UI.md L159–160（S-O-50/51 刻度 半屏…三屏 / 刚露出…完全露出）；`Reading.tsx:98-109` | 数字框 / 刻度 | 刻度 |
| 17 | DESIGN L749（§9 配置回退「popup 顶部挂一条红色警告」） | UI.md L114（S-P-34 已移除）、L125（S-O-02 在设置页顶部） | popup / 设置页 | 设置页 |
| 18 | DESIGN L710（§8.4「下载入口只放在 popup」） | UI.md L128（S-O-11 设置页 Chrome 卡「下载」）；`Services.tsx:31` | 一处 / 两处 | 两处 |
| 19 | DESIGN L565、L600（「设置页的连接测试 / 测试连接」） | UI.md L47、L136（「连接」= 保存 + 验证，无保存按钮） | 测试连接 + 保存 / 一个「连接」 | 一个「连接」，即改即存 |
| 20 | DESIGN L637（§8.1 openai-compat「OpenRouter（默认端点）… 默认模型取便宜快速档，设置页可改」） | DESIGN L721（§8.5「厂商模板不做，读者填三个字段」）；UI.md S-O-16；`schema.ts:106` `services: []` | 有 / 无默认端点与模型 | 无；`host_permissions` 里的 `openrouter.ai` 是遗留 |
| 21 | UI.md L331（§7「§8.1 默认 provider 改为 `google-web`」） | UI.md L91（S-P-46「Microsoft is the shipped default」）；`schema.ts:105` | google-web / microsoft | microsoft |
| 22 | UI.md L114（「Removed 2026-09-10: … S-P-34」） | UI.md L356（§8「配置读取失败提示 … S-P-34，P10」） | 已删 / 仍列 | 已删；§8 编号列整体未随 §3 重编号（见 §2.6） |
| 23 | DESIGN L604（provider id 联合类型五个字面量） | DESIGN L642（`microsoft`）、L721（服务 id 当引擎 id）；`types.ts:58` `id: string` | 封闭 / 开放的 id | 开放 |
| 24 | DESIGN L740（§9 缓存键七项，「`CACHE_KEY_VERSION` 升到 3 … 改名时再升到 4」）；CLAUDE.md L70 | DESIGN L662（§8.2 `promptKey` 与上下文进键）；`cache/key.ts:1,70` | 七项 / 九项；版本 4 / 6 | 九项 + `CACHE_KEY_VERSION = 6`（5：句子标记进键，6：§8.6） |
| 25 | DESIGN L747（配置到 v12） | UI.md L308（「配置 v13 加 `uiLanguage`」）；`schema.ts:9` | v12 / v13 | v13 |
| 26 | DESIGN L531（§7.7「目前只有微软报」句边界） | DESIGN L555（「微软，以及 #137 之后的 Google」）；`providers/sentence-markers.ts` | 一家 / 两家 + 服务层插标记 | 后者 |
| 27 | DESIGN L119、L802；RESEARCH L13（「10 篇 fixture」） | DESIGN L158、L166 等（「12 篇」）；`tests/fixtures/arxiv/` | 10 / 12 | 12 + 1 合成 |
| 28 | RESEARCH L280（「gtx 声明 `preservesMarkup: true`；translateHtml 不值得作为独立 provider」）、L756（§7 第 16 行） | RESEARCH L360（§6.6）、L762（第 23 行）；DESIGN L652 | 用 gtx / 用 translateHtml | translateHtml |
| 29 | RESEARCH L160（§3.2「side 只需覆盖 `--main-width`」）、L752（第 12 行） | DESIGN L407（「只覆盖 `--main-width` 不动轨道会横向溢出」） | 一个变量 / 重写 body 网格三个 token | 后者 |
| 30 | RESEARCH L616–630（§6.11「v1 只画 90° 的倍数，`quarterTurn`」） | DESIGN L986（§15.5「每一段都画，按它自己的轴」，2026-09-11） | 丢 / 画 | 画；`quarterTurn` 已不存在 |
| 31 | CLAUDE.md L199（`fixtures:stats` 「待创建」） | RESEARCH L6、L25（脚本已在用） | 待创建 / 已有 | 已有 |
| 32 | DESIGN L143–147（§5.2 把 `math` / `.ltx_tag` / `.ltx_font_typewriter` 列为跳过） | DESIGN L224（§5.6「`math` 只出现在 PROTECT」）、L239（§6.1 void）；`latexml.ts:133-137` | skip / protect | protect |
| 33 | DESIGN L703（§8.3「即时引擎」写成已定约定，「用户可在设置里关闭」） | DESIGN L699、L722（链只在失败时降级）；RESEARCH L758（第 21 行只是建议「是否采纳取决于取舍」）；`fallback.ts` | 先内置后 LLM 替换 / 纯降级链 | 纯降级链；没有开关 |
| 34 | DESIGN L539（§7.7「`styleVarsRule` 从 `config.style.accent` 改写 `--axt-green`」）、L489–493（§7.5 v9 段） | DESIGN L481（§7.5「`data-axt-style` 与 `--axt-accent` 退役 … `appearanceRule()`」）；`style-preset.ts` | v9 的 `style` / v12 的 `appearance` | v12 |
| 35 | DESIGN L302（§7.1「原节点只允许追加 `data-axt-id` / `state` / `inline`」） | DESIGN L187（`data-axt-partial`）、L325（`data-axt-note`）、L432（`data-axt-identity`）；属性统计 | 三个 / 六个以上 | 六个以上（都带 `data-axt-` 前缀，精神成立、清单失效） |
| 36 | DESIGN L208（§5.4 年份「装在自己的成对占位符里」） | `latexml.ts:153-158`（`bib-year` 作 void，Codex #74） | paired / void | void；§6.1 列表没登记 |
| 37 | 代码 18 处「§8.6」（`cache/key.ts:49,65`、`types.ts:11,82`、`translate-service.ts` ×7、`microsoft.ts:175`、`latexml.ts:283`、`pipeline/sentences.ts`、`run.ts:172`、两个测试） | DESIGN 标题清单：§8 只有 8.0–8.5 | 有 / 无 §8.6 | **DESIGN 没有 §8.6**；句子对齐 / 句子标记的设计只在代码注释里 |

<!-- section 3 done -->

## 4. 错误限制

「引入原因」按 `git log -S` 找到的首次出现提交。「必须保留」列只标安全、隐私、许可证、API key 与 DOM 可逆这类不随重建改变的要求。

| 位置 | 规则 | 引入原因 | 是否仍成立 | 建议 | 必须保留? |
|---|---|---|---|---|---|
| CLAUDE.md L5；DESIGN L5；UI.md L3 | 「DESIGN.md 是唯一事实来源，任何与它冲突的实现都是错的；要改设计先改文档」 | `eccef7a` 2026-09-03 初始提交 | ❌ 已被事实推翻：代码有 DESIGN 没有的 §8.6，默认模式 / 默认服务 / 缓存键版本 / 配置版本都与它不符（§2、§3）；也与重建规则「旧文档是证据不是模板」直接冲突 | 改写为「DESIGN.md / UI.md 是重建前的设计记录；重建期以 ADR + 行为基线为准，重建完成后再决定新的事实来源」 | 否 |
| CLAUDE.md L10 | 「技术栈（固定，不要另选）」 | `eccef7a` | ⚠️ 栈本身稳定，但表内三项错（AI SDK 包、`createShadowRootUi`、缺 Tailwind） | 改成「当前技术栈」事实表；只把有理由的约束留下（MV3、Chrome ≥131、不写 polyfill） | 否 |
| CLAUDE.md L26 | 「不从零实现：请求队列、重试退避、hash、存储封装、JSON 解析容错」 | `2ae9764` 2026-09-03 | ⚠️ 已全部移植完成，规则已「用尽」；重建若重写这些模块，规则会逼着再抄一遍 | 改为「以下模块是移植件，改动时保留来源标注」 | 否（来源标注部分见下） |
| CLAUDE.md L77–82；DESIGN L861 | 「默认优先移植参考仓库；原创的例外只有三种」 | `2ae9764` | ❌ 项目已大幅偏离参考实现（renderer / protector / svg / image / sentences 全是原创，DESIGN §12 的「不搬」清单也证明逐项判断才是实践）；`reference/` 在工作树里不存在（gitignore） | 改为「参考仓库是证据来源；搬不搬看有无负面影响（用户记忆已有此判据）」 | 否 |
| CLAUDE.md L81；DESIGN L863；THIRD_PARTY | GPL §5 来源行 + THIRD_PARTY 登记 | `2ae9764` | ✅ 法律要求 | 保留；统一一种模板（现全是中文模板，CLAUDE.md 要求英文）；补登记 §2.7 列出的缺口；补 LICENSE 文件 | **必须保留** |
| CLAUDE.md L88 | 「超过 100 行的模块先 plan mode，方案引用 DESIGN.md 章节」 | `eccef7a` | ❌ 为从零起步设计；重建期每个模块都超 100 行，且「引用 DESIGN 章节」与上条冲突 | 用重建自己的计划节奏（charter / ADR / PROGRESS）替代 | 否 |
| CLAUDE.md L89–107 | 「一个模块一个分支 / PR，而且要小」+ 九个 PR 的 Codex 轮次统计表 | `eccef7a`（规则）；`67711a5` / `941d1c2` / `ed456b3` 2026-09-09（数据） | ⚠️ 数据真实但只对「每个 PR 过 Codex」的流程成立；ui/phase-1 已经用集成分支绕过它；重建也在 `rebuild/v1` 分支上 | 表格移到 ADR 或 codex-review.md 作参考；规则改为「合入 main 的单位要小」 | 否 |
| CLAUDE.md L108–114 | 自查三条（四步闸门 + e2e、加约束先 grep、把 diff 当别人的读）；一批修复只叫一次审查 | `67711a5` | ✅ 前三条是通用卫生；「一次审查」是 Codex 专属 | 保留三条自查，去掉 Codex 措辞 | 否 |
| CLAUDE.md L115–129 | 「Do not wait on review to start the next independent PR」+ 依赖判定 | `7aa3801` 2026-09-09 | ⚠️ 只对 PR 队列成立 | 缩成一句「分支间有类型 / 行为依赖时从上游分支开」 | 否 |
| CLAUDE.md L130–138 | 「测量并行给子代理，实现自己写」 | `7aa3801` | ⚠️ 经验之谈，理由仍成立（上下文完整性） | 降为建议 | 否 |
| CLAUDE.md L139 | 闸门 `typecheck && lint && test && build`，与 CI 一致 | `eccef7a`（三步）→ 09-08 加 typecheck | ✅ | 保留 | 建议保留 |
| CLAUDE.md L140、L210–212；codex-review.md | 合并前必须等 Codex 终态信号 | `eccef7a` | ⚠️ 用户记忆确认偏好；但只在走 PR 时适用 | 保留为「凡开 PR 都等」；重建分支内部提交不适用 | 用户偏好，保留 |
| CLAUDE.md L141–142 | 「遇到 [待验证] 先实测写 RESEARCH」「发现 DESIGN 与实测不符：停下记录、不要默默改设计」 | `eccef7a` | ❌ DESIGN 已无 [待验证]；「不要改设计」与重建规则冲突 | 换成重建的证据规则：不符就写进 INVENTORY / ADR，然后改 | 否 |
| CLAUDE.md L143–160 | 开发者可见文本一律英文；三类中文例外 | `49759c4` 2026-09-09 | ✅ 用户记忆确认 | 保留；删掉「858 行 / 656 行」这类过期数字与「改哪段转哪段」的增量说明（重建是整文件重写） | 用户偏好，保留 |
| CLAUDE.md L164–181 | Phase 0 任务清单（七项） | `eccef7a` | 🗑 全部完成 | 删除；RESEARCH.md 头部一句「Phase 0 已完成」足够 | 否 |
| CLAUDE.md L185–200 | 常用命令 | `eccef7a` | ❌ 缺 7 个脚本、「待创建」过期 | 从 `package.json` 重生成 | 否 |
| CLAUDE.md L204–220；docs/agents/{domain,issue-tracker,triage-labels}.md | Agent skills 四条 | `eccef7a` | 🗑 三份是 mattpocock/skills 模板，从未适配（`/wayfinder`、`CONTEXT.md`、`docs/adr/` 都不存在） | 删 domain / triage；issue-tracker 改成一句「issues 与路线图 #155 用 `gh`」；codex-review 保留 | 否 |
| CLAUDE.md L65 硬规则 1；DESIGN §7.1 | DOM 不变量（兄弟插入、原节点只加 `data-axt-*`、恢复后逐节点相等） | `eccef7a` | ✅ 是产品核心承诺，有测试；但 §7.7 已放宽两处（`<body>` 上的色带层与面板），清单式表述（三个属性）失效 | 保留原则，改写为「原文档子树不改、所有注入带前缀、`restore()` 逐节点相等」并把放宽处写进去 | **必须保留（产品不变量）** |
| CLAUDE.md L66 硬规则 2 | `ltx_*` 只在 `rules/latexml.ts` + CSS | `eccef7a`；测试 2026-09-06 | ✅ 有 `selector-boundary.test.ts` 守 | 保留 | 建议保留 |
| CLAUDE.md L67 硬规则 3 | `preservesMarkup` 决定路径 | `eccef7a` | ❌ 字段已换成 `wireFormats` | 改写为「路径由 provider 声明的 `wireFormats` 协商，不在渲染层写 provider 特判」 | 否（原则保留，措辞改） |
| CLAUDE.md L68 硬规则 4 | 免费接口独立文件、独立错误类型、失败可恢复 | `eccef7a` | ✅ 原则成立；文件名错 | 改文件名 | 建议保留 |
| CLAUDE.md L69 硬规则 5 | `axt-` / `data-axt-` / `--axt-` 前缀 | `eccef7a` | ✅ | 保留 | 建议保留 |
| CLAUDE.md L70 硬规则 6 | 缓存键必须含七项，改 prompt / 规则升版本 | `eccef7a` | ✅ 原则成立；清单缺 `promptKey` / `context` / `CACHE_KEY_VERSION` | 更新清单 | 建议保留 |
| CLAUDE.md L71 硬规则 7；DESIGN L575、L740、L747 | API key 只存 WXT storage，不进日志 / 缓存键 / fixture / git；不进 content 世界 | `eccef7a` | ✅ | 保留；顺带决定 `google-web.ts:13` 那个 KISS 公开 key 常量算不算「进 git」（RESEARCH L219 说是公开 key） | **必须保留（隐私）** |
| DESIGN L6 | 标记图例 [决定] / [待验证] / [延后] | `eccef7a` | ⚠️ [待验证] 已无实例 | 重建文档换一套状态词 | 否 |
| DESIGN L14–22 | v1 范围：仅 Chrome、仅 `arxiv.org/html/*`、非目标清单 | `eccef7a`；09-07 加图片翻译 | ✅ 范围决定，不是错误限制 | 保留（重建 charter 引用） | 范围，保留 |
| DESIGN L30、L840、L865 | 不做通用 DOM walker；其他站点留 v2 | `eccef7a` | ✅ 范围决定 | 保留 | 范围，保留 |
| DESIGN §12（L806–847） | 阶段计划 Phase 0–4 | `eccef7a`、09-05 | 🗑 计划已执行，含错误项（Phase 3「移到 content」、Phase 2 `generateObject`、Phase 0 未勾的复选框） | 整节归档；保留「不搬的取舍」那一段（L834–840）作 ADR 素材 | 否 |
| DESIGN §6.4 L280 | 克隆不带行为（删 `on*`、`javascript:`、`data:text/html`） | 2026-09-11 审计 | ✅ 安全不变量 | 保留 | **必须保留（安全）** |
| DESIGN §7.4b | 译文标 `lang` / `dir`；装饰副本 `aria-hidden` + `inert`；不改原文档修无障碍 | 2026-09-06 / 09-11 | ✅ | 保留 | **必须保留（无障碍）** |
| DESIGN §7.5 L491、L495 | 颜色白名单 `sanitizeColor`；高级 CSS 拒绝 `{ } @ <` | 2026-09-08 / 09-10 | ✅ 防误伤（作者自称非安全边界） | 保留 | 建议保留 |
| DESIGN §8.0 L575 | API key 不进入 content script 内存 | 2026-09-06 | ✅ | 保留 | **必须保留（隐私）** |
| DESIGN §15.4 L949 | `nativeMessaging` 暂作必需权限，分发时改可选 | 2026-09-07 | ✅ 决定仍成立，待分发 | 保留 | 否（权限策略，分发时再定） |
| codex-review.md L68 | 合并方式固定 merge 不 squash，合并前问用户 | 09-05 | ✅ 用户偏好（记忆确认） | 保留 | 用户偏好，保留 |
| UI.md L343 | 「主线每加一个功能先在 §8 登记一行；没有落点的功能不算设计完成」 | 2026-09-07 | ⚠️ 原则可以，表已失效 | 保留原则、重做表 | 否 |
| UI.md §1 L12 | 界面不出现 provider / 引擎 / 降级 / 块 / 会话等词 | 2026-09-07；`tests/ui/strings.test.ts` 守 | ✅ 用户记忆确认 | 保留 | 用户偏好，保留 |

<!-- section 4 done -->

## 5. RESEARCH.md §7「DESIGN.md 修订清单」逐行状态

表在 RESEARCH L739–767，行号编号不连续（1–17、21、18、19、22、23、20、24–27，按文件顺序）。状态：✅ 已落实 · ⚠️ 部分 / 被更好的方案取代 · ❌ 未落实或方向反了 · 🗑 已被后续行废止。

| # | 条目 | 状态 | 落实处 / 说明 |
|---|---|---|---|
| 1 | §5 去掉 [待验证] | ✅ | DESIGN 全文无标记 |
| 2 | 删 `.ltx_abstract .ltx_p` 等三条 | ✅ | DESIGN L127「不单列规则」；`UNIT_RULES` 只有 `.ltx_p` |
| 3 | 新增 `.ltx_acknowledgements`、`.ltx_keywords`；`.ltx_subtitle` 并入标题 | ✅ | DESIGN L128、L133–134；`latexml.ts:36,44,45` |
| 4 | `.ltx_p` 可能是 `<span>` | ✅ | DESIGN L127 |
| 5 | 脚注嵌套块 | ✅ | DESIGN L112、L130；`descend: true` |
| 6 | `.ltx_author` / `.ltx_date` 不存在，换成 `.ltx_creator …`；保留 `.ltx_authors` / `.ltx_contact` | ⚠️ 被取代 | 2026-09-04 作者区改为默认翻译（DESIGN L136），跳过表已无作者区条目；`.ltx_date` 因合成 fixture 又加回 `authorinfo`（`latexml.ts:50`） |
| 7 | 新增跳过 `.ltx_pubnotes`、`svg, .ltx_picture`、`.ltx_listing_data` | ✅ | DESIGN L146、L151–152；`latexml.ts:87,92,95`（`svg` 现在交给图片管线，规则仍是 skip） |
| 8 | 根外一律不提取，不列页头页脚选择器 | ✅ | DESIGN L121 |
| 9 | 数值格正则修正 | ✅ | DESIGN L189–191 |
| 10 | LaTeXML 版本：保留分叉机制，fixture 记录生成器版本 | ✅ | DESIGN L217 |
| 11 | §6.1 void 必须进 `PROTECT_RULES` | ✅ | DESIGN L239；`latexml.ts:132` |
| 12 | §7.2 用 `--main-width` 覆盖宽度 | ⚠️ 被取代 | DESIGN L407：只覆盖变量会溢出，改为三个 token 重写 body 网格；RESEARCH 这一行本身已过期（§3 第 29 条） |
| 13 | 自动降级阈值改 1280px | ✅ | DESIGN L408；`responsive.ts:6` |
| 14 | grid 只对 `.ltx_para > p.ltx_p` 生效，其余降级 stack | ⚠️ 被取代 | DESIGN L341 改为结构判定 + subgrid，覆盖面远大于此；`span.ltx_p` / 表格内仍 stack（L394） |
| 15 | `google-gtx` `preservesMarkup: true` | 🗑 | gtx 未接；字段已换 `wireFormats` |
| 16 | translateHtml 不建议新增 | ❌ 方向反了 | 被同表第 23 行与 §6.6 推翻；本行未标废止 |
| 17 | `chrome-builtin` 保留标签；`isAvailable()` 约定；不确定态提示；归一化「。 」 | ✅ | DESIGN L640、L707–712 |
| 21 | 内置引擎作视口首屏即时引擎，LLM 到达后替换 | ❌ | DESIGN L703 把它写成 [决定]，但代码没有「先内置后替换」的双写，链只在失败时降级（§3 第 33 条）；要么删掉 L703，要么立项 |
| 18 | §11「fixture 覆盖多年份」改「多领域多结构」 | ✅ | DESIGN L802 |
| 19 | §14 arXiv JS 风险降为低 | ✅ | DESIGN L878 |
| 22 | ~~fetch 移到 content~~ | ✅ 已标废止 | 与 24 一致 |
| 23 | 用 translateHtml 取代 gtx | ✅ | DESIGN L652；`google-web.ts` |
| 20 | ~~SVG 整体跳过~~ superseded by 27 | ✅ 已标 | — |
| 24 | 请求跑在 background、抽离 transport | ✅ | DESIGN §8.0；issue #42 |
| 25 | 微软通道可接入 `['markers']`，从非目标表移出 | ✅ | DESIGN L22、L642 |
| 26 | provider 加「目标语言能不能翻」判定，`buildChain` 与设置页据此过滤 | ✅（换了形式） | DESIGN L650 决定复用 `isAvailable()` 不加成员；`microsoft.ts` 支持表；UI S-P-32c / S-P-44 |
| 27 | §15.1「跳过 SVG」收窄到内联 SVG，外链 SVG 走字形读取 | ✅ 且已超出 | DESIGN §15、§15.5；§15.6 又把内联 TikZ 也接进图片管线——RESEARCH 第 27 行与 §6.11 L473–476 现在**低估**了范围 |

另：RESEARCH §6.11 末「Revision to DESIGN.md §15.1」（L724–731）✅ 已落实。

<!-- section 5 done -->

## 6. 命名一致性

已知约定：显示名 **Read arXiv**（带空格）；仓库 / 域名 **ReadarXiv** / readarxiv.org（UI.md L68、L375）。

| 出现处 | 写法 | 一致? | 说明 |
|---|---|---|---|
| `wxt.config.ts:21`（manifest `name`） | Read arXiv | ✅ | — |
| `src/locales/en.ts:10`、`zh-CN.ts:8`、`index.ts:14` | Read arXiv | ✅ | — |
| UI.md L68、L375 | Read arXiv / ReadarXiv / readarxiv.org | ✅ | 约定的出处 |
| UI.md L68（引用路线图 #155「the product becomes Readarxiv」） | Readarxiv | ⚠️ | 引文里的第三种大小写；UI.md 自己解释为「身份不是字符串」 |
| `src/ui/strings.ts:159,161` | ReadarXiv | ✅ | 安装命令里的仓库 URL |
| `helper/README.md:12` | `SRjoeee/ReadarXiv` | ✅ | 仓库 URL |
| `helper/README.md:17` | `~/Library/Application Support/Readarxiv/helper` | ❌ | 磁盘目录名用了第三种大小写 **Readarxiv**（安装脚本实际写入的路径，读者看得见；与仓库名 ReadarXiv 不一致）——需核对 `helper/install*.sh` 实际用的字符串 |
| `docs/superpowers/plans/2026-09-07-popup-ui.md:16`、`…settings-services-appearance.md:498` | Readarxiv | ❌ | 计划文档写于 09-10，早于 09-11 定名；文档可归档 |
| CLAUDE.md L1、DESIGN.md L1 | arXiv HTML Translator | ❌ | 旧名；两份主文档标题未改 |
| `helper/Package.swift:2` | arXiv HTML Translator | ❌ | 旧名（注释） |
| `package.json:2` | `arxiv-html-translator` | ❌ | 旧 slug，`version 0.0.0`，无 `license` / `description` 字段 |
| `docs/phase0/rules-audit.md:2` | `/Users/cheongzhiyan/Developer/ArxivTranslate` | ❌ | 生成报告把本机绝对路径（旧目录名 ArxivTranslate）提交进了仓库 |
| `public/_locales/{en,zh_CN}/messages.json` | 只有描述，无名字 | ✅ | 名字由 manifest 给 |
| README.md / LICENSE | **不存在** | ❌ | 仓库门面（#167）未做；DESIGN L863 自称 GPL-3.0 但无 LICENSE 文件 |
| `axt-` 前缀、`axt-helper` | — | ✅ | 内部前缀，与产品名无关，无需改 |

结论：显示名与仓库名在代码里一致；**三处旧名**（CLAUDE.md、DESIGN.md、Package.swift）、**一处 slug**（package.json）、**一处第三种大小写**（helper 安装目录 `Readarxiv`）需要统一。

<!-- section 6 done -->

## 7. 没看懂或待核实的

1. **§8.6 到底是什么**：代码 18 处引用「§8.6」（句子对齐 / 句子标记 / `CACHE_KEY_VERSION` 5→6 的理由），DESIGN 没有这一节。重建时要从 `cache/key.ts:49-65`、`providers/types.ts:11,82`、`translate-service.ts:244-261`、`providers/alignment.ts`、`providers/sentence-markers.ts`、`core/sentences/index.ts` 的注释把它反推出来写成 ADR。
2. **ImageTrans 是否真被移植**：DESIGN §15.1 L894 说叠加层移植自 ImageTrans `getImage.js`，但 `renderer/image.ts` / `image/boxes.ts` 文件头没有来源行，THIRD_PARTY 无文件行，§15.2 L911 又说不用它的字号算法。`reference/` 在工作树里不存在（gitignore），无法比对；这是 GPL §5 合规问题，重建前要定性（重写 → 改文档；移植 → 补登记）。
3. **THIRD_PARTY 的其他缺口**（§2.7）：`scheduler/lazy.ts`、`scheduler/title.ts`、`providers/thinking.ts`、`providers/glossary.ts`、`config/storage.ts`、`request/config.ts` 文件头自称移植 / 照搬 / 改写，但没登记；需要人判断「改写幅度大到不像原文件」的边界。
4. **两个数字的关系**：manifest `minimum_chrome_version: '131'`（锚点定位）与「内置翻译 138+」从未在同一处解释；131–137 上的行为（内置引擎永远不可用、popup 提示什么）未核。
5. **`google-web.ts:13` 硬编码的 `API_KEY`**：RESEARCH L219 称是 KISS 内置的公开 key。硬规则 7「API key 永不进 git」按字面被违反；需要用户定性（公开常量豁免，还是改成运行时取）。
6. **`paperContext()` 截到 1200 字符**（DESIGN L661）：`pipeline/paper.ts` 未见 1200 字面量，可能常量化或改了，未细读。
7. **`cacheId = openai-compat:<origin><path>`**（DESIGN L740）在 v12「服务 id 当引擎 id」之后是否还在用，未核（`types.ts:95` 字段仍在）。
8. **popup 状态表 P0–P15**（UI.md §4）与 `popup/view-model.ts` 的逐状态对应未核；`fixtures.ts` 里有 17 处 `P<n>`。
9. **GitHub 侧**（未访问网络）：triage 标签是否存在；路线图 #155 与 #167 现状；RESEARCH 两条 `[待验证]`（L413 冷启动、L434 429 退避期 worker 存活）与 L436（worker 里 `Translator.create()`）三个开放实测项是否已在 issue 里跟踪。
10. **reminder 里的 CLAUDE.md 与 HEAD 不同**（有「Chrome 138+」段、三步闸门、中文来源模板）：`git log -S"Chrome 138+" -- CLAUDE.md` 为空，说明那段从未提交——它来自主检出里未提交的 `M CLAUDE.md`（会话开始的 git status）。哪一份是用户想要的版本，需要确认。
11. **代码注释里的陈旧引用**（不属文档范围，顺带记）：`wxt.config.ts:4`「host_permissions 等到 Phase 3 接网络引擎时再加」；`renderer/index.ts:53,76`、`content/index.ts:87` 提 `data-axt-style`（已退役）；`tests/svg/glyphs.test.ts:49`「corpus has exactly two orientations」（RESEARCH §6.11 已更正为 42 种角度）。
12. **DESIGN §7.5 L489–493 的定位**：它讲 v9 的 `style.color / opacity / accent` 与 `styleVarsRule`，没有标「历史」；v12 的 `appearance` 是否完整继承了「不改 modes.css、不写 `<html>` 内联 style、`sanitizeColor` 白名单」这三条纪律，要读 `style-preset.ts` 确认。
13. **UI.md §8 编号列**大面积失效（§2.6），但我没有逐条重排——需要和 §3 表一起重做，不是修几个数字。
14. **helper 安装目录的大小写**（§6）：要看 `helper/install-remote.sh` / `install.sh` 实际写的路径，README 可能只是笔误。

<!-- section 7 done -->

## 统计

- 读取文档：CLAUDE.md 220 + DESIGN.md 1015 + RESEARCH.md 767 + UI.md 382 + THIRD_PARTY.md 38 + agents 194 + rules-audit.md 656（抽样）+ superpowers 2257（抽样头部）≈ 5529 行；DESIGN / RESEARCH / UI / THIRD_PARTY / agents 全读。
- 陈述核对：❌ 约 58 条（CLAUDE.md 15、DESIGN 30、RESEARCH 5、UI.md 6、其他 2）、⚠️ 约 60 条、🗑 约 14 条。
- 相互矛盾：37 对。
- 错误限制：33 条，其中 6 条标「必须保留」（GPL 来源标注、API key、DOM 不变量、克隆不带行为、无障碍属性、key 不进 content）。
- 单元测试实跑：109 文件 / 1518 通过（DESIGN 写「1400 多」）。

<!-- audit complete -->
