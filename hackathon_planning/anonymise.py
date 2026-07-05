#!/usr/bin/env python3
"""anonymise.py — strip patient/facility identifiers from a generated SKILL.md body.

A skill is a REUSABLE decision-support template. It must never contain data
specific to an individual or an organization: no resident names/initials, no
room numbers, no ages, no admission durations, no facility/hospital names, no
dates. Generic clinical instruments and protocol names (MMSE, AGGIR, HAD, PASA,
ASG, EHPAD, NPI-ES, GIR levels as a *scale*) are fine — they are standards, not
identifiers.

Usage (filter): body on stdin → scrubbed body on stdout.
  - Substitutes known identifier patterns with generic placeholders.
  - Then re-scans the result; if ANY identifier pattern survives, prints the
    offending lines to stderr and exits 2 so the caller ABORTS instead of
    writing a skill that leaks PII. Exit 0 = clean.

This is a backstop, not the only defense — the authoring prompt also forbids
identifiers. Names with no title cannot be detected generically; the prompt is
the primary guard for those.
"""
import re
import sys

# Facility / organization names seen in this dataset. Extend as needed; matched
# case-insensitively as whole words. (Env GBRAIN_ANON_ORGS can add more.)
import os
ORG_DENYLIST = ["Almage", "Parentèle", "Parenteles", "Parentèles", "Reims"]
ORG_DENYLIST += [o for o in os.environ.get("GBRAIN_ANON_ORGS", "").split(",") if o.strip()]

# (pattern, replacement) — applied in order. Case-insensitive where marked.
SUBSTITUTIONS = [
    # Titled person names / initials: "Mr. OG", "Mme Dupont", "Dr. R"
    (re.compile(r"\b(?:Dr|Prof)\.?\s+[A-ZÀ-Ÿ][\wÀ-ÿ.'’-]*", re.U), "the clinician"),
    (re.compile(r"\b(?:Mr|Mrs|Ms|Mme|Mlle|M)\.\s*[A-ZÀ-Ÿ][\wÀ-ÿ.'’-]*", re.U), "the resident"),
    (re.compile(r"\b(?:Mr|Mrs|Ms|Mme|Mlle)\s+[A-ZÀ-Ÿ][\wÀ-ÿ.'’-]*", re.U), "the resident"),
    # Room / bed numbers: "Room 135", "chambre 12B", "Rm #4"
    (re.compile(r"\b(?:Room|Rooms|Chambre|Chambres|Rm|Bed|Lit)\.?\s*#?\s*\d+\w*", re.I), "the resident's room"),
    # Ages: "89 y", "89yo", "89 y.o.", "89yr(s)", "89 years old", "89 ans".
    # Requires an age marker — bare "5 years" (a duration) is intentionally NOT
    # matched, so durations aren't mangled into "an elderly resident".
    (re.compile(r"\b\d{1,3}\s*(?:y(?:\.?o\.?)?|yrs?|years?[-\s]old|ans)\b", re.I), "an elderly resident"),
    # Institutionalization / admission durations: "54 months institutionalized"
    (re.compile(r"\b\d+\s*(?:months?|mois|years?|ans|weeks?|semaines?)\s+(?:institutionali[sz]\w*|in institution|en institution|since admission|admitted)\w*", re.I), "long-term institutionalized"),
    # ISO dates and DD/MM/YYYY
    (re.compile(r"\b\d{4}-\d{2}-\d{2}\b"), "[date]"),
    (re.compile(r"\b\d{1,2}/\d{1,2}/\d{2,4}\b"), "[date]"),
]

# Detectors run AFTER substitution — any hit means residual PII → abort.
DETECTORS = [
    ("titled name", re.compile(r"\b(?:Mr|Mrs|Ms|Mme|Mlle|Dr|Prof)\.?\s+[A-ZÀ-Ÿ]", re.U)),
    ("room/bed number", re.compile(r"\b(?:Room|Chambre|Rm|Bed|Lit)\.?\s*#?\s*\d", re.I)),
    ("explicit age", re.compile(r"\b\d{1,3}\s*(?:y(?:\.?o\.?)?|yrs?|years?[-\s]old|ans)\b", re.I)),
]


def scrub(text: str) -> str:
    for pat in ORG_DENYLIST:
        if pat.strip():
            text = re.compile(rf"\b{re.escape(pat.strip())}\b", re.I).sub("the facility", text)
    for rx, repl in SUBSTITUTIONS:
        text = rx.sub(repl, text)
    return text


def find_residual(text: str):
    hits = []
    for name, rx in DETECTORS:
        for m in rx.finditer(text):
            line = text.count("\n", 0, m.start()) + 1
            hits.append((name, line, m.group(0)))
    for pat in ORG_DENYLIST:
        if pat.strip() and re.search(rf"\b{re.escape(pat.strip())}\b", text, re.I):
            hits.append(("org name", 0, pat.strip()))
    return hits


def main() -> int:
    body = sys.stdin.read()
    cleaned = scrub(body)
    residual = find_residual(cleaned)
    if residual:
        sys.stderr.write("anonymise: residual identifiers remain after scrubbing — refusing to write:\n")
        for name, line, frag in residual:
            sys.stderr.write(f"  - {name} @ line {line}: {frag!r}\n")
        sys.stderr.write("Fix the authoring prompt / source, or extend anonymise.py, then retry.\n")
        return 2
    sys.stdout.write(cleaned)
    return 0


if __name__ == "__main__":
    sys.exit(main())
