#!/usr/bin/env bash
# test-local-pipeline.sh — end-to-end smoke test of gbrain running on LOCAL LM Studio models.
#
# Validates the full Task-1 path with no cloud API keys:
#   import (local nomic embeddings) → stats → hybrid-search query (local chat synthesis)
#   → subagent tool loop (the real distill-a-skill test) on qwen/qwen3.6-27b.
#
# RUN IT INSIDE THE CONTAINER:
#   docker exec -it gbrain-gbrain-1 bash /app/hackathon_planning/test-local-pipeline.sh
# or from a shell already inside the container:
#   bash /app/hackathon_planning/test-local-pipeline.sh
#
# Everything runs from SOURCE (bun /app/src/cli.ts) because the shipped
# compiled bin/gbrain can't load PGLite's pgvector/pg_trgm extension bundles.

set -uo pipefail

# ── local-model config (LM Studio, OpenAI-compatible on :1234; no auth) ──────
export OPENROUTER_BASE_URL="${OPENROUTER_BASE_URL:-http://localhost:1234/v1}"
export OPENROUTER_API_KEY="${OPENROUTER_API_KEY:-lmstudio}"   # dummy; LM Studio ignores auth
export OLLAMA_BASE_URL="${OLLAMA_BASE_URL:-http://localhost:1234/v1}"
export LLAMA_SERVER_BASE_URL="${LLAMA_SERVER_BASE_URL:-http://localhost:1234/v1}"

CHAT_MODEL="${CHAT_MODEL:-openrouter:qwen/qwen3.6-27b}"
LMSTUDIO="${LMSTUDIO:-http://localhost:1234/v1}"
GB=(bun /app/src/cli.ts)
IMPORT_SRC="/app/hackathon_raw_data/Processed Data"
STAGE="/root/import-staging"
BRAIN="/root/.gbrain/brain.pglite"

FAILED=0
pass() { echo "  ✓ $*"; }
fail() { echo "  ✗ $*"; FAILED=1; }
hr()   { echo; echo "════ $* ════"; }

# PGLite uses an exclusive lock; a killed run can leave stale artifacts that
# make every later command hang on "Timed out waiting for PGLite lock".
clear_locks() {
  pkill -9 -f 'src/cli.ts' 2>/dev/null || true
  sleep 1
  rm -rf "$BRAIN/.gbrain-lock" "$BRAIN/postmaster.pid" 2>/dev/null || true
}

stat_num() { timeout 40 "${GB[@]}" stats 2>/dev/null | grep -iE "^$1" | grep -oE '[0-9]+' | head -1; }

# ── 0. preflight ─────────────────────────────────────────────────────────────
hr "0. Preflight"
if curl -sf -m 5 "$LMSTUDIO/models" >/dev/null; then pass "LM Studio reachable at $LMSTUDIO"
else fail "LM Studio NOT reachable at $LMSTUDIO — start the server + load models"; exit 1; fi
clear_locks
if timeout 40 "${GB[@]}" stats >/dev/null 2>&1; then pass "brain readable (no stale lock)"
else fail "brain stats failed"; fi

# ── 1. stage markdown (only .md — no spaces in path, no duplicate PDFs) ──────
hr "1. Stage processed markdown"
mkdir -p "$STAGE"; rm -f "$STAGE"/*.md 2>/dev/null || true
if cp "$IMPORT_SRC"/*.md "$STAGE"/ 2>/dev/null; then
  pass "staged $(ls "$STAGE"/*.md 2>/dev/null | wc -l) markdown file(s) → $STAGE"
else fail "no .md files found in '$IMPORT_SRC'"; fi

# ── 2. import + embed (local nomic) ──────────────────────────────────────────
hr "2. Import (chunk + embed via ollama:nomic @768d)"
timeout 300 "${GB[@]}" import "$STAGE" 2>&1 | tail -12
pages=$(stat_num Pages); emb=$(stat_num Embedded)
echo "  → pages=${pages:-0}  embedded=${emb:-0}"
[ "${pages:-0}" -gt 0 ] && pass "pages imported" || fail "no pages imported"
[ "${emb:-0}"   -gt 0 ] && pass "chunks embedded locally" || fail "no embeddings — local embed path broken"

# ── 3. retrieval + synthesis (hybrid search + local chat) ────────────────────
hr "3. Query (retrieval + local-Qwen synthesis) — may be slow (thinking model)"
timeout 240 "${GB[@]}" query "What behavioral issues and fall risks are recorded for residents?" 2>&1 | tail -30

# ── 4. subagent tool loop — the real Task-1 distillation test ────────────────
hr "4. Subagent tool loop: distill a Nurse skill draft from the brain"
cat > /tmp/skill-task.json <<JSON
{"prompt":"You are distilling stored nursing-home brain data into a reusable Nurse skill. First call the query tool to find behavioral and fall-risk transmission notes about residents. Then write a concise draft SKILL.md body in markdown (about 15 lines) with a title line, a one-sentence purpose, a when-to-use trigger list, and 3 to 5 decision-support steps grounded in what you found. Frame it as decision support, not diagnosis. Output only the markdown.","model":"$CHAT_MODEL","max_turns":8}
JSON
echo "  params: $(cat /tmp/skill-task.json)"
echo "  running (inline worker; allow a few minutes)..."
timeout 480 "${GB[@]}" jobs submit subagent --params "$(cat /tmp/skill-task.json)" --follow 2>&1 | tail -45

# ── verdict ──────────────────────────────────────────────────────────────────
hr "RESULT"
if [ "$FAILED" = "0" ]; then echo "✓ Local pipeline steps passed (inspect step 3 + 4 output for quality)."
else echo "✗ One or more steps FAILED — see ✗ lines above."; fi
exit "$FAILED"
