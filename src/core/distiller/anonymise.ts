/**
 * distiller/anonymise.ts — strip patient/facility identifiers from an authored
 * SKILL.md body. TS port of hackathon_planning/anonymise.py so the core skill
 * executor can anonymise at runtime with no python dependency.
 *
 * A skill is a REUSABLE template — never data about one individual or place: no
 * resident names/initials, room/bed numbers, ages, admission durations, dates,
 * or facility/hospital names. Generic instruments/protocols (MMSE, AGGIR, HAD,
 * PASA, ASG, GIR *levels*, "5 years of data") are preserved.
 *
 * `anonymise` returns the scrubbed text + any residual identifiers a detector
 * still finds AFTER scrubbing. `anonymiseOrThrow` throws on residual so the
 * authoring path ABORTS rather than write PII (names without a title can't be
 * detected generically — the authoring prompt is the primary guard for those).
 */

export interface AnonResidual {
  kind: string;
  line: number;
  fragment: string;
}
export interface AnonResult {
  text: string;
  residual: AnonResidual[];
}

/** Facility / org names to scrub. Extend via GBRAIN_ANON_ORGS (comma-separated). */
function orgDenylist(extra?: string[]): string[] {
  const base = ['Almage', 'Parentèle', 'Parenteles', 'Parentèles', 'Reims'];
  const env = (process.env.GBRAIN_ANON_ORGS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return [...base, ...env, ...(extra ?? [])];
}

// (pattern, replacement), applied in order.
const SUBSTITUTIONS: Array<[RegExp, string]> = [
  [/\b(?:Dr|Prof)\.?\s+[A-ZÀ-Ÿ][\wÀ-ÿ.'’-]*/g, 'the clinician'],
  [/\b(?:Mr|Mrs|Ms|Mme|Mlle|M)\.\s*[A-ZÀ-Ÿ][\wÀ-ÿ.'’-]*/g, 'the resident'],
  [/\b(?:Mr|Mrs|Ms|Mme|Mlle)\s+[A-ZÀ-Ÿ][\wÀ-ÿ.'’-]*/g, 'the resident'],
  [/\b(?:Room|Rooms|Chambre|Chambres|Rm|Bed|Lit)\.?\s*#?\s*\d+\w*/gi, "the resident's room"],
  [/\b\d{1,3}\s*(?:y(?:\.?o\.?)?|yrs?|years?[-\s]old|ans)\b/gi, 'an elderly resident'],
  [
    /\b\d+\s*(?:months?|mois|years?|ans|weeks?|semaines?)\s+(?:institutionali[sz]\w*|in institution|en institution|since admission|admitted)\w*/gi,
    'long-term institutionalized',
  ],
  [/\b\d{4}-\d{2}-\d{2}\b/g, '[date]'],
  [/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g, '[date]'],
];

// Detectors run AFTER substitution — any hit ⇒ residual PII.
const DETECTORS: Array<[string, RegExp]> = [
  ['titled name', /\b(?:Mr|Mrs|Ms|Mme|Mlle|Dr|Prof)\.?\s+[A-ZÀ-Ÿ]/g],
  ['room/bed number', /\b(?:Room|Chambre|Rm|Bed|Lit)\.?\s*#?\s*\d/gi],
  ['explicit age', /\b\d{1,3}\s*(?:y(?:\.?o\.?)?|yrs?|years?[-\s]old|ans)\b/gi],
];

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function lineOf(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) if (text[i] === '\n') line++;
  return line;
}

export function anonymise(text: string, extraOrgs?: string[]): AnonResult {
  const orgs = orgDenylist(extraOrgs);
  let out = text;
  for (const org of orgs) {
    out = out.replace(new RegExp(`\\b${escapeRegExp(org)}\\b`, 'gi'), 'the facility');
  }
  for (const [rx, repl] of SUBSTITUTIONS) out = out.replace(rx, repl);

  const residual: AnonResidual[] = [];
  for (const [kind, rx] of DETECTORS) {
    for (const m of out.matchAll(rx)) {
      residual.push({ kind, line: lineOf(out, m.index ?? 0), fragment: m[0] });
    }
  }
  for (const org of orgs) {
    const rx = new RegExp(`\\b${escapeRegExp(org)}\\b`, 'gi');
    const m = rx.exec(out);
    if (m) residual.push({ kind: 'org name', line: lineOf(out, m.index), fragment: org });
  }
  return { text: out, residual };
}

/** Scrub and throw on any residual identifier (fail-closed for the write path). */
export function anonymiseOrThrow(text: string, extraOrgs?: string[]): string {
  const { text: cleaned, residual } = anonymise(text, extraOrgs);
  if (residual.length > 0) {
    const detail = residual.map((r) => `${r.kind} @ line ${r.line}: ${JSON.stringify(r.fragment)}`).join('; ');
    throw new Error(
      `anonymise: residual identifiers after scrubbing — refusing to write a skill: ${detail}`,
    );
  }
  return cleaned;
}
