<!-- Raw inventory written by a read-only agent on 2026-09-12 against main @ e6de3e1 — one merge before the v0.3.0-mvp baseline (8cfd771). PR #168 later touched src/core/rules/latexml.ts, src/core/extractor/index.ts, src/core/renderer/{index,pending,failed}.ts and src/styles/modes.css, so line numbers in those files have shifted slightly. Kept verbatim (Chinese) as the evidence behind docs/rebuild/INVENTORY.md, which lists the claims that were spot-checked. Delete this file when the rebuild retires the code it describes. -->

# core inventory — started 2026-09-11T20:35:22Z

工作树：`/private/tmp/claude-501/.../scratchpad/wt-ui`，HEAD = origin/main = e6de3e1493e0f2668e6e5a61ff9d9071f606c6b6，`git status --short` 为空。

## 1. 模块地图

范围：`src/core/**` 共 60 个 TS 文件、7721 行（`wc -l`）。调用者一栏只列 **src 内**的真实调用点（`grep -rlw` 逐个导出名核过；行号是 import 行或关键调用行）；tests 的引用另计。标 ⚠️ 的导出在 src 里没有任何调用者（只被测试用或完全没人用）。

### 1.1 rules / marks / abstract

| 文件 | 行数 | 职责 | 导出 | 实际调用者（src） |
|---|---|---|---|---|
| `core/rules/latexml.ts` | 439 | **唯一**的 `ltx_*` 选择器所在地：翻译单元 / 跳过 / 保护三张规则表、表格 / 公式 / 脚注 / 图 / side 布局用的结构选择器、`classify()` 优先级判定、可见文本、数值格判定；导出 `RULES_VERSION`（进缓存键） | `RULES_VERSION` `DOCUMENT_ROOT` `UNIT_RULES` `SKIP_RULES` `PROTECT_RULES` `TABLE_RULES` `NAMED_TAGS` `classify` `isNamedTag` `documentRoot` `visibleText` `proseText` `hasTranslatableText` `isNumericCell` `tableCells` `isTableRoot` `isTableCell` `isInlineTitleCandidate` `EQUATION_TABLE` `EQUATION_PAD_CELL` `FIT_TARGETS` `FUNCTIONAL_INLINE` `LABEL_FORMATTING` `FIGURE_SELECTORS` `ANNOTATION_SELECTOR` `NOTE` `FIGURE_MEDIA` `MARGIN_ASIDE` `MARGIN_ASIDE_BOXES` `SIDE_LAYOUT` `DOCUMENT_TITLE` `DOCUMENT_SUBTITLE` `ABSTRACT` `LTX_CLASS_PREFIX` 及类型 `Rule` `ProtectRule` `RuleKind` `Classification` | `classify`：extractor/index.ts:48,68,109、extractor/context.ts:25、protector/serialize.ts:147、svg/foreign.ts:50；`documentRoot`：extractor/index.ts:90；`isNumericCell`：extractor/index.ts:80、image/boxes.ts:64；`tableCells`：extractor/index.ts:80、renderer/index.ts:259、renderer/split-figures.ts:49；`isTableRoot`：split-figures.ts:49；`isTableCell`：serialize.ts:137；`visibleText`+`isInlineTitleCandidate`：renderer/index.ts:182；`proseText`：svg/foreign.ts:74；`RULES_VERSION`：cache/key.ts:6；`DOCUMENT_ROOT`：content/index.ts:395、prep.ts:81、mirror.ts:46、notes.ts:162、split-figures.ts:143,200、table-fit.ts:90、highlight.ts:275、image/run.ts:96、context.ts:46；`SIDE_LAYOUT`：renderer/side-layout.ts:1；`NOTE`：notes.ts、margin-notes.ts、offsets.ts:178；`FIT_TARGETS`/`EQUATION_*`：table-fit.ts:18；`FIGURE_MEDIA`：split-figures.ts:66；`FIGURE_SELECTORS`：image/run.ts:101、svg/foreign.ts:87,120；`MARGIN_ASIDE`：mirror.ts:26；`MARGIN_ASIDE_BOXES`+`ANNOTATION_SELECTOR`：peek.ts:238,319、pipeline/sentences.ts:38；`FUNCTIONAL_INLINE`：runs.ts:48、serialize.ts:152；`LABEL_FORMATTING`：label.ts:91；`ABSTRACT`/`DOCUMENT_TITLE`：context.ts:47-48。⚠️ 无 src 调用者：`hasTranslatableText`（extractor 自己用 `LETTER.test(ownText())`）、`isNamedTag`（只在 `classify` 内部用，导出仅供测试）、`NAMED_TAGS` `PROTECT_RULES` `SKIP_RULES` `UNIT_RULES` `TABLE_RULES`（表本身只被测试与 `scripts/fixtures-stats.ts` 读）、`DOCUMENT_SUBTITLE`（只在本文件用）、`LTX_CLASS_PREFIX`（只有测试）、类型 `Rule` `ProtectRule` `RuleKind` `Classification` |
| `core/rules/abstract.ts` | 16 | 摘要页（`/abs/*`）两个选择器，与 latexml.ts 分开是为了不动 `RULES_VERSION` | `HTML_LINK` `ACCESS_LIST` | `HTML_LINK`：abstract/link.ts:21。⚠️ `ACCESS_LIST` 无任何调用者（src 与 tests 都没有） |
| `core/abstract/link.ts` | 47 | 摘要页「Access Paper」里插一条带 `#axt-translate` 的双语入口；改语言时重写文案 | `ABS_LINK_CLASS` `AUTO_TRANSLATE_HASH` `injectBilingualLink` `relabelBilingualLink` | entrypoints/abstract.content.ts:6（两个函数）。⚠️ 两个常量只有测试引用；`AUTO_TRANSLATE_HASH` 的值 `#axt-translate` 在 content/index.ts:465 是**手写字面量**（重复状态，见 §4） |
| `core/marks.ts` | 76 | 注入节点的四种 class 标记与 `data-axt-` 前缀；`isInjected` / `stripInjected`（克隆件清理：删注入节点、剥 id 与 data-axt-*、剥 `on*` 与 `javascript:` URL） | `T_CLASS` `IMG_CLASS` `HL_CLASS` `PEEK_CLASS` `INJECTED_SELECTOR` `AXT_ATTR_PREFIX` `isInjected` `stripInjected` | `isInjected`：extractor/index.ts:48,67,108、serialize.ts:146、offsets.ts:275、renderer/index.ts:226、mirror.ts:24,31、notes.ts:126,129、peek.ts:141；`stripInjected`：protector/clone.ts:11、renderer/index.ts:191,245、mirror.ts:61、peek.ts:235；`INJECTED_SELECTOR`：renderer/index.ts:281、mirror.ts:33、offsets.ts:178、peek.ts:138、image/run.ts:102；`AXT_ATTR_PREFIX`：renderer/index.ts:290（仅此一处；notes.ts:54、split-figures.ts:132、context.ts:24 各自手写 `'data-axt-'` / `'axt-'` 前缀） |

### 1.2 extractor

