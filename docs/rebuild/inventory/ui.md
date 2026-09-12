<!-- Raw inventory written by a read-only agent on 2026-09-12 against main @ e6de3e1 — one merge before the v0.3.0-mvp baseline (8cfd771). PR #168 later touched src/core/rules/latexml.ts, src/core/extractor/index.ts, src/core/renderer/{index,pending,failed}.ts and src/styles/modes.css, so line numbers in those files have shifted slightly. Kept verbatim (Chinese) as the evidence behind docs/rebuild/INVENTORY.md, which lists the claims that were spot-checked. Delete this file when the rebuild retires the code it describes. -->

# ui inventory — started 2026-09-11T20:36:04Z

工作树: `/private/tmp/claude-501/-Users-cheongzhiyan-Developer-ArxivTranslate/6d482bd8-5c21-4216-9edd-225cdeff7f9e/scratchpad/wt-ui`
HEAD = origin/main = `e6de3e1493e0f2668e6e5a61ff9d9071f606c6b6`（工作树干净，可以继续）

## 1. 模块地图

范围说明：任务分配的目录字面是 `src/entrypoints/content*`、`popup/**`、`options/**`、`src/entrypoints/*.ts`（不含 `background/`）。仓库里 `src/entrypoints/` 下还有 `gallery/`（开发态样例页）——不在字面清单里，但明显是 UI 入口、且只依赖 popup 三层，故补充纳入并在表中注明；`background/` 目录本身不审计，但其中 3 个文件（`context-menu.ts`、`helper-await.ts`、`helper.ts`）与 popup/options 共享消息协议，第 2、5 节会引用它们的行为作为对照，不展开其内部实现。

### 1.1 entrypoints/content*、entrypoints/*.ts（顶层）

| 文件 | 行数 | 职责 | 导出 | 关键依赖 | 引用者 |
|---|---|---|---|---|---|
| `src/entrypoints/abstract.content.ts` | 30 | 摘要页 `arxiv.org/abs/*` 注入双语入口链接；刻意不加载翻译流水线（注释明写"整条翻译流水线一行都不加载"），语言只读 `storage.local` 的 `config.uiLanguage` 一个字段，不走完整 `getConfig` | `default`（WXT content script） | `@/locales`（LOCALES, pickLocale）、`@/core/abstract/link`（injectBilingualLink, relabelBilingualLink，超出本次审计范围） | 无 TS import（WXT 按 `matches` 自动注册）；无测试引用（tests 里搜不到 abstract.content 或 core/abstract/link 的痕迹，见第 8 节待核实） |
| `src/entrypoints/content/index.ts` | 467 | 论文页 `arxiv.org/html/*` 主入口：`extract()` 建 `Block[]`（不写 DOM）→ 监听 7 种 `axt:*` 消息 → `start()/restorePage()/setPageMode()` 驱动翻译会话、模式切换 → `watchConfig` 订阅外观/界面语言/对照高亮/图片模式的热更新 → `enterSide`/`prep` 做 side 模式整理 → `startImages` 挂图片翻译 | `default`（WXT content script） | `@/cache/key`、`@/config/{appearance,schema,storage}`、`@/core/{extractor,image,pipeline,renderer,protector/text,rules/latexml,scheduler}`、`@/shared/{messages,ocr,transport}`、`./debug`、`@/ui/apply-locale`、`@/ui/strings` | 无 TS import（entry）；`tests/rules/selector-boundary.test.ts:170` 读取本文件**源码文本**校验"剥注释不吞代码"这条工具链保障（详见第 5 节）；`tests/renderer/highlight.test.ts:526` 仅注释提及其 `endRun()` 契约，未真正 import |

### 1.2 entrypoints/popup/**

| 文件 | 行数 | 职责 | 导出 | 关键依赖 | 引用者 |
|---|---|---|---|---|---|
| `App.tsx` | 10 | 三层组装：`usePopupData()` → `derivePopupView()` → `<PopupView>` | `App` | `./PopupView`、`./data`、`./view-model` | `main.tsx:5` |
| `data.ts` | 266 | 数据层：发送全部 popup 消息、500ms 轮询（页面加载重试 + 翻译中进度）、`patchConfig` 串行化写配置、`restartIfOn` 落地"设置变更即时生效"策略、`openOptions` 分节跳转 | `PopupActions`（接口）、`OptionsSection`（类型）、`usePopupData` | `@/config/{schema,storage,services}`、`@/core/renderer`（`Mode` 类型）、`@/entrypoints/background/context-menu`（`COMMAND_ID`，**跨越 background 边界**）、`@/providers/transport`、`@/shared/{messages,chain,pack}`、`./view-model` | `App.tsx:4`（`usePopupData`）；`gallery/main.tsx:6`（仅 `PopupActions` 类型） |
| `fixtures.ts` | 65 | `POPUP_FIXTURES`：docs/UI.md §4 的 P0–P16 状态表，每条一个 `PopupInput` | `POPUP_FIXTURES` | `@/config/schema`、`@/providers/transport`、`@/shared/messages`、`./view-model` | `gallery/main.tsx:7`；`tests/popup/view-model.test.ts`（**不在本次分配的测试目录里**，见第 8 节） |
| `main.tsx` | 14 | entry：`applyLocale` 完成后再 `createRoot().render` | — | `@/styles/ui.css`、`@/ui/apply-locale`、`./App` | popup/index.html 的 `<script type=module>` |
| `PopupView.tsx` | 244 | 纯渲染：卡片、菜单行、气泡提示、主/次按钮、模式条、对照高亮/图片翻译/译文样式的最后一行；不含状态推导逻辑 | `PopupView` | `@/core/renderer`（`Mode`）、`@/ui/{BrandMark,Button,HelperSetup,Menu,Segmented,strings,Switch}`、`./data`（`PopupActions` 类型）、`./view-model`（`MenuKind`/`PopupView` 类型） | `App.tsx:3`；`gallery/main.tsx:8` |
| `view-model.ts` | 298 | 纯函数 `derivePopupView`：UI.md §4 状态表的唯一实现；判定 `runnable`/`behind`/`demoted`/`paused` 等派生状态、拼装 4 种菜单内容 | `MANAGE_SERVICES`、`MANAGE_STYLES`、`MenuKind`、`PopupInput`、`Row`、`Note`、`PopupView`、`derivePopupView`、`runnable`、`LANGUAGE_CODES`、`DEFAULT_LANGUAGE`、re-export `PackState` | `@/config/{appearance,languages,schema,services}`、`@/core/renderer`（`Mode`）、`@/providers/{microsoft,prompt-library,transport}`、`@/shared/{messages,ocr,pack}`、`@/ui/Menu`（`MenuItem`）、`@/ui/appearance/tiles`、`@/ui/strings` | `App.tsx:5`、`data.ts:20`（`runnable`）、`fixtures.ts:6`（类型）、`gallery/main.tsx:9`、`tests/popup/view-model.test.ts` |

### 1.3 entrypoints/options/**

| 文件 | 行数 | 职责 | 导出 | 关键依赖 | 引用者 |
|---|---|---|---|---|---|
| `App.tsx` | 88 | 设置页外壳：左导航 4 节、`location.hash` 记住分节（供 popup S-P-83/S-O-05 深链）、界面语言选择器（`MenuField`，改后 `location.reload()`）、fallback 提示条 | `App` | `@/locales`、`@/ui/{BrandMark,MenuField,strings}`、`./data`、`./sections/{Data,Prompts,Reading,Services}` | `main.tsx:6` |
| `data.ts` | 140 | 数据层：`getConfig`/`patch`（串行写）、`fallbackReason`、pack 探测（`checkPack`/`fetchPack`）、helper 探测、缓存统计（`loadCache`，随 `visibilitychange`/`focus` 重读）、`clearCache` | `CacheStats`、`OptionsData`、`useOptionsData` | `@/config/{storage,schema}`、`@/shared/messages`、`@/shared/pack`、`@/ui/strings` | `App.tsx:10`；4 个 sections 组件通过 `OptionsData` 类型 |
| `main.tsx` | 15 | entry | — | `@/styles/ui.css`、`@/ui/apply-locale`、`@/ui/strings`（拼标题）、`./App` | options/index.html |
| `permissions.ts` | 43 | 自定义服务 host 权限：`ensureHostPermission`（点击时申请，用户手势）、`releaseHostPermission`（服务改址/删除时归还，manifest 自带的不动） | `PermissionError`、`originPattern`、`ensureHostPermission`、`releaseHostPermission` | `wxt/browser` | `sections/ServiceDrawer.tsx:16` |
| `PromptManager.tsx` | 179 | 提示词库 UI：内置只读列表 + 自定义列表、view/copy/edit/new 四态编辑器、导入导出、变量按钮插入光标处 | `PromptManager` | `@/providers/{prompt-file,prompt-library}`、`@/shared/uuid`、`@/ui/strings` | `sections/Prompts.tsx:9`。**样式实现与其余设置页不一致**：本文件全部用内联 `style={{...}}` 对象，其余 `entrypoints/options/**` 一律用 Tailwind 类名（见第 7 节债务候选） |
| `sections/Data.tsx` | 26 | "数据"节：缓存条目数/大小、清空（二次确认） | `Data` | `@/ui/Confirm`、`@/ui/strings`、`../data` | `App.tsx:11` |
| `sections/Prompts.tsx` | 61 | "提示词与术语"节：非 LLM 时的提示条 + `PromptManager` + 术语表文本框（逐行解析、超限拒绝写入） | `Prompts` | `@/config/schema`、`@/config/services`、`@/providers/glossary`、`@/ui/strings`、`../data`、`../PromptManager` | `App.tsx:12` |
| `sections/Reading.tsx` | 142 | "阅读"节：译文样式/背景高亮两套 `ProfileGrid`+编辑抽屉、预翻译范围/时机两个 `Segmented`（像素值→档位靠 `nearest()` 就近取整） | `Reading` | `@/config/appearance`、`@/ui/appearance/{ProfileEditor,ProfileGrid,tiles}`、`@/ui/{Field,Segmented,Switch,strings}`、`../data` | `App.tsx:13` |
| `sections/ServiceDrawer.tsx` | 181 | 新增/编辑自定义服务抽屉：本地表单 → 「连接」一次性完成保存 + host 权限申请 + `axt:engine-ready` 等链重建 + `axt:translate` 试译一句；删除会 `rebindAll` | `ServiceDrawer` | `@/config/storage`、`@/config/schema`、`@/config/services`、`@/providers/wire-formats`、`@/shared/messages`、`@/ui/{Button,Confirm,Drawer,Field,Switch,strings}`、`../permissions` | `sections/Services.tsx:15` |
| `sections/Services.tsx` | 156 | "翻译服务"节：内置三服务卡（Microsoft/Google/Chrome）+ 自定义服务列表 + 自动改用开关 + 目标语言 `MenuField` + 图片翻译开关/识别助手状态/模式复选 | `Services` | `@/config/languages`、`@/config/schema`（`MODE_VALUES`）、`@/config/services`、`@/providers/microsoft`、`@/ui/{Button,MenuField,Field,Switch,strings,HelperSetup}`、`../data`、`./ServiceDrawer` | `App.tsx:14` |

