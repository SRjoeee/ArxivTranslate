// side 模式的结构判定（DESIGN §7.2）。这里是唯一事实来源，modes.css 里的同名清单由测试守着。
//
// 参与配对的容器 = 内部含有译文的元素，减去下面这一小撮。
// flex 是可以排除的：后代要 subgrid 得先是网格项，父级是 flex 就够不着外面的轨道。
// 但排除之后必须给格内的配对写降级规则（见 modes.css 的堆叠区），否则它们会各自长出隐式两列。
//
// 排除项只能是**本身不是网格**的元素：排除一个网格祖先并不能阻止它的后代去 subgrid 那个外来网格，
// 后代会落进别人的轨道里（实测 2609.00097：有序列表里的段落被塞进 ar5iv 编号网格的 12px 轨道，
// 英文横跨分割线、中文挤成 39px 的窄条）。ar5iv 自己的网格（.ltx_enumerate / .ltx_biblist 等）
// 必须由我们接管而不是排除。
/**
 * 多面板的 flex 图：有任何一个格子不是整栏（ltx_flex_size_1）的 .ltx_flex_figure。
 * 只有这种才排除，而且是**整棵子树**排除（面板并排靠 ar5iv 的 flex，里面的配对自然上下堆叠、不生成镜像）；
 * 所有格子都是 size_1 的单列 flex 图（常见于表格 + 脚注，实测 2609.03768v1 的 Table 1）格子整栏宽，
 * 按普通容器接管，表格与脚注左右配对。以前按类名整类排除，单列的也被堆叠规则误伤成上下排。
 * happy-dom 对 `:not(:is(带 :has 的复杂选择器))` 判定有误，所以这条走 closest()，与其他子树排除一样
 */
export const MULTI_PANEL_FLEX = '.ltx_flex_figure:has(> .ltx_flex_cell:not(.ltx_flex_size_1))'

export const SIDE_DENY = [
  '.axt-t',                                            // 译文自身不是容器
  'table', 'thead', 'tbody', 'tr', 'td', 'th',         // 表格内部结构，改成网格会毁掉表格
  '.ltx_inline-block', '.ltx_note', '.ltx_listing',    // 行内与预格式化上下文
  '.ltx_p', '.ltx_title', '.ltx_caption', '.ltx_bibblock', // 配对成员本身，内部的译文是脚注那种嵌套
].join(', ')

/**
 * 连**整棵子树**一起排除的元素。ar5iv 把脚注的折叠状态写在 `.ltx_note_outer` 的 `display: none` 上，
 * 译文一插进脚注内部，容器规则就会命中 `:has(.axt-t)` 把它改成 `display: grid`——
 * 折叠的脚注被掀开，165px 高、781px 宽横在正文中间，与中栏的译文互相干扰（实测 2312.17141，用户反馈）。
 *
 * 样式表里写成 `.ltx_note *` 加进排除清单；这里不并进 SIDE_CONTAINER，因为 happy-dom 的
 * `:is(.ltx_note *)` 恒为 false（原生 `.ltx_note *` 正常），并进去会让测试与线上行为不一致。
 * 运行时改用 isSideContainer() 判定。
 */
export const SIDE_DENY_SUBTREE = [
  '.ltx_note', // 脚注（上面那段）
  // 整块拆开的插图：两份都不参与配对网格，内部一律交给 ar5iv 自己排（DESIGN §7.2）
  '[data-axt-split]', '.axt-split',
  MULTI_PANEL_FLEX, // 多面板插图（上面那段）
].join(', ')

/**
 * 会被 CSS 设成两栏网格的元素：内部含有译文**或块标记**的元素（减去排除项）。
 * 块标记在会话一开始就打上（§10），整页一次性变两栏、之后不再横向跳动；只认译文的话，
 * 懒加载下预翻译距离之外的块一直通栏、进入边距才缩到左栏（用户反馈，2026-09-05 修订）
 */
export const SIDE_CONTAINER = `:has(.axt-t, [data-axt-id]):not(:is(${SIDE_DENY}))`

/** 是不是配对容器（含子树排除）。运行时一律走这里，别直接 matches(SIDE_CONTAINER) */
export function isSideContainer(el: Element): boolean {
  return el.matches(SIDE_CONTAINER) && el.closest(SIDE_DENY_SUBTREE) === null
}

/**
 * 镜像用的容器判定：译文**还没到**、但块已经标记（data-axt-id）的元素也算。
 * 公式与插图本来就没有译文，等它们所在段落的译文到达才镜像，只是白等——
 * 实测 2312.17141 全部 413 个镜像在翻译结束那一刻才一起出现，之前公式一直居中横跨两栏。
 * 块标记在翻译开始的第一刻就写好，所以第一趟 side prep 就能把它们镜像完。
 * 安全边界不变：带块标记或内部含块的子元素仍然不镜像（mirror.ts 的闸 2），整块复制的事故不会重演。
 */
export const MIRROR_CONTAINER = SIDE_CONTAINER

export function isMirrorContainer(el: Element): boolean {
  return el.matches(MIRROR_CONTAINER) && el.closest(SIDE_DENY_SUBTREE) === null
}

// 堆叠区：这些格子里不做左右分栏，配对降级为上下堆叠（modes.css 里有同一份清单，测试守着）。
// 既然没有右栏，里面就**不能生成镜像**——镜像本来是为了"右栏别空着"，
// 在堆叠区只会变成同一列里上下两份（实测 2312.17141 的三面板图：每个面板的公式重复了一遍）。
// 多面板 flex 图不在这里：它整棵子树都不是容器（SIDE_DENY_SUBTREE），里面的配对本来就是块级上下排，镜像也进不去
export const SIDE_STACK = [
  '.ltx_td', '.ltx_inline-block', // 段内嵌套的容器
].join(', ')
