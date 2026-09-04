
> arxiv-html-translator@0.0.0 fixtures:stats /Users/cheongzhiyan/Developer/ArxivTranslate
> tsx scripts/fixtures-stats.ts

## 规则覆盖率审计（RULES_VERSION 0.3.0，11 篇，112320 个文本节点）

### 每篇概览

| fixture | 解析 ms | 文本节点 | unit | protected | skipped | uncovered |
| --- | --- | --- | --- | --- | --- | --- |
| 2312.17141 | 219 | 18375 | 15.5% | 48.2% | 36.3% | 0 (0.0%) |
| 2312.17527 | 54 | 4294 | 17.1% | 52.9% | 29.9% | 0 (0.0%) |
| 2401.00418 | 178 | 20524 | 13.4% | 80.9% | 5.7% | 0 (0.0%) |
| 2401.00596 | 52 | 4044 | 26.6% | 68.2% | 5.1% | 0 (0.0%) |
| 2410.00260 | 39 | 1750 | 30.8% | 41.9% | 27.3% | 0 (0.0%) |
| 2507.00150 | 47 | 3551 | 39.8% | 57.2% | 2.9% | 0 (0.0%) |
| 2608.29808 | 182 | 5891 | 48.4% | 19.0% | 32.5% | 0 (0.0%) |
| 2608.30667 | 4 | 4 | 50.0% | 25.0% | 25.0% | 0 (0.0%) |
| 2609.00245 | 410 | 37556 | 9.2% | 56.2% | 34.6% | 0 (0.0%) |
| 2609.00246 | 252 | 16279 | 23.4% | 37.1% | 39.5% | 0 (0.0%) |
| synthetic-structures | 6 | 52 | 71.2% | 21.2% | 7.7% | 0 (0.0%) |

### 规则命中（文本节点数 / 匹配元素数）

| 类型 | id | selector | 文本节点 | 元素数 |
| --- | --- | --- | --- | --- |
| unit | p | `.ltx_p` | 11770 | 2308 |
| unit | title | `.ltx_title, .ltx_subtitle` | 577 | 575 |
| unit | caption | `.ltx_caption` | 239 | 105 |
| unit | footnote | `.ltx_note_content` | 166 | 56 |
| unit | bibblock | `.ltx_bibblock` | 2003 | 1121 |
| unit | bibitem | `.ltx_bibitem:not(:has(.ltx_bibblock))` | 0 | 0 |
| unit | ack | `.ltx_acknowledgements` | 10 | 2 |
| unit | keywords | `.ltx_keywords` | 2 | 2 |
| unit | authorinfo | `.ltx_contact, .ltx_role_affiliation, .ltx_role_address, .ltx_dates, .ltx_date` | 89 | 45 |
| unit | dedicatory | `.ltx_role_dedicatory` | 1 | 1 |
| unit | item | `.ltx_item` | 1 | 327 |
| unit | marginal | `.ltx_marginpar` | 1 | 1 |
| unit | indexentry | `.ltx_indexentry` | 2 | 2 |
| unit | cv | `.ltx_cv_item_label, .ltx_cv_item_content, .ltx_cv_entry_date` | 3 | 3 |
| table | table | `.ltx_tabular` | 4632 | 58 |
| skip | equation | `.ltx_equation, .ltx_equationgroup` | 4 | 1145 |
| skip | listing | `.ltx_listing, .ltx_listingline, .ltx_listing_data, .ltx_verbatim, pre, code` | 995 | 856 |
| skip | personname | `.ltx_personname` | 30 | 27 |
| skip | author-glue | `.ltx_author_before, .ltx_author_after` | 1 | 18 |
| skip | classification | `.ltx_classification` | 1 | 1 |
| skip | pubnotes | `.ltx_pubnotes` | 14 | 2 |
| skip | picture | `svg, .ltx_picture` | 90 | 264 |
| skip | error | `.ltx_ERROR, .ltx_FATAL, .ltx_WARNING, .ltx_INFO` | 7 | 7 |
| skip | nav | `.ltx_page_navbar, .ltx_TOC` | 0 | 19 |
| protect | math | `math, .ltx_Math` | 81929 | 8217 |
| protect | ref | `.ltx_ref` | 3253 | 3286 |
| protect | cite | `.ltx_cite` | 1872 | 769 |
| protect | tag | `.ltx_tag` | 2096 | 2207 |
| protect | tt | `.ltx_text.ltx_font_typewriter` | 2105 | 2488 |
| protect | note | `.ltx_note` | 0 | 56 |
| protect | note-mark | `.ltx_note_mark, .ltx_note_type` | 114 | 114 |
| protect | mailto | `a[href^="mailto:"]` | 11 | 11 |
| protect | indexrefs | `.ltx_indexrefs` | 2 | 2 |
| protect | img | `img` | 0 | 73 |
| protect | br | `br` | 0 | 69 |

### (a) 在所有 fixture 中都没有匹配元素的规则

- `.ltx_bibitem:not(:has(.ltx_bibblock))` (bibitem)

### (b) 未被任何规则覆盖的文本节点（按最近祖先链签名，近端在前）

| 签名 | 文本节点 | fixture 数 | 样本 |
| --- | --- | --- | --- |

### 同一单元元素命中多条 unit 规则的组合

（无）

### (c) 只在部分 fixture 出现的 ltx_* 类名（共 292 个类名，290 个未全覆盖；全部 fixture 同为 oxide 0.7.6，此处反映的是内容分布而非版本差异）

