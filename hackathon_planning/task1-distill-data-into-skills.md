# Task 1 — Distill existing data into skills

> **Start here:** read [`00-setup-and-split.md`](./00-setup-and-split.md) for the frozen
> interface contract, shared-file ownership, and the 3-way split before picking up work.

Turn stored brain data into reusable **Nurse** and **Psychiatrist** skills, deciding per
candidate topic whether to create, leave as-is, update, or split a skill — and keep the
orchestrator (RESOLVER) in sync.

> Scope note: excludes the database/engine layer. Retrieval + storage are treated as a
> given black box.

## Current-state map (flowchart → repo)

| Flowchart node | Status | What backs it today |
|---|---|---|
| Nurse / Psychiatrist split | ✅ done (Dev A, #2) | `role: nurse \| psychiatrist \| general-medicine` frontmatter tag shipped in `src/core/skill-frontmatter.ts` (`SKILL_ROLES`), surfaced via `list_skills`. Tag new skills with it. |
| **Q1: suitable skill exists?** | ✅ decided (v0) | `distiller/decide.ts` classifies a topic vs same-lane skills (token overlap); `none` ⇒ no suitable skill. LLM classifier still a seam. |
| No → create + update orchestrator | 🟡 planned | `distiller/run.ts` emits the `skillify scaffold <slug>` action; **executor + agent-authoring not wired**. `skillify` still appends rows only under `## Uncategorized`. |
| Q2: update with new info? | ✅ decided (v0) | `distiller/decide.ts` returns `exact_match` vs `update` by new-info ratio. Execution (skillopt/rewrite) not wired. |
| No (exact match) → done | ✅ done | `distiller` returns `exact_match` ⇒ no-op action. |
| **Q3: enough nuance to split?** | 🟡 seam | `split` is modelled end-to-end; produced only by the injected LLM classifier (v0 deterministic pass does not emit it). |
| Yes → split into 2 + update orchestrator | 🟡 planned | `distiller/run.ts` frames the split action (scaffold both, deprecate, categorize); **executor not wired**. |
| No → update skill | ✅ strong | `gbrain skillopt` optimizes a `SKILL.md` body, validation-gated (`src/core/skillopt/`, 23 modules) — the "fold in new data" wrapper is the remaining glue. |

**Core gap (narrowed):** the **decider** now exists (`src/core/distiller/`, this PR) — a pure
decision pass with injected seams. What's still missing: the upstream **topic extractor** (read
brain content → candidate topics), the create/update/split **executors**, and wiring the seams
(`list_skills`, `query`, the LLM classifier) to real implementations.

## Built so far — branch `nick/task1-distiller` (in PR)

The decision layer, mirroring the orchestrator's collect → decide → report shape. Pure, with
injected seams, so it runs with **no DB and no LLM**:
- **`distiller/decide.ts` — the decider (Q1+Q2+Q3).** v0 deterministic token-overlap ranker
  over same-lane skills → `none | exact_match | update`. `split` is reserved for the injected
  LLM classifier (marked TODO), which the types + pipeline already support.
- **`distiller/run.ts`** — one pass: APPI role guard (fail-closed, reuses the shared
  `isHealthcareRole` policy) → optional brain-data enrichment → **lane restriction** (never
  compares across care lanes) → decide → framed `proposedAction` per branch.
- **`distiller/types.ts`** — reuses the frozen `SkillRole` contract, so decider and parser can't drift.
- Returns a **plan** (`DistillReport`), not side effects — executing scaffold/skillopt/resolver-sync
  is CLI-side, exactly as the orchestrator returns a report rather than running `gbrain agent run`.
- Container-verified (`oven/bun:1`): distiller tests + `bun run typecheck` green.

## What's left after the distiller

Grouped by next slice; the LLM-key dependency is called out because it gates most execution.

- **A. Topic extractor (net-new, upstream).** Nothing yet *produces* `CandidateTopic`s — read
  the brain data (role-scoped) and cluster into candidate topics. Deterministic parts are
  buildable keyless.
- **B. Wire the seams:** `loadExistingSkills` → real `list_skills` (keyless); `retrieveBrainData`
  → role-scoped `query`/`search`; `classify` → **LLM classifier** (needs key; also the only real
  source of `split`).