| 文件 | 行数 | 职责 | 导出 | 实际调用者（src） |
|---|---|---|---|---|
| `core/extractor/index.ts` | 143 | 从翻译根按文档序提取块（只读 DOM）；`Block` 联合类型；`markBlocks` 写 `data-axt-id`；re-export `./context` | `extract` `markBlocks` `ID_ATTR` 类型 `Block` `TextBlock` `TableBlock` `Cell` | `extract`：content/index.ts:32；`markBlocks`：content/debug.ts:16（**仅调试路径**；正式路径由 pipeline/run.ts:145 直接 `setAttribute(ID_ATTR)`，见 §4 并存路径）；`ID_ATTR`：run.ts:145、prep.ts:58、notes.ts:188,254、mirror.ts:28,37、split-figures.ts:66、anchors.ts:62、lazy.ts:79、image/run.ts:102、debug.ts:10-11；类型：batches.ts、run.ts、renderer/*、lazy.ts |
| `core/extractor/context.ts` | 56 | 页面加载时抽一次论文标题与摘要作 LLM 上下文（排除 skip、注入节点、MathML annotation） | `paperContext` `ABSTRACT_MAX_CHARS` 类型 `PaperContext` | `paperContext`：content/index.ts:34。⚠️ `ABSTRACT_MAX_CHARS`、`PaperContext` 无 src 调用者 |
| `core/extractor/stats.ts` | 26 | 块统计（popup 与测试快照共用） | `statsOf` 类型 `BlockStats` | `statsOf`：content/index.ts:433（`axt:stats` 消息）；`BlockStats`：shared/messages.ts:3 |

### 1.3 protector

| 文件 | 行数 | 职责 | 导出 | 实际调用者（src） |
|---|---|---|---|---|
| `core/protector/index.ts` | 9 | barrel | 见各文件 | pipeline/run.ts:8、batches.ts:4、renderer/highlight.ts:25、renderer/sentences.ts:15、core/sentences/index.ts:24、providers/alignment.ts:44、providers/sentence-markers.ts:31、providers/wire-formats.ts:6 |
| `core/protector/serialize.ts` | 175 | 块 → 带占位符线上文本 + 槽位表 + 线上偏移表（`makeTracker` 一边转义 / 折叠空白一边记锚点）；表格单元格例外（格内单元走 paired） | `serialize` `VOID_DENSE_THRESHOLD` 类型 `ProtectedBlock` | `serialize`：pipeline/batches.ts:80,87（唯一生产调用）；`VOID_DENSE_THRESHOLD`：batches.ts:90；`ProtectedBlock` 类型：runs.ts、rehydrate.ts、label.ts、batches.ts |
| `core/protector/tokens.ts` | 94 | DOM-free 分词器（tags / markers 两条显式循环）、id ↔ 字母双射、`writeVoid` | `tokenize` `toAlpha` `fromAlpha` `writeVoid` `TAG_RE` `MARKER_RE` 类型 `Token` `WireFormat` | `tokenize`：validate.ts:25,53、runs.ts:52、providers/translate-service.ts:14；`fromAlpha`：offsets.ts:403、core/sentences/index.ts:65；`writeVoid`：serialize.ts:161、validate.ts:63,71；`TAG_RE`/`MARKER_RE`：offsets.ts:397、providers/alignment.ts:44、providers/sentence-markers.ts:31；`WireFormat`：cache/key.ts:8、providers/types.ts:3、providers/translate-service.ts:6、providers/wire-formats.ts:6。`toAlpha` 只在本文件内 `writeVoid` 用 + 测试 |
| `core/protector/text.ts` | 62 | 文本节点转义 / 解实体 / 纯文本往返反转义；`ENTITY_PATTERN` 供 offsets 复用 | `escapeText` `unescapeText` `decodeText` `ENTITY_PATTERN` | `escapeText`+`unescapeText`：content/index.ts:269,273（标题）、image/run.ts:226,322（OCR 行）；`decodeText`：runs.ts:42,81、offsets.ts:371、providers/translate-service.ts:13；`ENTITY_PATTERN`：offsets.ts:339 |
| `core/protector/validate.ts` | 73 | 占位符完整性校验（DOM-free）；`expectationsFromText` 让 background 不带 DOM 也能挡坏译文 | `validate` `expectationsFromText` `PlaceholderIntegrityError` 类型 `PlaceholderExpectations` `IntegrityReason` `ValidationResult` | `validate`：pipeline/run.ts:222,245,268、rehydrate.ts:36、providers/translate-service.ts:15；`expectationsFromText`：providers/translate-service.ts:15；`PlaceholderIntegrityError`：rehydrate.ts:37（抛出；src 内**无人 catch 它的类型**，run.ts:206 的 `catch {}` 只在 runs 路径） |
| `core/protector/rehydrate.ts` | 72 | 译文 → DocumentFragment（克隆槽位节点），同时产出译文侧 `WireSpan[]`（挂在 fragment.offsets 上）；markers 下调 `restoreLeadingLabel` | `rehydrate` | pipeline/run.ts:222,246,268 |
| `core/protector/label.ts` | 221 | markers 格式下把块开头的 run-in 标签（`Keywords:`、`Note.`）的格式元素包回译文（issue #150） | `restoreLeadingLabel` `leadingLabel` 类型 `Boundaries` | `restoreLeadingLabel`：rehydrate.ts:70；`Boundaries`：rehydrate.ts:3。⚠️ `leadingLabel` 导出但无 src / tests 调用者（只被同文件内部用） |
| `core/protector/offsets.ts` | 411 | 线上偏移 ↔ DOM 位置：`WireSpan` 类型、锚点二分、`indexSpans`、`rangesOf`（切段、剜掉注入节点与脚注框）、`scanTokens`（带位置的分词，与 `tokenize` 平行实现） | `nodeOffsetAt` `wireOffsetAt` `spanAt` `indexSpans` `rangesOf` `scanTokens` 类型 `WireSpan` `SpanIndex` `PositionedToken` | `rangesOf`+`wireOffsetAt`：renderer/highlight.ts:25；`indexSpans`：renderer/sentences.ts:15、label.ts:120,141；`wireOffsetAt`：label.ts:120,141；`scanTokens`：rehydrate.ts:46；`WireSpan`：serialize.ts、rehydrate.ts、label.ts、run.ts、renderer/sentences.ts。`nodeOffsetAt`、`spanAt` 只在本文件内部 + 测试 |
| `core/protector/runs.ts` | 86 | runs 降级路径：按 void 切段 / 拼回；带功能元素整块保留 | `splitRuns` `joinRuns` 类型 `RunItem` `RunLayout` | pipeline/run.ts:192,193,205 |
| `core/protector/clone.ts` | 13 | `importNode` + `stripInjected` | `cloneWithoutIds` | runs.ts:83、rehydrate.ts:53,58、label.ts:217 |

### 1.4 renderer

| 文件 | 行数 | 职责 | 导出 | 实际调用者（src） |
|---|---|---|---|---|
| `core/renderer/index.ts` | 315 | 渲染核心：`<html>` 状态属性、注入样式表拼装、`renderText` / `renderTable` / `clearTranslation` / `restore`、`applyStyle`；barrel 把其余 16 个文件全部 `export *` | `enable` `setMode` `setState` `markPartial` `clearTranslation` `renderText` `renderTable` `restore` `applyStyle` `appearanceSheet` `setAppearanceAttrs` `translationClass` `shouldInline` `FOR_ATTR` `STATE_ATTR` `ON_ATTR` `MODE_ATTR` `INLINE_ATTR` `LANG_ATTR` `DIR_ATTR` `IDENTITY_ATTR` `PARTIAL_ATTR` `STYLE_ATTR` `INLINE_TITLE_MAX_CHARS` `T_CLASS`（转出）类型 `Mode` `BlockState` `Look` | `enable`：run.ts:135；`setMode`：responsive.ts:43,49；`setState`：run.ts:155、pending.ts:31、failed.ts:41；`markPartial`：run.ts:314；`clearTranslation`：pending.ts:30、failed.ts:40；`renderText`：run.ts:325；`renderTable`：run.ts:307,312；`restore`：content/index.ts:420；`applyStyle`：content/index.ts:127；`appearanceSheet`：ui/appearance/Preview.tsx；`translationClass`+`shouldInline`：pending.ts:34,36；`FOR_ATTR`：pending/failed/anchors/mirror/image/table-fit/split-figures；`IDENTITY_ATTR`：notes.ts:167；`LANG_ATTR`/`DIR_ATTR`：image.ts:141,143；`STYLE_ATTR`：content/debug.ts:18。⚠️ 无 src 调用者：`setAppearanceAttrs`（只被同文件调）、`STATE_ATTR` `ON_ATTR` `MODE_ATTR` `PARTIAL_ATTR`（值在 CSS 与 e2e 里以字面量出现）、`INLINE_TITLE_MAX_CHARS`、类型 `BlockState` |
| `core/renderer/prep.ts` | 175 | 译文到达后的增量整理（issue #46）：脏块 → 根集合；每趟先读栏宽 / 边距 / 边注位置再写；镜像每会话一次；restack 第二个合并器 | `createPrep` `rootsOf` 类型 `Prep` `PrepOptions` | `createPrep`：content/index.ts:362。⚠️ `rootsOf` 只被同文件 + 测试用 |
| `core/renderer/pending.ts` | 63 | 等待态节点（带骨架屏）插入 / 清除 | `renderPending` `clearPending` `clearAllPending` `PENDING_CLASS` | `renderPending`：run.ts:279；`clearAllPending`：run.ts:354；`PENDING_CLASS`：anchors.ts:66、notes.ts:143、split-figures.ts:33,166、table-fit（无）。⚠️ `clearPending` 无 src 调用者（run.ts 失败路径走 `renderFailed → clearTranslation`） |
| `core/renderer/failed.ts` | 88 | 失败小部件（Shadow DOM 里的重试按钮 + 「！」）、改语言重标 | `renderFailed` `clearFailed` `relabelFailed` `ERROR_CLASS` `REASON_ATTR` | `renderFailed`：run.ts:316,331；`relabelFailed`：content/index.ts:123；`ERROR_CLASS`：anchors.ts:66。⚠️ `clearFailed` 无 src 调用者（pending.ts 注释 27-29 行说明改走 `clearTranslation`）；`REASON_ATTR` 只同文件用；notes.ts:143、split-figures.ts:33,166 写的是字面量 `'axt-error'` 而不是 `ERROR_CLASS` |
| `core/renderer/skeleton.ts` | 107 | 骨架屏（移植 Read Frog spinner 的性能做法：动画上限 60、WeakMap 句柄、删前取消） | `createSkeleton` `createSkeletonInside` `cancelSkeletonAnimation` `cancelSkeletonsIn` `skeletonLines` `activeSkeletonAnimations` `SKELETON_CLASS` `SKELETON_LINE_CLASS` `MAX_ANIMATED_SKELETONS` | `createSkeletonInside`：pending.ts:41；`cancelSkeletonsIn`：pending.ts:50,59、index.ts:168,282。⚠️ 其余 7 个导出只有测试用 |
| `core/renderer/anchors.ts` | 154 | only 模式下页内锚点落到译文（issue #44）：click 捕获 / hashchange / popstate | `installAnchorFallback` `anchorWouldBreak` | `installAnchorFallback`：content/index.ts:199。⚠️ `anchorWouldBreak` 无任何调用者（注释说「供测试与调试」，tests 里也没用） |
| `core/renderer/mirror.ts` | 76 | side 模式右栏镜像（结构判定 + 五道闸），每会话一次 | `createMirrors` `MIRROR_CLASS` | `createMirrors`：prep.ts:108；`MIRROR_CLASS`：anchors.ts:66、notes.ts:167、split-figures.ts:33,156,158、image.ts:136 |
| `core/renderer/side-layout.ts` | 76 | side 配对容器 / 子树排除 / 堆叠区选择器（由 `SIDE_LAYOUT` 组合） | `SIDE_CONTAINER` `SIDE_DENY` `SIDE_DENY_SUBTREE` `SIDE_STACK` `MIRROR_CONTAINER` `MULTI_PANEL_FLEX` `isSideContainer` `isMirrorContainer` | `MIRROR_CONTAINER`+`SIDE_STACK`+`isMirrorContainer`：mirror.ts:14；`SIDE_DENY_SUBTREE`：pair-margins.ts:12。⚠️ `SIDE_CONTAINER` `SIDE_DENY` `MULTI_PANEL_FLEX` `isSideContainer` 无 src 调用者——运行时只用 `isMirrorContainer`（两者定义相同，`MIRROR_CONTAINER = SIDE_CONTAINER`），`isSideContainer` 只有测试用 |
| `core/renderer/split-figures.ts` | 212 | side 模式整张插图拆两份（签名判重建、`stripIds` 把 id 挪进 `data-axt-split-of`、把句子登记镜像到副本）；非 side 下丢过期副本 | `splitFigures` `dropStaleSplits` `outermostFigure` `SPLIT_ATTR` `SPLIT_CLASS` `SPLIT_OF_ATTR` `SPLIT_FOR_ATTR` | `splitFigures`+`dropStaleSplits`+`outermostFigure`：prep.ts:61,97,102；`SPLIT_*`：anchors.ts:50-57、notes.ts:167、image.ts:76 |
| `core/renderer/table-fit.ts` | 219 | side 模式表格 / 行间公式按档缩放（只读量法、三段读写、按栏宽 + 译文节点缓存、字体加载失效） | `fitTables` `measureColumn` `resetFitCache` `watchFontLoads` `FIT_ATTR` `FIT_BUCKETS` `MIN_FIT` `FIT_SCROLL` `LOOSEN_SLACK` 类型 `NaturalWidth` `FitDeps` | `fitTables`：prep.ts:117；`measureColumn`：prep.ts:69；`resetFitCache`：prep.ts:169；`watchFontLoads`：prep.ts:148。⚠️ 常量与类型只在本文件 + 测试 |
| `core/renderer/pair-margins.ts` | 79 | side 同行两栏上边距抄齐（读 / 写分离） | `readPairMargins` `writePairMargins` `alignPairMargins` `clearPairMargins` 类型 `PairMarginPlan` | `readPairMargins`/`writePairMargins`：prep.ts:88,111,124；`clearPairMargins`：content/index.ts:377。⚠️ `alignPairMargins`（读+写合一）无 src 调用者，只有测试 |
| `core/renderer/margin-notes.ts` | 126 | side 模式边注在沟槽里按文档序下排（量位置 → `translateY`） | `planMarginNotes` `applyMarginNotes` `clearMarginNotes` `stackShifts` 类型 `NoteBox` `MarginNotePlan` | `planMarginNotes`/`applyMarginNotes`：prep.ts:91,125,144；`clearMarginNotes`：content/index.ts:378。⚠️ `stackShifts` 只同文件 + 测试 |
| `core/renderer/notes.ts` | 261 | side 模式脚注归位：把脚注译文**复制**进段落译文里重建的副本、标记原件隐藏；把句子登记镜像到副本；撤销 | `localizeNotes` `delocalizeNotes` `NOTE_T_CLASS` `NOTE_S_CLASS` | `localizeNotes`：prep.ts:93；`delocalizeNotes`：renderer/index.ts:160。⚠️ 两个 class 常量无 src 调用者（CSS 里以字面量 `.axt-note-t` / `.axt-note-s` 出现） |
| `core/renderer/sentences.ts` | 268 | 句子登记表（WeakMap + WeakRef，按译文节点键）、副本镜像、命中查找 | `registerSentences` `mirrorSentences` `mirrorPair` `sentenceSignatureOf` `sentenceMapOf` `sentenceMapAt` `sentenceAt` `rendered` 类型 `SentenceMap` `SentenceSide` | `registerSentences`：run.ts:302,326；`mirrorSentences`：split-figures.ts:186；`mirrorPair`：notes.ts:139；`sentenceSignatureOf`：split-figures.ts:48-49；`sentenceMapAt`+`sentenceAt`+`rendered`：highlight.ts:28。⚠️ `sentenceMapOf` 无 src 调用者 |
| `core/renderer/highlight.ts` | 605 | 悬停对照高亮控制器（rAF 合帧命中、行级色带层挂 `<body>`、裁剪、重排监听：resize / scroll 捕获 / ResizeObserver / MutationObserver / fonts） | `startSentenceHighlight` `clearSentenceHighlights` 类型 `SentenceHighlight` | `startSentenceHighlight`：content/index.ts:99,201；`clearSentenceHighlights`：renderer/index.ts:91,140,278 |
| `core/renderer/peek.ts` | 328 | only 模式下悬停浮出原文面板（三档放置、600ms 驻留、失效 / 过期规则） | `createPeek` `movesText` `PEEK_DWELL_MS` `AT_ATTR` 类型 `Peek` `PeekKey` `PeekAnchor` `Mutation` | `createPeek`+`movesText`：highlight.ts:27。⚠️ 常量与类型只被测试用 |
| `core/renderer/responsive.ts` | 63 | 模式控制器：side 在 <1280px 自动退回 stack，偏好与生效分开 | `createModeController` `NARROW_QUERY` 类型 `ModeController` `ModeControllerOptions` | `createModeController`：content/index.ts:194,402。⚠️ `NARROW_QUERY` 无 src 调用者 |
| `core/renderer/style-preset.ts` | 76 | 外观契约（v12）：`<html>` 上两个开关属性、`appearanceRule` / `customStyleRule` 生成注入规则；转出 style-values | `appearanceRule` `customStyleRule` `UNDERLINE_ATTR` `BLUR_ATTR` `TRANSLATION_SELECTOR` `TOP_TRANSLATION_SELECTOR` `CUSTOM_STYLE_SELECTOR` + 转出 `sanitizeColor` `sanitizeCustomCss` `COLOR_MAX` `OPACITY_MIN/MAX` | `appearanceRule`+`customStyleRule`+`UNDERLINE_ATTR`+`BLUR_ATTR`：renderer/index.ts:13；`sanitize*`：ui/appearance/AdvancedCss.tsx、ProfileEditor.tsx、tiles.ts、config/appearance.ts。⚠️ 三个 `*_SELECTOR` 只在本文件内部用 |
| `core/renderer/style-values.ts` | 67 | 颜色 / 自定义 CSS 声明块的净化（与 config 共用，避免环） | `sanitizeColor` `sanitizeCustomCss` `COLOR_MAX` `OPACITY_MIN` `OPACITY_MAX` 类型 `CssRejection` | style-preset.ts:9、config/appearance.ts、ui/appearance/* |
| `core/renderer/image.ts` | 155 | 图片叠加层：`<img>` 后的 `.axt-img`，标签位置 / 字号全算成字符串写一次 | `renderImage` `clearImage` `clearImageEverywhere` `overlayOf` `setImageModes` `labelStyle` `emWidth` `IMG_MODES_ATTR` 类型 `ImageTarget` `ImageLabel` | `renderImage`+`clearImage`：image/run.ts:11；`clearImageEverywhere`：content/index.ts:341；`setImageModes`：content/index.ts:118,287,292；`ImageTarget`：image/run.ts:22（re-export）。⚠️ `overlayOf` `labelStyle` `emWidth` `IMG_MODES_ATTR` 只在本文件 + 测试 |

### 1.5 scheduler / pipeline / sentences / svg / image

| 文件 | 行数 | 职责 | 导出 | 实际调用者（src） |
|---|---|---|---|---|
| `core/scheduler/index.ts` | 9 | barrel | — | content/index.ts:17 |
| `core/scheduler/lazy.ts` | 165 | 一次性视口调度器（IO + 同步播种、无布局盒的块挂祖先锚点、有效阈值钳制与 5% 网格） | `createLazyScheduler` `observerThresholds` `quantizeThreshold` `THRESHOLD_STEP` `DEFAULT_PRELOAD` 类型 `LazyScheduler` `PreloadOptions` | `createLazyScheduler`：pipeline/run.ts:159、image/run.ts:402；`DEFAULT_PRELOAD`：config/schema.ts、config/storage.ts。⚠️ `observerThresholds` `quantizeThreshold` `THRESHOLD_STEP` 只在本文件 + 测试 |
| `core/scheduler/coalesce.ts` | 63 | 带最长等待与脏集合的合并器 | `createCoalescer` 类型 `Coalescer` `CoalesceOptions` | prep.ts:140,142 |
| `core/scheduler/pacer.ts` | 51 | 主线程切片（移植 Read Frog scheduler.ts） | `createWorkPacer` `pauseIfBudgetSpent` `yieldToMain` `DEFAULT_WALK_BUDGET_MS` 类型 `WorkPacer` | `createWorkPacer`+`pauseIfBudgetSpent`：pipeline/run.ts:149,156。⚠️ `yieldToMain` 只被同文件与 barrel 引用，无外部调用者；`DEFAULT_WALK_BUDGET_MS` 无调用者 |
| `core/scheduler/session.ts` | 26 | 会话 id（模块级单例） | `beginSession` `endSession` `getSessionId` | content/index.ts:160,173,190,202,227,232,238,253,266,316,338,346,458 |
| `core/scheduler/title.ts` | 65 | 标签页标题翻译 + `<head>` 观察器 + 停止时恢复 | `translateTitle` 类型 `TitleTranslator` `TitleOptions` | content/index.ts:265 |
| `core/pipeline/index.ts` | 4 | barrel | — | content/index.ts:8 |
| `core/pipeline/run.ts` | 360 | 翻译会话：块标记、状态切片、视口调度、批次 → 传输 → 校验 → 回填 → 渲染 → 句子登记；批次失败对半拆、单块重试、runs 兜底；进度 | `startTranslation` 类型 `Progress` `RunOptions` `Transport` `TranslationRun` | `startTranslation`：content/index.ts:212；`Progress`：shared/messages.ts、content/index.ts |
| `core/pipeline/batches.ts` | 103 | 批次规划（章节 / 字符预算 / 公式密集单独成批 / 表格整表一批），在这里调 `serialize` | `planBatches` `sectionTitles` 类型 `Batch` `Segment` | run.ts:136,345；`Segment`：pipeline/sentences.ts:10 |
| `core/pipeline/sentences.ts` | 46 | 决定哪些段切句、切在哪（tags 路径且非参考文献） | `cutsOf` | run.ts:176 |
| `core/pipeline/paper.ts` | 16 | URL → 论文 id（新旧两种） | `paperIdFromUrl` | content/index.ts:37 |
| `core/sentences/index.ts` | 293 | 线上文本切句（`Intl.Segmenter` + 占位符投影 + 缩写合并） | `sentenceCuts` `splitSentences` `visibleTextOf` `ABBR` `TERMINAL_ABBR` 类型 `SplitContext` `IsAnnotation` `TextOfSlot` | `sentenceCuts`+`visibleTextOf`：pipeline/sentences.ts:12；`ABBR`+`TERMINAL_ABBR`：providers/alignment.ts（吸附判定复用缩写表）。⚠️ `splitSentences` 无 src 调用者（只有测试；生产走 `sentenceCuts`） |
| `core/svg/index.ts` | 3 | barrel | — | image/run.ts:15 |
| `core/svg/glyphs.ts` | 256 | 外链 SVG 图：`<use data-text>` 字形 → 行（矩阵分解、基线分组、斜标签自带长厚） | `linesOf` `runsOf` `viewBoxOf` 类型 `GlyphRun` | `linesOf`：image/run.ts:277。⚠️ `runsOf` `viewBoxOf` 只在本文件 + 测试 |
| `core/svg/foreign.ts` | 135 | 内联 TikZ 图：`foreignObject` 里的 HTML 标签 → 行（§15.6） | `pictureTexts` `foreignLinesOf` | image/run.ts:88,286 |
| `core/svg/runs.ts` | 57 | 「像代码」的行过滤 | `looksLikeCode` | image/run.ts:277,286 |
| `core/image/index.ts` | 3 | barrel | — | content/index.ts:6 |
| `core/image/boxes.ts` | 108 | OCR / 字形行 → 译文框（合并相邻行、过滤数值与单字母） | `linesToBoxes` `isTranslatable` `quadBounds` 类型 `Box` `BoxOptions` | `linesToBoxes`+`isTranslatable`：image/run.ts:20。⚠️ `quadBounds` 只在本文件 + 测试 |
| `core/image/run.ts` | 426 | 图片翻译小管线（取字节 → hash → OCR / 读字形 / 读 foreignObject → 合框 → 纯文本翻译 → 叠加层），自带 worker 池与 parked 队列 | `startImageTranslation` `collectImageTargets` `readImageResponse` `toBase64` `sameText` `captionOf` `MAX_IMAGE_BYTES` 类型 `ImageRun` `ImageRunOptions` `ImageBytes` `ImageTarget`（转出） | `startImageTranslation`+`collectImageTargets`：content/index.ts:290,303。⚠️ `readImageResponse` `toBase64` `sameText` `captionOf` `MAX_IMAGE_BYTES` 只在本文件 + 测试 |

### 1.6 导出了但 src 里没有调用者（汇总）

按上表 ⚠️ 项归类（数据来自 `/Users/cheongzhiyan/.claude/jobs/7ed5b68c/tmp/export-callers.txt`，共 95 个导出名在 src 里除定义文件外零引用）：

- **纯粹没人用（tests 也没有）**：`rules/abstract.ts:ACCESS_LIST`、`renderer/anchors.ts:anchorWouldBreak`、`protector/label.ts:leadingLabel`、`renderer/index.ts:setAppearanceAttrs`（仅同文件）、`renderer/index.ts:INLINE_TITLE_MAX_CHARS`、`renderer/responsive.ts:NARROW_QUERY`、`renderer/sentences.ts:sentenceMapOf`（tests 用 1 处）、`scheduler/pacer.ts:DEFAULT_WALK_BUDGET_MS`、`rules/latexml.ts:DOCUMENT_SUBTITLE` `NAMED_TAGS`、`renderer/table-fit.ts:FIT_BUCKETS` `MIN_FIT` `LOOSEN_SLACK`、`renderer/style-preset.ts:TOP_TRANSLATION_SELECTOR`、`renderer/notes.ts:NOTE_T_CLASS` `NOTE_S_CLASS`、以及若干只作类型导出的接口（`Rule` `ProtectRule` `RuleKind` `PaperContext` `BoxOptions` `ImageBytes` `NoteBox` `MarginNotePlan` `Peek` `PeekKey` `Mutation` `Prep` `PrepOptions` `ModeControllerOptions` `SentenceMap` `SentenceSide` `FitDeps` `NaturalWidth` `CssRejection` `WorkPacer` `TitleOptions` `IsAnnotation` `TextOfSlot` `GlyphRun` `BlockState`）。
- **只被测试用的导出**（生产路径不经过）：`rules/latexml.ts:hasTranslatableText`、`renderer/pending.ts:clearPending`、`renderer/failed.ts:clearFailed`、`renderer/pair-margins.ts:alignPairMargins`、`renderer/side-layout.ts:isSideContainer` `SIDE_CONTAINER` `SIDE_DENY` `MULTI_PANEL_FLEX`、`core/sentences/index.ts:splitSentences`、`renderer/skeleton.ts` 的 7 个、`scheduler/lazy.ts:observerThresholds` `quantizeThreshold`、`image/run.ts` 的 5 个工具函数、`svg/glyphs.ts:runsOf` `viewBoxOf`、`renderer/margin-notes.ts:stackShifts`、`renderer/prep.ts:rootsOf`。这些多数是「为可测性导出的内部函数」，不是死代码；但 `clearPending` / `clearFailed` / `alignPairMargins` / `isSideContainer` / `splitSentences` 是**与生产路径并存的第二套入口**（见 §4）。
- **barrel 转出但只被 barrel 引用**：`marks.ts:AXT_ATTR_PREFIX`（renderer/index.ts:290 用）、`scheduler/pacer.ts:yieldToMain`、`protector/offsets.ts:nodeOffsetAt` `spanAt` `PositionedToken`、`protector/validate.ts` 三个类型。

<!-- section 1 done -->

## 2. 运行链路

写法：`文件:行 函数`。行号对应 HEAD e6de3e1。

### 2.1 主链：页面加载 → 视口触发 → 提取 → 序列化 → 送翻译 → 回填 → 渲染 → 模式切换 → 恢复

| 步 | 在哪 | 做什么 |
|---|---|---|
| 0. 页面加载（`document_idle`） | `entrypoints/content/index.ts:32 main()` → `core/extractor/index.ts:89 extract(document)` | 从 `documentRoot()`（`rules/latexml.ts:381`）起用显式栈按文档序遍历；每个元素 `classify()`（`latexml.ts:240`）：skip 不下钻、table 取 `cellsOf()`（:79）成表格块且不下钻、unit 且 `ownText()`（:43）含字母则成文本块并继续下钻、protect 按 `descend` 决定；注入节点跳过（:108）。**只读 DOM**，`Block[]` 留在内存 |
| 0b. 论文上下文 | `content/index.ts:34` → `extractor/context.ts:45 paperContext()` | 抽标题 + 摘要（≤1200 字），每批 prompt 带上 |
| 0c. 摘要页入口（另一条 content script） | `entrypoints/abstract.content.ts` → `core/abstract/link.ts:20 injectBilingualLink()` | 在 `/abs/*` 插 `#axt-translate` 链接；HTML 页见到该 hash 时 `content/index.ts:465` 自动 `start()` |
| 1. 开始会话 | `content/index.ts:171 start()` | 读配置、`backend.status()`；`createModeController`（`renderer/responsive.ts:32`）；`endRun()`；`installAnchorFallback`（`renderer/anchors.ts:85`）；`startSentenceHighlight`（`renderer/highlight.ts:229`，配置开时）；`beginSession()`（`scheduler/session.ts:12`）；`prep.reset()`；`enterSide(modes.effective())`；然后 `startTranslation()`（:212） |
| 2. 标记与调度就绪 | `pipeline/run.ts:97 startTranslation()` | `enable()`（`renderer/index.ts:100`：写 `data-axt-on/mode/lang/dir`，注入 `<style data-axt-sheet="modes">`）→ `sectionTitles()`（`batches.ts:32`）→ **同步**写全部 `data-axt-id`（:145）→ `ready`：切片写 `data-axt-state="pending"`（:148-157，`pacer.ts` 让出主线程，每块前查 `halted()`）→ `createLazyScheduler()`（`scheduler/lazy.ts:74`）：建锚点表（无布局盒的块挂最近祖先块）、同步播种首屏（:130-142）、其余 `IntersectionObserver` |
| 3. 视口触发 | `lazy.ts:111` IO 回调 / `:142 enterAnchors(seeded)` → `fire()` → `options.onEnter` → `run.ts:159` `translate(entered)` | 只在 `intersectionRatio ≥ effectiveThreshold`（:101）时 `unobserve` 并交出；一次性 |
| 4. 规划批次 + 序列化 | `run.ts:340 translate()` → `:344 scheduler.claim(fresh)` → `:345 planBatches()`（`batches.ts:43`） | 按章节 / 1000 字 / 4 条切批；表格整表一批（每个非数值格 `serialize(cell.el)`，:80）；文本块 `serialize(block.el, format)`（:87，`protector/serialize.ts:129`）：`classify` 命中即 void（表格格内 unit 例外走 paired），未命中含文本为 paired，markers 下 paired 拍平；`makeTracker`（:56）边写边折叠空白、转义、记 `WireSpan` 锚点；`voidCount > 40` 单独成批（:90） |
| 5. 等待态 | `run.ts:274 processBatch()` → `:279 renderPending()`（`renderer/pending.ts:19`） | 先 `clearTranslation` + `setState('pending')`，插同标签的 `.axt-t.axt-pending` 兄弟，内含 `createSkeletonInside`（`skeleton.ts:92`，估行数不量）；短标题按 `shouldInline` 同行；`rendered(targets)` → `onRendered` → `prep.touch()`（`content/index.ts:226`） |
| 6. 切句 + 送翻译 | `run.ts:229 translateSegments()` → `:235 send()` → `options.transport`（`content/index.ts:222 backend.translate` → `shared/transport.ts` 消息 → background） | tags 路径每段带 `cutsFor()`（`run.ts:175` → `pipeline/sentences.ts:31 cutsOf` → `core/sentences/index.ts:241 sentenceCuts`，参考文献与非 tags 返回 undefined）；`renderPath === 'runs'` 时直接 `viaRuns()`（:190） |
| 7. 校验 + 回填 | `run.ts:266-269` | 每段 `validate(hit.text, segment.protected)`（`protector/validate.ts:48`）→ 过则 `rehydrate()`（`protector/rehydrate.ts:35`：再 `validate` 一次、`scanTokens`（`offsets.ts:389`）逐 token 建节点 / `cloneWithoutIds`（`clone.ts:9`）克隆槽位、产出译文侧 `offsets`；markers 下 `restoreLeadingLabel`（`label.ts:162`））；不过则 `retrySingle()`（:215，`bypassCache`）→ 仍不过 `viaRuns()`（:190，`splitRuns` / `joinRuns`，`protector/runs.ts:31,74`） |
| 8. 渲染为兄弟节点 | `run.ts:320-334`（文本）/ `:286-319`（表格） | 文本：`renderText()`（`renderer/index.ts:186`：`clearTranslation` → 新建同标签元素装 fragment → `stripInjected(node,false)` → 复制 class + `axt-t`、`data-axt-for`、`lang`/`dir` → `shouldInline` 写 `data-axt-inline` → 逐字相同打 `data-axt-identity` → `block.el.after(node)` → `setState('translated')`）；随后 `registerSentences()`（`renderer/sentences.ts:114`）。表格：`renderTable()`（`index.ts:242`：整表 `cloneNode(true)` + `stripInjected`，逐格替换并写 `lang`/`dir`，回报原格→克隆格）；全部格成功 `done`，部分成功 `renderTable + markPartial`（:312-314），全失败 `renderFailed`（`failed.ts:39`）；失败的文本段 `renderFailed(…, retry → translate([block]))`（:331）。之后 `rendered(targets)` + `report()` |
| 9. side 整理（异步、合并） | `content/index.ts:226 onRendered → prep.touch()` → `renderer/prep.ts:140 coalescer`（`scheduler/coalesce.ts:29`，150ms / maxWait 1000）→ `prep.ts:74 run(scope)` | 读：栏宽（`table-fit.ts:88 measureColumn`，仅陈旧时）、`readPairMargins`（`pair-margins.ts:40`）、`planMarginNotes`（`margin-notes.ts:90`）；写：`localizeNotes`（`notes.ts:161`）→ `dropStaleSplits`（`split-figures.ts:199`）→（仅 side）`splitFigures`（:142）→ 首个全量趟 `createMirrors`（`mirror.ts:45`，之后再 `readPairMargins(doc)`）→ `fitTables`（`table-fit.ts:154`，三段：收集 / 读 / 写）→ `writePairMargins`（:65）→ `applyMarginNotes`（:108）；动过 DOM 则 `restack.schedule()`（第二个合并器，:142，只做边注下排） |
| 10. 模式切换 | popup `axt:set-mode` → `content/index.ts:400 setPageMode()` → `modes.choose()`（`responsive.ts:54`）→ `setMode()`（`renderer/index.ts:137`：`clearSentenceHighlights` + 改 `data-axt-mode`）→ `enterSide()`（`content/index.ts:368`） | 进 side：`prep.refreshColumn()` + `prep.touchAll()`，装 `ResizeObserver` 观察翻译根宽度（:386-397）；离开 side：`prep.cancel()`、`clearPairMargins`、`clearMarginNotes`。视口 <1280px 时 `responsive.ts:47 onMediaChange` 自动退回 stack 并回调 `enterSide` |
| 11. 恢复原文 | popup `axt:restore-page` → `content/index.ts:411 restorePage()` | `endRun()`（停高亮、标题、run（`run.ts:350 stop`：断观察器、`clearAllPending`）、images；`endSession()`；`backend.cancel(session)`）→ `modes.stop()` → `prep.reset()` → `uninstallAnchors()` → `restore(document)`（`renderer/index.ts:275`：`clearSentenceHighlights`、删所有 `INJECTED_SELECTOR` 节点（先 `cancelSkeletonsIn`）、删 `style[data-axt-sheet]`、剥全部 `data-axt-*`） |

外围但属于主链的两条：
- **标题翻译**：`content/index.ts:265 translateTitle()`（`scheduler/title.ts:17`）走 `escapeText → backend.translate → unescapeText` 纯文本往返，`<head>` 上 `MutationObserver` 盯页面改标题，`stop()` 恢复。
- **外观即时生效**：`content/index.ts:90 watchConfig` → `applyStyle()`（`renderer/index.ts:81`：重算注入表、`setAppearanceAttrs`、`clearSentenceHighlights`）；不重请求。

### 2.2 支链：拆图（split figures）

`prep.ts:102 splitFigures(root)`（仅 side） → `split-figures.ts:142`：对每个 `figure`：`needsSplit()`（:101：非克隆件、非嵌套分图、内含 `REAL_OR_IMAGE` 真译文或叠加层、`hasLooseMedia()`（:65））→ `translationKey()`（:53：真译文的文本 + `signatureOf()`（:47，表格走进单元格）hash）→ 与 `data-axt-split-key` 比，不同则删旧副本 → 删图内与图后镜像（:156-158）→ `cloneNode(true)` → `pairNodes()`（:76，趁同构记对应表）→ 删副本里的 pending / error 与每对的原文成员（:166-171）→ `stripIds()`（:127，id → `data-axt-split-of`，叠加层 `data-axt-for` → `data-axt-split-for`）→ 加 `axt-t axt-split`、`data-axt-for="split:n"`、写 key → 原件 `data-axt-split` → `fig.after(clone)` → 对原件每个元素 `mirrorSentences()`（`renderer/sentences.ts:159`）把句子登记镜像到副本。非 side 下 `prep.ts:97 dropStaleSplits()`（:199）按签名丢过期副本并摘原件标记。锚点兜底 `anchors.ts:50-59` 与叠加层清理 `image.ts:71 clearImageEverywhere` 都要认副本里的 `data-axt-split-of/for`。

### 2.3 支链：句子对齐 / 悬停高亮 / 原文面板

1. **切点**：`run.ts:175 cutsFor` → `pipeline/sentences.ts:31 cutsOf`（tags 且非 bibblock/bibitem）→ `core/sentences/index.ts:241 sentenceCuts`：`project()`（:162）把占位符投影成空白 / 自身文字 / 占位词，`Intl.Segmenter` 切，`ABBR`/`TERMINAL_ABBR`/`CONTINUES` 合并，落在占位符内部的切点丢弃，回退越过开标签。切点随请求送 background（providers 侧插标记、`providers/alignment.ts` 校验，不在本范围）。
2. **登记**：`run.ts:326 registerSentences(block.el, node, segment.protected.offsets, fragment.offsets, alignment)` → `renderer/sentences.ts:114`：无对齐则清掉该原文的所有旧登记（:119-124）；有则 `maps.set(target, map)`（按**译文节点**键）、旧副本按长度相同者换句边界（:135-142）、`remember()` 记 WeakRef。表格逐格登记（`run.ts:299 registerCells`）。副本：`split-figures.ts:186 mirrorSentences`、`notes.ts:139 mirrorNote → mirrorPair`。
3. **命中与画带**：`highlight.ts:229 startSentenceHighlight` → `pointermove` 合帧 → `update()`（:357）：`caretPositionFromPoint` → `sentenceMapAt(node)`（`sentences.ts:247`，沿祖先 WeakMap 查、`live()` 过滤）→ `offsetOn()`（:337，两个相邻字符矩形实测命中）→ `wireOffsetAt()`（`offsets.ts:112`）→ `sentenceAt()`（`sentences.ts:257`）→ 同句短路（epoch 缓存）→ 读阶段：层原点、`clipOf()`（:182）、`rangesOf()`（`offsets.ts:297`）× `bandsOf()`（:108）→ 写阶段：`layer.textContent=''` 再逐条 `<div>`。对侧未渲染（`rendered()`，`checkVisibility`）时不画对侧色带，改 `peek.show()`。
4. **原文面板**：`peek.ts:163 createPeek` → `show()`（:246：脏登记拒绝、同键只 `place()`、已开则热切换、否则 600ms 驻留后 `current()` 再问一次）→ `render()`（:218：逐段 `cloneContents` → `stripInjected` → 删 `ANNOTATION_SELECTOR` → `place()` 三档零测量放置）。失效：`highlight.ts:544 MutationObserver` 每条记录 `movesText()`（`peek.ts:135`）→ `peek.expire(map)`；属性改动 → `peek.restyled()`；`<html>` 属性变化也观察（:575）。
5. **外部清空**：`setMode` / `restore` / `applyStyle` → `clearSentenceHighlights()`（:209，epoch++、删层与面板）。

### 2.4 支链：失败重试

- **占位符校验失败**：`run.ts:268` → `retrySingle()`（:215，单块重发、`bypassCache: true`）→ 再失败 `viaRuns()`（:190）→ runs 数量不符 / `joinRuns` 抛错 → `MISMATCH` 错误。
- **批次失败**：`run.ts:237-262`：先渲染 `res.partial` 里已成功且校验通过的段（:242-248）；剩余段若 `res.error.isolatable` 且 >1 段则对半递归 `translateSegments`（:254-257），否则全部记 `errorOf(res)`；`FATAL_KINDS`（no-key / auth，:77）→ `noteFatal()`（:181）记 `fatal`、`scheduler.disconnect()`，之后 `halted()` 全部短路。
- **失败态渲染**：`run.ts:316,331 renderFailed(block, reason, retry)`（`failed.ts:39`：`clearTranslation` + `setState('failed')` + Shadow DOM 小部件，`data-axt-reason` 留原始诊断；`title` 按界面语言由 `parseFatal/reasonText` 算）。表格部分成功：`renderTable + markPartial`（`data-axt-partial`），块记 `failed` 但状态属性仍是 `translated`。
- **重试入口**：小部件按钮 → `translate([block])`（`run.ts:340`：过滤掉 `requested` 状态的、`claim`、重新规划批次）→ `renderPending` 里 `clearTranslation` 一并清掉小部件 / 半份克隆 / partial 标记（`pending.ts:22-31`）。popup `axt:retry-failed` → `content/index.ts:444` → `run.failed()`（`run.ts:357`）+ `images.failed()` 各自 `translate`。
- **永久换引擎**：`run.ts:127 served()` → `onProvider` → `content/index.ts:230`：问 `backend.status(session)`，起始引擎被 `no-key`/`auth` 降级则 `start(undefined, true, session)` 整页重开（每会话一次，`restarted`）。
- **改界面语言后的小部件**：`content/index.ts:123 relabelFailed()`（`failed.ts:74`）。

### 2.5 支链：图片翻译（§15）

`content/index.ts:284 startImages()` → `image/run.ts:95 collectImageTargets()`（翻译根内 `img.ltx_graphics` / `object[type=svg]` / 有词的 `svg.ltx_picture`，排除块内与注入节点内）→ `setImageModes()`（`renderer/image.ts:42`）→ `startImageTranslation()`（`image/run.ts:187`）：自建 `createLazyScheduler`（:402）→ `translate()`（:368，`isEnabled` 不过的进 `parked`）→ run 级队列 + 2 并发 `pump()`（:388）→ `process()`（:280）：picture → `foreignLinesOf`（`svg/foreign.ts:115`）；svg → `svgLines`（:261，等 `load`）→ `linesOf`（`svg/glyphs.ts:235`）；raster → `fetchBytes` → `sha256Hex` → `options.ocr`（background）；都过 `looksLikeCode` 过滤 → `linesToBoxes`（`image/boxes.ts:82`）→ `captionOf` 作上下文 → `options.translate`（纯文本 `escapeText`）→ `labelsFrom()`（:224，`sameText` 去重）→ `renderImage()`（`renderer/image.ts:133`）→ `onRendered` → `prep.touch()`（side 下拆图）。helper 探测回来 `settleRaster()`（`content/index.ts:337`）放出 parked 的位图或 `clearImageEverywhere`。

### 2.6 支链：脚注归位与边注下排（side）

`prep.ts:93 localizeNotes(r)` → `notes.ts:161`：对每个 `.axt-t` 译文，找其内部重建的 `.ltx_note_content` 副本与原件里对应的原件（数量对不上整段跳过）；原件旁 `arrived()` 的译文 → `localizedCopy()` 克隆去壳 → `wrapSource()` 把副本自己的原文包进 `.axt-note-s` → `copy.append(fresh)` → `mirrorNote()` 把句子登记镜像到副本 → 原件 `.ltx_note` 打 `data-axt-note`（副本会被某模式整块藏掉时不打）；未登记且副本逐字相同的脚注也打标记。`renderer/index.ts:158 clearTranslation` → `delocalizeNotes()`（`notes.ts:244`）撤销。边注位置：`prep.ts:91 planMarginNotes(doc)`（读）→ `:125 applyMarginNotes`（写 `translateY`）→ 有改动再排 `restack`（:142）。

<!-- section 2 done -->

## 3. 守卫与特判台账

来源：对每条守卫的代码片段跑 `git log --reverse -S'<片段>' -- <path>` 取**引入提交**（另核过最近一次改动它的提交），提交信息里的 issue / PR 号照抄；「解决的问题」以提交信息与代码注释为准，注释里写明的实测论文一并列出。「测试」列写 `tests/` 下的文件:用例名（按守卫关键字在 `it()` 名里匹配到的；匹配不到但文件明显覆盖的写文件名 + 「无专门用例」；都没有写「无」）。共 230 条片段查过，下面收录 175 条有实质语义的（纯类型 / 常量重命名不列）。

### 3.1 rules / extractor / marks

| 位置 | 做什么 | 引入提交 / issue | 解决的问题 | 测试 |
|---|---|---|---|---|
| `rules/latexml.ts:36` `title` 规则排除 `.ltx_title_acknowledgements` / `.ltx_title_keywords` | 致谢 / 关键词的 run-in 标题不单独成块 | c38ddf0 2026-09-04 `fix(rules): stop double-translating run-in acknowledgement and keyword titles` | 2609.00095：标题成块后外层单元把它当 void 克隆一份英文，页面出现两个英文标题 + 一段中文 | rules/latexml.test.ts:40 `classify：逐规则命中`（表驱动，无专门用例）；extractor/extract.test.ts:39 `致谢块内的标题是嵌套单元` |
| `latexml.ts:43` `bibitem:not(:has(.ltx_bibblock))` | 没有分段的参考文献条目整条兜底 | 37508c0 2026-09-04 `feat(rules): translate the author region, split bibliography entries` | natbib 等模板无 `.ltx_bibblock`，否则整条不翻 | rules/latexml.test.ts:333 `只有一段的条目仍然整条一个单元，行为没变` |
| `latexml.ts:87` `author-glue` skip（`.ltx_author_before/_after`） | 作者之间的连接词不成块 | 37508c0 同上 | 连接词单独成块会把姓名列表打断成一行一个词 | renderer/authors.test.ts:24 `两位作者各成一块，机构照旧单独成块，连接词不成块` |
| `latexml.ts:136` `nodisplay` protect（`RULES_VERSION` 0.10.1） | ACM `\Description{}` 隐藏文本作 void | c3d8045 2026-09-11 `fix(renderer): margin footnotes, a hidden metadata leak, and figure text` | 2509.10652v3 Table 5：图注译文下面多出几百字的隐藏描述（含未展开的 `\par`） | protector/serialize.test.ts:39 `图表说明里不显示的无障碍描述作 void`；rules/latexml.test.ts:35 `版本号随本次规则变化升级` |
| `latexml.ts:127` `contact-label` protect（`.ltx_contact_name`） | 站点隐藏的 `Email:` 标签作 void | ae293e1 2026-09-06 `fix(rules): stop translating the hidden contact label` | 2507.00150：邮箱那条 `.ltx_contact` 唯一可翻的是隐藏标签，页面出现两行一样的邮箱 | renderer/authors.test.ts:80 `只有隐藏标签可翻的 .ltx_contact 不成块`、:87 |
| `latexml.ts:143` `bib-year` protect | 引文年份作 void | 3a5dd5a 2026-09-06 `fix: ten findings from the second Codex round`（Codex #74） | 作者段放开后年份跟着被翻，only 模式只剩改写过的元数据 | rules/latexml.test.ts:317 `引文年份作 void 保留，不进翻译文本（Codex 在 #74 指出）` |
| `latexml.ts:207` `ROMAN_ID` + `isNamedTag` 末 token 判定 | 罗马数字编号的带名 tag 不翻 | faf55f2 2026-09-05 `fix(rules): keep Roman-numeral tags protected, bump RULES_VERSION`（Codex #53） | google-gtx 把 `Table IV:` 译成「表四：」，与受保护的 `.ltx_ref` 对不上 | rules/latexml.test.ts:166 `罗马数字编号的 tag 不翻…` |
| `latexml.ts:225` `PARENTHESIZED` + `hasNonRomanWord` | 去掉只含标识符的括号段再判词 | c6fed2f 2026-09-06 `fix(rules): keep parenthesized names, tolerate space before punctuation`（Codex #53） | `(ii)` 面板标签是多字母罗马数字；整段去括号又会把 `(Figure 1)` 连环境名一起丢掉 | rules/latexml.test.ts:157 `括号里的整段标识符不算词…`、:177 |
| `latexml.ts:118` `.ltx_tag_item` 进 `NAMED_TAGS` | description 术语可翻 | eadf0fd 2026-09-06 `fix(rules): translate description terms, trust the bibliography's author marker`（Codex #18） | `\item[Compactness]` 在 tag 里，整个 `.ltx_item` 无自有文本、不成块 | rules/latexml.test.ts:287 `含词的术语要翻…`、:294 |
| `latexml.ts:383` `documentRoot` 先 `doc.matches(DOCUMENT_ROOT)` | 传入的就是翻译根时返回自身 | e7b66fc 2026-09-05 `fix(core): translate in-cell units and nested tabular cells; skip injected nodes on re-extract`（Codex #2 / #3） | `querySelector` 只搜后代，传根本身会漏 | rules/latexml.test.ts:274 `传入的元素本身就是翻译根时返回它自己` |
| `latexml.ts:332,341` `atomicContext` / `stack` 排除 `.ltx_transformed_outer` | `\resizebox` 包裹层不算行内上下文 | bca1ab7 2026-09-07 `fix(styles): let \resizebox-wrapped tables reach the two columns` | 2606.07636v2：5 张表的原表 / 译表成两个 `inline-table` 横跨分割线 | renderer/side-layout.test.ts:144 `\resizebox 包着的表格能连到列线…`；e2e/layout.mjs |
| `latexml.ts:377` `isInlineTitleCandidate` 排除 `DOCUMENT_SUBTITLE` | 副标题不与译文同行 | 21fc79b 2026-09-06 `fix: three edges Codex found on merged PRs`（Codex #13） | 2609.00246 `(Extended Version)` 压成 inline-block 后从居中变成左贴边 | renderer/render.test.ts:97 `文档副标题排除在外…`；rules/inline-title.test.ts:7 |
| `latexml.ts:429` `NUMERIC_CELL` 要求 `(?=.*\d)` | 数值格必须含数字 | 2817527 2026-09-03 `feat(rules): full LaTeXML rule module with classify() and predicates` | `ERROR` 这类以 E 开头的词被当成指数误判 | rules/latexml.test.ts:238 `isNumericCell（Phase 0 校准边界用例）` |
| `latexml.ts:403` `proseText` 减去 `.ltx_markedasmath` | 判「整个节点是不是公式」 | 39384e7 2026-09-11 `fix: the second round of Codex findings on #163` | 2609.00246 图内标签 `initMT` 过了判词就会被译、被白框盖住 | svg/foreign.test.ts:60 `被标成数学的标识符不算词：initMT 不送` |
| `latexml.ts:288` `ANNOTATION_SELECTOR` 只收脚注、不收 `.ltx_cite` | 切句时引用不当注解 | e0dc759 2026-09-09 `refactor(providers): decide the sentence cuts where the block is known`（Codex #137） | `\citet` 可以是句子主语，当注解会抹成空格并藏掉前一个句界 | pipeline/sentences.test.ts:49 `a citation is content, not an annotation…` |
| `latexml.ts:318` `MARGIN_ASIDE_BOXES` 另立一份（`.ltx_note_content` 而非 `.ltx_note`） | peek 量沟槽是否空 | da04159 2026-09-10 `fix(side): footnote boxes neither size the grid row nor join the sentence's bands` | `.ltx_note` 根只有几像素，浮出去的是里面的框，side 下框又是零高 | renderer/peek.test.ts:235 `marginFree: the panel's footprint against every margin aside's box` |
| `latexml.ts:326` `SIDE_LAYOUT` 整组常量 | 布局用的 `ltx_*` 收回规则模块 | 9efb54f 2026-09-06 `refactor(rules): move layout selectors out of the renderer, and guard the rule`（Codex #22） | `side-layout.ts` 攒了 5 处 `ltx_*` 字面量，硬规则 2 只写在文档里 | rules/selector-boundary.test.ts:128 `规则模块之外的 TS / TSX 代码里没有 ltx_ 字面量` |
| `extractor/index.ts:108` `if (el !== start && isInjected(el)) continue` | 再次提取时跳过我们自己的节点 | e7b66fc 2026-09-05（Codex #8） | 译文 / 镜像带着原块的 class，会被规则认成块 | extractor/extract.test.ts:108 `再次提取时原块内已有的译文 / 镜像不算原文（Codex 在 #8 指出）` |
| `extractor/context.ts:14` `HIDDEN_MATH_META` | 摘要不读 MathML `<annotation>` | bc168fa 2026-09-05 `fix(providers): take the six Codex findings on the prompt library`（Codex #28） | `textContent` 把公式读两遍（呈现层 + TeX 源） | extractor/context.test.ts:31 |
| `context.ts:24-25` 排除 `axt-` class 与 skip 类 | 上下文不混入译文 / 出版元数据 | 14a243f 2026-09-05 `fix(extractor): keep skipped metadata and injected nodes out of the paper context`（Codex #28） | 2507.00150 把 `.ltx_pubnotes` 嵌在文档标题里，整段致谢进了每批 prompt 与缓存键 | extractor/context.test.ts:37、:47 |
| `extractor/index.ts:99` 重复 id 加 `-n` 后缀 | 块 id 唯一 | 56a03b0 2026-09-03 `feat(extractor): block extraction with nested units and table blocks` | LaTeXML 偶有重复 id | extractor/extract.test.ts:121 `重复 id 加后缀` |
| `extractor/index.ts:84` `hasTranslatableCell` | 无任何含字母非数值格的表不成块 | d7e3d89 2026-09-03 `fix(extractor): skip tables without any translatable cell` | 空排版 tabular、纯公式表被当成块 | extractor/extract.test.ts:79 `没有任何含字母单元格的表…不成块` |
| `marks.ts:72` `stripInjected` 剥 `on*` 属性 | 克隆件不带行为 | c3d8045 2026-09-11（独立审计 B17） | 回填克隆带着 `onclick`，点下去真会执行；arXiv 今天不产出，写死不变量 | core/marks.test.ts:27 `克隆不带行为：事件属性与会执行脚本的 URL 都剥掉（独立审计 B17）` |
| `marks.ts:45` `normalizeUrl`（去制表 / 换行、剥 C0） | 判 `javascript:` 前按 URL 标准归一化 | 861bc29 2026-09-11 `fix: the first round of Codex findings on #163` | `href="java&#10;script:…"` 正则匹配不上，浏览器照样当 `javascript:` | core/marks.test.ts:48 `协议名里夹控制符的 URL 也算会执行脚本（Codex 在 #163 指出）` |
| `marks.ts:65` 单一 `stripInjected` | 镜像 / 译文表 / 回填 / 拆图共用一份清理 | 7c86f2a 2026-09-07 `refactor(core): one stripInjected for mirror, table and placeholder clones`（issue #46） | 四处各一份几乎一样的实现，漂移过 | core/marks.test.ts:7 `isInjected / stripInjected`；protector/clone.test.ts:17,25 |

### 3.2 protector

| 位置 | 做什么 | 引入提交 / issue | 解决的问题 | 测试 |
|---|---|---|---|---|
| `serialize.ts:148` `isVoid = c ? !(inCell && unit && hasText) : !hasText` | 表格单元格里的 `.ltx_p` 走 paired 不作 void | e7b66fc 2026-09-05（Codex #5） | 2410.00260 表 1 的 38 个格整格只剩一个占位符、文字全丢 | protector/serialize.test.ts:75 `表格单元格是块内的段…`、:82 |
| `serialize.ts:106-120` `makeTracker.text` 折叠五种空白、不折 nbsp、不 trim | 序列化时就折叠空白并记锚点 | 3626b3a 2026-09-09 `feat(protector): map wire-text offsets to DOM ranges`（折叠本身来自 #119） | 62% 的块带硬换行，微软把每个换行当句号，假句界 128/266 → 5/140；nbsp 是 LaTeXML 的禁折排版；trim 会把相邻行内块的译文粘在一起 | protector/serialize.test.ts:95-123 `空白折叠（#119）` 五个用例 |
| `text.ts:28` `markers` 无条件 `@` → `@@` | 转义与上下文无关 | 2365f68 2026-09-08 `fix(protector): escape markers unconditionally — conditional escaping breaks at node boundaries`（Codex #107） | `<p>@<math/></p>` 逐节点转义再拼接时产生 `@@a#`，占位符消失 | protector/markers.test.ts:50、:61、:80、:88 |
| `text.ts:24-28` `markers` 也转义 `& < >` | 两种线上格式都过 `escapeHtml` | 321fd42 2026-09-08 `fix(protector): escape HTML specials in the markers format too`（Codex #107） | google-web 走 `translateHtml`，`<500` 会被当标签、`&` 回来变 `&amp;` | protector/markers.test.ts:97 |
| `tokens.ts:54-89` tags / markers 两条显式循环 | 不合并成带回调的通用循环 | 99c3cad 2026-09-08 `perf(protector): split tokenize into two explicit loops, drop the assertionless fixture work` | 合并版在 2609.04056 整篇往返从 1645 ms 涨到 1833 ms，撞 10 s 预算断言 | protector/scan.test.ts:24 `agrees with tokenize across every fixture in both formats`（等价守卫，非性能） |
| `runs.ts:46-67` `isFunctional` + `skipDepth` | runs 路径整块保留 `a[href]` | 215c51f 2026-09-05 `fix(protector): keep clickable elements clickable in the runs fallback`（issue #44） | 降级不能把可点击内容变成纯文字；12 篇 fixture 里 0 例，是结构保证 | protector/runs.test.ts:59-99 `降级不能把可点击的内容变成纯文字（issue #44）` 五个用例 |
| `runs.ts:28,81` runs 保持线上形态、`joinRuns` 才 `decodeText` | 收发对称 | c0690b9 2026-09-08 `fix(runs): keep run text in wire form and decode on join`（issue #111） | 提前反转义后 `a < b` 送到 translateHtml，回来的 `&amp;` 又原样进文本节点 | protector/runs.test.ts:31、:43 |
| `validate.ts:22` `expectationsFromText` | 从请求文本反推期望 | 2da22f0 2026-09-06 `feat(protector): derive placeholder expectations from the request text`（issue #42） | background 不跨消息接收 `accept` 回调也能把坏译文挡在缓存外 | protector/validate.test.ts:59-91；protector/markers.test.ts:129-137 |
| `rehydrate.ts:46` 用 `scanTokens` 而非 `tokenize` | 回填同时产出译文侧偏移 | 841f0ff 2026-09-09 `feat(protector): wire offsets on the translation side`（#105 / #123） | `tokenize` 不报位置、且是最热路径不能改；带位置扫描只贵 2% | protector/scan.test.ts:73-148 `rehydrate offsets (#105)` |
| `rehydrate.ts:70` markers 下 `restoreLeadingLabel` | 把 run-in 标签的格式元素包回译文 | 3734667 2026-09-10 `fix(protector): put a block's leading label back under the markers format`（issue #150） | 2608.14896v1 微软路径 `Keywords:` 不再加粗 | protector/label.test.ts:48-262（22 个用例） |
| `label.ts:23` `MAX_LABEL_WORDS = 8` | 超过 8 词不算标签 | 3734667 同上 | 超出实测重放覆盖范围的斜体整句 | protector/label.test.ts:256 `a label longer than eight words is not a label` |
| `label.ts:44-47` `bound()` 按 CJK 比例给 slack | 译文前缀长度上限按文字系统定 | 58b4f55 2026-09-10 `fix(protector): match the label's placeholders by identity; bound by script`（Codex #151） | 法语 `Avertissement :` 比英文长，固定 +4 会误拒 | protector/label.test.ts:177 |
| `label.ts:155-160` `endsSentences` 要求引擎句界证据 | 句点标签必须有对齐证据 | c2745c2 2026-09-10 `fix(protector): a period label needs the engine's sentence boundary; other scripts' full stops`（Codex #151） | `注意 好。` 与「标签译得长」在长度上分不开 | protector/label.test.ts:237、:228 |
| `label.ts:213-216` 前缀占位符按身份与标签的完全一致 | 不只数个数 | 58b4f55 同上（Codex #151） | `validate()` 允许重排，正文公式可以站到标签公式的位置 | protector/label.test.ts:154、:167 |
| `label.ts:74-83` `wireText` 排除槽位子树 | 标签长度按线上文本量 | 58b4f55（Codex #151） | `<annotation>` 的 TeX 源让长度虚高，界限放过正文深处的分隔符 | protector/label.test.ts:200 |
| `label.ts:104-107` 标签自带分隔符则拒绝 | `J. Symbolic Comput.` 不当标签 | 3734667（Codex #151） | 译文的第一个分隔符会切在内部那个 `.` 上，只斜体 `J.` | protector/label.test.ts:138 |
| `offsets.ts:71-72` `nodeOffsetAt` 的 `ceiling` 钳制 | 转义内部的偏移单调 | 4ecae9a 2026-09-09 `fix(protector): keep offsets monotone through escapes, and end void ranges after their node`（Codex #123） | `&Z`：wire 4 → node 2、wire 5 → node 1，`rangeOf(4,6)` 塌掉丢 `Z` | protector/offsets.test.ts:114 `keeps the node offset monotone through an expanded escape` |
| `offsets.ts:160-165` void 槽位结束要 `setEndAfter` | 只含公式的区间不塌 | 4ecae9a 同上（Codex #123） | 句末公式被丢 | protector/offsets.test.ts:130、:139 |
| `offsets.ts:178` `CARVED` 含 `NOTE.outer` | 句子范围剜掉脚注框 | da04159 2026-09-10（用户 2026-09-10 反馈，2609.09360v1） | Chrome 报范围内每个文本盒，悬停句子把整条边注也染色 | protector/offsets.test.ts:279 `carves a footnote's floated box out of its slot…`、:304 |
| `offsets.ts:264-279` `injectedBetween` 以 `commonAncestor` 为界、close 槽位从子树后开始 | 找注入节点的遍历有界 | 9a8f5ca 2026-09-09 `fix(protector): bound the gap walk by the common ancestor`（Codex #123） | 无界前序遍历会跑出块、在每个普通闭合标签处报断裂，且整体二次方 | protector/offsets.test.ts:231、:319 |
| `offsets.ts:301` `rangesOf` 先判越界 | 越界区间返回空 | d330798 2026-09-09 `fix(protector): detect injected nodes when building ranges, and reject out-of-bounds intervals` | 畸形请求得到截断前缀而不是空 | protector/offsets.test.ts:331 |
| `offsets.ts:250-256` 「问时判、不记录时判」注入 | serialize 时不记 flag | d330798 同上（Codex #123） | `planBatches` 先序列化，内层块之后才插进来 | protector/offsets.test.ts:202 `sees a node injected after serialisation, which a recorded flag could not` |
| `clone.ts:11` 克隆后 `stripInjected` | 克隆里的译文节点整个删掉 | 7c86f2a 2026-09-07（原逻辑 2026-09-04 实测） | 先翻脚注再翻外层段落时，外层译文把脚注译文复制进来 | protector/clone.test.ts:25 |
| `serialize.ts:152` markers 下 paired 拍平，`FUNCTIONAL_INLINE` 除外 | 无成对记号的格式 | c768c9e 2026-09-08 `feat(protector): negotiable wire formats, plain-text markers alongside tags`（#104 实测） | 成对记号在 Google 上只有 70.6% 存活 | protector/markers.test.ts:35 `void 写成记号，成对元素拍平，带功能的元素仍整块保留` |
| `serialize.ts:38` `VOID_DENSE_THRESHOLD = 40` | 公式密集块单独成批 | 550b036 2026-09-03 `feat(protector): placeholder engine…` | 密集占位符的块与普通块混批会拖累整批 | protector/serialize.test.ts:71；pipeline/batches.test.ts:26 |

<!-- section 3a done -->

### 3.3 renderer

| 位置 | 做什么 | 引入提交 / issue | 解决的问题 | 测试 |
|---|---|---|---|---|
| `renderer/index.ts:43,212` `IDENTITY_ATTR`（归一化后逐字相同就标记） | stack 下 CSS 藏掉重复的那份 | 3a5dd5a 2026-09-06 `fix: ten findings from the second Codex round`（Codex #74） | 默认 prompt 让纯人名作者段原样返回，stack 下每行出现两遍 | renderer/render.test.ts:121-150（5 个用例） |
| `index.ts:221-231` `ownText` 跳过注入节点后再比恒等 | 嵌套块先翻完不影响外层判定 | ee58288 2026-09-06 `fix: nested translations broke the identity check, and two stale docs`（Codex #81） | 原块 `textContent` 混进内层译文，外层永远判不成恒等 | renderer/render.test.ts:130 |
| `index.ts:48,150` `PARTIAL_ATTR` / `markPartial` | 半翻的表保持 `translated` 另加标记 | 5c8a7bd 2026-09-05 `fix(pipeline): gate every attempt on the shared rate-limit pause; partial tables stay translated`（Codex #9 / #30） | 直接标 `failed` 会让 only 模式把原表与半份克隆一起露出来 | pipeline/run.test.ts:349；renderer/failed.test.ts:106 |
| `index.ts:160` `clearTranslation` 先 `delocalizeNotes` | 删译文前撤销脚注归位 | 059e516 2026-09-05 `fix(pipeline): probe after a rate-limit pause, validated cache writes, note state on clear, scoped key clearing`（Codex #30） | 再翻失败时原件边注仍被隐藏、副本已删，脚注在所有模式下消失 | renderer/notes.test.ts:117、:126 |
| `index.ts:162` `clearTranslation` 摘 `INLINE_ATTR` | 同行标记随译文走 | 3979084 2026-09-05 `fix(renderer): drop the inline-title marker with the translation; bump RULES_VERSION to 0.5.0`（Codex #30） | 没有译文的短标题仍被压成 inline-block | pipeline/run.test.ts:365 `短标题再翻失败：删译文的同时摘掉同行标记；再翻成功加回` |
| `index.ts:191` `renderText` 里 `stripInjected(node, false)` | 译文壳里搬进来的子树再清一次 | 7c86f2a 2026-09-07（原逻辑 2026-09-04 实测） | 表格格里 `.ltx_p` 的译文插在原表内，整表克隆会把它复制进来 | renderer/pending.test.ts:51；renderer/render.test.ts:59 |
| `index.ts:196-202` 译文写 `lang` 与 `dir` | 屏幕阅读器与双向算法 | `lang`：481e1c5 之前的 a11y 审计；`dir`：c3d8045 2026-09-11（Read Frog `setTranslationDirAndLang` 对照） | 14 个译文节点全部继承 `lang="en"`；阿拉伯语句号跑到词前面 | renderer/a11y.test.ts:11；renderer/direction.test.ts:57、:68、:75 |
| `index.ts:250-264` `renderTable` 的 `lang` / `dir` 打在换过内容的格上 | 不打在 `<table>` 上 | 861bc29 2026-09-11 `fix: the first round of Codex findings on #163` | `dir` 落到表会连列序一起翻转，与原表对不上 | renderer/direction.test.ts:94、:111 |
| `index.ts:259` 每格替换前重新 `tableCells(clone)[i]` | 嵌套表先外后内替换 | e7b66fc 2026-09-05（§5.3） | 外层格译文带着内层表克隆，事先取好的内层引用指向被丢弃的节点 | renderer/table.test.ts:56 `嵌套 tabular：外层格的译文带着内层表的克隆…` |
| `index.ts:286-287` `restore` 先删 `<style>` 再剥属性 | 顺序 | e7b66fc 2026-09-05 | 样式标记本身是 `data-axt-*`，剥完就找不到 | renderer/restore.test.ts:27 |
| `index.ts:86-92` `applyStyle` 改表后 `clearSentenceHighlights` | 字号 / 行距变了色带失效 | 9d6e9d2 2026-09-09 `fix(renderer): clip the bands to their container and repaint after a reflow`（Codex #138） | 色带是文档坐标的绝对框，跟不上重排 | renderer/style-vars.test.ts:169（不含高亮断言，**高亮清除无专门用例**） |
| `index.ts:137-142` `setMode` 先 `clearSentenceHighlights` | 切模式清色带 | fb5fb3d 2026-09-09 `fix(renderer): five defects Codex found in the hover highlight`（Codex #130） | only 藏原文、side 重排，染的东西已不在原处 | renderer/highlight.test.ts:549 `repaints after setMode cleared the highlights under it` |
| `index.ts:107` `isRtlTag` 判定进 `data-axt-dir` | RTL 只在 `<html>` 记一次 | c3d8045 2026-09-11（Codex #163：文字子标签优先） | `ms-Arab` 是 rtl 而 `ms` 不是 | renderer/direction.test.ts:14-45 |
| `pending.ts:30-31` `renderPending` 先 `clearTranslation` + `setState('pending')` | 重试整块回到等待态 | 3a5dd5a 2026-09-06（Codex #36 / #76 / #81） | 骨架屏插在原块与旧小部件之间；红线不清；半翻表的旧克隆与 partial 留着 | renderer/failed.test.ts:79、:94、:106、:128、:136 |
| `pending.ts:33` 表格块的 pending 用 `div` | 整表克隆到了才是 table | c478892 2026-09-05 `feat(renderer): pending translation node with spinner` | `<table>` 壳里放骨架屏不合法 | renderer/pending.test.ts:34 |
| `failed.ts:11,49` `REASON_ATTR` 留原始诊断；`title` 按界面语言 | 读者看到的是本地化句子 | 7d6273c / 41ceedb 2026-09-11 `fix: the thirteenth/fourteenth round of Codex findings on #161` | `kind: 诊断` 直接显示成英文技术串 | renderer/failed.test.ts:11、:28 |
| `failed.ts:74` `relabelFailed` | 改界面语言后重写已画的小部件 | 7444c34 2026-09-11 `fix: the third round of Codex findings on #161` | 小部件把词抄进 shadow root，不重试就一直是旧语言 | renderer/failed.test.ts:11 |
| `skeleton.ts:14,76` `MAX_ANIMATED_SKELETONS = 60` | 同时呼吸的骨架屏上限 | 020e42e 2026-09-11 `feat(renderer): a skeleton in the paper's own type instead of a grey ring`（移植 Read Frog #1881） | 几千个 WAAPI 动画每帧触发整页样式重算 | renderer/skeleton.test.ts:65 |
| `skeleton.ts:20,42-52` WeakMap 句柄 + 删前取消 + `getAnimations?.()` 兜底 | 泄漏防护 | 020e42e（Read Frog #1831） | 跑着的动画把脱离文档的节点钉在渲染器里 | renderer/skeleton.test.ts:89；renderer/pending.test.ts:62 |
| `skeleton.ts:83` `animation.finished?.catch(() => undefined)` | happy-dom 把取消当未处理拒绝 | 020e42e | 测试环境噪音 | 无 |
| `skeleton.ts:73-76` `prefers-reduced-motion` 不动画 | 尊重系统设置 | 020e42e | — | 无（presets.test.ts:44 守的是 CSS 的模糊过渡，不是骨架屏） |
| `anchors.ts:50-59` 拆图原件 → 副本，按 `data-axt-split-of` 找内部锚 | only 下图内锚点落到副本对应处 | f3e9fce 2026-09-06 `fix(renderer): route hidden split figures to their visible clone` + cff154f `resolve split-figure anchors to the matching clone descendant`（Codex #80） | 2312.17141 有 21 个指向图内公式行的锚点 | renderer/anchors.test.ts:187、:213、:241 |
| `anchors.ts:62` 逐层向外找祖先块的译文 | 嵌套单元的译文被外层一起藏 | 9d1dbd2 2026-09-06 `fix(renderer): walk marked ancestors when the nearest translation is hidden`（Codex #80） | 停在 `closest()` 返回 null，链接点不动 | renderer/anchors.test.ts:163 |
| `anchors.ts:124-125` `target` 非 `_self` 不接管 | 别的浏览上下文 | 55fe4e1 2026-09-06 `fix(renderer): send in-page anchors to the translation in only mode`（Codex #80） | 拦下再 preventDefault 会把新标签打开变成当前页跳转；12 篇 fixture 0 例 | renderer/anchors.test.ts:120、:133 |
| `anchors.ts:95,105-112` `selfNavHash` + `location.hash` 而非 `pushState` | 原生 `hashchange` 照样派发；重入用记值不用布尔 | 55fe4e1（Codex #80） | `hashchange` 异步派发，同步布尔守卫在事件到达前被重置 | renderer/anchors.test.ts:142、:262 |
| `anchors.ts:30` `decodeURIComponent` 失败按原样查 | 转义过的 href | 55fe4e1 | 非法转义抛错 | 无专门用例 |
| `mirror.ts:26` `MARGIN_ASIDE` 不镜像 | 浮到页面外缘的不镜像 | fa7a082 2026-09-05 `fix(renderer): stop mirroring content ar5iv floats into the page margin` | 2312.17141：左栏那份浮到 1320→1752 压住右栏 | renderer/mirror.test.ts:136 |
| `mirror.ts:28-37` 五道闸（块标记 / 下一个兄弟注入 / 内含注入 / 内含块标记） | 不整块克隆待翻内容 | ed15a1d 2026-09-04 `fix(renderer): never mirror before translations exist`；417845f 2026-09-05 | 翻译进行中把整章复制到右栏 | renderer/mirror.test.ts:26、:79、:90 |
| `mirror.ts:49` 翻译根自身也要过 `isMirrorContainer` | 开始前调用什么都不做 | 8f5af3a 2026-09-05 `perf(scheduler): drop JS scroll anchoring, mirror before translations arrive, coalesce prep` | 实测整页内容被复制一遍 | renderer/mirror.test.ts:18 |
| `mirror.ts:56` `closest(SIDE_STACK)` 跳过 | 堆叠区不镜像 | cce7539 2026-09-04 `fix(styles): give each column its own list marker, stop mirroring inside stack zones` | 2312.17141 三面板图每个面板的公式重复一遍 | renderer/mirror.test.ts:121 |
| `mirror.ts:68-69` `aria-hidden` + `inert` | 副本对读屏与 Tab 都隐藏 | 481e1c5 2026-09-07 `test(a11y): close four holes Codex found, and the defect that surfaced`（issue #72） | 2401.00596：参考文献镜像里的 DOI 链接仍在 Tab 序列里（axe `aria-hidden-focus`） | renderer/a11y.test.ts:53；e2e/a11y.mjs |
| `notes.ts:11-13,48` 复制而非移动 | 二次翻译还能找到旧译文 | 5a6fb3e 2026-09-05 `fix(renderer): address the six Codex findings on the side-mode branch`（Codex #26） | 搬走后 `renderText` 找不到旧译文、旧副本又随段落译文被删，脚注译文丢 | renderer/notes.test.ts:109、:138、:150 |
| `notes.ts:143` `arrived()` 排除 pending / error | 只复制已到的译文 | 3301e3b 2026-09-10 `fix(notes): keep the marks in front of the wrapper; localise arrived translations only`（Codex #153） | only 下英文藏在骨架屏后面，失败后永远消失 | renderer/notes.test.ts:81 |
| `notes.ts:68-88` `wrapSource` 从最后一个 mark 之后起包 | 标号留在包裹层外 | e3d66a1 2026-09-10 `fix(notes): hide the note copy's own original in only mode` + 3301e3b（Codex #153） | 54/58 条脚注是 `<sup> <tag> text`，包进空白会让标号排到英文后面、两棵树配不上 | renderer/notes.test.ts:44、:65 |
| `notes.ts:188,209` `registered` 判定 + `reproduces()` | 永远不会翻的脚注也去重 | c3d8045 2026-09-11（用户 2026-09-11 反馈 2509.10652v3） | 6 条 URL 脚注副本与原件逐字相同，同一条边注画两遍 | renderer/notes.test.ts:183、:167、:226 |
| `notes.ts:194,230` `hidable`（identity / mirror / split 副本）两分支都判 | 副本会被某模式整块藏掉时不藏原件 | 39384e7 / bf8a998 2026-09-11 `fix: the second/third round of Codex findings on #163` | 再藏原件整条脚注从页面消失；守卫原来只在未登记分支 | renderer/notes.test.ts:197、:206、:217 |
| `notes.ts:167` `hidableCopy` 在函数内拼 | 避免模块初始化取到环上的 undefined | bf8a998 2026-09-11 | renderer 内 index / mirror / split-figures / notes 互相 import | 无（导入环见 §4） |
| `notes.ts:60-63` 副本里的 mark 只 `hidden` 不删 | 两棵树保持同构 | fac6e91 2026-09-10 `feat(notes): the margin copy of a footnote highlights on its own` | 少一个孪生节点，句子范围会从隐藏原件跑到副本 | renderer/note-mirror.test.ts:33、:61 |
| `notes.ts:125-140` `mirrorNote` → `mirrorPair` | 边注副本自己登记句子 | fac6e91（用户 2026-09-10） | 指着副本走到段落译文，染的是段落那句 | renderer/note-mirror.test.ts:33 |
| `notes.ts:244-261` `delocalizeNotes` | 撤销归位 | 059e516 2026-09-05（Codex #30） | 见 index.ts:160 | renderer/notes.test.ts:117、:126 |
| `margin-notes.ts:46-73` `stackShifts`：原件作双向障碍、`floor` 单调 | 副本让开所有原件 | c3d8045 + bf8a998 2026-09-11（Codex #163 两轮） | 底线被拉回去、只看前面不够 | renderer/margin-notes.test.ts:23、:30、:44、:51 |
| `pair-margins.ts:49` `closest(SIDE_DENY_SUBTREE)` 跳过 | 拆图副本与脚注里的译文不配对 | 5a6fb3e 2026-09-05（Codex #26） | 2312.17141 有 14 处译文抄到插图的边距 | renderer/pair-margins.test.ts:76 |
| `pair-margins.ts:51-52` 先擦内联值再量 | 站点边距变了能修回 | 8d01734 2026-09-04 `fix(renderer): align pair top margins in side mode` | 量到的是自己写进去的 | renderer/pair-margins.test.ts:43 |
| `pair-margins.ts:56` `|| '0px'` | happy-dom 给空串 | 8d01734 | 测试与真机一致 | 无专门用例 |
| `pair-margins.ts:40,65` 读 / 写拆开 | 整理层把读排在写前 | 354c38f 2026-09-07 `perf(renderer): incremental side prep, mirrors once per session`（issue #46） | `:has()` 失效后 `getComputedStyle` 一趟 90 ms、31 趟 818 ms | renderer/pair-margins.test.ts:87 |
| `side-layout.ts:38-43` `SIDE_DENY_SUBTREE` 单独一份、运行时走 `closest` | happy-dom 的 `:is(.ltx_note *)` 恒 false | 3a7777e 2026-09-05 `fix(styles): stop prying folded footnotes open`（用户反馈 2312.17141） | 折叠脚注被 `:has(.axt-t)` 掀开 165×781 | renderer/side-layout.test.ts:53、:168 |
| `side-layout.ts:64` `MIRROR_CONTAINER = SIDE_CONTAINER` | 镜像判定含块标记 | 417845f 2026-09-05 `fix(side): pair columns by block mark, not by translation arrival` | 413 个镜像在翻译结束那一刻才出现 | renderer/side-layout.test.ts:222；renderer/mirror.test.ts:38 |
| `side-layout.ts:20` `MULTI_PANEL_FLEX` 用 `:has(> …:not(.ltx_flex_size_1))` | 只排除多面板 flex 图 | a1d14b3 2026-09-05 `fix(side): single-column flex figures pair left and right` | 单列 flex 图（表格 + 脚注）被误伤成上下排 | renderer/side-layout.test.ts:74 |
| `split-figures.ts:33` `REAL_TRANSLATION` 排除 mirror / split | 镜像不算译文 | 354c38f 2026-09-07（issue #46 实测 2312.17141；常量本身 c478892） | 基线 7 张拆图里 4 张是假拆（媒体先被镜像顶位） | renderer/split-figures.test.ts:157 |
| `split-figures.ts:65` `hasLooseMedia` | 说明文字里的行内公式不算游离媒体 | 5a6fb3e 2026-09-05（Codex #26） | 2312.17527 两个表格浮动体全被拆 | renderer/split-figures.test.ts:50、:59 |
| `split-figures.ts:53-58` `translationKey` 按内容 hash + 句子登记签名 | 换语言重翻也重建 | 5a6fb3e（Codex #26）；签名 19e8538 / a4d8722 2026-09-10（Codex #148） | 只数个数会一直用陈旧副本；登记从无到有时副本永远不被镜像 | renderer/split-figures.test.ts:69、:95；renderer/sentences.test.ts:195、:226 |
| `split-figures.ts:47-50` `signatureOf` 走进表格单元格 | 表格登记在格上 | a4d8722 2026-09-10 `fix(renderer): split signature walks into table cells`（Codex #148） | 2312.11805v4 Figure 10 / 20 图里带表 | renderer/sentences.test.ts:124、:226 |
| `split-figures.ts:76-88,164` `pairNodes` 在删除前建对应表 | 同构时记孪生 | db99ed6 2026-09-10 `fix(renderer): highlight the split copy of a caption, which is the one on screen (#139)` | 删掉原文成员后两棵树不同构 | renderer/sentences.test.ts:61、:96 |
| `split-figures.ts:127-136` `stripIds`：id → `data-axt-split-of`，叠加层 `for` → `data-axt-split-for` | 对应关系不随 id 一起丢 | cff154f 2026-09-06（Codex #80）；e2f782e 2026-09-09 `fix(image): keep the split clone's overlay findable…`（Codex #134） | 图内锚点只能滚到图顶；`clearImageEverywhere` 找不到副本里的叠加层 | renderer/anchors.test.ts:213；renderer/image.test.ts:152 |
| `split-figures.ts:156-158` 删图内镜像与 figure 级镜像 | 两套方案不叠加 | eb3981f 2026-09-05；figure 级 cca11dc 2026-09-07 | 右栏三份 | renderer/split-figures.test.ts:113、:206 |
| `split-figures.ts:184-187` 对原件每个元素 `mirrorSentences` | 不只扫 `.axt-t` | a4d8722（Codex #148） | 表格句子登记在格上，只扫 `.axt-t` 漏掉 | renderer/sentences.test.ts:124 |
| `split-figures.ts:199-212` `dropStaleSplits` 非 side 也跑 | 过期副本丢掉 | cca11dc 2026-09-07；prep 里所有模式都跑：d6a28c5 / 710b375（Codex #89） | side → only 后 OCR 才到，叠加层进了被隐藏的原件；插图唯一译文被摘掉后旧副本一直挂着 | renderer/split-figures.test.ts:218；renderer/prep.test.ts:205、:220 |
| `table-fit.ts:60-82` `measureNatural` 只读三态量法 | 不克隆量 min-content | 2b43f7d 2026-09-05 `fix(side): measure column fit by reading the layout, never by cloning` | 392 张公式表克隆量法 45 秒长任务、页面无响应 | renderer/table-fit.test.ts:143 `不再克隆去量…`、:106-128 |
| `table-fit.ts:32,195-199` `LOOSEN_SLACK` 与「估算值不收紧」 | 迟滞 | 2b43f7d | 估算比真实小 1–2%，会在放松 / 收紧间来回跳 | renderer/table-fit.test.ts:122、:128 |
| `table-fit.ts:189-191` 原表与译表都量、取 max | 两张同档 | a7cbc75 2026-09-07 `fix(renderer): scale a table pair by the wider of the two` | 2606.07636v2 Table 4 译表溢出 179px | renderer/table-fit.test.ts:94 |
| `table-fit.ts:127,181-183` 按「栏宽 + 译文节点」缓存 | 量过的不重量 | ef4350b 2026-09-07 `perf(renderer): batch fitTables reads and writes, cache measured tables`（issue #46） | 每趟全部重量，31 趟 991 ms | renderer/table-fit.test.ts:156、:169、:178、:190 |
| `table-fit.ts:139-145` `watchFontLoads` | 字体加载完清缓存 | 080e2fb 2026-09-07 `fix(renderer): invalidate the fit cache when web fonts finish loading`（Codex #84） | 档位停在字体没到时那一档 | renderer/table-fit.test.ts:245、:265、:274 |
| `table-fit.ts:88-100` `measureColumn` 读根的 `gridTemplateColumns`，退路父宽折半 | 栏宽以翻译根轨道为准 | bae5b1f 2026-09-04 | 表格父级不一定是我们的网格容器 | renderer/prep.test.ts:142 |
| `prep.ts:54-66` `rootsOf`（父元素 ∪ 祖先块父元素 ∪ 最外层 figure 父元素） | 脏块 → 整理根 | 354c38f 2026-09-07（issue #46） | 每趟全篇重扫 31 趟 1.9 s | renderer/prep.test.ts:237、:248、:48 |
| `prep.ts:80-84` 栏宽在写之前、仅陈旧时读；拿翻译根不拿 `<html>` | 避免强制布局 | 354c38f | `measureColumn` 一项 840 ms；传 `<html>` 时栏宽 0、一张表都不缩（e2e 抓到） | renderer/prep.test.ts:127、:142 |
| `prep.ts:107-112` 镜像每会话一次（`mirrorsDone`）且要等块标记 | — | 354c38f（issue #46 / #67） | 第一趟后全是白扫（840 ms）；标记未完时整块克隆 | renderer/prep.test.ts:78、:92、:105；pipeline/marking.test.ts |
| `prep.ts:97` `dropStaleSplits` 在所有模式跑 | 见 split-figures | d6a28c5 2026-09-07（Codex #89） | — | renderer/prep.test.ts:220 |
| `prep.ts:130,142-146` `restack` 第二个合并器 | 边注下排单独一趟读后写 | c3d8045 2026-09-11 | 这一趟写完位置就变了；不在同一趟里读后写（§10） | 无专门用例（margin-notes.test.ts 只测 plan / apply 纯函数） |
| `prep.ts:148-151` `watchFontLoads` → 栏宽陈旧 + 全量 | — | 354c38f | — | renderer/prep.test.ts:153 |
| `responsive.ts:6` `NARROW_QUERY = (max-width: 1279px)` | 与 arXiv 主题折叠导航的断点对齐 | 0a1ac22 2026-09-04 `feat(renderer): side and only modes with viewport-aware downgrade` | — | renderer/responsive.test.ts:22-89 |
| `style-preset.ts:29-30` `TOP_TRANSLATION_SELECTOR` | 透明度只落到最外层真译文 | 6182e1e 2026-09-08 `fix(style): make the preview real, the highlight picker reach highlights, and opacity stop compounding`（Codex #106） | 脚注译文嵌在段落译文里，opacity 相乘 0.3 → 0.09 | renderer/style-vars.test.ts:89、:133 |
| `style-preset.ts:59-76` `appearanceRule` 分 `base` / `overrides` 两段 | 分别排在 presets.css 两侧 | 25fedee 2026-09-08 `fix(renderer): let blur/blink respect the opacity slider, settle the start/watch race`（Codex #106） | 模糊规则要与 `--axt-opacity` 复合而不是顶掉 | renderer/style-vars.test.ts:97、:123、:153 |
| `style-values.ts:14-21` `sanitizeCustomCss` 拒 `{ } @ <` | 只收声明块 | 8d8f9ef 2026-09-10 `feat(config): v12 — the reader's own services and appearance profiles` | 一个多余花括号改掉整篇排版 | renderer/presets.test.ts:101 |
| `style-values.ts:32-56` 静态 `NAMED_COLORS` + 只做词法的函数分支 | 不用 `CSS.supports` | 8d8f9ef | service worker 没有 `CSS`；happy-dom 对任何串返回 true | renderer/style-vars.test.ts:14-40 |
| `image.ts:71-79` `clearImageEverywhere` 按 `data-axt-split-for` 也找 | 副本里那份叠加层也摘 | 710b375 2026-09-09 `fix(image): clear the split clone's overlay too, and wait for the real count`（Codex #134） | only 下读者看到副本里上一轮甚至上一种语言的译文 | renderer/image.test.ts:152 |
| `image.ts:135-136` `renderImage` 先删紧跟的镜像 | 叠加层必须是图的下一个兄弟 | cca11dc 2026-09-07 `feat(image): overlay renderer…` | 锚点按前面最近的同名锚点解析 | renderer/image.test.ts:49 |
| `image.ts:109-121` 斜标签用 `cqw` 单位 + `translate/rotate` | 百分比在非正方形容器里长度错 | c3d8045 2026-09-11（原 e995076 2026-09-09 只做 ±90°） | 2609.10326v1 的 `reheating`（6°）以前被丢 | renderer/image.test.ts:114-144 |
| `highlight.ts:41` `MISS_GRACE_MS = 120` | 未命中先按住 | db38c5d 2026-09-09 `feat(renderer): hover highlight pairing the two sides` | 段落间空隙的连续移动会闪 | renderer/highlight.test.ts:568 |
| `highlight.ts:52,315-355` `HIT_SLACK_PX = 4` + `offsetOn` 两个相邻字符实测 | 指针必须真的压在文字上；先真包含再看 slack | be9ce2e / 8371c41 2026-09-09（Codex #136；用户实测右侧空白整条点亮） | `caretPositionFromPoint` 答的是最近插入点；中文句界无空格，右半个句号会染下一句 | renderer/highlight.test.ts:585、:605、:631、:653 |
| `highlight.ts:62,487-511` `SCROLL_SETTLE_MS` + 捕获 `scroll`（容器立刻、页面停 120ms） | 滚动后重测 | 151c77d / ea8bc73 2026-09-09（Codex #138） | 容器滚自己的内容带不动色带；页面滚动每帧命中太贵 | renderer/highlight.test.ts:242、:401 |
| `highlight.ts:71,246,377` 模块级 `epoch` | 外部清空让句子缓存失效 | fb5fb3d 2026-09-09（Codex #130） | 指针停在原处永远走短路 | renderer/highlight.test.ts:549、:525 |
| `highlight.ts:383-384` 原点取色带层自身矩形 | 不按 `documentElement` | 01209a6 2026-09-09 `fix(renderer): measure the bands from the layer's own origin`（Codex #138） | 站点给 `<body>` 定位时整体偏移 | renderer/highlight.test.ts:296 |
| `highlight.ts:182-203` `clipOf` 按裁剪祖先求交 | 色带不跑出滚动容器 | 9d6e9d2 2026-09-09（Codex #138） | `getClientRects` 报整个排版盒含滚出去的部分 | renderer/highlight.test.ts:426 |
| `highlight.ts:257-267` `STALE` 而非 `shown = null`；`if (!over) return` | 失效但不忘记；指针不在时不重测 | 6e2f257 / 1159419 2026-09-09（Codex #138） | 重排移走句子后色带留着；启动 resize 在 (0,0) 命中 | renderer/highlight.test.ts:274、:323 |
| `highlight.ts:531-575` `ResizeObserver(body)` + `MutationObserver(body 全属性 / characterData)` + `documentElement` 属性 + `fonts.loadingdone` | 指针没动时的重排也重画 | 7ad7bca / 9cb1627 2026-09-09；4d447e0 2026-09-10（Codex #138 三轮、#149） | 译文逐块到达把句子推下去；插入不改高度的重排；站点切主题 | renderer/highlight.test.ts:347、:369、:220、:888、:944 |
| `highlight.ts:558-561` `movesText` → `peek.expire` | 登记块原地改动就作废 | 788e99c 2026-09-10 `fix(highlight): expire a registration on any text-moving change, reclone on attribute changes`（Codex #149 ×3） | 旧偏移重建克隆会越过句界显示假对照 | renderer/highlight.test.ts:841、:873；renderer/peek.test.ts:297、:328 |
| `highlight.ts:389,400-435` 对侧未渲染 → 不画对侧色带、改 `peek.show`，锚在视口内的色带 | only 模式看原文 | b62597a 2026-09-10 `feat(highlight): show the hidden side's sentence in a panel (issue #141)`；锚点 78b719e（Codex #149） | 长句句首在视口上方，面板开头在屏幕外 | renderer/highlight.test.ts:727-762、:928 |
| `highlight.ts:143-164,432` `pageBackground` / `textColour` 取被藏侧的计算样式 | 面板用页面自己的字体与颜色 | f00d0a3 / f57f6bb 2026-09-10（Codex #149） | `Canvas` 在模拟深色时把面板画成黑底；gradient 预设 `color: transparent` 得到空白面板 | renderer/highlight.test.ts:992；renderer/peek.test.ts:194 |
| `peek.ts:30` `PEEK_DWELL_MS = 600`，按句子身份计时 | 驻留 | b62597a（用户 2026-09-09） | 滚动时每碰一句就弹 | renderer/peek.test.ts:40、:68、:93 |
| `peek.ts:42,152-155` `COMFORT_PX = 240` + `growsDown` | 下方不足且上方更宽裕时改到上方 | f57f6bb / 30b66dd 2026-09-10（Codex #149） | 面板从不测量，只能选更宽裕的一侧 | renderer/peek.test.ts:180、:205 |
| `peek.ts:163,279` `current(key)` 回调 | 驻留到期先问「还是当前那句吗」 | 48725a9 2026-09-10 `fix(highlight): stale dwell, occupied margin, swapped side (#149 round two)` | `clearSentenceHighlights` 在驻留期间无面板可删，到期渲染过期面板 | renderer/peek.test.ts:267；renderer/highlight.test.ts:963 |
| `peek.ts:225-226` 面板 `inert` + `aria-hidden` | 克隆的链接不能 Tab 到 | f57f6bb（Codex #149） | — | renderer/peek.test.ts:106（无 inert 断言）；renderer/a11y.test.ts（grep 到 inert） |
| `peek.ts:238` 删 `ANNOTATION_SELECTOR` | 脚注容器会从面板里飘出去 | b62597a | `float: inline-end` + 负边距 | renderer/peek.test.ts:106 |
| `peek.ts:310-326` `marginFree` 与每个边注框相交测试 | 边距档不遮脚注 | cd49e5e 2026-09-10 `fix(highlight): intersect the panel's footprint with every margin aside`（Codex #149 ×3） | 点探针每 120px 会漏掉一行高的脚注 | renderer/peek.test.ts:224、:235 |
| `peek.ts:249-252` `panel && !panel.isConnected` 重置 | 外部删掉面板后冷启动 | b62597a | 脱离文档的面板等于没有 | renderer/peek.test.ts:404 |
| `peek.ts:173,253-256,302-306` `dirty` WeakSet + `expire` | 脏登记拒绝显示直到重登记 | 4d447e0 2026-09-10（Codex #149） | 重克隆会显示假对齐 | renderer/peek.test.ts:297 |
| `peek.ts:175,307-309` `stale` + `restyled` | 属性变化后同键重建克隆 | 788e99c（Codex #149） | 行内子元素被藏 / 露出，克隆过期 | renderer/peek.test.ts:342 |
| `peek.ts:135-144` `movesText` | 注入节点内 / 注入节点增删不算挪动文字 | 788e99c | pipeline 登记后紧接着的 mutation 会让每个块一登记就过期 | renderer/peek.test.ts:328 |
| `sentences.ts:47,56` 记录按译文节点键 + 原文只存 `WeakRef` | 不泄漏 | db38c5d 2026-09-09；WeakRef 数组 db99ed6 2026-09-10（Codex #130） | 按原文键会把脱离的译文子树留一辈子 | renderer/sentences.test.ts:61、:96（泄漏本身无法单测） |
| `sentences.ts:71-73` `rendered()` 带 `visibilityProperty` / `opacityProperty` | `visibility: hidden` / `opacity: 0` 也算隐藏 | f57f6bb 2026-09-10（Codex #149） | 在看不见的字上画色带、永不弹面板 | renderer/highlight.test.ts:980 |
| `sentences.ts:115-124` 无对齐时清掉该原文所有旧登记（含副本自身） | — | a4ee0c1 2026-09-10 `fix(renderer): a re-render must not leave a copy holding last time's boundaries`（Codex #148） | 光删索引不够，副本自己也是 `maps` 的键 | renderer/sentences.test.ts:184、:268 |
| `sentences.ts:135-142` 旧副本长度相同则换句边界，否则删 | 重翻后副本用这一版边界 | a4ee0c1（Codex #148） | 副本签名没变所以没重建，记的还是上一轮句界 | renderer/sentences.test.ts:150 |
| `sentences.ts:247-254` `sentenceMapAt` 无界向上 | 不限 12 层 | fb5fb3d 2026-09-09（Codex #130） | fixture 里文本节点最深 16 层，12 层只覆盖 99.824% | renderer/sentences.test.ts:283 |
| `sentences.ts:234` `live()` 用 `target.root.isConnected` | 用时识别失效条目 | db38c5d 2026-09-09 | `restore()` 后原块仍在、译文已删 | renderer/highlight.test.ts:670、:704 |

### 3.4 scheduler / pipeline / sentences / svg / image

| 位置 | 做什么 | 引入提交 / issue | 解决的问题 | 测试 |
|---|---|---|---|---|
| `coalesce.ts:52` `maxWait` | 去抖加最长等待 | 8f5af3a 2026-09-05（用户反馈） | 413 个镜像在最后一刻同时出现 | scheduler/coalesce.test.ts:19 |
| `lazy.ts:31-41` `observerThresholds` 5% 网格 + 配置值 | 注册点覆盖钳过的阈值 | 58428bb 2026-09-06 `fix: three more findings, including a leftover in my own threshold fix`（Codex #76 / #81） | 注册 `[0, 1]` 时 3000px 块只回调一次 ratio 0.267 | scheduler/lazy.test.ts:219-281 |
| `lazy.ts:52-54` `quantizeThreshold` 向下对齐 | 判定与注册同一刻度 | 58428bb（Codex #81） | 跨越 0.30 报 0.30000001，此后再无回调，精确 0.3333 永不通过 | scheduler/lazy.test.ts:247-310 |
| `lazy.ts:101-107` `effectiveThreshold` 钳到 `root/el` | 超大块够得着多少要求多少 | 929f1b5 2026-09-06 `fix: three UI defects from the Codex backlog`（Codex #32 / #36） | `isIntersecting` 是「>0」不是「≥ threshold」；比 root 高的块永远达不到 1 | scheduler/lazy.test.ts:181-212 |
| `lazy.ts:139` 播种用同一个 `effectiveThreshold` | 两条路径一致 | 929f1b5（Codex #35） | 播种只判矩形相交，配了阈值的用户看到「刚露一像素就翻」 | scheduler/lazy.test.ts:128-165 |
| `lazy.ts:79` 无布局盒的块挂最近祖先块 | 脚注正文 height 0 / display none 永远进不了视口 | 46605c2 2026-09-05 `feat(scheduler): one-shot viewport scheduler`（FluentRead 思路） | — | scheduler/lazy.test.ts:89 |
| `lazy.ts:116-119` `rootBounds` 为 null 退回只看 `isIntersecting`；`- 1e-6` 容差 | 跨文档场景；浮点 | 929f1b5；58428bb | 宁可早翻不可不翻；跨越 0.30 报 0.2999999 | scheduler/lazy.test.ts:303（容差）；rootBounds null 无专门用例 |
| `title.ts:25-29,56` `version` 守卫；`stop()` 时页面自己改过标题则以它为准 | 晚到结果丢弃；恢复不覆盖站点改动 | 2abb399 2026-09-05 `feat(scheduler): translate document.title; config v3 with preload settings` | — | scheduler/title.test.ts:8、:21、:35 |
| `pipeline/run.ts:77,181-187` `FATAL_KINDS`（no-key / auth）→ `fatal` + `disconnect` | 配置错误不再发新批次 | efa5d3f 2026-09-03 `feat(pipeline): batches, degradation chain and run loop` | 继续只会重复失败 | pipeline/run.test.ts:282 |
| `run.ts:138-145` 块标记同步一次写完 | 不切片 | b75ed78 2026-09-06 `fix(pipeline): write block markers in one pass instead of slicing`（issue #67） | 切片标记时第一趟 prep 把 `.ltx_para` 整块克隆到右栏（happy-dom 复现 36 / 23 / 87 处；真机差 570 倍够不着） | pipeline/marking.test.ts:15、:38、:47 |
| `run.ts:150-157` 状态切片，每块前 `halted()` | 恢复原文后不留孤儿属性 | efa5d3f；守卫 issue #45 实验 1 | 让出主线程期间 restore 清干净后循环继续写 | pipeline/session-guard.test.ts:18 |
| `run.ts:217` `retrySingle` 带 `bypassCache` | 重发不读缓存 | 059e516 2026-09-05（Codex #9） | 坏译文在校验前已进缓存，照常读只会原样拿回 | pipeline/run.test.ts:131 |
| `run.ts:242-248` 先渲染 `res.partial` | 一次调用拆多批时成功的先渲染 | bf8a998 2026-09-11 `fix: the third round of Codex findings on #163` | 读者看到「全失败」，重试又秒回 | pipeline/run.test.ts:245、:257 |
| `run.ts:254-257` 只在 `res.error.isolatable` 时对半拆 | 系统性失败不拆 | 7f2992f 2026-09-11 `fix(providers): isolate only per-segment failures, send only matched terms`（研究审计 B20） | 4 段 `bad-request` 变 7 次调用；限流更是反效果 | pipeline/run.test.ts:167、:225、:236 |
| `run.ts:306-319` 表格「有一格没翻出来就算失败」但半份克隆照显 | 见 PARTIAL_ATTR | b1fc79d / 5c8a7bd 2026-09-05（Codex #9 / #30） | — | pipeline/run.test.ts:349 |
| `run.ts:285` `if (stopped) return` 在 `translateSegments` 之后 | stop 后不渲染不上报 | 92c5e34 2026-09-05 `feat(pipeline): translate blocks as they enter the viewport` | — | pipeline/run.test.ts:296、:413 |
| `run.ts:344` `scheduler.claim(fresh)` | 手动交出的块不再被观察器重复交 | 92c5e34 | — | 无专门用例（lazy.test.ts:95 测 trigger，不测 claim） |
| `run.ts:175-179` `cutsFor`：空数组照送、undefined 不送 | 「只有一句」与「不该对齐」区分 | 3afffaa 2026-09-09 `fix(providers): four more on the sentence-marker path`（Codex #137） | 两者混为一谈 | pipeline/sentences.test.ts:39 |
| `run.ts:127-131` `served()` 只在换引擎时回调 | 永久换引擎整页重开由 content 判 | e4702c8 2026-09-10 `feat(content): a session can be replaced in place, and a permanent hand-over restarts the page` | 页面一半来自一个引擎、一半来自另一个 | pipeline/run.test.ts:54 |
| `batches.ts:32-40` `sectionTitles` 开始时对整篇算一次 | 按视口翻时一批里没有标题块 | 92c5e34 2026-09-05 | 章节上下文丢失 | pipeline/run.test.ts:91；pipeline/batches.test.ts:18 |
| `batches.ts:79` 数值格不入批 | — | efa5d3f | — | pipeline/batches.test.ts:33 |
| `pipeline/sentences.ts:19,33` `NO_SENTENCES`（bibblock / bibitem）；`renderPath !== 'tags'` 返回 undefined | 参考文献与非 tags 不切句 | e0dc759 2026-09-09（Codex #137） | 期刊缩写切出假边界；runs / markers 没有线上偏移或标记活不下来 | pipeline/sentences.test.ts:27、:71 |
| `paper.ts:6` 旧式 id（`hep-th/9901001`） | — | b1fc79d 2026-09-05（Codex #9） | arXiv 已为旧文生成 HTML | pipeline/paper.test.ts:18 |
| `core/sentences/index.ts:31-32` `ABBR` 缩写表（含 `Sci` / `Rep`） | 缩写后的句点不切 | 3bc5258 起，扩表 076e4a1 2026-09-10 | 实测唯一的两处假切都是期刊缩写；扩表只减不增 | sentences/split.test.ts:28、:34 |
| `index.ts:73,82` `TERMINAL_ABBR` + `CONTINUES`（含 `[` `(`） | `etc.` / `al.` 真能结句，看后文 | 3bc5258 2026-09-09 `fix(sentences): project what a placeholder says, and let etc. end a sentence`（Codex #126 / #137） | `by Gopalan et al. [GHSY12], which…` 是一句 | sentences/split.test.ts:137、:168、:230 |
| `index.ts:184-190` `STRUCTURAL` 标签投影成空串 | 标签是包裹不是分隔 | 6635577 2026-09-09（Codex #126） | `<em>Dr</em>.` 投影成 ` Dr . ` 后缩写守卫失效 | sentences/split.test.ts:190 |
| `index.ts:271` 落在占位符自身文字内的切点丢弃 | 引用里的句点不结句 | b1745e2 2026-09-09 `fix(sentences): ignore boundaries that fall inside a placeholder's own text`（Codex #137） | 整语料 −38 切点、全是句中 | sentences/split.test.ts:221 |
| `index.ts:277-288` `openEnds` 回退越过开标签与其前空白 | 成对标签不被劈开 | 6635577 / 93219a6（Codex #126） | `<t id="N">` 留在上一句、内容在下一句 | sentences/split.test.ts:108、:124 |
| `index.ts:130-144` `visibleTextOf`（`<br>` → 换行、annotation 不读、五种空白折叠） | 槽位文字按读者所见 | 87ae30d 2026-09-09（Codex #126） | TeX 源的反斜杠被当标点切句 | sentences/split.test.ts:176、:160、:200 |
| `index.ts:49-58` `placeholderRe` 按格式选 | tags / markers 语法不相交 | 93219a6 2026-09-09 `fix(sentences): read placeholders per wire format…`（Codex #126） | tags 路径的字面 `@a#` 被当占位符 | sentences/split.test.ts:114、:84 |
| `svg/glyphs.ts:83-85` `hypot(a,b)` / `atan2(b,a)` | 字号与角度从矩阵分解 | 88d6edc 2026-09-09 `feat(svg): read the text out of an SVG figure exactly` | 读 `a` 会把 8.95% 旋转字形当成 0 号 | svg/glyphs.test.ts:43 |
| `glyphs.ts:102-107` `underTransformedAncestor` 跳过 | 不合成祖先 transform | fb877e1 2026-09-09 `fix(svg): skip a glyph whose ancestor carries a transform of its own`（Codex #133） | 语料 54344 个字形 0 例，合成是没测过的代码 | svg/glyphs.test.ts:157 |
| `glyphs.ts:68` `RUN_BREAK = 1.5` 字号 | 断行阈值 | 88d6edc | 三种间距 0.55 / 1.10 / ≥3.86 明显分层 | svg/glyphs.test.ts:19、:34、:60 |
| `glyphs.ts:198-206` `UPRIGHT_TOLERANCE` 归零 | 贴近水平的残差当水平 | c3d8045 2026-09-11（Codex #134） | 千分之一度的残差把横标签画成竖条 | svg/glyphs.test.ts:135 |
| `glyphs.ts:222` 末字形宽度 `0.7 em` | 白框盖住结尾大写 | e8a0cf7 / c3d8045 | 0.55 时露出 0.7% 图宽 | 无专门用例 |
| `svg/runs.ts:29` `BRACES` 不含任何括号 | `looksLikeCode` 不按括号判 | 2398798 2026-09-09 `feat(svg): reject source code drawn as a figure`（Codex #134） | 「括号贴着名字就是调用」误杀 11 个图例 | svg/runs.test.ts:72、:52、:58 |
| `svg/foreign.ts:73-76` `labelText` 先 `proseText` 判词 | 纯公式节点不送 | c3d8045 2026-09-11（Codex #163） | `softmax` 被译成「软最大」盖在公式上 | svg/foreign.test.ts:42、:60、:79 |
| `foreign.ts:128-130` 同位置同文字去重 | TikZ 节点画两遍 | c3d8045（2607.24653v2） | 两个相同标签叠着、请求里两段一样 | svg/foreign.test.ts:48 |
| `foreign.ts:85-92` `pictureTexts` 不读几何 | 收目标时不量矩形 | c3d8045 | 每张图一次强制布局 | svg/foreign.test.ts:74 |
| `image/boxes.ts:48,91` `merge: false` 给内联图；带 `angle` 的行不合并 | — | c3d8045；e995076 2026-09-09 | 相邻 TikZ 节点被合成一个标签；竖排轴标签粘在一起 | image/boxes.test.ts:36-56（横排）；内联图 merge:false 无专门用例 |
| `image/run.ts:119-149` `readImageResponse` 流式读 + 上限 | `arrayBuffer()` 先整体分配 | d6a28c5 2026-09-07 `fix(image): clear stale overlays on empty results, skip animated images, hide baseline outside @supports, cap the fetch while reading`（Codex #89） | 上限形同虚设 | image/run.test.ts:450、:456 |
| `run.ts:178-185` `captionOf` 取最近一层 figure 的 `:scope > figcaption` | 分图各取自己的说明 | d138858 2026-09-07 `fix(image): halt on fatal errors, bound concurrency, own-panel captions, popup retry, clear stale gate`（Codex #89） | 2410.00260 A2.F4 的 (b) 拿到 (a) 的说明 | image/run.test.ts:429 |
| `run.ts:200-202,388-398` run 级队列 + `MAX_CONCURRENT = 2` | 并发对整个 run 生效 | 3c41c0b 2026-09-07 `fix(image): one worker pool per run…`（Codex #89） | 每次 `translate()` 各开一池上限形同虚设 | image/run.test.ts:261、:296、:331 |
| `run.ts:261-278` `svgLines` 等 `load`（5 s 超时） | 没加载好不当场判失败 | 47c76ec 2026-09-09 `fix(image): SVG figures no longer wait on a handshake they do not need`（Codex #134） | 一次性调度，判失败后 `load` 不会再交上来 | image/svg-targets.test.ts:118、:108 |
| `run.ts:307-312` `finishEmpty` 清旧叠加层并 `onRendered` | 换语言后旧译文不留 | d6a28c5 + 710b375（Codex #89） | 副本里还留着、签名不重算副本不重建 | image/run.test.ts:386、:153 |
| `run.ts:314` 动图（`frames > 1`）不叠 | helper 只识别第 0 帧 | 7b55fcc 2026-09-09（Codex #89） | 框对不上 | image/run.test.ts:404 |
| `run.ts:337-355` 失败时先画 `res.partial` 再判致命 | 降级链上前一步的译文不随 auth 一起丢 | 9a1feab 2026-09-11 `fix: the fourth round of Codex findings on #163`（第五轮把它挪到致命分支前） | 致命分支停掉整个调度，这张图没有第二次机会 | image/run.test.ts:220、:239 |
| `run.ts:343-354` 致命：`disconnect` + 已认领的全部记失败 + 结清队列 + 立刻 `report()` | 进度与 `failed()` 对得上；popup 不用等另一个 worker 超时 | d138858 / 3c41c0b（Codex #89） | — | image/run.test.ts:181、:331 |
| `run.ts:87-89,106` `hasPictureText` 只收带词的 TikZ 图 | 纯公式图不进调度 | c3d8045 | 语料 170 张多数是公式 | image/targets.test.ts:33；svg/foreign.test.ts:79 |
| `run.ts:102` 排除块内与注入节点内的图 | 块内的图随占位符克隆进译文、only 下原块整个隐藏 | cca11dc 2026-09-07 | 叠加层无处可挂 | image/targets.test.ts:21、:48 |
| `run.ts:231` `sameText` 相同不画 | 单位 / 变量名 / 原样返回 | cca11dc | 白框盖住排版好的下标 | image/run.test.ts:164 |
| `run.ts:192,372-379,406-413` `parked` + `isEnabled(target)` 按目标问 | 位图等 helper、SVG 不等 | cca11dc；按目标 47c76ec（Codex #134） | helper 握手挂住时 30 s 超时、SVG 白等 | image/run.test.ts:122；image/svg-targets.test.ts:152 |
| `run.ts:153` `fetch(url, { cache: 'force-cache' })` | 复用浏览器图片缓存 | cca11dc | 不再下载一次 | 无 |

<!-- section 3 done -->

## 4. 债务候选

类型取值：重复状态 / 并存路径 / 过渡代码 / 死代码 / 文档不符 / 性能。只列有证据的；「影响范围」写重建时要一起动的文件。

### 4.1 重复状态（同一信息存在两处以上）

| 位置 | 类型 | 证据 | 影响范围 |
|---|---|---|---|
| 「真译文」的界线：`renderer/style-preset.ts:21` `TRANSLATION_SELECTOR`、`split-figures.ts:33` `REAL_TRANSLATION`、`anchors.ts:66`（mirror / pending / error 三项）、`notes.ts:143` `arrived()`（只排 pending / error）、`styles/presets.css:38,49,55,62`、`styles/modes.css:410,415,418,470`、`tests/e2e/layout.mjs:320`、`tests/e2e/extension.mjs:24` | 重复状态 | 同一个 `:not(.axt-pending, .axt-error, .axt-mirror, .axt-split)` 手写 ≥ 12 处；split-figures.ts:29 注释要求「与 §7.5 预设选择器同一条界线」，issue #46 正是这里漂移过（漏了 mirror / split → 假拆）。守卫只有 `renderer/presets.test.ts:57`（查 CSS 行含四项）与 `style-vars.test.ts:60`，**没有任何测试断言 TS 里三个常量彼此相等** | style-preset / split-figures / anchors / notes / 两份 CSS / e2e |
| `SIDE_LAYOUT` ↔ `styles/modes.css:147,159-160,286` 的排除清单 | 重复状态（已知、有守卫） | modes.css 里同一份清单写了两遍（网格声明与配对规则各一份），side-layout.ts:2 承认「modes.css 里的同名清单由测试守着」；`tests/renderer/side-layout.test.ts:53,127` 逐项比对 | rules/latexml.ts、side-layout.ts、modes.css |
| class / 属性名的字面量绕过常量：`side-layout.ts:23` `'.axt-t'`（有 `T_CLASS`）、`:41` `'[data-axt-split]', '.axt-split'`（有 `SPLIT_ATTR` / `SPLIT_CLASS`）；`notes.ts:143`、`split-figures.ts:33,166` `'axt-error'`（有 `ERROR_CLASS`）；`skeleton.ts:64` `'data-axt-inline'`（有 `INLINE_ATTR`）；`notes.ts:54`、`split-figures.ts:132` `'data-axt-'`、`extractor/context.ts:24` `'axt-'`（有 `AXT_ATTR_PREFIX`）；`entrypoints/content/index.ts:465` `'#axt-translate'`（有 `abstract/link.ts:12` `AUTO_TRANSLATE_HASH`） | 重复状态 | 多数是为躲 renderer 内部的 import 环（见 4.3）；`AUTO_TRANSLATE_HASH` 的两份分别在 abstract 与 HTML 两条 content script 里，改一处另一处就失联 | renderer 全目录、marks.ts、content/index.ts |
| `FATAL_KINDS = {'no-key','auth'}`：`pipeline/run.ts:77`、`image/run.ts:31`、`entrypoints/content/index.ts:245`（`kind !== 'no-key' && kind !== 'auth'`） | 重复状态 | 三份手写；providers 侧还有 `ISOLATABLE_BY_KIND`（run.ts:253 注释）；「哪些错误是致命的」没有单一来源 | pipeline/run、image/run、content、providers/types |
| 文字管线与图片管线的状态机：`pipeline/run.ts:79,99-118,181-187,340-355` 与 `image/run.ts:84,189-221,343-354,368-386,414-421` | 并存路径 | `Outcome` 四态、`outcome` Map、`progress()` 归约、`report()`、`fatal` + `disconnect`、`translate(picked)` 过滤 `requested`、`stop()` 结清——两份结构相同的实现；image/run.ts:1-2 说明是有意为之（位图不进 `Block` 联合） | 两个 run 文件、content/index.ts 的两组回调、shared/messages 的两种 Progress |
| 文本抽取 walker 七份：`rules/latexml.ts:388 textOf`（visibleText / proseText）、`extractor/index.ts:43 ownText`、`:59 cellText`、`extractor/context.ts:28 text`、`renderer/index.ts:221 ownText`（同名不同义：按注入节点排除）、`protector/label.ts:74 wireText`、`core/sentences/index.ts:130 visibleTextOf`、`svg/foreign.ts:43 renderedText` | 重复状态 | 各自的排除集不同（skip / protect / unit / injected / annotation / markedasmath / 折叠规则），DESIGN §4.1:113 只定义了一种「可翻译文本」；`hasTranslatableText`（latexml.ts:408）与 extractor 实际用的 `LETTER.test(ownText())` 是两个定义 | rules / extractor / renderer / protector / sentences / svg |
| 空白归一化小工具：`renderer/index.ts:218 squash`、`notes.ts:145 squeeze`、`batches.ts:26 titleOf`、`context.ts:38`、`image/run.ts:168 sameText`、`svg/foreign.ts:56`、`image/run.ts:181`；`ELEMENT_NODE/TEXT_NODE` 常量：`latexml.ts:384`、`extractor/index.ts:34`、`serialize.ts:40`、`label.ts:49`，其余文件用字面量 `1` / `3`；`LETTER` 正则：`latexml.ts:407`、`extractor/index.ts:36`、`boxes.ts:63`、`foreign.ts:70` | 重复状态 | 小但分散；重建时挑一处放 `shared/` | 全部 |
| `renderer/sentences.ts:162-170` 闭包 `moved` 与 `:177-183 movedOnto` | 死代码 / 重复 | 两段逐字相同（含同一条注释），`mirrorSentences` 用前者、`mirrorPair` 用后者 | sentences.ts |
| `marks.ts:57` 注释「以前各有一份几乎一样的实现…现在只有这一份」 vs `split-figures.ts:127-136 stripIds` | 重复状态 | `stripIds` 仍自带一份「剥 id + 剥 data-axt-*」循环（因为要把 id 挪进 `data-axt-split-of`），与 `stripInjected` 半重叠 | marks.ts、split-figures.ts |
| `scanTokens`（`offsets.ts:389`）与 `tokenize`（`tokens.ts:42`） | 并存路径（有意，已守） | offsets.ts:341-348 说明是刻意平行实现（不改最热路径）；`tests/protector/scan.test.ts:24` 在全部 fixture 上钉两者等价 | protector |
| `hidableCopy`（`notes.ts:167`）在函数内拼接 | 过渡代码 | 注释：「三个常量来自 renderer 内互相 import 的模块，模块初始化时取会踩到环」——是 4.3 的症状 | notes.ts |

### 4.2 并存路径 / 死代码

| 位置 | 类型 | 证据 | 影响范围 |
|---|---|---|---|
| `extractor/index.ts:139 markBlocks` vs `pipeline/run.ts:145` 直接 `setAttribute(ID_ATTR)` | 并存路径 | 正式路径不经 `markBlocks`，它只被 `content/debug.ts:16` 调；DESIGN §4.1:111 说「开始翻译时才 mark」指的是 `markBlocks` | extractor、run.ts、debug.ts、DESIGN §4.1 |
| `pair-margins.ts:77 alignPairMargins` | 死代码（src） | prep 只用 `readPairMargins` / `writePairMargins`；只有 `tests/renderer/pair-margins.test.ts` 与 DESIGN:338,366,370,372,393 还在用这个名字 | pair-margins.ts、DESIGN §7.2 |
| `pending.ts:47 clearPending`、`failed.ts:22 clearFailed` | 死代码（src） | 生产路径改由 `clearTranslation` 一并清（pending.ts:22-31 注释解释）；两函数只剩测试调用 | pending.ts、failed.ts |
| `side-layout.ts:50-55 SIDE_CONTAINER` / `isSideContainer` vs `:64-68 MIRROR_CONTAINER` / `isMirrorContainer` | 并存路径 | `MIRROR_CONTAINER = SIDE_CONTAINER`，两个函数体逐字相同；运行时只用 `isMirrorContainer`（mirror.ts:50-51），`isSideContainer` 只有测试用 | side-layout.ts、mirror.ts |
| `core/sentences/index.ts:227 splitSentences` | 死代码（src） | 生产走 `sentenceCuts`；`splitSentences` 只在 4 个测试文件 | sentences |
| `renderer/anchors.ts:152 anchorWouldBreak` | 死代码 | 注释「供测试与调试」，但 src 与 tests 都没有调用 | anchors.ts |
| `rules/abstract.ts:16 ACCESS_LIST` | 死代码 | 无任何引用 | rules/abstract.ts |
| `rules/latexml.ts:408 hasTranslatableText`、`:14 LTX_CLASS_PREFIX`、`:371 DOCUMENT_SUBTITLE`（仅本文件）、`FIGURE_SELECTORS.figure`（只有 `scripts/fixtures-stats.ts:160` 用） | 死代码 / 仅脚本用 | 见 §1.6 | latexml.ts |
| `renderer/sentences.ts:221 sentenceMapOf`、`renderer/index.ts:128 setAppearanceAttrs`（仅同文件）、`INLINE_TITLE_MAX_CHARS`、`responsive.ts:6 NARROW_QUERY`、`scheduler/pacer.ts:5 DEFAULT_WALK_BUDGET_MS`、`yieldToMain`（仅 barrel） | 死代码 / 无外部调用者 | 见 §1.6 的 95 项清单 | — |
| `rules/latexml.ts` 6 处悬空的文档注释：`:149-157`（「§7.2 side 模式的镜像目标」——其常量 `MIRROR…` 在 5a6fb3e 删除，注释留下）、`:160`（「§5.6 优先级」原本贴着 `classify`，现在被 `PARENTHESIZED` 隔开）、`:268-269`（两段 JSDoc 叠在 `FIGURE_SELECTORS` 上）、`:289-290`（「脚注（§7.2 两栏归位用）」叠在 `ANNOTATION_SELECTOR` 上）、`:340`（「文档主标题…」贴在 `SIDE_LAYOUT` 的注释前）、`:372`（「短标题同行的候选」双 JSDoc） | 死代码（注释） | `git log -S` 证实 149-157 与 289-290 是 5a6fb3e 删常量后的残留，340 来自 e401498 | latexml.ts |
| `protector/serialize.ts:44-46` 三行空白（删掉第二条路径后的残留，见 :50-54 注释）；`offsets.ts:211-226` `rangesOf` 的 JSDoc 出现两遍（第一遍悬在 `afterSubtree` 上）；`label.ts:131-134` 「Puts the label's element back」JSDoc 悬在 `wireOffsetOfCut` 上；`rehydrate.ts:8-34` 两段 JSDoc 叠在一个函数上；`style-preset.ts:18-20` 三行叠加注释、`:37-38` 空行 | 死代码（注释） | 都是「删了代码没删注释」 | protector、renderer |
| `renderer/sentences.ts:109` 「today every Google and LLM block, since only Microsoft reports sentence boundaries」 | 文档不符（代码注释过期） | DESIGN:557 与 `pipeline/sentences.ts` 说明 #137 之后 Google 也走切句标记对齐 | sentences.ts |
| happy-dom 驱动的代码形状：`side-layout.ts:18,34-37`（`MULTI_PANEL_FLEX` 走 `closest`、`SIDE_DENY_SUBTREE` 不并进选择器）、`pair-margins.ts:55`、`skeleton.ts:50,82`、`style-values.ts:30` | 过渡代码 | 5 处运行时代码为测试环境让路；side-layout 那两处让「TS 是事实来源」与 CSS 的实际选择器形状不一致 | renderer |

### 4.3 结构性

| 位置 | 类型 | 证据 | 影响范围 |
|---|---|---|---|
| `renderer/index.ts:299-315` 既是渲染核心又是 barrel（`export *` 16 个文件），而 anchors / failed / image / mirror / notes / pair-margins / pending / responsive / split-figures / table-fit 都 `import './index'` | 并存路径（循环依赖） | 10 条 `index ↔ X` 环；`notes.ts:164-166` 为此把常量拼接挪进函数体；`marks.ts:1-3` 把标记常量提到 core 顶层也是为了绕 renderer；4.1 里的字面量绕路多数源于此 | renderer 全目录、marks.ts |
| `renderer/index.ts:100-122 enable()` + `styleSheet()` 把四份 CSS 拼成一个 `<style>`，`applyStyle` 全量重写 `textContent` | 性能 / 结构 | 改一个颜色重写整张（modes 531 + presets 68 + image 102 + highlight 76 行），随后 `clearSentenceHighlights`；只在设置变更时发生，量级小但是「全量重算」的形状 | index.ts、四份 CSS |
| `highlight.ts:71 epoch` 模块级 + `clearSentenceHighlights` 直接删控制器拥有的 `<body>` 子节点 | 重复状态（两处所有者） | 层与面板既由控制器（`layerOf` / `createPeek`）创建，又由模块级函数（`setMode` / `restore` / `applyStyle` 调）删除；控制器再用 `epoch` 与 `panel.isConnected` 反推「被外部删过」（highlight.ts:246-267、peek.ts:249-252） | highlight.ts、peek.ts、index.ts |
| `scheduler/session.ts` 模块级单例 + content/index.ts 13 处 `getSessionId() !== session` 手写守卫 | 重复状态 | 每个异步回调各自比对会话 id；run.ts 又另有 `stopped` / `fatal` / `halted()`；image/run.ts 有 `alive()` = `!stopped && !fatal && isCurrent()` | content/index.ts、pipeline/run.ts、image/run.ts |
| `protector/rehydrate.ts:35` 先 `validate` 一次，`pipeline/run.ts:222,245,268` 调它之前又各 `validate` 一次；`providers/translate-service.ts:15` 再一次 | 重复状态 | 同一段译文最多校验三遍（rehydrate.test.ts:58 守着 rehydrate 内那次） | protector、pipeline、providers |
| `ProtectedBlock.root`（`serialize.ts:35`）与 `slots` 一起持有 DOM 引用；`rehydrate.test.ts:41` 「【已知行为，待 A03】序列化之后原节点被换掉，回填放回去的仍是当时那一份」 | 过渡代码（已知未修） | 测试用「待 A03」标记了一条已知缺陷 | protector |

### 4.4 与 DESIGN.md / CLAUDE.md 不一致

| DESIGN.md 位置 | 文档说 | 代码位置 / 实际 | 类型 |
|---|---|---|---|
| `docs/DESIGN.md:302`（§7.1 第 2 条）「原节点只允许追加 `data-axt-id`、`data-axt-state`、`data-axt-inline`」 | 三个属性 | 原节点还被写 `data-axt-partial`（`renderer/index.ts:151`）、`data-axt-fit`（`table-fit.ts:211`，写在**原表**上）、`data-axt-split`（`split-figures.ts:177`）、`data-axt-note`（`notes.ts:210,231`）；`<html>` 上除 :303 列的四个还有 `data-axt-underline` / `data-axt-blur`（style-preset）、`data-axt-img-modes`（image.ts:43）、`data-axt-sheet`（index.ts:54）、`data-axt-debug`（debug.ts:17）。DESIGN 自己在 :187,:338,:364,:533 提到其中几个，但不变量条目没更新 | 文档不符（清单过期） |
| `DESIGN.md:325` 「`localizeNotes` 把脚注的译文**从原件搬进那份副本**…原件那份标上 `data-axt-note="moved"`」；`:327` 「搬运是**移动**且自幂等」 | 移动、属性值 `moved` | `notes.ts:11-13` 「是复制不是移动」（Codex #26）；`notes.ts:210,231` 写的是空值 `''`；modes.css:308 按 `[data-axt-note]` 匹配 | 文档不符 |
| `DESIGN.md:340` 「镜像随翻译进度去抖重算，而不是进入模式时跑一次」 | 每趟重算 | `:368` / `:770` 与 `prep.ts:107 mirrorsDone`：每会话一次。文档内部自相矛盾，代码取后者 | 文档不符（内部矛盾） |
| `DESIGN.md:516` 「坐标以 `documentElement` 的矩形为原点算」 | documentElement | `highlight.ts:108,383-384`：以色带层自身矩形为原点（01209a6，Codex #138） | 文档不符 |
| `DESIGN.md:535` 「一次 `layer.remove()` 就干净」 | 删层 | `highlight.ts:284-288 clearNow` 用 `replaceChildren()` 保留层（为下次读原点不写后读）；只有 `stop()` / 外部 `clearSentenceHighlights` 才 `remove` | 文档不符 |
| `DESIGN.md:539` 「颜色跟随 `--axt-green`…`styleVarsRule` 从 `config.style.accent` 改写它」 | 旧变量 / 旧函数 / 旧配置字段 | `style-preset.ts:59-76 appearanceRule` 写 `--axt-hl-color` / `--axt-hl-mix`（来自 `look.highlight`）；`:483-497` 已记 v12 把 `--axt-accent` 退役，§7.7 这句没跟着改；`styleVarsRule` 在 src 中不存在 | 文档不符 |
| `DESIGN.md:757`（§10）「标记是切片进行的（几百个块一口气写会冻住页面）」 | 切片 | `run.ts:138-145` 同步一次写完（b75ed78，issue #67）；`:423`（§7.3）已记录此改动，§10 未同步 | 文档不符（内部矛盾） |
| `DESIGN.md:247` `ProtectedBlock { blockId … }` | 有 `blockId`，无 `voidCount / offsets / root` | `serialize.ts:11-36`：无 `blockId`，多 `voidCount`、`offsets`、`root` | 文档不符 |
| `DESIGN.md:225` `classify(el) → { kind; rule }` | 两字段 | `latexml.ts:191-195` 还有 `descend` | 文档不符（小） |
| `DESIGN.md:141-155`（§5.2 表）把 `math` / `.ltx_Math` / `.ltx_tag` / `.ltx_text.ltx_font_typewriter` 列在「跳过规则」；`.ltx_ERROR` 出现两行（:151, :153） | skip | `latexml.ts:122-125` 它们在 `PROTECT_RULES`；§5.6:226 自己也说「`math` 只出现在 PROTECT」 | 文档不符（表与代码分类不一致） |
| `DESIGN.md:338,366,370,372,393` 用 `alignPairMargins` 指代 side prep 的边距步骤 | 一个函数 | prep 走 `readPairMargins` / `writePairMargins`；`alignPairMargins` 只剩测试用 | 文档不符（命名过期） |
| `DESIGN.md:761`（§10）「pending 节点…译文到达后填入」 | 填入 | `:501`（§7.6）与 `renderer/index.ts:187` `renderText` 先 `clearTranslation` 再插新节点——是替换 | 文档不符（内部矛盾） |
| `DESIGN.md:111`（§4.1）「`markBlocks(blocks)` 才写 `data-axt-id`…开始翻译时才 mark」 | 经 `markBlocks` | `run.ts:145` 直接 `setAttribute`；`markBlocks` 只在 `#axt-debug` 路径 | 文档不符（小） |
| `DESIGN.md:113`（§4.1）「可翻译文本 = 排除 protect / skip 子树后的文本含 Unicode 字母」 | 一种定义 | extractor 用 `ownText`（额外排除嵌套 unit / table 与注入节点，`extractor/index.ts:43`）；规则模块的 `hasTranslatableText`（按 visibleText）无人调用 | 文档不符（定义有两个） |
| `CLAUDE.md:65` 硬规则 1「原节点只允许追加 `data-axt-*` 属性」 | 只加属性 | 代码守住了（原节点没有内联 style；`transform` / `margin-top` / `hidden` 都只写在我们的节点上）；但 DESIGN §7.1:302 的枚举清单比 CLAUDE.md 更窄且过期（见上） | 文档间不一致 |

### 4.5 性能敏感点

| 位置 | 类型 | 证据 |
|---|---|---|
| `renderer/prep.ts:74-138 run()` | 写后读（有意、每趟一次） | 顺序：读栏宽 / 边距 / 边注（:80-91）→ **写** `localizeNotes`（:93）、`dropStaleSplits`（:97）、`splitFigures`（:102）、`createMirrors`（:108）→ **读** `readPairMargins(doc)`（:111，仅镜像那趟）与 `fitTables` 的几何（:117 → `table-fit.ts:60-82` `getBoundingClientRect` / `scrollWidth` / `getComputedStyle`）→ 写 `data-axt-fit` / 边距 / 边注。每趟至少一次强制布局落在 `fitTables` 上；DESIGN:368-372 记录的 213 ms / 会话就是这个形状。`restack`（:142）另起一趟读后写 |
| `pair-margins.ts:51-56` | 写后读（样式级） | `removeProperty('margin-top')` 后立刻 `getComputedStyle`；注释说只失效自身样式 |
| `highlight.ts:544-571` `MutationObserver(body, { childList, subtree, attributes, characterData })` | 观察器回调里的同步重活 | 翻译期间每批插骨架屏 / 译文 / 属性都触发；回调对**每条记录**跑 `movesText`（`closest(INJECTED_SELECTOR)`）+ `sentenceMapAt`（沿祖先 WeakMap 查）；`invalidate()` 在指针不在时早退，但记录循环本身不早退 |
| `highlight.ts:357-447 update()` | 每帧读（读写分离已做） | 每次换句：`caretPositionFromPoint` + ≤2 `charRect` + 层矩形 + `clipOf` 两侧各 O(祖先深度) 次 `getComputedStyle` + `rangesOf` 的 `getClientRects`；写在读完之后。首次 `layerOf` 会**先 append 再 getBoundingClientRect**（:383-384，注释承认一次） |
| `renderer/index.ts:256-259 renderTable` | O(cells²) | 每格 `tableCells(clone)`（`querySelectorAll('.ltx_td')`）再取 `[i]`；注释解释是为嵌套表重定位，代价是 n 次全表查询 |
| `scheduler/lazy.ts:144-148 release()` | O(N²) | `for (block of picked) for ([anchor, carried] of byAnchor) carried.includes(block)`；`translate()` 每批调 `claim(fresh)`，整个会话累计 O(N × N)（880 块 ≈ 77 万次 `includes`） |
| `protector/label.ts:74-83 wireText` | O(文本节点 × 槽位) | `protectedNodes.some(slot => slot.contains(node))` 对标签内每个文本节点；仅 markers 且块以格式元素开头时 |
| `mirror.ts:51` | 整页 `:has()` 扫描 + 重复 matches | `querySelectorAll(MIRROR_CONTAINER)`（`:has()` 遍 5 万节点）后 `.filter(isMirrorContainer)` 对 730 个容器再跑一次同样的 `matches` + `closest`；DESIGN:372 量过 30 ms + 138 ms 首次样式计算，决定不优化 |
| `offsets.ts:311-333 rangesOf` | O(void 槽位 × 子树) | 每个 void 槽位 `querySelector(CARVED)`；每次换句一次 |
| `notes.ts:169-176 localizeNotes` | O(译文数 × 子树) | 对根内每个 `.axt-t` 两次 `querySelectorAll(NOTE.content)`；由 `rootsOf` 限定范围 |
| `split-figures.ts:56,66` | 每趟每 figure 重算 | `translationKey`：`querySelectorAll(REAL_OR_IMAGE)` + `textContent` 拼接 + `hashText`；`hasLooseMedia`：每个媒体一次 `closest` |
| `margin-notes.ts:46-73 stackShifts` / `:90-105 planMarginNotes` | O(notes × 原件数 × 收敛轮次)；读 `getBoundingClientRect` 每条边注每个子元素 | 整篇一起量（设计如此），每趟 + restack 各一次 |
| `extractor/index.ts:104-134 extract` + `rules/latexml.ts:240 classify` | O(元素 × 规则数 × 祖先单元数) | `classify` 逐条 `matches`（SKIP 7 + TABLE 1 + UNIT 15 + PROTECT 14 个选择器，含 `:has` / `:not`）；`ownText`（:43）对每个 unit 祖先再把子树分类一遍；DESIGN:171 量过 2312.17141 全页 12.3 ms，可接受 |
| `renderer/index.ts:182 shouldInline` | 重复计算 | 每个标题块在 `renderPending`（pending.ts:36）与 `renderText`（index.ts:203）各调一次 `visibleText` 全子树遍历 |
| `prep.ts:65 rootsOf` | O(roots²) `contains` | 根通常个位数，可忽略 |

<!-- section 4 done -->

## 5. 没看懂或待核实的

1. **`.ltx_note` 的 `descend` 与 extractor 的下钻**：`PROTECT_RULES` 只有 `note` 带 `descend: true`（latexml.ts:119），extractor 对其它 protect 不下钻。但 `serialize` 对 protect 一律作 void 整块克隆——脚注正文成块后又被整块克隆进段落译文，再由 `localizeNotes` 复制译文进副本。这条「先克隆再修补」的链路是三个模块（extractor / protector / notes）联合才成立的，我没找到一份把它写成不变量的测试（`renderer/notes.test.ts` 测的是修补，`protector/clone.test.ts:25` 测的是克隆时删译文）；重建时它是不是仍要保留，需要设计层拍板。
2. **`renderTable` 的 `rendered` 回填与 `registerCells`**（run.ts:298-304）：句子登记以克隆格为 target、原格为 source，但克隆格没有 `data-axt-for`，`sentenceMapAt` 从克隆格向上会先命中 `.axt-t` 表——我没有验证 `recordOf` 在「表格本身未登记、格登记了」时的查找顺序是否总能落到格上（`sentences.test.ts:124` 只测拆图镜像那条）。
3. **`highlight.ts` MutationObserver 在翻译高峰期的真实成本**没有数字：DESIGN §7.7 给的是 pointermove 的帧耗时表，没有「每批插入几百节点时观察器回调的耗时」；上面 4.5 只能标为敏感点。
4. **`lazy.ts:144 release()` 的 O(N²)** 只是读代码得出的，没有在 880 块的 fixture 上量过；`includes` 很快，实际可能不到 1 ms。
5. **`data-axt-fit` 写在原表上**（table-fit.ts:207-211 对 `table` 与 `translation` 都写）是否算 §7.1 允许的「追加 `data-axt-*`」——按 CLAUDE.md 硬规则 1 的措辞算，按 DESIGN §7.1:302 的枚举不算；两份文档谁是准绳需要定。
6. **`PlaceholderIntegrityError`**（validate.ts:37）被 `rehydrate` 抛出，但 run.ts 在调 `rehydrate` 前都先 `validate` 过，所以这个异常在生产路径上应该不可达；`run.ts:204-208` 的 `try/catch` 只包 `joinRuns`。它是不是纯防御，没找到能触发的路径。
7. **`FIGURE_SELECTORS.picture` 与 `SKIP_RULES` 的 `picture`**（`svg, .ltx_picture`）：文字管线整块跳过 svg，图片管线只收 `svg.ltx_picture` 且要求带词——嵌套在 `.ltx_picture` 里的内层 `svg`（image/run.ts:106 排除）与不带 `.ltx_picture` 的裸 `svg`（哪里都不收）各是什么情形，我没有在 fixture 上核。
8. **DESIGN §7.2:325-327 的「移动」描述**与代码「复制」的矛盾，我判为文档过期（有 Codex #26 与测试 `notes.test.ts:109` 佐证），但那段文字写着「用户拍板」，是否有后来的决定把「移动」改回「复制」而没记进文档，只能从 PR 历史确认。
9. **`scripts/fixtures-stats.ts` 与 `scripts/phase0/td-numeric-calib.ts`** 直接 import `UNIT_RULES` / `SKIP_RULES` / `FIGURE_SELECTORS.figure`——它们是规则表在 src 之外的唯一消费者；重建若把规则表改成非导出，这两个脚本要一起动。我没有跑它们确认还能跑。
10. **`entrypoints/content/index.ts`**（467 行）不在我的范围，但它是 `core` 的唯一装配点：`start()` / `endRun()` / `restorePage()` / `enterSide()` 里把 13 个 core 入口串起来，并持有 `run` / `images` / `modes` / `prep` / `highlight` / `title` / `uninstallAnchors` 七个句柄。这一层的状态（`progress` / `running` / `current` / `restarted` / `styleFromWatcher` / `resumeRaster`）与 core 的状态（session 单例、run 的 outcome、image 的 outcome）之间的一致性没有任何测试（`tests/entry/` 只测 abstract 与 context-menu），是重建时最值得先建基线的一处。

<!-- section 5 done -->

