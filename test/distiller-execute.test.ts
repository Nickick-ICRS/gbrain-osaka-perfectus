/**
 * Unit suite for the Task 1 authoring path: anonymise + assemble + execute.
 * Hermetic: pure functions + injected author/apply seams (no LLM, no disk).
 */

import { describe, expect, test } from 'bun:test';
import { anonymise, anonymiseOrThrow } from '../src/core/distiller/anonymise.ts';
import { assembleSkill, buildFrontmatter, buildResolverRow } from '../src/core/distiller/assemble.ts';
import { executeDistillation, type ApplySink } from '../src/core/distiller/execute.ts';
import type { CandidateTopic, DistillReport } from '../src/core/distiller/types.ts';

// --- anonymise (TS port) -----------------------------------------------------

describe('anonymise (TS)', () => {
  test('scrubs the leaked identifiers to no residual', () => {
    const { text, residual } = anonymise(
      'Mr. OG, Room 135. Mr. R (89 y, GIR 1, 54 months institutionalized). Groupe Almage, Reims.',
    );
    expect(residual).toHaveLength(0);
    expect(text).not.toContain('Mr. OG');
    expect(text).not.toContain('Room 135');
    expect(text).not.toContain('89 y');
    expect(text).toContain('the facility');
    expect(text).toContain('GIR 1'); // scale level preserved
  });

  test('preserves durations and scales (no over-redaction)', () => {
    const { text, residual } = anonymise('Review trends over 5 years of data; HAD Q1-Q14.');
    expect(residual).toHaveLength(0);
    expect(text).toContain('5 years of data');
    expect(text).toContain('HAD Q1-Q14');
  });

  test('anonymiseOrThrow returns cleaned text for clean input', () => {
    expect(anonymiseOrThrow('Mr. OG in Room 2')).toContain('the resident');
  });
});

// --- assemble ----------------------------------------------------------------

describe('assemble', () => {
  const spec = {
    slug: 'nurse-falls',
    role: 'nurse' as const,
    description: 'Falls-risk nursing decision-support.',
    triggers: ['falls', 'gait'],
  };

  test('frontmatter carries name/role/triggers/tools/mutating', () => {
    const fm = buildFrontmatter(spec);
    expect(fm).toContain('name: nurse-falls');
    expect(fm).toContain('role: nurse');
    expect(fm).toContain('- "falls"');
    expect(fm).toContain('mutating: false');
  });

  test('resolver row shape', () => {
    expect(buildResolverRow(spec)).toBe('| "falls", "gait" | `skills/nurse-falls/SKILL.md` (role: nurse) |');
  });

  test('assembleSkill anonymises the body and embeds frontmatter', () => {
    const art = assembleSkill(spec, '# Falls\nFor Mr. OG in Room 3, assess gait.');
    expect(art.skillContent).toContain('role: nurse');
    expect(art.skillContent).toContain("the resident");
    expect(art.skillContent).not.toContain('Mr. OG');
    expect(art.routingEval).toContain('"expected_skill":"nurse-falls"');
    expect(art.manifestEntry).toEqual({ name: 'nurse-falls', path: 'nurse-falls/SKILL.md', description: spec.description });
  });

  test('assembleSkill rejects a body with no H1', () => {
    expect(() => assembleSkill(spec, 'no heading here')).toThrow(/H1 heading/);
  });
});

// --- execute -----------------------------------------------------------------

function capturingSink(existing?: Record<string, string>): ApplySink & {
  writes: Record<string, string>;
  rows: string[];
  manifest: string[];
  evals: string[];
  deprecated: string[];
} {
  const writes: Record<string, string> = {};
  const rows: string[] = [];
  const manifest: string[] = [];
  const evals: string[] = [];
  const deprecated: string[] = [];
  return {
    writes, rows, manifest, evals, deprecated,
    writeSkill: (p, c) => { writes[p] = c; },
    writeRoutingEval: (p) => { evals.push(p); },
    addManifestEntry: (e) => { manifest.push(e.name); },
    addResolverRow: (r) => { rows.push(r); },
    readSkill: (slug) => existing?.[slug],
    deprecateSkill: (slug) => { deprecated.push(slug); },
  };
}