| 类名 | 出现篇数 | fixture |
| --- | --- | --- |
| `ltx_affiliation_city` | 1 | 2312.17141 |
| `ltx_affiliation_country` | 1 | 2312.17141 |
| `ltx_affiliation_institution` | 1 | 2312.17141 |
| `ltx_affiliation_streetaddress` | 1 | 2312.17141 |
| `ltx_eqn_gather` | 1 | 2312.17141 |
| `ltx_flex_size_3` | 1 | 2312.17141 |
| `ltx_lst_emph` | 1 | 2312.17141 |
| `ltx_lst_keywords2` | 1 | 2312.17141 |
| `ltx_pruned_first` | 1 | 2312.17141 |
| `ltx_pubnotes_meta` | 1 | 2312.17141 |
| `ltx_role_ccs` | 1 | 2312.17141 |
| `ltx_role_doi` | 1 | 2312.17141 |
| `ltx_role_journal` | 1 | 2312.17141 |
| `ltx_role_number` | 1 | 2312.17141 |
| `ltx_role_publicationmonth` | 1 | 2312.17141 |
| `ltx_nopad_l` | 1 | 2312.17527 |
| `ltx_eqn_eqnarray` | 1 | 2401.00418 |
| `ltx_flex_table` | 1 | 2401.00418 |
| `ltx_path` | 1 | 2401.00418 |
| `ltx_img_portrait` | 1 | 2401.00596 |
| `ltx_font_medium` | 1 | 2410.00260 |
| `ltx_logical-block` | 1 | 2410.00260 |
| `ltx_note_type` | 1 | 2410.00260 |
| `ltx_role_footnotetext` | 1 | 2410.00260 |
| `ltx_role_thanks` | 1 | 2507.00150 |
| `ltx_sub` | 1 | 2507.00150 |
| `ltx_framed_underline` | 1 | 2608.29808 |
| `ltx_leftmargin_flush` | 1 | 2608.29808 |
| `ltx_lst_language_Java` | 1 | 2608.29808 |
| `ltx_lst_language_python` | 1 | 2608.29808 |
| `ltx_tag_subsubsection` | 1 | 2608.29808 |
| `ltx_filled_leader` | 1 | 2609.00245 |
| `ltx_font_mathscript` | 1 | 2609.00245 |
| `ltx_role_note` | 1 | 2609.00245 |
| `ltx_theorem_assumption` | 1 | 2609.00245 |
| `ltx_align_floatright` | 1 | 2609.00246 |
| `ltx_bib_article` | 1 | 2609.00246 |
| `ltx_bib_author` | 1 | 2609.00246 |
| `ltx_bib_book` | 1 | 2609.00246 |
| `ltx_bib_cited` | 1 | 2609.00246 |
| `ltx_bib_editor` | 1 | 2609.00246 |
| `ltx_bib_external` | 1 | 2609.00246 |
| `ltx_bib_inbook` | 1 | 2609.00246 |
| `ltx_bib_incollection` | 1 | 2609.00246 |
| `ltx_bib_inproceedings` | 1 | 2609.00246 |
| `ltx_bib_journal` | 1 | 2609.00246 |
| `ltx_bib_key` | 1 | 2609.00246 |
| `ltx_bib_language` | 1 | 2609.00246 |
| `ltx_bib_links` | 1 | 2609.00246 |
| `ltx_bib_manual` | 1 | 2609.00246 |
| `ltx_bib_misc` | 1 | 2609.00246 |
| `ltx_bib_note` | 1 | 2609.00246 |
| `ltx_bib_number` | 1 | 2609.00246 |
| `ltx_bib_pages` | 1 | 2609.00246 |
| `ltx_bib_place` | 1 | 2609.00246 |
| `ltx_bib_publisher` | 1 | 2609.00246 |
| `ltx_bib_series` | 1 | 2609.00246 |
| `ltx_bib_thesis` | 1 | 2609.00246 |
| `ltx_bib_title` | 1 | 2609.00246 |
| `ltx_bib_type` | 1 | 2609.00246 |
| `ltx_bib_volume` | 1 | 2609.00246 |
| `ltx_bib_year` | 1 | 2609.00246 |
| `ltx_block` | 1 | 2609.00246 |
| `ltx_mathvariant_bold` | 1 | 2609.00246 |
| `ltx_orcid` | 1 | 2609.00246 |
| `ltx_orcidlogo` | 1 | 2609.00246 |
| `ltx_INFO` | 1 | synthetic-structures |
| `ltx_WARNING` | 1 | synthetic-structures |
| `ltx_chapter` | 1 | synthetic-structures |
| `ltx_classification` | 1 | synthetic-structures |
| `ltx_cv` | 1 | synthetic-structures |
| `ltx_cv_entry` | 1 | synthetic-structures |
| `ltx_cv_entry_content` | 1 | synthetic-structures |
| `ltx_cv_entry_date` | 1 | synthetic-structures |
| `ltx_cv_heading` | 1 | synthetic-structures |
| `ltx_cv_item` | 1 | synthetic-structures |
| `ltx_cv_item_content` | 1 | synthetic-structures |
| `ltx_cv_item_label` | 1 | synthetic-structures |
| `ltx_date` | 1 | synthetic-structures |
| `ltx_epigraph` | 1 | synthetic-structures |
| `ltx_glossary` | 1 | synthetic-structures |
| `ltx_index` | 1 | synthetic-structures |
| `ltx_indexentry` | 1 | synthetic-structures |
| `ltx_indexlist` | 1 | synthetic-structures |
| `ltx_indexrefs` | 1 | synthetic-structures |
| `ltx_marginpar` | 1 | synthetic-structures |
| `ltx_marginpar_right` | 1 | synthetic-structures |
| `ltx_part` | 1 | synthetic-structures |
| `ltx_quote` | 1 | synthetic-structures |
| `ltx_role_creation` | 1 | synthetic-structures |
| `ltx_role_dedicatory` | 1 | synthetic-structures |
| `ltx_subfigure` | 1 | synthetic-structures |
| `ltx_subgraphics` | 1 | synthetic-structures |
| `ltx_subparagraph` | 1 | synthetic-structures |
| `ltx_tag_chapter` | 1 | synthetic-structures |
| `ltx_tag_part` | 1 | synthetic-structures |
| `ltx_tag_subfigure` | 1 | synthetic-structures |
| `ltx_title_chapter` | 1 | synthetic-structures |
| `ltx_title_glossary` | 1 | synthetic-structures |
| `ltx_title_index` | 1 | synthetic-structures |
| `ltx_title_part` | 1 | synthetic-structures |
| `ltx_title_subparagraph` | 1 | synthetic-structures |
| `ltx_titlepage` | 1 | synthetic-structures |
| `ltx_acknowledgements` | 2 | 2312.17141 2507.00150 |
| `ltx_citemacro_citep` | 2 | 2312.17141 2507.00150 |
| `ltx_description` | 2 | 2312.17141 synthetic-structures |
| `ltx_eqn_align` | 2 | 2312.17141 2609.00245 |
| `ltx_lst_language_Python` | 2 | 2312.17141 2608.29808 |
| `ltx_mathvariant_sans-serif` | 2 | 2312.17141 2609.00246 |
| `ltx_note_name` | 2 | 2312.17141 2507.00150 |
| `ltx_pubnote` | 2 | 2312.17141 2507.00150 |
| `ltx_pubnotes` | 2 | 2312.17141 2507.00150 |
| `ltx_pubnotes_content` | 2 | 2312.17141 2507.00150 |
| `ltx_title_acknowledgements` | 2 | 2312.17141 2507.00150 |
| `ltx_algorithm` | 2 | 2312.17527 2608.29808 |
| `ltx_lst_language_C` | 2 | 2312.17527 2608.29808 |
| `ltx_theorem_proof` | 2 | 2312.17527 2609.00246 |
| `ltx_underline` | 2 | 2312.17527 2410.00260 |
| `ltx_nolink` | 2 | 2401.00418 2609.00245 |
| `ltx_inline-quote` | 2 | 2401.00596 synthetic-structures |
| `ltx_outerquote` | 2 | 2401.00596 synthetic-structures |
| `ltx_align_bottom` | 2 | 2410.00260 2608.29808 |
| `ltx_border_l` | 2 | 2410.00260 2608.29808 |
| `ltx_float_algorithm` | 2 | 2410.00260 synthetic-structures |
| `ltx_citemacro_citet` | 2 | 2507.00150 2609.00246 |
| `ltx_keywords` | 2 | 2507.00150 2609.00246 |
| `ltx_title_keywords` | 2 | 2507.00150 2609.00246 |
| `ltx_font_serif` | 2 | 2608.29808 2609.00246 |
| `ltx_lst_directive` | 2 | 2608.29808 2609.00246 |
| `ltx_lst_language_c` | 2 | 2608.29808 2609.00246 |
| `ltx_lst_string` | 2 | 2608.29808 2609.00246 |
| `ltx_mathvariant_monospace` | 2 | 2608.29808 2609.00246 |
| `ltx_subsubsection` | 2 | 2608.29808 2609.00246 |
| `ltx_title_subsubsection` | 2 | 2608.29808 2609.00246 |
| `ltx_transformed_inner` | 2 | 2608.29808 2609.00246 |
| `ltx_transformed_outer` | 2 | 2608.29808 2609.00246 |
| `ltx_missing_label` | 2 | 2609.00245 2609.00246 |
| `ltx_ref_self` | 2 | 2609.00245 2609.00246 |
| `ltx_subtitle` | 2 | 2609.00246 synthetic-structures |
| `ltx_dates` | 3 | 2312.17141 2401.00596 2507.00150 |
| `ltx_equationgroup` | 3 | 2312.17141 2401.00418 2609.00245 |
| `ltx_flex_size_2` | 3 | 2312.17141 2410.00260 2609.00246 |
| `ltx_framed_rectangle` | 3 | 2312.17141 2312.17527 synthetic-structures |
| `ltx_mathvariant_italic` | 3 | 2312.17141 2312.17527 2608.29808 |
| `ltx_pagination` | 3 | 2312.17141 2410.00260 2609.00246 |
| `ltx_proof` | 3 | 2312.17141 2401.00418 2609.00245 |
| `ltx_role_newpage` | 3 | 2312.17141 2410.00260 2609.00246 |
| `ltx_title_proof` | 3 | 2312.17141 2401.00418 2609.00245 |
| `ltx_framed_top` | 3 | 2312.17527 2410.00260 2608.29808 |
| `ltx_framed_topbottom` | 3 | 2312.17527 2410.00260 2608.29808 |
| `ltx_lst_numbers_left` | 3 | 2312.17527 2608.29808 2609.00246 |
| `ltx_theorem_remark` | 3 | 2312.17527 2609.00245 2609.00246 |
| `ltx_border_b` | 3 | 2401.00418 2507.00150 2608.29808 |
| `ltx_img_square` | 3 | 2401.00596 2410.00260 2608.29808 |
| `ltx_verbatim` | 3 | 2410.00260 2507.00150 synthetic-structures |
| `ltx_font_sansserif` | 3 | 2507.00150 2608.29808 2609.00246 |
| `ltx_ERROR` | 3 | 2608.29808 2608.30667 synthetic-structures |
| `ltx_enumerate` | 4 | 2312.17141 2312.17527 2609.00245 2609.00246 |
| `ltx_flex_break` | 4 | 2312.17141 2401.00418 2608.29808 2609.00246 |
| `ltx_flex_size_1` | 4 | 2312.17141 2401.00418 2608.29808 2609.00246 |
| `ltx_foreignobject_container` | 4 | 2312.17141 2410.00260 2608.29808 2609.00246 |
| `ltx_foreignobject_content` | 4 | 2312.17141 2410.00260 2608.29808 2609.00246 |
| `ltx_listing_data` | 4 | 2312.17141 2312.17527 2608.29808 2609.00246 |
| `ltx_lst_comment` | 4 | 2312.17141 2312.17527 2608.29808 2609.00246 |
| `ltx_lst_identifier` | 4 | 2312.17141 2312.17527 2608.29808 2609.00246 |
| `ltx_lst_keyword` | 4 | 2312.17141 2312.17527 2608.29808 2609.00246 |
| `ltx_lst_space` | 4 | 2312.17141 2312.17527 2608.29808 2609.00246 |
| `ltx_minipage` | 4 | 2312.17141 2410.00260 2608.29808 2609.00246 |
| `ltx_paragraph` | 4 | 2312.17141 2608.29808 2609.00245 2609.00246 |
| `ltx_picture` | 4 | 2312.17141 2410.00260 2608.29808 2609.00246 |
| `ltx_role_email` | 4 | 2312.17141 2312.17527 2507.00150 2609.00246 |
| `ltx_role_refnum` | 4 | 2312.17141 2401.00596 2507.00150 2609.00246 |
| `ltx_theorem_corollary` | 4 | 2312.17141 2312.17527 2401.00418 2609.00245 |
| `ltx_theorem_lemma` | 4 | 2312.17141 2312.17527 2401.00418 2609.00245 |
| `ltx_theorem_proposition` | 4 | 2312.17141 2401.00418 2609.00245 2609.00246 |
| `ltx_theorem_theorem` | 4 | 2312.17141 2312.17527 2401.00418 2609.00245 |
| `ltx_title_paragraph` | 4 | 2312.17141 2608.29808 2609.00245 2609.00246 |
| `ltx_float` | 4 | 2312.17527 2410.00260 2608.29808 synthetic-structures |
| `ltx_rule` | 4 | 2312.17527 2410.00260 2608.29808 2609.00245 |
| `ltx_tag_float` | 4 | 2312.17527 2410.00260 2608.29808 synthetic-structures |
| `ltx_tag_listingline` | 4 | 2312.17527 2410.00260 2608.29808 2609.00246 |
| `ltx_tag_theorem` | 4 | 2312.17527 2401.00418 2609.00245 2609.00246 |
| `ltx_border_r` | 4 | 2401.00418 2410.00260 2608.29808 2609.00246 |
| `ltx_href` | 4 | 2401.00418 2401.00596 2507.00150 2608.29808 |
| `ltx_sup` | 4 | 2401.00418 2401.00596 2410.00260 2507.00150 |
| `ltx_th_row` | 4 | 2401.00418 2410.00260 2608.29808 2609.00246 |
| `ltx_nopad_r` | 4 | 2410.00260 2608.29808 2609.00245 2609.00246 |
| `ltx_break` | 5 | 2312.17141 2401.00418 2401.00596 2507.00150 2609.00246 |
| `ltx_figure_panel` | 5 | 2312.17141 2401.00418 2410.00260 2608.29808 2609.00246 |
| `ltx_flex_cell` | 5 | 2312.17141 2401.00418 2410.00260 2608.29808 2609.00246 |
| `ltx_flex_figure` | 5 | 2312.17141 2401.00418 2410.00260 2608.29808 2609.00246 |
| `ltx_font_smallcaps` | 5 | 2312.17141 2401.00596 2507.00150 2608.29808 2609.00246 |
| `ltx_framed` | 5 | 2312.17141 2312.17527 2410.00260 2608.29808 synthetic-structures |
| `ltx_graphics` | 5 | 2312.17141 2401.00596 2410.00260 2507.00150 2608.29808 |
| `ltx_img_landscape` | 5 | 2312.17141 2401.00596 2410.00260 2507.00150 2608.29808 |
| `ltx_lstlisting` | 5 | 2312.17141 2312.17527 2608.29808 2609.00246 synthetic-structures |
| `ltx_runin` | 5 | 2312.17141 2312.17527 2401.00418 2609.00245 2609.00246 |
| `ltx_theorem` | 5 | 2312.17141 2312.17527 2401.00418 2609.00245 2609.00246 |
| `ltx_theorem_definition` | 5 | 2312.17141 2312.17527 2401.00418 2609.00245 2609.00246 |
| `ltx_theorem_example` | 5 | 2312.17141 2312.17527 2401.00418 2609.00245 2609.00246 |
| `ltx_title_theorem` | 5 | 2312.17141 2312.17527 2401.00418 2609.00245 2609.00246 |
| `ltx_align_top` | 5 | 2312.17527 2410.00260 2608.29808 2609.00245 2609.00246 |
| `ltx_appendix` | 5 | 2401.00596 2410.00260 2507.00150 2608.29808 2609.00246 |
| `ltx_tag_appendix` | 5 | 2401.00596 2410.00260 2507.00150 2608.29808 2609.00246 |
| `ltx_title_appendix` | 5 | 2401.00596 2410.00260 2507.00150 2608.29808 2609.00246 |
| `ltx_author_before` | 6 | 2312.17141 2312.17527 2410.00260 2507.00150 2608.29808 2609.00246 |
| `ltx_font_upright` | 6 | 2312.17141 2312.17527 2401.00418 2608.29808 2609.00245 2609.00246 |
| `ltx_inline-block` | 6 | 2312.17141 2312.17527 2410.00260 2608.29808 2609.00245 2609.00246 |
| `ltx_listing` | 6 | 2312.17141 2312.17527 2410.00260 2608.29808 2609.00246 synthetic-structures |
| `ltx_listingline` | 6 | 2312.17141 2312.17527 2410.00260 2608.29808 2609.00246 synthetic-structures |
| `ltx_markedasmath` | 6 | 2312.17141 2312.17527 2401.00418 2608.29808 2609.00245 2609.00246 |
| `ltx_noindent` | 6 | 2312.17141 2312.17527 2410.00260 2608.29808 2609.00245 2609.00246 |
| `ltx_url` | 6 | 2312.17141 2401.00418 2401.00596 2507.00150 2608.29808 2609.00245 |
| `ltx_border_bb` | 6 | 2312.17527 2401.00596 2410.00260 2608.29808 2609.00245 2609.00246 |
| `ltx_border_tt` | 6 | 2312.17527 2401.00596 2410.00260 2608.29808 2609.00245 2609.00246 |
| `ltx_th_column` | 6 | 2312.17527 2410.00260 2507.00150 2608.29808 2609.00245 2609.00246 |
| `ltx_thead` | 6 | 2312.17527 2410.00260 2507.00150 2608.29808 2609.00245 2609.00246 |
| `ltx_align_baseline` | 7 | 2312.17141 2312.17527 2401.00418 2401.00596 2410.00260 2609.00245 2609.00246 |
| `ltx_eqn_cell` | 7 | 2312.17141 2312.17527 2401.00418 2401.00596 2410.00260 2609.00245 2609.00246 |
| `ltx_eqn_center_padleft` | 7 | 2312.17141 2312.17527 2401.00418 2401.00596 2410.00260 2609.00245 2609.00246 |
| `ltx_eqn_center_padright` | 7 | 2312.17141 2312.17527 2401.00418 2401.00596 2410.00260 2609.00245 2609.00246 |
| `ltx_eqn_eqno` | 7 | 2312.17141 2312.17527 2401.00418 2401.00596 2410.00260 2609.00245 2609.00246 |
| `ltx_eqn_row` | 7 | 2312.17141 2312.17527 2401.00418 2401.00596 2410.00260 2609.00245 2609.00246 |
| `ltx_eqn_table` | 7 | 2312.17141 2312.17527 2401.00418 2401.00596 2410.00260 2609.00245 2609.00246 |
| `ltx_equation` | 7 | 2312.17141 2312.17527 2401.00418 2401.00596 2410.00260 2609.00245 2609.00246 |
| `ltx_font_mathcaligraphic` | 7 | 2312.17141 2312.17527 2401.00418 2507.00150 2608.29808 2609.00245 2609.00246 |
| `ltx_itemize` | 7 | 2312.17141 2312.17527 2401.00418 2410.00260 2608.29808 2609.00245 2609.00246 |
| `ltx_math_unparsed` | 7 | 2312.17141 2312.17527 2401.00418 2401.00596 2608.29808 2609.00245 2609.00246 |
| `ltx_tag_equation` | 7 | 2312.17141 2312.17527 2401.00418 2401.00596 2410.00260 2609.00245 2609.00246 |
| `ltx_guessed_headers` | 7 | 2312.17527 2401.00418 2410.00260 2507.00150 2608.29808 2609.00245 2609.00246 |
| `ltx_table` | 7 | 2312.17527 2401.00418 2401.00596 2410.00260 2507.00150 2608.29808 2609.00246 |
| `ltx_tag_table` | 7 | 2312.17527 2401.00418 2401.00596 2410.00260 2507.00150 2608.29808 2609.00246 |
| `ltx_th` | 7 | 2312.17527 2401.00418 2410.00260 2507.00150 2608.29808 2609.00245 2609.00246 |
| `ltx_align_left` | 8 | 2312.17141 2312.17527 2401.00418 2410.00260 2507.00150 2608.29808 2609.00245 2609.00246 |
| `ltx_centering` | 8 | 2312.17141 2401.00418 2401.00596 2410.00260 2507.00150 2608.29808 2609.00245 2609.00246 |
| `ltx_figure` | 8 | 2312.17141 2312.17527 2401.00596 2410.00260 2507.00150 2608.29808 2609.00246 synthetic-structures |
| `ltx_item` | 8 | 2312.17141 2312.17527 2401.00418 2410.00260 2608.29808 2609.00245 2609.00246 synthetic-structures |
| `ltx_role_affiliation` | 8 | 2312.17141 2312.17527 2401.00418 2401.00596 2410.00260 2507.00150 2608.29808 2609.00246 |
| `ltx_role_footnote` | 8 | 2312.17141 2312.17527 2401.00418 2401.00596 2507.00150 2608.29808 2609.00245 2609.00246 |
| `ltx_subsection` | 8 | 2312.17141 2312.17527 2401.00596 2410.00260 2507.00150 2608.29808 2609.00245 2609.00246 |
| `ltx_tag_figure` | 8 | 2312.17141 2312.17527 2401.00596 2410.00260 2507.00150 2608.29808 2609.00246 synthetic-structures |
| `ltx_tag_item` | 8 | 2312.17141 2312.17527 2401.00418 2410.00260 2608.29808 2609.00245 2609.00246 synthetic-structures |
| `ltx_tag_note` | 8 | 2312.17141 2312.17527 2401.00418 2401.00596 2507.00150 2608.29808 2609.00245 2609.00246 |
| `ltx_tag_subsection` | 8 | 2312.17141 2312.17527 2401.00596 2410.00260 2507.00150 2608.29808 2609.00245 2609.00246 |
| `ltx_title_subsection` | 8 | 2312.17141 2312.17527 2401.00596 2410.00260 2507.00150 2608.29808 2609.00245 2609.00246 |
| `ltx_border_t` | 8 | 2312.17527 2401.00418 2401.00596 2410.00260 2507.00150 2608.29808 2609.00245 2609.00246 |
| `ltx_citemacro_cite` | 8 | 2312.17527 2401.00418 2401.00596 2410.00260 2507.00150 2608.29808 2609.00245 2609.00246 |
| `ltx_tabular` | 8 | 2312.17527 2401.00418 2401.00596 2410.00260 2507.00150 2608.29808 2609.00245 2609.00246 |
| `ltx_tbody` | 8 | 2312.17527 2401.00418 2401.00596 2410.00260 2507.00150 2608.29808 2609.00245 2609.00246 |
| `ltx_tr` | 8 | 2312.17527 2401.00418 2401.00596 2410.00260 2507.00150 2608.29808 2609.00245 2609.00246 |
| `ltx_Math` | 9 | 2312.17141 2312.17527 2401.00418 2401.00596 2410.00260 2507.00150 2608.29808 2609.00245 2609.00246 |
| `ltx_abstract` | 9 | 2312.17141 2312.17527 2401.00418 2401.00596 2410.00260 2507.00150 2608.29808 2609.00245 2609.00246 |
| `ltx_align_center` | 9 | 2312.17141 2312.17527 2401.00418 2401.00596 2410.00260 2507.00150 2608.29808 2609.00245 2609.00246 |
| `ltx_align_middle` | 9 | 2312.17141 2312.17527 2401.00418 2401.00596 2410.00260 2507.00150 2608.29808 2609.00245 2609.00246 |
| `ltx_align_right` | 9 | 2312.17141 2312.17527 2401.00418 2401.00596 2410.00260 2608.29808 2609.00245 2609.00246 synthetic-structures |
| `ltx_author_notes` | 9 | 2312.17141 2312.17527 2401.00418 2401.00596 2410.00260 2507.00150 2608.29808 2609.00245 2609.00246 |
| `ltx_author_notes_content` | 9 | 2312.17141 2312.17527 2401.00418 2401.00596 2410.00260 2507.00150 2608.29808 2609.00245 2609.00246 |
| `ltx_authors` | 9 | 2312.17141 2312.17527 2401.00418 2401.00596 2410.00260 2507.00150 2608.29808 2609.00245 2609.00246 |
| `ltx_bibblock` | 9 | 2312.17141 2312.17527 2401.00418 2401.00596 2410.00260 2507.00150 2608.29808 2609.00245 2609.00246 |
| `ltx_bibitem` | 9 | 2312.17141 2312.17527 2401.00418 2401.00596 2410.00260 2507.00150 2608.29808 2609.00245 2609.00246 |
| `ltx_bibliography` | 9 | 2312.17141 2312.17527 2401.00418 2401.00596 2410.00260 2507.00150 2608.29808 2609.00245 2609.00246 |
| `ltx_biblist` | 9 | 2312.17141 2312.17527 2401.00418 2401.00596 2410.00260 2507.00150 2608.29808 2609.00245 2609.00246 |
| `ltx_caption` | 9 | 2312.17141 2312.17527 2401.00418 2401.00596 2410.00260 2507.00150 2608.29808 2609.00246 synthetic-structures |
| `ltx_cite` | 9 | 2312.17141 2312.17527 2401.00418 2401.00596 2410.00260 2507.00150 2608.29808 2609.00245 2609.00246 |
| `ltx_contact` | 9 | 2312.17141 2312.17527 2401.00418 2401.00596 2410.00260 2507.00150 2608.29808 2609.00245 2609.00246 |
| `ltx_contact_name` | 9 | 2312.17141 2312.17527 2401.00418 2401.00596 2410.00260 2507.00150 2608.29808 2609.00245 2609.00246 |
| `ltx_creator` | 9 | 2312.17141 2312.17527 2401.00418 2401.00596 2410.00260 2507.00150 2608.29808 2609.00245 2609.00246 |
| `ltx_emph` | 9 | 2312.17141 2312.17527 2401.00418 2401.00596 2410.00260 2507.00150 2608.29808 2609.00245 2609.00246 |
| `ltx_font_bold` | 9 | 2312.17141 2312.17527 2401.00418 2401.00596 2410.00260 2507.00150 2608.29808 2609.00245 2609.00246 |
| `ltx_font_italic` | 9 | 2312.17141 2312.17527 2401.00418 2401.00596 2410.00260 2507.00150 2608.29808 2609.00245 2609.00246 |
| `ltx_font_typewriter` | 9 | 2312.17141 2312.17527 2401.00418 2401.00596 2410.00260 2507.00150 2608.29808 2609.00245 2609.00246 |
| `ltx_note` | 9 | 2312.17141 2312.17527 2401.00418 2401.00596 2410.00260 2507.00150 2608.29808 2609.00245 2609.00246 |
| `ltx_note_content` | 9 | 2312.17141 2312.17527 2401.00418 2401.00596 2410.00260 2507.00150 2608.29808 2609.00245 2609.00246 |
| `ltx_note_mark` | 9 | 2312.17141 2312.17527 2401.00418 2401.00596 2410.00260 2507.00150 2608.29808 2609.00245 2609.00246 |
| `ltx_note_outer` | 9 | 2312.17141 2312.17527 2401.00418 2401.00596 2410.00260 2507.00150 2608.29808 2609.00245 2609.00246 |
| `ltx_personname` | 9 | 2312.17141 2312.17527 2401.00418 2401.00596 2410.00260 2507.00150 2608.29808 2609.00245 2609.00246 |
| `ltx_ref` | 9 | 2312.17141 2312.17527 2401.00418 2401.00596 2410.00260 2507.00150 2608.29808 2609.00245 2609.00246 |
| `ltx_ref_tag` | 9 | 2312.17141 2312.17527 2401.00418 2401.00596 2410.00260 2507.00150 2608.29808 2609.00245 2609.00246 |
| `ltx_role_author` | 9 | 2312.17141 2312.17527 2401.00418 2401.00596 2410.00260 2507.00150 2608.29808 2609.00245 2609.00246 |
| `ltx_section` | 9 | 2312.17141 2312.17527 2401.00418 2401.00596 2410.00260 2507.00150 2608.29808 2609.00245 2609.00246 |
| `ltx_tag_bibitem` | 9 | 2312.17141 2312.17527 2401.00418 2401.00596 2410.00260 2507.00150 2608.29808 2609.00245 2609.00246 |
| `ltx_tag_section` | 9 | 2312.17141 2312.17527 2401.00418 2401.00596 2410.00260 2507.00150 2608.29808 2609.00245 2609.00246 |
| `ltx_td` | 9 | 2312.17141 2312.17527 2401.00418 2401.00596 2410.00260 2507.00150 2608.29808 2609.00245 2609.00246 |
| `ltx_text` | 9 | 2312.17141 2312.17527 2401.00418 2401.00596 2410.00260 2507.00150 2608.29808 2609.00245 2609.00246 |
| `ltx_title_abstract` | 9 | 2312.17141 2312.17527 2401.00418 2401.00596 2410.00260 2507.00150 2608.29808 2609.00245 2609.00246 |
| `ltx_title_bibliography` | 9 | 2312.17141 2312.17527 2401.00418 2401.00596 2410.00260 2507.00150 2608.29808 2609.00245 2609.00246 |
| `ltx_title_section` | 9 | 2312.17141 2312.17527 2401.00418 2401.00596 2410.00260 2507.00150 2608.29808 2609.00245 2609.00246 |
| `ltx_tag` | 10 | 2312.17141 2312.17527 2401.00418 2401.00596 2410.00260 2507.00150 2608.29808 2609.00245 2609.00246 synthetic-structures |
| `ltx_title` | 10 | 2312.17141 2312.17527 2401.00418 2401.00596 2410.00260 2507.00150 2608.29808 2609.00245 2609.00246 synthetic-structures |
| `ltx_title_document` | 10 | 2312.17141 2312.17527 2401.00418 2401.00596 2410.00260 2507.00150 2608.29808 2609.00245 2609.00246 synthetic-structures |

