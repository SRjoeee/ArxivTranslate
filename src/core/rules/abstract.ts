// Selectors of the arXiv abstract page (`arxiv.org/abs/*`). The rules module of §5 says which content of the HTML
// full text is translated; this is another page and another matter: recognising “where the HTML version is”, so the
// bilingual entry can be placed beside it (issue #146).
//
// Kept apart from latexml.ts: that file exports RULES_VERSION, which enters the cache key, and a changed abstract-page
// selector must not invalidate the whole site's cache.

/**
 * The link on the abstract page that points at the HTML full text.
 *
 * By arXiv's own id rather than guessing from the href: the id is set when arXiv renders “HTML (experimental)”, and
 * the version in the href (`.../html/1706.03762v7`) comes from it too — a URL assembled here would point at the
 * wrong version when there are several. **A paper without an HTML version has no such element at all**, and then
 * nothing is inserted.
 */
export const HTML_LINK = '#latexml-download-link'