const topic: CandidateTopic = {
  title: 'Falls risk assessment',
  summary: 'Assess falls history, gait and environment.',
  role: 'nurse',
  triggers: ['falls', 'gait'],
};
const report = (over: Partial<DistillReport>): DistillReport => ({
  generated_at: '', topic: topic.title, role: 'nurse', decision: 'none',
  proposedAction: '', reason: '', confidence: 1, notes: [], ...over,
});

describe('executeDistillation', () => {
  test('none → creates a skill (+ resolver + manifest + routing-eval)', async () => {
    const apply = capturingSink();
    const res = await executeDistillation(report({ decision: 'none' }), topic, {
      apply,
      author: async () => '# Falls\nAssess gait and environment.',
    });
    expect(res.action).toBe('created');
    expect(res.slugs).toEqual(['falls-risk-assessment']);
    expect(apply.writes['skills/falls-risk-assessment/SKILL.md']).toContain('role: nurse');
    expect(apply.rows).toHaveLength(1);
    expect(apply.manifest).toEqual(['falls-risk-assessment']);
    expect(apply.evals).toHaveLength(1);
  });

  test('create anonymises authored PII before writing', async () => {
    const apply = capturingSink();
    await executeDistillation(report({ decision: 'none' }), topic, {
      apply,
      author: async () => '# Falls\nFor Mr. OG in Room 5, assess gait.',
    });
    const written = apply.writes['skills/falls-risk-assessment/SKILL.md'];
    expect(written).not.toContain('Mr. OG');
    expect(written).toContain('the resident');
  });

  test('exact_match → no-op, nothing written', async () => {
    const apply = capturingSink();
    const res = await executeDistillation(report({ decision: 'exact_match', matchedSkill: 'nurse-triage' }), topic, {
      apply, author: async () => 'unused',
    });
    expect(res.action).toBe('noop');
    expect(Object.keys(apply.writes)).toHaveLength(0);
  });

  test('update → rewrites body, preserves frontmatter, no manifest/resolver change', async () => {
    const existing = { 'nurse-triage': '---\nname: nurse-triage\nrole: nurse\n---\n\n# Old body\n' };
    const apply = capturingSink(existing);
    const res = await executeDistillation(report({ decision: 'update', matchedSkill: 'nurse-triage' }), topic, {
      apply, author: async () => '# New body\nUpdated guidance.',
    });
    expect(res.action).toBe('updated');
    const written = apply.writes['skills/nurse-triage/SKILL.md'];
    expect(written).toContain('name: nurse-triage'); // frontmatter preserved
    expect(written).toContain('# New body');
    expect(written).not.toContain('# Old body');
    expect(apply.manifest).toHaveLength(0);
    expect(apply.rows).toHaveLength(0);
  });

  test('update without a matched skill throws', async () => {
    const apply = capturingSink();
    await expect(
      executeDistillation(report({ decision: 'update' }), topic, { apply, author: async () => 'x' }),
    ).rejects.toThrow(/matched skill/);
  });

  test('split → creates both targets and deprecates the original', async () => {
    const apply = capturingSink();
    const res = await executeDistillation(
      report({ decision: 'split', matchedSkill: 'nurse-triage', splitInto: ['nurse-triage-core', 'nurse-sepsis'] }),
      topic,
      { apply, author: async () => '# Split\nContent.' },
    );
    expect(res.action).toBe('split');
    expect(res.slugs).toEqual(['nurse-triage-core', 'nurse-sepsis']);
    expect(Object.keys(apply.writes).sort()).toEqual([
      'skills/nurse-sepsis/SKILL.md',
      'skills/nurse-triage-core/SKILL.md',
    ]);
    expect(apply.deprecated).toEqual(['nurse-triage']);
  });
});
