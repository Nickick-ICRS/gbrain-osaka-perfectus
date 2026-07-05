/**
 * distiller/apply-fs.ts — filesystem-backed ApplySink for the authoring executor.
 *
 * Lands a skill on disk: writes SKILL.md + routing-eval, registers the manifest
 * entry, and inserts the RESOLVER row under its functional-area section. Local
 * authoring only (the `distill_apply` op is localOnly). Idempotent where cheap
 * (skips a manifest/resolver entry that already exists).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { findResolverFile } from '../resolver-filenames.ts';
import type { ApplySink } from './execute.ts';

/** Build an ApplySink rooted at the repo containing `skillsDir`. */
export function makeFsApplySink(skillsDir: string): ApplySink {
  const repoRoot = resolve(skillsDir, '..');
  const abs = (repoRelPath: string) => join(repoRoot, repoRelPath);

  const writeFileEnsured = (path: string, content: string) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content.endsWith('\n') ? content : `${content}\n`, 'utf-8');
  };

  return {
    writeSkill(path, content) {
      writeFileEnsured(abs(path), content);
    },

    writeRoutingEval(path, content) {
      writeFileEnsured(abs(path), content);
    },

    addManifestEntry(entry) {
      const manifestPath = join(skillsDir, 'manifest.json');
      if (!existsSync(manifestPath)) return;
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
      if (!Array.isArray(manifest.skills)) return;
      if (manifest.skills.some((s: { name?: string }) => s.name === entry.name)) return;
      manifest.skills.push(entry);
      writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8');
    },

    addResolverRow(row, section) {
      const resolverFile = findResolverFile(skillsDir);
      if (!resolverFile) return;
      const content = readFileSync(resolverFile, 'utf-8');
      if (content.includes(row.trim())) return; // idempotent
      const lines = content.split('\n');
      const start = lines.findIndex((l) => new RegExp(`^##\\s+${section}`).test(l));
      if (start === -1) return;
      let end = lines.length;
      for (let i = start + 1; i < lines.length; i++) {
        if (/^##\s/.test(lines[i])) { end = i; break; }
      }
      let insertAt = -1;
      for (let i = start + 1; i < end; i++) if (/^\s*\|/.test(lines[i])) insertAt = i;
      if (insertAt === -1) insertAt = end - 1;
      lines.splice(insertAt + 1, 0, row);
      writeFileSync(resolverFile, lines.join('\n'), 'utf-8');
    },

    readSkill(slug) {
      const p = join(skillsDir, slug, 'SKILL.md');
      return existsSync(p) ? readFileSync(p, 'utf-8') : undefined;
    },

    deprecateSkill(slug) {
      const p = join(skillsDir, slug, 'SKILL.md');
      if (!existsSync(p)) return;
      const content = readFileSync(p, 'utf-8');
      if (content.includes('> **Deprecated:**')) return;
      const m = content.match(/^---\n[\s\S]*?\n---\n?/);
      const banner = '> **Deprecated:** this skill was split into more specific skills — prefer those.\n\n';
      const next = m ? `${m[0]}\n${banner}${content.slice(m[0].length).replace(/^\n+/, '')}` : `${banner}${content}`;
      writeFileSync(p, next, 'utf-8');
    },
  };
}
