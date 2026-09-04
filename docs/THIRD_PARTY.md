# 第三方代码登记

本项目以 GPL-3.0 发布。下列文件移植自同为 GPL-3.0 的参考项目（源码在 `reference/`，gitignore），按 GPL §5 保留来源并标明已修改。每个移植文件的文件头也写有同样的来源行。

参考项目与快照：

| 项目 | 仓库 | 快照 commit |
|---|---|---|
| KISS Translator | https://github.com/fishjar/kiss-translator | `c95bd46`（2026-08-30） |
| Read Frog | https://github.com/mengxi-ream/read-frog | `9b44f82`（2026-09-02） |
| FluentRead | https://github.com/Bistutu/FluentRead | `536a819`（2026-09-03） |

## 移植文件

| 本项目文件 | 来源 | 修改说明 |
|---|---|---|
| `src/cache/store.ts` | `reference/FluentRead/src/services/translation/cache.ts@536a819` | 移植并改造：键计算移到 `key.ts`（Web Crypto），记录加 `paper` 索引，TTL / 容量按论文场景放大，构造函数可注入库与容量；保留内存热层与故障降级策略。**淘汰逻辑改写**：原版每次 `set` 都 `orderBy('lastAccessedAt').toArray()` 扫全库求和（O(n)/次），改为增量维护总量 + 超限时批量淘汰，见 DESIGN §9 |
| `src/core/scheduler/viewport-anchor.ts` | `reference/FluentRead/src/features/full-page-translation/content/viewportStability.ts@536a819` | 只保留 `withFullPageViewportAnchor` 及 helper，导出别名 `withViewportAnchor`；去掉滚动控制器 |
| `src/providers/retry-policy.ts` | `reference/read-frog/src/utils/request/retry-policy.ts@9b44f82` | 整段移植；加文件头来源行，按本项目严格类型检查微调；由 `src/providers/retry.ts` 的 `withRetry` 驱动 |

登记格式：`src/<path>` ← `reference/<repo>/<path>@<commit>`，一句话说明改了什么（改名、去掉配置依赖、适配块模型等）。改写幅度大到不再像原文件的也要登记。
