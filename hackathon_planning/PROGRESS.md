# PROGRESS — GBrain hackathon (local-models build)

Living status + runbook. Last updated: **2026-07-05**.
Full setup detail: [LOCAL-MODELS-SETUP.md](./LOCAL-MODELS-SETUP.md). Task specs: [task1](./task1-distill-data-into-skills.md), [task2](./task2-patient-orchestrator.md).

---

## Status at a glance

| Area | State | Notes |
|---|---|---|
| Local models (no API keys) | ✅ done | Qwen `qwen/qwen3.6-27b` (chat/tools) + `nomic-embed-text-v1.5` (768d) via LM Studio `:1234` |
| Source data → Brain | ✅ done | 4 role protocols + 3 data exports imported → **7 pages / 72 chunks**, embedded locally |
| Skill-learning pipeline | ✅ done | `distill-skill.sh` — brain data → landed `SKILL.md`, verified end-to-end |
| Skills learned (both roles) | ✅ done | `nurse-behavioral-fall-risk` (nurse) + `psych-caregiver-burden-support` (psychiatrist); `resolver_health: OK` |
| Anonymisation of generated skills | ✅ done | `distill-skill.sh` runs the authored body through `anonymise.py` (hard gate — aborts on residual PII). Both skills regenerated clean. |
| Task 2 selector (`gbrain orchestrate`) | ✅ done | LLM selector works on local Qwen — verified 5/5 (nurse-triage / psych-risk-screen / patient-history-review + generic-refused) |
| Task 2 execution — inline executor | ✅ done | added `makeInlineJobRunner` (execute.ts); `orchestrate_run` now runs skills via an in-process worker (works on PGLite, no daemon). `worker:true` opts into the Postgres daemon path. |
| Task 2 execution — skill run reliability | ⚠️ blocked on model | Applied `parallel_tool_calls:false` (fetch-injected for openai-compat chat, `gateway.ts`) + bumped executor turns to 18. **LM Studio/Qwen honors it only intermittently** (3 test runs: 1 went sequential but hit max_turns empty, 2 still emitted parallel calls → `tool results are missing…`). So multi-lookup skill execution is still unreliable **with this model/server**. Root cause is local tool-calling, not gbrain. Fix: a model/server with solid tool-calling (e.g. vLLM's `--tool-call-parser`), or single-lookup skills. |
| Runnable toolkit | ✅ done | `hackathon_toolkit/` — one folder of scripts: status / import / learn-skill / select / run / smoke (+ `env.sh`, `README.md`) |
| routing-eval fixtures for new skills | ✅ done | both distilled skills ship `routing-eval.jsonl` (8 cases each), same paraphrase rule as the seeds |
| Clinician review of drafts | ⏳ todo | drafts are candidates, not final (APPI / decision-support) |
| Remaining raw files | ⏳ optional | KPI + questionnaire `.docx`, 4 "Public Paper" `.pdf` not yet converted |

---

## Mental model (don't conflate these)

- **Brain** = memory/knowledge = imported pages + vector embeddings. Lives in a DB (`/root/.gbrain/brain.pglite`), **not** in git.
- **Skill** = reusable decision-support procedure = a `SKILL.md`. Lives in the **repo** (`skills/<slug>/`), git-tracked.
- **"Learning a skill"** = **distillation**, not ML training: a local Qwen reads the Brain and *writes* a `SKILL.md`.

---

## Quickstart — what to run

**Prereq:** LM Studio running on the host at `:1234` with both models loaded
(`curl -s http://localhost:1234/v1/models` should list `qwen/qwen3.6-27b` +
`text-embedding-nomic-embed-text-v1.5`).

```bash
# 1. enter the container and load env + the `gbrain` wrapper
docker exec -it gbrain-gbrain-1 bash
source ~/.bashrc                 # gbrain() -> `bun /app/src/cli.ts`; sets LM Studio base URLs

# 2. sanity / inspect
gbrain stats                     # brain contents
gbrain list                      # imported pages
gbrain check-resolvable          # validate skills + routing (expect: resolver_health OK)

# 3. full local smoke test (import -> query -> subagent tool loop)
bash /app/hackathon_planning/test-local-pipeline.sh

# 4. import more data (markdown only; convert docx/pdf/xlsx first — step 6)
cp "/app/hackathon_raw_data/Processed Data"/*.md /root/import-staging/
gbrain import /root/import-staging

# 5. LEARN a new skill from the brain  (this is the core Task-1 command)
SLUG=nurse-pain-assessment ROLE=nurse \
  TRIGGERS='pain,discomfort,grimacing,pain scale' \
  DESC='Nurse decision-support for non-verbal pain assessment in dementia residents.' \
  TOPIC='pain/discomfort observations and the ASG/psychomotor comfort duties' \
  bash /app/hackathon_planning/distill-skill.sh
#   ROLE must be one of: nurse | psychiatrist | general-medicine

# 6. convert more .docx -> markdown before importing
python3 /app/hackathon_planning/docx2md.py "/app/hackathon_raw_data/Processed Data" \
  "/app/hackathon_raw_data/<file>.docx"

# 7. ask the brain a question (retrieval + local-Qwen synthesis)
gbrain query "what behavioral and fall risks are recorded for residents?"
```

> **Two hard rules** (baked into the scripts, but remember for ad-hoc use):
> 1. Run gbrain **from source** — `bun /app/src/cli.ts` (the `gbrain()` wrapper). The compiled
>    `bin/gbrain` can't load PGLite's pgvector/pg_trgm extensions.
> 2. Run subagents with **`gbrain jobs submit subagent --params '{...}' --follow`**, NOT
>    `gbrain agent run` (the latter never executes on PGLite — it only polls).
> If a command hangs on *"Timed out waiting for PGLite lock"*:
> `rm -rf /root/.gbrain/brain.pglite/.gbrain-lock /root/.gbrain/brain.pglite/postmaster.pid`

---

## The flow

```
raw .docx/.pdf/.xlsx ──docx2md.py──▶ Processed Data/*.md ──gbrain import──▶ BRAIN (pages+vectors)
                                                                               │
                       distill-skill.sh: Qwen authors grounded body → anonymise.py (hard PII gate) → assemble
                                                                               ▼
                          skills/<slug>/SKILL.md + RESOLVER.md row + manifest.json  (git-tracked, anonymised)
                                                                               │
                                          Task 2 orchestrator ranks by role+triggers ──▶ runs skill(s)
```

---

## Scripts (`hackathon_planning/`)

| Script | Does | Run |
|---|---|---|
| `distill-skill.sh` | **Learn a skill** from brain data → anonymised, landed `SKILL.md` + routing + manifest | `SLUG=… ROLE=… TRIGGERS=… DESC=… TOPIC=… bash …/distill-skill.sh` |
| `anonymise.py` | PII / facility-name scrubber; **hard gate** auto-invoked by `distill-skill.sh` (aborts if identifiers survive) | (auto) |
| `test-local-pipeline.sh` | Smoke-test the whole local stack | `bash …/test-local-pipeline.sh` |
| `docx2md.py` | Convert `.docx` → markdown (stdlib) | `python3 …/docx2md.py <outdir> a.docx b.docx` |
| `LOCAL-MODELS-SETUP.md` | Reproducible setup runbook (rebuild from scratch) | read |

---

## Where things live

| What | Path | Git |
|---|---|---|
| Skills (learned output) | `skills/<slug>/SKILL.md` + `RESOLVER.md` + `manifest.json` | ✅ commit |
| Scripts + docs | `hackathon_planning/` | ✅ |
| Raw/processed data | `hackathon_raw_data/` (+ `Processed Data/`) | 🚫 gitignored |
| Brain (pages + embeddings) | `/root/.gbrain/brain.pglite` (Docker volume `gbrain-brain`) | 🚫 |
| Config | `/root/.gbrain/config.json` + brain DB | 🚫 |
| Models | LM Studio on host `:1234` | — |

---

## Current brain + skills (2026-07-05)

**Brain pages (7):** `agents_01_geriatric_care_assistant_asg_pasa_en`,
`agents_02_psychomotor_therapist_pasa_en`, `agents_03_psychologist_pasa_en`,
`agents_04_pasa_asg_daily_organization_protocol_en`, `data_-_hackathon_data_1` (EHR export),
`data_-_hackathon_data_2_en` (resident transmission log), `data_-_hackathon_data_3_en` (caregiver study).

**Patient-care skills (5) in `skills/RESOLVER.md`:** `nurse-triage`, `psych-risk-screen`,
`patient-history-review` (seeds) + `nurse-behavioral-fall-risk`, `psych-caregiver-burden-support` (distilled).

---

## Next steps

1. **Fix skill-execution reliability** (the ⚠️ above). `parallel_tool_calls:false` is now
   injected but LM Studio/Qwen ignores it intermittently, so `run.sh` is still flaky for
   multi-lookup skills. Real fix is model/server-side: serve the chat model via **vLLM**
   (`--enable-auto-tool-choice --tool-call-parser hermes`) or another server with robust
   tool-call handling, OR keep skills single-lookup (one tool call per turn round-trips
   cleanly — proven by `distill-skill.sh`). Selector (`select.sh`) already works reliably.
2. Clinician review of distilled drafts before treating them as more than candidates.
3. (Optional) distill more skills — one `learn-skill.sh` run each. The 4 "Public Paper"
   PDFs (BPSD best-practice guidelines) are the next distillation source — see the
   consolidated 22-skill catalog analysis; they're public guidelines, so no PII risk.

## Everyday commands (see hackathon_toolkit/README.md)

    docker exec -it gbrain-gbrain-1 bash          # get in the container
    bash /app/hackathon_toolkit/status.sh          # health check
    bash /app/hackathon_toolkit/import.sh          # load data into the brain
    bash /app/hackathon_toolkit/learn-skill.sh <slug> <role> "<triggers>" "<desc>" "<topic>"
    bash /app/hackathon_toolkit/select.sh "<patient input>"    # rank skills (works)
    bash /app/hackathon_toolkit/run.sh    "<patient input>"    # rank + execute (see ⚠️ caveat)
