# 00 — Setup & work split (read this first)

Coordination doc for 3 devs working Task 1 + Task 2 in parallel. Read before picking up work.

- **Task 1** — [distill data into skills](./task1-distill-data-into-skills.md)
- **Task 2** — [patient orchestrator](./task2-patient-orchestrator.md)

> Scope note: excludes the database/engine layer. Retrieval + storage are a given black box.
>
> **The database and all raw/patient data live in [`raw_data/`](../raw_data/)** — a tracked
> folder whose contents are gitignored. Point `gbrain` at it locally; never commit its contents.

## The one thing that will bite us: shared files

Both tasks write the same places. Agree ownership + the interface **before** coding, or hour-one
merge conflicts follow.

| Shared surface | Touched by | Owner | Rule |
|---|---|---|---|
| `src/core/skill-frontmatter.ts` (the `role:` tag) | T1 produces, T2 reads | **Dev A** | Land first; frozen contract (below). |
| `src/core/operations.ts` (new ops) | T1 + T2 both register ops | Dev A arbitrates | Each dev adds their op in a separate PR; A resolves order. |
| `skills/RESOLVER.md` / `AGENTS.md` (routing rows) | T1 mutates, T2 ranks against | Dev A arbitrates | Append-only during hackathon; categorize at the end. |

## Frozen interface contract (agree this first)

The seam where "T1 produces skills" meets "T2 ranks them". Freeze it so both sides can mock.

**Skill frontmatter** (`skills/<slug>/SKILL.md`) — proposed additive field:
```yaml
name: <slug>
description: <one-line, used by the T2 selector for ranking>
triggers: [<phrase>, ...]
role: nurse | psychiatrist | shared   # NEW — Dev A lands this
tools: [...]
mutating: true|false
```

**`list_skills` output** (what the T2 selector consumes) — confirm the real shape in
`src/core/operations.ts`, then treat as fixed:
```jsonc
{ "name": "...", "path": "...", "description": "...", "role": "...", "triggers": ["..."] }
```

Until Dev A lands the real thing, Dev B and Dev C mock against this contract.

## Sequencing (there IS a dependency)

T2's selector ranks skills that T1 tags with `role`. So foundations gate everything:

1. **Dev A first (~first hour):** `role` frontmatter + 2–3 seed skills + eval fixtures.
2. **Then B and C in parallel**, building against the frozen contract.

## Branching / PR flow

- No more commits straight to `master`. Feature branch per stream:
  `<name>/task1-<slice>`, `<name>/task2-<slice>`, `<name>/foundations`.
- Small PRs, one reviewer (cross-review between the two feature devs).
- If using Conductor: branch name must match the workspace name (see CLAUDE.md IRON RULE).
- These planning docs and their commits stay on `master` (shared reference).

## Seed data + eval fixtures = shared definition of done

Even minus the DB, both tasks need content to run against (keep it all in `raw_data/`). Write
these up front — they double as the demo script:
- **T1:** sample brain data to distill (a few nurse + psychiatrist notes/records).
- **T2:** sample patient inputs + history (input → expected skills), as `routing-eval` fixtures.

If a fixture passes, the slice is done. Build toward the fixtures, not toward "feels done".

## Environment baseline (everyone, before starting)

- [ ] `bun install`
- [ ] `raw_data/` populated locally with the brain DB + dataset (gitignored — get it out-of-band)
- [ ] `bun run typecheck` green
- [ ] `gbrain smoke-test` green
- [ ] LLM API key + model config set (both tasks call `gbrain agent run`)
- [ ] agreed cost posture / model tier for `agent run`
- [ ] read the relevant task file + this contract

## The 3-way split

| Dev | Stream | First task | Depends on |
|---|---|---|---|
| **A** | Foundations & integration | `role` frontmatter + 2–3 seed skills + eval fixtures + seed dataset; owns shared-file merges; wires end-to-end demo | — (unblocks B & C) |
| **B** | Task 1 pipeline | Decider (collapses Q1–Q3), then create → update → split paths | contract from A |
| **C** | Task 2 orchestrator | `orchestrate_input` op + skill selector, then feedback loop | contract + ≥1 seed skill from A |

B and C mock against the frozen contract until A's foundations land.

## Demo target (what "done" looks like at the end)

End-to-end: a sample patient input →`orchestrate_input` pulls history + ranks skills → runs the
selected Nurse/Psychiatrist skill(s) → output feeds back for a second routing pass. Plus: T1 can
take a fresh piece of brain data and produce/update a skill that then shows up in that routing.
Both proven by the shared `routing-eval` fixtures.

## Guardrail everyone shares

Patient data is sensitive under Japan's APPI (要配慮個人情報). Keep source-isolation
(`sourceScopeOpts`), an audit trail of what gets auto-run, and treat skills as decision
support — not autonomous diagnosis. Decide the auto-run boundary as a team, early.
