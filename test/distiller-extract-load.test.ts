/**
 * Unit suite for the distiller's keyless data seams:
 *   - extract.ts  — deterministic topic extractor (pure)
 *   - load-skills.ts — real loadExistingSkills over a skills dir (temp fixture)
 *
 * Hermetic: extractor is pure; the loader runs against a tmpdir fixture, no DB.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import { extractTopics, type BrainRecord } from '../src/core/distiller/extract.ts';
import { loadExistingSkills } from '../src/core/distiller/load-skills.ts';

// --- extractTopics -----------------------------------------------------------

describe('extractTopics — clustering', () => {
  test('groups by role + primary tag; provenance + triggers preserved', () => {
    const records: BrainRecord[] = [
      { id: 'p2', text: 'chest pain protocol', role: 'nurse', tags: ['triage'] },
      { id: 'p1', text: 'vital signs on admission', role: 'nurse', tags: ['triage'] },
      { id: 'p3', text: 'mood assessment', role: 'psychiatrist', tags: ['depression'] },
    ];
    const { topics } = extractTopics(records);
    expect(topics).toHaveLength(2); // one nurse/triage, one psychiatrist/depression
    const triage = topics.find((t) => t.role === 'nurse')!;
    expect(triage.sourceIds).toEqual(['p1', 'p2']); // sorted by id, both members
    expect(triage.summary).toContain('chest pain protocol');
    expect(triage.summary).toContain('vital signs');
    expect(triage.triggers).toEqual(['triage']);
  });

  test('non-clinical records are dropped and counted (APPI), not silently lost', () => {
    const records: BrainRecord[] = [
      { id: 'a', text: 'triage note', role: 'nurse', tags: ['triage'] },
      { id: 'b', text: 'quarterly revenue', role: 'marketing', tags: ['sales'] },
      { id: 'c', text: 'ad spend', role: 'finance' },
    ];
    const { topics, droppedNonClinical } = extractTopics(records);
    expect(droppedNonClinical).toBe(2);
    expect(topics).toHaveLength(1);
    expect(topics[0].role).toBe('nurse');
  });

  test('falls back to a title-derived key + trigger when no tags', () => {
    const records: BrainRecord[] = [
      { id: 'x', text: 'body', role: 'general-medicine', title: 'Medication reconciliation' },
    ];
    const { topics } = extractTopics(records);
    expect(topics[0].title).toBe('Medication reconciliation');
    expect(topics[0].triggers).toEqual(['medication reconciliation']);
  });

  test('deterministic: same input → identical output', () => {
    const records: BrainRecord[] = [
      { id: 'p3', text: 'c', role: 'nurse', tags: ['wound'] },
      { id: 'p1', text: 'a', role: 'nurse', tags: ['triage'] },
      { id: 'p2', text: 'b', role: 'psychiatrist', tags: ['anxiety'] },
    ];
    expect(extractTopics(records)).toEqual(extractTopics(records));
  });

  test('summary truncates to the configured cap', () => {
    const long = 'x '.repeat(2000);
    const { topics } = extractTopics([{ id: 'l', text: long, role: 'nurse', tags: ['t'] }], {
      maxSummaryChars: 50,
    });
    expect(topics[0].summary.length).toBeLessThanOrEqual(50);
  });
});

// --- loadExistingSkills ------------------------------------------------------

describe('loadExistingSkills — over a skills dir', () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'distiller-skills-'));
    const write = (slug: string, body: string) => {
      mkdirSync(join(dir, slug), { recursive: true });
      writeFileSync(join(dir, slug, 'SKILL.md'), body);
    };
    write(
      'nurse-x',
      [
        '---',
        'name: nurse-x',
        'description: Nursing triage decision-support',
        'role: nurse',
        'triggers:',
        '  - "chest pain"',
        '  - "triage"',
        'mutating: false',
        '---',
        '',
        '# nurse-x',
      ].join('\n'),
    );
    write(
      'generic-y',
      ['---', 'name: generic-y', 'description: A generic brain skill', '---', '', '# generic-y'].join('\n'),
    );
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test('projects name/description/triggers/role, matching list_skills', () => {
    const skills = loadExistingSkills(dir);
    const byName = Object.fromEntries(skills.map((s) => [s.name, s]));
    expect(byName['nurse-x'].role).toBe('nurse');
    expect(byName['nurse-x'].description).toBe('Nursing triage decision-support');
    expect(byName['nurse-x'].triggers).toEqual(['chest pain', 'triage']);
  });

  test('generic skills load with role undefined (ineligible for patient data)', () => {
    const skills = loadExistingSkills(dir);
    const generic = skills.find((s) => s.name === 'generic-y')!;
    expect(generic.role).toBeUndefined();
  });

  test('output feeds the decider (lane filter) end-to-end', () => {
    const skills = loadExistingSkills(dir);
    const nurseLane = skills.filter((s) => s.role === 'nurse');
    expect(nurseLane.map((s) => s.name)).toEqual(['nurse-x']);
  });
});
