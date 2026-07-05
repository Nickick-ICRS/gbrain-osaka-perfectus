/**
 * dashboard/session.ts — one instrumented orchestrator session for the live dashboard.
 *
 * The dashboard's job is to make the orchestrator's pipeline VISIBLE while it runs:
 * three role-agents (nurse / psychiatrist / general-medicine) shown as live circles,
 * each with a current action bubble, a decision, and a vote. This module produces
 * that visibility WITHOUT duplicating pipeline logic: it wraps the orchestrator's
 * existing injected seams (`loadCandidateSkills`, `select`) so every event the UI
 * shows is emitted from the real code path — `runOrchestrator` remains the single
 * source of the custom-skill gate and the fail-closed assert.
 *
 * Composable like everything else in orchestrator/: the skill loader and chat fn
 * are injected, so tests drive a whole session with fakes and the server wires the
 * real catalog + gateway. No DB anywhere — history comes from the user's paste.
 */

import { SKILL_ROLES } from '../core/skill-frontmatter.ts';
import { runOrchestrator, type OrchestratorDeps } from '../core/orchestrator/run.ts';
import { selectSkills } from '../core/orchestrator/select.ts';
import { selectSkillsLLM, type ChatFn } from '../core/orchestrator/select-llm.ts';
import { isHealthcareRole } from '../core/orchestrator/custom-skills.ts';
import { extractMedicalTerms } from '../core/orchestrator/medical-terms.ts';
import type {
  CandidateSkill,
  HistoryItem,
  OrchestratorContext,
  OrchestratorReport,
  SkillRole,
} from '../core/orchestrator/types.ts';

// ---------------------------------------------------------------------------
// Event protocol (what the UI renders)
// ---------------------------------------------------------------------------

export type AgentVisualState = 'idle' | 'reviewing' | 'deliberating' | 'selected' | 'standby';

/** One role-agent circle on the dashboard. */
export interface AgentState {
  role: SkillRole;
  state: AgentVisualState;
  /** Current action / state, rendered as the agent's speech bubble. */
  action: string;
  /** The role's loaded skill names. */
  skills: string[];
  /** 0..1 top confidence this round; null until the vote is in. */
  vote: number | null;
  /** The agent's decision line once selection lands (null before). */
  decision: string | null;
}

/** A ranked next action step for the output panel. */
export interface NextStep {
  rank: number;
  skill: string;
  role: SkillRole;
  confidence: number;
  reason: string;
  /** Human-phrased action line. */
  action: string;
}

export type DashboardEvent =
  | { type: 'stage'; stage: string; detail?: string }
  | { type: 'agents'; agents: AgentState[] }
  | { type: 'votes'; votes: Array<{ role: SkillRole; vote: number; skill: string | null }> }
  | {
      type: 'report';
      report: OrchestratorReport;
      nextSteps: NextStep[];
      /** Key medical terms detected across input + recommendation rationale. */
      keyTerms: string[];
      selector: 'llm' | 'deterministic';
    }
  | { type: 'error'; message: string };

export type EmitFn = (e: DashboardEvent) => void;

// ---------------------------------------------------------------------------
// Paste parsing — turn the user's copy-pasted history into (history, current)
// ---------------------------------------------------------------------------

export interface ParsedPaste {
  /** All lines but the last, as retrieved-history items. */
  history: HistoryItem[];
  /** The last line — treated as the current presenting input. */
  current: string;
}

/**
 * Each non-empty line of the paste is one historical record; the LAST line is the
 * current input to route (same shape the temporal backtest uses: history-to-date +
 * newest event). Bullets / numbering / simple date prefixes are stripped.
 */
export function parsePastedHistory(paste: string): ParsedPaste {
  const lines = paste
    .split(/\r?\n/)
    .map((l) =>
      l
        .replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '') // bullets & numbered lists
        .replace(/^\s*\[?\d{4}-\d{2}-\d{2}[^\s\]]*\]?[:\s—-]*/, '') // ISO date prefixes
        .trim(),
    )
    .filter((l) => l.length > 0);

  if (lines.length === 0) return { history: [], current: '' };
  const current = lines[lines.length - 1];
  const history = lines.slice(0, -1).map((snippet, i) => ({ id: String(i + 1), snippet }));
  return { history, current };
}

// ---------------------------------------------------------------------------
// Agent-state bookkeeping
// ---------------------------------------------------------------------------

function initialAgents(): AgentState[] {
  return SKILL_ROLES.map((role) => ({
    role,
    state: 'idle',
    action: 'Waiting for input…',
    skills: [],
    vote: null,
    decision: null,
  }));
}

function skillsByRole(custom: CandidateSkill[]): Map<SkillRole, string[]> {
  const map = new Map<SkillRole, string[]>();
  for (const role of SKILL_ROLES) map.set(role, []);
  for (const s of custom) {
    if (isHealthcareRole(s.role)) map.get(s.role)!.push(s.name);
  }
  return map;
}

// ---------------------------------------------------------------------------
// The session
// ---------------------------------------------------------------------------

export interface SessionOpts {
  /** The user's pasted historical data (last line = current input). */
  paste: string;
  /** Load candidate skills (server wires the real catalog; tests pass a fixture). */
  loadCandidateSkills: () => Promise<CandidateSkill[]>;
  /** true → rank with the LLM selector (falls back to deterministic on error). */
  useLlm?: boolean;
  /** The gateway chat fn when useLlm; injected so tests never touch the network. */
  chatFn?: ChatFn;
  now?: () => Date;
}

