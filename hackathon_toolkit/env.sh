#!/usr/bin/env bash
# env.sh — shared environment for the hackathon toolkit. SOURCE this, don't run it:
#     source /app/hackathon_toolkit/env.sh
#
# Sets the LM Studio base URLs + a `gbrain` wrapper that runs FROM SOURCE
# (the compiled bin/gbrain can't load PGLite extensions). Every toolkit script
# sources this, so configuration lives in ONE place.

# LM Studio (OpenAI-compatible, on :1234, no auth). Override before sourcing if needed.
export OPENROUTER_BASE_URL="${OPENROUTER_BASE_URL:-http://localhost:1234/v1}"
export OPENROUTER_API_KEY="${OPENROUTER_API_KEY:-lmstudio}"   # dummy; LM Studio ignores auth
export OLLAMA_BASE_URL="${OLLAMA_BASE_URL:-http://localhost:1234/v1}"
export LLAMA_SERVER_BASE_URL="${LLAMA_SERVER_BASE_URL:-http://localhost:1234/v1}"

# Default chat model + paths.
export CHAT_MODEL="${CHAT_MODEL:-openrouter:qwen/qwen3.6-27b}"
export GBRAIN_SRC="${GBRAIN_SRC:-/app/src/cli.ts}"
export PLANNING_DIR="${PLANNING_DIR:-/app/hackathon_planning}"
export BRAIN_DIR="${BRAIN_DIR:-/root/.gbrain/brain.pglite}"

# `gbrain` from source (interactive shells). Scripts use: bun "$GBRAIN_SRC" …
gbrain() { bun "$GBRAIN_SRC" "$@"; }

# Clear a stale PGLite lock left by a killed run (safe: rm only, no pkill).
gbrain_unlock() { rm -rf "$BRAIN_DIR/.gbrain-lock" "$BRAIN_DIR/postmaster.pid" 2>/dev/null || true; }

# Fail fast if LM Studio isn't reachable.
gbrain_require_lmstudio() {
  if ! curl -sf -m 5 "${OPENROUTER_BASE_URL%/v1}/v1/models" >/dev/null 2>&1; then
    echo "✗ LM Studio not reachable at $OPENROUTER_BASE_URL — start it + load models." >&2
    return 1
  fi
}
