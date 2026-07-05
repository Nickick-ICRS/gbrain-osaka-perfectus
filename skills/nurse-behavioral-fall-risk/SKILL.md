---
name: nurse-behavioral-fall-risk
version: 0.1.0
description: |
  Nurse decision-support for behavioral change and fall-risk monitoring in dementia care. Decision support only — a licensed clinician confirms every recommendation.
triggers:
  - "agitation"
  - "wandering"
  - "fall risk"
  - "behavioral change"
  - "post-fall review"
  - "sundowning"
role: nurse
tools:
  - search
  - query
  - get_page
  - list_pages
mutating: false
---

# nurse-behavioral-fall-risk — Behavioral Fall & Elopement Risk Decision Support for Nursing-Home Residents

This skill provides structured decision support for clinicians and care assistants evaluating a resident who presents with behavioral symptoms (agitation, pathological wandering, elopement risk) that intersect with fall and safety risk in a residential aged-care setting (EHPAD). It draws on established PASA (Specialized Activities and Care Unit) protocols, ASG daily organization routines, and validated geriatric assessment instruments (MMSE, NPI-ES, AGGIR/GIR) to guide a systematic, non-diagnostic review. The output is a structured risk summary and recommended next steps for the multidisciplinary team.

## Phase 1: Brain-First Lookup

Before proceeding, run a gbrain query for the specific resident's context:

```
gbrain query --query "resident <name-or-id> behavioral agitation wandering fall elopement incontinence"
```

Use the returned pages to populate the clinical picture (recent transmission notes, assessment scores, care-plan entries) before applying the procedure below. The procedure itself is generic and does not assume any particular case.

## Contract

- **Input**: A resident identifier (or free-text description) for which the clinician wants a behavioral–fall-risk review. Optionally, recent assessment scores (MMSE, NPI-ES, AGGIR/GIR level) and any known diagnoses (e.g., Alzheimer's disease, vascular dementia).
- **Output**: A structured risk summary covering agitation level, wandering/elopement risk, fall risk, incontinence-related safety concerns, and recommended multidisciplinary actions.
- **Side effect**: none by default (mutating: false)

## When to invoke

- A resident exhibits new or worsening agitation, restlessness, or verbal/physical resistance to care.
- A resident is observed wandering corridors, attempting to leave the facility, or showing elopement behavior.
- A recent fall or near-fall has occurred and behavioral contributors are suspected.
- Incontinence episodes coincide with unsafe ambulation (e.g., rushing to the bathroom, urinating in the room).
- The multidisciplinary team is preparing or updating an individualized care plan for a PASA-eligible resident.
- Shift handover notes repeatedly flag "to monitor" or "to follow up" for behavioral or safety concerns.

## Procedure

1. **Gather baseline cognitive and functional status.** Retrieve the most recent MMSE (Mini-Mental State Examination) score and AGGIR/GIR (Groupe Iso-Ressources) dependence level. A low MMSE (e.g., ≤5) combined with a moderate GIR (e.g., GIR 2–3) signals preserved mobility despite significant cognitive impairment — a classic profile for wandering and fall risk. Note any NPI-ES (Neuropsychiatric Inventory — short form) score; higher scores indicate greater behavioral symptom burden.

2. **Screen for agitation and neuropsychiatric symptoms.** Review the NPI-ES domains (delusions, hallucinations, agitation/aggression, depression/anxiety, apathy, disinhibition, irritability, motor restlessness). Pay particular attention to agitation/aggression and motor restlessness items, as these correlate with impulsive movement and unsafe transfers. Cross-reference recent transmission notes for patterns such as refusal of care, resistance to incontinence changes, or complaints when disturbed.

3. **Assess wandering and elopement risk.** Determine whether the resident exhibits pathological wandering (purposeless ambulation, repetitive pacing) or goal-directed elopement behavior (attempting to leave the facility, heading toward exits). Check whether the resident manages transfers and indoor mobility independently but avoids outdoor exposure — a common pattern that still carries fall risk indoors. Evaluate whether agitation peaks at specific times (e.g., early morning rounds, meal transitions) to anticipate high-risk windows.

4. **Evaluate incontinence and hygiene-related safety factors.** Review whether the resident uses incontinence products, manages elimination independently, or has episodes of incontinence in inappropriate locations (e.g., urinating on the floor). Incontinence combined with urgency and preserved mobility significantly increases fall risk during rushed transfers. Note any refusal of incontinence changes or hygiene care, as this can lead to skin breakdown and discomfort-driven agitation.

5. **Map against the ASG daily protocol and PASA activities.** Align the resident's risk profile with the PASA daily organization: body-awareness/gentle movement workshops (10:30–11:15), therapeutic meals (12:30–13:30), and afternoon workshops (14:30–16:00). Identify which activities present the highest fall risk (e.g., transitions between workshop and meal, unsupervised lounge time) and which offer protective engagement (e.g., structured movement, hydration during sessions, music during quiet time). Ensure the ASG's handover documentation at 17:30–18:00 captures any behavioral changes observed during the PASA day.

6. **Synthesize and recommend multidisciplinary actions.** Produce a concise risk summary for the care team:
   - **Agitation level** (low/moderate/high) based on NPI-ES and transmission note patterns.
   - **Wandering/elopement risk** (present/absent, indoor vs. outdoor).
   - **Fall risk contributors** (mobility status, incontinence urgency, agitation timing, environmental factors).
   - **Recommended actions**: escalate to the psychomotor therapist for fall-prevention workshop referral; involve the psychologist for behavioral symptom assessment and individualized care-protocol drafting; adjust ASG daily schedule (e.g., increased supervision during high-risk transitions, scheduled toileting before movement activities); ensure hydration monitoring during workshops; document all observations in the care software for continuity.

## Guardrails

- **Decision support, not diagnosis.** This skill produces a structured risk summary to inform clinical judgment. It does not diagnose dementia severity, behavioral disorders, or fall etiology. All diagnostic decisions remain the responsibility of the coordinating physician and the multidisciplinary team.
- **APPI / 要配慮個人情報 — source isolation.** Any personal data retrieved in Phase 1 (resident names, room numbers, assessment scores, transmission notes) must be treated as sensitive personal health information under applicable privacy regulations (e.g., APPI in Japan, GDPR in Europe). Do not include identifiable information in the skill output. The procedure and recommendations are generic templates; populate them only within the secure clinical information system.
- **Scope limitation.** This skill addresses behavioral contributors to fall and elopement risk in a residential aged-care context. It does not cover acute medical events (e.g., syncope, stroke, infection), medication side effects, or environmental hazard assessment — refer these to the appropriate clinical specialist.
- **Cultural and facility variation.** PASA protocols, ASG roles, and assessment instruments (MMSE, NPI-ES, AGGIR) are described based on French EHPAD standards. Adapt to local regulatory frameworks and facility-specific care models as needed.
