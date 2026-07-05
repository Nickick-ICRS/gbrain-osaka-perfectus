# Task 2 — Patient orchestrator

> **Start here:** read [`00-setup-and-split.md`](./00-setup-and-split.md) for the frozen
> interface contract, shared-file ownership, and the 3-way split before picking up work.

Take new patient input, weigh it against historical information + current state, and suggest
which skills to run — feeding each skill's output back so later routing can build on earlier
results.

> Scope note: excludes the database/engine layer. Retrieval + storage are treated as a
> given black box.

## Current-state map (flowchart → repo)

| Flowchart node | Status | What backs it today |
|---|---|---|
| Patient input (new state) | ✅ | `query` op / `volunteer_context` are entry points. |
| Historical information | ✅ strong | Hybrid + relational retrieval (`hybridSearch`, `relationalRetrieval` in `src/core/search/`). |
| Weigh new state vs. history | ✅ substrate | Same retrieval layer. |
| **Suggest which skills to run** | ❌ **missing — the core hinge** | `gbrain advisor` suggests *maintenance* actions from *install health*, ignoring input. `volunteer_context` maps input → **pages, never skills**. Routing = an LLM reading `RESOLVER.md`; the one code matcher is offline, and `routing-eval --llm` is an unimplemented placeholder. |
| Run skills | ✅ plumbing | `gbrain agent run` + minion job queue (fan-out/gather, steering). |
| Feedback loop | 🟡 plumbing | Fan-out manifest + aggregator exist, but "output of skill A picks skill B" is not autonomous. |

**Core gap:** no component takes `(new input + history + state)` and returns `ranked skills to
run`. Good news — this hinge shares a shape the repo already ships: the advisor's
**collectors → rank → ranked list** (`src/core/advisor/run.ts`). Clone that shape; feed it an
input.

## Reuse, don't build (Phase 0)

- History retrieval — `query` op + `hybridSearch` / `relationalRetrieval` (`src/core/search/`)
- Input → relevant records — `volunteer_context` (`src/core/context/volunteer.ts`)
- Rank-and-return skeleton — advisor (`src/core/advisor/run.ts`, `rankFindings`)
- Skill catalog — `list_skills` / `get_skill` ops (`src/core/operations.ts`)
- Execution — `gbrain agent run` + minions (`src/commands/agent.ts`, `minion-orchestrator`)

## Build plan

### 1. `orchestrate_input` op (net-new)
- Model directly on `src/core/advisor/run.ts` (collectors → rank), but accept an input.
- Pipeline: `input + state` → retrieve history (`query` / `volunteer_context`) →
  **skill selector** → ranked skills.
- Register in `src/core/operations.ts` as a `read`-scope op so CLI + MCP are generated from it.

### 2. Skill selector — the missing hinge
- MVP: LLM ranks `list_skills` (descriptions + triggers) given `(input + history)`.
- `list_skills` now carries `role` (`nurse | psychiatrist | general-medicine`, landed #2) —
  filter/weight candidates by the target care lane before ranking. Import `SKILL_ROLES`
  from `src/core/skill-frontmatter.ts`; don't hardcode the set.
- This is exactly the seat the unimplemented `routing-eval --llm` placeholder was left for —
  `src/commands/routing-eval.ts:14`.
- Harden later: embedding similarity between input and skill descriptions; deterministic
  pre-filter before the LLM tie-break.

### 3. Execution
- `gbrain agent run` per selected skill.
- Respect `pain_triggered` routing (native subagent first, minions on pain signals) per
  `skills/conventions/subagent-routing.md`.

### 4. Feedback loop
- Two options for "outputs inform next routing":
  - **(a)** fan-out manifest + aggregator (existing plumbing), or
  - **(b)** re-invoke `orchestrate_input` with prior skill outputs appended to `state`.
- **(b) is cleanest** for the loop in the diagram — the orchestrator re-ranks with new evidence
  each pass; stop when no new skills are suggested.

## Guardrails (Phase 3)
- `routing-eval` fixtures covering representative patient cases (input → expected skills).
- Conformance + typecheck gates.
- Healthcare/compliance: patient data is sensitive under Japan's APPI (要配慮個人情報).
  Enforce source-isolation (`sourceScopeOpts`), keep an audit trail of what was auto-run, and
  gate auto-execution — the orchestrator suggests and supports decisions; it must not act as an
  autonomous diagnosis engine. Decide the auto-run boundary early; it shapes the whole design.

## Suggested first slice
Steps 1 + 2 (the `orchestrate_input` op + LLM skill selector). Highest-value missing piece,
demo-able on its own, and cloning the advisor's shape means filling a known-shaped hole rather
than inventing architecture.

## Cross-link with Task 1
The skills this orchestrator ranks and runs are exactly the Nurse/Psychiatrist skills built and
maintained in **Task 1**. When Task 1 adds/splits/updates a skill (and its resolver rows), this
orchestrator automatically routes against the current set.