### 1.4 entrypoints/gallery/**（补充纳入，理由见上）

| 文件 | 行数 | 职责 | 引用者 |
|---|---|---|---|
| `main.tsx` | 49 | 开发态样例页：并排渲染 `POPUP_FIXTURES` 的浅色/深色两份 `PopupView`，actions 全部只 `console.log` | `index.html` 的 `<script type="module">`；`wxt.config.ts:12-17` 的 `entrypoints:found` 钩子在非 `serve` 命令下把这个入口从构建里删掉（生产包不含样例页） |
| `index.html` | 13 | 静态壳，`<title>Read arXiv · 样例页</title>` | 同上 |

无测试引用 gallery（`grep -rl "entrypoints/gallery" tests` 零结果）。

<!-- section 1 done -->

## 2. 状态模型与消息清单

### 2.1 四处各自持有什么状态

**popup**（`entrypoints/popup/data.ts` 的 `usePopupData`，纯 React state，popup 关闭即销毁）：
- `page: PageStatus | null` —— 每 500ms 轮询 `axt:page-status`（`data.ts:74-76`），翻译中额外每 500ms 轮询一次（`data.ts:136-143`）
- `provider: ProviderStatus | null` —— `axt:provider-status`（`data.ts:81-85`），翻译中带 `scope` 问本会话自己的链
- `config: Config | null` —— 挂载时 `getConfig()` 一次（`data.ts:95-98`），此后只在**本页自己**调用 `patchConfig` 成功后本地回显（`data.ts:169`），**不订阅 `watchConfig`**
- `pack: PackState | null` —— 挂载时查一次，改目标语言/改服务后各自重查（`data.ts:86-90`），直接调 `shared/pack.ts` 的浏览器 API，不经 background
- `helper: HelperStatus | null` —— 挂载时 `axt:helper-status`（`data.ts:103`），收到广播 `axt:helper-ready` 后重查（`data.ts:109-116`）
- `platform`、`menu`（自己的 UI 状态：哪个菜单开着）、`shortcut`、`error`

**options**（`entrypoints/options/data.ts` 的 `useOptionsData`，React state，标签页存活期内常驻）：
- `config: Config | null` —— 同样挂载时读一次 + 自己写入后回显（`data.ts:73-77`、`104-111`），**同样不订阅 `watchConfig`**
- `fallbackReason` —— 挂载时读，写入成功后清空（"有效的写入本身就是修复"，`data.ts:109`）
- `pack: PackState | null` —— **与 popup 完全独立的第二份**，挂载时查一次（`data.ts:76`），`checkPack`/`fetchPack` 各自维护，用 `wanted` ref 防止旧请求覆盖新请求（`data.ts:47-58`）
- `helper: HelperStatus | null` —— **与 popup 完全独立的第三份**，挂载时 `recheck: true` 强制重探（`data.ts:81`）
- `cache: CacheStats | null` / `cacheError` —— 挂载时读，且随 `visibilitychange`/`focus` 事件重读（`data.ts:84-91`，理由见第 5 节）
- `cacheCleared` —— 清空后 2 秒的提示态

**content script**（`entrypoints/content/index.ts`，闭包变量，页面刷新即销毁；核心生命周期状态见 1.1 行数最大的那个文件）：
- `blocks: Block[]`（一次性提取，内存常驻）、`savedMode`（配置里的偏好，读回来之前的占位）、`modes: ModeController | null`（真正生效的模式与切换逻辑）
- `progress: Progress`、`running: PageStatus['running'] | null`、`current`（本次会话的启动快照：session id、config、context、renderPath）
- `look: Look`（外观，三个写入点共用 `styleFromWatcher` 一个闸，见第 5 节）、`highlight`、`images`、`imageProgress`、`restarted`（防止永久改用被同一条链重复触发）

**background**（`entrypoints/background/index.ts`，Service Worker，每次唤醒重建除持久化存储外的一切）：
- `active: Promise<{config, transport}> | null` —— 全浏览器共用一条引擎链与队列（注释：`跨标签页额度策略`），`watchConfig` 回调里判断是否需要 `chainConfigChanged` 决定重建还是原地换 config（`background/index.ts:43-55`）
- `uiLanguage` —— 用于判断界面语言是否变化以重画右键菜单标题
- 会话路由（`sessions.ts`，未展开）：会话 id → 它绑定的链，标签页关闭即撤销
- 识别助手客户端与等待器（`helper.ts` / `helper-await.ts`，未展开）：探测结果与"复制安装命令后等待"的截止时间——**这是 `ui/HelperSetup.tsx` 里 `until`/`timedOut` 的权威来源**，组件卸载重装后靠 `axt:helper-await` 把状态接回来（`ui/HelperSetup.tsx:29-35`）

配置持久化（`config/storage.ts`，不在本次审计范围但是上述四处状态的共同来源）本身只有一份，四处读到的都是它某一时刻的快照或订阅。

### 2.2 同一份信息存在于多处的具体情况

| 信息 | 副本位置（文件:行） | 同步方式 | 备注 |
|---|---|---|---|
| **`config`（完整配置对象）** | content: `entrypoints/content/index.ts` 内多个闭包变量，经 `watchConfig`（`index.ts:90`）**持续订阅**；popup: `data.ts:62`（`useState<Config\|null>`），仅挂载时 `getConfig()`（`data.ts:95`）+ 自写回显（`data.ts:169`），**未订阅** `watchConfig`；options: `data.ts:36`，同样仅挂载读一次（`data.ts:73`）+ 自写回显（`data.ts:106`），**未订阅**；background: `index.ts:26`（`active` 里的 `config`），**订阅** `watchConfig`（`index.ts:43`） | 只有 content 与 background 是"活"的（配置变了立刻感知）；popup / options 是"挂载时的快照 + 自己动作的回显"。若 options 与 content 同时开着改了配置，content 立刻感知（这也是文档里强调"用 watchConfig 而不是消息……还能同时更新所有打开的论文"的原因），但**若 popup 与 options 同时开着**，一方改的字段不会让另一方的本地 `config` 状态刷新，除非重新挂载 | popup 的生命周期短（失焦即销毁）使这个窗口在实践中很小，但代码里没有任何注释说明"popup 为什么不订阅"，是隐含假设而非显式决定，值得在重建时明确写下来（或干脆统一订阅） |
| **"要不要翻/要不要恢复"这条判定** | `entrypoints/popup/view-model.ts` 的 `primary`/`secondary` 推导（约 181-189 行：`on && !behind ? restore : behind ? retranslate : paused ? retranslate : translate`）；`entrypoints/background/context-menu.ts:53-61` 的 `actionFor()`（`state === 'stopped' && fatal !== undefined ? translate : state === 'idle' ? translate : restore`） | **人工保持一致**，无共享代码。`context-menu.ts:48` 注释自陈"分界与 popup 的两个按钮一致"，靠人读代码对齐 | 这正是"重复状态判定逻辑"的典型案例：`actionFor` 只看 `state`+`fatal`，比 popup 的判定粗糙（不管 `behind`/`canRun`/`fallback`），Codex 在 #147 已经抓到过一次真实分歧（`'off'` 状态值不存在，`Progress.state` 只有 `idle\|on\|stopped`，早期实现按 `'off'` 判断导致右键菜单永远发恢复）。三个入口（popup 主按钮、右键菜单、快捷键 `Alt+T`）里后两个共享 `actionFor`，只有 popup 自成一套 |
| **识别助手状态 / 等待态** | background（`helper.ts`/`helper-await.ts`，权威来源）；popup `data.ts:65`（`HelperStatus`，独立轮询）；options `data.ts:39`（`HelperStatus`，独立轮询，`recheck:true`）；`ui/HelperSetup.tsx:23`（本地 `until`/`timedOut`，popup 与 options 各自的组件实例各有一份，卸载重装时靠 `axt:helper-await` 从 background 接回） | popup 与 options 的 `HelperStatus` 互不通气（各自 fetch），只有"探测到了"这一广播事件（`axt:helper-ready`）两边都监听（`data.ts:109-116`、`HelperSetup.tsx:50-58`） | 有意为之且注释写明理由（"等待状态存在 background 而不是这里：popup 一失焦就销毁"），不是失误，但意味着同一时刻 popup 与 options 展示的 helper 状态理论上可以短暂不一致（例如 options 用 `recheck:true` 强制重探时，popup 还拿着旧结果） |
| **Chrome 离线语言包状态（`pack`）** | popup `data.ts:64`、options `data.ts:38`，两者都直接调 `shared/pack.ts:14` 的 `packState()`（包一层 `Translator.availability()`），**不经 background、互相之间没有任何广播** | 各自独立轮询，靠用户操作触发重查（选目标语言、选 Chrome 服务、点下载） | 若 popup 与 options 同时开着，一边点「下载」，另一边的 `pack` 状态不会自动刷新（`axt:engine-ready` 只会让 background 重建链，不会推送 `pack` 值） |
| **模式（mode）——反例，未被错误复制** | popup 的模式条读的是 `page.preference`/`page.mode`（`view-model.ts` 末尾 `mode: { value: page.preference, ... }`），**不是** `config.mode` | 通过 `axt:page-status` 轮询获得最新值 | 特意绕开了本会有的"config 快照过期"问题：`chooseMode` 动作（`data.ts`）只发 `axt:set-mode` 消息，不调 `patchConfig`，所以不会被上面第一行的"config 未订阅"问题连累。是四处状态里唯一显式避免了重复副本陷阱的例子 |

