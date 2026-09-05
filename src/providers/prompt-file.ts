// 提示词文件的导入 / 导出。功能对应 Read Frog components/prompt-configurator/utils/prompt-file.ts@9b44f82，
// 2026-09-05 重写：文件形状相同（不带 id 的 { name, systemPrompt, prompt } 数组，所以两边的文件可以互相导入），
// 校验用 zod、下载不用 file-saver（扩展页面里 <a download> 直接可用）。
import { z } from 'zod'
import type { PromptTemplate } from './prompt-library'

export const PROMPT_FILE_NAME = 'arxiv-translate_prompts.json'

/** 文件里的一条：与 Read Frog 一样 name 与 prompt 必填，systemPrompt 缺省为空（兼容它的旧文件） */
export const promptFileEntrySchema = z.object({
  name: z.string().min(1),
  prompt: z.string().min(1),
  systemPrompt: z.string().default(''),
})
export const promptFileSchema = z.array(promptFileEntrySchema)
export type PromptFileEntry = z.infer<typeof promptFileEntrySchema>

const FORMAT_HINT = '提示词文件格式不对：应是 [{ "name", "systemPrompt", "prompt" }] 数组，name 与 prompt 必填'

export function parsePromptFile(json: string): PromptFileEntry[] {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    throw new Error(`${FORMAT_HINT}（不是合法 JSON）`)
  }
  const parsed = promptFileSchema.safeParse(raw)
  if (!parsed.success) throw new Error(FORMAT_HINT)
  return parsed.data
}

export async function readPromptFile(file: File): Promise<PromptFileEntry[]> {
  return parsePromptFile(await file.text())
}

/** 导出时去掉 id：导入方会重新分配，避免两台机器的 id 撞上 */
export function serializePrompts(patterns: PromptTemplate[]): string {
  return JSON.stringify(patterns.map(({ id: _id, ...entry }) => entry), null, 2)
}

export function downloadPromptFile(patterns: PromptTemplate[], doc: Document = document): void {
  const blob = new Blob([serializePrompts(patterns)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = doc.createElement('a')
  a.href = url
  a.download = PROMPT_FILE_NAME
  doc.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
