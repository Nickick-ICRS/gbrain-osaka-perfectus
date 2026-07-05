/**
 * orchestrator/execute.ts — the real SkillExecutor: runs a recommended clinical
 * skill as a SUBAGENT JOB.
 *
 * We use the `jobs submit subagent` path (minion queue), NOT `gbrain agent run` —
 * per hackathon_planning/LOCAL-MODELS-SETUP.md §5, the subagent-job path is what
 * works against the local LM Studio stack. Job submit + poll is behind an injected
 * `JobRunner` so the executor logic is unit-testable; `makeQueueJobRunner` wires the
 * real queue (needs a live DB + a running `gbrain jobs work` worker + a chat model —
 * validate on the local stack, it can't be exercised in a plain unit test).
 *
 * AUTO-RUN BOUNDARY: nothing here runs on its own. `orchestrate_input` stays
 * suggest-only; execution happens only when a caller explicitly builds this executor
 * and hands it to `orchestrateLoop` (or via the local-only `orchestrate_run` op).
 * Decision support, not autonomous diagnosis.
 */

import type { BrainEngine } from '../engine.ts';
import type {
  OrchestratorContext,
  SkillExecutor,
  SkillOutput,
  SkillRecommendation,
} from './types.ts';

/** A subagent invocation. */
export interface SubagentSpec {
  prompt: string;
  model?: string;
  maxTurns?: number;
}

/** Terminal result of a subagent run. */
export interface SubagentResult {
  status: 'completed' | 'failed';
  text: string;
  error?: string;
}

/** Submits a subagent job and resolves with its terminal result. Injected. */
export type JobRunner = (spec: SubagentSpec) => Promise<SubagentResult>;

export interface SubagentExecutorOpts {
  runner: JobRunner;
  /** Model for the subagent (e.g. a local `openrouter:qwen/...`). Default: config. */
  model?: string;
  maxTurns?: number;
  /** Override how a skill invocation is phrased to the subagent. */
  buildPrompt?: (rec: SkillRecommendation, ctx: OrchestratorContext) => string;
}

// Higher than a plain chat loop: with parallel tool calls forced OFF (local
// models mishandle them), a multi-lookup clinical skill spends one turn per
// lookup, so it needs more turns to reach a final synthesis before max_turns.
const DEFAULT_MAX_TURNS = 18;

