# hackathon_toolkit — run everything we built

One folder of scripts to **generate clinical skills from brain data** and **use the
patient orchestrator**, all on the local LM Studio / Qwen stack (no API keys).

> Full status + architecture: [../hackathon_planning/PROGRESS.md](../hackathon_planning/PROGRESS.md).
> Setup / rebuild: [../hackathon_planning/LOCAL-MODELS-SETUP.md](../hackathon_planning/LOCAL-MODELS-SETUP.md).

## Prereqs
- The gbrain container is running and **LM Studio** serves on `:1234` with a chat model
  (`qwen/qwen3.6-27b`) + an embedding model (`nomic-embed-text-v1.5`) loaded.
- Run these **inside the container**: `docker exec -it gbrain-gbrain-1 bash`.
- Scripts run gbrain **from source** (`bun /app/src/cli.ts`) — the compiled binary can't load PGLite.

## The scripts (run in this order the first time)

| Script | What it does |
|---|---|
| `source env.sh` | Load LM Studio env + a `gbrain` shell wrapper (once per shell; optional — scripts self-source). |
| `bash status.sh` | Health check: LM Studio, brain contents, resolved models, skills, resolver health. |
| `bash import.sh [files.docx…]` | Load data into the brain (chunk + embed). Optionally convert `.docx` → markdown first. |
| `bash learn-skill.sh <slug> <role> "<triggers>" "<desc>" "<topic>"` | **Distill** brain data → an anonymised, routable `skills/<slug>/SKILL.md` (+ resolver + manifest). |
| `bash select.sh "<patient input>"` | **Rank** which clinical skills fit an input (read-only, suggest-only). |
| `bash run.sh "<patient input>"` | **Rank + execute** skills, feeding outputs back across rounds (inline; write-scope). |
| `bash smoke.sh [pipeline\|orchestrator]` | Run the end-to-end smoke tests. |

## Typical flows

**Add a new skill from the data**
```bash
bash learn-skill.sh nurse-pain-assessment nurse \
  "pain,discomfort,grimacing,pain scale" \
  "Nurse decision-support for non-verbal pain assessment in dementia residents." \
  "pain and discomfort observations and the ASG/psychomotor comfort duties"
```

**Route a patient input to skills**
```bash
bash select.sh "expressing suicidal thoughts and depression"      # → psych-risk-screen
bash run.sh    "reports chest pain and shortness of breath"       # ranks + executes
```

## Layout
- **This folder** = the front door (thin, friendly wrappers + shared `env.sh`).
- The generation engine lives in `../hackathon_planning/`: `distill-skill.sh` (author→anonymise→land),
  `anonymise.py` (PII gate), `docx2md.py` (docx→md), `test-local-pipeline.sh`, `orchestrate-smoke.sh`.
- Learned skills land in `../skills/<slug>/SKILL.md` (git-tracked) + rows in `RESOLVER.md` / `manifest.json`.

## Execution mode (local model)
Both `select.sh` (LLM selector) and `run.sh` (rank + execute) are reliable on the local
Qwen 27b. `run.sh` executes each skill via **toolless synthesis**: the skill's `SKILL.md`
body is inlined into the prompt and the subagent runs with no tools (a single synthesis
turn), so it doesn't depend on the local model's fragile multi/parallel tool-call handling.
The legacy tool-driven path stays available for Postgres/robust-tool-calling deployments.
See PROGRESS.md for details.