### 2.3 `src/shared/messages.ts` 消息清单（`AxtMessages`，共 15 种）

| type | 发送方（文件:行） | 接收方（文件:行） | 用途 |
|---|---|---|---|
| `axt:translate-page` | popup `data.ts:188,192`；background `context-menu.ts:73`（右键菜单 / 快捷键） | content `content/index.ts:435` | 开始翻译；`restart` 时在原地重开一个会话 |
| `axt:restore-page` | popup `data.ts:195`；background `context-menu.ts:73` | content `content/index.ts:438` | 恢复原文 |
| `axt:set-mode` | popup `data.ts:196` | content `content/index.ts:441` | 切换 side/stack/only，只改属性不重翻 |
| `axt:page-status` | popup `data.ts:75,140`（轮询）；background `context-menu.ts:71`（右键/快捷键问一次状态） | content `content/index.ts:455` | 拿 `PageStatus`（进度、模式、图片进度、`running`） |
| `axt:ping` | 未在 popup/options/content 源码中发现调用点（见第 8 节） | background `background/index.ts` case、`shared/ping.ts` | 连通性探测；`tests/scaffold.test.ts` 里有测试 |
| `axt:stats` | content 自身不发，`#axt-debug` 走本地函数；未见其他调用方 | content `content/index.ts:432` | 内存中 `Block[]` 的统计（开发态） |
| `axt:translate` | content `content/index.ts:268`（标题翻译）与 core/pipeline（经 `shared/transport.ts:17` 转发）；options `ServiceDrawer.tsx:101`（连接测试试译一句） | background `background/index.ts` | 真正发起一次翻译请求（建链/排队/发请求都在 background） |
| `axt:cancel-scope` | content `shared/transport.ts:26`（`endRun()` 时） | background | 撤销一次会话排队与在飞请求 |
| `axt:provider-status` | popup `data.ts:84`、`shared/chain.ts:19`（`awaitChain` 轮询等结算） | background | 链的可用性、降级、`demotions`、`revision` |
| `axt:cache-clear` | options `data.ts:132` | background | 清缓存（可选按论文） |
| `axt:cache-stats` | options `data.ts:62` | background | 缓存条目数/字节数 |
| `axt:retry-failed` | popup `data.ts:197` | content `content/index.ts:444`（转发给 `run.translate`/`images.translate`） | 重试失败块 |
| `axt:engine-ready` | popup `data.ts:259`（下载完包）、options `data.ts:125`（同）、options `ServiceDrawer.tsx:99,133`（新增/删除服务） | background | 通知"能力变了"，重建链；`scope`/`rebindAll` 决定哪些会话跟着换 |
| `axt:helper-status` | popup `data.ts:103,112`；options `data.ts:81`；`ui/HelperSetup.tsx` 未直接发（收 `axt:helper-ready` 后转发查询，见下） | background | 识别助手是否可用；`recheck` 触发重探 |
| `axt:helper-ready` | background 广播（未在本次范围内展开发送点） | popup `data.ts:111`；content `content/index.ts:452`（`resumeRaster`）；`ui/HelperSetup.tsx:52` | 探测到刚装好的助手，通知所有页面（含停着的位图翻译）恢复 |
| `axt:helper-await` | `ui/HelperSetup.tsx:31,68`（挂载时问一次 + 复制命令后 `start:true`） | background | 告知/查询"正在等 helper"的截止时间 |
| `axt:ocr` | content `content/index.ts:312`（`startImages` 里的 `ocr` 回调） | background | 给一张位图做 OCR |

**表里两处"发送方"跨越了本次审计边界**：`background/context-menu.ts` 与 background 的 `axt:helper-ready` 广播源不在分配范围内，但因为它们是 popup/content 消息契约的另一端，第 2 节仍需要引用；除此之外未展开 background 内部实现。

<!-- section 2 done -->

## 3. 交互清单

方法说明：单测覆盖以 `tests/popup/view-model.test.ts`（**不在原分配的 `tests/ui`/`tests/entry` 目录内，见第 8 节**）为准——它测的是"给定输入，视图该长什么样"这条纯函数，不模拟点击；`entrypoints/options/**` 与 `src/ui/**` 的组件**没有任何单测**（仓库里没有 `@testing-library/react`，`tests/options/` 目录不存在，`grep -rl "entrypoints/options" tests` 零命中，已在第 1 节确认）。e2e 覆盖以 6 个 `tests/e2e/*.mjs` 脚本里能找到的 `getByRole`/`getByLabel` 点击证据为准；"无"表示通读全部 6 个脚本后找不到对应交互。

### 3.1 Popup（`PopupView.tsx` + `data.ts` + `view-model.ts`）

| 位置 | 控件 | 改什么 / 发什么 | 即时生效 | 测试 |
|---|---|---|---|---|
| 品牌行 | 齿轮按钮（`aria-label=设置`） | `openOptions()` → `browser.runtime.openOptionsPage()` | 是（打开新页/切到已开的） | 无（e2e 未见 `aria-label` 设置 的点击；`extension.mjs` 都用直接 `goto('chrome-extension://…/options.html')` 绕开这个按钮） |
| 卡片 | 服务行（点击开合菜单） | `openMenu('service')`/`closeMenu()` | 是（本地菜单开合） | 单测（P2 fixture：`view-model.test.ts:38`）；e2e 未见对 popup 内服务行的直接点击（**服务选择全部经由设置页测试**，见 3.2） |
| 服务菜单项 | 选一个内置/自定义服务 | `chooseService(id)` → `patchConfig(provider)` → 视情况 `checkPack`/`restartIfOn` | 是（若翻译中且新服务可跑，原地重开会话；否则只存） | 单测覆盖菜单内容排布（`view-model.test.ts:54`「a reader's services sit where…」）；点击本身无 e2e |
| 服务菜单项 | Chrome 项的"下载" | `downloadPack()` → 浏览器 Translator API + `axt:engine-ready` | 触发下载（异步，无进度条） | 无 e2e 对 popup 内下载按钮的点击（有等价的设置页版本，未直接测 popup 这一份） |
| 服务菜单末行 | "管理翻译服务…" | `openOptions()`（不带分节） | 是 | 无 |
| 卡片 | 语言行 | `openMenu('language')` | 是 | 单测（P3：`view-model.test.ts:65`「every language, searchable」） |
| 语言菜单 | 搜索框 | 纯本地过滤（`Menu.tsx` 内部 state），不发消息 | 是 | 无 e2e（语言搜索只在设置页版本被点过，`options-page.mjs:125`） |
| 语言菜单项 | 选一种语言 | `chooseLanguage(code)` → `patchConfig(targetLanguage)` + `checkPack` + `restartIfOn` | 同服务行 | 单测覆盖菜单内容；点击本身无 e2e |
| 提示词行（仅 LLM） | 开合提示词菜单 | `openMenu('prompt')` | 是 | 单测（P15：`view-model.test.ts:147`） |
| 提示词菜单项 | 选一个提示词 | `choosePrompt(id)` → `patchConfig(prompts.promptId)` + 视情况 `restartIfOn` | 同上 | 单测覆盖内容；点击无 e2e |
| 说明气泡 | "设置"按钮（P6/P7/P8/P9/P11/P13 等状态） | `openOptions()` | 是 | 单测覆盖各状态文案；按钮点击无 e2e |
| 失败气泡 | "重试" | `retryFailed()` → `axt:retry-failed` | 是 | 单测覆盖文案（`view-model.test.ts:81`）；点击无 e2e |
| 识别助手卡（折叠态） | "安装"按钮 | 本地 `setSetupOpen(true)`，就地展开 `HelperSetup` | 是（纯本地 UI 状态，不发消息） | e2e：`extension.mjs:1283-1338`（macOS-only 分支，完整走完安装引导两步、复制、超时、权限拒绝四种子场景） |
| 识别助手卡（展开态，`HelperSetup`） | 命令整块（点击=复制） | `navigator.clipboard.writeText` + `axt:helper-await{start:true}` | 是 | 同上（`extension.mjs:1308-1338`） |
| 识别助手卡 | "教程"链接 | 外部链接，无状态改动 | — | 无 |
| 主按钮 | 翻译本页 / 显示原文 / 重新翻译（同一个按钮，label 随状态） | `translate()` / `restore()` / `retranslate()` → 对应 `axt:*` 消息 | 是 | e2e 覆盖"显示原文"（`extension.mjs:783-786`、`image.mjs:201`）与"翻译本页"（`layout.mjs:67`、`placeholders.mjs:91`）；"重新翻译"路径未见直接点击（P9/P13 只在单测里覆盖文案） |
| 次按钮 | 显示原文（behind/paused 时的次按钮） | `restore()` | 是 | 单测覆盖出现条件；点击本身与主按钮共用同一 action，未见针对次按钮的专门 e2e 断言 |
| 模式条 | 左右 / 上下 / 仅译文 | `chooseMode(mode)` → `axt:set-mode` | 是 | e2e 大量覆盖：`layout.mjs:64-65,350-353`、`image.mjs:146-230`、`extension.mjs:853,1083-1084`、`placeholders.mjs:89`、`a11y.mjs:265` |
| 阅读行 | 对照高亮开关 | `setHighlight(on)` → `patchConfig(reading.sentenceHighlight)`（页面 config watcher 直接应用，不重开会话） | 是 | e2e 仅测了**设置页**那一份开关（`extension.mjs:264-273`），popup 卡片里这一份未见直接点击 |
| 阅读行 | 图片翻译开关 | `setImages(on)` → `patchConfig(image.enabled/modes)` | 是 | e2e 仅测了设置页那一份（`image.mjs:124`、`extension.mjs:252,651,768,1277`），popup 内这一份未见直接点击（1277 那次是读取 `aria-checked`，不是点击它） |
| 阅读行 | 译文样式（打开样式菜单） | `openMenu('style')` | 是 | e2e：`extension.mjs:352`（点击打开） |
| 样式菜单项 | 选一个样式 | `chooseStyle(id)` → `patchConfig(appearance.activeStyle)`（config watcher 直接应用） | 是，且**不重开翻译会话** | e2e：`extension.mjs:353`（选"绿色"，随后断言注入表生效） |
| 样式菜单末行 | "管理译文样式…" | `openOptions('reading')` | 是 | 无 |

### 3.2 设置页 · 外壳与"翻译服务"节

