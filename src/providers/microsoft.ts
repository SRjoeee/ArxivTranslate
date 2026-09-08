// 移植自 reference/read-frog/src/utils/host/translate/api/microsoft.ts@9b44f82（GPL-3.0），2026-09-08 移植、有修改。
// 端点、查询参数（含 `from=auto` 转空串）、裸字符串数组的请求体、`translations[0].text` 的响应解析
// 与逐条缺失检查照搬；对照过 reference/FluentRead/src/providers/translation/microsoft.ts，两者形状一致。
//
// 四处改造：
// 1. **去掉上游的 escapeText / escapeHtmlText**。两个上游都在适配器里转义，因为它们的管线不转义；
//    我们的 protector 已经转过了（markers 格式，#107），再转一次会把 `<` 发成 `&amp;lt;`。
//    与当初移植 google-web.ts 做的是同一个改造。附带差异：上游还转义 `"` `'`，我们不转——
//    标记对齐器盯的是 `<` 与 `&`，引号只在属性里有意义，而这条线是纯文本、不含标签。
// 2. 上游的 `textFormat === 'html'` 硬失败 → 我们用 `wireFormats: ['markers']` 在协商层挡住（§8.5）；
//    那句防御性抛错仍保留，协商万一漏了也不能把标签发进来。
// 3. 错误包成我们的 ProviderError 分类（上游抛裸 Error + meta），走共用的 kindOfStatus。
// 4. 批量、并发、速率按**我们自己实测的**微软响应特征定（见下），上游只有全局配置、没有 provider 专属值。
//
// 上游注释里那条关键知识：**端点每次请求都会跑 HTML 标记对齐器**，裸的 `<` 会融成伪标签
//（`a < b and c > d` → `<B和C> d`）。Read Frog 的 translation-output-normalization.ts 说得更直白：
// 「Google 和微软都把请求当 HTML 解析，所以适配器发送前转义、响应保持 HTML 编码，在这里只解码一次」。
// 我们的 protector 正是这个形状（serialize 转义、rehydrate / joinRuns 只解一次）。
import { toBcp47 } from '@/config/languages'
import { kindOfStatus } from './http-errors'
import { attachRequestErrorMeta } from './request/retry-policy'
import { ProviderError, type TranslateRequest, type TranslateResult, type TranslationProvider } from './types'
import { WIRE_FORMATS } from './wire-formats'

const ENDPOINT = 'https://edge.microsoft.com/translate/translatetext'

/**
 * 端点支持的目标语言（BCP-47）。取自它自己的公开语言表，2026-09-08：
 *
 *     curl 'https://api.cognitive.microsofttranslator.com/languages?api-version=3.0&scope=translation'
 *
 * 我们的 179 个目标语言里 108 个落在这张表内、71 个不在（RESEARCH §5.1）。上游两个项目都没有这层——
 * Read Frog 是 `ISO6393_TO_6391` 映射缺失就抛错，等于翻到一半才失败。
 */
const SUPPORTED = new Set(`
  af am ar as az ba be bg bho bn bo brx bs ca cs cy da de doi dsb dv el en es es-MX et eu fa fi fil
  fj fo fr fr-CA ga gl gom gu ha he hi hne hr hsb ht hu hy id ig ikt is it iu iu-Latn ja ka kk km kmr
  kn ko ks ku ky lb ln lo lt lug lv lzh mai mg mi mk ml mn-Cyrl mn-Mong mni mr ms mt mww my nb ne nl
  nso nya or otq pa pl prs ps pt pt-PT ro ru run rw sd si sk sl sm sn so sq sr-Cyrl sr-Latn st sv sw
  ta te th ti tk tlh-Latn tlh-Piqd tn to tr tt ty ug uk ur uz vi xh yo yua yue zh-Hans zh-Hant zu
`.trim().split(/\s+/))

/**
 * 我们的目标语言（经 `toBcp47`）→ **实际发给端点的标签**。不在这张表里的原样发。
 *
 * 两件事一起解决：公开表里没有的裸标签（`zh` / `sr` / `mn`），以及**端点自己的默认归一与我们的
 * 语言含义不符**的情况。后者是真 bug：`toBcp47('srp')` 给出 `sr`，端点把它归一成 **`sr-Latn`**（拉丁文），
 * 而我们的 `srp` 在 `languages.ts` 里写的是 **Serbian (Cyrillic)** ——等于悄悄换了文字，与 `zlm → ms-Arab`
 * 同一类（Codex 在 #115 指出）。显式发 `sr-Cyrl` 就不再依赖端点怎么默认。
 *
 * 逐条实测（2026-09-09）：`sr-Cyrl` → Неуронске…（西里尔）、`sr` → Neuronske…（拉丁）、
 * `mn-Cyrl` / `zh-Hans` / `zh-Hant` 均 200 且文字正确。
 */