- **C. Executors:** create (`skillify scaffold` + agent-authoring), update (`skillopt`/rewrite),
  split (scaffold two + deprecate + categorize rows). Authoring/rewrite **need the LLM key**.
- **D. CLI surface:** a `gbrain distill` verb + an op in `operations.ts` (shared file — Dev A
  arbitrates) so CLI + MCP are generated. The op running the v0 decider is buildable keyless.
- **E. Guardrails:** `routing-eval` fixtures for representative nurse/psych topics; conformance +
  typecheck gates before any generated skill lands.

**Next buildable slice (keyless):** A (deterministic) + `loadExistingSkills` wiring + the
`gbrain distill` op → a runnable command that reads real skills and emits real v0 decisions,
before spending on an LLM.

## Reuse, don't build (Phase 0)

- Skill format + frontmatter — `src/core/skill-frontmatter.ts`
- Scaffolding — `gbrain skillify scaffold` (`src/commands/skillify.ts`, `src/core/skillify/generator.ts`)
- Skill-body optimization — `gbrain skillopt` (`src/core/skillopt/`)
- Duplicate/gap/DRY lint — `gbrain check-resolvable` (`src/core/check-resolvable.ts`)
- Routing table — `skills/RESOLVER.md` + `AGENTS.md` merge (`src/core/check-resolvable.ts`)
- Authoring executor — `gbrain agent run` (`src/commands/agent.ts`)

## Build plan

MVP each decider as an **LLM call** (via `gbrain agent run`); harden to deterministic later.

### 1. Role axis ✅ (landed by Dev A, #2)
- `role: nurse | psychiatrist | general-medicine` frontmatter tag shipped in
  `src/core/skill-frontmatter.ts` (import the allowed set from `SKILL_ROLES`); surfaced via `list_skills`.
- Remaining for T1: a query/tag to pull the brain slice per role (source or tag filter).

### 2. The decider (collapses Q1 + Q2 + Q3) — ✅ v0 landed (`distiller/decide.ts`); LLM classifier TODO
- Given a candidate topic, classify against same-lane skills → `{ none | exact_match | update | split }`.
  v0 is deterministic token overlap; the LLM classifier is an injected seam.
- Reuse `check-resolvable` MECE for the deterministic exact-trigger case (future pre-filter).

### 3. Create path (Q1 = none) — 🟡 planned by `distiller/run.ts`; executor not wired
- `distiller` emits the `gbrain skillify scaffold <slug>` action → authoring agent
  (`gbrain agent run`) fills the stub from retrieved brain data → resolver row auto-appended (exists).
  Executor + agent-authoring need the LLM key.

### 4. Exact match (Q2 = no) — ✅ done
- `distiller` returns `exact_match` ⇒ no-op action. Log and stop.

### 5. Update path (Q3 = no) — 🟡 planned; executor not wired
- Wrap `skillopt` with an "incorporate new data" benchmark, **or** MVP: agent-run rewrite of the
  `SKILL.md` body, gated by `routing-eval` + the conformance test. (LLM key.)

### 6. Split executor (Q3 = yes) — net-new — 🟡 decision seam + plan; executor not wired
- LLM classifier proposes 2 skills → `skillify scaffold` both → deprecate the original → categorize
  the new resolver rows (MVP: agent performs the functional-area edit per the
  `functional-area-resolver` playbook at `skills/functional-area-resolver/SKILL.md`).

### 7. Orchestrator sync — ❌ not started
- `skillify scaffold` appends rows automatically; add a small step to move them out of
  `## Uncategorized` into the right functional area. MVP: agent-driven.

## Guardrails (Phase 3)
- `routing-eval` fixtures covering representative nurse/psychiatrist topics.
- Conformance + typecheck gates before any skill lands.
- Healthcare/compliance: patient-derived content is sensitive under Japan's APPI
  (要配慮個人情報). Enforce source-isolation (`sourceScopeOpts`), keep an audit trail, and frame
  skills as decision support — not autonomous diagnosis.

## Suggested first slice
Steps 1 → 2 → 3 (role tagging + decider + create path). ✅ The decision layer is landed
(`src/core/distiller/`, this PR); role tagging done (#2). Remaining in this loop: the create-path
executor (needs the LLM key). Next keyless slice: the topic extractor + `list_skills` wiring +
`gbrain distill` op (see "What's left after the distiller").