| 位置 | 控件 | 改什么 / 发什么 | 即时生效 | 测试 |
|---|---|---|---|---|
| 左导航 | 4 个分节按钮 | 本地 `setSection` + `location.hash` | 是（纯前端路由，不写配置） | e2e 大量使用 `openSection()`（`options-page.mjs:16-19`，12 处调用） |
| 导航下方 | 界面语言 `MenuField` | `patch(uiLanguage)` 后 **`location.reload()`** | 是，但**是全站唯一需要整页重载才生效的控件** | e2e：`extension.mjs`（`chooseUiLanguage` 被调用 2 次，含"换回中文后导航文字符合"的断言，行号见 `options-page.mjs:142-148`） |
| 内置服务卡 ×3 | Microsoft / Google / Chrome 单选 | `patch(provider)` | 是 | e2e：`chooseBuiltIn()` 8 次调用（`options-page.mjs:36-39`） |
| Chrome 卡 | "下载"chip（仅 downloadable 时出现） | `fetchPack()` | 触发下载 | 未见直接 e2e（`fetchPack` 本身无独立测试，只有 `axt:engine-ready` 之后的链路间接跑过） |
| 我的服务列表 | 每行单选（选用哪个自定义服务） | `choose(id)` | 是 | e2e：`chooseService()` 助手函数**存在但零调用**（见第 6/7 节，测试自身的死代码） |
| 我的服务 | "添加服务" chip | `setEditing('new')` 打开抽屉 | — | e2e：`addService()` 2 次调用（`options-page.mjs:45-62`） |
| 我的服务每行 | "编辑" | `setEditing(service.id)` 打开抽屉 | — | e2e：`clearKeyAndReconnect()` 内部点击"编辑"（`options-page.mjs:72`） |
| 翻译服务节 | 自动改用开关（`fallback.enabled`） | `patch(fallback.enabled)` | 是 | 无直接 e2e（`setSwitch` 助手支持任意开关，但未见以"出问题时自动改用免费服务"为 name 的调用） |
| 翻译服务节 | 目标语言 `MenuField`（可搜索） | `patch(targetLanguage)` + `checkPack` | 是 | e2e：`chooseLanguage()` 3 次调用（`options-page.mjs:122-128`），`extension.mjs:299-314` 额外断言"改完重载仍在" |
| 图片翻译区 | 图片翻译开关（`image.enabled`） | `patch(image.enabled/modes)` | 是 | e2e：`setSwitch(options,'图片翻译',…)` 10 次调用 |
| 图片翻译区 | 识别助手安装引导（未装/非 mac 两态） | 见 `HelperSetup`（同 3.1） | 是 | e2e：`sections/Services.tsx` 内渲染的这份未见专门测试（已测的是 popup 内那份，3.1） |
| 图片翻译区 | 模式复选框 ×3（上下/左右/仅译文） | `patch(image.modes)` | 是 | e2e：`setImageMode()` 8 次调用 |

### 3.3 设置页 · 自定义服务抽屉 `ServiceDrawer.tsx`

| 控件 | 改什么 | 即时生效 | 测试 |
|---|---|---|---|
| 名称 / 接口地址 / 模型 输入框 | 仅本地表单状态，未写配置 | 否（要等"连接"） | e2e：`addService()` 会填这三项（`options-page.mjs:50-53`） |
| API Key 输入框（password） | 本地 `keyInput` | 否 | e2e：`addService` 可选传入；`clearKeyAndReconnect` 专门测清空路径 |
| API Key "清除" | 本地清空 `keyInput` + `form.apiKey` | 否（要等"连接"） | e2e：`clearKeyAndReconnect()`（`options-page.mjs:70-83`），专门断言"清除真的清空了而不是把旧 key 写回去" |
| "更多选项"展开 | 本地 `more` 折叠状态 | — | 无 e2e（`addService`/`clearKeyAndReconnect` 都不展开这一块） |
| 深度思考开关（`thinking`） | 本地表单状态 | 否 | **无 e2e**（这两个测试助手都不涉及"更多选项"区） |
| "连接" | 校验 → 申请 host 权限 → `patch(services[])` → `axt:engine-ready` → `axt:translate` 试译一句 | 是（保存 + 试译一次性完成） | e2e：`addService`/`clearKeyAndReconnect` 都以此按钮收尾并断言结果文案 |
| "删除"（二次确认） | `patch()` 移除服务、`provider` 回退到 microsoft、`axt:engine-ready{rebindAll}`、归还 host 权限 | 是 | **无 e2e**（未找到任何点击"删除"服务的测试） |
| 右上角 ×/Escape/背景点击 | `onClose()`（`Drawer` 通用） | — | e2e 通过 `Escape` 关闭抽屉（`options-page.mjs:59,80`），但那是流程收尾动作，不是专门测试关闭本身 |

### 3.4 设置页 ·"阅读"节 `Reading.tsx` + 外观编辑抽屉 `ProfileEditor.tsx`

| 位置 | 控件 | 改什么 | 即时生效 | 测试 |
|---|---|---|---|---|
| 译文样式网格 | 选一个瓦片 | `patch(appearance.activeStyle)` | 是（config watcher 应用） | e2e：`chooseStyle()` 2 次调用（`options-page.mjs:115-119`），另在 `extension.mjs:325-370` 断言"淡一档"/下划线的实际渲染效果 |
| 译文样式网格 | "添加配置" | 新建 profile 并立即 `setEditing` 打开编辑器 | — | 无 e2e |
| 译文样式网格 | "重置" | `resetBuiltIns(c,'styles')` | 是 | 无 e2e（`extension.mjs:959` 附近的注释提到"样式切回默认"，但看代码是靠 `chooseStyle` 选回内置项，不是点"重置"） |
| 译文样式网格 | 选中瓦片右上角铅笔（编辑） | 打开 `StyleEditor` 抽屉 | — | **无 e2e**（e2e 只选内置瓦片本身，从未打开编辑器） |
| 对照高亮开关（阅读节里的这一份） | `patch(reading.sentenceHighlight)` | 是 | e2e：`extension.mjs:264-273` |
| 背景高亮网格 | 选择/添加/重置/编辑（结构同译文样式） | `patch(appearance.activeHighlight/highlights)` | 是 | **无 e2e** |
| 提前翻译的范围 Segmented（4 档） | `patch(preload.margin)` | 是 | e2e：`setPreload()` 2 次调用 |
| 开始翻译的时机 Segmented（3 档） | `patch(preload.threshold)` | 是 | 同上 |
| **StyleEditor 抽屉**：名称、颜色（8 色板+自定义）、透明度滑杆、下划线类型+线宽、悬停前模糊开关、高级 CSS | 逐字段 `onChange` 即时 `patch`（名称与高级 CSS 有本地草稿态，其余字段每次改动立即写） | 是（内容立即应用于预览 iframe 与真实页面） | **全部无 e2e 与单测**——这是整份清单里覆盖最薄的一块（见第 7 节） |
| **HighlightEditor 抽屉**：名称、底色、透明度 | 同上 | 是 | **无 e2e 与单测** |
| 两个抽屉底部："复制一份" / 删除（二次确认） / 完成 | `onDuplicate`/`onDelete`/`onClose` | — | 无 e2e |

### 3.5 设置页 ·"提示词与术语"节 `Prompts.tsx` + `PromptManager.tsx`

| 控件 | 改什么 | 即时生效 | 测试 |
|---|---|---|---|
| 内置提示词单选 + "查看" | `select(id)` 写 `promptId`；"查看"打开只读编辑器 | 单选是；查看不改状态 | 单选：**无 e2e**；查看：无 |
| 自定义提示词单选 + "编辑" + "删除" | 同上；删除用**浏览器原生 `window.confirm()`**（与全站其它删除的两步 `Confirm` 组件不一致，见第 7 节债务） | 是 | e2e 覆盖"删除"（`extension.mjs:315-321`，"删掉再选回默认"）；"编辑"未覆盖 |
| "新建" | 打开新建编辑器 | — | e2e：`extension.mjs:303-314`（新建"e2e 提示词"并断言重载后仍选中） |
| "导入 JSON" / "导出自定义" | `importFile()` / `downloadPromptFile()` | 导入即时写入 patterns | **无 e2e**（无法点隐藏 `<input type=file>` 走真实文件对话框，仓库里也没有走 `setInputFiles` 的等价测试） |
| 编辑器：名称 / System prompt / 用户提示词 | 本地草稿，"加入列表"才提交 | 否（提交前） | 新建流程间接覆盖名称与默认 prompt 文本（同上），未覆盖修改已有内容 |
| 变量插入按钮 ×6 | 在光标处插入 token 文本 | 是（本地草稿） | 无 e2e |
| "复制并自定义" / "加入列表" / "取消或关闭" | 见 `PromptManager.tsx` | 是（提交时） | "加入列表"间接覆盖（新建流程）；"复制并自定义"未覆盖 |
| 术语表 textarea | 逐行解析，整体合法才 `patch(glossary)` | 是（合法时） | **无 e2e、无单测**（`providers/glossary.ts` 的解析逻辑本身可能在其它目录有单测，但 UI 层的这个文本框从未被 e2e 打开过） |

### 3.6 设置页 ·"数据"节 `Data.tsx`

| 控件 | 改什么 | 即时生效 | 测试 |
|---|---|---|---|
| "清空"（二次确认） | `axt:cache-clear` | 是 | e2e：`extension.mjs:969-973`（"显示条数，清空后归零"） |

### 3.7 统计与小结

- 可数的独立可操作控件（不含 Menu/Drawer 通用的 Escape/点外部关闭等"免费"交互）：**popup 18 个（含菜单内选项按类型各算一个），设置页含两个编辑抽屉与 PromptManager 共约 48 个**，合计 **约 66 个**。
- **完全没有测试**（既无单测也无 e2e）的成片区域：`ProfileEditor.tsx` 的 `StyleEditor`/`HighlightEditor` 全部字段（颜色/透明度/下划线/模糊/高级 CSS/复制/删除）、背景高亮网格的增删改、术语表文本框、PromptManager 的编辑/导入/导出/变量插入、ServiceDrawer 的"更多选项/深度思考"与"删除服务"。
- popup 卡片区的**服务/语言/提示词三个菜单本身**只有 `view-model.ts` 的纯函数单测（验证"菜单该显示什么"），**没有任何 e2e 点击穿过 popup 的这三个入口**——所有语言/服务选择的端到端验证都改在设置页对应控件上做，这是有效覆盖（同一批 React 组件 `Menu.tsx`/`MenuField.tsx` 共用），但意味着 popup 特有的定位逻辑（`Menu.tsx` 的"贴着 popup 底部""向上打开"分支，`docs/DESIGN.md` §... 及 `Menu.tsx:29-33` 的 `MIN_BELOW` 逻辑）没有被端到端点击验证过，只能靠人工核对。

