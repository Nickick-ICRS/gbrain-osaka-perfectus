# Running GBrain fully local on LM Studio (no API keys)

Reproducible runbook for pointing this brain at **local Qwen + nomic models served by
LM Studio** — zero cloud keys, all data stays on the machine (the APPI-compliant posture
for the patient data). Verified end-to-end on 2026-07-05: import + local embeddings,
hybrid-search query, and the subagent tool loop that distills a skill from brain data.

> **TL;DR of the non-obvious bits** (each cost real debugging time):
> 1. Run gbrain **from source** (`bun src/cli.ts`), NOT the compiled `bin/gbrain` — the
>    binary can't load PGLite's pgvector/pg_trgm extension bundles.
> 2. Embeddings go through the **`ollama` recipe**, not `llama-server` (see §3).
> 3. Run subagents with **`jobs submit subagent --follow`**, NOT `agent run` (see §5).
> 4. The built-in `openai:` provider **cannot** be repointed at LM Studio; use the
>    `ollama` (embeddings) + `openrouter` (chat/tools) recipes with a base-URL override.

---

## 0. Architecture

GBrain routes every LLM call through one AI gateway. A model is a `provider:model` string;
`provider` selects a "recipe" (`src/core/ai/recipes/`). Only **openai-compatible** recipes
honour a custom base URL — the native `openai:`/`anthropic:` recipes are hardwired to their
cloud endpoints. LM Studio speaks the OpenAI API on `:1234`, so we reuse two generic
openai-compatible recipes and repoint both at it:

```
                                          ┌───────────────────────────────────────┐
                                          │ LM Studio  http://localhost:1234/v1     │
 embeddings  ──"ollama:...nomic..."   ──▶ │  • text-embedding-nomic-embed-text-v1.5 │  (768d)
 chat+tools  ──"openrouter:qwen/..."  ──▶ │  • qwen/qwen3.6-27b  (thinking model)   │
                                          └───────────────────────────────────────┘
```

- **Embeddings** → `ollama` recipe (embedding-only; knows nomic = 768d).
- **Chat / expansion / subagent tool loop** → `openrouter` recipe (the openai-compatible
  recipe that declares `chat` with `supports_tools: true`).

## 1. Prerequisites

- The gbrain dev container running (`./RUN-DOCKER-CONTAINER.sh`) — uses `network_mode: host`,
  so `localhost:1234` inside the container reaches LM Studio. Brain persists in the
  `gbrain-brain` volume at `/root/.gbrain`.
- **LM Studio** serving on `:1234` with two models loaded:
  - a chat/instruct model (we use `qwen/qwen3.6-27b`),
  - an embedding model (`text-embedding-nomic-embed-text-v1.5`, native **768** dims).
  - Confirm with `curl -s http://localhost:1234/v1/models`. LM Studio needs **no auth**.

## 2. Persistent environment (base URLs + dummy key)

Base URLs are read from `*_BASE_URL` env vars (folded into the gateway by
`build-gateway-config.ts`). Persist them + a `gbrain` wrapper in the container's `~/.bashrc`:

```bash
cat >> ~/.bashrc <<'EOF'

# --- GBRAIN LM STUDIO (local models) ---
export OPENROUTER_BASE_URL=http://localhost:1234/v1
export OPENROUTER_API_KEY=lmstudio          # dummy; LM Studio ignores auth
export LLAMA_SERVER_BASE_URL=http://localhost:1234/v1
export OLLAMA_BASE_URL=http://localhost:1234/v1
gbrain() { bun /app/src/cli.ts "$@"; }       # run from source; compiled bin/gbrain is broken for PGLite
# --- end GBRAIN LM STUDIO ---
EOF
source ~/.bashrc
```

## 3. Initialize the brain (local embeddings)

Embedding model + dimensions are set at **init only** (file-plane; `config set` rejects them —
changing later means wipe + reinit). Use the **`ollama` recipe** and **omit** `--embedding-dimensions`
so it auto-locks nomic's native 768:

```bash
cd /app
gbrain init --pglite \
  --embedding-model ollama:text-embedding-nomic-embed-text-v1.5 \
  --chat-model openrouter:qwen/qwen3.6-27b \
  --expansion-model openrouter:qwen/qwen3.6-27b
```

> **Why not `llama-server`?** For a fixed-size model like nomic, the `llama-server` recipe
> both *requires* an explicit `--embedding-dimensions` and *rejects* it as a "custom
> dimension" — a dead end. The `ollama` recipe has `default_dims: 768` and auto-assigns it.

## 4. Route chat + unlock the non-Anthropic tool loop (DB-plane)

```bash
gbrain config set models.default openrouter:qwen/qwen3.6-27b
gbrain config set agent.use_gateway_loop true --force   # `agent.` isn't a known prefix → --force;
                                                         # subagent.ts reads it via engine.getConfig
```
Without `agent.use_gateway_loop=true`, the subagent handler refuses any non-Anthropic model.
The `--force`/"nothing reads this" warning is harmless — the key IS read at runtime.

## 5. Run work — the execution model on PGLite

The durable background worker (`gbrain jobs work`) is **Postgres-only** (PGLite's exclusive
file lock blocks a second process). On PGLite you run jobs **inline**:

- ✅ **Subagent / authoring:** `gbrain jobs submit subagent --params '{...}' --follow`
  — spins up an in-process worker and executes. Example:
  ```bash
  gbrain jobs submit subagent \
    --params '{"prompt":"<task>","model":"openrouter:qwen/qwen3.6-27b","max_turns":8}' \
    --follow
  ```
- ❌ **`gbrain agent run --follow`** does NOT execute on PGLite — it only *polls* for a
  background worker that never runs, leaving the job in `waiting`.
- ✅ `gbrain query "..."`, `gbrain import <dir>` — run in-process, work as normal.

## 6. Verify

```bash
gbrain models        # every tier → openrouter:qwen/qwen3.6-27b; embedding → ollama:...nomic (768d)
bash /app/hackathon_planning/test-local-pipeline.sh   # full pipeline smoke test
```
Expected: import → N chunks embedded; query returns ranked chunks; the subagent job
completes with `turns_count >= 1` (it called a tool) and returns a grounded skill draft.

## 7. Troubleshooting

| Symptom | Cause & fix |
|---|---|
| `Extension bundle not found: .../vector.tar.gz` | You ran the compiled `bin/gbrain`. Use `bun src/cli.ts` (the `gbrain()` wrapper). |
| `Timed out waiting for PGLite lock` | A killed run left a stale lock. `pkill -9 -f 'src/cli.ts'` then `rm -rf /root/.gbrain/brain.pglite/.gbrain-lock /root/.gbrain/brain.pglite/postmaster.pid`. Note: `docker exec … timeout N …` orphans the container process — put `timeout` *inside* the container command. |
| `providers test --model … → Missing Authentication header` | Red herring — that path ignores base_urls and hits real openrouter.ai. Ignore it; verify with a real op (`query`, `jobs submit subagent --follow`). |
| Import ingests nothing | `gbrain import` only walks markdown/code/images. Convert docx/pdf/xlsx to `.md` first. |
| Chat returns empty text with few `max_tokens` | `qwen3.6-27b` is a thinking model — it spends early tokens on `reasoning_content`. Give it enough tokens; it fills `content` after reasoning. |

## Reference: what's configured

- `~/.gbrain/config.json`: `engine=pglite`, `embedding_model=ollama:text-embedding-nomic-embed-text-v1.5`,
  `embedding_dimensions=768`, `chat_model`/`expansion_model=openrouter:qwen/qwen3.6-27b`.
- DB-plane: `models.default=openrouter:qwen/qwen3.6-27b`, `agent.use_gateway_loop=true`.
- Env (`~/.bashrc`): the four `*_BASE_URL` = `http://localhost:1234/v1`, dummy `OPENROUTER_API_KEY`.
- Smoke test: `hackathon_planning/test-local-pipeline.sh`.
