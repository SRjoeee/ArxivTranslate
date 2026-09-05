# CLAUDE.md — arXiv HTML Translator

面向 `https://arxiv.org/html/*` 的 Chrome 翻译扩展：保结构、可逆、适合长期阅读的双语翻译。

**开工前必读 `docs/DESIGN.md`**，它是唯一事实来源。任何与它冲突的实现都是错的；要改设计，先改文档再改代码。
`docs/RESEARCH.md` 存放 Phase 0 的实测结论（选择器校订、参考文件地图、接口存活状态）。

---

## 技术栈（固定，不要另选）

| 用途 | 选择 |
|---|---|
| 扩展框架 | WXT + TypeScript，pnpm |
| UI | React；注入页面的浮层用 WXT `createShadowRootUi` 做 Shadow DOM 隔离；popup / options 是独立扩展页面，无需隔离 |
| LLM 调用 | Vercel AI SDK（`ai` + `@ai-sdk/openai-compatible`（OpenRouter / DeepSeek / Ollama）/ `@ai-sdk/anthropic` / `@ai-sdk/google`），结构化输出用 `generateText` + `Output.object` + zod（AI SDK 7，`generateObject` 已被取代）；请求拼装、流式、错误分类交给 SDK，不自己维护接口 |
| 校验 | zod |
| 队列 / 重试 | 移植 Read Frog `utils/request/`（`request-queue` 令牌桶 + `batch-queue` 攒批 + `retry-policy`），见 DESIGN.md §8.2 |
| 缓存 | Dexie（IndexedDB），移植 FluentRead 的缓存实现 |
| 配置 | WXT storage（带 schema 版本与迁移） |
| hash | Web Crypto SHA-256 |
| Chrome 内置翻译类型 | `@types/dom-chromium-ai` |
| 测试 | Vitest + happy-dom |

不从零实现：请求队列、重试退避、hash、存储封装、JSON 解析容错。一律用上表的库，或移植参考仓库里已经成熟的实现（如 Read Frog 的 `utils/request/*`、FluentRead 的 `services/translation/cache.ts`，后者带 Dexie，允许）。

---

## 目录结构

```
src/
  entrypoints/
    content.ts          # 注入 arxiv.org/html/*
    background.ts       # 队列、providers、缓存
    popup/              # React
    options/            # React
  core/
    rules/latexml.ts    # 所有 ltx_* 选择器只能出现在这里，导出 RULES_VERSION
    extractor/          # 块提取
    protector/          # 占位符：序列化、校验、回填、runs 切段
    renderer/           # 兄弟节点插入、模式切换、恢复
    scheduler/          # 按视口触发的一次性观察器、会话 id、标题翻译、主线程切片
  providers/
    types.ts            # TranslationProvider 接口（见 DESIGN.md §8）
    openai-compat.ts  anthropic.ts  gemini.ts  chrome-builtin.ts  google-gtx.ts
    prompt.ts           # LLM prompt，导出 PROMPT_VERSION
  cache/
  config/
  styles/
    modes.css           # side / stack / only
    presets.css         # 译文样式预设
docs/
  DESIGN.md  RESEARCH.md
tests/
  fixtures/arxiv/<arxiv-id>.html
reference/              # 参考仓库，gitignore，只读
```

---

## 硬规则

1. **DOM 不变量**（DESIGN.md §7.1）：译文节点只作为原块的下一个兄弟插入；原节点只允许追加 `data-axt-*` 属性，不改子树；全局状态只在 `<html>` 上；恢复后 DOM 必须与翻译前逐节点相等。有测试守护，不许绕。
2. **选择器只在一处**：任何 `ltx_*` 选择器只能写在 `src/core/rules/latexml.ts`，其他 TS 文件通过规则模块的函数访问。唯一例外是 `src/styles/*.css`：布局要声明式地写在样式表里，不能靠运行时给节点打标记，那会把排版和 JS 生命周期耦在一起。样式表里的 `ltx_*` 只用于布局，规则模块仍是「哪些内容要翻译」的唯一事实来源。
3. **两条渲染路径**：provider 的 `preservesMarkup` 决定走 markup 还是 runs，不要在渲染层写 provider 特判。
4. **免费接口视为不稳定**：`chrome-builtin`、`google-gtx` 各自独立文件、独立错误类型；失败必须可恢复并触发 fallback 链，不能让扩展整体挂掉。
5. **前缀**：所有注入的 class / data 属性 / CSS 变量以 `axt-` / `data-axt-` / `--axt-` 开头。
6. **缓存键**必须包含 `providerId | model | PROMPT_VERSION | RULES_VERSION | target | renderPath | normalizedText`。改了 prompt 或规则就要升版本号。
7. **敏感信息**：API key 只存 WXT storage，永不进日志、缓存键、测试 fixture、git。

---

## 参考代码使用边界

`reference/` 下是 KISS Translator、Read Frog、FluentRead 的源码（GPL-3.0，与本项目同许可证），**只读**。