<!-- section 3 done -->

## 4. 样式清单

### 4.1 五个文件各自的角色与加载方式

| 文件 | 行数 | 服务对象 | 加载方式 |
|---|---|---|---|
| `src/styles/ui.css` | 80 | 扩展**自己的三个页面**（popup/options/gallery）：色板 token（浅/深双份 + `data-theme` 显式覆盖）、Tailwind v4 `@theme inline` 入口、`axt-spin` 关键帧 | 被 `popup/main.tsx:1`、`options/main.tsx:1`、`gallery/main.tsx:3` 三处 `import '@/styles/ui.css'` 直接引入（走 Vite 常规 CSS 处理，不是论文页样式） |
| `src/styles/modes.css` | 531 | **论文页**：三种模式（side/stack/only）的全部版式——骨架屏尺寸、失败态描边、side 的 subgrid 两栏与宽度契约、列表标记槽、脚注/边注定位、拆图、RTL 隔离、only 的隐藏规则 | 被 `src/core/renderer/index.ts:10` 以 `import modesCss from '@/styles/modes.css?inline'` 读成字符串，由 renderer 在开始翻译时拼进注入到论文页 `<head>` 的 `<style>`（不在我审计范围内的具体拼装逻辑） |
| `src/styles/presets.css` | 68 | **论文页**：译文外观的下划线/模糊两个开关规则 + 默认变量；v12 后从"21 个预设"收窄成"3 条规则 + 变量" | 同上，`core/renderer/index.ts:11` |
| `src/styles/highlight.css` | 76 | **论文页**：悬停对照高亮的行级底色层（`.axt-hl`）+ only 模式下悬浮原文的浮窗（`.axt-peek`） | 同上，`core/renderer/index.ts:8` |
| `src/styles/image.css` | 102 | **论文页**：图片翻译叠加层，CSS 锚点定位（`anchor-scope`，Chrome ≥131），side 模式下跟随拆图逻辑隐藏原件那份 | 同上，`core/renderer/index.ts:9` |

**四个论文页样式表都不是通过 `manifest.content_scripts` 的 `css` 数组静态注入的**，而是被 `core/renderer`（不在本次审计范围）用 Vite 的 `?inline` 查询读成字符串再动态拼装——这是为什么它们能在"开始翻译"那一刻才出现、且能与 `appearanceRule()`/`styleVarsRule()` 生成的变量按固定顺序拼在一起（`presets.css` 之后是自定义声明块，见 DESIGN §7.5）。

### 4.2 `ltx_*` 选择器清单（五个文件里出现的全部，按 CLAUDE.md 硬规则 2 的例外条款——布局允许在样式表里用 `ltx_*`，但"翻译单元/跳过规则"仍以 `core/rules/latexml.ts` 为唯一事实来源）

以下 48 个 class 均出自 `src/styles/modes.css`（其余 4 个论文页样式表不含任何 `ltx_*`）：

`ltx_abstract`　`ltx_author_notes`※　`ltx_authors`　`ltx_bibblock`　`ltx_bibitem`　`ltx_biblist`　`ltx_caption`　`ltx_centering`　`ltx_description`　`ltx_document`　`ltx_enumerate`　`ltx_flex_break`　`ltx_flex_cell`　`ltx_flex_figure`　`ltx_flex_size_1`　`ltx_font_typewriter`　`ltx_graphics`　`ltx_inline-block`　`ltx_item`　`ltx_itemize`　`ltx_listing`　`ltx_Math`　`ltx_note`　`ltx_note_content`　`ltx_note_frontmatter`　`ltx_note_outer`　`ltx_p`　`ltx_page_content`　`ltx_pagination`　`ltx_para`　`ltx_proof`※　`ltx_pubnotes`　`ltx_pubnotes_content`　`ltx_pubnotes_meta`　`ltx_ref`　`ltx_role_address`　`ltx_role_affiliation`　`ltx_role_thanks`　`ltx_section`※　`ltx_tag`　`ltx_td`　`ltx_theorem`※　`ltx_title`　`ltx_title_abstract`　`ltx_title_document`　`ltx_TOC`　`ltx_transformed_inner`※　`ltx_transformed_outer`　`ltx_url`

※ 标记的 5 个（`ltx_author_notes`、`ltx_proof`、`ltx_section`、`ltx_theorem`、`ltx_transformed_inner`）**只出现在 `modes.css:123-125` 的注释里**，是文档里提到的"早期版本按开放集合逐个列举容器类名"的历史示例，用来说明为什么改成结构判定（`:has(.axt-t, [data-axt-id])`）——**不是实际生效的选择器**。已逐行核对（`grep -n` 定位到 120-146 行的注释块内），不算"死规则"，只是历史说明文字里提到的类名，容易被粗看成是活选择器。

### 4.3 每个规则块服务于哪个模式/功能（`modes.css` 内部结构，按行号）

| 行范围 | 服务对象 | 内容 |
|---|---|---|
| 6-8 | 三模式通用 | `.axt-t { color: var(--axt-color, inherit) }`——唯一一条不分模式的基础色规则 |
| 13-51 | 三模式通用（等待态） | 骨架屏染色变量（浅/深）+ 尺寸/行内标题变体 |
| 59-74 | stack / side / only 各不同 | `data-axt-identity` 隐藏（stack 专属）、非 side 模式的默认外边距、行内短标题 |
| 78-98 | 三模式通用 | 失败态描边、分页标记（`.ltx_pagination`）在 side 网格下的外边距归零 |
| 104-259 | **side 专属** | 两栏 subgrid 主体：列线定义、参与配对的容器判定（`:has()` 结构选择器）、列表标记槽、缩进 |
| 261-293 | **side 专属** | 表格缩放档位（`data-axt-fit`）、堆叠降级区、flex 图换行占位隐藏 |
| 296-298 | 三模式各异 | 镜像节点只在 side 出现 |
| 300-330 | **side 专属**（脚注定位不分模式，但重复隐藏规则只在 `html[data-axt-on]` 下生效） | 脚注去重、RTL 隔离、副本另起一行 |
| 332-354 | **side 专属**（含 stack/only 各一条隐藏对方产物的规则） | 拆图两份的显隐规则 |
| 356-502 | **side 专属** | 宽度契约（三个 token 的闭式函数）、frontmatter 注两档坏法的修复、右侧沟槽定位、标题通栏、图片/代码块 max-width 约束 |
| 504-531 | **only 专属** | 原块隐藏、同行短标题顶回行首、脚注副本里原文的隐藏 |

`presets.css`：22-27 行是三模式通用的默认变量；29-42 是下划线（四种线型共享一条规则，专门处理"不传播到原子行内盒"的边界）；44-65 是悬停前模糊（含防止嵌套译文叠加两次模糊/透明度的 `:where()` 闸）。

`highlight.css`：24-42 是对照高亮的底色层（三模式通用，只在打开 `reading.sentenceHighlight` 时才会有内容）；44-76 是 only 模式专属的"悬浮看原文"浮窗（因为只有 only 模式会隐藏原文，才需要浮出）。

`image.css`：14-16 是不支持锚点定位浏览器的基线（隐藏，防止叠加层掉成一段文字）；18-101 是 `@supports` 内的锚点定位实现，53-57 按 `data-axt-mode` × `data-axt-img-modes` 的九种组合决定显隐，99-101 是 side 模式下"原件那份叠加层"的特异度取胜规则（注释里精确记录了 (0,3,1) vs (0,2,2) 的特异度计算）。

### 4.4 互相覆盖 / 死规则排查

- **没有发现真正死掉的 `axt-*` 选择器**：对 `highlight.css`/`image.css`/`modes.css`/`presets.css` 里出现的全部 27 个 `axt-*`/`data-axt-*` 标识符逐一 `grep -rl` 到 `src/**/*.{ts,tsx}`（排除 `src/styles` 自身），每一个都至少在 1 个 TS/TSX 文件里被产出或消费（详见下表抽样，完整命中数见附注）。
- **`ltx_*` 侧同理**：5 个仅存在于注释里的类名（见 4.2 的※标记）不是选择器，其余 43 个全部在 `html[data-axt-mode="side"] ...` 的实际规则里出现，未发现拼写残留或引用不到的类名。
- **层叠顺序上有意的"覆盖"，不是 bug**：`presets.css` 的下划线/模糊变量、`modes.css` 的 `.axt-t` 基础色，都依赖"注入顺序固定"（`modesCss` → `presetsCss` → `styleVarsRule()` → 自定义声明块，DESIGN §7.5）来实现"后来者覆盖前者"的可控层叠；这是设计好的机制，样式表本身看不出顺序，只能从 `core/renderer/index.ts`（不在本次范围）里确认。**这是一个值得在重建时明确记录的隐性耦合**：五个 CSS 文件单独读都不完整，必须配合 `core/renderer` 的拼装顺序才能判断哪条规则最终生效。

`axt-*` 标识符命中样例（完整命中数见第 1 节相应小节）：`axt-t`→15 个 TS/TSX 文件、`data-axt-mode`→2、`data-axt-fit`→2、`axt-skel`/`axt-skel-line`/`axt-spin`→各 1（均在 `core/renderer/skeleton.ts`，未展开）、`axt-peek`→2（`core/renderer/highlight.ts` 与其测试）。

<!-- section 4 done -->

## 5. 守卫与特判台账

方法：每条先用 `git log -S'<代码片段>' --oneline -- <path>` 定位引入/修复提交，再读提交信息核对（本节列出的 20 条全部按此方法核实，命中的提交信息与代码里自带的"Codex 在 #NNN 指出"注释**逐条一致**，未发现注释与实际历史不符的情况——这个仓库的注释纪律异常扎实，可以当作可信的一手材料，而不只是"读起来像那么回事"）。

