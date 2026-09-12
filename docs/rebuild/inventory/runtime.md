<!-- Raw inventory written by a read-only agent on 2026-09-12 against main @ e6de3e1 — one merge before the v0.3.0-mvp baseline (8cfd771). PR #168 later touched src/core/rules/latexml.ts, src/core/extractor/index.ts, src/core/renderer/{index,pending,failed}.ts and src/styles/modes.css, so line numbers in those files have shifted slightly. Kept verbatim (Chinese) as the evidence behind docs/rebuild/INVENTORY.md, which lists the claims that were spot-checked. Delete this file when the rebuild retires the code it describes. -->

# runtime inventory — started 2026-09-11T20:35:38Z

HEAD=e6de3e1493e0f2668e6e5a61ff9d9071f606c6b6 (= origin/main), worktree clean.

## 1. 模块地图

范围：`src/entrypoints/background/**`、`src/providers/**`、`src/cache/**`、`src/config/**`、`src/shared/**`、`helper/**`，共 48 个源文件（TS 45 + Swift 1 + sh 2），约 9 100 行；对应测试 40 个文件约 9 860 行。每个文件全文读过。「调用者」只列 `src/` 内的真实 import / 调用点（不含测试），`(自用)` 表示只在本文件内部使用。

### 1.1 background（`src/entrypoints/background/`）

| 文件 | 行数 | 职责 | 导出 | 调用者 | 移植来源 |
|---|---|---|---|---|---|
| `index.ts` | 285 | worker 入口：`defineBackground` 里建缓存端口、懒建全局链（`active` promise）、`watchConfig` 只在链字段变时重建、组装 helper / OCR / sessionRouter / 右键菜单 / 快捷键 / 安装等待，`runtime.onMessage` 上 11 个 `case` 分派 | 仅默认导出 | WXT 入口，无 import 方 | 原创 |
| `sessions.ts` | 235 | 会话（scope）↔ 标签页 ↔ transport 的绑定表；撤销（`drop`/`dropTab`）、导航宽限（`mayHaveLeft`→`arm`→`stillThere`/`stillLoading` 探针）、`dropped` 判死集合、链迁移（`rebind`/`rebindAll`/`dropAndRebindAll`） | `SessionRouter`, `createSessionRouter` | `index.ts:75`（唯一） | 原创 |
| `helper.ts` | 285 | Native Messaging 端口客户端：请求/响应按 id 关联、队列 + 在飞上限 1、握手 ping 插队、超时（30 s / 首次 OCR 120 s）、保活定时器、`missing` 记忆、按 scope 撤销 | `NativePort`, `HelperClientDeps`, `HelperClient`, `HelperError`, `createHelperClient` | `index.ts:69`（构造）；`ocr.ts:6`（`HelperError` 类型判断） | 原创 |
| `helper-await.ts` | 138 | 安装引导的轮询等待：2 s 一轮、3 min 窗口、截止时间存 session storage、`resume()` 接上 | `HelperWaitDeps`, `HelperWaiter`, `createHelperWaiter` | `index.ts:130` | 原创 |
| `ocr.ts` | 80 | OCR 服务：查缓存（`ocrCacheKey`）→ 未命中叫 helper → 写回；`cancelled` 集合；`cancel(scope,{remember})` | `OcrServiceDeps`, `OcrService`, `createOcrService` | `index.ts:74` | 原创 |
| `context-menu.ts` | 113 | 右键菜单 + 键盘命令：`actionFor(status)` 纯函数、`toggleTranslation`、`installContextMenu`（同步注册 onClicked）、`refreshContextMenu`（removeAll→create）、`installToggleCommand` | `MENU_ID`, `menuTitle`, `COMMAND_ID`, `MENU_PATTERNS`, `MENU_CONTEXTS`, `MenuDeps`, `CommandDeps`, `actionFor`, `toggleTranslation`, `installContextMenu`, `refreshContextMenu`, `installToggleCommand` | `index.ts:12,164,172,175`；`COMMAND_ID` 另被 `popup/data.ts` 读 | 原创 |

### 1.2 providers（`src/providers/`）

| 文件 | 行数 | 职责 | 导出 | 调用者 | 移植来源 |
|---|---|---|---|---|---|
| `index.ts` | 89 | `getProvider(config)`（按 `config.provider` 建首选 provider）、`FREE_ENGINES` 表、`buildChain(config)`（首选决定线上格式、免费引擎按格式 + `isAvailable()` 过滤）；再 `export *` 转发 `prompt-library` / `types` / `PROMPT_VERSION` | `getProvider`, `buildChain`, re-exports | `transport.ts:9,85`（buildChain）；`getProvider` 只被 `buildChain` 自用 | 原创 |
| `types.ts` | 168 | `TranslationProvider` 接口、`TranslateRequest/Result`、`ProviderErrorKind`（9 种）、`ProviderError`（构造时按 `META_BY_KIND` 挂重试元数据、按 `ISOLATABLE_BY_KIND` 定 `isolatable`） | 上述类型 + `ProviderError` | 全部 provider、`translate-service.ts`、`fallback.ts`、`background/helper.ts`（`ProviderErrorKind`）、`shared/ocr.ts`、`core/pipeline/run.ts`、`core/image/run.ts`、`ui/strings.ts`、`locales/zh-CN.ts` | 原创 |
| `transport.ts` | 195 | `TranslationTransport` 接口与 `createLocalTransport`（建链 → 每引擎一个 `createTranslateService` → `createFallbackService`；`providerId` 指名调用绕过链、不在链上的服务临时建 `offChain` provider；`status()` 组装 `ProviderStatus`，含 `revision` 计数）；`CHAIN_CONFIG_FIELDS` / `VOLATILE_CONFIG_FIELDS` / `chainConfigChanged` | `EngineStatus`, `ProviderStatus`, `TranslationTransport`, `LocalTransportDeps`, `createLocalTransport`, `CHAIN_CONFIG_FIELDS`, `VOLATILE_CONFIG_FIELDS`, `chainConfigChanged` | `background/index.ts:4,29,52`；类型被 `sessions.ts`、`shared/messages.ts`、`shared/transport.ts`、`shared/chain.ts`、`popup/data.ts`、`popup/view-model.ts`、`popup/fixtures.ts` 引用 | 原创 |
| `translate-service.ts` | 581 | 单引擎翻译服务：算键 → `readWithBudget` 读缓存 → 未命中入 `BatchQueue`→`RequestQueue` → 句子标记进出 → 校验对齐 → `admits` 后写缓存 → `partial` 回传；`FATAL_FOR_QUEUE` 按 scope 记致命；`cancel(scope,{remember})`；`toErrorInfo` | `TranslationOutcome`, `CacheEntry`, `CachePort`, `TranslateMessageRequest`, `TranslateCall`, `TranslateMessageResponse`, `TranslateServiceDeps`, `CancelOptions`, `TranslateService`, `DEFAULT_RATE_LIMIT`, `CACHE_READ_BUDGET_MS`, `DEFAULT_MAX_CONCURRENT`, `DEFAULT_MAX_TOTAL_MS`, `readWithBudget`, `createTranslateService`, `toErrorInfo` | `transport.ts:12,91,114`；`background/index.ts:5,210`（toErrorInfo）；`background/ocr.ts:4,53`（readWithBudget、CACHE_READ_BUDGET_MS、CachePort）；类型被 `shared/messages.ts`、`core/pipeline/run.ts`、`core/image/run.ts` 引用 | 原创（组装方式照 Read Frog `background/translation-queues.ts`） |
| `fallback.ts` | 146 | 降级链：按 `FALLBACK_KINDS` 降级、`PERMANENT_KINDS` 永久 / 其余 60 s 冷却、全降级退回最后一步、`gathered` 合并各步 `partial`、`status()` 报 `demoted` + `demotions` | `FallbackStep`, `DemotedInfo`, `FallbackStatus`, `FallbackService`, `FALLBACK_KINDS`, `DEFAULT_COOLDOWN_MS`, `createFallbackService` | `transport.ts:11,101` | 原创 |
| `openai-compat.ts` | 123 | LLM provider（AI SDK `generateText` + `Output.object`）：`isLoopback` 免 key、`LOOPBACK_RATE_LIMIT`、`endpointIdentity` 进 `cacheId`、`alignSegments` 严格 id 校验、`toProviderError` 状态码分类 | `LOOPBACK_RATE_LIMIT`, `createOpenAICompatProvider` | `index.ts:13`（getProvider）；`transport.ts:113`（offChain） | 原创 |
| `chrome-builtin.ts` | 186 | 内置 Translator provider：会话按语言对缓存 + 60 s 创建超时 + 自有 AbortController；`createSemaphore(20)` 跨调用并发闸；`normalizeSpacing`；`NotAllowedError/NotSupportedError → no-key` | `TranslatorApi`, `TranslatorSession`, `ChromeBuiltinDeps`, `BUILTIN_SOURCE_LANGUAGE`, `BUILTIN_MAX_ITEMS`, `SESSION_CREATE_TIMEOUT_MS`, `createSemaphore`, `normalizeSpacing`, `createChromeBuiltinProvider` | `index.ts:18,30`；`shared/pack.ts:4`（`BUILTIN_SOURCE_LANGUAGE`） | 原创（会话缓存思路照 KISS `builtinAI.js`） |
| `google-web.ts` | 107 | Google `translateHtml` 免费端点 provider：一次多条、`kindOfStatus`、非 JSON → `isolatable:false`、`rateLimit 20/8 + maxConcurrent 2` | `GoogleWebDeps`, `createGoogleWebProvider` | `index.ts:16,31` | **移植** `reference/read-frog/src/utils/host/translate/api/google.ts@9b44f82` |
| `microsoft.ts` | 223 | Edge 免费端点 provider：`SUPPORTED` 语言表 + `REWRITE` + `SCRIPT_UNAVAILABLE`、`supportsTarget`、`sentLen` 对齐、标签防御检查、`2000/100/8` | `supportsTarget`, `MicrosoftDeps`, `createMicrosoftProvider` | `index.ts:21`；`supportsTarget` 被 `options/sections/Services.tsx:37`、`popup/view-model.ts:119,269` | **移植** `reference/read-frog/.../api/microsoft.ts@9b44f82`（对照 FluentRead） |
| `http-errors.ts` | 18 | `kindOfStatus(status)`：429→rate-limit、401/403→auth、其余 4xx（除 408/409）→bad-request、否则 network | `kindOfStatus` | `google-web.ts:42`、`microsoft.ts:129` | 原创 |
| `model.ts` | 24 | `OpenAICompatConfig` 类型 + `createModel`（`@ai-sdk/openai-compatible`，`supportsStructuredOutputs: true`） | `OpenAICompatConfig`, `createModel` | `openai-compat.ts:5,69` | 原创 |
| `prompt.ts` | 63 | `PROMPT_VERSION='4'`、`PROTOCOL_BLOCK`、`formatGlossary`、`buildPrompts`（选模板、填变量、补漏写的 `{{input}}`/`{{targetLanguage}}`/`{{glossary}}`、追加协议块） | `PROMPT_VERSION`, `PROTOCOL_BLOCK`, `formatGlossary`, `BuiltPrompts`, `buildPrompts` | `openai-compat.ts:6,72`；`cache/key.ts:7,96`（PROMPT_VERSION）；`index.ts:87` 转发 | 原创 |
| `prompt-library.ts` | 130 | 模板变量、两个内置提示词、`PromptsConfig`、`selectPrompt`、`renderTemplate`、`promptKey`（内置用 id、自定义带全文） | `PROMPT_TOKENS`, `PromptToken`, `getTokenCellText`, `DEFAULT_PROMPT_ID`, `PRECISION_REWRITE_PROMPT_ID`, `DEFAULT_SYSTEM_PROMPT`, `DEFAULT_USER_PROMPT`, `PRECISION_REWRITE_*`, `PromptTemplate`, `BUILT_IN_PROMPTS`, `BUILT_IN_PROMPT_IDS`, `BUILT_IN_PROMPT_DESCRIPTIONS`, `PromptsConfig`, `DEFAULT_PROMPTS_CONFIG`, `resolvePromptReplacementValue`, `selectPrompt`, `renderTemplate`, `promptKey` | `prompt.ts`、`openai-compat.ts:7,61`、`config/schema.ts:4`、`config/storage.ts:4`、`options/PromptManager.tsx`、`popup/view-model.ts`、`locales/zh-CN.ts`（`BUILT_IN_PROMPT_DESCRIPTIONS`） | **移植** `reference/read-frog/src/utils/constants/prompt.ts` + `src/utils/prompts/translate.ts@9b44f82` |
| `prompt-file.ts` | 61 | 提示词文件导入 / 导出（zod 校验，`<a download>`） | `PROMPT_FILE_NAME`, `promptFileEntrySchema`, `promptFileSchema`, `PromptFileEntry`, `PromptFileError`, `PromptFileFormatError`, `parsePromptFile`, `readPromptFile`, `serializePrompts`, `downloadPromptFile` | `options/PromptManager.tsx`（`readPromptFile`、`downloadPromptFile`） | 功能对应 Read Frog `prompt-file.ts@9b44f82`，2026-09-05 重写 |
| `thinking.ts` | 33 | 思考模式开关：按端点域名选适配器（OpenRouter / DeepSeek / 百炼 / 硅基流动） | `ThinkingMode`, `THINKING_HOSTS`, `thinkingBodyFields` | `openai-compat.ts:9,70`；`model.ts`（类型） | 做法照 KISS `THINKING_API_REGISTRY`（未登记为移植文件） |
| `glossary.ts` | 152 | 术语表文本 ↔ 结构互转（`parseGlossary`/`formatGlossaryText`）、`createGlossaryMatcher`（NFC、`\s+`、按文字系统的词边界） | `GlossaryEntry`, `GlossaryIssue`, `ParsedGlossary`, `parseGlossary`, `formatGlossaryText`, `GlossaryMatcher`, `createGlossaryMatcher` | `translate-service.ts:16,400`；`options/sections/Prompts.tsx`（parse/format） | 形状照 KISS `parseAITerms`（未登记为移植文件；matcher 教训取自 Read Frog `glossary/matcher.ts`，实现自写） |
| `alignment.ts` | 236 | 句子对齐契约：`SentenceAlignment`、`boundariesOf`、`verifyAlignment`（长度分区校验 + `snapAlignment` 吸附）、`sentencePairs` | `SentenceAlignment`, `boundariesOf`, `verifyAlignment`, `SentencePair`, `sentencePairs` | `translate-service.ts`、`microsoft.ts`、`cache/index.ts`、`cache/store.ts`（类型）、`core/pipeline/run.ts`、`core/renderer/sentences.ts`（sentencePairs）、`core/protector/label.ts`、`core/sentences/index.ts` | 原创 |
| `sentence-markers.ts` | 160 | 不汇报句边界的引擎：在 cuts 处插 `<x id="N"/>` 标记（`markSentences`），回来摘掉并读出边界（`unmarkSentences`），摘不干净时 `stripMarkers` | `MarkedText`, `markSentences`, `unmarkSentences`, `stripMarkers` | `translate-service.ts:11,263,299,302` | 原创 |
| `wire-formats.ts` | 18 | 每引擎线上格式的纯数据表 `WIRE_FORMATS` + `wireFormatOfProvider` | `WIRE_FORMATS`, `wireFormatOfProvider` | 四个 provider 各读一行；`options/sections/ServiceDrawer.tsx:104` | 原创 |
| `request/request-queue.ts` | 640 | 令牌桶 + 并发上限 + 超时竞速 + 重试 / 429 暂停 / 401 排空 / 按 scope 取消 / 总时限 | `REQUEST_TIMEOUT_ERROR_NAME`, `SATURATED_DISPATCH_ETA_MS`, `ABORT_GRACE_MS`, `RequestTask`, `QueueOptions`, `RequestQueue` | `translate-service.ts:20,343` | **移植** `reference/read-frog/src/utils/request/request-queue.ts@9b44f82`（本项目新增 `maxConcurrent`/`maxTotalMs`/`deadlineAt`/`activeExecutions`/`reapExpired`/`releaseWhenSettled`） |
| `request/batch-queue.ts` | 481 | 按 batchKey 攒批、派发闸、去重、批级重试 + 逐条兜底、按 scope 取消 | `BatchCountMismatchError`, `DispatchGate`, `BatchExecutionMeta`, `BatchOptions`, `BatchQueue` | `translate-service.ts:18,344` | **移植** `reference/read-frog/src/utils/request/batch-queue.ts@9b44f82`（新增 `startedAt`、`maxTotalMs`、`executeIndividual(meta)`） |
| `request/retry-policy.ts` | 399 | 错误元数据附着 / 读取、Retry-After 解析、`defaultRequestRetryPolicy.decide` | `RequestErrorKind`, `RequestErrorMeta`, `RequestRetryContext`, `RetryDecision`, `RequestRetryPolicy`, `REQUEST_ERROR_META`, `MAX_RETRY_AFTER_MS`, `RATE_LIMIT_BASE_PAUSE_MS`, `MAX_CONSECUTIVE_RATE_LIMIT_PAUSES`, `MAX_RATE_LIMIT_RETRIES_PER_TASK`, `attachRequestErrorMeta`, `getRequestErrorMeta`, `getRetryAfterMs`, `getHeaderValue`, `isRateLimitRequestError`, `defaultRequestRetryPolicy` | `request-queue.ts`；`attachRequestErrorMeta` 被 `types.ts:166`、`openai-compat.ts`、`google-web.ts`、`microsoft.ts`、`translate-service.ts:240` | **移植** `reference/read-frog/src/utils/request/retry-policy.ts@9b44f82` |
| `request/cancellation.ts` | 72 | `TranslationCancelledError`（按 name 识别）、`CancelledScopeRegistry`（TTL 10 min / 256 条） | `TRANSLATION_CANCELLED_ERROR_NAME`, `TranslationCancelledError`, `isTranslationCancelledError`, `CancelledScopeRegistry` | `request-queue.ts`、`batch-queue.ts`、`translate-service.ts:19,226,545,575` | **移植** `reference/read-frog/src/utils/request/cancellation.ts@9b44f82` |
| `request/priority-queue.ts` | 108 | 二叉堆优先队列 | `BinaryHeapPQ` | `request-queue.ts:9,125` | **移植** `reference/read-frog/src/utils/request/priority-queue.ts@9b44f82` |
| `request/config.ts` | 25 | 队列参数的 zod 下限校验 | `MIN_*`×4, `requestQueueConfigSchema`, `batchQueueConfigSchema`, `RequestQueueConfig`, `BatchQueueConfig` | `request-queue.ts:7,118,182`、`batch-queue.ts:5,473` | 只保留 Read Frog `types/config/translate.ts` 的四个字段（未登记为移植文件） |