function defaultPrompt(rec: SkillRecommendation, ctx: OrchestratorContext): string {
  const stateLine =
    ctx.input.state && Object.keys(ctx.input.state).length
      ? `Current state: ${JSON.stringify(ctx.input.state)}`
      : '';
  return [
    `Run the clinical skill "${rec.skill}" (role: ${rec.role}) for this patient input.`,
    `First call get_skill to load "${rec.skill}", then follow its steps.`,
    `Patient input: ${ctx.input.text}`,
    stateLine,
    // Local openai-compatible models (e.g. qwen via LM Studio) can emit several
    // tool calls in one turn with IDs the provider then can't reconcile ("tool
    // results are missing for tool calls …"). Force sequential calls — one at a
    // time — which round-trips cleanly. Single-call turns are the tested-good path.
    'Call tools ONE AT A TIME: make a single tool call, wait for its result, then decide the next. Never emit more than one tool call in a single turn.',
    "Produce the skill's decision-support output. This is decision support, not diagnosis.",
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Build a SkillExecutor that runs each recommendation as a subagent job via the
 * injected `runner`. A failed job becomes a recorded (non-throwing) SkillOutput so
 * the feedback loop keeps going and the failure is visible in the transcript.
 */
export function makeSubagentExecutor(opts: SubagentExecutorOpts): SkillExecutor {
  const build = opts.buildPrompt ?? defaultPrompt;
  return async (rec, ctx): Promise<SkillOutput> => {
    const res = await opts.runner({
      prompt: build(rec, ctx),
      model: opts.model,
      maxTurns: opts.maxTurns ?? DEFAULT_MAX_TURNS,
    });
    if (res.status !== 'completed') {
      return { skill: rec.skill, summary: `[execution failed: ${res.error ?? 'unknown error'}]` };
    }
    return { skill: rec.skill, summary: res.text };
  };
}

/** Pull the human-readable text out of a subagent job's `result` record. */
export function extractResultText(result: Record<string, unknown> | null): string {
  if (!result) return '';
  for (const k of ['text', 'output', 'summary', 'content', 'final', 'result']) {
    const v = result[k];
    if (typeof v === 'string' && v.trim()) return v;
  }
  return JSON.stringify(result);
}

export interface QueueRunnerOpts {
  pollMs?: number;
  timeoutMs?: number;
  /** Injected for tests; defaults to setTimeout-based sleep. */
  sleep?: (ms: number) => Promise<void>;
  /** Injected for tests; defaults to Date.now. */
  now?: () => number;
}

/**
 * Real JobRunner over the minion queue. Submits a `subagent` job and polls until a
 * terminal status. Requires a live engine + a running `gbrain jobs work` worker +
 * a chat model; exercise it on the local stack, not in unit tests.
 */
export function makeQueueJobRunner(engine: BrainEngine, opts: QueueRunnerOpts = {}): JobRunner {
  const pollMs = opts.pollMs ?? 1500;
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = opts.now ?? (() => Date.now());
  const TERMINAL = new Set(['completed', 'failed', 'dead', 'cancelled']);

  return async (spec: SubagentSpec): Promise<SubagentResult> => {
    const { MinionQueue } = await import('../minions/queue.ts');
    const queue = new MinionQueue(engine);
    const data: Record<string, unknown> = { prompt: spec.prompt };
    if (spec.model) data.model = spec.model;
    if (spec.maxTurns) data.max_turns = spec.maxTurns;

    const job = await queue.add('subagent', data, { max_stalled: 3 }, { allowProtectedSubmit: true });

    const deadline = now() + timeoutMs;
    while (now() <= deadline) {
      const cur = await queue.getJob(job.id);
      if (cur && TERMINAL.has(cur.status)) {
        if (cur.status === 'completed') {
          return { status: 'completed', text: extractResultText(cur.result) };
        }
        return { status: 'failed', text: '', error: cur.error_text ?? cur.status };
      }
      await sleep(pollMs);
    }
    return { status: 'failed', text: '', error: `timeout after ${timeoutMs}ms` };
  };
}

/**
 * Inline JobRunner — runs the subagent job IN THIS PROCESS via an ephemeral
 * MinionWorker, instead of waiting for a separate `gbrain jobs work` daemon.
 *
 * This is the path that works on PGLite: PGLite's exclusive file lock forbids a
 * second worker process, so the durable `jobs work` daemon is Postgres-only
 * (see hackathon_planning/LOCAL-MODELS-SETUP.md §5). Mirrors the
 * `gbrain jobs submit … --follow` inline pattern (src/commands/jobs.ts): submit
 * the job, spin up a one-shot worker, poll until our job is terminal, then stop
 * the worker. Works on Postgres too (self-contained, no daemon needed) — it just
 * blocks until the run finishes.
 *
 * `timeoutMs` defaults higher than the queue runner because a local thinking
 * model (e.g. qwen) can take minutes across a multi-turn tool loop.
 */
export function makeInlineJobRunner(engine: BrainEngine, opts: QueueRunnerOpts = {}): JobRunner {
  const pollMs = opts.pollMs ?? 250;
  const timeoutMs = opts.timeoutMs ?? 600_000;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = opts.now ?? (() => Date.now());
  const TERMINAL = new Set(['completed', 'failed', 'dead', 'cancelled']);

  return async (spec: SubagentSpec): Promise<SubagentResult> => {
    const { MinionQueue } = await import('../minions/queue.ts');
    const { MinionWorker } = await import('../minions/worker.ts');
    // Dynamic import (not static) so core/ takes no load-time dep on commands/;
    // matches the deferred-import style used throughout this file.
    const { registerBuiltinHandlers } = await import('../../commands/jobs.ts');

    const queue = new MinionQueue(engine);
    const data: Record<string, unknown> = { prompt: spec.prompt };
    if (spec.model) data.model = spec.model;
    if (spec.maxTurns) data.max_turns = spec.maxTurns;
    const job = await queue.add('subagent', data, { max_stalled: 3 }, { allowProtectedSubmit: true });

    // Ephemeral in-process worker on the default queue. healthCheckInterval: 0 —
    // a one-shot inline flow has no supervisor to restart it, and the health
    // timer's no-listener fallback would process.exit() and kill the caller.
    const worker = new MinionWorker(engine, {
      queue: 'default',
      pollInterval: 100,
      healthCheckInterval: 0,
    });
    await registerBuiltinHandlers(worker, engine, { quiet: true });

    // The worker logs its lifecycle ("Job N failed, retrying", "Minion worker
    // stopped", stall/timeout lines) via bare console.log — which would corrupt
    // a caller's `--json` stdout. Redirect console.log → stderr for the duration
    // of the inline run so stdout stays clean for the op's JSON payload.
    const origLog = console.log;
    console.log = (...a: unknown[]) => console.error(...a);
    const workerPromise = worker.start();
    const deadline = now() + timeoutMs;
    try {
      while (now() <= deadline) {
        const cur = await queue.getJob(job.id);
        if (cur && TERMINAL.has(cur.status)) {
          if (cur.status === 'completed') {
            return { status: 'completed', text: extractResultText(cur.result) };
          }
          return { status: 'failed', text: '', error: cur.error_text ?? cur.status };
        }
        await sleep(pollMs);
      }
      return { status: 'failed', text: '', error: `timeout after ${timeoutMs}ms` };
    } finally {
      worker.stop();
      await workerPromise.catch(() => {});
      console.log = origLog;
    }
  };
}
