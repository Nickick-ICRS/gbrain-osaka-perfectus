---
name: nurse-behavioral-fall-risk
version: 0.1.0
description: |
  Nurse decision-support for behavioral change and fall-risk monitoring in dementia residents. Decision support only — a licensed clinician confirms every recommendation.
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

# nurse-behavioral-fall-risk — Behavioral & Fall-Risk Decision Support for Nursing-Home Residents

This skill guides nurses and ASG (Geriatric Care Assistants) through a structured behavioral-fall-risk assessment workflow grounded in the PASA protocol and resident transmission logs stored in this brain. It synthesizes agitation, wandering, elopement risk, incontinence patterns, and constipation alerts into actionable decision-support steps. All recommendations are decision aids only — clinical diagnosis and care-plan modification remain the responsibility of the licensed nurse or coordinating physician.

## Phase 1: Brain-First Lookup

Before proceeding, query the brain for the specific resident's context. Run:

```
gbrain query "residents <NAME> OR room <NUMBER> behavioral transmission fall risk agitation wandering elopement incontinence"
```

This surfaces the resident's longitudinal transmission log, AGGIR assessments, active alerts (e.g., stool-monitoring, flight risk), and any prior psychomotor or psychologist evaluations. Use the results to populate the steps below with the resident's actual data.

## Contract

- **Input**: Resident name or room number; current behavioral concern (e.g., new agitation episode, wandering incident, incontinence event, constipation alert, fall event).
- **Output**: A structured behavioral-fall-risk summary with prioritized interventions, escalation triggers, and documentation prompts aligned with the PASA ASG daily protocol.
- **Side effect**: none by default (mutating: false)

## When to invoke

- A resident exhibits new or escalating agitation, aggression, or verbal refusal of care.
- A resident is observed wandering or shows elopement/flight-risk behavior.
- A resident urinates or defecates in hallways or outside the bathroom.
- A resident has a near-fall or actual fall, or shows gait instability.
- A constipation or stool-monitoring alert is active and the resident is restless or in pain.
- A new admission requires initial behavioral and fall-risk baseline assessment.
- The ASG needs to prepare a handover note covering behavioral changes during the PASA day program.

## Procedure

1. **Retrieve the resident's transmission log and active alerts.** From the brain lookup, note any flags: flight risk / pathological wandering (e.g., Mr. OG, Room 135), stool-monitoring alerts, agitation or refusal-of-care episodes, and withdrawal/overwhelm notes. Record the resident's current AGGIR level and any pacemaker or device notes.

2. **Screen for agitation and wandering triggers.** Cross-reference the transmission log for recent behavioral changes. Common triggers in the brain data include: constipation (oral laxative cycles, stool-monitoring alerts), sensory overload, disrupted routine, or unmet hygiene needs. If agitation is present, check whether the resident is on a behavioral-symptom observation protocol from the PASA psychologist.

3. **Assess fall and elopement risk.** For residents flagged with flight risk or pathological wandering, verify: (a) last known location and whether they are currently accounted for; (b) whether they use assistive devices (glasses, dentures, hearing aids); (c) transfer independence level (the brain records partial vs. full independence for standing, sitting, lying down); (d) whether the psychomotor therapist has prescribed proprioceptive or balance training. If the resident is very active with no outdoor access, escalate elopement precautions immediately.

4. **Check elimination and incontinence status.** If the resident urinates in hallways or shows fecal incontinence, review: (a) whether they use incontinence products; (b) whether a constipation alert is active (constipation-agitation-fall risk is a documented chain in the transmission data); (c) whether toileting assistance was provided per the ASG daily protocol (scheduled at 12:00–12:30 and 17:00–17:30). Document any missed toileting windows.

5. **Align interventions with the PASA ASG daily protocol.** Map interventions to the ASG schedule: (a) body-awareness / gentle movement workshop (10:30–11:15) for fall-prevention and agitation reduction; (b) hydration checks at workshop midpoint and 14:30–16:00; (c) therapeutic meal observation (12:30–13:30) for behavioral cues; (d) quiet-time settling in the lounge (13:30–14:30) for residents showing overwhelm or withdrawal; (e) final toileting assist and escorted return to residential units (17:00–17:30).

6. **Document and hand over.** Complete the day's handover documentation per the ASG protocol (17:30–18:00). Include: behavioral observations, fall/elopement risk status, elimination status, any interventions delivered, and escalation decisions. If the resident's behavior warrants updated individualized care plan entries, flag this for the coordinating nurse and psychologist (MMSE re-assessment if cognitive decline is suspected).

## Guardrails

- **Decision support, not diagnosis.** This skill provides structured prompts and protocol-aligned suggestions. It does not replace clinical judgment, licensed assessment (e.g., AGGIR, MMSE, psychomotor evaluation), or physician-ordered care-plan changes.
- **APPI / 要配慮個人情報 source-isolation.** All resident data referenced in this workflow comes from the brain's isolated nursing-home data sources (EHPAD transmission logs, AGGIR assessments, PASA protocols). Do not cross-reference or export resident-identifiable information to external systems. Treat all behavioral and health data as specially protected personal information (要配慮個人情報) under APPI.
- **Escalation threshold.** If a resident exhibits acute agitation with aggression, an active elopement event, a fall with injury, or signs of acute medical distress (e.g., severe constipation with pain, vital-sign abnormality), stop the workflow and escalate to the coordinating nurse or physician immediately.
- **Confidentiality.** Respect professional confidentiality per the ASG competency requirements. Handover notes must be completed in the care software, not shared outside the multidisciplinary team.