### 1.3 cache（`src/cache/`）

| 文件 | 行数 | 职责 | 导出 | 调用者 | 移植来源 |
|---|---|---|---|---|---|
| `index.ts` | 19 | 单例 `translationCache`、`cachePortOf`（Dexie → `CachePort`，`putMany` 逐条 await）、转发 `key` / `store` | `translationCache`, `cachePortOf`, re-exports | `background/index.ts:2,20,245,278` | 原创 |
| `key.ts` | 114 | `RenderPath` 类型、`wireFormatOf`、`CacheIdentity`、`CACHE_KEY_VERSION=6`、`normalizeText`、`buildCacheKey`、`cacheKeyFor`、`OCR_KEY_VERSION`、`ocrCacheKey` | 上述 | `translate-service.ts:7,9,401,420`、`background/ocr.ts:3,51,63`、`transport.ts`（类型）、`core/pipeline/{batches,run,sentences}.ts`、`core/image/run.ts`、`content/index.ts`（`wireFormatOf`/`RenderPath`）、`core/protector/serialize.ts`（引用 `normalizeText`/`CACHE_KEY_VERSION`——见 §5） | 借鉴 FluentRead 的 identity 序列化思路（原创） |
| `store.ts` | 309 | Dexie 库（v1 → v2 加 `byteSize` 索引）、`TranslationCache`（内存热层 256 条、增量总量账、超限批量淘汰、过期惰性删除、`cleanup`/`clear`/`stats`） | `CachedEntry`, `CacheRecord`, `CacheLimits`, `DEFAULT_CACHE_LIMITS`, `CACHE_DB_NAME`, `CacheDatabase`, `createCacheDb`, `TranslationCache` | `index.ts`；`translate-service.ts:8`（`CachedEntry` 类型） | **移植** `reference/FluentRead/src/services/translation/cache.ts@536a819`（淘汰逻辑改写） |

### 1.4 config（`src/config/`）

| 文件 | 行数 | 职责 | 导出 | 调用者 | 移植来源 |
|---|---|---|---|---|---|
| `schema.ts` | 119 | `CONFIG_VERSION=13`、`configSchema`（zod）、`DEFAULT_CONFIG`、`MODE_VALUES`、`GLOSSARY_LIMITS`、`normalizeGlossary` | 上述 + `Config` | `storage.ts`、`background/index.ts`、`content/index.ts`、`options/{data.ts,sections/*}`、`popup/{data,fixtures,view-model}.ts`、`providers/{index,transport,translate-service}.ts` | 原创 |
| `storage.ts` | 166 | `configItem`（WXT `storage.defineItem`，迁移 2→13）、`migrateStyle`、`getConfig`（safeParse 失败回默认并记 `fallbackReason`）、`setConfig`、`watchConfig`、`configFallbackReason` | `configItem`, `configFallbackReason`, `FallbackReason`, `getConfig`, `setConfig`, `watchConfig` | `background/index.ts:3,28,43`、`content/index.ts`、`options/data.ts`、`options/sections/ServiceDrawer.tsx`、`popup/data.ts`、`ui/apply-locale.ts`、`ui/strings.ts`、`abstract.content.ts` | 做法借鉴 Read Frog `config/storage.ts`（原创） |
| `services.ts` | 45 | 用户服务：`BUILT_IN_SERVICES`、`SERVICE_ID_RE`、`serviceSchema`、`newServiceId`、`serviceOf`、`chosenService`、`isLlmChosen`、`defaultServiceName`、`NAME_MAX` | 上述 | `schema.ts`、`storage.ts`、`providers/{index,transport,wire-formats}.ts`、`options/sections/*`、`popup/{data,view-model}.ts` | 原创 |
| `appearance.ts` | 110 | 外观配置：`styleProfileSchema`、`highlightProfileSchema`、`appearanceSchema`、内置样式 / 高亮、`PALETTE`、`activeStyle`/`activeHighlight`/`lookOf`、`newProfileId`、`resetBuiltIns`、`duplicate*` | 上述 | `schema.ts`、`storage.ts`、`core/renderer/{index,style-preset}.ts`、`content/index.ts`、`options/sections/Reading.tsx`、`popup/view-model.ts`、`ui/appearance/*`、`ui/strings.ts` | 原创（绿色取自 Read Frog） |
| `languages.ts` | 1044 | 179 个 ISO 639-3 码与四张名称 / 映射表；`toBcp47`（含 `BCP47_OVERRIDES`）、`fromBcp47`、`englishName`、`label`、`LANG_CODE_TO_EN_UI_NAME`、`isRtl`/`isRtlTag`/`RTL_LANGUAGES` | 上述 + `LangCode`, `langCodeSchema`, `DEFAULT_LANG_CODE`, `isLangCode` | `schema.ts`、`storage.ts`（fromBcp47）、`providers/{chrome-builtin,google-web,microsoft,prompt}.ts`、`shared/pack.ts`、`core/pipeline/run.ts`、`core/renderer/index.ts`（isRtlTag）、`options/sections/Services.tsx`、`popup/view-model.ts`、`ui/strings.ts` | **移植** `@read-frog/definitions@0.4.4` 的五张表（辅助函数原创） |

### 1.5 shared（`src/shared/`）

| 文件 | 行数 | 职责 | 导出 | 调用者 | 移植来源 |
|---|---|---|---|---|---|
| `messages.ts` | 132 | 消息表 `AxtMessages`（16 种 type）、`PageStatus`、`isAxtMessage`、`sendMessage`、`sendToActiveTab` | 上述 | `background/index.ts`、`background/context-menu.ts`（类型）、`content/index.ts`、`options/*`、`popup/*`、`ui/HelperSetup.tsx`、`shared/{transport,chain}.ts` | 原创 |
| `ocr.ts` | 83 | 图片翻译共享类型：`HELPER_HOST`、`HELPER_PROTOCOL=1`、`Quad`/`OcrLine`/`OcrResult`/`HelperStatus`/`OcrCall`/`OcrMessageResponse`/`ImageProgress` | 上述 | `background/{index,helper,helper-await,ocr}.ts`、`content/index.ts`、`core/image/*`、`core/svg/*`、`options/data.ts`、`popup/*`、`ui/HelperSetup.tsx` | 原创 |
| `transport.ts` | 33 | `createMessageTransport`：content / options 侧把 `translate`/`cancel`/`status` 变成三条消息，通信失败转成 `network, isolatable:false` | `createMessageTransport` | `content/index.ts:20,42` | 原创 |
| `chain.ts` | 24 | `awaitChain(settled)`：轮询 `axt:provider-status` 至多 10×100 ms | `awaitChain` | `popup/data.ts` | 原创 |
| `digest.ts` | 7 | `sha256Hex`（Web Crypto） | `sha256Hex` | `cache/key.ts`、`core/image/run.ts` | 原创 |
| `hash.ts` | 7 | `hashText`（DJB2 变体，按码点） | `hashText` | `core/renderer/split-figures.ts`（唯一） | 原创 |
| `pack.ts` | 35 | 内置引擎语言包：`packState`、`downloadPack`（须用户手势） | `PackState`, `packState`, `downloadPack` | `options/data.ts`、`popup/{data,view-model}.ts`、`popup/PopupView.tsx`、`gallery/main.tsx` | 原创 |
| `ping.ts` | 6 | `handlePing(version)` | `handlePing` | `background/index.ts:204` | 原创 |
| `uuid.ts` | 29 | `getRandomUUID`（有 `crypto.randomUUID` 用它，否则 `generateUUIDv4`） | `generateUUIDv4`, `getRandomUUID` | `translate-service.ts`、`request/{request-queue,batch-queue}.ts`、`core/scheduler/session.ts`、`options/PromptManager.tsx` | **移植** `reference/read-frog/src/utils/crypto-polyfill.ts@9b44f82` |

### 1.6 helper（`helper/`）

| 文件 | 行数 | 职责 | 对外契约 | 调用者 | 移植来源 |
|---|---|---|---|---|---|
| `Sources/axt-helper/main.swift` | 167 | Native Messaging stdio 循环：4 字节本机序长度前缀 + JSON；`ping` 回 `{ok, version}`；`ocr` 解 base64 → ImageIO（读 EXIF 方向、帧数）→ Vision `.accurate` → 归一化四角（翻 y）；回应超 250 KB 按置信度丢行；`--version` | 协议 v1（见 §2e） | Chrome 经 host manifest 启动；`background/helper.ts` 通过 `connectNative` 对话 | **移植** `reference/macos-vision-ocr/Sources/ocr.swift@91a236a`（MIT） |
| `install.sh` | 46 | 开发者安装：`swift build -c release`，写 Chrome / Chromium 默认目录的 host manifest（多 id） | manifest 路径与形状 | 人工；e2e 脚本另复制 manifest 进 profile | 原创 |
| `install-remote.sh` | 78 | 一键安装（popup 复制的命令）：下载仓库 tarball → `~/Library/Application Support/Readarxiv/helper` → 编译 → 写 manifest（`allowed_origins` 与已有 id 取并集） | 同上 + `REPO`/`REF`/`DIR` | 读者终端；`ui/HelperSetup.tsx` 生成命令 | 原创 |
| `Package.swift` | 12 | SwiftPM 清单，macOS 13+，无依赖 | — | 两个安装脚本 | — |
| `README.md` | 48 | 安装 / 冒烟 / 卸载说明 | — | — | — |
| `Tests/Fixtures/*` | — | 三张冒烟测试图（png / exif6 jpg / two-frames gif） | — | `scripts/helper-smoke.mjs` | — |

### 1.7 导出了但 `src/` 里没有调用者（只有定义，或只有测试在用）

| 符号 | 文件 | 说明 |
|---|---|---|
| `SessionRouter.rebindAll` | `background/sessions.ts:215` | `index.ts` 的 `axt:engine-ready` 走的是 `dropAndRebindAll`（#157 改的），`rebindAll` 只剩 `tests/background/sessions.test.ts` 在调 |
| `SessionRouter.bound()` | `background/sessions.ts:233` | 只有测试用 |
| `THINKING_HOSTS` | `providers/thinking.ts:22` | 注释写「设置页提示用」，设置页没有引用 |
| `BUILT_IN_PROMPT_IDS` | `providers/prompt-library.ts:86` | 无引用、无测试 |
| `isRtl` / `RTL_LANGUAGES` | `config/languages.ts:974,1010` | 只有测试；渲染层用的是 `isRtlTag` |
| `isRateLimitRequestError` | `providers/request/retry-policy.ts:164` | 移植来的，只有移植的测试在用 |
| `getRetryAfterMs`、`getHeaderValue`、`REQUEST_ERROR_META` | `retry-policy.ts` | 只在本文件内部用；导出面是移植时保留的 |
| `CancelledScopeRegistry.markPrefix` | `providers/request/cancellation.ts:47` | 移植来的「按标签页前缀标记」，本项目按 scope 单独撤，从未调用（只有移植的测试） |
| `RequestQueue.setQueueOptions` | `request-queue.ts:180` | 移植来的热更新入口，本项目建链时一次性传参，从未调用；只有移植的测试 |
| `BatchQueue.setBatchConfig` | `batch-queue.ts:470` | 同上 |
| `RequestQueue.cancelWhere` / `BatchQueue.cancelWhere` | 两文件 | 只被各自的 `cancelByScope` 内部调用；外部无谓词式取消 |
| `RequestQueueConfig` / `BatchQueueConfig` 类型、`MIN_*` 常量 | `request/config.ts` | 只在 schema 定义里用；类型无引用 |
| `generateUUIDv4` | `shared/uuid.ts:12` | 只被同文件 `getRandomUUID` 调用 |
| `SATURATED_DISPATCH_ETA_MS`、`ABORT_GRACE_MS`、`DEFAULT_MAX_CONCURRENT`、`DEFAULT_MAX_TOTAL_MS`、`DEFAULT_COOLDOWN_MS`、`FALLBACK_KINDS`、`CHAIN_CONFIG_FIELDS`、`VOLATILE_CONFIG_FIELDS`、`SESSION_CREATE_TIMEOUT_MS`、`BUILTIN_MAX_ITEMS`、`createSemaphore`、`normalizeSpacing`、`boundariesOf`、`formatGlossary`、`PROTOCOL_BLOCK`、`createCacheDb`、`CacheDatabase`、`DEFAULT_CACHE_LIMITS`、`CACHE_DB_NAME`、`configItem`、`GLOSSARY_LIMITS`、`MENU_*`/`menuTitle`/`actionFor`、`LOOPBACK_RATE_LIMIT`、`promptFileSchema`、`PROMPT_FILE_NAME`、`serializePrompts`、`parsePromptFile` | 各处 | 导出只为测试注入 / 断言，`src/` 内只有本文件自用。这是「为测试而导出」的既定做法，不算债务，但重建时可决定是否收窄导出面 |

### 1.8 移植文件里从未被本项目调用的函数（按文件）

| 移植文件 | 从未调用的成员 | 备注 |
|---|---|---|
| `request/request-queue.ts` | `setQueueOptions`（含其 `withoutUndefined` 辅助）、`cancelWhere`（外部）；`RequestTask.createdAt` 字段写了从不读 | `enqueuedAt` 与 `createdAt` 同值双写 |
| `request/batch-queue.ts` | `setBatchConfig`、`cancelWhere`（外部）、`PendingBatch.id`（`getRandomUUID()` 生成后无人读） | — |
| `request/retry-policy.ts` | `isRateLimitRequestError`、`getRetryAfterMs`（仅内部）、`getHeaderValue`（仅内部）、`RetryAwareError.requestErrorMeta` / `retryAfterMs` / `kind` 属性读取分支（本项目错误只走 `attachRequestErrorMeta` 的 Symbol 路径） | 上游为 AI SDK 各种错误对象形状写的兼容分支，本项目 provider 都显式 attach |
| `request/cancellation.ts` | `markPrefix`、`prefixes` 表及 `has()` 里的前缀扫描 | 本项目 scope 是 UUID 会话 id，无标签页前缀 |
| `request/priority-queue.ts` | `isEmpty`（仅 `pop` 内部）、`clear`（仅 `failCurrentBacklog`） | 全部有用 |
| `cache/store.ts` | `TranslationCache.set` 的 `string` 形态参数（`value: string`）——运行时只有 `cachePortOf` 调 `set`，传的都是对象 | 只有测试传字符串 |
| `config/languages.ts` | `LANG_CODE_TO_ZH_NAME` 的直接使用只剩 `label()` 默认参数与 `ui/strings.ts`；`isRtl`/`RTL_LANGUAGES` 无调用 | — |
| `shared/uuid.ts` | `generateUUIDv4` 只作兜底 | Chrome 138+ 扩展上下文一定有 `crypto.randomUUID`，兜底分支实际不会走 |
| `providers/google-web.ts` | 无 | — |
| `providers/microsoft.ts` | `from === 'auto'` 分支（`TranslateRequest.source` 是字面量 `'en'`，到不了） | 文件注释自己标明「目前到不了」 |
| `providers/prompt-library.ts` | `BUILT_IN_PROMPT_IDS` | — |
| `helper/main.swift` | 无（`--version` 由安装脚本用） | — |

<!-- section 1 done -->

## 2. 运行链路

### 2a. 一次翻译请求（content → background → provider → 缓存 → 回传）

