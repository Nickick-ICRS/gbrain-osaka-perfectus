/**
 * orchestrator/custom-skills.ts — the healthcare custom-skill policy.
 *
 * THIS IS THE LOAD-BEARING RULE for the whole orchestrator:
 *
 *   For healthcare / patient data we run OUR OWN custom clinical skills.
 *   We do NOT route patient data to generic bundled GBrain skills.
 *
 * Why: generic GBrain skills (query, ingest, maintain, enrich, briefing, …) are
 * built for general knowledge-brain ops. They carry no clinical guardrails, make
 * no APPI (要配慮個人情報) handling promises, and were never reviewed for patient
 * safety. Sending a patient's data through them is both a compliance risk and a
 * correctness risk. Our nurse/psychiatrist skills are the reviewed, role-scoped
 * path — so routing is ALLOWLIST-by-role, not denylist.
 *
 * The gate is an allowlist: a candidate is eligible iff it declares one of the
 * HEALTHCARE_ROLES in its SKILL.md frontmatter (`role:`). Anything without such a
 * role — which is every generic GBrain skill — is ineligible for patient routing.
 * The GENERIC_GBRAIN_SKILLS list below is documentation + defense-in-depth so a
 * match against one is reported explicitly rather than silently ignored.
 */

import type { CandidateSkill, HealthcareRole } from './types.ts';

/** Roles that mark a skill as one of OUR reviewed custom clinical skills. */
export const HEALTHCARE_ROLES: readonly HealthcareRole[] = ['nurse', 'psychiatrist', 'shared'] as const;

/**
 * Known generic bundled GBrain skill families. NOT the gate (the role allowlist
 * is) — this exists so that when a generic skill matches a patient input we can
 * name it in `excluded_generic` for the audit trail instead of dropping it
 * silently. Keep roughly in sync with skills/RESOLVER.md; being stale here only
 * costs a less-specific audit note, never a wrong routing decision.
 */
export const GENERIC_GBRAIN_SKILLS: readonly string[] = [
  'ingest', 'query', 'maintain', 'enrich', 'briefing', 'migrate', 'setup', 'publish',
  'signal-detector', 'brain-ops', 'idea-ingest', 'media-ingest', 'meeting-ingestion',
  'citation-fixer', 'repo-architecture', 'skill-creator', 'daily-task-manager',
  'cron-scheduler', 'reports', 'data-research', 'minion-orchestrator',
] as const;

/** True iff `role` is one of our reviewed clinical roles. */
export function isHealthcareRole(role: string | undefined): role is HealthcareRole {
  return role !== undefined && (HEALTHCARE_ROLES as readonly string[]).includes(role);
}

/**
 * A candidate is a custom healthcare skill iff its frontmatter declares a
 * healthcare role. This is the ONLY thing that makes a skill eligible to receive
 * patient data.
 */
export function isCustomHealthcareSkill(skill: CandidateSkill): boolean {
  return isHealthcareRole(skill.role);
}

export interface SkillPartition {
  /** Eligible: our custom clinical skills. */
  custom: CandidateSkill[];
  /** Ineligible for patient data: everything without a healthcare role. */
  generic: CandidateSkill[];
}

/**
 * Split candidates into custom (eligible) vs generic (ineligible). The
 * orchestrator only ever selects from `custom`; `generic` feeds the audit note.
 */
export function partitionSkills(candidates: CandidateSkill[]): SkillPartition {
  const custom: CandidateSkill[] = [];
  const generic: CandidateSkill[] = [];
  for (const s of candidates) {
    (isCustomHealthcareSkill(s) ? custom : generic).push(s);
  }
  return { custom, generic };
}

/**
 * Fail-closed assertion: throw if a recommendation set ever contains a
 * non-healthcare skill. Call this right before returning/executing so a future
 * bug in the selector can never leak patient data into a generic skill.
 */
export function assertAllCustom(skills: CandidateSkill[]): void {
  const leaked = skills.filter((s) => !isCustomHealthcareSkill(s));
  if (leaked.length > 0) {
    throw new Error(
      `orchestrator: refusing to route patient data to non-clinical skill(s): ${leaked
        .map((s) => s.name)
        .join(', ')}. Only skills with role ${HEALTHCARE_ROLES.join('|')} are eligible.`,
    );
  }
}
