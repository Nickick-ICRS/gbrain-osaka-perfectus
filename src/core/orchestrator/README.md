# orchestrator/ — patient orchestrator (Task 2, rough template)

Takes a new patient input + state, weighs it against retrieved history, and returns a **ranked
list of skills to run**. Mirrors the advisor's `collect → rank → report` shape.

> Status: **rough template.** The gate + pipeline are real; retrieval and the LLM selector are
> injected seams / placeholders. No DB dependency yet.

## The load-bearing rule

**For healthcare / patient data we run our OWN custom clinical skills — never generic GBrain
skills.** See `custom-skills.ts`. The gate is an **allowlist by role**: a skill is eligible only
if its `SKILL.md` frontmatter declares `role: nurse | psychiatrist | general-medicine` (the
frozen `SkillRole` contract in `skill-frontmatter.ts`). Every generic
bundled GBrain skill (query, ingest, maintain, …) lacks that role and is therefore ineligible for
patient routing.

- Eligible skills → selected + ranked.
- Generic skills that *would* have matched → recorded in `excluded_generic` for the audit trail
  (APPI 要配慮個人情報), never run.
- `assertAllCustom()` is a fail-closed backstop: if a future selector bug ever proposes a
  non-clinical skill, the run throws instead of leaking patient data.

## Files

| File | Role |
|---|---|
| `types.ts` | Core types (`PatientInput`, `CandidateSkill`, `OrchestratorReport`, …). |
| `custom-skills.ts` | **The policy.** Role allowlist, partition, fail-closed assert. |
| `select.ts` | Skill selector. v0 = deterministic trigger overlap; TODO = LLM ranker. |
| `run.ts` | One routing pass. Injected deps for history retrieval + skill loading. |

## Where the real pieces plug in (TODOs)

1. `run.ts` `deps.loadCandidateSkills` → wire to the `list_skills` op.
2. `run.ts` `deps.retrieveHistory` → wire to `query` / `volunteer_context`.
3. `select.ts` `selectSkills` → replace with the LLM ranker (keep the signature).
4. Register a `read`-scope `orchestrate_input` op in `src/core/operations.ts` (Dev A arbitrates
   that shared file — see `hackathon_planning/00-setup-and-split.md`).

## Feedback loop

Call `runOrchestrator` again with the previous pass's outputs in `ctx.priorSkillOutputs`; the
selector re-ranks with the new evidence. Stop when recommendations stabilise or go empty.