| 步 | 位置 | 做什么 |
|---|---|---|
| 1 | `src/entrypoints/content/index.ts:42` | `createMessageTransport()`（`src/shared/transport.ts:12`）建 `backend`；每个方法一条 runtime 消息 |
| 2 | `src/core/pipeline/run.ts:162` `send()` | 组 `TranslateCall`：`{ request: { segments[{id,text,cuts?}], source:'en', target: config.targetLanguage（ISO 639-3）, context }, cache: { paper, renderPath, bypass? }, scope: session }`；标题走 `content/index.ts:268`、图片标签走 `core/image/run.ts:320`（`options.translate` 就是 `backend.translate`）；设置页连接测试走 `options/sections/ServiceDrawer.tsx:102`（带 `providerId`，不带 `cache`/`scope`） |
| 3 | `src/shared/transport.ts:15-22` | `send({ type:'axt:translate', ...call })` → `browser.runtime.sendMessage`（`shared/messages.ts:123`）；通信异常转成 `{ ok:false, error:{ kind:'network', isolatable:false } }` |
| 4 | `src/entrypoints/background/index.ts:200-212` | `runtime.onMessage` → `case 'axt:translate'` → `router.forCall(message.scope, sender.tab?.id)`（`sessions.ts:169`）：scope 已绑就用它那条 transport；没绑就 `current()` = `transportOf()`（`index.ts:35`）→ `active ?? activate()` → `load()`：`getConfig()`（`config/storage.ts:145`）+ `createLocalTransport(config, { cache })`（`providers/transport.ts:83`），并把 `{transport, tabId}` 记进 `sessions` |
| 5 | `src/providers/transport.ts:83-101` | 建链：`buildChain(config)`（`providers/index.ts:59`）→ 每个引擎一份 `createTranslateService`（`translate-service.ts:224`，共用同一个 `cache` 端口）→ `createFallbackService(steps)`（`fallback.ts:69`）。`transport.translate`（`transport.ts:122`）：`providerId` 有值 → 直接派给那一步（或 `offChain` 临时 provider）；否则 `service.translate(call)` 走降级链 |
| 6 | `src/providers/fallback.ts:105-132` | 按 `available()` 顺序逐步 `step.service.translate(call)`；成功即返回并清该步降级记录；失败且 kind ∈ `FALLBACK_KINDS` → `demote` → 下一步；各步 `partial` 攒进 `gathered` 随最终失败带回 |
| 7 | `src/providers/translate-service.ts:390-436` | `deps.getProvider()` → 术语匹配器 → 每段 `cacheKeyFor()`（`cache/key.ts:95`：`[CACHE_KEY_VERSION, cacheId??id, model, PROMPT_VERSION, promptKey, context, RULES_VERSION, target, renderPath, normalizeText, cuts]` 的 JSON → `sha256Hex`）→ `readWithBudget(store, keys, 2000ms)`（212）→ 命中的过 `verifyAlignment`；`cache.bypass` 时跳过读 |
| 8 | `translate-service.ts:442-481` | 未命中段 → `markedItem()`（§8.6 句子标记）→ `QueueItem` → `queuesFor(provider)`（310）取该 provider 的 `RequestQueue + BatchQueue`（首次建）→ `batchQueue.enqueue(item)`（`request/batch-queue.ts:146`）：按 `batchKey` 攒批（100 ms / 字数 / 条数 / 派发闸）→ `executeBatch`（`translate-service.ts:358`）：`fatalFor(meta)` 判死 → `requestQueue.enqueue(thunk, scheduleAt, hash, scopes, { timeoutMs: 20s+15ms/字≤120s, deadlineAt: startedAt+180s })`（`request/request-queue.ts:128`） |
| 9 | `request/request-queue.ts:317-390, 426-562` | 令牌桶 + `maxConcurrent` 派发 → `executeTask`：超时竞速、`retryPolicy.decide`（`retry-policy.ts:169`：401/403/404/access-denied 排空整队；429 暂停整队；其余按 kind 退避重试 ≤2 次）→ thunk = `translateItems`（`translate-service.ts:285`）→ `provider.translate({...batchRequestOf(items), segments, signal})` |
| 10 | 四个 provider | `openai-compat.ts:67`（AI SDK `generateText` + `Output.object`，`alignSegments` 校 id）/ `google-web.ts:91`（`translateHtml` POST）/ `microsoft.ts:199`（`translatetext` POST，带 `sentLen`）/ `chrome-builtin.ts:165`（`Translator` 会话 + 信号量）。错误统一成 `ProviderError(kind)`（`types.ts:149`，构造时挂重试元数据） |
| 11 | `translate-service.ts:293-304` | 回来的段按 id 归位；插过标记的 `unmarkSentences` 摘掉并得出对齐；摘不干净 `stripMarkers` |
| 12 | `translate-service.ts:483-508` | `Promise.allSettled` 后：成功段 `verifyAlignment` → `admits(source, text, wireFormat)`（`validate(expectationsFromText)`）通过才进 `writes` → 再查一次 `cancelledScopes` → `store.putMany(writes)` = `cachePortOf(translationCache).putMany`（`cache/index.ts:15`，逐条 await）→ `TranslationCache.set`（`cache/store.ts:243`）→ Dexie `entries` 表 |
| 13 | `translate-service.ts:509-536` | 有失败：`pickError`（no-key/auth 优先）→ `{ ok:false, error: toErrorInfo(e), partial? }`；全成功：`{ ok:true, result:{ segments, provider, model }, cached }` |
| 14 | `background/index.ts:208-211` | `.then(sendResponse)`；建链抛错也走 `toErrorInfo` 回话 |
| 15 | `src/core/pipeline/run.ts:235-260` | content 收到：`partial` 先渲染；`error.isolatable && left.length > 1` 才对半拆分重发；`no-key`/`auth` 记 `fatal` 停调度；占位符校验失败的单块以 `bypassCache: true` 重发（`run.ts:217`） |

### 2b. 降级链：怎么触发、谁决定

- **链的组成**（`src/providers/index.ts:59-85` `buildChain`）：首选 = `getProvider(config)`（`provider` 是服务 id → `createOpenAICompatProvider`；`'google-web'`；`'chrome-builtin'`；其余（含被删服务的 id）→ `createMicrosoftProvider`）。`config.fallback.enabled` 时依次考察 `FREE_ENGINES = [chrome-builtin, google-web]`：与首选同 id 的跳过；不支持首选 `wireFormats[0]` 的跳过（`index.ts:72`）；`isAvailable()` 为假的跳过（`index.ts:76`）。首选不可用也**留在链首**（popup 要据此提示）。`microsoft` 故意不在 `FREE_ENGINES`（#98）。`renderPath` = 首选格式，首选 `wireFormats: []` 时整条会话走 `runs`。
- **每次调用谁决定用哪个引擎**：`src/providers/fallback.ts:105-132`。`available()`（89）= 未降级的步骤，全降级则退回最后一步。某步返回 `ok:false` 且 `error.kind ∈ FALLBACK_KINDS`（除 `aborted` 外全部）→ `demote()`（95）：`no-key`/`auth` 永久（本 service 生命周期），其余冷却 60 s（`DEFAULT_COOLDOWN_MS`）；该步下次成功即清记录。队列层的重试（retry-policy）在此之前已经跑完，链上不再叠加重试。
- **会话级致命黏住**：`src/providers/translate-service.ts:168,334-342,475-477`：`no-key`/`auth` 按 scope 记进 `fatal.scopes`，同一会话后到的批次在 `executeBatch` 当场拒，不再打端点（#96 / #113）。
- **谁决定「整页重开」**：content 侧 `src/entrypoints/content/index.ts:230-249` `onProvider`：引擎与会话起始引擎不同时问 `backend.status(session)`（走 `axt:provider-status` 带 scope → `router.transportFor(scope).status()`），`demotions` 里起始引擎的 kind 是 `no-key`/`auth` 就 `start(undefined, true, session)` 重开一次（每会话一次，`restarted` 闸）。
- **链什么时候重建**：(1) `background/index.ts:43-55` `watchConfig`：仅 `chainConfigChanged`（`provider`/`services`/`prompts`/`targetLanguage`/`fallback` 之一变）才 `load(next)`，已绑定的会话不迁；(2) `axt:engine-ready`（`index.ts:225-241`）：无条件 `activate()` 重建，`rebindAll` → `router.dropAndRebindAll`（先撤旧链上的活再迁全部会话；`ServiceDrawer.remove` 用），`scope` → `router.rebind`（只迁那一个；popup 下载语言包用），都没有 → 只重建（options 下载语言包、ServiceDrawer 保存后连接测试用）。
- **状态上报**：`src/providers/transport.ts:130-165` `status()`：`available = primary.isAvailable()`；不可用时扫 `chain.slice(1)` 找第一个可用的当 `fallback`；`engine` 取 `service.status().activeId`，与 `configuredId` 不同时附 `demoted`；`demotions` 全量；`revision` 为本链构建序号。

### 2c. MV3 service worker 生命周期相关处理（全部）

| # | 位置 | 处理 |
|---|---|---|
| 1 | `background/index.ts:26-35` | 引擎链懒建（`active` promise），worker 每次唤醒重建；不持久化 |
| 2 | `background/index.ts:43` | `watchConfig` 每次 worker 启动重新订阅（WXT `storage.watch`）；只在链字段变时 `load(next)` |
| 3 | `background/index.ts:200` | `runtime.onMessage` 同步注册；所有分支 `return true` + `sendResponse`（WXT ≥0.20 无 polyfill） |
| 4 | `background/index.ts:164` + `context-menu.ts:86-101` | `installContextMenu`：`onClicked` **同步注册**（worker 被点击唤醒时事件在脚本求值后立即派发，#161）；`removeAll()` 再 `create`（每次唤醒都跑，避免 id 撞） |
| 5 | `background/index.ts:168-173` | `resolveLocale()` 异步读语言，`uiLanguage !== null` 闸防止旧快照盖过 watcher（#161） |
| 6 | `background/index.ts:175-179` | `commands.onCommand` 同步注册 |
| 7 | `background/index.ts:181,192-198` | `tabs.onRemoved` → `dropTab`；`tabs.onUpdated`（loading / complete）→ `router.mayHaveLeft`；两者都不需要 `tabs` 权限 |
| 8 | `background/helper.ts:94-101` | helper 有请求在飞时 `setInterval(deps.keepAlive, 20 s)`（`index.ts:72`：`runtime.getPlatformInfo()`）保活；闲下来清掉。端口开着**不能**阻止 worker 回收 |
| 9 | `background/helper.ts:88,173` | `missing`（host 未注册）按 worker 生命周期记忆；`warmed`（首次 OCR 120 s 预算）也是 per-worker |
| 10 | `background/index.ts:129-155` + `helper-await.ts` | 安装等待的截止时间存 `browser.storage.session`（键 `axt-helper-await-until`）；worker 启动即 `helperWaiter.resume()`；`axt:helper-await` 查询要 `await helperRestored`（#166）。轮询用 `setTimeout` 2 s，靠 `connectNative` 本身是 API 调用来续命（`helper-await.ts:10-13`） |
| 11 | `background/sessions.ts:79-88` | `sessions` / `dropped` / `leaving` 全在内存；worker 重启即丢。`drop()` 对「没绑过的 scope 也照撤」（126-128） |
| 12 | `providers/transport.ts:81` | `revision` 计数器是模块级变量，worker 重启归零 |
| 13 | `cache/store.ts:77-85,119` | 总量账 `totals` 每个 worker 生命周期首次 `set` 时 `countAll()` 一次（只读 `byteSize` 索引键） |
| 14 | `config/storage.ts:109` | `fallbackReason` 模块级、每个执行上下文各一份 |
| 15 | `providers/translate-service.ts:226` + `request/cancellation.ts:32` | `CancelledScopeRegistry`（TTL 10 min / 256 条）per service 实例 |
| 16 | `entrypoints/abstract.content.ts:14,25` | 摘要页直接 `storage.local.get('config')` + `storage.local.onChanged`，不经 `getConfig` |
| — | — | **没有**使用 `chrome.alarms`、`runtime.onStartup`、`runtime.onInstalled`、`runtime.onSuspend`、长连 `runtime.connect` Port；没有针对 worker 挂起的请求恢复（DESIGN §8.0 引 RESEARCH §6.7/6.8 实测认为不需要） |

### 2d. 配置 schema 版本与迁移链（`src/config/storage.ts:10-64`，`CONFIG_VERSION = 13`）

存储位置：`chrome.storage.local` 键 `config`（WXT `local:config`，版本元数据由 WXT 另存，见 §6 待核实）。读：`getConfig` → `configSchema.safeParse` 失败回 `DEFAULT_CONFIG` 并记 `fallbackReason`（`tooNew` / `invalid{where,message}` / `unknown`）。写：`setConfig` → `configSchema.parse`。订阅：`watchConfig` 只在 `safeParse` 成功时回调。

| 版本 | 引入 | 迁移做什么 |
|---|---|---|
| v1 | 57526aa 2026-09-03 | `{ version, provider, openaiCompat:{baseURL,apiKey,model}, targetLanguage:'zh-CN', mode }` |
| 2 | 87032dd | 加 `prompts: DEFAULT_PROMPTS_CONFIG` |
| 3 | — | 加 `preload: DEFAULT_PRELOAD` |
| 4 | 0cce771/10e0519 | `targetLanguage` BCP-47 → ISO 639-3（`fromBcp47`，大小写不敏感，繁体子标签归 `cmn-Hant`） |
| 5 | 60be3f4 | 加 `fallback: { enabled: true }` |
| 6 | 43e95d2 | 加 `glossary: []` |
| 7 | 6cebf11 | 加 `style: { preset:'none', customCss:'' }`；**`glossary` 过 `normalizeGlossary`**（#52：旧超限术语会让整份配置回退默认） |
| 8 | — | 加 `image: { modes: [...MODE_VALUES] }` |
| 9 | — | `style` 加 `color:''`、`opacity:1`、`accent:''` |
| 10 | e12b56e 2026-09-09 | **字段不变、只升号**：`provider` 枚举加 `microsoft` 后，旧构建读到新值会静默重置；升号让旧版明确报 `tooNew`（#115） |
| 11 | 0a03b0b | `image.enabled = modes.length > 0` |
| 12 | 8d8f9ef 2026-09-10 | `openaiCompat` → `services[]`（只有「曾选 LLM」或「改过默认端点/key/模型」才生成一条服务，`defaultServiceName` 截 40 字）；`provider` 变服务 id；`style` → `appearance`（`migrateStyle`：下划线预设变自有样式、custom 保留 css、blur/green/muted 映射内置、accent 变自有高亮） |
| 13 | 44bed49 2026-09-11 | 加 `uiLanguage: 'auto'` |

另有**不升版本**的演进：`reading`（db38c5d）、`uiLanguage`、`services`、`prompts`、`glossary`、`appearance`、`fallback`、`preload`、`image` 都带 zod `.default()`，缺字段直接通过校验——迁移函数与 `.default()` 两套机制并存。

### 2e. 识别助手：Native Messaging 协议、版本协商、安装脚本契约

- **host 名**：`io.github.srjoeee.arxivtranslate`（`shared/ocr.ts:6`；`helper/install.sh:24`；`helper/install-remote.sh:13`；`tests/e2e/image.mjs:19`）。
- **帧**：4 字节本机字节序长度前缀 + UTF-8 JSON（`main.swift:45-89`；冒烟脚本按 LE 读）。helper 用 `readExactly` 读满前缀与正文（短读不当 EOF）。
- **请求**（扩展 → helper，`helper.ts:189,220,243`）：`{ v: 1, cmd: 'ping' | 'ocr', id: '<cmd>-<seq>', image?: <base64>, langs?: string[] }`。`langs` 在 `HelperClient.ocr` 签名里有，但 `ocr.ts:60` 从不传，helper 端默认 `["en-US"]`。
- **响应**（helper → 扩展，`main.swift:142-167`）：ping → `{ v:1, id, ok:true, version:'<VERSION>+vision<revision>' }`；ocr → `{ v:1, id, width, height, frames, lines:[{ text, quad:[[x,y]×4]（左上原点、归一化）, conf }], truncated?:true }`；错误 → `{ v:1, id, error:{ code:'bad-base64'|'undecodable-image'|'bad-request'|'unsupported-protocol'|'vision', message } }`。
- **版本协商**：helper 侧请求 `v !== 1` → `unsupported-protocol`；扩展侧握手回应必须 `v === HELPER_PROTOCOL(1)` **且** `version` 非空（`helper.ts:159`），否则 `dropPort()` + `failAll('invalid-response')`；每条新连接先插一个内部 `ping` 再放 OCR（`helper.ts:187-190`）；`version` 进 `ocrCacheKey`（`cache/key.ts:112`，`OCR_KEY_VERSION = 1`）。
- **大小与时限**：helper 回应 > 250 KB 按置信度丢行并标 `truncated`（Chrome 上限 1 MB）；单请求 30 s、本 worker 首次 OCR 120 s、握手 30 s；在飞上限 1。
- **错误映射**（`helper.ts:111-116`）：`bad-request`/`bad-base64`/`undecodable-image` → `ProviderErrorKind 'bad-request'`，其余 → `'invalid-response'`；断开 → `'network'`；host 未注册（`lastError` 匹配 `/not found|forbidden|not registered|无法找到|找不到/i`）→ 本 worker 内记 `missing`。
- **安装脚本契约**：
  - manifest 路径：`~/Library/Application Support/Google/Chrome/NativeMessagingHosts/<host>.json` 与 `.../Chromium/NativeMessagingHosts/<host>.json`（两脚本都写两份；Chrome 实际找的是 `<用户数据目录>/NativeMessagingHosts/`，Playwright profile 由 e2e 自己复制并改写 `allowed_origins`）。
  - manifest 形状：`{ name, description, path, type: 'stdio', allowed_origins: ['chrome-extension://<id>/', …] }`。
  - 扩展 id：`^[a-p]{32}$`；未打包扩展 id 由加载路径推出（不钉 `key`）。
  - `install.sh`：`cd helper && swift build -c release`；`path` = `<repo>/helper/.build/release/axt-helper`；`allowed_origins` = 参数列表（**覆盖**）；description「arXiv HTML Translator 的本机 OCR 助手（Vision）」。
  - `install-remote.sh`：`REPO=SRjoeee/ReadarXiv`、`REF=${2:-${AXT_HELPER_REF:-main}}`、下载 `https://codeload.github.com/$REPO/tar.gz/refs/heads/$REF`、取 tarball 唯一顶层目录（不写死仓库名，3cf1852）、复制 `helper/{Sources,Package.swift,LICENSE-macos-vision-ocr.txt,Tests}` 到 `~/Library/Application Support/Readarxiv/helper`、`path` = 该目录 `.build/release/axt-helper`；`allowed_origins` 与已有 id **取并集**（bd9e930）；description「Readarxiv 的图片识别助手（Apple Vision）」；要求 macOS + `xcode-select -p`。
  - popup 复制的命令由 `src/ui/HelperSetup.tsx` 生成（`curl -fsSL https://raw.githubusercontent.com/SRjoeee/ReadarXiv/<ref>/helper/install-remote.sh | bash -s -- <extension-id> [<ref>]`）；`--version` 由两脚本用于回显。
