# Task 4 — Agent head-to-head (care-team debate)

> **Start here:** read [`00-setup-and-split.md`](./00-setup-and-split.md) for the frozen
> interface contract, shared-file ownership, and the split before picking up work.

Have the care-team role agents — **Nurse**, **Psychiatrist**, **General Medicine** — *debate*
the correct course of action for a patient, then converge on a **cross-role care plan**: who
does what (e.g. *send the nurse to run the falls assessment*, *have the psychiatrist talk to
the resident about anxiety*), with contested items surfaced rather than silently decided.

Where Task 2 answers **"which skills should run?"** (one ranked list), Task 4 answers
**"what should each role DO, and where do the roles disagree?"** — a multi-agent deliberation
that produces role-assigned actions plus an explicit conflict/agreement trail.

> Scope note: excludes the database/engine layer. Retrieval + storage are a given black box.
> Debaters + chair are LLM subagents that run on the **local stack** (LM Studio / Qwen,
> `LOCAL-MODELS-SETUP.md`) — this machine can't exercise them, so the design is built with
> injected seams and validated deterministically, exactly like Tasks 1 and 2.

## Open decisions (plan of record — override here, not in code)

Two forks shape the whole design. Current plan of record is the max-reuse / best-APPI-posture
choice; both are isolated behind seams so flipping them is a swap, not a rewrite.

| Decision | Plan of record | Notes |
|---|---|---|
| **Conflict arbitration** | **Weighted majority vote** — each role votes on a competing action; votes are weighted by clinical authority: **general-medicine = 2, psychiatrist = 2, nurse = 1** (weights config-overridable). Highest weighted-vote action wins. This is **deterministic** (no chair LLM). | Ties break to the more conservative / higher-acuity action; if *still* tied → `status: contested → needs_human_sign_off` (the APPI safety valve). The weighting reflects the role briefs: `nurse` maps to an ASG care *assistant* (not an RN), below the coordinating physician and the psychologist. |
| **Debate ↔ orchestrator direction** | **Debate DRIVES; the orchestrator is the substrate on both ends.** Debate *determines the actions* (the course of action). The orchestrator's per-role ranker *seeds* each debater's opening position (grounds proposals in real available skills), and its executor *runs* the agreed actions. Control flows **debate → execution**, not orchestrator → debate. | See "Answering the direction question" below for why this beats composing already-*executed* orchestrator outputs. |

## Answering the direction question

*"Should the debate compose the orchestrator's action results, or determine what skills the
orchestrator runs to make the actions?"* — **The latter: debate determines, orchestrator executes.**

The unit the user cares about is an **action** ("send the nurse to run the falls assessment").
An action is *carried out* by running a skill — which is exactly what the orchestrator's executor
does. So the deliberation has to sit **above** the skill-run: you debate the plan, *then* execute.
Composing already-*executed* orchestrator outputs would mean you ran the skills before deciding
whether they were the right course of action — backwards for a "decide what to do" step.

Concretely the orchestrator appears on **both ends, as substrate, never as the decider**:

```
patient input + state
      │
      ▼
orchestrate_input, run PER ROLE  ──►  each role's candidate skills   (grounding seed)
      │                                (nurse: [falls-risk,…]  psych: [risk-screen,…]  gen-med: […])
      ▼
DEBATE  (nurse ⇄ psychiatrist ⇄ general-medicine, primed by role briefs)
      │   rounds → weighted-vote arbitration
      ▼
CARE PLAN  =  agreed role-assigned actions  +  contested (→ human sign-off)
      │
      ▼
orchestrator executor  ──►  runs the AGREED actions as subagent jobs
```

One nuance worth stating: the orchestrator today emits a *single reconciled ranked list*, not
three conflicting role opinions. To get a debate we run its **ranker once per role** (candidates
filtered to that role) so each debater opens with a real, grounded set of proposed skills — then
the debate is what reconciles them. The ranker is a *candidate generator*, not the decision.

## Current-state map (flowchart → repo)

