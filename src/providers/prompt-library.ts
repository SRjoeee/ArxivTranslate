// 移植自 reference/read-frog/src/utils/constants/prompt.ts 与 src/utils/prompts/translate.ts@9b44f82（GPL-3.0），有修改：
// 模板变量换成论文语义（paperTitle / abstract / sectionTitle / glossary），网页摘要改为直接用论文 abstract，
// 去掉字幕与文本分隔符式的批处理。批处理协议不在这里——见 prompt.ts 的协议块，它追加在任何提示词之后。
//
// 结构照搬：模板变量 {{token}} + 内置提示词表 + 用户自定义（patterns）+ 按 promptId 选择、找不到回退 default。

export const PROMPT_TOKENS = ['targetLanguage', 'input', 'paperTitle', 'abstract', 'sectionTitle', 'glossary'] as const
export type PromptToken = (typeof PROMPT_TOKENS)[number]

export const getTokenCellText = (token: PromptToken): string => `{{${token}}}`
const T = Object.fromEntries(PROMPT_TOKENS.map(t => [t, getTokenCellText(t)])) as Record<PromptToken, string>

export const DEFAULT_PROMPT_ID = 'default'
export const PRECISION_REWRITE_PROMPT_ID = 'precision-rewrite'

/** 论文元数据块：Read Frog 的 "Document Metadata" 换成论文字段 */
const METADATA_BLOCK = `## Document Metadata for Context Awareness
Paper title: ${T.paperTitle}
Abstract: ${T.abstract}
Current section: ${T.sectionTitle}
Glossary: ${T.glossary}`

export const DEFAULT_SYSTEM_PROMPT = `You are a professional ${T.targetLanguage} native translator who needs to fluently translate an academic paper into ${T.targetLanguage}.

## Translation Rules
1. Output only the translated content, without explanations or additional content (such as "Here's the translation:" or "Translation as follows:").
2. The returned translation must maintain exactly the same structure and format as the original text.
3. Use precise, established academic terminology. Keep author names, journal names, conference names, dataset names, code identifiers and URLs in the original language.
4. Use the document metadata below only to improve contextual and terminological accuracy. Never mention it in the output.

${METADATA_BLOCK}`

export const DEFAULT_USER_PROMPT = `Translate to ${T.targetLanguage}:

${T.input}`

export const PRECISION_REWRITE_SYSTEM_PROMPT = `# Role: Elite Translator and Rewriting Expert
You are a ${T.targetLanguage} native expert who masters the philosophy of "Translation as Rewriting." Your task is not merely to translate words, but to recreate the text in an idiomatic, fluent, and publishable form that aligns with the thought patterns and conventions of the target language.

## Core Strategies
1. **Meaning over Form**: Deeply understand the original logic. Break free from the source language's syntactic constraints. Reconstruct the content using sentence structure and word order that feel natural in ${T.targetLanguage}.
2. **Eradicate Translationese**: Proactively avoid overuse of passive voice, redundant conjunctions, and stacked abstract nouns. The result should read as naturally as a native composition.
3. **Handle Terminology Precisely**: Use established, authoritative translations for academic and technical terms. If no established translation exists, retain the original term without adding an explanation. Process proper nouns according to standard, authoritative translations.
4. **Preserve Format and Untranslatables**: Fully retain the original paragraph structure, headings, lists, placeholders, code, URLs, proper nouns, and other content that should not be translated.

## Output Rules
1. **Output Translation Only**: Provide only the final translated result. Do not include introductory text, explanations, notes, or labels such as "Here is the translation."
2. **Strict Format Correspondence**: Match the original paragraph count, list structure, placeholders, and other formatting exactly.
3. **Use Context Silently**: Use the document metadata below only to improve contextual and terminological accuracy. Never mention it in the output.

## Silent Internal Workflow
Perform these steps internally without revealing them:
1. Comprehend the source and produce a fluent internal draft.
2. Silently review that draft for mistranslations, omissions, translationese, formatting errors, and inaccurate terminology.
3. Correct every issue and output only the polished final translation.

Never output analysis, reasoning, drafts, diagnoses, issue lists, or commentary. Output only the final translation.

${METADATA_BLOCK}`

export const PRECISION_REWRITE_USER_PROMPT = DEFAULT_USER_PROMPT

export interface PromptTemplate {
  id: string
  name: string
  systemPrompt: string
  prompt: string
}

export const BUILT_IN_PROMPTS: Readonly<Record<string, PromptTemplate>> = {
  [DEFAULT_PROMPT_ID]: { id: DEFAULT_PROMPT_ID, name: 'Default', systemPrompt: DEFAULT_SYSTEM_PROMPT, prompt: DEFAULT_USER_PROMPT },
  [PRECISION_REWRITE_PROMPT_ID]: {
    id: PRECISION_REWRITE_PROMPT_ID,
    name: 'Precision rewrite',
    systemPrompt: PRECISION_REWRITE_SYSTEM_PROMPT,
    prompt: PRECISION_REWRITE_USER_PROMPT,
  },
}

export const BUILT_IN_PROMPT_IDS = Object.keys(BUILT_IN_PROMPTS)

/** 存进配置的形状：当前选用的 id + 用户自定义的提示词 */
export interface PromptsConfig {
  promptId: string
  patterns: PromptTemplate[]
}

export const DEFAULT_PROMPTS_CONFIG: PromptsConfig = { promptId: DEFAULT_PROMPT_ID, patterns: [] }

export function resolvePromptReplacementValue(value: string | null | undefined, fallback: string): string {
  return typeof value === 'string' && value.trim() !== '' ? value : fallback
}

/** 内置优先，其次自定义，都找不到回退 default（与 Read Frog 一致） */
export function selectPrompt(config: PromptsConfig = DEFAULT_PROMPTS_CONFIG): PromptTemplate {
  const id = config.promptId || DEFAULT_PROMPT_ID
  return BUILT_IN_PROMPTS[id] ?? config.patterns.find(p => p.id === id) ?? BUILT_IN_PROMPTS[DEFAULT_PROMPT_ID]!
}

export function renderTemplate(text: string, values: Record<PromptToken, string>): string {
  let out = text
  for (const token of PROMPT_TOKENS) out = out.replaceAll(getTokenCellText(token), values[token])
  return out
}

function djb2(text: string): string {
  let hash = 5381
  for (const ch of text) hash = ((hash * 33) ^ ch.charCodeAt(0)) >>> 0
  return hash.toString(36)
}

/**
 * 提示词指纹，进缓存键：换了提示词就不能再命中旧译文。
 * 内置的用 id（措辞变化由 PROMPT_VERSION 兜底），自定义的按文本算。
 */
export function promptKey(config: PromptsConfig = DEFAULT_PROMPTS_CONFIG): string {
  const template = selectPrompt(config)
  if (BUILT_IN_PROMPTS[template.id]) return template.id
  return `custom:${djb2(`${template.systemPrompt} ${template.prompt}`)}`
}