- **manifest 权限**（`wxt.config.ts:41`）：`nativeMessaging` 是必需权限（DESIGN §15.4 决定，分发时再改可选）。

<!-- section 2 done -->

## 3. 守卫与特判台账

每条：位置 | 做什么 | 引入提交（`git log -S` 取最早）/ issue | 原本解决什么问题 | 守着它的测试（文件:用例；「无」= 没有单测）。commit 后面的 # 号取自提交信息正文。

### 3.1 background

| # | 位置 | 做什么 | 引入提交 / issue | 解决的问题 | 测试 |
|---|---|---|---|---|---|
| B1 | `index.ts:43-55` | `watchConfig` 只在 `chainConfigChanged` 时重建链，其余字段只换 `config` 引用 | 6ab0a4b 2026-09-06（#42 #43） | content 每切模式写一次配置，无差别重建会清掉令牌桶与降级记录 | `tests/providers/transport.test.ts`: 「切换显示模式、样式、预加载、术语表不重建」「引擎、端点…改了就重建」「同值的新对象不算改动」「每个配置字段都被显式归类」 |
| B2 | `index.ts:45-49` | `uiLanguage` 变了才 `applyLocaleFrom` + `refreshContextMenu` | 9d76596 2026-09-11（#161 第 1 轮） | worker 不因语言变化重启，菜单标题停在旧语言 | 无（background/index.ts 无单测） |
| B3 | `index.ts:87-93` `stillLoading` | `tabs.get(tabId).status === 'loading'`，不需 `tabs` 权限 | 614295b 2026-09-10 | 跨文档导航提交慢时旧文档仍答「还在」；只在不再加载时采信 | `tests/background/sessions.test.ts`: 「标签页还在加载时不采信『还在』」「一直卡在加载中也不会无限问下去」 |
| B4 | `index.ts:94-102` `stillThere` | 向页面发 `axt:page-status` 比对 `session`，三态 same/other/unknown | ef18b2e 2026-09-09；ff3c7c6（三态） | 「宽限内没请求」≠「页面走了」：跳到已翻译的章节不会再有请求，旧逻辑会排空活页面 | `sessions.test.ts`: 「页面自己说还在：宽限到点也不撤」「页面答不上来：排空，但不判死」「页面答上来了但换了会话：确定走了，判死」 |
| B5 | `index.ts:192-198` | `tabs.onUpdated` 在 loading **与** complete 都 `mayHaveLeft` | 8e52420 2026-09-09（#142 #59）；823e4ea（加 complete） | `onRemoved` 不管导航；`changeInfo` 分不出同文档换 hash（用户 2026-09-09 报参考文献全失败）；提交慢时 loading 那次探针被旧文档骗过 | `sessions.test.ts`: 「同文档换 hash 不算跳走」「旧文档在提交前答了『还在』：complete 时再问一次」 |
| B6 | `index.ts:155,264` `helperRestored` | `axt:helper-await` 查询等 `resume()` 读完 storage 再答 | 63c34ce 2026-09-12（#166 第 1 轮） | 唤醒 worker 的正是 popup 的查询，不等就答还没恢复的 null | `tests/background/helper-await.test.ts`: 「worker 被回收之后接上没到期的那次等待」（waiter 层） |
| B7 | `index.ts:231-241` `axt:engine-ready` 三种迁移 | `rebindAll` → `dropAndRebindAll`；`scope` → `rebind`；否则只重建 | 87e62e1（#157 第 3 轮）rebind；3040af8（#157 第 4 轮）dropAndRebindAll；原型 6ab0a4b（#50） | 语言包下载完的引擎没在链里；删掉的服务要处处停用；被动变更不迁 | `sessions.test.ts`: 「rebindAll 把进行中的会话迁到新链」「dropAndRebindAll 先撤掉旧链上的活再迁」 |
| B8 | `index.ts:243-248, 274-282` | cache-clear / cache-stats 失败如实回 `{ ok:false, message }`；stats 前先 `cleanup()` | 036bd29 + 6cebf11 2026-09-05（#52）；原型 #7 | IndexedDB 不可用时不能显示「已清干净 / 缓存是空的」；过期条目从不删除会一直计数 | `tests/cache/store.test.ts`: 「过期条目会被 cleanup 清掉」「cleanup 失败时拒绝而不是吞掉」（store 层；消息层无） |
| B9 | `index.ts:269` `router.bind` 先于 `ocr.ocr` | OCR 的第一条消息就把 scope 绑到 tab，不建链 | 5cc5544 2026-09-07（#87 第 2 轮） | 不绑的话关标签页 `dropTab` 撤不到排队的识别；建链可能挂在 `Translator.availability()` | `sessions.test.ts`: 「bind：只记 tab 关联、同步返回、不建链」 |
| B10 | `index.ts:253` | `helper-status` 带 `recheck` 且可用 → 广播 `axt:helper-ready` | 99c0d9a 2026-09-11（#161 第 7 轮） | 会话开始时探测扑空的论文把位图停在 parked，没人再告诉它 | 无（content 侧 `resumeRaster` 无单测） |
| B11 | `index.ts:168-173` | `resolveLocale()` 回来时 `uiLanguage !== null` 就不写 | 92e5a2e 2026-09-11（#161 第 8 轮） | 启动读是快照，watcher 才是真相；晚到的续体不许覆盖 | 无 |
| B12 | `index.ts:206-211` | `axt:translate` 的 `.catch` 把建链异常转 `toErrorInfo` 回话 | 6ab0a4b 2026-09-06 | 不回话调用方等到 "message channel closed" | 无（消息层） |
| B13 | `index.ts:220` | `provider-status` 带 scope 用 `router.transportFor(scope)` | 3040af8 2026-09-10（#157 第 4 轮） | 页面问的是自己那条链，别的标签页改了设置后全局链描述的是别人的 | `sessions.test.ts`: 「transportFor 只读地取出会话自己那条链」 |
| B14 | `sessions.ts:75` `NAVIGATION_GRACE_MS = 3000` | 「可能跳走」按住 3 s 再决定 | 8e52420 2026-09-09（#142） | 视口观察器同帧就会为新露出的内容排请求，3 s 留余量；真跳走多跑 3 s 可忽略 | `sessions.test.ts`: 「真的跳走：宽限到点撤掉，但不把 scope 判死」 |
| B15 | `sessions.ts:109` `LOADING_RETRIES = 3` | 还在加载就再问，最多 3 轮（~12 s） | 614295b 2026-09-10 | 一直卡在加载的标签页会变成永不停止的轮询 | `sessions.test.ts`: 「一直卡在加载中也不会无限问下去」 |
| B16 | `sessions.ts:86,176-181,190-193` `dropped` 集合 | 撤过的 scope 不复活；建链期间被撤则补撤 | 174895e 2026-09-07（#87 第 4 轮） | bind 后 forCall 正在 `await current()` 时关标签页，forCall 回来又 set 回去、请求照发 | `sessions.test.ts`: 「bind → forCall 建链期间被撤：forCall 回来不复活会话…」 |
| B17 | `sessions.ts:111-122` `remember` | 猜出来的终结 `remember:false`：只排空、不解绑、不判死 | 8e52420（#142）+ ff3c7c6（用「判死/不判死」二分） | 猜错时页面还活着，判死等于把后半篇钉在 aborted；解绑会让它挂到新链、中途换引擎（#143） | `sessions.test.ts`: 「猜错之后回来的会话仍走它开始时的那条链」「猜出来的终结在 OCR 那条队列上同样不判死」 |
| B18 | `sessions.ts:127` | 只 bind 过、没 transport 的会话，撤它不建链 | 8fd658b 2026-09-07（#87 第 3 轮） | 建链可能挂在 `Translator.availability()`，撤 OCR 不能等它 | `sessions.test.ts`: 「drop：onDrop 先于建链；只经 bind 绑过的会话不为撤它建链」 |
| B19 | `sessions.ts:170-173` | forCall 时**不**取消按住的撤销 | ff3c7c6 2026-09-09 | 真跳走时旧文档常再发一两条，取消后就没人再武装 | `sessions.test.ts`: 「旧文档在跳走途中又发了一条请求：撤销照常进行」 |
| B20 | `sessions.ts:184-187, 199-202` | 同一标签页出现新 scope → 撤旧的 | d29f88f 2026-09-06 | 上一轮没走 endRun（导航 / 刷新）时旧队列继续发付费请求 | `sessions.test.ts`: 「同一标签页出现新 scope：上一轮没走 endRun…」 |
| B21 | `sessions.ts:222-231` `dropAndRebindAll` | 迁前先 `cancel(scope, {remember:false})` | 3040af8（#157 第 4 轮） | 只重指向的话旧链上排队/在飞的活还在花被删服务的 key、往活页面写 | 见 B7 |
| B22 | `helper.ts:71` `MAX_IN_FLIGHT = 1` | 同时只写一条进端口 | b88d531 2026-09-07 | helper 是顺序 stdio 循环；在飞多条时撤销撤不到已写进端口的活 | `tests/background/helper.test.ts`: 「cancel(scope)：排队中的不写进端口…」 |
| B23 | `helper.ts:68-70` 30 s / 120 s / 20 s | 请求超时、首次 OCR 超时、保活间隔 | b88d531；174895e（120 s，#87 第 4 轮） | 机器上首次跑 Vision 要一次性准备（实测 26.6 s），30 s 会误判挂了 | `helper.test.ts`: 「本 worker 里第一次 OCR 用更长的超时…」「保活只在有请求在飞时跑」 |
| B24 | `helper.ts:74-76` `isMissingHost` 正则 | 断开原因匹配 not found / forbidden / 中文 → 本 worker 不再连 | b88d531 | host 没注册时 `connectNative` 不抛，端口立刻断；避免反复重连 | `helper.test.ts`: 「host 没装（断开原因是 not found）…之后不再尝试连接」 |
| B25 | `helper.ts:147,170` `port !== opened` | 丢掉的端口上晚到的回应一律忽略 | b88d531（首版就有） | 陈旧连接的 ping 回应会把 `known` 写成旧版本，新连接跳过握手 | `helper.test.ts`: 「丢掉的端口上晚到的回应一律忽略…」 |
| B26 | `helper.ts:153-164` 握手校验 | ping 回应要 `v === 1` 且 `version` 非空，否则 dropPort + failAll | 368e31d（每连接握手）+ 5f883c9（要求版本，#87 第 5 轮）+ 174895e（协议号） | 换了版本的 helper 结果记在旧键下；不兼容 helper 会无限重 ping；不同构建共用键空间 | `helper.test.ts`: 「重连后的第一条不是 OCR 而是握手…」「握手回错误信封…不会无限重 ping」「协议版本对不上…」「握手没报版本号：不算可用」 |
| B27 | `helper.ts:201-211` postMessage 抛错 → failAll + break | 抛错时排队全拒，不只拒当前 | 8fd658b（#87 第 3 轮） | 只拒一条的话 while 会立刻再插 ping 再抛，同步死循环卡住 worker | `helper.test.ts`: 「connectNative 抛错（权限没给）…不会同步死循环」 |
| B28 | `helper.ts:194-200` 超时 → dropPort | 超时的请求 helper 还在处理，断开让它退出 | 5cc5544（#87 第 2 轮） | 后面的请求全排在挂住的那个后面 | `helper.test.ts`: 「超时后断开端口…」「握手超时：排队的 OCR 一起拒绝」 |
| B29 | `helper.ts:280` cancel 在飞 → dropPort | 撤掉在飞的那个就丢端口 | 8fd658b（#87 第 3 轮） | 顶上去的请求会排在被撤的后面白等 | `helper.test.ts`: 「撤掉的是在飞的请求：端口丢掉…」 |
| B30 | `helper.ts:227` `recheck` 清 `missing` | 允许再探一次 | 36bf611 2026-09-11 | 读者装好 helper 后设置页要能「再看一次」，否则 worker 一辈子答不可用 | `helper.test.ts`: 「装好之后 status({ recheck: true }) 会重新连一次」 |
| B31 | `helper-await.ts:20,25` 2 s / 180 s | 探测间隔与最长等待 | 43c75d0 2026-09-12（#102） | 安装脚本要跑几十秒；3 min 后多半没在装了 | `helper-await.test.ts`: 「一窗走完停掉轮次…」 |
| B32 | `helper-await.ts:91-97` 到点保留过期截止时间 | 不清 `deadline` | 63c34ce（#166 第 1 轮） | 界面要分辨「等过没等到」与「压根没开始」，否则「尚未检测到」永远不出现 | `helper-await.test.ts`: 「一窗走完停掉轮次，但留着过期的截止时间给界面读」「过期的记录认下来但不再探」 |
| B33 | `helper-await.ts:129` resume 读完再判一次 | `await load()` 后二次检查 `deadline !== null` | 5c49e3e（#166 第 2 轮） | 读 storage 期间读者点了复制，旧值会盖掉新的一窗 | `helper-await.test.ts`: 「读 storage 期间开始了新的一次：旧值不许盖回去」 |
| B34 | `helper-await.ts:100-102` 先 `arm()` 再探；`probing` 闸 | 轮次节奏与探测快慢解耦 | 43c75d0 | 挂住的探测会让等待静默停住 | `helper-await.test.ts`: 「探测挂住也不会把等待卡死」「一轮探测还没回来时不开第二轮」 |
| B35 | `ocr.ts:41,48,55` `cancelled` 集合 + 两次检查 | 撤过的 scope 直接 aborted；查状态/读缓存后再查一次 | b88d531（集合）；368e31d（第二次检查，#87） | 撤销落在读缓存的空窗里，`helper.cancel` 撤了个空（真机实测） | `tests/background/ocr.test.ts`: 「撤过的 scope 之后的调用直接回 aborted…读缓存期间被撤也不叫」「读缓存期间被撤：命中也回 aborted」 |
| B36 | `ocr.ts:53` `readWithBudget` | OCR 读缓存也有 2 s 预算 | 368e31d（#87） | IndexedDB 挂住时 helper 超时永远开始不了、消息通道一直开着 | `ocr.test.ts`: 「读缓存有预算：IndexedDB 挂住不返回时超预算当未命中」 |
| B37 | `ocr.ts:63-64` 按回应所在连接的版本落键；`putMany` 不 await | — | 368e31d（#87） | 读缓存期间重连换了版本；写缓存挂住不能拖住识别结果 | `ocr.test.ts`: 「回应所在连接的版本与查缓存时的不同…按新版本落缓存」「写缓存不阻塞回应」 |
| B38 | `ocr.ts:72-78` `cancel(scope,{remember})` | 猜出来的终结不判死 | dbe0ca4 2026-09-09 | 软撤到了翻译队列却在 `onDrop` 这里被永久记死，hash 跳转后整个会话的图都 aborted | `ocr.test.ts`: 「猜出来的终结（remember: false）只排空，不把 scope 判死」 |
| B39 | `context-menu.ts:25` `MENU_CONTEXTS` 七种 | 点在链接/图/选区上都有菜单 | d0fd4e5 2026-09-10（#147） | 只注册 `page` 时论文页最易点到的地方反而没有菜单 | 无（`MENU_CONTEXTS` 只被测试引用作断言，见 `tests/entry/*`） |
| B40 | `context-menu.ts:53-61` `actionFor` 按 `PageStatus` 定型；`stopped && fatal` → 重翻 | 类型化状态 + 暂停会话走重翻 | 9a4408b（#146）；8133d5d（#157 第 2 轮） | 第一版写 `state === 'off'`（不存在的值）永远发恢复，假状态把它盖住；快捷键恢复了一个 popup 要重翻的暂停会话 | `tests/entry/context-menu.test.ts`（不在本次范围，存在） |
| B41 | `context-menu.ts:86-92` `onClicked` 同步注册 | 注册不等语言包 | 9d76596（#161 第 1 轮） | worker 被点击唤醒时事件在脚本求值后立即派发，放进 `.then` 里就丢了 | 无 |

### 3.2 providers：transport / translate-service / fallback