| 位置 | 做什么 | 引入/修复提交 | 解决的问题 | 测试 |
|---|---|---|---|---|
| `content/index.ts` `styleFromWatcher` 闸（约 68-70, 91-94 行） | 外观/界面语言有三个写入点（启动读、`start()` 读、`watchConfig`），一旦 watcher 写过就不许更早发起的 `getConfig()` 续写覆盖回去 | `99c0d9a fix: the seventh round of Codex findings on #161` | 设置页刚存的外观被一次晚到的 `await` 结果吞掉；`storage` 事件已消费过不会重来 | 无直接单测/e2e（`content/index.ts` 整体不在 vitest 覆盖范围，只能靠人工或未来的 e2e 断言"外观改了不会被读配置的竞态盖回去"） |
| `content/index.ts` `restarted` 标记每次 `start()` 重置（约 140-145 行） | 永久改用只在**这一次会话**触发一次自动重启，不跨会话保留、也不在会话内无限追链 | `87e62e1 fix: the third round of Codex findings on #157` | 保留跨会话会压制下一个服务需要的重启；会话内不设界限会一路追着链条走 | 无（同上，content 主入口无 vitest 覆盖） |
| `content/index.ts` `start()` 里 `from` 参数与 `getSessionId()` 比对（约 165-190 行） | 自动重启前后两次异步读之间，用户若按了"显示原文"，让这次自动重启失效 | 逻辑本体较早（i18n 提交 `44bed49` 只是把提示语抽成 `S.page.sessionOver`，更早历史未继续深挖） | 陈旧续体在恢复原文之后仍把页面重新翻译一遍，白花请求 | 无 |
| `content/index.ts` `startImages` 的 `settleRaster`/`resumeRaster`（约 300-352 行） | helper 探测**不等**就先跑 SVG/内联图；位图目标停 `parked`；探测失败/未装也要收尾清掉上一轮叠加层；装好后能被动唤醒 | `99c0d9a`（收尾清理那部分）+ `47c76ec fix(image): SVG figures no longer wait on a handshake they do not need`（不等探测那部分） | 与位图无关的 SVG/内联图被一个不相关的握手拖住；探测扑空后旧叠加层/旧目标语言永久残留 | 无 |
| `popup/data.ts` 与 `options/data.ts` 的 `writes.current = writes.current.then(run, run)` 串行写队列（`data.ts:173`、`options/data.ts:112`） | 每次配置改动都排在上一次写完之后再读-改-写；`then(run,run)` 保证某次写抛错不会毒死后续所有写 | `bb223a6 fix(settings): a failed config write must not stop every later one` | 两个控件几乎同时改（例如拖动滑杆）会都读到同一份旧快照，后写的覆盖掉先写的 | 无单测（两个 `data.ts` 都不在 vitest 覆盖范围内，只能靠 e2e 偶然撞到并发写场景，未见专门断言） |
| `options/data.ts` `checkPack` 的 `wanted` ref（46-58 行） | 只采纳"最后一次"语言查询的回包，防止旧请求后回来的结果覆盖新请求 | `64d2cc5 fix: the six round-four Codex findings the first pass missed on #157` | 连续切两次目标语言，查询乱序返回时 Chrome 卡片显示错的语言的可用性 | 无 |
| `options/sections/ServiceDrawer.tsx` 先校验字段再申请 host 权限（`connect()` 内） | `serviceSchema.safeParse` 失败直接抛错，不走到 `ensureHostPermission` | `dec92d1 fix: the fifth round of Codex findings on #157` | 字段有错时不该已经把 host 权限拿到手——错误表单也会留下一个授权 | 间接：e2e 的 `addService`/`clearKeyAndReconnect` 会跑过这条路径的"成功"分支，但没有专门断言"校验失败时权限没被申请" |
| 同文件 `granted = false // the save went through`（约 87 行） | 保存成功后立刻把本地 `granted` 标记清掉，避免后面 `catch` 块误把已经"过户"给存储服务的权限当成本次失败要归还的权限 | `dec92d1`（同上一条，同一轮修复） | 保存成功、随后别的异常（比如后续的 `axt:translate` 试译失败）会把刚存进配置里的服务的 host 权限撤销掉 | 无专门断言，e2e 未覆盖"删除服务"路径（第 3 节已指出） |
| `ui/Drawer.tsx` 打开时把焦点交给**面板内第一个控件**而非面板本身、关闭时还给 `opener`（20-27 行） | 精确到"第一个可聚焦控件"，而不是笼统"面板容器" | `87e62e1 fix: the third round of Codex findings on #157` | 焦点落在面板容器上时，Shift+Tab 会因为两个方向都不匹配"回到起点"的判断而直接走出抽屉、落到背后被遮住的设置页控件上 | 无（无组件测试库，只能靠人工 Tab 走查） |
| `ui/Menu.tsx` `MIN_BELOW = 180` 向上开菜单（29-33, 93-97 行） | 行下方剩余空间不足 180px 时改为贴着行向上展开、按内容高度收拢，而不是继续往下开出一个几像素高的面板 | `8851cec fix(popup): one row for the three reading choices, and a menu that opens upward` | 用户在 2026-09-11 报告：popup 底部的"译文样式"行离窗口底部太近，菜单被裁切/窗口不会长高去容纳它 | 无自动化测试（视觉回归类问题，只能靠人工核对；gallery 的浅/深并排渲染间接有助于肉眼检查，但 gallery 不驱动菜单展开状态） |
| 同文件 `search` 时机把 `autoFocus` 放在搜索框而不是外层 `root`（115-117 行） | 有搜索框的菜单（语言菜单）让输入框自己拿焦点，没有搜索框的菜单让外层 `div` 拿焦点 | `2a40d0b fix: the second round of Codex findings on #161` | 触发按钮是菜单的兄弟节点而不是祖先，焦点留在触发按钮上的话方向键/Enter/Escape 到不了菜单本体 | 无 |
| `ui/HelperSetup.tsx` 剪贴板写入失败也要 `beginWaiting()`（71-77 行） | `navigator.clipboard.writeText` 抛错时依然启动"等待助手"的计时，只是提示语换成"请手动选中命令后复制" | `63c34ce fix: the first round of Codex findings on #166` | 剪贴板被系统权限挡住时，若不开始等待，用户手动复制、装好之后也没人在探测，页面上停着的图永远停着且确认按钮已经消失 | 无 |
| 同文件"只在写入成功之后才说已复制"（64-82 行） | `setCopied(true)` 只在 `try` 块成功之后执行 | 与上一条同一批修复（`#166`） | 剪贴板被挡住时如果照样显示"已复制"，用户会以为手上已经有命令，其实剪贴板是空的 | 无 |
| `ui/appearance/tiles.ts` `CLAMP`（`maxHeight: '2.6em'`，38 行）+ `TEXT_ONLY` 白名单排除会撑大盒子的属性（30-37 行） | 菜单/网格里的样式预览只应用"描述文字"的声明，过滤掉 `font-size`/`line-height` 等会把一行选项撑成几千像素高、把菜单其余部分推出视口的属性 | `2b2335c fix: the tenth round of Codex findings on #161` | 高级 CSS 允许用户写 `font-size: 1000px`，预览瓦片直接照抄会导致菜单/网格布局炸裂 | 无（`tiles.ts` 无对应测试文件） |
| `ui/strings.ts` `copyName`——截断显示名而不是截断后缀（93-97 行） | 名字超过长度上限时从"显示名"那一端裁，"（副本）"这类后缀整体保留 | `99c0d9a fix: the seventh round of Codex findings on #161` | 反过来做的话，一个已经顶到上限的名字被复制出来会和原名区分不开（后缀被吃掉） | `tests/ui/strings.test.ts` 未见专门用例覆盖 `copyName` 的截断分支（`grep -n copyName tests/ui/strings.test.ts` 无命中，见第 8 节） |
| `entrypoints/options/sections/Services.tsx` 图片模式复选框里先读 `e.target.checked` 到局部变量 `on`，再传进 `patch()` 回调（约 128-136 行） | 不在 `patch` 的箭头函数体内读 `e.target.checked` | 该行为背后的闭包陈旧值问题与 #157 系列同源（本条本身未单独用 `git log -S` 定位到专属修复提交，见方法说明） | `patch` 回调要等一次 `getConfig()` 的 await 之后才跑，那时 React 已经把复选框重绘回旧值，`e.target.checked` 这时再读到的是"改之前"的值 | e2e：`setImageMode()` 反复勾选/取消勾选间接验证了最终结果正确（`options-page.mjs:103-112`），但没有专门断言"闭包读的是哪个时间点的值" |
| `entrypoints/background/context-menu.ts` `actionFor` 用 `Pick<PageStatus,'progress'>` 定型入参、`state==='idle'` 而非 `'off'`（53-61 行） | 右键菜单/快捷键的"翻/恢复"判定改成只认 `Progress.state` 实际存在的三个值 | `b88485f fix(entry): the context menu was checking a state that does not exist` | 早期实现按不存在的 `'off'` 判断，菜单**永远**发恢复消息、从未真正触发过翻译；测试里的假样例当时也写着 `'off'`，正好把这个 bug 盖住了 | **有**：`tests/entry/context-menu.test.ts:60`「三个真实状态各自去哪：idle 去翻，其余去恢复」——这是本节里少数有专门单测守着的一条 |
| 同文件"点击处理同步注册，不放进 `.then` 里"（86-92 行） | `deps.onClicked(...)` 在 `installContextMenu` 里同步调用，只有菜单标题的构建（读语言包）在 `.then` 里延后 | `9d76596 fix: the first round of Codex findings on #161` | Service Worker 被"点了菜单"这个事件唤醒时，事件在脚本求值后立刻派发；若注册被塞进一个 promise 的 `.then`，这一次点击会因为监听器还没挂上而彻底丢失 | **有**：`tests/entry/context-menu.test.ts:44`「点击处理同步注册……」 |
| `vitest.config.ts` `environmentOptions.happyDOM.settings.navigation.disableMainFrameNavigation`（21 行） | 单测环境里关掉 happy-dom 把 `location.hash = …` 当真实导航发请求的行为 | `9494fac test: stop happy-dom turning a hash change into a network request` | 页内锚点兜底（issue #44）在测试里把 hash 跳转误判成要真的 `fetch` 一个 `http://localhost:3000/#...`，本机/CI 侥幸是绿的，没网的沙箱直接报错（issue #132，Codex 审 #131 时撞上） | 该设置**本身就是**别的测试套件（`renderer/anchors` 相关）能跑通的前提，间接被那些用例覆盖 |
| `entrypoints/abstract.content.ts` 直接读 `storage.local.get('config').config?.uiLanguage`，不走完整 `getConfig()`（12-16 行） | 只取一个字段，绕开会把 zod、整份 schema 与语言表都拉进这个极小的摘要页脚本的 `getConfig()` | `7444c34 fix: the third round of Codex findings on #161` | 摘要页脚本体积/依赖被不必要地放大；提交信息同时表明这句话"本来是写死的中文"，这次改动顺带把它接上了完整的 `pickLocale` 逻辑 | 无（第 8 节已列为待核实：完全没找到任何测试引用这个入口） |

