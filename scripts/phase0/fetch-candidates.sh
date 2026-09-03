#!/usr/bin/env bash
# 候选 fixture 发现：按类别+日期查 arXiv API，下载 HTML，统计 ltx_* 特征，输出 TSV
set -u
S="$(cd "$(dirname "$0")" && pwd)"
UA="ArxivTranslate-fixture-fetch/0.1 (srjoe2022@gmail.com)"
OUT="$S/candidates.tsv"
printf 'id\tyear\tcat\thttp\tkb\tlatexml\tmath\tequation\tlisting\talgo\ttabular\ttd\tnote\ttheorem\tproof\terror\tsvg\timg\tbib\ttitle\n' > "$OUT"

# 类别 起 止（YYYYMMDD）
QUERIES=(
  "math.CO 20231201 20231231"
  "cs.LG 20231201 20231231"
  "cs.PL 20231201 20231231"
  "hep-ph 20231201 20231231"
  "cs.CL 20240901 20240930"
  "astro-ph.GA 20250601 20250630"
  "math.AP 20260801 20260831"
  "cs.LG 20260801 20260831"
  "cs.DS 20260801 20260831"
  "cs.PL 20260801 20260831"
)

cnt() { grep -o "$1" "$2" | wc -l | tr -d ' '; }

for q in "${QUERIES[@]}"; do
  set -- $q; cat="$1"; from="$2"; to="$3"; year="${from:0:4}"
  url="https://export.arxiv.org/api/query?search_query=cat:${cat}+AND+submittedDate:[${from}0000+TO+${to}2359]&max_results=6&sortBy=submittedDate&sortOrder=descending"
  ids=$(curl -sS -g -L --max-time 60 -A "$UA" "$url" | grep -o '<id>http://arxiv.org/abs/[^<]*</id>' | sed -E 's#.*/abs/([0-9.]+)v[0-9]+</id>#\1#')
  sleep 3
  for id in $ids; do
    f="$S/candidates/$id.html"
    if [ -s "$f" ]; then code=200; else code=$(curl -sS -L -g --max-time 90 -A "$UA" -o "$f" -w "%{http_code}" "https://arxiv.org/html/$id"); fi
    sleep 3
    if [ "$code" != "200" ]; then
      printf '%s\t%s\t%s\t%s\t-\t-\t-\t-\t-\t-\t-\t-\t-\t-\t-\t-\t-\t-\t-\t-\n' "$id" "$year" "$cat" "$code" >> "$OUT"
      rm -f "$f"; continue
    fi
    kb=$(( $(wc -c < "$f") / 1024 ))
    ver=$(grep -o 'LaTeXML (version [^)]*)' "$f" | head -1 | sed -E 's/.*version ([^)]*)\)/\1/')
    title=$(grep -o '<title>[^<]*</title>' "$f" | head -1 | sed -E 's#</?title>##g' | cut -c1-60)
    printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
      "$id" "$year" "$cat" "$code" "$kb" "${ver:-?}" \
      "$(cnt '<math' "$f")" "$(cnt 'ltx_equation' "$f")" "$(cnt 'ltx_listingline' "$f")" "$(cnt 'ltx_float_algorithm\|ltx_algorithm' "$f")" \
      "$(cnt 'ltx_tabular' "$f")" "$(cnt 'ltx_td' "$f")" "$(cnt 'ltx_note_content' "$f")" "$(cnt 'ltx_theorem' "$f")" "$(cnt 'ltx_proof' "$f")" \
      "$(cnt 'ltx_ERROR' "$f")" "$(cnt '<svg' "$f")" "$(cnt '<img' "$f")" "$(cnt 'ltx_bibitem' "$f")" "$title" >> "$OUT"
  done
done
echo DONE >> "$OUT"
