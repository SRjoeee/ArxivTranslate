// The renderer's names (ADR-0003): every `data-axt-*` attribute, every injected sub-class that more than one module
// reads, and the one definition of the translation boundary. A leaf on purpose — it imports nothing from the
// renderer, so any module can read a name without joining a cycle. The injected *node* classes
// (`axt-t`, `axt-img`, `axt-hl`, `axt-peek`) stay in `core/marks.ts`, which the extractor and the
// protector need without depending on the renderer.

export type Mode = 'stack' | 'side' | 'only'
export type BlockState = 'pending' | 'translated' | 'failed'

export const FOR_ATTR = 'data-axt-for'
export const STATE_ATTR = 'data-axt-state'
export const ON_ATTR = 'data-axt-on'
export const MODE_ATTR = 'data-axt-mode'
/** 短标题同行（§7.3）：原标题与译文都带此属性 */
export const INLINE_ATTR = 'data-axt-inline'
/** 译文语言（BCP-47），由 enable 写在 <html> 上供 renderText 读取 */
export const LANG_ATTR = 'data-axt-lang'
/**
 * 译文的书写方向，只在从右往左的目标语言下出现在 `<html>` 上（§7.1：全局状态只在这里）。
 * `renderText` 逐个抄到译文节点的 `dir` 上——**只写 `lang` 不够**：双向算法看的是 `dir`，
 * 而 arXiv 的 `<html>` 是 ltr，继承下来的阿拉伯语译文里句号会跑到词前面、整段还靠左（实测）
 */
export const DIR_ATTR = 'data-axt-dir'
/**
 * 「译文与原文逐字相同」的标记（Codex 在 #74 指出）。默认提示词里那条
 * 「Keep author names, journal names, conference names … in the original language」
 * 会让纯人名的引文作者段原样返回，`renderText` 又无条件插入兄弟节点——
 * stack 模式下每一行作者就出现两遍。这不限于人名：任何译文等于原文的块都一样。
 * 标出来交给 CSS：stack 藏掉重复的那份，side 要靠它撑住右栏、only 原块本来就隐藏，都保留
 */
export const IDENTITY_ATTR = 'data-axt-identity'
/**
 * 表翻了一半（§5.3）：原表仍是 translated（only 模式照常只显示克隆），另加此标记画失败提示线、计入失败数。
 * 不能直接标 failed——only 模式只隐藏 translated，原表与半份克隆会一起露出来（Codex 在 #30 指出）
 */
export const PARTIAL_ATTR = 'data-axt-partial'
/** 注入的 <style> 的标记属性；恢复原文时按它整体移除。曾叫 data-axt，不合硬规则 5 的 data-axt- 前缀（Codex 在 #3 指出） */
export const STYLE_ATTR = 'data-axt-sheet'
/** The active style profile's underline on <html> (§7.5), absent when it has none */
export const UNDERLINE_ATTR = 'data-axt-underline'
/** Present on <html> when the active profile blurs the translation until it is hovered (§7.5) */
export const BLUR_ATTR = 'data-axt-blur'

/** 等待态节点（§7.6）：原块后面的骨架屏，带 axt-t 与这个 class */
export const PENDING_CLASS = 'axt-pending'
/** 失败态小部件（§7.6）：重试按钮与原因，带 axt-t 与这个 class */
export const ERROR_CLASS = 'axt-error'
/** side 模式右栏的镜像（§7.2）：原文的克隆，带 axt-t 与这个 class */
export const MIRROR_CLASS = 'axt-mirror'
/** side 模式拆图的副本（§7.2）：整张插图的克隆，带 axt-t 与这个 class */
export const SPLIT_CLASS = 'axt-split'
/** 原件上的标记：这张图已经拆出副本 */
export const SPLIT_ATTR = 'data-axt-split'
/** 副本里的元素记住自己对应原件的 id（副本剥掉了 id，锚点与叠加层清理按它找回来） */
export const SPLIT_OF_ATTR = 'data-axt-split-of'
/** 副本里的图片叠加层记住自己属于哪张图（副本剥掉了 data-axt-for） */
export const SPLIT_FOR_ATTR = 'data-axt-split-for'

/**
 * The classes an `.axt-t` node can carry that make it **not** a translation: the skeleton, the
 * failure widget, side mode's mirror and its split-figure copy. Everything that asks "is this a
 * real translation?" — the appearance rules, the split signature, the anchor fallback, the style
 * sheets — derives its answer from this list, so it cannot drift again (issue #46 was one drift).
 * `tests/renderer/translation-boundary.test.ts` holds the CSS to it.
 */
export const TRANSLATION_EXCLUDED_CLASSES: readonly string[] = [PENDING_CLASS, ERROR_CLASS, MIRROR_CLASS, SPLIT_CLASS]

/** `.axt-t:not(.axt-pending, .axt-error, .axt-mirror, .axt-split)` — a real translation node */
export const REAL_TRANSLATION = `.axt-t:not(${TRANSLATION_EXCLUDED_CLASSES.map(c => `.${c}`).join(', ')})`