| Flowchart node | Status | What backs it today |
|---|---|---|
| Patient input + current state | ✅ | `query` op / `volunteer_context`; same entry points Task 2 uses. |
| Retrieve history | ✅ substrate | Hybrid + relational retrieval (`hybridSearch`, `relationalRetrieval`), reused via Task 2's `retrieveHistory` seam (`orchestrator/deps-live.ts`). |
| **Convene the panel (per role)** | 🟡 planned | Roles come from `SKILL_ROLES`; each debater is primed with `loadRoleBrief(rolesDir, role)` (`orchestrator/role-brief.ts`, already wired for execution). Seed positions from `orchestrate_input` per-role recs. |
| **Opening positions (round 1)** | 🟡 planned | Net-new `debate/` module; the debater is an injected LLM seam (mirrors `select-llm.ts`'s injected `chat`). |
| **Cross-examination (rounds 2..N)** | 🟡 planned | Net-new: each role sees others' proposals and endorses / objects / amends; conflicts detected deterministically. |
| **Convergence** | 🟡 pattern exists | Reuse the bounded round-loop shape from `orchestrator/loop.ts` (stop when positions stabilise; `maxRounds` backstop, not the usual exit). |
| **Arbitration (weighted vote)** | 🟡 planned | Net-new, **deterministic**: weighted majority (`gen-med 2 · psych 2 · nurse 1`); ties → conservative action → else `contested`. No LLM. |
| **Care plan (role-assigned actions)** | 🟡 planned | Net-new: ranked `CarePlanItem[]` with `status: agreed \| contested`, rationale, optional `target_skill`, APPI audit trail. |
| Execute agreed actions | ✅ plumbing | Reuse `makeSubagentExecutor` / `makeQueueJobRunner` (`orchestrator/execute.ts`) + the minion queue. Contested items are NOT auto-run under the plan of record. |

**Core gap:** no component takes `(patient input + history + the three role perspectives)` and
returns a **deliberated, role-assigned care plan with an explicit agreement/conflict trail**.
Good news — every *substrate* is shipped (retrieval, role briefs, the convergence-loop shape,
the subagent executor, the injected-`chat` selector pattern). Task 4 is a new **decision layer**
over them, not new plumbing.

## Reuse, don't build (Phase 0)

- Care-team roles (the debaters) — `SKILL_ROLES` (`src/core/skill-frontmatter.ts`); never hardcode the set.
- Role priming (who each debater IS) — `loadRoleBrief` / `defaultRolesDir` (`src/core/orchestrator/role-brief.ts`) + `roles/*.md`.
- Per-role candidate skills (a debater's "tools") — `orchestrate_input` + `buildSkillCatalog` (`SkillCatalogEntry.role`).
- History retrieval — `hybridSearchCached`, via Task 2's `retrieveHistory` seam (`orchestrator/deps-live.ts`).
- Bounded round-loop + convergence — `orchestrator/loop.ts` (adapt, don't fork).
- Execution of agreed actions — `makeSubagentExecutor` + `makeQueueJobRunner` (`orchestrator/execute.ts`).
- LLM seam pattern (injected `chat`, tool-calling + fence-tolerant fallback, re-validate output) — `orchestrator/select-llm.ts`.
- APPI custom-skill gate + `excluded_generic` audit posture — `orchestrator/custom-skills.ts`.
- Op registration → CLI + MCP — `src/core/operations.ts`.

## Build plan

Mirror Tasks 1 & 2: **pure decision core with injected seams**, so the whole thing runs with no
DB and no LLM; the real debaters/chair are subagent jobs on the local stack.

### 1. `src/core/debate/types.ts` — the contract (net-new)
- `RolePosition { role, actions: ProposedAction[], rationale }` — one role's stance in a round.
- `ProposedAction { id, role, action, target_skill?, priority, rationale }` — a concrete thing to
  do (`target_skill` links to a Task 1 skill when the action maps to one).
- `Critique { from_role, action_id, stance: 'endorse' | 'object' | 'amend', note }`.
- `DebateRound { round, positions, critiques }`.
- `Conflict { concern, competing: ProposedAction[], chair_recommendation?, resolution: 'agreed' | 'needs_human_sign_off' }`.
- `CarePlanItem { action: ProposedAction, status: 'agreed' | 'contested' }`.
- `DebateReport { generated_at, input_summary, rounds, care_plan: CarePlanItem[], conflicts, notes[], audit }`.
- Reuse the frozen `SkillRole` (`import type { SkillRole }`); debater/parser can't drift.

### 2. `src/core/debate/run.ts` — one debate pass (net-new; injected seams)
- Seams: `convenePanel(ctx)` (which roles + seed candidate skills), `debate(role, ctx, priorRounds)`
  (the LLM debater — real: subagent job; test: mock), `retrieveHistory` (reuse), `loadBrief` (reuse).
- Round 1: each convened role emits opening `ProposedAction[]` in-lane (primed by its role brief).
- Rounds 2..N: each role sees the others' actions and returns `Critique[]` (+ amended actions).
- APPI gate: only role-tagged clinical debaters ever see patient data (reuse the `custom-skills.ts`
  posture); non-clinical/generic never convened. Every proposal/critique is recorded (audit).

### 3. `src/core/debate/converge.ts` — deterministic convergence + conflict detection (net-new)
- Adapt `orchestrator/loop.ts`: stop when a round surfaces no new action *and* no changed critique;
  `maxRounds` backstop. Convergence is the normal exit.
- Conflict detection is **deterministic** (no LLM): two actions on the same `concern` with opposing
  stances (`object`/competing `amend`) → a `Conflict`. Fully unit-testable.

### 4. `src/core/debate/arbitrate.ts` — weighted majority resolver (net-new; **deterministic, keyless**)
- Each convened role casts a vote (endorse/object per competing action, from its round critiques);
  votes are weighted `{ 'general-medicine': 2, 'psychiatrist': 2, 'nurse': 1 }` (a `ROLE_WEIGHTS`
  const, config-overridable — never hardcoded at call sites). Highest weighted sum wins.
- Tie-break: more conservative / higher-acuity action; if still tied → `needs_human_sign_off`
  (`contested`) — the APPI safety valve.
- No LLM here: arbitration is pure and fully unit-testable. (A resolver *interface* keeps the
  alternatives — safety-first, unweighted majority, full-auto chair — as drop-in swaps.)

### 5. `src/core/debate/plan.ts` — assemble the care plan (net-new; pure)
- Merge agreed actions + arbitrated conflicts into a ranked `CarePlanItem[]` (priority, then
  confidence), each tagged `agreed | contested`, with the full rationale + audit trail.

### 6. Ops (`src/core/operations.ts`) — CLI + MCP (net-new)
- `debate` — **read-scope, suggest-only**: runs the deliberation, returns the care plan. The safe
  default (mirrors `orchestrate_input`). Params: `input`, `patient_id`, `roles?`, `max_rounds?`, `no_llm?`.
- `debate_run` — **write-scope, `localOnly`**: debate + execute the **agreed** actions via the
  existing subagent executor. Contested items are never auto-run (plan of record). Mirrors
  `orchestrate_run`'s opt-in execution boundary.

### 7. Guardrail fixtures (net-new)
- `routing-eval`-style: patient case → expected `care_plan` actions + role assignments **and**
  expected `contested` items (a case engineered to make the roles disagree, to prove the conflict
  path fires). Deterministic decider (`no_llm`) makes these keyless/CI-safe.

**Keyless / CI-safe slices:** types (1) · convergence + conflict detection (3) · **weighted-vote
arbitration (4)** · plan assembly (5) · the `no_llm` deterministic debater · op guards (6) ·
fixtures (7). Note the whole *resolution* path is now deterministic — only the debaters need a model.
**Runs on the local stack (no cloud key):** the LLM debaters (2) + `debate_run` execution —
validated with an `orchestrate-smoke.sh`-style script against a live worker + model.

## Guardrails (Phase 3)
- **APPI (要配慮個人情報).** Patient data reaches ONLY role-tagged clinical debaters (reuse
  `custom-skills.ts`); source-isolation (`sourceScopeOpts`) upstream; a full audit trail of every
  proposal, objection, chair recommendation, and sign-off decision.
- **Decision support, not diagnosis.** Under the plan of record the debate never *finalises* a
  contested clinical action — it recommends and routes to a human. `debate_run` executes agreed
  actions only.
- **Transient transcript, not a template.** The debate output is per-patient and ephemeral, so the
  distiller's anonymiser isn't its gate. But if a recurring plan is later *distilled into a skill*,
  that path already anonymises (Task 1 `anonymise.ts`) — the two compose cleanly.
- **Bounded + local.** `max_rounds` caps cost; debaters/chair run on the local model.
- Conformance + typecheck gates before anything lands; `bun run verify` 31/31 in-container.

## Cross-links
- **Task 1** — the actions a debater proposes reference the Nurse/Psychiatrist/General-Medicine
  skills Task 1 builds (`ProposedAction.target_skill`); executing an agreed action runs that skill.
- **Task 2** — the orchestrator seeds each debater's opening position (per-role skill recs) and its
  subagent executor runs the agreed care plan. Task 4 is the deliberation layer *between* Task 2's
  routing and its execution.
- **Task 3 (evaluation, in progress)** — debate quality is measurable: care-plan accuracy vs the
  fixtures, conflict-detection precision/recall, and did the *right* items land as `contested`.

## Demo target (what "done" looks like)
A patient input where the lanes genuinely tension (e.g. a safety measure the nurse wants vs a
less-restrictive approach the psychiatrist prefers) → `gbrain debate "<input>"` convenes the three
role agents → they exchange positions across a couple of bounded rounds → out comes a care plan:
some actions **agreed** and role-assigned, the genuine disagreement flagged **contested → human
sign-off** with the chair's recommendation attached. Then `gbrain debate-run` executes the agreed
actions as subagent jobs. Proven by the shared debate fixtures.