const REWRITE: Record<string, string> = {
  zh: 'zh-Hans',      // toBcp47('cmn')，我们的默认目标
  'zh-TW': 'zh-Hant', // toBcp47('cmn-Hant')
  mn: 'mn-Cyrl',      // 现代蒙古语的通行文字；裸 mn 也是归到这里，显式写出来不依赖默认
  sr: 'sr-Cyrl',      // ← 裸 sr 会被归成拉丁文，与我们的语言含义相反
  ny: 'nya',          // ↓ 这两个反过来：端点用三字母码，`toBcp47` 却缩成两字母，缩完反而不在表里
  lg: 'lug',
}

/**
 * 端点交付不了我们所标注的**文字**的目标语言。这三个在 `languages.ts` 里写的是「(Cyrillic)」，
 * 但端点表里没有对应的西里尔变体，`toBcp47` 给出的 `bs` / `uz` / `az` 实测都返回拉丁字母
 * （`languages.ts` 的 BCP47_OVERRIDES 注释里记着这次实测）。发出去会**静默换掉文字**，
 * 所以判为不支持、走降级——与 `zlm → ms-Arab` 因不在表里而判false 是同一个道理，只是这里
 * 两字母码碰巧落在表内，得显式挡一次（Codex 在 #115 指出）。
 */
const SCRIPT_UNAVAILABLE = new Set(['bos', 'uzn', 'azj'])

/** 实际发给端点的目标语言标签 */
function wireTarget(target: string): string {
  const tag = toBcp47(target)
  return REWRITE[tag] ?? tag
}

/**
 * 这个目标语言能不能翻。重写之后一律落在公开表的真实条目上，所以判定就是一句「在不在表里」——
 * 不做任何按主语言的推断（第一版那么写，把 `zlm → ms-Arab` 判成了支持，而它实测 400）。
 */
export function supportsTarget(target: string): boolean {
  if (SCRIPT_UNAVAILABLE.has(target)) return false
  return SUPPORTED.has(wireTarget(target))
}

export interface MicrosoftDeps {
  fetch?: typeof globalThis.fetch
}

interface MicrosoftItem {
  translations?: { text?: string }[]
}

