/**
 * Unit suite for the fs-backed ApplySink + the author-prompt builder.
 * apply-fs runs against a tmpdir skills tree; buildAuthorPrompt is pure.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import { makeFsApplySink } from '../src/core/distiller/apply-fs.ts';
import { buildAuthorPrompt } from '../src/core/distiller/execute.ts';

describe('makeFsApplySink', () => {
  let skillsDir: string;
  beforeAll(() => {
    const root = mkdtempSync(join(tmpdir(), 'apply-fs-'));
    skillsDir = join(root, 'skills');
    mkdirSync(skillsDir, { recursive: true });
    writeFileSync(join(skillsDir, 'manifest.json'), JSON.stringify({ name: 'gbrain', skills: [] }, null, 2) + '\n');
    writeFileSync(
      join(skillsDir, 'RESOLVER.md'),
      ['# Resolver', '', '## Patient care', '', '| Trigger | Skill |', '|--|--|', '| "existing" | `skills/x/SKILL.md` |', ''].join('\n'),
    );
  });
  afterAll(() => rmSync(join(skillsDir, '..'), { recursive: true, force: true }));

  test('writeSkill lands the file under the skills tree', () => {
    const sink = makeFsApplySink(skillsDir);
    sink.writeSkill('skills/foo/SKILL.md', '---\nname: foo\n---\n\n# Foo\nbody');
    expect(existsSync(join(skillsDir, 'foo', 'SKILL.md'))).toBe(true);
    expect(readFileSync(join(skillsDir, 'foo', 'SKILL.md'), 'utf-8')).toContain('# Foo');
  });

  test('addManifestEntry appends, idempotently', () => {
    const sink = makeFsApplySink(skillsDir);
    sink.addManifestEntry({ name: 'foo', path: 'foo/SKILL.md', description: 'd' });
    sink.addManifestEntry({ name: 'foo', path: 'foo/SKILL.md', description: 'd' }); // dup ignored
    const m = JSON.parse(readFileSync(join(skillsDir, 'manifest.json'), 'utf-8'));
    expect(m.skills.filter((s: { name: string }) => s.name === 'foo')).toHaveLength(1);
  });

  test('addResolverRow inserts under the named section', () => {
    const sink = makeFsApplySink(skillsDir);
    const row = '| "foo" | `skills/foo/SKILL.md` (role: nurse) |';
    sink.addResolverRow(row, 'Patient care');
    const content = readFileSync(join(skillsDir, 'RESOLVER.md'), 'utf-8');
    expect(content).toContain(row);
    // stays within the Patient care section (before EOF, after the heading)
    expect(content.indexOf(row)).toBeGreaterThan(content.indexOf('## Patient care'));
  });

  test('readSkill + deprecateSkill', () => {
    const sink = makeFsApplySink(skillsDir);
    expect(sink.readSkill!('foo')).toContain('# Foo');
    sink.deprecateSkill!('foo');
    expect(readFileSync(join(skillsDir, 'foo', 'SKILL.md'), 'utf-8')).toContain('> **Deprecated:**');
  });
});

describe('buildAuthorPrompt', () => {
  const topic = { title: 'Falls', summary: 'falls and gait', role: 'nurse' as const, triggers: ['falls'] };

  test('create prompt carries the anonymise rule, slug, and summary', () => {
    const p = buildAuthorPrompt({ topic, decision: 'none', slug: 'nurse-falls' });
    expect(p).toContain('ANONYMISE');
    expect(p).toContain('nurse-falls');
    expect(p).toContain('falls and gait');
    expect(p).toContain('Do NOT include any resident');
  });

  test('update prompt includes the existing body + fold-in instruction', () => {
    const p = buildAuthorPrompt({ topic, decision: 'update', slug: 'nurse-triage', existingBody: '# Old\ntext' });
    expect(p).toContain('folding in new data');
    expect(p).toContain('# Old');
  });
});
