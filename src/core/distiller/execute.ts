/**
 * distiller/execute.ts — the skill-authoring executor (Task 1 create/update/split).
 *
 * Turns a distiller DECISION into a real change to the skill library. Body
 * authoring is an injected `author` seam (real: an LLM subagent job on the local
 * stack; tests: a mock) — so the deterministic parts (assembly, anonymisation,
 * frontmatter preservation, apply) are fully testable with no LLM. All authored
 * bodies pass through the anonymiser as a hard gate (assembleSkill / body-swap).
 *
 * Side effects go through an injected `apply` sink so tests never touch disk.
 */

import type { CandidateTopic, DistillDecision, DistillReport } from './types.ts';
import { assembleSkill, type SkillArtifacts, type SkillSpec } from './assemble.ts';
import { anonymiseOrThrow } from './anonymise.ts';
import { slugify } from './run.ts';

/** Author a SKILL.md body (markdown, no frontmatter) grounded in the topic. */
export type AuthorBody = (args: {
  topic: CandidateTopic;
  decision: DistillDecision;
  slug: string;
  /** Existing body when updating, so the author folds new data in. */
  existingBody?: string;
}) => Promise<string>;

/** Side-effect sink. Real impl writes to disk + patches manifest/resolver. */
export interface ApplySink {
  writeSkill(path: string, content: string): void | Promise<void>;
  writeRoutingEval(path: string, content: string): void | Promise<void>;
  addManifestEntry(entry: { name: string; path: string; description: string }): void | Promise<void>;
  addResolverRow(row: string, section: string): void | Promise<void>;
  /** Full SKILL.md content of an existing skill (for update / split source). */
  readSkill?(slug: string): string | undefined;
  /** Mark a skill deprecated (for split). */
  deprecateSkill?(slug: string): void | Promise<void>;
}

export interface ExecuteDeps {
  author: AuthorBody;
  apply: ApplySink;
}

export interface ExecuteResult {
  action: 'created' | 'updated' | 'split' | 'noop';
  slugs: string[];
  artifacts: SkillArtifacts[];
  notes: string[];
}

/**
 * Build the subagent authoring prompt (pure, so it's testable without the LLM).
 * Instructs the model to ground in the brain, match the seed-skill structure,
 * and — critically — ANONYMISE (no identifiers). The executor still runs the
 * anonymiser as a hard gate; this prompt is the first line of defense.
 */
