// Import / export of prompt files. The counterpart of Read Frog's components/prompt-configurator/utils/prompt-file.ts@9b44f82,
// rewritten 2026-09-05: the same file shape (an array of { name, systemPrompt, prompt } without ids, so the two can
// import each other's files), validated with zod, downloaded without file-saver (<a download> works in an extension page as it is).
import { z } from 'zod'
import type { PromptTemplate } from './prompt-library'

export const PROMPT_FILE_NAME = 'arxiv-translate_prompts.json'

/** One entry of the file: as in Read Frog, name and prompt are required and systemPrompt defaults to empty (its older files) */
export const promptFileEntrySchema = z.object({
  name: z.string().min(1),
  prompt: z.string().min(1),
  systemPrompt: z.string().default(''),
})
export const promptFileSchema = z.array(promptFileEntrySchema)
export type PromptFileEntry = z.infer<typeof promptFileEntrySchema>

/**
 * A parse failure reports **which kind** only, no sentence: the sentences live in the locale pack, and this module
 * knows no interface language (Codex on #161). `notJson` and `badShape` are two different things to a reader — not
 * JSON at all, or JSON in another format
 */
export type PromptFileError = 'notJson' | 'badShape'
export class PromptFileFormatError extends Error {
  constructor(readonly kind: PromptFileError) {
    super(kind)
    this.name = 'PromptFileFormatError'
  }
}

export function parsePromptFile(json: string): PromptFileEntry[] {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    throw new PromptFileFormatError('notJson')
  }
  const parsed = promptFileSchema.safeParse(raw)
  if (!parsed.success) throw new PromptFileFormatError('badShape')
  return parsed.data
}

export async function readPromptFile(file: File): Promise<PromptFileEntry[]> {
  return parsePromptFile(await file.text())
}

/** Exported without ids: the importer assigns fresh ones, so two machines' ids cannot collide */
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