| # | 位置 | 做什么 | 引入提交 / issue | 解决的问题 | 测试 |
|---|---|---|---|---|---|
| P1 | `transport.ts:122-128` `providerId` 指名调用不走链 | 直接派给那一步 / `offChain` | dda69fe 2026-09-06（#42）；64d2cc5（offChain，#157） | 连接测试被免费兜底显示成成功；编辑的服务通常不在链上 | `tests/providers/transport.test.ts`: 「指名引擎的调用不走降级链」「指名一个自己配的、不在链上的服务」「指名一个不在链上的引擎：如实说」 |
| P2 | `transport.ts:133-141` status 扫 `chain.slice(1)` 找兜底 | `fallback` 字段 | 6ab0a4b（原型 #50） | popup 按钮灰着但链上有 Google 能翻 | `transport.test.ts`: 「首选不可用但链上有兜底时报出来」「整条链都不可用时不报降级」 |
| P3 | `transport.ts:81,84,154` `revision` | 每次建链 +1，随 status 回 | dec92d1 2026-09-10（#157 第 5 轮） | 换 key/模型/端点/提示词不改服务 id 与目标语言，只比这两个漏掉全部 | 无单测（popup `view-model.ts:159` 比较） |
| P4 | `transport.ts:94` `getModel` 只给选中的服务 | 免费引擎键里不带模型名 | 8d8f9ef 2026-09-10（v12） | 换模型时免费引擎缓存白白失效 | 无 |
| P5 | `transport.ts:179-195` `CHAIN_CONFIG_FIELDS` / `VOLATILE` / `deepEqual` | 逐字段比较，不 `JSON.stringify` | 6ab0a4b | 配置里有 API key，不多留副本（硬规则 7） | `transport.test.ts`: 「每个配置字段都被显式归类」 |
| P6 | `transport.ts:156-163` `demotions` 全量 | 不只报最近一次 | 87e62e1（#157 第 3 轮） | LLM 永久降级后中间免费引擎瞬时失败，`demoted` 就变成瞬时那条 | `tests/providers/fallback.test.ts`（status 部分）；content 侧无 |
| P7 | `translate-service.ts:168,324,334-342` `FATAL_FOR_QUEUE` + `fatal.scopes` | no-key/auth 按 scope 黏住 | b816dab 2026-09-08（#96）；23c08c0（按 `meta.scopes` 判） | `failQueue` 只排空那一刻在 RequestQueue 的任务，攒批中的块随后照发（实测 +744 ms 又发 7 个）；去重会把新会话并进旧任务 | `tests/providers/translate-service.test.ts`: 「auth 之后这个引擎本轮不再打端点」「去重把两个会话并进同一个任务时…」「新会话并进一个已致命会话的批次时，这一批照常发」「只有 no-key / auth 黏」 |
| P8 | `translate-service.ts:475-481` `noteFatal` 在每条 reject 时记 | 不等 `allSettled` | 23c08c0 | 满批秒失败时尾巴还在等 batchDelay，等 allSettled 就晚了 | `translate-service.test.ts`: 「同一次调用里『满批 + 欠满的尾巴』…」 |
| P9 | `translate-service.ts:238-241` `asBatchError` 只转 `isolatable` 的 | 系统性失败不转成 `BatchCountMismatchError` | 9177755 2026-09-06（#61） | 100 段一批的非 JSON 响应会白打 104 次 | `translate-service.test.ts`: 「声明 isolatable: false 的 invalid-response 立刻上报」「可拆分的 invalid-response 照旧重试并逐条兜底」 |
| P10 | `translate-service.ts:257-269` `markedItem` 四道闸 | 引擎自报/非 tags/无 cuts 不插；`cuts=[]` 给整段对齐；插完超 `maxBatchChars` 不插 | e0dc759（#137，切点由调用方给）；3afffaa（#137 第 4 轮：单句块、超限） | 服务层拿线上文本分不清注解与公式；单句块本该有对齐；贴上限的批插完超限 | `translate-service.test.ts`: 「调用方没给切点就不插」「引擎自己汇报的就不插」「单句块不插标记，但照样给出整段对整段的对齐」「插完会超出引擎单次上限就不插」「只有 tags 这条路插」 |
| P11 | `translate-service.ts:276-283` `batchRequestOf` 术语并集 | 一批发并集，键只带自己那几条 | 7f2992f 2026-09-11 | 整表进每批请求翻倍、改一条术语全站缓存作废 | `translate-service.test.ts`: 「一批发出去的是这一批的并集」「用不到术语的段落，键与『没配术语表』时相同」 |
| P12 | `translate-service.ts:192-199` `uniqueIds` | 同 id 的段在一批里加 `~i` 后缀 | 63bce30 2026-09-05 | 同一段落重发、连接测试连发三次会混进一批 | 无直接用例（隐含在攒批用例里） |
| P13 | `translate-service.ts:208-209` `admits` 按 `wireFormatOf(renderPath)` 校验 | 只把占位符校验通过的写缓存 | c768c9e 2026-09-08（#104 #98）；原型 #30 / #42 | 坏译文入库每次都先读到再重来；拿 tags 分词器扫 markers 文本期望为空、恒真 | `translate-service.test.ts`: 「占位符校验不过的译文照常返回，但不写缓存」「markers 路径的校验按 renderPath 分派」「反推的期望对纯文本同样生效」 |
| P14 | `translate-service.ts:116,212-222` `CACHE_READ_BUDGET_MS = 2000` + 条数校验 | 超预算或条数不符按全部未命中 | 8790a7d 2026-09-05（#41 #45） | 缓存读挂住整页翻译停在那里（#45 实验 2） | `translate-service.test.ts`: 「缓存读失败不影响翻译」；`ocr.test.ts` 同类 |
| P15 | `translate-service.ts:125-139` 8 并发 / 180 s / 20 s+15 ms/字≤120 s / 100 ms / 3 次 | 队列与攒批参数 | a1e8fe3（#43）；63bce30（超时公式，Read Frog 常量） | 令牌桶不限并发，50 多个批次同时打向端点招 429；持续 429 把总时长拖到分钟级 | `tests/providers/request/concurrency-cap.test.ts`: 「翻译服务的默认值：并发 8、总时限 180 秒」；`translate-service.test.ts`: 「provider 挂住不返回：按字数算的超时…」 |
| P16 | `translate-service.ts:438` 读缓存后查 `cancelledScopes` | 让出主线程期间可能被撤 | 63bce30 | Read Frog translation-queues.ts 同样在 await 后查一次 | `translate-service.test.ts`: 「cancel(scope)：…同 scope 的后续调用直接 aborted」 |
| P17 | `translate-service.ts:508` 写缓存前再查取消 | — | 21fc79b 2026-09-06（#33） | 先完成的批次在 cancel 之前 fulfill，allSettled 醒来照样写库 | `translate-service.test.ts`: 「cancel(scope)：…不写缓存」 |
| P18 | `translate-service.ts:520-527` 失败带 `partial` | 成功段随失败回去 | bf8a998 2026-09-11（#163 第 3 轮） | 一次调用横跨两批，一批失败另一批成果被埋，读者看到全失败、重试秒回 | `translate-service.test.ts`: 「一次调用横跨两批、一批失败：成功的那批照样写缓存」；`tests/pipeline/*`（partial 渲染，不在本次范围） |
| P19 | `translate-service.ts:558-564` `pickError` 优先级 | no-key/auth > 真失败 > aborted | 63bce30 | run.ts 据配置错误停下；取消不该盖过真实错误 | 无直接用例 |
| P20 | `translate-service.ts:577` timeout → `isolatable:false` | 超时不对半拆 | 7f2992f | 内容层再拆与队列重试相乘：8 段 15 次调用 | `translate-service.test.ts`: 「toErrorInfo 把它带过边界」；`tests/pipeline` 有回归 |
| P21 | `translate-service.ts:451-452` `batchContext` 只给有 promptKey 的引擎 | 免费引擎批次键不带 sectionTitle | 670cc43 2026-09-06 | 每换一节换一次键，免费引擎攒批等于没开（216 块发 61 个请求） | `translate-service.test.ts`: 「不看上下文的引擎，章节标题不进批次键」「有提示词的引擎照旧按上下文分批」 |
| P22 | `translate-service.ts:405-406` `proseOf` 逐 token 解实体 | 术语匹配用去占位符、解实体后的正文 | 7f2992f；实体解码 861bc29/bf8a998（#163） | `R&D` 对着 `R&amp;D` 永远匹配不上；先拼后解会凭空造实体 | `translate-service.test.ts`: 「匹配的是去掉占位符之后的正文」「匹配前先解实体」「解实体不会凭空造出实体」 |
| P23 | `translate-service.ts:462` `dedupKey` 仅 `cache && !bypass` | 重发不去重 | 63bce30；bypass 来自 b1fc79d（#9） | 重发不能与在飞的坏请求合并 | `translate-service.test.ts`: 「cache.bypass：只写不读」 |
| P24 | `translate-service.ts:323,367,378` `deadlineOf(meta)` | 整批一个期限，逐条兜底同一份 | 606eccc / e153cd4 2026-09-05（#56） | 批级重试各拿一份 180 s，4 次 = 12 分钟 | `concurrency-cap.test.ts`: 「deadlineAt 覆盖…」「逐条兜底与批级重试用同一个批次期限」 |
| P25 | `translate-service.ts:433,496` 命中与新译文都 `verifyAlignment` | 服务层统一校验 | e9e2cc3 2026-09-09（#128） | 键碰撞或源文变动时缓存里的对齐不再成立；provider 各自校验会漏 | `translate-service.test.ts`: 「a cache hit brings its alignment back」「drops a cached alignment that no longer reconstructs」 |
| P26 | `translate-service.ts:352` `dispatchGate` | BatchQueue 问 RequestQueue 的 ETA | 63bce30 | 限流期间每 100 ms 刷出一小批排队冻着 | `tests/providers/request/batch-queue.test.ts` 「dispatch gate」四例 |
| P27 | `fallback.ts:50-55` `FALLBACK_KINDS` 不含 aborted；`PERMANENT_KINDS` no-key/auth | 降级判据 | 60be3f4 2026-09-05 | 取消不是引擎的错；配置问题不会自己好 | `fallback.test.ts`: 「aborted 不降级也不换引擎」「auth 是配置问题：切到下一个引擎，本会话内不再试首选」 |
| P28 | `fallback.ts:61` 60 s 冷却 | — | 60be3f4 | 不冷却每次调用白等一遍重试+超时（最长 120 s）；太长又长时间用差引擎 | `fallback.test.ts`: 「瞬时错误冷却到期后回到首选」「默认冷却 60 秒」 |
| P29 | `fallback.ts:92` 全降级退回最后一步 | — | 60be3f4 | 宁可再失败一次如实上报，也不能无引擎可用 | `fallback.test.ts`: 「全部降级后退回最后一个引擎」 |
| P30 | `fallback.ts:112-115,124` `gathered` | 各步 `partial` 并集 | 9a1feab 2026-09-11（#163 第 4 轮） | 缓存键带 provider，上一步译好的段在下一步不命中 | `fallback.test.ts`「降级链上的部分成功」四例 |
| P31 | `fallback.ts:38-41` 无 `reset()` | 恢复靠 background 重建整条链 | 60be3f4（#42 / #50 讨论） | 建链时 `isAvailable()` 为假的引擎撤记录也救不回来 | `fallback.test.ts`: 「永久降级不会自己恢复…这一层不提供 reset」 |

<!-- section 3 part 1 done -->

### 3.3 providers：各引擎、prompt、glossary、alignment、markers