### SVG 图占比（§15.1，仅统计翻译根内）

| fixture | svg | 含 <text> 的 svg | img.ltx_graphics | .ltx_figure |
| --- | --- | --- | --- | --- |
| 2312.17141 | 43 | 0 | 2 | 11 |
| 2312.17527 | 0 | 0 | 0 | 1 |
| 2401.00418 | 0 | 0 | 0 | 0 |
| 2401.00596 | 0 | 0 | 0 | 12 |
| 2410.00260 | 2 | 0 | 4 | 7 |
| 2507.00150 | 0 | 0 | 6 | 6 |
| 2608.29808 | 114 | 0 | 1 | 4 |
| 2608.30667 | 0 | 0 | 0 | 0 |
| 2609.00245 | 0 | 0 | 0 | 0 |
| 2609.00246 | 5 | 0 | 0 | 12 |
| synthetic-structures | 0 | 0 | 0 | 2 |

### 翻译根之外的文本节点（应只有导航栏与 arXiv 页头页脚）

| 最近可识别祖先 | 文本节点 |
| --- | --- |
| span.ltx_ref_title.ltx_text | 197 |
| span.ltx_tag.ltx_tag_ref | 140 |
| div.keyboard-glossary | 110 |
| nav.ds-site-footer-links | 80 |
| span.ds-site-footer-sep | 70 |
| div.ds-site-footer-ack | 50 |
| a.ltx_ref | 40 |
| a.ltx_LaTeXML_logo.ltx_ref | 40 |
| span.desktop-only | 30 |
| div.ltx_page_logo | 30 |
| span.ltx_text | 24 |
| span.ltx_font_italic.ltx_text | 23 |
| div.modal-body | 20 |
| span.mobile-only | 20 |
| span.ltx_font_smallcaps.ltx_text | 15 |
| math.ltx_Math | 11 |
| h5#modal-title | 10 |
| button.modal-close | 10 |
| p#selectedTextModalDescription | 10 |
| button.sr-only | 10 |
| button.modal-submit | 10 |
| span.ds-announcement-text | 10 |
| a.ds-announcement-link | 10 |
| button.ds-announcement-close | 10 |
| span.sr-only | 10 |
| a.header-button | 10 |
| a#license-tr | 10 |
| div#watermark-tr | 10 |
| span.ltx_font_smallcaps | 10 |
| span.ack-member-inline | 10 |
| span.is-sr-only | 10 |
| div.ds-site-footer-funders-label | 10 |
| math.ltx_math_unparsed | 9 |
| span.ltx_font_typewriter.ltx_text | 3 |

