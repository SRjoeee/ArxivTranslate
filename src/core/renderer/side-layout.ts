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
export const SIDE_DENY = [
  '.axt-t',                                            // 译文自身不是容器
  'table', 'thead', 'tbody', 'tr', 'td', 'th',         // 表格内部结构，改成网格会毁掉表格
  '.ltx_inline-block', '.ltx_note', '.ltx_listing',    // 行内与预格式化上下文
  '.ltx_p', '.ltx_title', '.ltx_caption', '.ltx_bibblock', // 配对成员本身，内部的译文是脚注那种嵌套
  '.ltx_flex_figure', '.ltx_flex_cell',                // 多面板插图：ar5iv 用 flex 让面板并排
].join(', ')

/** 会被 CSS 设成两栏网格的元素 */
export const SIDE_CONTAINER = `:has(.axt-t):not(:is(${SIDE_DENY}))`
