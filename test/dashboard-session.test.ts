/**
 * dashboard-session.test.ts — the dashboard's instrumented session, with fakes.
 *
 * Proves (no DB / network / real gateway):
 *   1. Paste parsing: lines → history + current input; bullets/dates stripped.
 *   2. A session emits the event sequence the UI renders (agents → votes → report)
 *      from the REAL pipeline (runOrchestrator underneath, gate + assert intact).
 *   3. Votes/decisions per role: matching role votes + is selected; others stand by.
 *   4. Generic-only input → zero recommendations, generic skills audited, never routed.
 *   5. LLM path uses the injected chat fn; LLM failure falls back to deterministic
 *      with a visible 'llm_fallback' stage (the session never dies mid-demo).
 */

import { describe, it, expect } from 'bun:test';
import {
  parsePastedHistory,
  runDashboardSession,
  type DashboardEvent,
} from '../src/dashboard/session.ts';
import { CATALOG } from './fixtures/orchestrator-routing-cases.ts';
import type { ChatFn } from '../src/core/orchestrator/select-llm.ts';

const loadCandidateSkills = async () => CATALOG;

const CARDIAC_PASTE = [
  '2026-03-01 routine review, hypertension stable',
  '- 2026-03-04: intermittent palpitations reported',
  '2026-03-09 presents with chest pain and shortness of breath, needs vital signs',
].join('\n');

async function collect(paste: string, extra: Partial<Parameters<typeof runDashboardSession>[0]> = {}) {
  const events: DashboardEvent[] = [];
  const report = await runDashboardSession(
    { paste, loadCandidateSkills, ...extra },
    (e) => events.push(e),
  );
  return { events, report };
}

describe('parsePastedHistory', () => {
  it('last line is current input; earlier lines are history', () => {
    const p = parsePastedHistory(CARDIAC_PASTE);
    expect(p.history).toHaveLength(2);
    expect(p.current).toContain('chest pain');
    expect(p.history[0].snippet).toContain('routine review');
  });

  it('strips bullets, numbering and ISO date prefixes', () => {
    const p = parsePastedHistory('- 2026-01-01: first\n2) second thing\n• [2026-02-03] third');
    expect(p.history.map((h) => h.snippet)).toEqual(['first', 'second thing']);
    expect(p.current).toBe('third');
  });

  it('handles empty / whitespace paste', () => {
    expect(parsePastedHistory('  \n \n')).toEqual({ history: [], current: '' });
  });
});

describe('runDashboardSession', () => {
  it('emits the full event sequence and routes the right role', async () => {
    const { events, report } = await collect(CARDIAC_PASTE);

    const types = events.map((e) => e.type);
    expect(types).toContain('agents');
    expect(types).toContain('votes');
    expect(types).toContain('report');
    // agents snapshots bracket the pipeline: idle first, decisions last
    const agentEvents = events.filter((e) => e.type === 'agents');
    expect(agentEvents[0].agents.every((a) => a.state === 'idle')).toBe(true);

    // everyone votes; only the top-ranked role is SELECTED (nurse for cardiac input)
    const last = agentEvents[agentEvents.length - 1];
    const nurse = last.agents.find((a) => a.role === 'nurse')!;
    const psych = last.agents.find((a) => a.role === 'psychiatrist')!;
    expect(nurse.state).toBe('selected');
    expect(nurse.vote).toBeGreaterThan(0);
    expect(nurse.decision).toContain('nurse-triage');
    expect(psych.state).toBe('standby'); // may hold a weak vote, but is not selected
    expect(psych.vote!).toBeLessThan(nurse.vote!);

    // report: nurse-triage ranks first, generic skill audited not routed
    expect(report.recommendations[0].skill).toBe('nurse-triage');
    expect(report.excluded_generic).toContain('query');
    const rep = events.find((e) => e.type === 'report');
    expect(rep && rep.type === 'report' && rep.selector).toBe('deterministic');
    expect(rep && rep.type === 'report' && rep.nextSteps[0].action).toContain('nurse-triage');
    // key medical terms detected from the input
    expect(rep && rep.type === 'report' && rep.keyTerms).toContain('chest pain');
  });

  it('agents show their loaded skills after the gate', async () => {
    const { events } = await collect(CARDIAC_PASTE);
    const withSkills = events.filter(
      (e) => e.type === 'agents' && e.agents.some((a) => a.skills.length > 0),
    );
    expect(withSkills.length).toBeGreaterThan(0);
    const snap = withSkills[0];
    if (snap.type !== 'agents') throw new Error('unreachable');
    expect(snap.agents.find((a) => a.role === 'nurse')!.skills).toContain('nurse-triage');
    expect(snap.agents.find((a) => a.role === 'psychiatrist')!.skills).toContain('psych-risk-screen');
  });

  it('generic-only input → all standby, zero recommendations, audit intact', async () => {
    const { events, report } = await collect('please run a keyword search in the system');
    expect(report.recommendations).toHaveLength(0);
    expect(report.excluded_generic).toContain('query');
    const agentEvents = events.filter((e) => e.type === 'agents');
    const last = agentEvents[agentEvents.length - 1];
    expect(last.agents.every((a) => a.state === 'standby' && a.vote === 0)).toBe(true);
  });

  it('rejects an empty paste with an error event', async () => {
    const events: DashboardEvent[] = [];
    await expect(
      runDashboardSession({ paste: '  \n ', loadCandidateSkills }, (e) => events.push(e)),
    ).rejects.toThrow('empty paste');
    expect(events.some((e) => e.type === 'error')).toBe(true);
  });

  it('LLM mode uses the injected chat fn', async () => {
    let called = 0;
    const chatFn: ChatFn = async () => {
      called++;
      return {
        text: '',
        blocks: [
          {
            type: 'tool-call',
            input: { ranked: [{ skill: 'psych-risk-screen', confidence: 0.9, reason: 'risk language' }] },
          },
        ],
      } as unknown as Awaited<ReturnType<ChatFn>>;
    };
    const { events, report } = await collect('feeling hopeless with suicidal thoughts', {
      useLlm: true,
      chatFn,
    });
    expect(called).toBe(1);
    expect(report.recommendations[0].skill).toBe('psych-risk-screen');
    const rep = events.find((e) => e.type === 'report');
    expect(rep && rep.type === 'report' && rep.selector).toBe('llm');
  });

  it('LLM failure falls back to deterministic with a visible stage', async () => {
    const chatFn: ChatFn = async () => {
      throw new Error('model unreachable');
    };
    const { events, report } = await collect(CARDIAC_PASTE, { useLlm: true, chatFn });
    expect(events.some((e) => e.type === 'stage' && e.stage === 'llm_fallback')).toBe(true);
    expect(report.recommendations[0].skill).toBe('nurse-triage'); // deterministic result
    const rep = events.find((e) => e.type === 'report');
    expect(rep && rep.type === 'report' && rep.selector).toBe('deterministic');
  });
});
