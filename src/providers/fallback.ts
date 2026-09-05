// 引擎降级链（DESIGN §8.5）。一层薄编排，不动队列：
// createTranslateService 已经是"一个 provider 一套队列 + 缓存 + 批处理"的闭包，缓存键里带
// providerId | model | promptKey，不同引擎的译文天然分开存，所以链包在外面而不是塞进服务里。
//
// 解决的问题：key 过期、额度用尽、网络抖动时 run.ts 会把整页翻译停死（no-key / auth 触发
// scheduler.disconnect()），读者对着半篇译文干等。硬规则 4：失败必须可恢复并触发 fallback 链。
import type { TranslateCall, TranslateMessageResponse, TranslateService } from './translate-service'
import type { ProviderErrorKind, TranslationProvider } from './types'

export interface FallbackStep {
  provider: TranslationProvider
  service: TranslateService
}

export interface DemotedInfo {
  id: string
  displayName: string
  kind: ProviderErrorKind
  message: string
}

export interface FallbackStatus {
  /** 配置里选的引擎 */
  configuredId: string
  /** 此刻实际在用的引擎；与 configuredId 不同就说明降级了 */
  activeId: string
  /** 最近一次降级的原因，popup 用来解释为什么译文换了引擎 */
  demoted?: DemotedInfo
}

/**
 * 没有 `reset()`：「用户把配置修好之后链要回到首选」（Codex 在 #50 指出）不由这一层负责。
 * 链常驻 background，语言包下载完时 popup 发 `axt:engine-ready`，background **重建整条链**——
 * 那比撤销降级记录更彻底：建链时 `isAvailable()` 为假、根本没进链的引擎，撤记录是救不回来的（DESIGN §8.5）
 */
export interface FallbackService extends TranslateService {
  status(): FallbackStatus
}

/**
 * 会触发降级的错误类型。`aborted` 不在其中——会话取消不是引擎的错，换个引擎重来只会再被取消一次。
 * 队列自己的重试（retry-policy）跑完才会走到这里，所以链上不再叠加重试。
 */
const FALLBACK_KINDS: ReadonlySet<ProviderErrorKind> = new Set<ProviderErrorKind>([
  'no-key', 'auth', 'network', 'timeout', 'rate-limit', 'invalid-response', 'unknown',
])

/** 配置问题不会自己好：本会话内永久降级，不再浪费一次请求去试 */
const PERMANENT_KINDS: ReadonlySet<ProviderErrorKind> = new Set<ProviderErrorKind>(['no-key', 'auth'])

/**
 * 瞬时故障的冷却时长。持续故障时不设冷却的话，每次调用都要把该引擎的重试与超时（最长 120s）白等一遍；
 * 设太长又会在短暂抖动后长时间用着更差的引擎。60s 是折中，可注入以便测试
 */
export const DEFAULT_COOLDOWN_MS = 60_000

interface Demotion {
  info: DemotedInfo
  /** undefined = 永久（本会话） */
  until?: number
}

export function createFallbackService(
  steps: readonly FallbackStep[],
  opts: { cooldownMs?: number; now?: () => number } = {},
): FallbackService {
  if (steps.length === 0) throw new Error('降级链至少要有一个引擎')
  const cooldownMs = opts.cooldownMs ?? DEFAULT_COOLDOWN_MS
  const now = opts.now ?? Date.now
  const demotions = new Map<string, Demotion>()
  let lastDemoted: DemotedInfo | undefined

  const isDemoted = (id: string): boolean => {
    const demotion = demotions.get(id)
    if (!demotion) return false
    if (demotion.until === undefined) return true
    if (now() < demotion.until) return true
    // 冷却到期：恢复候选资格，成功与否由下一次调用说了算
    demotions.delete(id)
    return false
  }

  const available = (): FallbackStep[] => {
    const alive = steps.filter(step => !isDemoted(step.provider.id))
    // 全都降级了就退回最后一步：宁可再失败一次并把错误如实报上去，也不能无引擎可用
    return alive.length > 0 ? alive : [steps[steps.length - 1]!]
  }

  const demote = (step: FallbackStep, error: { kind: ProviderErrorKind; message: string }): void => {
    const info: DemotedInfo = { id: step.provider.id, displayName: step.provider.displayName, kind: error.kind, message: error.message }
    demotions.set(step.provider.id, {
      info,
      ...(PERMANENT_KINDS.has(error.kind) ? {} : { until: now() + cooldownMs }),
    })
    lastDemoted = info
    console.warn(`[axt] ${step.provider.displayName} 降级（${error.kind}）：${error.message}`)
  }

  const translate = async (call: TranslateCall): Promise<TranslateMessageResponse> => {
    const chain = available()
    let last: TranslateMessageResponse | null = null
    for (const [index, step] of chain.entries()) {
      const response = await step.service.translate(call)
      if (response.ok) {
        // 一次成功就撤销该引擎的降级记录：瞬时故障不该拖着它一直待在冷却里
        demotions.delete(step.provider.id)
        return response
      }
      last = response
      const isLast = index === chain.length - 1
      if (isLast || !FALLBACK_KINDS.has(response.error.kind)) return response
      demote(step, response.error)
    }
    // chain 非空，循环至少执行一次
    return last!
  }

  /** 恢复原文要撤掉每套队列：漏一个就有在飞请求回来往 DOM 写 */
  const cancel = (scope: string): number => steps.reduce((n, step) => n + step.service.cancel(scope), 0)

  const status = (): FallbackStatus => ({
    configuredId: steps[0]!.provider.id,
    activeId: available()[0]!.provider.id,
    ...(lastDemoted ? { demoted: lastDemoted } : {}),
  })

  return { translate, cancel, status }
}