| # | 位置 | 做什么 | 引入提交 / issue | 解决的问题 | 测试 |
|---|---|---|---|---|---|
| E1 | `openai-compat.ts:21-28,49` `isLoopback` 免 key | localhost/127.0.0.1/[::1] 不要求 key | b1fc79d 2026-09-05（#6） | Ollama / LM Studio 无 key；其余端点没 key 别发请求 | `tests/providers/openai-compat.test.ts`: 「没有 key：不可用，且不调用模型」（loopback 分支无用例） |
| E2 | `openai-compat.ts:18,60` `LOOPBACK_RATE_LIMIT 2/4` | 本机端点压速率 | 63bce30 | Ollama 默认 `OLLAMA_NUM_PARALLEL=4`，多出来的在服务端排队撞超时 | `openai-compat.test.ts`: 「本机端点压低速率」 |
| E3 | `openai-compat.ts:36-43,63` `endpointIdentity` 含路径 | `cacheId = openai-compat:<origin><path>` | 8790a7d（#45，只 origin）→ 35408ce（#54，加路径） | 同名模型在不同端点共用缓存条目互相污染；同域不同路径是不同网关路由 | `openai-compat.test.ts`: 「能力声明」断言 cacheId（形状） |
| E4 | `openai-compat.ts:80` `maxRetries: 0` | SDK 不重试 | cc9e481 2026-09-03 | 重试交给移植的 retry-policy，避免双层重试 | 无直接用例 |
| E5 | `openai-compat.ts:105-123` `toProviderError` | 429→rate-limit、401/403→auth、无状态→network、其余→unknown；`NoObjectGenerated|…|JSONParse` → invalid-response 带 300 字原始输出；`TypeError` → network 可重试 | cc9e481 | AI SDK 错误对象形状多样，统一分类并保留元数据 | `openai-compat.test.ts`: 「AI SDK 的 APICallError 映射为 ProviderError」「已中止的 signal 直接 aborted」「返回缺 id 或多 id 都是 invalid-response」 |
| E6 | `openai-compat.ts:78,83` `temperature: 0.2`、`providerOptions` 仅非空时传 | — | cc9e481；43e66e0（思考开关） | 未登记端点不发未知字段被拒 | `openai-compat.test.ts`: 「把端点对应的思考关闭字段放进 providerOptions」；`tests/providers/thinking.test.ts` 四例 |
| E7 | `chrome-builtin.ts:37,100,122-138` 60 s 创建超时 + 自有 AbortController | 会话创建不接任何批的 signal | d36eff9 + 06c19ef 2026-09-05（#50） | 首批超时会把共用会话连根拒掉、其余批全 aborted；超时不中止底层加载会越积越多 | `tests/providers/chrome-builtin.test.ts`: 「signal 只传给逐条翻译，不传给会话创建」「会话创建超时会真的中止底层加载」「会话创建挂死时按独立超时失败」 |
| E8 | `chrome-builtin.ts:44-69,102,174` `createSemaphore(20)` 额度直接转交 | provider 级并发闸 | d36eff9；06c19ef（转交） | 队列同时派发多批各 20 条压垮本地模型；先减后唤醒有微任务空档冲破上限 | `chrome-builtin.test.ts`: 「信号量把额度直接转交给等待者」「并发闸是 provider 级的」「按自己声明的上限分批」 |
| E9 | `chrome-builtin.ts:89-90` NotAllowedError/NotSupportedError → `no-key` | 让链永久降级它 | c880241 2026-09-05 | 链上自动降级拿不到用户手势，重试无用 | `chrome-builtin.test.ts`: 「错误分类：NotAllowedError / NotSupportedError → no-key…」 |
| E10 | `chrome-builtin.ts:160` 只认 `'available'` | downloadable/downloading 不算可用 | c880241 | 那两种要用户手势才能 create() | `chrome-builtin.test.ts`: 「只有 available 才算可用」 |
| E11 | `chrome-builtin.ts:80-82` `normalizeSpacing` | 去掉中日韩标点后的空格 | c880241（RESEARCH §6.2） | 模型逐句翻译后用空格拼接成「。 我们」 | `chrome-builtin.test.ts`: 「归一化中日韩标点后的多余空格」 |
| E12 | `google-web.ts:85-86` `rate 20/8 + maxConcurrent 2` | 并发闸为主、速率只兜突发 | 670cc43 2026-09-06 | 移植时把 p-queue 的 concurrency 2 误写成 rate 2，216 块 29.6 s；rate 4 又成瓶颈 | `translate-service.test.ts`: 「provider 声明的 maxConcurrent 生效」；`tests/e2e/*` |
| E13 | `google-web.ts:52,57` 非 JSON / 结构异常 → `isolatable:false` | 系统性失败不拆 | 9177755（#61） | 见 P9 | `tests/providers/google-web.test.ts`: 「条数对不上或结构异常归类为 invalid-response」 |
| E14 | `http-errors.ts:12-18` `kindOfStatus` | 4xx（除 408/409）→ bad-request 不重试 | 2f5c09f 2026-09-06（#17） | 全归 network 会被 retry-policy 先看 kind 判可重试，400 重试满 3 次再逐条重来 | `google-web.test.ts`「HTTP 状态到错误类型」四例；`tests/providers/microsoft.test.ts`: 「超限的 400 返回纯文本…归 bad-request」 |
| E15 | `microsoft.ts:36-42,55-62,71` `SUPPORTED` / `REWRITE` / `SCRIPT_UNAVAILABLE` | 目标语言支持判定与标签重写 | 4919af9 2026-09-09（#98 #103 #104 #107）；cec5116（sr-Cyrl）；be7ebc7（nya/lug、bos/uzn/azj）；19fbd31（只认表、不推断） | 179 个目标里 71 个端点 400；裸 `sr` 归拉丁文与我们的「Serbian (Cyrillic)」相反；`toBcp47` 缩成两字母反而不在表里；`zlm → ms-Arab` 曾被主语言推断成支持（实测 400） | `microsoft.test.ts`「supportsTarget」六例 |
| E16 | `microsoft.ts:126-132` `response.ok` 先于 `json()` | 超限 400 是纯文本 | 4919af9（RESEARCH §5.1） | 直接 JSON.parse 抛成 invalid-response 掩盖真正的 400 | `microsoft.test.ts`: 「超限的 400 返回纯文本」 |
| E17 | `microsoft.ts:204-206` translate 内本地判 `supportsTarget` | 不去问端点 | 19fbd31（#115） | `buildChain` 把不可用首选留在链首，`fallback.ts` 看的是降级记录，第一批照样发出去换 400、并发下好几发 | `microsoft.test.ts`: 「不支持的目标语言在本地就失败」「isAvailable() 就是这道闸」 |
| E18 | `microsoft.ts:210-212` 标签防御检查 | `/<[a-z/]/i` 命中就 bad-request | 4919af9 | 端点没有 markup 模式，标签毁了无法还原（上游硬失败） | `microsoft.test.ts`: 「标签格式的占位符被挡下」 |
| E19 | `microsoft.ts:188-193` `2000/100/8 + rate 20/8` | 小批量高并发 | 4919af9（2026-09-08 实测：8125 字 1516 ms、并发 8 → 23k 字/s、30 连发无 429） | 抄 google-web 的值会犯同一个错 | 无（数值本身无用例） |
| E20 | `microsoft.ts:156-160,217` `sentLen` → alignment + `verifyAlignment` | 引擎自报句边界 | 53a3853 2026-09-09（#105 #119） | 60 块实测 96.2% 边界落在标点后——但只在折叠空白后（#119） | `microsoft.test.ts`「sentence alignment from sentLen」四例 |
| E21 | `types.ts:106-117` `META_BY_KIND` | 构造时挂重试元数据 | 63bce30 | 移植的 retry-policy 认不出 no-key/aborted 会当未知错误重试（实测 no-key 被调 4 次白等 7 s） | `tests/providers/provider-error.test.ts` 五例 |
| E22 | `types.ts:133-147` `ISOLATABLE_BY_KIND`（timeout=false） | 拆小是否可能成功 | 7f2992f 2026-09-11 | 4 段 bad-request 变 7 次调用；8 段 timeout 扇出 15 次、两层相乘最多 45 次 | `translate-service.test.ts`「失败归属」三例 |
| E23 | `types.ts:112` bad-request 不可重试 | — | 2f5c09f（#17） | 见 E14 | `provider-error.test.ts` |
| E24 | `prompt.ts:15` `PROMPT_VERSION = '4'` | 4：漏写 `{{glossary}}` 自动追加 | 93d0544 2026-09-05（历史：2 提示词库、3 英文语言名） | 实际发给模型的内容变了，不升版本旧缓存照常命中 | `tests/providers/prompt.test.ts`: 「带版本号：目标语言改填英文名后升到 3」（**用例名已过时，断言的是当前值**） |
| E25 | `prompt.ts:53-61` 补 `{{input}}` / `{{targetLanguage}}` / `{{glossary}}` | 自定义模板漏写也发 | 87032dd；61a4ec5（#39 第 3 轮）；6cebf11（#52） | 漏 input 原文发不出去；漏 targetLanguage 模型不知译成什么；「新建」模板默认不含 glossary 变量 | `prompt.test.ts`: 「自定义提示词漏写 {{input}}…」「…{{targetLanguage}}…」「…{{glossary}}…」 |
| E26 | `prompt-library.ts:21-28` 元数据放用户消息、定界并声明不可信 | 不进 system | a227bdd 2026-09-05（#28 第 4 轮） | 标题/摘要是作者写的，prompt injection 论文可能带指令样文字 | `prompt.test.ts`: 「论文上下文填进用户消息的元数据块（带定界符、声明不可信）」 |
| E27 | `prompt-library.ts:109,128` `Object.hasOwn` | id 是 `constructor` 时不摸原型 | bc168fa 2026-09-05（#28） | 原型链污染 | `tests/providers/prompt-library.test.ts`: 「id 撞上原型属性（constructor）时不摸原型」 |
| E28 | `prompt-library.ts:126-130` `promptKey` 自定义带全文、两段分别编码 | 不先压 32 位 hash | a227bdd（#28） | DJB2 撞了外层 SHA-256 也分不开；拼空格会让 "A"+"B C" 与 "A B"+"C" 同键 | `prompt-library.test.ts`: 「指纹对两段分别编码」「指纹按码点算」 |
| E29 | `glossary.ts:24,36` 分隔符不含分号 | 一行一条 | 43e95d2（首版有分号）→ 036bd29/6cebf11 去掉（#52） | 译文里带分号是正常写法，会被拆成两条 | `tests/providers/glossary.test.ts`: 「分号不是记录分隔符」 |
| E30 | `glossary.ts:105-113` `SCRIPTS_WITHOUT_SPACES` 八种文字 + 按术语两端判边界 | 连写文字不要求词边界 | 7f2992f；861bc29（#163 加 khm/lao/mya/bod） | `net` 不进 `network`，但汉字间无空格；少了后四种那几种语言术语永远匹配不上 | `tests/providers/glossary-matcher.test.ts` 十例 |
| E31 | `alignment.ts:147-202` `snapAlignment` | 边界吸附到句末标点 | 7ae65fd 2026-09-09（用户 2026-09-09 报 `…流程。这|种`）| 引擎报的边界偏一两个字符，读者看到首字被染进上一句 | `tests/providers/alignment.test.ts`: 「nudges a boundary that missed its sentence end」等 21 例 |
| E32 | `alignment.ts:72,79,89-113` `CONTINUATION` / `TERMINATOR` / `snappable` 与 `settled` 分开 / `TERMINAL_ABBR` | 什么算句末 | 26e2a8d、36c0748（#145） | `Vol. 2`、`3.5`、`U.S. D|epartment`、直引号既能开也能收、`?)` 被拆 | `alignment.test.ts`: 「does not snap onto the period of an abbreviation or a decimal」「does not eat a straight quote…」「lets an abbreviation that really ends a sentence be snapped to」等 |
| E33 | `alignment.ts:163-166,176,185-191` `walk` 幂等；两边等距不动；全用或全不用 | — | 49ca5b0、076e4a1（#145） | `verifyAlignment` 会跑多次（provider、服务层、缓存命中），不幂等会因路径不同给出不同高亮；逐个回退依赖迭代顺序切出 `[1,2,4]` | `alignment.test.ts`: 「lands at the end of a punctuation run, and stays there on a second pass」「leaves the side alone when a boundary is equally close…」「leaves the whole side alone when two boundaries want the same spot」 |
| E34 | `alignment.ts:125` `SNAP_WINDOW = 3` | 最多挪 3 字符 | 7ae65fd | 实测位移都是一两个字符；窄到只可能跨过标点不跨过词 | `alignment.test.ts`: 「does not reach across a clause」 |
| E35 | `alignment.ts:211-214` 条数相等、正整数、总长相符 | 分区校验 | 53a3853（#105） | 60 块实测微软条数全部相等，挡的是坏数据 | `alignment.test.ts`: 「rejects…」五例 |
| E36 | `sentence-markers.ts:34` 标记就是 `<x id="N"/>` | 复用 void 占位符 | bf8feb1 2026-09-09（#126 #136） | 实测 `<x/>` 3/3 到位，`<s/>` 被追加 `</s>`，`<wbr>` 全丢 | `tests/providers/sentence-markers.test.ts` 七例 |
| E37 | `sentence-markers.ts:61-69` `occurrences` 用 `TAG_RE` | 认引擎改写过的拼法 | e0dc759（#137） | `<x id="1" />` / `<x id='1'/>` 会漏进 validate 当成多出的占位符，整块失败 | `sentence-markers.test.ts`: 「recognises a marker however the engine respelled it」 |
| E38 | `sentence-markers.ts:150-160` `stripMarkers` | 摘不干净也要清掉 | bf8feb1 | 残留标记会让 validate 失败，用没高亮换来没译文 | `translate-service.test.ts`: 「标记乱序：不给对齐，且把残留的标记摘干净」 |

### 3.4 cache / config / shared

| # | 位置 | 做什么 | 引入提交 / issue | 解决的问题 | 测试 |
|---|---|---|---|---|---|
| C1 | `cache/key.ts:70` `CACHE_KEY_VERSION = 6` | 3 markers 路径（#104）、4 改名 tags（#108）、5 空白折叠后旧坏译文（#122）、6 句子标记改变请求（#137） | e0dc759（升到 6） | 每次都是「旧条目内容或请求变了」而不是键算法变了 | `tests/cache/key.test.ts`: 「空白折叠为什么必须升 CACHE_KEY_VERSION（#122）」 |
| C2 | `cache/key.ts:54,89` `cuts` 进键 | — | 3afffaa（#137 第 4 轮） | 两个块序列化成同一线上文本但切点不同，第二个会命中第一个的对齐 | `translate-service.test.ts`: 「切点进缓存键」 |
| C3 | `cache/key.ts:100-103` `contextPayload` 结构化、空表与缺省同键 | — | a227bdd（#28） | 不先压 32 位 hash；启用术语表不让既有缓存全失效 | `key.test.ts`: 「上下文以原文进 SHA-256 载荷」「空表与不带术语表同键」 |
| C4 | `cache/key.ts:73-75` `normalizeText` | NFC + 折叠空白 + trim，只用于算键 | 1f8951e 2026-09-03 | — | `key.test.ts`: 「NFC、折叠所有空白、去首尾」 |
| C5 | `cache/store.ts:77-85,119-138` `ensureTotals` 单飞 + `totalsGeneration` | 总量账 | 18f22ff 2026-09-04（增量账）；47a36d4（#14，代际号） | 原版每次 set 扫全库 O(n)（2000 条 5.5 ms/set）；并发首批 set 各算一份账只留最后一份；统计在飞时 clear 作废后过时快照落地 | `tests/cache/store.test.ts`「账面（totals）的正确性」七例、「写入不扫全库」三例 |
| C6 | `cache/store.ts:150-153,289-301` `invalidateTotals` 删除前后各调一次 | — | 47a36d4（#14 #63） | 只在前面调，与删除赛跑的统计看到的代际号仍是当前值（实测 clear 后 set 多算 2 条） | `store.test.ts`: 「统计进行中被 clear 作废：过时的快照不落地」 |
| C7 | `cache/store.ts:164-172` `dropExpired` 事务内先读再删 | 只在真删掉时减账 | 670508c 2026-09-06（#63） | `getMany` 并发读同一过期键，Dexie 对已删行照样 resolve，每个调用方都减一次 | `store.test.ts`: 「同一条过期记录被并发读到：账面只减一次」「过期记录在读到之后被并发 set 覆盖…」 |
| C8 | `cache/store.ts:274-285` `cleanup` 失败抛出 | — | 93d0544（#52） | 唯一运行时调用方是 cache-stats，吞掉会把清不掉的当成功 | `store.test.ts`: 「cleanup 失败时拒绝而不是吞掉」 |
| C9 | `cache/store.ts:217` 热层命中也回写 `lastAccessedAt` | 与原实现不同 | 047de1f 2026-09-03（移植时改） | 持久层 LRU 按过时时间淘汰错条目 | 无直接用例 |
| C10 | `cache/store.ts:56-58` Dexie v2 加 `byteSize` 索引 | 初始化总量只读索引键 | 18f22ff | 不反序列化记录 | `store.test.ts`: 「未超限时 set 不再排序整库」 |
| C11 | `cache/store.ts:41-47` 30 天 / 20 000 条 / 50 MB / 256 KiB / 热层 256 | 容量常量 | 047de1f | 「重开秒出」需要按月 TTL；helper 回应上限 250 KB 对齐 256 KiB | `store.test.ts`: 「超大单条与空译文不入库」 |
| C12 | `cache/index.ts:15-17` `putMany` 逐条 `await cache.set` | 串行写 | b7a6e21 2026-09-04 | `set` 内部有事务与账面更新，串行避免并发写账 | `transport.test.ts`「缓存」三例（行为） |
| C13 | `config/schema.ts:16-40` `GLOSSARY_LIMITS` + `normalizeGlossary` | 术语表限额与规整 | 6cebf11（#52） | 整篇文档粘成一条也收下、进每批 prompt 与每段键；旧超限术语让整份配置回退默认 | `tests/config/storage.test.ts`: 「v6 里超限的术语表在迁移时被规整」「规整只丢不合法的条目」「单条与总长都有上限」 |
| C14 | `config/schema.ts:45` `provider` refine 内置 id 或 `svc-` | — | 8d8f9ef（v12） | 服务 id 当引擎 id，链/状态/缓存键无特判 | `storage.test.ts`: 「未知 provider 被 schema 拒绝」 |
| C15 | `config/schema.ts:97` `uiLanguage: z.string()` 不枚举 | 未知码读时兜底 | 44bed49 | 后续版本删掉语言包不能让读者丢 key | 无 |
| C16 | `config/schema.ts:83,105,110` `reading` 带 default 不升版本；默认 `provider: 'microsoft'`、`mode: 'side'` | — | db38c5d；0a03b0b；f1198f2 | 免 key 保公式；宽屏多数人停在左右对照 | `tests/config/appearance.test.ts` / `storage.test.ts`: 「空存储返回默认配置」 |
| C17 | `config/storage.ts:44` 迁移 10 只升号 | — | e12b56e（#115） | 旧构建读到 `microsoft` 会静默重置；升号让它报 `tooNew` | 无直接用例（v10→v11 用例覆盖形状） |
| C18 | `config/storage.ts:51-60` 迁移 12 `edited` 判定 | 只在曾选 LLM 或改过默认端点/key/模型时生成服务 | 8d8f9ef | 全量映射，不让任何 v11 值回退默认 | `storage.test.ts`: 「v11 to v12: the single endpoint becomes a service…」「…a model name longer than the schema allows is clipped」 |
| C19 | `config/storage.ts:109-155` `fallbackReason` + `describeFallback` | 回退不静默 | 0f1a760 2026-09-06（实测 v7 配置 + v6 构建） | key 存着却不生效、翻译悄悄降级到免费引擎 | `storage.test.ts`: 「回退不是静默的：版本比扩展新时说清楚」「结构坏掉时指出是哪个字段」「配置正常时不留回退原因」 |
| C20 | `config/storage.ts:161-166` `watchConfig` 只在 safeParse 成功时回调 | — | 57526aa | 坏值不进订阅方 | 无 |
| C21 | `config/services.ts:45` `defaultServiceName` 截 40 字 | — | 87e62e1（#157 第 3 轮） | v11 无长度限制的模型名迁成 zod 拒绝的服务名，整份配置回退 | `storage.test.ts`: 「…is clipped, not left to invalidate the config」 |
| C22 | `config/languages.ts:960` `BCP47_OVERRIDES`（yue/ckb/zlm） | 两字母码丢身份时改发别的标签 | 0cce771 + 61a4ec5（#39 三轮） | `yue` 发 `zh` 成普通话、`ckb` 发 `ku` 成库尔曼吉、`zlm` 发 `ms` 成拉丁马来语（逐条实测） | `tests/config/languages.test.ts`: 「Google 用 BCP-47…」；`microsoft.test.ts` 相关 |
| C23 | `config/languages.ts:910-927` `EN_UI_OVERRIDES` | 界面英文名与 prompt 学名分开 | a772cee 2026-09-12（用户 2026-09-11 反馈） | 「Simplified Mandarin Chinese」太拗口；改 prompt 会动 `PROMPT_VERSION` | `tests/ui/*`（不在本次范围） |
| C24 | `config/languages.ts:991-1020` `RTL_SCRIPTS` / `RTL_PRIMARY` | 文字子标签优先 | 861bc29（#163 第 1 轮） | `ms-Arab` 只按主子标签漏成 ltr；把 `ms` 放进表又把拉丁马来语误判 | `languages.test.ts`（isRtlTag 用例在 `tests/renderer`） |
| C25 | `config/languages.ts:1029-1044` `fromBcp47` 繁体子标签归 `cmn-Hant` | 迁移 v3→v4 | 10e0519（#39 第 2 轮） | 只按主语言回退把繁体换成简体 | `languages.test.ts`: 「迁移：BCP-47 反查…」；`storage.test.ts`: 「v2 配置升级到最新：…zh-TW 变 cmn-Hant」 |
| C26 | `config/languages.ts:940` `label` 兜底走 `LANG_CODE_TO_EN_UI_NAME` | 两处兜底同一张表 | e41951a 2026-09-12（#165） | 半张名字表时行里写 `Chinese (Simplified)`、菜单写回学名 | `languages.test.ts`: 「设置页标签…」 |
| C27 | `shared/transport.ts:15-22` 通信失败 → `network, isolatable:false` | — | 6ab0a4b | 抛异常会被 run.ts 当崩溃；拆小只是重复同一失败 | `tests/shared/transport.test.ts`: 「后台不通时给出结构化错误」「cancel…发不出去按 0 算」 |
| C28 | `shared/chain.ts:8-9` `awaitChain` 10×100 ms | 轮询到链反映刚保存的配置 | 59e4e13 2026-09-10（#157） | background 由 storage 事件重建链，与页面保存后立刻发的消息赛跑 | 无 |
| C29 | `shared/hash.ts:5` `codePointAt(0)` | 按码点哈希 | d689333（#28 第 3 轮） | 😀 与 😁 同键 | `prompt-library.test.ts`: 「指纹按码点算」（**该用例现在测的是 promptKey 全文，hash.ts 本身无用例**） |

### 3.5 移植队列（request/）里本项目新增或改动的守卫

