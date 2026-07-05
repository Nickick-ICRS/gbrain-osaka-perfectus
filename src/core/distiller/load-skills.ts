/**
 * distiller/load-skills.ts — real `loadExistingSkills` seam (keyless).
 *
 * Backs the distiller's `loadExistingSkills` dependency with the same primitives
 * `list_skills` uses (skill-catalog.ts): the vetted manifest + the shared
 * frontmatter parser + the shared one-line-description extractor. So the skills
 * the decider compares against are EXACTLY what `list_skills` would report — no
 * second, drifting projection.
 *
 * Pure modulo the filesystem (takes a resolved skills dir; no OperationContext,
 * no engine, no network) — the CLI/op layer resolves the dir via
 * `resolveSkillsDir(ctx)` and hands it in.
 *
 * A single malformed / escaping skill is skipped, never throws the whole load
 * (mirrors buildSkillCatalog's resilience).
 */

import { readFileSync } from 'fs';
import { loadOrDeriveManifest } from '../skill-manifest.ts';
import { confineManifestPath, oneLineDescription } from '../skill-catalog.ts';
import { parseSkillFrontmatter } from '../skill-frontmatter.ts';
import type { ExistingSkill } from './types.ts';

/** Strip the leading `---\n…\n---` fence; return the prose body. */
function stripFence(content: string): string {
  const m = content.match(/^---\n[\s\S]*?\n---\n?/);
  return m ? content.slice(m[0].length) : content;
}

/**
 * Load every skill under `skillsDir` as an `ExistingSkill` (name, description,
 * triggers, role) — the projection the distiller's decider consumes.
 */
export function loadExistingSkills(skillsDir: string): ExistingSkill[] {
  const { skills: manifest } = loadOrDeriveManifest(skillsDir);
  const out: ExistingSkill[] = [];

  for (const entry of manifest) {
    let path: string;
    try {
      path = confineManifestPath(skillsDir, entry);
    } catch {
      continue; // escaping / non-SKILL.md / missing — skip, don't throw
    }
    let content: string;
    try {
      content = readFileSync(path, 'utf-8');
    } catch {
      continue;
    }
    const parsed = parseSkillFrontmatter(content);
    const raw = parsed?.raw ?? '';
    out.push({
      name: entry.name,
      description: oneLineDescription(raw, stripFence(content)),
      triggers: parsed?.triggers ?? [],
      role: parsed?.role,
    });
  }

  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}
