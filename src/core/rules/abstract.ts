// arXiv 摘要页（`arxiv.org/abs/*`）的选择器。§5 的规则模块讲的是「HTML 全文里哪些内容要翻译」，
// 这里是另一个页面、另一件事：只要认出「HTML 版在哪」，好把双语入口插在它旁边（issue #146）。
//
// 与 latexml.ts 分开：那个文件导出 RULES_VERSION，进缓存键；摘要页的选择器改了不该让全站缓存失效。

/**
 * 摘要页上指向 HTML 全文的那个链接。
 *
 * 用 arXiv 自己的 id 而不是按 href 猜：这个 id 是它渲染「HTML (experimental)」时打的，
 * href 里的版本号（`.../html/1706.03762v7`）也由它给出——自己拼 URL 会在有多个版本时指错版本。
 * **没有 HTML 版的论文根本没有这个元素**，那时什么都不插。
 */
export const HTML_LINK = '#latexml-download-link'

/** 「Access Paper」那一栏的链接列表，插入点的父容器 */
export const ACCESS_LIST = '.full-text ul'
