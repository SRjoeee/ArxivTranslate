// LLM prompt（DESIGN §8.2）。改动措辞就要升 PROMPT_VERSION——它进缓存键。
import type { TranslateRequest } from './types'

export const PROMPT_VERSION = '1'

export function systemPrompt(target: string): string {
  return [
    `You are translating an academic paper from English into ${target}.`,
    'Rules:',
    '1. The input is a JSON array of segments, each with an "id" and a "text". Return every segment with the same "id" and the translated "text", nothing else.',
    '2. Segments contain placeholder tags: void tags like <x id="3"/> stand for formulas, citations and references; paired tags like <t id="5">…</t> wrap styled text. Keep every tag exactly as written — same ids, same count, same nesting. Never add, drop, rename or translate a tag. Move tags only as far as word order requires.',
    '3. Keep author names, journal names, conference names, dataset names, code identifiers and URLs in the original language.',
    '4. Use precise academic terminology; prefer the terms given in the glossary when present.',
    '5. Output only a JSON object of exactly this shape, with the same ids and the same number of segments as the input: {"segments":[{"id":"<id>","text":"<translated text>"}]}. No markdown fences, no explanations, no extra keys.',
  ].join('\n')
}

export function userPrompt(request: TranslateRequest): string {
  const lines: string[] = []
  if (request.context?.paperTitle) lines.push(`Paper: ${request.context.paperTitle}`)
  if (request.context?.sectionTitle) lines.push(`Section: ${request.context.sectionTitle}`)
  if (request.context?.glossary?.length) {
    lines.push('Glossary:')
    for (const g of request.context.glossary) lines.push(`- ${g.term} → ${g.translation}`)
  }
  lines.push('Segments:')
  lines.push(JSON.stringify(request.segments))
  return lines.join('\n')
}
