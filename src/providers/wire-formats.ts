// 每个引擎认哪些线上格式（DESIGN §8.5）。**纯数据，不 import 任何引擎实现**——
// 设置页只为「样本用标签还是记号」这一个判断，就不该把整个 AI SDK 拖进它的包里
// （实测：从这里读是 43 kB，改成 `getProvider(config).wireFormats` 是 276 kB；Codex 在 #115 指出）。
//
// 这里是**唯一事实来源**，各引擎的工厂反过来读它，不再各自写字面量，所以不会漂移。
import type { WireFormat } from '@/core/protector'
import { type BuiltInService, isBuiltInService } from '@/config/services'

export const WIRE_FORMATS: Record<BuiltInService | 'openai-compat', readonly WireFormat[]> = {
  'openai-compat': ['tags'],
  'google-web': ['tags', 'markers'],
  'chrome-builtin': ['tags'],
  microsoft: ['markers'],
}

/** 这个引擎发出去的第一选择格式；协商由 `buildChain` 做，这里只回答「首选是什么」 */
/** A reader's service id (svc-…) is the OpenAI-compatible kind; built-ins by their id */
export const wireFormatOfProvider = (provider: string): WireFormat => WIRE_FORMATS[isBuiltInService(provider) ? provider : 'openai-compat'][0] ?? 'tags'
