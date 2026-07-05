---
name: psych-caregiver-burden-support
version: 0.1.0
description: |
  Psychiatric decision-support for assessing and supporting family-caregiver burden and mood in dementia care. Decision support only — a licensed clinician confirms every recommendation.
triggers:
  - "caregiver burden"
  - "caregiver anxiety"
  - "caregiver depression"
  - "family distress"
  - "caregiver support"
  - "visit difficulty"
role: psychiatrist
tools:
  - search
  - query
  - get_page
  - list_pages
mutating: false
---

# psych-caregiver-burden-support — Psychiatric Decision Support for Family-Caregiver Burden in Nursing-Home Dementia Care

This skill provides structured decision support for psychiatrists evaluating and managing family-caregiver burden when a relative resides in a nursing-home (EHPAD) setting with dementia. It draws on caregiver hand-massage intervention data, validated anxiety/depression (HAD) and cognitive (CADI, CAMI, CASI) scales, and the multidisciplinary PASA (Psychologist, Psychomotor Therapist, ASG) role protocols stored in this brain. Use it to contextualize caregiver distress, identify modifiable burden drivers, and coordinate non-pharmacologic support pathways.

## Phase 1: Brain-First Lookup

Before proceeding, run a gbrain query scoped to the patient's context:

```
gbrain query --source <patient-source> "caregiver burden HAD CADI CAMI PASA"
```

This surfaces any resident-specific HAD scores, cognitive-scale baselines, PASA involvement, and prior caregiver-intervention notes already stored. If no patient-specific hits return, fall back to the generic protocol below.

## Contract

| | |
|---|---|
| **Input** | Patient/resident identifier; caregiver relationship (e.g., daughter, son); current HAD score if available; cognitive scale results (CADI, CAMI, CASI, MMSE) if available; PASA enrollment status; visit frequency and duration. |
| **Output** | Structured burden assessment summary; recommended non-pharmacologic interventions mapped to PASA roles; follow-up cadence and escalation triggers. |
| **Side effect** | none by default (mutating: false) |

## When to invoke

- A family caregiver reports emotional exhaustion, guilt, or anxiety related to visiting a nursing-home resident with dementia.
- The resident's HAD (Hospital Anxiety and Depression) screen flags clinically significant anxiety or depression in the caregiver.
- Cognitive decline (CADI/CAMI/CASI trajectory) is accelerating and the caregiver is struggling to adapt.
- The resident is enrolled in or being considered for the PASA (Specialized Activities and Care Unit) and the care team wants to integrate caregiver involvement.
- You need to differentiate caregiver burnout from primary psychiatric pathology requiring independent treatment.
- A multidisciplinary care-plan review is underway and caregiver burden is a documented concern.

## Procedure

1. **Retrieve the caregiver's HAD score and cognitive-scale baselines.** Look up the resident's file for HAD items Q1–Q14 (anxiety subscale Q1–Q7, depression subscale Q8–Q14; each scored 0–3). Cross-reference with CADI (1–3 scale), CAMI (1–4 scale), and CASI (1–3 scale) scores to establish the resident's cognitive profile. In the hand-massage study, Mr. R (89 y, Alzheimer's, GIR 1, 54 months institutionalized) had baseline HAD items ranging 0–3 across both subscales, with CADI=2, CAMI=1–3, CASI=2–3 — a typical mixed-profile presentation.

2. **Map caregiver visit patterns against burden indicators.** Document visit frequency (e.g., every 3 weeks or every 15 days), duration (15 min to 1.5 h), and whether the caregiver reports visits as stressful or meaningful. In the intervention data, the daughter-caregiver initially visited once every 3 weeks for 15 min–1.5 h; after 5 hand-massage sessions she reported "It gives me a purpose for visiting her … a goal of well-being for her and family well-being" and visits increased to every 15 days for 30–60 min.

3. **Assess PASA eligibility and current involvement.** Determine whether the resident is enrolled in the PASA. The Psychologist (PASA) conducts cognitive assessments (MMSE), assesses behavioral symptoms, facilitates memory workshops, and meets with families to provide psychological support. The Psychomotor Therapist (PASA) assesses psychomotor abilities, develops therapeutic plans, and leads body-expression, relaxation, and sensory workshops. The Geriatric Care Assistant (ASG) executes the daily protocol (10:00–18:00) including body-awareness workshops, press-review sessions, therapeutic meals, and structured return-to-unit transitions.

4. **Recommend structured caregiver-participation interventions.** Based on study evidence, propose a hand-massage or similar tactile-engagement protocol: (a) 5 weekly sessions with therapist-guided hand massage during visits; (b) the caregiver learns the technique by session 4 and takes ownership; (c) the resident typically shows increased cooperation and anticipatory engagement (e.g., spontaneously extending hands). Track caregiver satisfaction at week 6 using the same HAD items.

5. **Coordinate with the PASA multidisciplinary team.** Refer caregiver concerns to the Psychologist (PASA) for formal psychological support and to the Psychomotor Therapist (PASA) for tailored sensory/motor activities the caregiver can co-participate in. Ensure the ASG documents the caregiver's involvement in the daily handover (17:30–18:00) so the care team is aware of the caregiver's role.

6. **Set follow-up and escalation triggers.** Re-assess HAD at 4–6 weeks. Escalate to independent psychiatric treatment for the caregiver if: (a) HAD anxiety or depression subscale exceeds 11; (b) the caregiver reports suicidal ideation or functional impairment outside the visit context; (c) the resident's behavioral symptoms (NPI-ES > 40) worsen despite PASA intervention and caregiver support.

## Guardrails

- **Decision support, not diagnosis.** This skill structures information for the treating psychiatrist; it does not replace clinical judgment, formal diagnosis, or independent psychiatric evaluation of either the resident or the caregiver.
- **APPI / 要配慮個人情報 — source-isolation.** All resident and caregiver data referenced here originates from stored nursing-home brain records. Do not cross-reference with external EHR systems, do not re-identify individuals beyond the scope of the current consultation, and honor APPI (Act on the Protection of Personal Information) and sensitive-personal-information (要配慮個人情報) requirements: isolate caregiver mental-health data from resident clinical records, and redact identifiers in any exported summaries.
- **Scale validity.** HAD, CADI, CAMI, and CASI scores are only interpretable when administered by trained personnel under consistent conditions. Do not infer clinical severity from single-item values; always use full-subscale totals and compare against validated cutoffs.
- **Intervention generalizability.** The hand-massage protocol is derived from a single-case study (Mr. R). Outcomes may vary; present it as an evidence-informed option, not a guarantee.
