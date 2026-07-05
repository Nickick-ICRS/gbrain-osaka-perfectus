# dashboard/ — live care-team orchestrator dashboard

A zero-dependency web dashboard over the Task 2 patient orchestrator. Paste a
patient's history, watch the three role-agents (nurse / psychiatrist /
general-medicine) review → deliberate → vote live, and get ranked next action
steps. Decision support for a human reviewer — it never executes skills.

```bash
bun run dashboard          # → http://localhost:4321
# in the dev container, publish the port:
docker run --rm -p 4321:4321 -v "$PWD:/app" -w /app oven/bun:1 bun run dashboard
```

## The three panels

1. **Input** — paste historical data, one event per line, oldest first. The LAST
   line is the current presentation the team routes on (same contract as the
   temporal backtest). Bullets and ISO-date prefixes are stripped.
2. **Live agents** — one circle per clinical role, with a speech bubble showing
   its current action/state, a vote bar (selector confidence), and a decision
   line. Everyone votes; the top-ranked role is *selected* for the round.
3. **Output** — ranked next action steps (skill + role + confidence + why), the
   key medical terms detected (`medical-terms.ts`), and the audit line naming
   the generic skills that were refused patient data.

## How it connects to the system

`server.ts` (Bun.serve — no npm dependencies) imports the same modules the
`gbrain` CLI uses: the **real skill catalog** (`skill-catalog.ts`, role
frontmatter, custom-skill gate) and optionally the **real gateway `chat`** for
the LLM ranker (the toggle; falls back to the deterministic selector with a
visible `llm_fallback` stage if the model is unreachable). `session.ts` runs
`runOrchestrator` with instrumented injected seams, so every event the UI shows
comes from the real pipeline — the gate and the fail-closed assert are never
duplicated or bypassed. History comes from the paste, so no DB is needed and
the server starts instantly.

- `GET /` — the single-file UI (`index.html`, no build step)
- `WS /ws` — send `{type:'orchestrate', paste, useLlm?}`, receive the event stream
- `POST /api/orchestrate` — same session, all events as one JSON (curl/tests)
- `GET /api/health` — catalog summary
- Env: `GBRAIN_DASHBOARD_PORT` (default 4321), `GBRAIN_SKILLS_DIR` (default `<repo>/skills`)

Trust posture: binds as a trusted local caller (`remote: false`), suggest-only.
Patient data routes ONLY to role-tagged clinical skills (APPI 要配慮個人情報 —
the same policy as `orchestrate_input`); execution stays behind the explicit
local-only `orchestrate_run` op.

Tests: `test/dashboard-session.test.ts` (fake catalog + chat, no network).