- **默认优先移植**：它们已经迭代多年，能整段拿来用的就拿来用（provider 请求拼装、队列 / 重试 / 批处理、缓存、配置迁移、占位符校验、视口调度、样式预设、UI 组件），移植后按本项目的命名与目录改造，不引入它们的配置体系。参考文件地图见 `docs/RESEARCH.md` §4。**搬不搬只看有无负面影响**：暂时用不上但没有额外负担的部分随模块一起搬（按目录搬，不按函数挑），功能稳定后统一清理；会让性能或效果变差的才单独讨论取舍，并把理由写进 DESIGN.md。
- **原创的例外**只有三种：(1) arXiv 适配——`rules/latexml.ts`、`extractor` 的 LaTeXML 路径与 `protector` 占位符引擎（Phase 1 / 2 已完成，DESIGN.md §6）；(2) `renderer`——三个项目都改动、包裹或替换原节点，与 DESIGN.md §7.1 的 DOM 不变量冲突；(3) 移植会与 DESIGN.md 的不变量冲突或让代码变乱时改写，并在 PR 里说明理由。
- **来源标注（GPL §5）**：每个移植文件的文件头写 `// 移植自 reference/<repo>/<path>@<commit>（GPL-3.0），<YYYY-MM-DD> 移植、有修改`（GPL §5(a) 要求修改声明带日期），并在 `docs/THIRD_PARTY.md` 登记；改写幅度大的也要登记。
- 面向未来：extractor 以"站点适配器"接口组织，LaTeXML 是第一个适配器；通用启发式 walker（Read Frog `dom/filter.ts`、`dom/traversal.ts`）移植后作为 v2 的第二个适配器接入其他论文站点，v1 仍只做 arXiv。

---

## 工作流

- 任何超过 100 行的模块，先用 plan mode 给出方案再写代码；方案要引用 DESIGN.md 的对应章节。
- 一个模块一个分支 / PR。`rules`、`protector`、`renderer` 的改动必须附带测试。
- 结束前必须通过：`pnpm test && pnpm build`。
- **PR 开出或 push 后，等 Codex 审完再合并**：它先打 👀 反应表示审查中，结束时留 👍 反应（无建议）、一条 review + 行内评论（有建议）或限额提示，三种终态信号之一出现前不要合。评论逐条核实（fixture / 实测 / 读代码）再采纳，没采纳的写明理由。See `docs/agents/codex-review.md`。
- 遇到 DESIGN.md 里标 **[待验证]** 的内容，先用 fixture 或 curl 实测，把结论写进 `docs/RESEARCH.md`，再实现。
- 发现 DESIGN.md 与实测不符：停下，在 RESEARCH.md 记录差异并提出修改建议，不要默默改设计。
- 代码标识符英文，注释和文档中文。commit message 英文，格式 `type(scope): summary`。

---

## Phase 0 任务（按顺序做，产出全部写入 `docs/RESEARCH.md`）

1. **抓 fixture**：从 arXiv 选 8–10 篇 HTML 存入 `tests/fixtures/arxiv/`，覆盖：
   - 行内公式密集的（数学 / 理论 CS）
   - 有算法框和代码块的
   - 有大表格、数值表的
   - 有脚注、定理环境的
   - 2023 年（早期 LaTeXML 版本）和 2026 年各至少两篇
   - 至少一篇含 `.ltx_ERROR`
2. **规则覆盖率审计**：写一个脚本，对每个 fixture 列出所有带文本的元素及其 `ltx_*` 类名与出现次数，再用 DESIGN.md §5 的翻译单元和跳过规则做匹配，输出三类结果：(a) 规则中不存在于任何 fixture 的类名，(b) 未被任何规则覆盖的带文本元素（漏网），(c) 只在部分年份出现的类名（版本差异）。目标是"每个文本节点恰好落在一条规则下"。顺带统计 SVG 图占比（见 DESIGN.md §15.1）。
3. **容器与导航**：确认 arXiv 主容器（预期 `.ltx_page_main` / `.ltx_page_content`）、左侧导航 `.ltx_page_navbar`、arXiv 自己注入的页头页脚元素的选择器；记录 arXiv 页面自带 JS 的行为（脚注弹出、导航切换、是否有 MathJax 回退）。
4. **参考文件地图**：clone 三个仓库到 `reference/`，为 DESIGN.md §4 的每个模块写一行"参考 `<repo>/<path>`"，重点找：Read Frog 的 DOM walker 与仅译文模式标记处理、KISS 的富文本翻译与 Google 适配器、FluentRead 的渐进翻译与缓存。
5. **接口存活性**：用 curl 验证今天是否可用、返回格式、是否保留 HTML 标签：
   - Google `translate.googleapis.com/translate_a/single?client=gtx`
   - 微软 `edge.microsoft.com/translate/translatetext`（仅记录，v1 不接）
   - Google `translateHtml` 接口（在参考仓库里 grep `translateHtml` 找到用法）
6. **Translator API**：写一个最小 content script 验证 `'Translator' in self`、`Translator.availability()`、`create()` 是否需要用户手势，以及模型下载体验。
7. 最后给出：DESIGN.md 需要修订的条目清单（不要直接改 DESIGN.md）。

---

## 常用命令

```
pnpm install
pnpm dev            # WXT 开发模式，自动加载到 Chrome
pnpm build
pnpm test
pnpm test:watch
pnpm e2e            # 真实浏览器端到端（Playwright 起带扩展的 Chromium，先 pnpm build；首次 npx playwright install chromium）
pnpm fixtures:stats # Phase 0 的类名直方图脚本（待创建）
```

---

## Agent skills

### Issue tracker

Issues 与 spec 记录在本仓库的 GitHub Issues，通过 `gh` CLI 读写。See `docs/agents/issue-tracker.md`.

### Codex review

合并前必须等 Codex 的终态信号（👍 / 行内评论 / 限额提示；👀 表示还在审），评论逐条核实。See `docs/agents/codex-review.md`.

### Triage labels

使用默认的五个 triage 标签（`needs-triage` / `needs-info` / `ready-for-agent` / `ready-for-human` / `wontfix`），标签字符串与角色名一致。See `docs/agents/triage-labels.md`.

### Domain docs

单上下文布局：仓库根 `CONTEXT.md` + `docs/adr/`。See `docs/agents/domain.md`.
