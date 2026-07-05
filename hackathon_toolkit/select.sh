#!/usr/bin/env bash
# select.sh — given a patient input, rank which clinical skills to run (READ-ONLY,
# suggest-only). Uses the local Qwen LLM selector. Nothing is executed.
#
#   bash /app/hackathon_toolkit/select.sh "reports chest pain and shortness of breath"
#
# Add --raw to print the full JSON instead of the pretty summary.
set -uo pipefail
source "$(dirname "$0")/env.sh"
cd /app
gbrain_unlock
gbrain_require_lmstudio || exit 1

RAW=0; ARGS=()
for a in "$@"; do [ "$a" = "--raw" ] && RAW=1 || ARGS+=("$a"); done
INPUT="${ARGS[*]:-}"
[ -z "$INPUT" ] && { echo "usage: select.sh \"<patient input>\" [--raw]"; exit 2; }

echo "══ Ranking skills for: «$INPUT» ══"
OUT="$(timeout 180 bun "$GBRAIN_SRC" orchestrate "$INPUT" --json 2>/dev/null)"
if [ "$RAW" = "1" ]; then printf '%s\n' "$OUT"; exit 0; fi

printf '%s' "$OUT" | bun -e '
const j = JSON.parse(await Bun.stdin.text());
const recs = j.recommendations ?? [];
if (!recs.length) { console.log("  (no clinical skill matched — generic input, nothing routed)"); }
for (const r of recs) console.log(`  → ${r.skill}  (role: ${r.role}, confidence: ${r.confidence ?? "?"})\n     ${r.reason ?? ""}`);
if (j.notes?.length) console.log("  notes: " + j.notes.join("; "));
' 2>/dev/null || printf '%s\n' "$OUT"
