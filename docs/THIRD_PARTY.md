# 第三方代码登记

本项目以 GPL-3.0 发布。下列文件移植自同为 GPL-3.0 的参考项目（源码在 `reference/`，gitignore），按 GPL §5 保留来源并标明已修改。每个移植文件的文件头也写有同样的来源行与移植日期（GPL §5(a) 要求修改声明带相关日期）。

参考项目与快照：

| 项目 | 仓库 | 快照 commit |
|---|---|---|
| KISS Translator | https://github.com/fishjar/kiss-translator | `c95bd46`（2026-08-30） |
| Read Frog | https://github.com/mengxi-ream/read-frog | `9b44f82`（2026-09-02） |
| FluentRead | https://github.com/Bistutu/FluentRead | `536a819`（2026-09-03） |

## 移植文件

| 本项目文件 | 来源 | 移植日期 | 修改说明 |
|---|---|---|---|
| `src/providers/prompt-library.ts` | `reference/read-frog/src/utils/constants/prompt.ts` + `src/utils/prompts/translate.ts@9b44f82` | 2026-09-05 | 模板变量换成论文语义（标题 / 摘要 / 章节 / 术语表）、去掉字幕与分隔符式批处理与网页摘要；保留内置提示词表、自定义 patterns、按 id 选择与回退逻辑 |
| `src/cache/store.ts` | `reference/FluentRead/src/services/translation/cache.ts@536a819` | 2026-09-03 | 移植并改造：键计算移到 `key.ts`（Web Crypto），记录加 `paper` 索引，TTL / 容量按论文场景放大，构造函数可注入库与容量；保留内存热层与故障降级策略。**淘汰逻辑改写**：原版每次 `set` 都 `orderBy('lastAccessedAt').toArray()` 扫全库求和（O(n)/次），改为增量维护总量 + 超限时批量淘汰，见 DESIGN §9 |
| `src/providers/google-web.ts` | `reference/read-frog/src/utils/host/translate/api/google.ts@9b44f82` | 2026-09-04 | 端点、API key 常量、请求体与响应解析照搬；改为一次请求多条（原版一条一请求）；去掉 preserveLineBreaks 的换行标记与 `entities` 依赖（我们送的是占位符标记文本，protector 已转义）；错误按本项目的 ProviderError 分类 |
| `src/providers/request/retry-policy.ts` | `reference/read-frog/src/utils/request/retry-policy.ts@9b44f82` | 2026-09-03 | 整段移植；加文件头来源行，按本项目严格类型检查微调；由同目录的 `request-queue.ts` 驱动（2026-09-05 起；此前由已删除的 `src/providers/retry.ts` 驱动） |
| `src/providers/request/request-queue.ts` | `reference/read-frog/src/utils/request/request-queue.ts@9b44f82` | 2026-09-05 | 整段移植（2026-09-05 二次修改：新增 `maxConcurrent` 与 `maxTotalMs` 两个可选项，默认值不改原行为，见 DESIGN §10 与 issue #43）：`deepmerge-ts` 换成对象展开、配置 schema 换成本目录 `config.ts`、UUID 换成 `src/shared/uuid.ts`、计时器类型改 `ReturnType<typeof setTimeout>`、超时错误加 `name` 便于服务层归类 |
| `src/providers/request/batch-queue.ts` | `reference/read-frog/src/utils/request/batch-queue.ts@9b44f82` | 2026-09-05 | 整段移植：只改配置 schema 与 UUID 的 import、计时器类型（2026-09-05 二次修改，issue #43：`BatchExecutionMeta` 增加 `startedAt`（批次创建时刻）、`executeIndividual` 同样接收 meta、新增可选 `maxTotalMs` 让批级退避受总时限约束） |
| `src/providers/request/priority-queue.ts` | `reference/read-frog/src/utils/request/priority-queue.ts@9b44f82` | 2026-09-05 | 原样移植，仅加文件头 |
| `src/providers/request/cancellation.ts` | `reference/read-frog/src/utils/request/cancellation.ts@9b44f82` | 2026-09-05 | 原样移植，仅加文件头 |
| `src/shared/uuid.ts` | `reference/read-frog/src/utils/crypto-polyfill.ts@9b44f82` | 2026-09-05 | 原样移植，改名 |
| `tests/providers/request/*.test.ts` | `reference/read-frog/src/utils/request/__tests__/*@9b44f82` | 2026-09-05 | 六个测试文件移植：改 import 路径；`batch-queue.test.ts` 依赖的分隔符解析、hash、`executeTranslate` 换成测试内替身。`batch-separator-parsing.test.ts` 测的是它自己的分隔符解析，不搬 |
| `src/core/renderer/spinner.ts` | `reference/read-frog/src/utils/host/translate/ui/spinner.ts@9b44f82` | 2026-09-05 | 圆环与动画注册表原样；class / 颜色变量改本项目前缀；去掉它的请求胶水 `getTranslatedTextAndRemoveSpinner`（含 React 错误组件），加 `cancelSpinnersIn` |
| `src/core/scheduler/pacer.ts` | `reference/read-frog/src/utils/scheduler.ts@9b44f82` | 2026-09-05 | 原样移植，仅加文件头 |
| `src/config/languages.ts` | `@read-frog/definitions@0.4.4`（Read Frog 的依赖包，`LANG_CODE_ISO6393_OPTIONS`、`LANG_CODE_TO_EN_NAME`、`LANG_CODE_TO_ZH_NAME`、`LANG_CODE_TO_LOCALE_NAME`、`ISO6393_TO_6391`） | 2026-09-05 | 只搬五张语言表（整包 98% 是它的 SRS / 电子书 schema，不装依赖）；辅助函数（英文名、标签、BCP-47 双向转换）是本项目的 |
| `src/providers/prompt-file.ts` | `reference/read-frog/src/components/prompt-configurator/utils/prompt-file.ts@9b44f82` | 2026-09-05 | 功能重写：文件形状相同（可互相导入），校验换 zod，去掉 file-saver |
| `src/core/scheduler/session.ts` | `reference/read-frog/src/utils/host/translate/translation-session.ts@9b44f82` | 2026-09-05 | 去掉 providerRef 的两个函数；函数改名 begin / end / getSessionId |

登记格式：`src/<path>` ← `reference/<repo>/<path>@<commit>`，一句话说明改了什么（改名、去掉配置依赖、适配块模型等）。改写幅度大到不再像原文件的也要登记。