async function translateTexts(texts: string[], from: string, to: string, deps: MicrosoftDeps, signal?: AbortSignal): Promise<string[]> {
  const doFetch = deps.fetch ?? globalThis.fetch
  // 上游的处理：auto 表示让端点自己检测，参数留空。**我们这边目前到不了**——`TranslateRequest.source`
  // 是字面量 `'en'`（arXiv 固定英文）。按 CLAUDE.md「没有额外负担的部分随模块一起搬」保留，
  // 源语言将来放宽时就是现成的
  const query = new URLSearchParams({ from: from === 'auto' ? '' : from, to, isEnterpriseClient: 'false' })
  let response: Response
  try {
    response = await doFetch(`${ENDPOINT}?${query}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(texts),
      signal,
    })
  } catch (error) {
    if (signal?.aborted) throw new ProviderError('aborted', '请求已取消', { cause: error })
    throw attachRequestErrorMeta(
      new ProviderError('network', `网络错误：${error instanceof Error ? error.message : String(error)}`, { cause: error }),
      { kind: 'network', isRetryable: true },
    )
  }

  // 必须先于 json()：超限时它返回的是**纯文本** `Request exceeds the maximum allowed translation size.`，
  // 直接 JSON.parse 会抛成 invalid-response，掩盖掉真正的 400（RESEARCH §5.1）
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw attachRequestErrorMeta(
      new ProviderError(kindOfStatus(response.status), `translatetext ${response.status} ${response.statusText}${detail ? `：${detail.slice(0, 200)}` : ''}`),
      { statusCode: response.status, responseHeaders: response.headers },
    )
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch (error) {
    // 整个响应就不是 JSON：拆小批次重来也是一样的结果（§8.3）
    throw new ProviderError('invalid-response', 'translatetext 返回的不是 JSON', { cause: error, isolatable: false })
  }

  if (!Array.isArray(payload)) {
    throw new ProviderError('invalid-response', `translatetext 响应格式异常：${JSON.stringify(payload).slice(0, 200)}`, { isolatable: false })
  }
  if (payload.length !== texts.length) {
    throw new ProviderError('invalid-response', `translatetext 返回 ${payload.length} 条，期望 ${texts.length} 条`)
  }
  return payload.map((item: MicrosoftItem, i) => {
    const text = item?.translations?.[0]?.text
    if (typeof text !== 'string') throw new ProviderError('invalid-response', `translatetext 第 ${i + 1} 条缺少译文`)
    return text
  })
}

/**
 * 微软 Edge 的免费翻译端点。视为随时会断（DESIGN §8.3）：错误独立分类，失败可回退到别的 provider。
 *
 * **只保得住纯文本记号**：实测标签格式在它上面 0%（400 个占位符全丢，属性引号被转成全角、开标签被撕成
 * 裸文本），记号格式 98%（RESEARCH §5.1），所以 `wireFormats` 只有 `markers`。
 */
export function createMicrosoftProvider(targetLanguage: string, deps: MicrosoftDeps = {}): TranslationProvider {
  return {
    id: 'microsoft',
    displayName: '微软翻译（免费）',
    kind: 'mt',
    wireFormats: WIRE_FORMATS.microsoft,
    /**
     * 批量与并发按**微软自己的**响应特征定，不照抄 google-web（那组值是按 Google 63 ms 的响应调出来的，
     * 抄过来会犯 google-web.ts 注释里记着的同一个错）。2026-09-08 实测，每个请求内容唯一以排除服务端缓存：
     *
     *   批量 414 字符 → 319 ms ｜ 2047 → 589 ms ｜ 8125 → **1516 ms**（延迟随批量线性涨）
     *   并发 1 → 6.8k 字符/s ｜ 4 → 13.5k ｜ 8 → **23k**，墙钟仍是 ~700 ms，30 连发无 429
     *
     * 结论是**小批量 + 高并发**：吞吐由并发提供，批量只决定首屏要等多久。取 8000 会让首屏等 1.5 秒，
     * 而吞吐并不因此更好。硬上限是每请求 50,000 字符（超了返回纯文本 400），2000 留了 25 倍余量。
     */
    maxBatchChars: 2000,
    // 字数先到上限（2000 字符约 15 条），这个值只是不封顶的安全阀
    maxBatchItems: 100,
    maxConcurrent: 8,
    // 实测没有限流；速率只当突发的安全闸——并发 8、单发约 600 ms，自然吞吐约 13/s，20/s 碰不到
    rateLimit: { rate: 20, capacity: 8 },
    async isAvailable() {
      // 免费端点不需要凭据，但**它不是每种语言都翻**：不支持的目标语言会 400。
      // 在这里报不可用，链就会自动跳过它（与 chrome-builtin 没下语言包时同一个机制）
      return supportsTarget(targetLanguage)
    },
    async translate(request: TranslateRequest): Promise<TranslateResult> {
      if (request.segments.length === 0) return { segments: [], provider: 'microsoft' }
      // 目标语言不支持时**本地就退出**，不去问端点。`buildChain` 会把不可用的首选留在链首
      // （popup 要据此提示），而 `fallback.ts` 挑步骤时看的是降级记录、不是 `isAvailable()`——
      // 于是第一批请求仍会发出去换回 400，并发下甚至是好几发（Codex 在 #115 指出）
      if (!supportsTarget(request.target)) {
        throw new ProviderError('bad-request', `微软翻译不支持目标语言 ${request.target}`, { isolatable: false })
      }
      const texts = request.segments.map(segment => segment.text)
      // 协商层已经保证送进来的是 markers（纯文本）。万一漏了也不能把标签发出去：
      // 端点没有 markup 模式，会按目标语言各异的方式把标签毁掉，事后无法还原（上游 Read Frog 的原话）
      if (texts.some(text => /<[a-z/]/i.test(text))) {
        throw new ProviderError('bad-request', '微软端点不接受标签格式的占位符，只能走 markers', { isolatable: false })
      }
      const translated = await translateTexts(texts, request.source, wireTarget(request.target), deps, request.signal)
      return {
        segments: request.segments.map((segment, i) => ({ id: segment.id, text: translated[i]! })),
        provider: 'microsoft',
      }
    },
  }
}
