// 哪些块该切句、切在哪（§8.6，issue #105）。
//
// **切点在这一层算，不在服务层。** 服务层只有线上文本，而选切点要看块本身：
// `sentenceCuts` 需要一个从占位符槽位建出来的 `SplitContext` 才分得清「注解」与「公式」——
// 句末的句点可能藏在数学节点里，`\citet` 占位符本身是句子的主语——而它实测的精度明确不含
// 参考文献块，模块文档写着调用方不得在那里运行它（Codex 在 #137 两条都指出了）。
//
// 服务层拿着切点去插标记，仅此而已。

import type { Segment } from './batches'
import { ANNOTATION_SELECTOR } from '@/core/rules/latexml'
import { sentenceCuts, visibleTextOf } from '@/core/sentences'
import { wireFormatOf, type RenderPath } from '@/cache/key'

/**
 * 参考文献单元。切句器在这里没有精度保证——期刊缩写（`Sci. Rep. 14 (2024)`、
 * `Theor. Comput. Sci.`）会切出假边界，而假边界把高亮打在半句上，比没有高亮更糟。
 */
const NO_SENTENCES = new Set(['bibblock', 'bibitem'])

/**
 * 这一段的句子边界。
 *
 * **空数组与 undefined 不是一回事**：空数组表示「这一块该对齐，但它只有一句」——整段对整段
 * 就是安全的对齐，不需要任何标记，而单句块占正文一大半；undefined 表示「这一块不该对齐」，
 * 参考文献与非 `tags` 的路径属于后者（Codex 在 #137 指出我把两者混为一谈了）。
 *
 * `runs` 与 `markers` 两条路不切：前者送的是切碎的纯文本段、拼回去不产出线上偏移，
 * 后者线上没有活得下来的标记。
 */
export function cutsOf(segment: Segment, renderPath: RenderPath): number[] | undefined {
  if (renderPath !== 'tags') return undefined
  if (segment.block.kind === 'text' && NO_SENTENCES.has(segment.block.unit)) return undefined
  const slots = segment.protected.slots
  const cuts = sentenceCuts(segment.protected.text, wireFormatOf(renderPath), {
    isAnnotation: id => {
      const node = slots.get(id)
      return node?.nodeType === 1 && (node as Element).matches(ANNOTATION_SELECTOR)
    },
    textOf: id => {
      const node = slots.get(id)
      return node ? visibleTextOf(node) : undefined
    },
  })
  return cuts
}