export function buildAuthorPrompt(args: {
  topic: CandidateTopic;
  decision: DistillDecision;
  slug: string;
  existingBody?: string;
}): string {
  const { topic, decision, slug, existingBody } = args;
  const intent =
    decision === 'update'
      ? `Update the body of the existing ${topic.role} skill '${slug}' by folding in new data. Preserve what still holds; revise what changed.`
      : `Write the body of a reusable ${topic.role} decision-support skill named '${slug}'.`;
  return [
    `${intent}`,
    `First call the query tool 2-3 times to gather what the brain knows about: ${topic.summary}`,
    existingBody ? `The current skill body is:\n${existingBody}` : '',
    `Then write a SKILL.md body in GitHub-flavored markdown with: (1) an H1 '# ${slug} — <short title>'; (2) a 2-3 sentence intro; (3) '## Phase 1: Brain-First Lookup'; (4) '## Contract' (Input, Output, 'Side effect: none by default (mutating: false)'); (5) '## When to invoke'; (6) '## Procedure' (4-6 general clinical steps); (7) '## Guardrails' incl. 'Decision support, not diagnosis' and 'APPI / 要配慮個人情報' source-isolation.`,
    `CRITICAL — ANONYMISE: a skill is a REUSABLE TEMPLATE, never about one person or place. Do NOT include any resident/patient/caregiver names or initials, room/bed numbers, ages, admission durations, dates, or facility/hospital/organization names. Refer to people generically ('a resident', 'the resident'). You MAY name standard instruments/protocols (MMSE, AGGIR, HAD, PASA, ASG).`,
    `Output ONLY the markdown body starting at '# '. No YAML frontmatter. No code fences.`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** One-line description from the topic (first sentence of the summary, capped). */
function deriveDescription(topic: CandidateTopic): string {
  const first = topic.summary.split(/(?<=[.!?])\s/)[0]?.trim() || topic.title;
  return first.length > 200 ? `${first.slice(0, 197)}…` : first;
}

/** Replace a SKILL.md body, keeping its existing frontmatter. */
function swapBody(existing: string, newBody: string): string {
  const m = existing.match(/^---\n[\s\S]*?\n---\n?/);
  const frontmatter = m ? m[0].replace(/\n?$/, '\n') : '';
  return `${frontmatter}\n${newBody.trim()}\n`;
}

async function specFor(topic: CandidateTopic, slug: string): Promise<SkillSpec> {
  return {
    slug,
    role: topic.role,
    description: deriveDescription(topic),
    triggers: topic.triggers ?? [],
  };
}

async function landNewSkill(
  topic: CandidateTopic,
  slug: string,
  decision: DistillDecision,
  deps: ExecuteDeps,
): Promise<SkillArtifacts> {
  const body = await deps.author({ topic, decision, slug });
  const artifacts = assembleSkill(await specFor(topic, slug), body); // anonymises (hard gate)
  await deps.apply.writeSkill(artifacts.skillPath, artifacts.skillContent);
  await deps.apply.writeRoutingEval(artifacts.routingEvalPath, artifacts.routingEval);
  await deps.apply.addManifestEntry(artifacts.manifestEntry);
  await deps.apply.addResolverRow(artifacts.resolverRow, artifacts.resolverSection);
  return artifacts;
}

/**
 * Execute the report's decision. `exact_match` is a no-op; `none` creates;
 * `update` rewrites the matched skill's body (frontmatter preserved); `split`
 * authors the target skills and deprecates the original.
 */
export async function executeDistillation(
  report: DistillReport,
  topic: CandidateTopic,
  deps: ExecuteDeps,
): Promise<ExecuteResult> {
  const notes: string[] = [];

  if (report.decision === 'exact_match') {
    return { action: 'noop', slugs: [], artifacts: [], notes: [`'${report.matchedSkill}' already covers this — no change`] };
  }

  if (report.decision === 'none') {
    const slug = slugify(topic.title);
    const art = await landNewSkill(topic, slug, 'none', deps);
    return { action: 'created', slugs: [slug], artifacts: [art], notes };
  }

  if (report.decision === 'update') {
    const slug = report.matchedSkill;
    if (!slug) throw new Error('executeDistillation: update decision without a matched skill.');
    const existing = deps.apply.readSkill?.(slug);
    if (!existing) throw new Error(`executeDistillation: cannot read existing skill '${slug}' to update.`);
    const body = await deps.author({ topic, decision: 'update', slug, existingBody: existing });
    const swapped = swapBody(existing, anonymiseOrThrow(body)); // hard gate
    await deps.apply.writeSkill(`skills/${slug}/SKILL.md`, swapped);
    return { action: 'updated', slugs: [slug], artifacts: [], notes: [`updated '${slug}' body`] };
  }

  // split
  const targets = (report.splitInto ?? []).filter(Boolean);
  if (targets.length < 2) {
    throw new Error('executeDistillation: split decision needs two target skill names in splitInto.');
  }
  const artifacts: SkillArtifacts[] = [];
  for (const slug of targets) {
    // Each split target reuses the source topic but its own slug.
    artifacts.push(await landNewSkill({ ...topic, title: slug }, slug, 'split', deps));
  }
  if (report.matchedSkill && deps.apply.deprecateSkill) {
    await deps.apply.deprecateSkill(report.matchedSkill);
    notes.push(`deprecated original '${report.matchedSkill}'`);
  }
  return { action: 'split', slugs: targets, artifacts, notes };
}