### 有直接文本的元素直方图（tag.ltx_* → 次数，合计 226 种）

| 元素 | 次数 | 出现篇数 |
| --- | --- | --- |
| `mo` | 36515 | 9 |
| `mi` | 24731 | 9 |
| `mn` | 9938 | 9 |
| `annotation` | 8214 | 9 |
| `span.ltx_text` | 2292 | 8 |
| `span.ltx_ref_tag.ltx_text` | 1639 | 9 |
| `p.ltx_p` | 1413 | 11 |
| `mi.ltx_font_mathcaligraphic` | 1189 | 7 |
| `span.ltx_font_italic.ltx_text` | 1180 | 9 |
| `span.ltx_font_bold.ltx_text` | 1178 | 9 |
| `span.ltx_font_typewriter.ltx_text` | 1131 | 5 |
| `a.ltx_ref` | 1045 | 9 |
| `span.ltx_bibblock` | 996 | 9 |
| `td.ltx_align_left.ltx_td` | 599 | 3 |
| `cite.ltx_cite.ltx_citemacro_cite` | 566 | 8 |
| `mtext.ltx_mathvariant_sans-serif` | 467 | 1 |
| `mi.ltx_font_mathscript` | 454 | 1 |
| `span.ltx_font_typewriter.ltx_lst_identifier.ltx_text` | 419 | 3 |
| `td.ltx_align_right.ltx_td` | 413 | 3 |
| `td.ltx_align_center.ltx_td` | 412 | 5 |
| `em.ltx_emph.ltx_font_italic` | 404 | 8 |
| `span.ltx_tag.ltx_tag_listingline` | 345 | 4 |
| `a.ltx_href.ltx_ref` | 320 | 3 |
| `span.ltx_tag.ltx_tag_item` | 313 | 8 |
| `td.ltx_align_center.ltx_border_t.ltx_td` | 294 | 5 |
| `span.ltx_font_smallcaps.ltx_text` | 268 | 5 |
| `span.ltx_tag.ltx_tag_bibitem` | 255 | 5 |
| `span.ltx_role_refnum.ltx_tag.ltx_tag_bibitem` | 238 | 3 |
| `mtext.ltx_mathvariant_bold` | 200 | 1 |
| `mtext` | 179 | 4 |
| `span.ltx_font_typewriter.ltx_inline-block.ltx_text.ltx_verbatim` | 167 | 1 |
| `td.ltx_align_right.ltx_border_t.ltx_td` | 160 | 3 |
| `cite.ltx_cite.ltx_citemacro_citep` | 147 | 2 |
| `span.ltx_align_right.ltx_tag.ltx_tag_equation` | 123 | 6 |
| `sup.ltx_note_mark` | 112 | 9 |
| `h6.ltx_font_italic.ltx_runin.ltx_title.ltx_title_proof` | 96 | 3 |
| `span.ltx_inline-quote.ltx_outerquote.ltx_text` | 88 | 1 |
| `span.ltx_lst_identifier.ltx_text` | 87 | 1 |
| `span.ltx_font_bold.ltx_font_typewriter.ltx_lst_keyword.ltx_text` | 75 | 2 |
| `td.ltx_align_right.ltx_border_b.ltx_border_t.ltx_td` | 69 | 1 |
| `h3.ltx_title.ltx_title_subsection` | 62 | 7 |
| `span.ltx_tag.ltx_tag_subsection` | 62 | 7 |
| `span.ltx_tag.ltx_tag_section` | 58 | 9 |
| `span.ltx_p` | 57 | 2 |
| `td.ltx_align_right.ltx_border_r.ltx_td` | 54 | 1 |
| `a.ltx_bib_external.ltx_ref` | 53 | 1 |
| `span.ltx_tag.ltx_tag_figure` | 51 | 8 |
| `span.ltx_tag.ltx_tag_note` | 50 | 8 |
| `h2.ltx_title.ltx_title_section` | 49 | 8 |
| `span.ltx_align_left.ltx_tag.ltx_tag_equation` | 49 | 1 |
| `span.ltx_note_content` | 48 | 8 |
| `td.ltx_align_left.ltx_border_t.ltx_td` | 44 | 5 |
| `span.ltx_contact_name` | 41 | 9 |
| `span.ltx_font_italic.ltx_font_typewriter.ltx_lst_comment.ltx_text` | 41 | 2 |
| `span.ltx_text.ltx_underline` | 41 | 1 |
| `span.ltx_font_typewriter.ltx_lst_keyword.ltx_text` | 41 | 1 |
| `td.ltx_align_center.ltx_border_bb.ltx_border_t.ltx_td` | 41 | 1 |
| `a` | 40 | 5 |
| `div.ltx_listingline` | 40 | 4 |
| `h6.ltx_font_italic.ltx_runin.ltx_title.ltx_title_theorem` | 39 | 1 |
| `figcaption.ltx_caption.ltx_centering` | 39 | 4 |
| `span.ltx_tag.ltx_tag_table` | 37 | 7 |
| `span.ltx_bib_key.ltx_role_refnum.ltx_tag.ltx_tag_bibitem` | 37 | 1 |
| `span.ltx_bib_author.ltx_text` | 37 | 1 |
| `span.ltx_bib_year.ltx_text` | 37 | 1 |
| `span.ltx_bib_title.ltx_text` | 37 | 1 |
| `span.ltx_bib_cited.ltx_bibblock` | 37 | 1 |
| `td.ltx_align_center.ltx_border_bb.ltx_td` | 34 | 4 |
| `span.ltx_font_typewriter.ltx_lst_comment.ltx_text` | 34 | 1 |
| `h6.ltx_font_smallcaps.ltx_runin.ltx_title.ltx_title_theorem` | 33 | 1 |
| `span.ltx_font_upright.ltx_text` | 32 | 4 |
| `em.ltx_emph.ltx_font_italic.ltx_font_serif` | 32 | 1 |
| `span.ltx_bib_pages.ltx_text` | 31 | 1 |
| `td.ltx_align_center.ltx_border_b.ltx_border_t.ltx_td` | 30 | 1 |
| `span.ltx_font_bold.ltx_markedasmath.ltx_text` | 29 | 1 |
| `span.ltx_personname` | 27 | 9 |
| `span.ltx_contact.ltx_role_affiliation` | 26 | 7 |
| `figcaption.ltx_caption` | 26 | 5 |
| `span.ltx_font_sansserif.ltx_markedasmath.ltx_text` | 25 | 1 |
| `h4.ltx_title.ltx_title_paragraph` | 24 | 2 |
| `mo.ltx_mathvariant_italic` | 24 | 2 |
| `span.ltx_font_typewriter.ltx_markedasmath.ltx_text` | 24 | 1 |
| `span.ltx_align_right.ltx_inline-block.ltx_text` | 24 | 1 |
| `span.ltx_align_left.ltx_inline-block.ltx_text` | 24 | 1 |
| `span.ltx_bib_inbook.ltx_text` | 24 | 1 |
| `span.ltx_lst_keyword.ltx_text` | 23 | 1 |
| `span.ltx_lst_emph.ltx_text` | 21 | 1 |
| `span.ltx_bib_editor.ltx_text` | 21 | 1 |
| `span.ltx_bib_volume.ltx_text` | 21 | 1 |
| `span.ltx_bib_links.ltx_text` | 21 | 1 |
| `span.ltx_font_medium.ltx_text` | 20 | 1 |
| `td.ltx_align_left.ltx_border_b.ltx_td` | 20 | 1 |
| `th.ltx_align_left.ltx_td.ltx_th.ltx_th_column` | 18 | 2 |
| `a.ltx_font_typewriter.ltx_ref.ltx_url` | 17 | 6 |
| `td.ltx_align_center.ltx_border_t.ltx_nopad_r.ltx_td` | 17 | 1 |
| `h2.ltx_title.ltx_title_appendix` | 16 | 5 |
| `span.ltx_tag.ltx_tag_appendix` | 16 | 5 |
| `a.ltx_font_typewriter.ltx_href.ltx_ref` | 15 | 1 |
| `h5.ltx_title.ltx_title_paragraph` | 15 | 2 |
| `mtext.ltx_mathvariant_monospace` | 14 | 2 |
| `td.ltx_align_center.ltx_border_r.ltx_border_t.ltx_td` | 12 | 2 |
| `span.ltx_lst_language_Python.ltx_lstlisting.ltx_text` | 11 | 1 |
| `td.ltx_align_center.ltx_border_r.ltx_td` | 11 | 2 |
| `span.ltx_bib_series.ltx_text` | 11 | 1 |
| `span.ltx_font_bold.ltx_font_typewriter.ltx_lst_directive.ltx_lst_keyword.ltx_text` | 11 | 1 |
| `h1.ltx_title.ltx_title_document` | 10 | 10 |
| `span.ltx_font_bold.ltx_font_sansserif.ltx_text` | 10 | 2 |
| `h6.ltx_title.ltx_title_abstract` | 9 | 9 |
| `h2.ltx_title.ltx_title_bibliography` | 9 | 9 |
| `td.ltx_align_center.ltx_border_tt.ltx_td` | 9 | 2 |
| `em.ltx_emph.ltx_font_typewriter` | 9 | 1 |
| `span.ltx_bib_journal.ltx_text` | 9 | 1 |
| `h4.ltx_title.ltx_title_subsubsection` | 8 | 2 |
| `span.ltx_bib_number.ltx_text` | 8 | 1 |
| `span.ltx_bib_external.ltx_text` | 8 | 1 |
| `span.ltx_font_italic.ltx_lst_comment.ltx_text` | 7 | 1 |
| `sup.ltx_sup` | 7 | 3 |
| `span.ltx_font_sansserif.ltx_text` | 7 | 1 |
| `span.ltx_note_name` | 6 | 2 |
| `th.ltx_align_center.ltx_td.ltx_th.ltx_th_column` | 6 | 1 |
| `span.ltx_font_typewriter.ltx_lst_string.ltx_text` | 6 | 2 |
| `span.ltx_font_typewriter.ltx_lst_directive.ltx_lst_keyword.ltx_text` | 6 | 1 |
| `span.ltx_lst_identifier.ltx_lst_language_Python.ltx_lstlisting.ltx_text` | 5 | 1 |
| `td.ltx_align_right.ltx_border_bb.ltx_td` | 5 | 2 |
| `span.ltx_ERROR` | 5 | 3 |
| `span.ltx_lst_keyword.ltx_lst_keywords2.ltx_text` | 4 | 1 |
| `em.ltx_emph.ltx_font_upright` | 4 | 2 |
| `span.ltx_align_left.ltx_p` | 4 | 1 |
| `span.ltx_font_italic.ltx_markedasmath.ltx_text` | 4 | 2 |
| `th.ltx_align_center.ltx_border_tt.ltx_td.ltx_th.ltx_th_column` | 4 | 2 |
| `td.ltx_align_left.ltx_border_bb.ltx_td` | 4 | 3 |
| `td.ltx_align_center.ltx_border_bb.ltx_border_r.ltx_td` | 4 | 2 |
| `td.ltx_align_left.ltx_border_r.ltx_border_t.ltx_td` | 4 | 1 |
| `td.ltx_align_left.ltx_nopad_r.ltx_td` | 4 | 1 |
| `span.ltx_tag.ltx_tag_subsubsection` | 4 | 1 |
| `td.ltx_align_left.ltx_border_tt.ltx_td` | 4 | 2 |
| `td.ltx_align_right.ltx_border_r.ltx_border_t.ltx_td` | 4 | 1 |
| `span.ltx_tag.ltx_tag_float` | 4 | 2 |
| `span.ltx_bib_language.ltx_text` | 4 | 1 |
| `span.ltx_bib_note.ltx_text` | 4 | 1 |
| `span.ltx_pubnote.ltx_role_ccs` | 3 | 1 |
| `div.ltx_dates` | 3 | 3 |
| `span.ltx_markedasmath.ltx_text` | 3 | 3 |
| `th.ltx_align_left.ltx_border_t.ltx_td.ltx_th.ltx_th_column` | 3 | 1 |
| `span.ltx_font_typewriter.ltx_font_upright.ltx_text` | 3 | 1 |
| `td.ltx_align_right.ltx_border_tt.ltx_td` | 3 | 1 |
| `td.ltx_align_center.ltx_border_bb.ltx_border_r.ltx_border_t.ltx_td` | 3 | 1 |
| `th.ltx_align_left.ltx_td.ltx_th.ltx_th_row` | 3 | 1 |
| `span.ltx_affiliation_institution.ltx_text` | 2 | 1 |
| `span.ltx_affiliation_streetaddress.ltx_text` | 2 | 1 |
| `span.ltx_affiliation_city.ltx_text` | 2 | 1 |
| `span.ltx_affiliation_country.ltx_text` | 2 | 1 |
| `span.ltx_lst_emph.ltx_lst_language_Python.ltx_lstlisting.ltx_text` | 2 | 1 |
| `div.ltx_acknowledgements` | 2 | 2 |
| `h6.ltx_title.ltx_title_acknowledgements` | 2 | 2 |
| `span.ltx_note_type` | 2 | 1 |
| `pre.ltx_font_typewriter.ltx_verbatim` | 2 | 1 |
| `td.ltx_align_left.ltx_border_bb.ltx_border_r.ltx_border_t.ltx_td` | 2 | 1 |
| `th.ltx_align_center.ltx_align_top.ltx_border_r.ltx_border_tt.ltx_td.ltx_th.ltx_th_column` | 2 | 1 |
| `th.ltx_align_center.ltx_align_top.ltx_border_tt.ltx_td.ltx_th.ltx_th_column` | 2 | 1 |
| `span.ltx_font_typewriter.ltx_inline-block.ltx_text.ltx_underline.ltx_verbatim` | 2 | 1 |
| `h6.ltx_title.ltx_title_keywords` | 2 | 2 |
| `sub.ltx_sub` | 2 | 1 |
| `span.ltx_font_bold.ltx_font_smallcaps.ltx_text` | 2 | 1 |
| `span.ltx_font_serif.ltx_text` | 2 | 1 |
| `mtext.ltx_mathvariant_italic` | 2 | 1 |
| `td.ltx_align_center.ltx_border_r.ltx_border_tt.ltx_td` | 2 | 1 |
| `th.ltx_align_left.ltx_border_r.ltx_border_t.ltx_td.ltx_th.ltx_th_row` | 2 | 1 |
| `h6.ltx_runin.ltx_title.ltx_title_theorem` | 2 | 1 |
| `span.ltx_bib_publisher.ltx_text` | 2 | 1 |
| `span.ltx_bib_place.ltx_text` | 2 | 1 |
| `li.ltx_indexentry` | 2 | 1 |
| `span.ltx_indexrefs` | 2 | 1 |
| `span.ltx_pubnote.ltx_role_journal` | 1 | 1 |
| `span.ltx_pubnote.ltx_role_number` | 1 | 1 |
| `span.ltx_pubnote.ltx_role_publicationmonth` | 1 | 1 |
| `span.ltx_author_before` | 1 | 1 |
| `mtext.ltx_lst_identifier.ltx_lst_language_Python.ltx_lstlisting` | 1 | 1 |
| `mn.ltx_mathvariant_sans-serif` | 1 | 1 |
| `span.ltx_font_italic.ltx_text.ltx_underline` | 1 | 1 |
| `th.ltx_align_left.ltx_border_tt.ltx_td.ltx_th.ltx_th_column` | 1 | 1 |
| `span.ltx_font_typewriter.ltx_nolink.ltx_path.ltx_ref` | 1 | 1 |
| `span.ltx_align_center.ltx_text` | 1 | 1 |
| `span.ltx_align_center.ltx_font_typewriter.ltx_text` | 1 | 1 |
| `p.ltx_align_center.ltx_p` | 1 | 1 |
| `em.ltx_emph.ltx_font_bold.ltx_font_italic` | 1 | 1 |
| `th.ltx_align_center.ltx_border_l.ltx_border_tt.ltx_td.ltx_th.ltx_th_row` | 1 | 1 |
| `th.ltx_align_center.ltx_border_l.ltx_border_t.ltx_td.ltx_th.ltx_th_row` | 1 | 1 |
| `th.ltx_align_center.ltx_border_bb.ltx_border_l.ltx_border_t.ltx_td.ltx_th.ltx_th_row` | 1 | 1 |
| `span.ltx_pubnote.ltx_role_thanks` | 1 | 1 |
| `code.ltx_font_typewriter.ltx_verbatim` | 1 | 1 |
| `span.ltx_framed.ltx_framed_underline.ltx_text` | 1 | 1 |
| `em.ltx_emph.ltx_font_italic.ltx_font_serif.ltx_markedasmath` | 1 | 1 |
| `th.ltx_align_left.ltx_border_bb.ltx_border_r.ltx_border_t.ltx_td.ltx_th.ltx_th_row` | 1 | 1 |
| `span.ltx_contact.ltx_role_note` | 1 | 1 |
| `div.ltx_subtitle` | 1 | 1 |
| `div.ltx_keywords` | 1 | 1 |
| `th.ltx_align_left.ltx_border_tt.ltx_td.ltx_th.ltx_th_row` | 1 | 1 |
| `td.ltx_align_left.ltx_border_tt.ltx_nopad_r.ltx_td` | 1 | 1 |
| `th.ltx_align_left.ltx_border_t.ltx_td.ltx_th.ltx_th_row` | 1 | 1 |
| `td.ltx_align_left.ltx_border_t.ltx_nopad_r.ltx_td` | 1 | 1 |
| `span.ltx_bib_type.ltx_text` | 1 | 1 |
| `h2.ltx_subtitle` | 1 | 1 |
| `div.ltx_date.ltx_role_creation` | 1 | 1 |
| `div.ltx_role_dedicatory` | 1 | 1 |
| `div.ltx_classification` | 1 | 1 |
| `p.ltx_align_right.ltx_p` | 1 | 1 |
| `h1.ltx_title.ltx_title_part` | 1 | 1 |
| `span.ltx_tag.ltx_tag_part` | 1 | 1 |
| `h2.ltx_title.ltx_title_chapter` | 1 | 1 |
| `span.ltx_tag.ltx_tag_chapter` | 1 | 1 |
| `h6.ltx_title.ltx_title_subparagraph` | 1 | 1 |
| `span.ltx_outerquote` | 1 | 1 |
| `dt.ltx_item` | 1 | 1 |
| `span.ltx_marginpar.ltx_marginpar_right` | 1 | 1 |
| `pre.ltx_verbatim` | 1 | 1 |
| `figcaption.ltx_caption.ltx_subgraphics` | 1 | 1 |
| `span.ltx_tag.ltx_tag_subfigure` | 1 | 1 |
| `span.ltx_WARNING` | 1 | 1 |
| `span.ltx_INFO` | 1 | 1 |
| `h2.ltx_title.ltx_title_index` | 1 | 1 |
| `h2.ltx_title.ltx_title_glossary` | 1 | 1 |
| `h2.ltx_cv_heading.ltx_title` | 1 | 1 |
| `span.ltx_cv_entry_date` | 1 | 1 |
| `span.ltx_cv_item_label` | 1 | 1 |
| `span.ltx_cv_item_content` | 1 | 1 |

