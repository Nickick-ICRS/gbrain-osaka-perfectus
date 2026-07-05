#!/usr/bin/env bash
# run.sh — rank AND execute skills for a patient input, feeding outputs back across
# rounds (the feedback loop). Executes each skill via an INLINE in-process worker
# (works on PGLite — no `gbrain jobs work` daemon needed).
#
#   bash /app/hackathon_toolkit/run.sh "reports chest pain and shortness of breath"
#   bash /app/hackathon_toolkit/run.sh "…" --rounds 2 --raw
#
# WRITE-scope, local-only. Decision support — review outputs; not autonomous diagnosis.
#
# NOTE (local-model caveat): skills that make several brain lookups can trip the
# local Qwen's parallel-tool-call handling ("tool results are missing for tool
# calls …"). The selector is reliable; skill execution depends on the model
# emitting sequential tool calls. See hackathon_planning/PROGRESS.md.
set -uo pipefail
source "$(dirname "$0")/env.sh"
cd /app
gbrain_unlock
gbrain_require_lmstudio || exit 1

RAW=0; ROUNDS=2; ARGS=()
while [ "$#" -gt 0 ]; do
  case "$1" in
    --raw) RAW=1; shift ;;
    --rounds) ROUNDS="$2"; shift 2 ;;
    *) ARGS+=("$1"); shift ;;
  esac
done
INPUT="${ARGS[*]:-}"
[ -z "$INPUT" ] && { echo "usage: run.sh \"<patient input>\" [--rounds N] [--raw]"; exit 2; }

echo "══ Orchestrating (rank + execute, inline) for: «$INPUT» ══"
echo "  model=$CHAT_MODEL  rounds=$ROUNDS  (a local run can take a few minutes)"
OUT="$(timeout 900 bun "$GBRAIN_SRC" orchestrate-run "$INPUT" --model "$CHAT_MODEL" --max_rounds "$ROUNDS" --json 2>/dev/null)"
if [ "$RAW" = "1" ]; then printf '%s\n' "$OUT"; exit 0; fi

printf '%s' "$OUT" | bun -e '
const j = JSON.parse(await Bun.stdin.text());
console.log("  stopped: " + j.stopped);
for (const o of (j.priorSkillOutputs ?? [])) {
  const failed = (o.summary ?? "").startsWith("[execution failed");
  console.log(`\n  ── ${o.skill} ${failed ? "✗ FAILED" : "✓"} ──`);
  console.log("  " + (o.summary ?? "").split("\n").join("\n  ").slice(0, 1600));
}
' 2>/dev/null || printf '%s\n' "$OUT"