<!-- section 5 done -->

## 6. 工具链与 i18n

### 6.1 CI（`.github/workflows/ci.yml`）

- 触发：`push` 到 `main` + 所有 `pull_request`；单一 job `check`，`ubuntu-latest`，Node 22（`pnpm/action-setup` + `actions/setup-node` 带 pnpm 缓存）。
- 步骤严格四步、无并行：`pnpm install --frozen-lockfile` → `pnpm typecheck`（`tsc --noEmit`）→ `pnpm lint`（Biome）→ `pnpm test`（vitest 单测，不含任何 e2e）→ `pnpm build`。
- 实测耗时（`gh run list --workflow=ci.yml`，2026-09-11 当天 8 次运行）：稳定在 **2 分 1 秒 – 2 分 31 秒**之间。
- **CI 完全不跑 e2e**：6 个 `tests/e2e/*.mjs` 脚本都需要真实 Chromium + 先 `pnpm build`（部分还要 Playwright 单独 `install chromium`），没有一个出现在 `ci.yml` 里；这意味着 e2e 目前是纯手动运行的安全网，PR 合并不强制过。

### 6.2 e2e：6 个脚本，覆盖面与前置条件

| 脚本 | 行数 | 覆盖 | 前置条件 |
|---|---|---|---|
| `extension.mjs` | 1353 | 最大最全的一个：google-web 整篇翻完与速率、刷新命中缓存、翻译中途恢复原文、错 key 降级链、关降级后恢复、设置页语言/自定义提示词持久化、外观样式实际渲染效果（"淡一档"透明度、下划线画到公式上）、缓存统计与清空、界面语言切换、**识别助手安装引导全流程**（仅 macOS 分支：`process.platform === 'darwin'` 时才跑，含复制/超时/权限拒绝三种子场景） | `pnpm build` 先行；不需要真实 LLM key（LLM 只测错 key 分支，不花钱） |
| `layout.mjs` | 547 | side 模式布局契约：1440/2000px 不溢出、两栏对称、正文封顶 96rem、列表标记槽对齐、flex 图配对、边注定位、**主线程长任务预算**（2312.17141 上最长 ≤ 400ms、合计 ≤ 1.5s） | 同上；对布局测量要求真实渲染引擎 |
| `a11y.mjs` | 304 | A/B 无障碍审计：同一篇论文跑两次 `axe-core`（`@axe-core/playwright`），基线是不装扩展，只报由扩展引入的差集；side/stack/only 各审一次 | 同上；额外依赖 `@axe-core/playwright` |
| `local-endpoint.mjs` | 155 | 不返 CORS 头的 `http://127.0.0.1` 本机端点仍能整页翻译（issue #42 的收益回归）：零预检、服务端只见 `chrome-extension://` Origin | 复制一份构建产物、给副本 manifest 加本机 host 权限（原生授权弹窗 Playwright 点不到） |
| `image.mjs` | 241 | 图片翻译结构性承诺：叠加层锚点定位、side 拆图配对、模式闸控制请求、恢复原文彻底清理 | **需要真机 + 已装的原生 helper**；没装 helper 的机器"打印 SKIP、退出 0"（脚本自己写明"CI 友好"，但目前压根没被接进 CI）；helper 只支持 macOS |
| `placeholders.mjs` | 132 | 占位符存活率：合成论文 12 种句型 × 占位符位置，喂真实引擎（google-web/microsoft），按译文里 `math`/`.ltx_cite`/`.ltx_ref` 计数判定 | `pnpm build`；不需要真实 LLM key（用免费引擎） |

**文档记录不完整**：`e2e:image` 这个 package.json 脚本（`"e2e:image": "node tests/e2e/image.mjs"`）**既不在 `CLAUDE.md` 的"常用命令"清单里，也不在 `docs/DESIGN.md` §11 的测试策略表里**——只在两份临时性的 `docs/superpowers/plans/*.md` 规划文档中被提及。`e2e:placeholders` 出现在 `DESIGN.md`（多处，含 §11 表格）但同样不在 `CLAUDE.md` 的命令清单里。`CLAUDE.md` 清单里还漏列了 `pnpm zip`、`pnpm icons`、`pnpm check:output`、`pnpm helper:build`、`pnpm helper:smoke`、`pnpm lint:fix`（`package.json` 里都有）。这是"文档与实测不符"类债务，按 CLAUDE.md 自己的工作流应"停下来在 RESEARCH.md 记录差异"，但这次审计任务要求不改文档，仅在此列出。

### 6.3 Vitest 配置（`vitest.config.ts`）

- **没有任何 worker/内存相关的特殊配置**（`grep` 遍历 `vitest.config.ts`/`package.json`/`ci.yml`/`tests/setup.ts` 均无 `pool`/`poolOptions`/`maxWorkers`/`singleFork`/`NODE_OPTIONS`/`--max-old-space-size` 等字样）——这是**核实后的"没有"**，不是漏查。
- 唯二的两处定制，均有 git 历史可查：
  - `testTimeout: 30_000`（默认 5s 太短）——`e49a8b9 test: raise vitest testTimeout to 30s for fixture-level suites`，因为规则测试要遍历 1.8MB 的 fixture 页面全部元素，CI 机器上单例最长可达 6s。
  - `environmentOptions.happyDOM.settings.navigation.disableMainFrameNavigation: true` —— `9494fac test: stop happy-dom turning a hash change into a network request`，见第 5 节。
- `tests/setup.ts`（7 行）：只做两件事——`import 'fake-indexeddb/auto'`（Dexie 需要 IndexedDB）、`webcrypto` 兜底（缓存键需要 Web Crypto，Node 环境下 `globalThis.crypto.subtle` 可能缺失）。

### 6.4 i18n

- **两种界面语言**：`zh-CN`（简体中文，类型来源）、`en`（英文，兜底），定义于 `src/locales/index.ts:27-30` 的 `LOCALES` 常量；`Widen<T>` 类型技巧（`index.ts:18-22`）保证 `en.ts` 结构必须与 `zh-CN.ts` 完全对齐，少一个键或多一层嵌套都编译不过——这意味着"键在 zh 有而 en 没有"这类问题**在这两个包之间结构上不可能发生**（CI 的 `pnpm typecheck` 会先挡住），本次审计因此把重点放在"定义了但代码里没用到"。
- **精确的键数**（逐条人工核对 `zh-CN.ts` 的对象字面量得出，见方法说明）：`S`（popup 文案）**73** 个叶子键、`O`（设置页文案）**150** 个叶子键、`REASON`（错误原因）**9** 个，另加 `locales/preview.ts` 的 `PREVIEW_SOURCE`/`PREVIEW_TARGET` 2 个（被两个包共同引用），**合计约 234 个可本地化字符串/函数**。
- **零命中扫描方法**：对全部 232 个 `S`/`O`/`REASON` 叶子键的"最后一段名字"，在 `src/`+`tests/`（排除 `src/locales/*`）里逐一 `grep -rlw`，零命中的先视为疑似死键，再人工回读源码排除"动态下标访问"造成的假阳性。
- **确认的死键（1 个）**：`O.services.apiKeyStored`（`zh-CN.ts:139` = `'已保存'`，`en.ts:133` = `'Saved'`）——**除自身定义处外，`src/` 与 `tests/` 里再无第二处出现**。`entrypoints/options/sections/ServiceDrawer.tsx:159` 处 API Key 输入框已保存态的占位符实际写的是硬编码字符串 `'••••••••'`，UI.md S-O-17 的文案条目描述的"显示 ••••••••"与这个键的语义（"已保存"三个字）本来就对不上，像是改文案时留下的旧键。
- **扫描出的 3 个假阳性（人工核实后排除）**：`S.mode.stackTitle`/`sideTitle`/`onlyTitle` 初查零命中，回读 `PopupView.tsx` 的 `modes()` 函数发现是通过模板字符串 `` S.mode[`${value}Title` as const] `` 动态拼出 key 名访问的（`PopupView.tsx:25`），静态 grep 天然看不到，**不是死键**。
- **`public/_locales/`（Chrome 自己认的两条，与上面 234 个完全独立的第二套 i18n）**：`en/messages.json`、`zh_CN/messages.json`（注意目录名是**下划线** `zh_CN`，是 Chrome i18n 的强制要求，与应用自己那套用**连字符**的 `zh-CN` 不是同一个命名习惯，纯属两套系统各自的约定，不是拼写错误）；各自恰好 2 个键：`description`（扩展管理页/商店简介）、`toggle`（快捷键说明），对应 `wxt.config.ts:38,44` 里的 `__MSG_description__`/`__MSG_toggle__` 占位符与 `default_locale: 'en'`。这两个键只有浏览器自己读取、选语言逻辑完全在 Chrome 一侧，`src/locales/**` 的 `pickLocale` 管不到它们（UI.md §6 的表格里也明确写了这点）。

<!-- section 6 done -->

## 7. 债务候选

