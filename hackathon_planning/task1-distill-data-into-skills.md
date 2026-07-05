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

## Built so far — landed on master (+ batch/adapter/guardrails in PR)

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
- **`distiller/load-skills.ts`** — real `loadExistingSkills` over a resolved skills dir, reusing
  `list_skills`' own primitives so the decider sees exactly what `list_skills` reports.
- **`distiller/extract.ts`** — deterministic topic extractor: clusters `BrainRecord`s by care
  lane + stable key into `CandidateTopic`s. APPI: non-clinical records dropped + counted.
- **`distill` op** (`operations.ts`, `localOnly`, `read`) → `gbrain distill "<title>" --summary …
  --role …` runs the v0 decider against the real skill catalog. Keyless, end-to-end.
- **`distiller/adapters/almage.ts`** — Almage export (`transmissions`) → `BrainRecord[]`, with
  role inference (`staffRole` → lane; defaults to generalist) and category/tag mapping.
- **`distiller/batch.ts` + `distill_batch` op** — extract topics from many records then decide
  each, with an aggregate summary. `cat export.json | gbrain distill-batch` or `--records-file`.
- **`distiller/resolver-sync.ts` + `sync_resolver` op** — Step 7: move `## Uncategorized` rows
  into their functional-area section (patient-care roles → "Patient care"). Dry-run by default,
  `--apply` writes. Deterministic, keyless.
- **Guardrail:** `test/fixtures/distiller/decision-eval.jsonl` + `test/distiller-eval.test.ts` —
  representative clinical topics → expected decisions, run against the real seed skills.
- Container-verified (`oven/bun:1`): all distiller + op-guard tests + `bun run typecheck` green;
  `bun run verify` 31/31.

## What's left after the distiller

Grouped by next slice; the LLM-key dependency is called out because it gates most execution.

- **A. Topic extractor.** ✅ `extract.ts` (deterministic) + `adapters/almage.ts` (real data
  adapter) + `distill_batch` (many records → topics → decisions). Remaining: adapters for other
  sources / a live `query`-backed feed.
- **B. Wire the seams:** ✅ `loadExistingSkills` → real `list_skills`. Remaining: `retrieveBrainData`
  → role-scoped `query`/`search`, and `classify` → **LLM classifier** (needs key; also the only
  real source of `split`).
- **C. Executors:** ✅ `execute.ts` — create / update / split, wired via the `distill_apply` op.
  Body authoring is an injected seam (a local subagent job); every authored body passes the
  **TS anonymiser** (`anonymise.ts`) as a hard gate, then `assemble.ts` builds the SKILL.md +
  routing-eval + manifest entry + RESOLVER row (via `apply-fs.ts`). The deterministic parts are
  tested with a mock author; the **LLM authoring runs on the local stack** (LM Studio / Qwen).
- **D. CLI surface:** ✅ `gbrain distill` (single-topic decide) + `gbrain distill-batch`
  (records/export) + `gbrain sync-resolver` (Step 7) + `gbrain distill-apply` (decide→author→
  anonymise→land; `--dry-run` for decide-only) landed.
- **E. Guardrails:** ✅ distiller decision-eval fixtures + test; every generated skill ships a
  routing-eval stub and is anonymised. Remaining: run `check-resolvable`/conformance after an
  apply as an automated post-step.

**Keyless slices — ✅ done:** extractor + Almage adapter (A) · `loadExistingSkills` (B) ·
create/update/split executor + anonymiser + assembler (C, deterministic parts) · `distill` /
`distill-batch` / `sync-resolver` / `distill-apply` ops (D) · decision-eval guardrail (E).
**Runs on the local stack (no cloud key):** the `distill-apply` authoring subagent + the
`retrieveBrainData` enrichment.
**Still v0 / optional:** the `classify` LLM seam in the decider (v0 token-overlap today; the
local model could replace it for real `split` detection).

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

### 3. Create path (Q1 = none) — ✅ landed (`execute.ts` + `distill_apply`)
- Subagent authors the body → anonymiser hard gate → `assemble.ts` builds SKILL.md + routing-eval
  → `apply-fs.ts` writes the file, registers the manifest entry, inserts the RESOLVER row.
  `gbrain distill-apply` runs decide→author→land; `--dry-run` for decide-only. LLM runs local.

### 4. Exact match (Q2 = no) — ✅ done
- `distiller` returns `exact_match` ⇒ executor no-op. Log and stop.

### 5. Update path (Q3 = no) — ✅ landed (`execute.ts` update branch)
- Reads the existing skill, authors a new body, anonymises it, and **swaps the body while
  preserving the frontmatter** (name/role/triggers unchanged). No manifest/resolver churn.

### 6. Split executor (Q3 = yes) — ✅ landed (`execute.ts` split branch)
- Authors + lands each target skill and **deprecates the original** (banner). New rows are
  inserted under "Patient care"; `gbrain sync-resolver` (Step 7) keeps functional-area
  categorization tidy afterward.

### 7. Orchestrator sync — ✅ done (`sync_resolver` op + `resolver-sync.ts`)
- `skillify scaffold` appends rows under `## Uncategorized`; `gbrain sync-resolver` moves them
  into their functional-area section (patient-care roles → "Patient care"). Deterministic (no
  agent needed), dry-run by default, `--apply` writes.

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