| # | 位置 | 做什么 | 引入提交 / issue | 解决的问题 | 测试 |
|---|---|---|---|---|---|
| Q1 | `request-queue.ts:81,87` `maxConcurrent` / `maxTotalMs` 可选项 | 默认 Infinity 不改原行为 | a1e8fe3 2026-09-05（#43） | 令牌桶不限并发（实测 rate=1/capacity=1 三个不完成请求全在飞） | `concurrency-cap.test.ts`: 「令牌桶不是并发上限」「设了 maxConcurrent 之后…」 |
| Q2 | `request-queue.ts:99,357,578` `activeExecutions` 独立计数 | 不数 `executingTasks` | e153cd4（#56 第 2 轮） | cancel 立刻摘出任务但 abort 是协作式的，照 map 大小放行会超上限 | `concurrency-cap.test.ts`: 「取消后还没结束的尝试仍占并发额度」 |
| Q3 | `request-queue.ts:569-587` `releaseWhenSettled` + 5 s 宽限 | 等 thunk 真结束再还额度 | 606eccc（#56 第 3 轮）；TDZ 顺序 018e98a/…（#56） | 替补与还在跑的叠在一起；不认 signal 的实现会锁死队列；`const` 前调 release 撞 TDZ | `concurrency-cap.test.ts`: 「超时之后并发额度要等 thunk 真的结束再还」「thunk 永远不结束时宽限期到点也要还额度」「thunk 同步抛出时额度立刻归还」 |
| Q4 | `request-queue.ts:290-299,324` `reapExpired` | 排队中超预算的先回收 | 606eccc | 429 暂停可达 5 min 而预算 180 s | `concurrency-cap.test.ts`: 「限流暂停比预算还长时，排队任务到点就被回收」 |
| Q5 | `request-queue.ts:502-513` 判「下一次尝试能否在预算内跑完」并照记冷却 | — | 018e98a（#56）；e153cd4（applyRateLimitPause 抽出） | 300 s Retry-After 在预算只剩几毫秒时照样排进去；超预算的 429 不记冷却会让积压立刻再撞 | `concurrency-cap.test.ts`: 「Retry-After 比剩余预算还长时立刻放弃」「超预算的 429 仍然给队列记上冷却」 |
| Q6 | `request-queue.ts:20,269,367-371` `SATURATED_DISPATCH_ETA_MS` + 满载不武装 0 ms 定时器 | — | 018e98a | 满载时 0 ms 定时器风暴；门闸以为槽位就绪冲小批 | `concurrency-cap.test.ts`: 「槽位被占着时不武装 0 毫秒定时器」「nextDispatchEtaMs 把并发满载算进去」 |
| Q7 | `request-queue.ts:117-121` 构造时也过 schema | — | e153cd4 | `setQueueOptions` 与构造两条入口不能只守一边；0/NaN 让队列卡死 | `concurrency-cap.test.ts`: 「并发上限必须是正整数」 |
| Q8 | `request-queue.ts:58,166,284` `deadlineAt` | 调用方给绝对期限 | e153cd4 | 批级重试各拿一份预算 | `concurrency-cap.test.ts`: 「deadlineAt 覆盖…」 |
| Q9 | `request-queue.ts:461` `thunkPromise.catch(() => undefined)` | 超时先赢时挂空 catch | 606eccc | 未处理拒绝 | 无直接用例 |
| Q10 | `batch-queue.ts:273,278` `holdCapMs = min(60 s, maxTotalMs)` | 门闸按住的批次到期放行 | c24ebbd 2026-09-06 | maxTotalMs 短于持批上限时多挂几十秒 | `concurrency-cap.test.ts`: 「maxTotalMs 短于持批上限时，期限一到就派发」 |
| Q11 | `batch-queue.ts:404-405` `withinBudget` | 退避后没预算就直接逐条兜底 | a3e68d0 2026-09-06 | 临近截止仍先睡 1–8 s 再入队 | `concurrency-cap.test.ts`: 「临近截止时不再先睡退避再入队」 |
| Q12 | `batch-queue.ts:74,370` `startedAt` = 批次创建时刻 | 门闸按住的时间算进总时限 | e153cd4 + a3e68d0 | — | `concurrency-cap.test.ts`: 「派发闸按住的时间也算进总时限」 |
| Q13 | `batch-queue.ts:52,160,357,436-442` `flushed` + `rejectIfAllScopesCancelled` | 上游 #1881 | c2e46b8（移植原样） | 退避睡眠期间批次不在任何可取消结构里；晚到的去重订阅者不能并进已冻结的批 | `tests/providers/request/queue-cancellation.test.ts`: 「does not drop a later session's paragraph…(#1881)」「aborts the retry backoff when every scope was cancelled…(#1881)」 |
| Q14 | `cancellation.ts:32-72` `CancelledScopeRegistry` TTL 10 min / 256 | 上游 #1881 | c2e46b8 | 请求挂在 IndexedDB 读上时被撤，醒来后进队列带着死 scope | `tests/providers/request/cancellation.test.ts` 四例 |
| Q15 | `retry-policy.ts:43-53` 5 min 上限 / 5 s 基础暂停 / 5 个窗口 / 每任务 8 次 | 上游常量 | c2e46b8 | Gemini 免费档 RPM=15；防止队列级计数器交替重置时单任务一直 429 | `tests/providers/request/retry-policy.test.ts`「429 pause-and-retry」九例 |
| Q16 | `retry-policy.ts:211-223` 401/403/404/access-denied 排空整队 | 上游 | c2e46b8 | 配置错了每个排队任务都会同样失败 | `retry-policy.test.ts`: 「keeps %s as queue-fatal」；`request-queue.test.ts`: 「drains the current backlog after a %s」 |

### 3.6 helper / 安装脚本 / manifest

| # | 位置 | 做什么 | 引入提交 / issue | 解决的问题 | 测试 |
|---|---|---|---|---|---|
| H1 | `main.swift:14,67-81` `MAX_REPLY_BYTES = 250_000` 按置信度丢行 | — | de90bd4 2026-09-07（#87 第 6 轮） | Chrome 1 MB 上限断整条连接；缓存单条 256 KiB 否则每次重识别 | `scripts/helper-smoke.mjs`（造不出这种图，靠读代码守）；`helper.test.ts`: 「helper 丢过行的回应带 truncated，原样透传」 |
| H2 | `main.swift:48-65` `readExactly` 读满前缀与正文 | — | de90bd4（#87） | 管道短读 1–3 字节当 EOF 会让排队的识别全作废 | `helper-smoke.mjs`（`split: true` 分两次写前缀） |
| H3 | `main.swift:149` `version == PROTOCOL` | 不认就回 `unsupported-protocol` | 174895e（#87 第 4 轮） | 扩展与 helper 分开安装 | `helper-smoke.mjs` |
| H4 | `main.swift:103-111,121` EXIF 方向传给 Vision、宽高按显示方向 | — | 368e31d（#87） | 识别的是躺着的图，叠加层错位 | `helper/Tests/Fixtures/qed3d-string-breaking-exif6.jpg` + smoke |
| H5 | `main.swift:102,132` `frames` | 动图只识别第 0 帧 | 65fbc61（#89） | 框对不上后面的帧 | `helper/Tests/Fixtures/two-frames.gif` + smoke；`tests/image/run.test.ts`: 「动图（frames > 1）不叠译文」 |
| H6 | `main.swift:119` `minimumTextHeight = 0.008` | 比原版 0.01 更小 | a0f41f2 | 曲线图刻度与图例很小 | 无 |
| H7 | `main.swift:16-18` `REPORTED_VERSION` 带 Vision revision | — | de90bd4 | 系统升级换模型识别结果变，旧缓存要自然失效 | `helper-smoke.mjs`: 正则 `^\d+\.\d+\.\d+\+vision\d+$` |
| H8 | `install-remote.sh:45-46` 取 tarball 唯一顶层目录 | 不写死仓库名 | 3cf1852 2026-09-12 | 仓库改名后 glob 匹配不上，`cp` 拿空路径，一键安装整个坏掉 | 无 |
| H9 | `install-remote.sh:59-65` `allowed_origins` 并集 | — | bd9e930 2026-09-10 | 第二个 profile / dev 构建再跑一次会覆盖 | 无 |
| H10 | `install.sh:16` / `install-remote.sh:22` `^[a-p]{32}$` | 扩展 id 校验 | a0f41f2 / 7af0074 | — | 无 |
| H11 | `wxt.config.ts:32` `minimum_chrome_version: '131'` | — | 481e1c5 2026-09-07（Codex 在 #99） | `anchor-scope` 要 131，文档写了但 manifest 没落 | `scripts/check-output.mjs`（构建后检查，待核实是否断言这项） |
| H12 | `wxt.config.ts:51` 三个 `host_permissions` | 每个联网引擎都列 | 25c1390（openrouter）；6ab0a4b（google，Codex 在 #59）；cec5116（microsoft，Codex 在 #115） | background fetch 仍受 CORS 约束，不能指望对方一直返 `Access-Control-Allow-Origin` | `tests/e2e/local-endpoint.mjs`（http 本机端点） |
| H13 | `wxt.config.ts:54` `optional_host_permissions: https://*/*, http://*/*` | 自定义端点按 origin 申请 | 25c1390（Codex 在 #6） | 只写 localhost 字面量时申请直接失败 | 无 |
| H14 | `wxt.config.ts:41` `nativeMessaging` 必需权限 | — | b88d531（DESIGN §15.4 决定，Codex 在 #87 建议可选） | 未打包加载无警告；分发时再改可选 | 无 |

<!-- section 3 done -->

## 4. 外部契约（重建时不能随意改）

| 契约 | 位置 | 字段 / 形状 | 改了会影响什么 |
|---|---|---|---|
| **已保存配置的 schema（v13）** | `src/config/schema.ts:42-98`；存于 `chrome.storage.local['config']`（WXT `local:config`，版本元数据由 WXT 另存，键名待核实 §6） | `version: 13`；`provider: 内置 id('microsoft'/'google-web'/'chrome-builtin') \| 'svc-[a-z0-9]{8}'`；`services: [{ id, kind:'openai-compat', name(≤40), baseURL(url), apiKey, model, thinking:'enabled'\|'disabled' }]`(≤20)；`targetLanguage: LangCode(179 个 ISO 639-3)`；`mode: 'stack'\|'side'\|'only'`；`prompts: { promptId, patterns:[{ id, name, systemPrompt, prompt }] }`；`glossary: [{ term(≤120), translation(≤200) }]`(≤200 条 / 总 ≤6000 字)；`appearance: { styles:[StyleProfile](≤50), activeStyle, highlights:[HighlightProfile](≤50), activeHighlight }`；`fallback: { enabled }`；`preload: { margin 0–10000, threshold 0–1 }`；`reading: { sentenceHighlight }`；`image: { enabled, modes: Mode[] }`；`uiLanguage: string` | 改形状必须加迁移函数并升 `CONFIG_VERSION`，否则 `getConfig` 回退默认：读者的 API key、服务、提示词、外观全部失效（0f1a760 实测撞过）。降版本（新配置 + 旧构建）WXT 拒绝迁移 → `tooNew`。`services[].apiKey` 是唯一的密钥存放处（硬规则 7）。`abstract.content.ts:14` 直接读 `config.uiLanguage`，改这个字段名会让摘要页入口失去语言 |
| **`StyleProfile` / `HighlightProfile`** | `src/config/appearance.ts:15-45` | `{ id(≤40), name(≤40), color(sanitizeColor), opacity[OPACITY_MIN,MAX], underline:'none'\|'solid'\|'dotted'\|'dashed'\|'wavy', thickness:1\|2, blur, css(≤2000, 只声明) }`；内置 id `follow/green/blue/amber/muted/blur`、`soft-green/sand/sky` | 内置 id 被 `resetBuiltIns`、迁移 12 的 `migrateStyle` 与 `data-axt-*` 样式表引用；改 id 会让 `activeStyle` 指向不存在的项（回退第一个）并让迁移产出不匹配 |
| **Dexie 缓存库** | `src/cache/store.ts:49-60` | 库名 `axt-translation-cache`；表 `entries`，v1 索引 `&key, paper, createdAt, expiresAt, lastAccessedAt`，v2 加 `byteSize`；记录 `{ key(sha256 hex), paper, translation, alignment?: { source:number[], target:number[] }, createdAt, lastAccessedAt, expiresAt, byteSize }` | 改索引要新增 Dexie `version(3)`，否则打开失败（`get`/`set` 降级为未命中，静默失去缓存）。改库名 = 抛弃全部已缓存译文与 OCR 结果。OCR 结果也存这张表（`translation` 字段放 JSON，键前缀 `['ocr', 1, imageHash, helperVersion]`）；`parseCached`（`ocr.ts:24`）按形状识别 |
| **缓存键载荷** | `src/cache/key.ts:77-92,112-114` | 译文：`sha256(JSON [6, providerId(cacheId??id), model, PROMPT_VERSION('4'), promptKey, contextPayload, RULES_VERSION, target(ISO 639-3), renderPath, normalizeText(text), cuts??null])`；OCR：`sha256(JSON ['ocr', 1, imageHash, helperVersion])`；`cacheId` 形如 `openai-compat:<origin><path>` | 任何一项的编码变化都等于全站缓存作废（这是设计意图，用版本号显式触发）；`CLAUDE.md` 硬规则 6 列的字段比实际少（见 §5） |
| **Native Messaging 协议 v1** | `helper/Sources/axt-helper/main.swift`、`src/shared/ocr.ts:6-8`、`src/entrypoints/background/helper.ts` | 见 §2e：host 名、4 字节本机序帧、`{v, cmd, id, image?, langs?}` / `{v, id, ok, version}` / `{v, id, width, height, frames, lines, truncated?}` / `{v, id, error:{code, message}}`；`version` 格式 `X.Y.Z+vision<N>` | helper 与扩展分开安装、版本可能错开：改协议必须升 `PROTOCOL`/`HELPER_PROTOCOL`，旧 helper 会被判「握手失败、请重新安装」；`version` 进 OCR 缓存键，改它的格式会让已识别结果重跑；`scripts/helper-smoke.mjs` 与 `tests/e2e/image.mjs` 也按这个协议说话 |
| **Native host manifest** | `helper/install.sh:30-43`、`helper/install-remote.sh:55-75`、`tests/e2e/image.mjs:19-47` | 路径 `~/Library/Application Support/{Google/Chrome,Chromium}/NativeMessagingHosts/io.github.srjoeee.arxivtranslate.json`；`{ name, description, path, type:'stdio', allowed_origins:['chrome-extension://<id>/'] }` | 改 host 名 = 所有已装读者的 helper 失联（要同时改 `HELPER_HOST`、两个脚本、e2e、README）；改二进制路径 = 已写好的 manifest 指向不存在的文件；e2e 从 `Chromium/...` 那份读并改写 `allowed_origins` |
| **一键安装命令** | `src/ui/strings.ts:158-162` → `helper/install-remote.sh` | `curl -fsSL https://raw.githubusercontent.com/SRjoeee/ReadarXiv/main/helper/install-remote.sh \| bash -s -- <id> main`；脚本依赖 `REPO=SRjoeee/ReadarXiv`、tarball URL `codeload.github.com/$REPO/tar.gz/refs/heads/$REF`、目标目录 `~/Library/Application Support/Readarxiv/helper`、`helper/{Sources,Package.swift,LICENSE-macos-vision-ocr.txt,Tests}` 的相对路径、`swift build -c release` 产出 `.build/release/axt-helper`、`--version` | 改仓库名 / 分支 / `helper/` 目录布局 / Package 名（产物名 `axt-helper`）都会让已发出的命令或已装的 manifest 失效；`README.md`、`HELPER_GUIDE_URL` 同步 |
| **manifest（wxt.config.ts:19-55）** | — | `name: 'Read arXiv'`；`permissions: ['storage','nativeMessaging','contextMenus']`；`host_permissions: openrouter.ai / translate-pa.googleapis.com / edge.microsoft.com`；`optional_host_permissions: https://*/*, http://*/*`；`commands: { 'axt-toggle': Alt+T }`；`minimum_chrome_version: '131'`；`default_locale: 'en'` + `__MSG_description__` / `__MSG_toggle__`（`public/_locales/{en,zh_CN}/messages.json`）；action 图标 `icon/mark-{16,32,48}.png` | 加必需权限会让已装用户在更新时被停用直到接受；去掉 `edge.microsoft.com` 等 host 权限后免费引擎只剩 CORS 头可依赖；`axt-toggle` 是 `COMMAND_ID`（`context-menu.ts:15`）与 popup 读快捷键的键；`_locales` 键名被 manifest 引用 |
| **扩展内消息表** | `src/shared/messages.ts:37-109` | 16 种 `axt:*` type 与各自 request/response 形状（`TranslateCall`、`TranslateMessageResponse`、`ProviderStatus`、`PageStatus`、`OcrCall`、`OcrMessageResponse`、`HelperStatus`） | 只在扩展内部，但 content / popup / options / background 四个包分别编译，改任何一边要一起改；`PageStatus.session` 是 background 判「页面还在不在」的探针依据，`PageStatus.running.revision` 是 popup 判「页面落后于设置」的依据 |
| **`TranslationProvider` 接口** | `src/providers/types.ts:57-96` | `id, displayName, kind, wireFormats, maxBatchChars, maxBatchItems, rateLimit?, maxConcurrent?, isAvailable(), translate(), reportsSentences?, promptKey?, cacheId?` | 内部接口，但 `WIRE_FORMATS` 表（`wire-formats.ts`）被设置页当数据读、`tests/providers/wire-formats.test.ts` 守着两者一致；`id` 进缓存键与 `PageStatus.running.engine` |
| **`PROMPT_VERSION` / `RULES_VERSION` / `CACHE_KEY_VERSION` / `OCR_KEY_VERSION` / `CONFIG_VERSION` / `PROTOCOL`** | 各文件 | 当前 `'4'` / `0.7.0`（`core/rules/latexml.ts`）/ `6` / `1` / `13` / `1` | 六个独立版本号，各管一类作废；重建时若合并或改名要保证已存条目按原样失效而不是错配 |
| **免费端点的请求形状** | `google-web.ts:11-14,25-28`（`translate-pa.googleapis.com/v1/translateHtml`，`X-Goog-API-Key` 公开常量，body `[[items, from, to], 'wt_lib']`）；`microsoft.ts:26,107-115`（`edge.microsoft.com/translate/translatetext?from=en&to=<tag>&isEnterpriseClient=false`，body 裸字符串数组） | — | 对方的契约，不是我们的；实测结论在 RESEARCH §5.1 / §6.6。改动只能跟着对方走 |
| **GPL §5 来源标注** | 每个移植文件的文件头 + `docs/THIRD_PARTY.md` | `// 移植自 reference/<repo>/<path>@<commit>（GPL-3.0），<日期> 移植、有修改` | 重建时搬动或改写移植文件必须保留来源行并更新登记；`thinking.ts`、`glossary.ts`（形状照 KISS）、`request/config.ts`（Read Frog 字段）文件头写了来源但**未登记进 THIRD_PARTY.md** |