| 位置 | 类型 | 证据 | 影响范围 |
|---|---|---|---|
| `config` 完整副本存在于 popup / options / content / background 四处，只有 content 与 background 订阅 `watchConfig`（`content/index.ts:90`、`background/index.ts:43`），popup（`popup/data.ts:62,95`）与 options（`options/data.ts:36,73`）都只是"挂载时读一次 + 自己写入后回显" | 重复状态 | 第 2.2 节表格第 1 行；`grep -rn watchConfig src` 只命中这两处 | 若 popup 与 options 同时开着，一方改的字段不会让另一方立即刷新；今天靠"popup 生命周期短"侥幸避开，重建时若改变 popup 的存活方式（例如做成侧边栏/可固定窗口）这个假设就会失效 |
| "要不要翻 / 要不要恢复"这条判定在 `popup/view-model.ts`（`primary`/`secondary` 推导）与 `background/context-menu.ts:53-61`（`actionFor`）各自独立实现，无共享代码 | 重复状态 + 并存路径 | 第 2.2、5 节；`context-menu.ts:48` 注释自陈"分界与 popup 的两个按钮一致"；`b88485f` 是已发生过的真实分歧（右键菜单曾经因状态值拼错而永远发恢复消息） | 三个入口（popup 主按钮、右键菜单、`Alt+T` 快捷键）里任何一处改动判定条件（例如新增一种"暂停"细分状态）都必须手动同步到另一处，历史上已经至少漏过一次 |
| Chrome 离线语言包状态 `pack` 在 popup（`data.ts:64,86-90`）与 options（`options/data.ts:38,54-58`）各自独立调用同一个 `shared/pack.ts:packState()`，互不通知 | 重复状态 | 第 2.2 节 | 两个界面同时开着时，一方点"下载"，另一方的可用性状态不会自动更新，只能重新挂载 |
| 识别助手状态（`HelperStatus`）与"是否在等待"两件事分别在 background（权威）、popup `data.ts:65`、options `data.ts:39`、`ui/HelperSetup.tsx:23`（每个组件实例一份 `until`/`timedOut`）四处存在 | 重复状态 | 第 2.2 节；`HelperSetup.tsx` 注释自述这是有意为之 | 有意设计但缺少文档明确"这是允许的短暂不一致"，重建时容易被误判成 bug 而"修掉"，反而破坏"popup 失焦销毁也能接上"的原始需求 |
| `entrypoints/options/PromptManager.tsx` 全文件用内联 `style={{...}}` 对象（28-31 行的 `field`/`small`/`row`/`button` 常量），是 `entrypoints/options/**` 目录里唯一不用 Tailwind 类名的文件 | 过渡代码 | 与同目录 `sections/*.tsx`、`ServiceDrawer.tsx` 逐行对比一目了然；`git log --follow` 显示该文件是 2026-09-08 前后从更早的实现原样搬来、后续设置页几次重建（`2026-09-10`）都没有回头改它 | 缺 hover/focus 态、深色模式仅靠 CSS 变量兜底、无法参与 Tailwind 的 dark 变体，视觉与交互一致性弱于页面其余部分 |
| 删除操作在全站有两套并存的确认交互：`ui/Confirm.tsx`（两次点击，4 秒自动取消，`ServiceDrawer`/`ProfileEditor`/`Data.tsx` 用）vs `PromptManager.tsx:65` 直接用浏览器原生 `window.confirm()` | 并存路径 | 逐文件核对得出；`grep -rn "window.confirm" src` 只有这一处 | 提示词删除的交互与其它三处删除（服务、译文样式、背景高亮、缓存）观感不一致，原生 `confirm()` 还会阻塞整个页面（含所有 React 状态更新） |
| `src/ui/strings.ts:114-119` 有两段孤立的 JSDoc 注释（"The settings page (docs/UI.md §3.2)…"、"§3.4: ProviderErrorKind…"），前后各带空行、不挂在任何声明上 | 过渡代码 | `git blame -L112,120 src/ui/strings.ts`：两条注释分别来自 `8d8f9ef7`（v12 配置重构）与 `88b9aa6c`，中间空行来自更晚的 `44bed49e`（i18n 提交）——三次提交先后把真正的 `O` 声明、`reasonText` 的原始文档挪走，注释被落下 | 无功能影响，纯阅读体感债务；重建时若照抄这个文件容易把死注释一起搬过去 |
| `O.services.apiKeyStored`（`zh-CN.ts:139`/`en.ts:133`） | 死代码 | 第 6.4 节；全仓库 `grep` 只有定义处命中 | 无功能影响；`ServiceDrawer.tsx:159` 实际用的是硬编码 `'••••••••'`，这个键疑似是文案改版后的遗留 |
| `tests/e2e/options-page.mjs` 导出的 `chooseService()` 助手函数从未被其它 e2e 脚本调用 | 死代码 | 第 3.7 节；`grep -rn "chooseService(" tests/e2e/*.mjs` 只有定义与它自己的调用（内部转调 `pick`） | 测试代码维护成本；未来改 `Services.tsx` 的自定义服务列表结构时容易忘记这个从未跑过的助手其实已经不对 |
| `CLAUDE.md` 的"常用命令"清单缺 `e2e:image`、`e2e:placeholders`、`lint:fix`、`zip`、`icons`、`check:output`、`helper:build`、`helper:smoke`（`package.json` 里都有） | 文档不符 | 第 6.2 节；直接比对 `CLAUDE.md:188-200` 与 `package.json` 的 `scripts` | 新人/agent 依 `CLAUDE.md` 摸索工具链时会漏用这些脚本；`e2e:image` 尤其容易被漏掉，因为它是唯一测图片翻译端到端结构性承诺的脚本 |
| `entrypoints/content/index.ts`（467 行）单文件同时承担：提取触发、7 种 `axt:*` 消息处理、模式控制器接线、图片翻译发起与模式闸、外观/界面语言/对照高亮三个 `watchConfig` 分支、side 模式整理调度（`ResizeObserver`）等多个关注点 | 并存路径 | 第 1.1 节行数统计；对比同目录 `debug.ts`（24 行，单一职责）反差明显 | 不是 bug，但是这份清单里体量与职责密度最高的文件；"系统性重建"若要拆分入口文件，这里是收益最大也是回归风险最高的一处 |

<!-- section 7 done -->

## 7.补充：核实 UI.md 与 gallery 实现的一致性（在第 7 节写完之后又查到，补记于此）

| 位置 | 类型 | 证据 | 影响范围 |
|---|---|---|---|
| `docs/UI.md:371`（§8 功能覆盖清单）写"后台连通 / 块统计"的落点是"只在开发构建样例页"，但 `src/entrypoints/gallery/main.tsx` 通读全文只渲染 `POPUP_FIXTURES`，**没有任何代码发送 `axt:ping`/`axt:stats` 或展示其结果**（`grep -n "axt:ping\|axt:stats\|BlockStats" src/entrypoints/gallery/main.tsx` 零命中） | 文档不符 | 这也顺带解释了 `axt:ping`/`axt:stats` 两个消息类型为什么在全仓库（不限本次审计范围）都找不到发送方——`grep -rn "'axt:ping'"`/`"'axt:stats'"` 除类型声明与各自的处理分支外别无它处 | 重建时若打算保留"开发态查看后台连通/块统计"这个既有承诺，需要在 gallery 里补上；若已决定放弃，`axt:ping`/`axt:stats` 这两个消息类型与 `background/index.ts` 里对应的 `case` 分支也可以一并清理 |

## 8. 没看懂或待核实的

1. **范围边界的三处自行扩展，需要确认是否与其他分支重复**：(a) `entrypoints/gallery/**` 不在团队分配的字面目录清单（`content*`/`popup/**`/`options/**`/`entrypoints/*.ts`）里，我因为它明显是纯 UI 的开发态入口而补充审计，已在第 1.4 节注明；(b) `tests/popup/view-model.test.ts` 覆盖的正是分配给我的 `view-model.ts`，但它物理上在 `tests/popup/`、不在指定的 `tests/ui`/`tests/entry`，我读了并纳入第 3 节的测试覆盖判断；(c) `tests/scaffold.test.ts` 里有 `axt:ping`/`axt:stats` 的痕迹（第 2.3 节表格提到），同样不在指定测试目录、我没有打开它，只在 grep 结果里见过文件名。三处都可能与其他负责 background/core 的同伴的审计范围重叠，建议合并时去重。
2. **`axt:ping` / `axt:stats` 的发送方在全仓库范围内确认为零**（见 7.补充），但无法从代码本身判断这是"设计了协议、UI 还没接（待实现）"还是"UI 曾经接过、后来删掉却忘了清协议（遗留）"——两种历史在静态代码里长得一样，需要问最初写这两个 case 分支的人，或者去翻更早的 git 历史（超出本次时间预算，只做到定位问题，没有继续深挖 `background/index.ts` 这两个 case 分支自己的引入提交）。
3. **`entrypoints/abstract.content.ts` 唯一依赖的 `core/abstract/link`**（`injectBilingualLink`/`relabelBilingualLink`）完全没有读——它在 `core/` 目录下，不属于本次分配范围。`abstract.content.ts` 自己 30 行、零测试引用、零其他 TS 文件 import，是这份清单里"没人管"程度最高的一个入口；它具体往摘要页 DOM 里插入什么、是否遵守 §7.1 的 DOM 不变量，需要另外确认。
4. **四份论文页 CSS（`modes.css`/`presets.css`/`highlight.css`/`image.css`）的实际拼接顺序**，第 4.1/4.4 节的描述来自 `docs/DESIGN.md` §7.5 的文字与 `core/renderer/index.ts` 的 `import ... from '@/styles/*.css?inline'` 语句（证明"谁在读"），但**没有读 `core/renderer/index.ts`/`style-preset.ts` 的函数体去逐行核对"拼接顺序与 DESIGN.md 描述完全一致"**——这两个文件在 `core/renderer/`，不在分配范围内，只做了到"确认引用关系存在"这一步。
5. **第 5 节的 20 条守卫是抽样，不是穷举**：读代码过程中能看到的"疑似特判"远不止 20 条（`popup/data.ts`/`options/data.ts` 里还有几处标"Codex 在 #157 指出"的小分支没有单独起 `git log -S`；`config/appearance.ts` 侧的颜色/CSS 白名单校验函数被多个 UI 文件调用但本身不在我的目录范围）。选取标准是"落在分配给我的目录里、且能在一次 `git log -S` 内定位到具体提交"，时间预算内没有做到逐条覆盖。
6. **第 3.7 节"约 66 个控件"是人工数的量级参考**，不同的计数口径（例如"图片翻译模式 3 个复选框"算一组还是三个独立控件）会有出入，不建议当成精确基线使用。
7. **没有实际跑一次 `pnpm build` 去验证 `wxt.config.ts` 的 `entrypoints:found` 钩子真的会在生产构建里剔除 `gallery`**——只读了配置源码；工作树是只读的，且构建会产生新文件到 `.output/`，权衡后没有执行验证性构建（也不确定这算不算"修改仓库文件"的边界，保守起见跳过了）。

<!-- section 8 done, inventory complete -->
