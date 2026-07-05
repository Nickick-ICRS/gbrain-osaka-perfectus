#!/usr/bin/env bash
# import.sh — load source data into the brain (chunk + embed via local nomic).
#
#   bash /app/hackathon_toolkit/import.sh                 # import all *.md in Processed Data/
#   bash /app/hackathon_toolkit/import.sh a.docx b.docx   # convert these .docx → md first, then import
#
# `gbrain import` only ingests markdown/code/images — convert .docx/.pdf/.xlsx first
# (docx2md.py handles .docx). Data files live in hackathon_raw_data/ (gitignored).
set -uo pipefail
source "$(dirname "$0")/env.sh"
cd /app
gbrain_unlock
gbrain_require_lmstudio || exit 1

PROCESSED="/app/hackathon_raw_data/Processed Data"
STAGE="/root/import-staging"
mkdir -p "$STAGE" "$PROCESSED"

# Optional: convert any .docx passed as args into Processed Data/ as markdown.
if [ "$#" -gt 0 ]; then
  echo "══ Converting $# .docx → markdown ══"
  python3 "$PLANNING_DIR/docx2md.py" "$PROCESSED" "$@"
fi

echo "══ Staging markdown ══"
rm -f "$STAGE"/*.md 2>/dev/null || true
cp "$PROCESSED"/*.md "$STAGE"/ 2>/dev/null && echo "  staged $(ls "$STAGE"/*.md | wc -l) file(s)" || { echo "  ✗ no .md in '$PROCESSED'"; exit 1; }

echo "══ Import (chunk + embed) ══"
timeout 300 bun "$GBRAIN_SRC" import "$STAGE" 2>&1 | tail -8
echo; timeout 40 bun "$GBRAIN_SRC" stats 2>/dev/null | head -4