<!-- section 4 done -->

## 5. 债务候选

类型：重复状态 / 并存路径 / 过渡代码 / 死代码 / 文档不符 / 未用移植。只列证据，不给方案。

| # | 位置 | 类型 | 证据 | 影响范围 |
|---|---|---|---|---|
| D1 | `providers/transport.ts:81` `revision` 模块级计数 ↔ `content/index.ts:206` `running.revision` ↔ `popup/view-model.ts:157-159` | 重复状态（跨 worker 生命周期不稳定） | worker 被回收后计数归零；页面记着旧 worker 的 `revision: n`，新 worker 第一条链是 1。popup 用 `!==` 判「页面落后于设置」，会在 worker 重启后误报（或 n 恰好相等时漏报）。无测试覆盖 worker 重启 | popup「重新翻译」提示的正确性；`axt:engine-ready` 的 `reset` 判断不受影响 |
| D2 | `sessions.dropped`（`sessions.ts:86`）、`translate-service.cancelledScopes`（每 provider service 一份，`translate-service.ts:226`）、`ocr.cancelled`（`ocr.ts:41`）、content 侧 `halted()` | 重复状态 | 同一个「scope 已撤」事实记在四处、三种数据结构（Set / CancelledScopeRegistry 带 TTL / Set），语义各自定义 `remember` | 撤销一致性；每处都要单独维护 `remember:false` 语义（dbe0ca4 就是漏了一处的修复） |
| D3 | `translate-service.fatal.scopes`（每 provider）、`fallback.demotions`（每链）、content `run.ts` 的 `fatal`、content `restarted` | 重复状态 / 三层各自决定「停」 | no-key/auth 的后果分散在服务层（拒批）、链层（永久降级）、页面层（停调度 + 整页重开）| 改错误分类要三处同步；`FATAL_FOR_QUEUE` 与 `PERMANENT_KINDS` 是同一集合写两遍（`translate-service.ts:168`、`fallback.ts:55`） |
| D4 | helper 可用性：`helper.ts` `known`/`missing`、`helper-await.ts` `deadline` + session storage、content `helperReady`（`content/index.ts:300`）、popup/options 各自的 `helper` state | 重复状态 | 一个事实四份快照，靠 `axt:helper-ready` 广播 + `recheck` 再探 + 3 min 轮询三种机制同步 | 安装引导的边角（#161 第 7 轮、#166 两轮都是同步漏洞） |
| D5 | `background/index.ts:26` `active.config` ↔ `chrome.storage.local.config` ↔ content `current.config` / `savedMode` / `look` ↔ popup `config` ↔ `abstract.content.ts` 原始读 | 重复状态 / 并存读取路径 | 配置在五个上下文各有内存副本，靠 `watchConfig` 同步；`abstract.content.ts:14,25` 绕过 `getConfig`/schema 直接读原始键（为包体积） | 改字段名或迁移时摘要页那条路径不经 zod 校验，不会报错、只会静默拿不到 |
| D6 | `SessionRouter.rebindAll`（`sessions.ts:215`） | 死代码 / 过渡代码 | 被 `dropAndRebindAll` 取代（3040af8），`src/` 无调用，只剩测试 | 接口面比实际大 |
| D7 | `providers/index.ts:87-89` `export { PROMPT_VERSION }`、`export * from './prompt-library'`、`export * from './types'` | 死代码 | `grep "from '@/providers'"` 在 `src/` 内零命中；所有调用方直接引子模块 | 无 |
| D8 | `TranslationProvider.displayName` 及 `EngineStatus.displayName` / `ProviderStatus.fallback.displayName` / `DemotedInfo.displayName` | 死代码（对 UI）| `src/entrypoints/{popup,options}`、`src/ui` 无 `displayName` 读取（只有 `popup/fixtures.ts`）；popup 用 `serviceName(id, services)`（`view-model.ts:160`）；只有 `fallback.ts:102` 的 `console.warn` 用到 | provider 里的中文显示名（`'Chrome 内置翻译（离线）'` 等）在 i18n 之后成了无人显示的字符串，却仍随消息传输 |
| D9 | `BUILT_IN_PROMPT_DESCRIPTIONS`（`prompt-library.ts:89-92`）↔ `locales/zh-CN.ts:244` 附近的同一份说明 | 重复状态 / 死代码 | 语言包只在注释里提到它，实际各自维护一份中文；`src/` 无调用 | 两份文案会漂移 |
| D10 | provider 与 helper 客户端里的中文 `ProviderError.message`（`'未配置 API key'`、`'请求已中止'`、`helper 断开：…`、`微软翻译不支持目标语言 …`）| 文档不符（i18n 约定，44bed49 之后） | `ServiceDrawer.tsx:106`：`reasonText(kind) \|\| res.error.message`——kind 没有文案时中文原样进英文界面 | 英文界面偶发中文；重建若统一错误文案要动所有 provider |
| D11 | `helper/install.sh` ↔ `helper/install-remote.sh` | 并存路径 | 同一个 manifest 两套写法：description 不同（「arXiv HTML Translator 的本机 OCR 助手」vs「Readarxiv 的图片识别助手」）、`allowed_origins` 一个覆盖一个并集、二进制路径不同（仓库内 vs `~/Library/Application Support/Readarxiv/helper`）| 开发机上两者交替跑会互相覆盖 manifest 的 `path`；README 同时描述两条 |
| D12 | `src/ui/strings.ts:158` `HELPER_REF = 'main'` 硬编码 | 文档不符 | `helper/README.md:15` 与 `install-remote.sh:3` 说「popup 传的是它自己所在的分支」，实际常量是 `main` | 从分支构建的扩展装的仍是 main 的 helper；协议号错开时会「握手失败」 |
| D13 | 产品名五套：manifest `Read arXiv`、`package.json` `arxiv-html-translator`、仓库 `SRjoeee/ReadarXiv`、安装目录 `Readarxiv`、host 名 `io.github.srjoeee.arxivtranslate`、Dexie 库 `axt-translation-cache`、前缀 `axt-` | 过渡代码 | 各处引入时间不同（改名发生在 2026-09-12 前后，3cf1852 就是改名的后果） | 改名时容易漏；host 名与库名属于 §4 契约不能改 |
| D14 | `request/request-queue.ts` `setQueueOptions`、`batch-queue.ts` `setBatchConfig`、`cancellation.ts` `markPrefix` + `prefixes`、`retry-policy.ts` `isRateLimitRequestError` 与 `RetryAwareError` 的多形状读取分支、`RequestTask.createdAt`（与 `enqueuedAt` 同值双写）、`PendingBatch.id`（生成后无人读） | 未用移植 | §1.8；`request/config.ts` 只为这两个热更新入口存在一半（构造时校验那半在用） | 移植目录 ~1 700 行里约 250 行本项目从未执行 |
| D15 | `cache/store.ts:243` `set(value: string \| CachedEntry)` 双形态 | 并存路径 | 运行时只有 `cachePortOf` 调 `set`，总传对象；字符串形态只有测试用 | 无 |
| D16 | `cache/index.ts:15-17` `putMany` 逐条 `await set`，每条一个 Dexie 事务 + `ensureTotals` + 可能的淘汰 | 性能候选（非 bug） | 一批 100 段 = 100 个事务；`TranslationCache` 没有批量写 | 大批量写入时 worker 单线程被占；与「性能优先」原则相关 |
| D17 | `translate-service.ts:1-5` 文件头「组装方式照 Read Frog…只是跑在 content 侧（§8.0）」；`shared/hash.ts:1`「文本指纹（缓存键的组成部分）」；`openai-compat.ts:62`「只取 origin，不带路径」；`types.ts:33` `target: BCP-47，如 zh-CN` | 文档不符（注释过时） | 请求已在 background（6ab0a4b）；缓存键用 `sha256Hex`，`hashText` 只被 `split-figures.ts` 用；`endpointIdentity` 含路径（35408ce）；`target` 是 ISO 639-3，各 provider 自己 `toBcp47` | 误导重建者 |
| D18 | `chrome-builtin.ts:147-148` 两行重复注释；`microsoft.ts:176-177` 缩进错位 | 过渡代码（整洁） | 直接可见 | 无 |
| D19 | `docs/DESIGN.md:565`「content script 只发三种消息」 | 文档不符 | content 还发 `axt:ocr`（`content/index.ts:312`）、`axt:helper-status`（`:350`），并回答 `axt:page-status`/`axt:helper-ready` | — |
| D20 | `docs/DESIGN.md:599`「取消是尽力而为：派给当前那条链…旧链不主动取消是有意的」 | 文档不符 | `sessions.ts:128-129` 撤的是会话绑定的那条链；`dropAndRebindAll` 主动撤旧链的活（3040af8）；测试「撤掉 scope 时用它绑定的那条链，不是当前那条」 | 文档描述的是 d29f88f 之前的行为 |
| D21 | `docs/DESIGN.md:592-593` `cancel(scope)` / `status()`；`:604` id 联合含 `anthropic \| gemini` 无 `microsoft`；`:618` `target: BCP-47`；`:741` 值形状 `{ text, ts, paper }`；`:740` 键公式少 `promptKey/context/cuts/CACHE_KEY_VERSION`（`:662` 另有补充）；`:747` 版本史缺 v10、v13 | 文档不符 | 代码：`cancel(scope, options?)`、`status(scope?)`；`CacheRecord` 八个字段；键见 §4 | DESIGN.md 是「唯一事实来源」，这些条目已落后于代码 |
| D22 | `CLAUDE.md` 技术栈表与目录结构：`@ai-sdk/anthropic` / `@ai-sdk/google`、`anthropic.ts gemini.ts google-gtx.ts`、`src/entrypoints/content.ts` / `background.ts`、`cache/` 「移植 FluentRead」、硬规则 6 的键字段清单 | 文档不符 | `package.json` 只有 `@ai-sdk/openai-compatible`；实际是 `google-web.ts`、`microsoft.ts`；入口是目录 `content/` `background/`；键字段见 §4 | 新会话按 CLAUDE.md 找文件会找不到 |
| D23 | `docs/THIRD_PARTY.md` 未登记 `providers/thinking.ts`（KISS `THINKING_API_REGISTRY`）、`providers/glossary.ts`（KISS `parseAITerms` 形状）、`providers/request/config.ts`（Read Frog `types/config/translate.ts` 字段） | 文档不符（GPL §5 登记） | 三个文件头都写了来源，登记表没有 | 许可证合规 |
| D24 | `tests/providers/prompt.test.ts:32` 用例名「带版本号：目标语言改填英文名后升到 3」 | 过渡代码（测试名过时） | `PROMPT_VERSION` 已是 `'4'` | 误导 |
| D25 | `shared/chain.ts` `awaitChain` 轮询 vs `axt:engine-ready` 响应即重建完成 | 并存路径 | 等「链反映新配置」有两种办法：popup 保存后轮询 `provider-status` 10 次；`ServiceDrawer` 则发 `engine-ready` 并等其响应。根因是 `watchConfig` 触发的重建没有 ack | 两处等待逻辑不同步；轮询上限 1 s 后放弃 |
| D26 | `config/languages.ts:936` `label(code, inLocale = LANG_CODE_TO_ZH_NAME)` 默认中文表；`LANG_CODE_TO_ZH_NAME` 常驻 `languages.ts` | 过渡代码（i18n 之前的遗留） | 配置层函数默认认中文；语言名表与 i18n 语言包并存 | 加第三种界面语言时要再想一遍名字表放哪 |
| D27 | `HelperClient.ocr(request.langs?)`（`helper.ts:44,243`）| 死代码 | `ocr.ts:60` 从不传 `langs`；helper 端默认 `["en-US"]` | 非英文图片文字的识别语言无入口 |
| D28 | `getProvider` 的 `default` 分支「被删服务的 id 落到 microsoft」（`providers/index.ts:19-21`）与 `ServiceDrawer.remove` 已把 `provider` 改成 `'microsoft'`（`ServiceDrawer.tsx:127`）| 并存路径（双保险） | 两处都处理同一件事；schema 的 refine 允许任何 `svc-` id，所以 `default` 也接住了「配置里指着不存在的服务」 | 无害，但语义分散 |
| D29 | `config/schema.ts` 带 `.default()` 的字段 vs `storage.ts` 迁移函数 | 并存路径 | 缺字段直接通过 vs 升版本迁移，两套演进机制并存（`reading`、`uiLanguage` 走前者，`fallback`、`glossary` 走后者且也有 default） | 版本号不再能表达「存储里是什么形状」 |
| D30 | `sessions.ts:126-128` 注释「worker 中途重启过，绑定丢了但队列里可能还有这个 scope 的任务」 | 待核实的推理 | 绑定与队列都在同一个 worker 内存里，重启后两者一起丢；该分支实际会为撤一个不存在的任务建一条链（`await current()`） | 见 §6 |

<!-- section 5 done -->

## 6. 没看懂或待核实的

1. **WXT storage 版本元数据的键名**：`configItem` 用 `storage.defineItem('local:config', { version: 13, migrations })`。WXT 把版本号存在一个伴随键（记忆中是 `local:config$` 的 `{ v }`），本次没在 `node_modules` 里找到 `defineItem` 的实现文件（`@wxt-dev/storage` 路径未命中）。§4 的「已保存配置」契约应把这个伴随键也算进去，重建时若不再用 WXT storage 要迁它。
2. **`revision` 跨 worker 重启的误报**（D1）：由代码推出，没有实测复现。核实方法：翻译中让 worker 空闲 30 s 以上被回收，再开 popup 看是否出现「重新翻译」提示。
3. **`sessions.ts:126-128` 那个分支的真实用途**（D30）：注释给的理由（worker 重启后队列里还有任务）与内存模型不符；可能是为「没经过 forCall 的 scope」（例如只做了图片 OCR、从没翻过字）准备的，但那种情况 `bind()` 已经记了绑定。需要作者确认或在测试「没绑过的 scope 也照撤」里看意图。
4. **`helper-await` 依赖 `setTimeout` 2 s 轮询 + `connectNative` 续命**：DESIGN §15.4 与文件头断言「探测本身是 API 调用，2 s 远小于 30 s 闲置线」，但 `missing` 被记住后 `status()` 直接返回、不再调 `connectNative`（`helper.ts:228`）——只有 `recheck: true` 才清 `missing`，而 `helperWaiter.probe` 确实传了 `recheck`（`index.ts:131`），所以每轮都会真的 `connectNative`。逻辑成立，但没有测试守「每轮都调了 API」这件事；worker 在 3 min 窗口内被回收的路径只靠 `resume()` 兜底。
5. **`translate-service.ts:186-188` 注释说 `maxItemsPerBatch` 为 1 的 provider 自然退化**：当前没有任何 provider 声明 1；这条是为将来准备的断言，无测试。
6. **`google-web.ts:13` 公开 API key 常量**：来自 Google 翻译网页版，是否仍有效只能靠 e2e / 实测；本次未验证端点存活。
7. **`microsoft.ts:36-42` 支持语言表是 2026-09-08 抓的快照**：端点语言表会变；没有自动化核对。
8. **`scripts/check-output.mjs` 检查什么**：H11 假设它可能断言 manifest 字段，grep 未命中 `minimum_chrome_version`/`permissions`，应视为「无测试」。
9. **`tests/entry/context-menu.test.ts`、`tests/renderer/direction.test.ts`** 在本次范围之外，B40 / C24 引用它们存在但未逐用例核对。
10. **`cache/store.ts:217` 热层命中每次 `await db.entries.update`**：一批 N 个命中 = N 个 DB 写（`getMany` 并发），移植时的有意改动（047de1f），是否值得（vs 只在淘汰时才需要准确的 `lastAccessedAt`）没有量过。
11. **`buildChain` 每次建链都 `await candidate.isAvailable()`**：`chrome-builtin` 的 `Translator.availability()` 在扩展 worker 里的耗时没有记录；`watchConfig` 触发的每次重建都会再探一次。
12. **`ProviderStatus.maxBatchChars/maxBatchItems` 取首选引擎的值**（`transport.ts:149-150`）：降级到 `chrome-builtin` 时 content 仍按首选（如 google-web 8000/100）规划批次，靠 E8 的信号量在 provider 内部兜；DESIGN §8.5 是否接受「按首选规划」没写明。

<!-- section 6 done -->

---
完成时间：见文件末尾时间戳。

_finished 2026-09-11T20:58:33Z_
