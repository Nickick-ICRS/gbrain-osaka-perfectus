/**
 * orchestrator.test.ts — proves the healthcare custom-skill policy holds:
 * patient data routes only to our custom clinical skills, never generic GBrain.
 */

import { describe, it, expect } from 'bun:test';
import { runOrchestrator, type OrchestratorDeps } from '../src/core/orchestrator/run.ts';
import { partitionSkills, assertAllCustom } from '../src/core/orchestrator/custom-skills.ts';
import type { CandidateSkill, OrchestratorContext } from '../src/core/orchestrator/types.ts';

const NURSE: CandidateSkill = {
  name: 'nurse-triage',
  path: 'skills/nurse-triage/SKILL.md',
  description: 'Triage patient symptoms and vitals, flag escalation',
  role: 'nurse',
  triggers: ['symptoms', 'vitals', 'triage', 'pain'],
};
const PSYCH: CandidateSkill = {
  name: 'psych-risk-screen',
  path: 'skills/psych-risk-screen/SKILL.md',
  description: 'Screen for mood and risk indicators',
  role: 'psychiatrist',
  triggers: ['mood', 'anxiety', 'risk'],
};
const GENMED: CandidateSkill = {
  name: 'patient-history-review',
  path: 'skills/patient-history-review/SKILL.md',
  description: 'Review patient history, medications and allergies',
  role: 'general-medicine',
  triggers: ['history', 'medication', 'allergies', 'symptoms'],
};
const GENERIC: CandidateSkill = {
  name: 'query',
  path: 'skills/query/SKILL.md',
  description: 'Generic brain search and retrieval',
  triggers: ['search', 'symptoms', 'query'], // note: also matches "symptoms"
};

function ctx(text: string): OrchestratorContext {
  return { input: { text }, history: [], now: new Date('2026-07-05T00:00:00Z'), remote: false };
}

const deps = (skills: CandidateSkill[]): OrchestratorDeps => ({
  loadCandidateSkills: async () => skills,
});

describe('custom-skills gate', () => {
  it('partitions clinical skills (incl. general-medicine) from generic', () => {
    const { custom, generic } = partitionSkills([NURSE, PSYCH, GENMED, GENERIC]);
    expect(custom.map((s) => s.name).sort()).toEqual([
      'nurse-triage',
      'patient-history-review',
      'psych-risk-screen',
    ]);
    expect(generic.map((s) => s.name)).toEqual(['query']);
  });

  it('assertAllCustom throws if a generic skill sneaks in', () => {
    expect(() => assertAllCustom([NURSE, GENERIC])).toThrow(/refusing to route patient data/);
  });
});

describe('runOrchestrator', () => {
  it('never recommends a generic skill even when it matches the input', async () => {
    const report = await runOrchestrator(
      ctx('patient reports symptoms and pain'),
      deps([NURSE, PSYCH, GENMED, GENERIC]),
    );
    const names = report.recommendations.map((r) => r.skill);
    expect(names).toContain('nurse-triage'); // clinical skill selected
    expect(names).not.toContain('query'); // generic never selected
    // the generic match is recorded for the audit trail, not run
    expect(report.excluded_generic).toContain('query');
    // every recommendation carries a canonical clinical role
    for (const r of report.recommendations) {
      expect(['nurse', 'psychiatrist', 'general-medicine']).toContain(r.role);
    }
  });

  it('refuses to route (empty recs) when no custom skill exists, with a note', async () => {
    const report = await runOrchestrator(ctx('patient reports symptoms'), deps([GENERIC]));
    expect(report.recommendations).toHaveLength(0);
    expect(report.notes.join(' ')).toMatch(/No custom clinical/);
  });
});
