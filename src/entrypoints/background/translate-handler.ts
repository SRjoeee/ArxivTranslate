// background 的翻译处理：每个 provider 一个 p-queue，按其 concurrency 限流；失败交给 withRetry + 移植的策略。
import PQueue from 'p-queue'
import { withRetry, type RetryOptions } from '@/providers/retry'
import { ProviderError, type ProviderErrorKind, type TranslateRequest, type TranslateResult, type TranslationProvider } from '@/providers/types'

export type TranslateMessageRequest = { request: Omit<TranslateRequest, 'signal'>; providerId?: string }
export type TranslateMessageResponse =
  | { ok: true; result: TranslateResult }
  | { ok: false; error: { kind: ProviderErrorKind; message: string } }
export interface ProviderStatus {
  providerId: string
  available: boolean
  model?: string
}

export interface TranslateHandlerDeps {
  getProvider: (providerId?: string) => Promise<TranslationProvider>
  retry?: RetryOptions
}

export function createTranslateHandler(deps: TranslateHandlerDeps) {
  const queues = new Map<string, PQueue>()
  const queueFor = (provider: TranslationProvider) => {
    let queue = queues.get(provider.id)
    if (!queue) {
      queue = new PQueue({ concurrency: provider.concurrency })
      queues.set(provider.id, queue)
    }
    return queue
  }
  return async ({ request, providerId }: TranslateMessageRequest): Promise<TranslateMessageResponse> => {
    try {
      const provider = await deps.getProvider(providerId)
      const result = await queueFor(provider).add(() => withRetry(() => provider.translate(request), deps.retry))
      return { ok: true, result: result as TranslateResult }
    } catch (e) {
      return { ok: false, error: toErrorInfo(e) }
    }
  }
}

export function createStatusHandler(deps: { getProvider: () => Promise<TranslationProvider>; getModel: () => Promise<string | undefined> }) {
  return async (): Promise<ProviderStatus> => {
    const provider = await deps.getProvider()
    return { providerId: provider.id, available: await provider.isAvailable(), model: await deps.getModel() }
  }
}

function toErrorInfo(e: unknown): { kind: ProviderErrorKind; message: string } {
  if (e instanceof ProviderError) return { kind: e.kind, message: e.message }
  return { kind: 'unknown', message: e instanceof Error ? e.message : String(e) }
}
