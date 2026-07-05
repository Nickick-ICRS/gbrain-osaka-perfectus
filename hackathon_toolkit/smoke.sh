#!/usr/bin/env bash
# smoke.sh — run the full local-stack smoke tests (pipeline + orchestrator).
#     bash /app/hackathon_toolkit/smoke.sh            # both
#     bash /app/hackathon_toolkit/smoke.sh pipeline   # import→query→subagent only
#     bash /app/hackathon_toolkit/smoke.sh orchestrator
set -uo pipefail
source "$(dirname "$0")/env.sh"
cd /app
gbrain_unlock
which="${1:-all}"

if [ "$which" = "all" ] || [ "$which" = "pipeline" ]; then
  echo "════════ PIPELINE SMOKE (import → query → subagent) ════════"
  bash "$PLANNING_DIR/test-local-pipeline.sh"
fi
if [ "$which" = "all" ] || [ "$which" = "orchestrator" ]; then
  echo "════════ ORCHESTRATOR SMOKE (selector + execute) ════════"
  bash "$PLANNING_DIR/orchestrate-smoke.sh"
fi
