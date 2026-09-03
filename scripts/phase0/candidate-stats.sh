#!/usr/bin/env bash
# 对已下载的候选 HTML 重算特征统计（修正 LaTeXML 版本正则，增加 cite/ref/typewriter 列）
S="$(cd "$(dirname "$0")" && pwd)"
cnt() { grep -o "$1" "$2" | wc -l | tr -d ' '; }
printf 'id\tkb\tlatexml\tmath\teqn\tlist\talgo\ttabular\ttd\tnote\tthm\tproof\tERR\tsvg\timg\tbib\tcite\tref\ttt\ttitle\n'
for f in "$S"/candidates/*.html; do
  id=$(basename "$f" .html)
  kb=$(( $(wc -c < "$f") / 1024 ))
  ver=$(grep -o 'LaTeXML[^(]*(version [^)]*)' "$f" | head -1 | sed -E 's/LaTeXML ?([a-z]*) ?\(version ([^)]*)\)/\2\1/')
  title=$(grep -o '<title>[^<]*</title>' "$f" | head -1 | sed -E 's#</?title>##g' | cut -c1-50)
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
    "$id" "$kb" "${ver:-?}" \
    "$(cnt '<math' "$f")" "$(cnt 'ltx_equation' "$f")" "$(cnt 'ltx_listingline' "$f")" "$(cnt 'ltx_float_algorithm\|ltx_algorithm' "$f")" \
    "$(cnt 'class="ltx_tabular' "$f")" "$(cnt 'ltx_td' "$f")" "$(cnt 'ltx_note_content' "$f")" "$(cnt 'ltx_theorem' "$f")" "$(cnt 'ltx_proof' "$f")" \
    "$(cnt 'ltx_ERROR' "$f")" "$(cnt '<svg' "$f")" "$(cnt '<img' "$f")" "$(cnt 'ltx_bibitem' "$f")" \
    "$(cnt 'ltx_cite' "$f")" "$(cnt 'ltx_ref' "$f")" "$(cnt 'ltx_font_typewriter' "$f")" "$title"
done
