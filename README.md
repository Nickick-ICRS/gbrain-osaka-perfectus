# GBrain — Care-Team Decision Support (Osaka / Perfectus)

A hackathon build that turns [GBrain](#about-the-gbrain-base) into a **clinical
decision-support system for a dementia care home**. Paste a resident's history,
and a team of role-agents — a **nurse**, a **psychiatrist**, and a
**general-medicine** physician — review it, deliberate, and hand a human reviewer
a ranked set of next actions grounded in the care home's own protocols.

Everything runs **on local models (Qwen via LM Studio), no API keys, no data
leaving the machine** — a hard requirement for handling 要配慮個人情報
(sensitive personal data) under Japan's APPI. The system is **decision support,
never autonomous diagnosis**, and no resident-identifying data is ever written
into a reusable skill.

**📊 [Pitch deck →](https://docs.google.com/presentation/d/18MxuXQ6JaM5t4s0EeEaxo8lZ9Dq8PjpRzDeADUQjZhY/edit?usp=sharing)**

---

## What we built on top of GBrain

GBrain gives us the substrate: a local knowledge brain (embedded Postgres via
PGLite), hybrid retrieval, and a skill/agent framework. On top of it we added
four things.

### 1. A skill distiller — brain data → anonymised, routable skills

We import the care home's protocols and data exports into the brain, then a local
Qwen model **reads the brain and writes a `SKILL.md`** — a reusable
decision-support procedure for one clinical role. Every generated skill passes
through a **hard PII gate** (`src/core/distiller/anonymise.ts`): the run aborts if
any resident name, room number, date, age, or facility name survives. Skills are
"how to do a task," stripped of anyone's identity.

- Engine: `src/core/distiller/` (extract → author → anonymise → land)
- Two distilled skills shipped: `skills/nurse-behavioral-fall-risk/`,
  `skills/psych-caregiver-burden-support/` — each with `routing-eval.jsonl`
  fixtures (100% top-1 routing).

### 2. A patient orchestrator — route a presentation to the right role

Given a resident's presentation, the orchestrator ranks which clinical skills
apply and which role should act. It is **suggest-only by default**
(`orchestrate_input`, read scope); execution happens only behind an explicit
local-only op (`orchestrate_run`).

- An **APPI gate** (`src/core/orchestrator/custom-skills.ts`) routes patient data
  **only** to role-tagged clinical skills — generic skills are refused the data
  and the refusal is logged.
- **Role briefs** (`roles/*.md`) prime each agent with its professional scope
  (`role-brief.ts`) before it runs a task.
- Medical-term detection (`medical-terms.ts`) and a temporal backtest
  (`orchestrator/backtest.ts`) support the routing.
- Roles are a frozen contract: `nurse | psychiatrist | general-medicine`.

### 3. A live care-team dashboard

A zero-dependency web UI over the orchestrator. Paste a history (one event per
line, oldest first — the last line is the current presentation), and **watch the
three role-agents review → deliberate → vote in real time**, then read the ranked
next steps, the medical terms detected, and the audit line naming any generic
skills that were refused patient data.

- `src/dashboard/` — `server.ts` (Bun.serve, no npm deps) drives the **real**
  pipeline through instrumented seams; the APPI gate is never bypassed.
- Suggest-only: it never executes skills.

### 4. Care-team debate (Task 4, planned)

The design for the agents to **debate the correct course of action** and arbitrate
by **weighted majority vote** (general-medicine = 2, psychiatrist = 2, nurse = 1),
with hard clinical-safety precedence overriding the vote. Spec:
[`hackathon_planning/task4-agent-debate.md`](hackathon_planning/task4-agent-debate.md).

---

## Run the dashboard locally

The dashboard needs no database and no API keys (it drives the deterministic
selector unless you toggle the LLM ranker on). It reads the skills straight off
disk.

```bash
bun run dashboard          # → http://localhost:4321
```

Inside the dev container, publish the port:

```bash
docker run --rm -p 4321:4321 -v "$PWD:/app" -w /app oven/bun:1 bun run dashboard
```

Then open **http://localhost:4321**, paste a resident history (one event per
line, oldest first), and watch the care team deliberate. Full panel-by-panel
walkthrough: [`src/dashboard/README.md`](src/dashboard/README.md).

Env knobs: `GBRAIN_DASHBOARD_PORT` (default 4321), `GBRAIN_SKILLS_DIR`
(default `<repo>/skills`).

---

## Run the GBrain agent with Qwen (local models, no API keys)

The full pipeline — import data, distill skills, route patients, execute skills —
runs against a local **LM Studio** stack, so no sensitive data ever leaves the
machine.

**Prereqs**

- **LM Studio** running on the host at `:1234` with both models loaded:
  - chat / tools: `qwen/qwen3.6-27b`
  - embeddings: `nomic-embed-text-v1.5` (768-dimensional)
  - Verify: `curl -s http://localhost:1234/v1/models`
- The gbrain container running: `docker exec -it gbrain-gbrain-1 bash`
- Run gbrain **from source** (`bun /app/src/cli.ts`) — the compiled binary can't
  load PGLite's extensions.

**The toolkit** (`hackathon_toolkit/`) wraps the whole flow. Run these inside the
container:

```bash
source hackathon_toolkit/env.sh          # LM Studio base URLs + a `gbrain` wrapper
bash hackathon_toolkit/status.sh         # health check: models, brain, skills, resolver

bash hackathon_toolkit/import.sh         # load data into the brain (chunk + embed)

# Distill a new skill from the brain (Task 1):
bash hackathon_toolkit/learn-skill.sh nurse-pain-assessment nurse \
  "pain,discomfort,grimacing,pain scale" \
  "Nurse decision-support for non-verbal pain assessment in dementia residents." \
  "pain and discomfort observations and the ASG/psychomotor comfort duties"

# Route a patient input (Task 2):
bash hackathon_toolkit/select.sh "reports chest pain and shortness of breath"   # rank (suggest-only)
bash hackathon_toolkit/run.sh    "reports chest pain and shortness of breath"   # rank + execute
```

Full script reference: [`hackathon_toolkit/README.md`](hackathon_toolkit/README.md).
Reproducible setup / rebuild-from-scratch runbook:
[`hackathon_planning/LOCAL-MODELS-SETUP.md`](hackathon_planning/LOCAL-MODELS-SETUP.md).
Living status:
[`hackathon_planning/PROGRESS.md`](hackathon_planning/PROGRESS.md).

> **Known limitation (local model):** the LLM selector (`select.sh`) is reliable.
> `run.sh` executes each skill via an inline worker, but skills that make several
> brain lookups can trip the local Qwen's parallel-tool-call handling. Single-lookup
> flows run clean. The proper fix (a sequential-tool server, e.g. vLLM) is tracked
> in `PROGRESS.md`.

---

## Compliance & safety posture

- **Decision support, not diagnosis.** Nothing runs autonomously; a human reviews
  every recommendation. `orchestrate_input` and the dashboard are suggest-only;
  execution is behind an explicit local-only op.
- **APPI / 要配慮個人情報.** Patient data routes only to role-tagged clinical
  skills; the routing refuses generic skills and logs it. Distilled skills pass a
  hard PII gate — no resident names, room numbers, dates, ages, or facility names.
- **Local by default.** The whole pipeline runs on local models (Qwen via LM
  Studio); no resident data leaves the machine.
- Distilled skills are **candidate drafts** pending clinician review, not final
  clinical guidance.

---

## Where things live

| What | Path |
|---|---|
| Skill distiller (Task 1) | `src/core/distiller/` |
| Patient orchestrator (Task 2) | `src/core/orchestrator/` |
| Live dashboard | `src/dashboard/` |
| Agent role briefs | `roles/` |
| Distilled + seed skills | `skills/<slug>/SKILL.md` (+ `RESOLVER.md`, `manifest.json`) |
| Local-model toolkit | `hackathon_toolkit/` |
| Plans, status, setup, task specs | `hackathon_planning/` |
| Raw / patient data (gitignored) | `hackathon_raw_data/` |

---

## Contributing / dev container

GBrain runs on [Bun](https://bun.sh). The repo ships a dev container so nothing
lands on your host:

```bash
docker build -f .devcontainer/Dockerfile -t gbrain-dev .devcontainer
docker run --rm -it \
  -v "$PWD":/app -w /app \
  -v gbrain-node-modules:/app/node_modules \
  -v gbrain-bun-cache:/root/.bun/install/cache \
  gbrain-dev bash
# inside the container:
bun install                # first run only (cached in a named volume)
bun run dev init --pglite  # 2-second local brain, no server, no DB
bun test                   # unit suite (PGLite, no DB required)
```

Test loops: `bun run test` (fast), `bun run verify` (pre-push gate),
`bun run ci:local` (full Docker-backed CI). Detail in
[`CONTRIBUTING.md`](CONTRIBUTING.md).

---

## About the GBrain base

This is a fork of **GBrain**, a personal-knowledge brain and retrieval layer for
AI agents (hybrid search, a self-wiring knowledge graph, synthesis with
citations, and a skill/agent framework). Two engines behind one contract: PGLite
(embedded Postgres via WASM, zero-config default) and Postgres + pgvector for
scale. We use it as the substrate for the care-team system above.

Base-project reference for agents and operators:

- [`AGENTS.md`](AGENTS.md) — entry point for agents · [`CLAUDE.md`](CLAUDE.md) — deep operating context
- [`docs/INSTALL.md`](docs/INSTALL.md) — every install path · [`docs/architecture/`](docs/architecture/) — system design
- [`llms.txt`](llms.txt) / [`llms-full.txt`](llms-full.txt) — documentation map for LLMs

## License

MIT. Base project: GBrain. Origin story: [`docs/ethos/ORIGIN.md`](docs/ethos/ORIGIN.md).