function nextStepsFrom(report: OrchestratorReport): NextStep[] {
  return report.recommendations.map((r, i) => ({
    rank: i + 1,
    skill: r.skill,
    role: r.role,
    confidence: r.confidence,
    reason: r.reason,
    action: `Run ${r.skill} (${r.role}) — ${r.reason || 'recommended for this input'}`,
  }));
}

function keyTermsFrom(current: string, report: OrchestratorReport): string[] {
  const text = [current, ...report.recommendations.map((r) => r.reason)].join(' \n ');
  return extractMedicalTerms(text).map((t) => t.canonical);
}

/**
 * Run one suggest-only orchestration pass, emitting dashboard events as the real
 * pipeline progresses. Returns the final report (also emitted as a 'report' event).
 * Suggest-only on purpose — the dashboard is decision support for a human reviewer;
 * execution stays behind the explicit local-only `orchestrate_run` boundary.
 */
export async function runDashboardSession(
  opts: SessionOpts,
  emit: EmitFn,
): Promise<OrchestratorReport> {
  const now = opts.now ?? (() => new Date());
  const agents = initialAgents();
  const pushAgents = () => emit({ type: 'agents', agents: agents.map((a) => ({ ...a })) });
  const setAll = (state: AgentVisualState, action: string) => {
    for (const a of agents) {
      a.state = state;
      a.action = action;
    }
    pushAgents();
  };

  pushAgents(); // idle snapshot so the UI always has all three circles

  const { history, current } = parsePastedHistory(opts.paste);
  if (!current) {
    emit({ type: 'error', message: 'Paste at least one line of patient data.' });
    throw new Error('empty paste');
  }
  emit({
    type: 'stage',
    stage: 'parsed_input',
    detail: `${history.length} history item(s) + current input`,
  });
  setAll('reviewing', `Reviewing ${history.length} history item(s)…`);

  let selectorUsed: 'llm' | 'deterministic' = opts.useLlm && opts.chatFn ? 'llm' : 'deterministic';

  // Instrumented seams — the real pipeline emits the UI's events as it runs.
  const deps: OrchestratorDeps = {
    loadCandidateSkills: async () => {
      emit({ type: 'stage', stage: 'loading_skills' });
      const candidates = await opts.loadCandidateSkills();
      const clinical = candidates.filter((c) => isHealthcareRole(c.role));
      const byRole = skillsByRole(clinical);
      for (const a of agents) {
        a.skills = byRole.get(a.role) ?? [];
        a.action =
          a.skills.length > 0
            ? `${a.skills.length} skill(s) ready: ${a.skills.join(', ')}`
            : 'No skills for this role yet';
      }
      pushAgents();
      emit({
        type: 'stage',
        stage: 'gate_applied',
        detail: `${clinical.length} clinical skill(s) eligible, ${candidates.length - clinical.length} generic refused`,
      });
      return candidates;
    },

    retrieveHistory: async () => history, // the paste IS the history — no DB, no leak

    select: async (octx, custom) => {
      setAll(
        'deliberating',
        selectorUsed === 'llm' ? 'Deliberating (LLM ranker)…' : 'Deliberating (trigger match)…',
      );
      let recs;
      if (selectorUsed === 'llm') {
        try {
          recs = await selectSkillsLLM(octx, custom, opts.chatFn!);
        } catch (err) {
          selectorUsed = 'deterministic';
          emit({
            type: 'stage',
            stage: 'llm_fallback',
            detail: `LLM selector unavailable (${(err as Error).message}); using deterministic selector`,
          });
          recs = selectSkills(octx, custom);
        }
      } else {
        recs = selectSkills(octx, custom);
      }

      // Votes: each role-agent's vote is its top recommended skill's confidence.
      // The DECISION is the top-ranked recommendation overall: everyone votes,
      // the highest-confidence role is selected for this round.
      const votes = SKILL_ROLES.map((role) => {
        const top = recs.find((r) => r.role === role); // recs are ranked, first hit = top
        return { role, vote: top ? top.confidence : 0, skill: top ? top.skill : null };
      });
      emit({ type: 'votes', votes });
      const selectedRole = recs[0]?.role;
      for (const a of agents) {
        const v = votes.find((x) => x.role === a.role)!;
        a.vote = v.vote;
        if (v.skill && a.role === selectedRole) {
          const rec = recs.find((r) => r.skill === v.skill)!;
          a.state = 'selected';
          a.decision = `Run ${v.skill} — ${rec.reason || 'matched this input'}`;
          a.action = `Voted ${v.vote.toFixed(2)} for ${v.skill} — selected`;
        } else if (v.skill) {
          a.state = 'standby';
          a.decision = `Voted ${v.vote.toFixed(2)} for ${v.skill} — not selected this round.`;
          a.action = `Voted ${v.vote.toFixed(2)} for ${v.skill}`;
        } else {
          a.state = 'standby';
          a.decision = 'Stand by — no skill from this role matches.';
          a.action = 'No vote this round';
        }
      }
      pushAgents();
      return recs;
    },
  };

  const octx: OrchestratorContext = {
    input: { text: current },
    history,
    now: now(),
    remote: false, // the dashboard server is a trusted local caller
  };

  try {
    const report = await runOrchestrator(octx, deps);
    emit({
      type: 'report',
      report,
      nextSteps: nextStepsFrom(report),
      keyTerms: keyTermsFrom(current, report),
      selector: selectorUsed,
    });
    emit({ type: 'stage', stage: 'done' });
    return report;
  } catch (err) {
    emit({ type: 'error', message: (err as Error).message });
    throw err;
  }
}
