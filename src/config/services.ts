// User-added translation services (spec §2). One kind today; the field is there so native kinds
// can be added without a migration.
import { z } from 'zod'
import type { Config } from './schema'

export const BUILT_IN_SERVICES = ['microsoft', 'google-web', 'chrome-builtin'] as const
export type BuiltInService = (typeof BUILT_IN_SERVICES)[number]
export const isBuiltInService = (id: string): id is BuiltInService => (BUILT_IN_SERVICES as readonly string[]).includes(id)

export const SERVICE_ID_RE = /^svc-[a-z0-9]{8}$/

export const serviceSchema = z.object({
  id: z.string().regex(SERVICE_ID_RE),
  kind: z.literal('openai-compat'),
  name: z.string().min(1).max(40),
  baseURL: z.url(),
  /** Stored locally only; never in logs, cache keys or fixtures (CLAUDE.md rule 7) */
  apiKey: z.string(),
  model: z.string().min(1),
  thinking: z.enum(['enabled', 'disabled']).default('disabled'),
})
export type Service = z.infer<typeof serviceSchema>

const ID_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789'
export function newServiceId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  return `svc-${Array.from(bytes, b => ID_CHARS[b % ID_CHARS.length]).join('')}`
}

export function serviceOf(config: Pick<Config, 'services'>, id: string): Service | undefined {
  return config.services.find(s => s.id === id)
}
export const chosenService = (config: Pick<Config, 'services' | 'provider'>): Service | undefined => serviceOf(config, config.provider)
export const isLlmChosen = (config: Pick<Config, 'services' | 'provider'>): boolean => chosenService(config) !== undefined

/** As long as `serviceSchema.name` allows; a longer one would make the whole config invalid */
export const NAME_MAX = 40

/**
 * The service's default name: the model's last segment (`deepseek/deepseek-v4-flash` →
 * `deepseek-v4-flash`), clipped to what the schema accepts. A v11 model name had no length limit,
 * so an unclipped copy could migrate to an object zod rejects — and a rejected config falls back to
 * defaults, taking the reader's endpoint and key out of effect (Codex on #157)
 */
export const defaultServiceName = (model: string): string => (model.split('/').pop() || model).slice(0, NAME_MAX) || 'LLM'
