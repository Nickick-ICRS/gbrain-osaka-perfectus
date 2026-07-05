/**
 * orchestrator/select.ts — the skill selector (the missing hinge).
 *
 * Given (input + history + prior outputs) and the set of ELIGIBLE custom skills,
 * return ranked recommendations. This is the seat the unimplemented
 * `routing-eval --llm` placeholder was left for (src/commands/routing-eval.ts).
 *
 * v0 (this file) is a deterministic placeholder: trigger/keyword overlap so the
 * pipeline runs end-to-end without an LLM or the DB. The real selector should
 * replace `selectSkills` with an LLM ranker over skill descriptions conditioned
 * on the input + retrieved history (see TODO below), keeping the same signature.
 *
 * Invariant: this function only ever receives already-gated custom skills
 * (see custom-skills.ts). It must never widen that set.
 */

import type { CandidateSkill, SkillRole, OrchestratorContext, SkillRecommendation } from './types.ts';
import { isHealthcareRole } from './custom-skills.ts';

/** Lowercase word tokens, deduped. Crude on purpose — placeholder only. */
function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2),
  );
}

/**
 * v0 placeholder ranker. Scores each custom skill by trigger/description overlap
 * with the input (and prior skill outputs, for the feedback loop). Deterministic.
 *
 * TODO(selector): replace body with an LLM call that ranks `custom` given
 *   { input.text, input.state, history snippets, priorSkillOutputs }.
 *   Keep this signature so run.ts / tests don't change. Add an embedding
 *   pre-filter before the LLM tie-break once the DB layer is available.
 */
export function selectSkills(
  ctx: OrchestratorContext,
  custom: CandidateSkill[],
): SkillRecommendation[] {
  const haystack = [
    ctx.input.text,
    ...(ctx.priorSkillOutputs ?? []).map((o) => o.summary),
    ...ctx.history.map((h) => h.snippet),
  ].join(' ');
  const inputTokens = tokens(haystack);

  const scored = custom
    .map((s) => {
      const skillTokens = tokens([s.description, ...s.triggers].join(' '));
      let hits = 0;
      for (const t of skillTokens) if (inputTokens.has(t)) hits++;
      const denom = Math.max(skillTokens.size, 1);
      const confidence = hits / denom; // 0..1, crude
      const role: SkillRole = isHealthcareRole(s.role) ? s.role : 'general-medicine';
      const rec: SkillRecommendation = {
        skill: s.name,
        role,
        reason: hits > 0
          ? `matched ${hits} trigger/description term(s) in the input`
          : 'no term overlap (placeholder selector)',
        confidence,
      };
      return rec;
    })
    .filter((r) => r.confidence > 0)
    .sort((a, b) => b.confidence - a.confidence);

  return scored;
}
