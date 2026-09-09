// Prompt file import/export. Corresponds to Read Frog components/prompt-configurator/utils/prompt-file.ts@9b44f82.
// Rewritten 2026-09-05: same file shape (an array of { name, systemPrompt, prompt } without ids), allowing cross-imports.
// Validated with zod; downloads use <a download> directly in extension pages instead of file-saver.
import { z } from 'zod'
import type { PromptTemplate } from './prompt-library'

export const PROMPT_FILE_NAME = 'arxiv-translate_prompts.json'

/** File entry: name and prompt are required as in Read Frog; systemPrompt defaults to empty for older files. */
export const promptFileEntrySchema = z.object({
  name: z.string().min(1),
  prompt: z.string().min(1),
  systemPrompt: z.string().default(''),
})
export const promptFileSchema = z.array(promptFileEntrySchema)
export type PromptFileEntry = z.infer<typeof promptFileEntrySchema>

const FORMAT_HINT = 'Invalid prompt file: expected an array of [{ "name", "systemPrompt", "prompt" }]; name and prompt are required'

export function parsePromptFile(json: string): PromptFileEntry[] {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    throw new Error(`${FORMAT_HINT} (invalid JSON)`)
  }
  const parsed = promptFileSchema.safeParse(raw)
  if (!parsed.success) throw new Error(FORMAT_HINT)
  return parsed.data
}

export async function readPromptFile(file: File): Promise<PromptFileEntry[]> {
  return parsePromptFile(await file.text())
}

/** Omit ids on export: the importer assigns new ones to avoid collisions between machines. */
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
