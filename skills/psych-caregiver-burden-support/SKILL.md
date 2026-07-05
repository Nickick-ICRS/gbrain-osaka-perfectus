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

# psych-caregiver-burden-support — Assessing & Supporting Family Caregiver Burden in Residential Long-Term Care

This skill guides the clinician through a structured assessment of family caregiver burden when a resident is admitted to or residing in a long-term care facility (EHPAD). It integrates validated scales for caregiver anxiety, depression, and distress, alongside the multidisciplinary PASA (Specialized Activities and Care Unit) team protocols that can alleviate caregiver stress through structured therapeutic programming. The procedure is designed for reuse across residents and settings.

## Phase 1: Brain-First Lookup

Before proceeding, run a gbrain query for the specific patient's context:

```
gbrain query "caregiver burden <patient-identifier>"
```

Retrieve any existing HAD, CADI, CAMI, CASI, MMSE, NPI-ES, or AGGIR assessment results, PASA enrollment status, and prior psychologist or psychomotor therapist notes. Use those results to customize the steps below.

## Contract

| | |
|---|---|
| **Input** | Resident identifier; caregiver relationship type; existing assessment data (HAD, CADI, CAMI, CASI, MMSE, NPI-ES, AGGIR/GIR); PASA eligibility status; current care-plan notes |
| **Output** | Structured caregiver-burden assessment summary; recommended PASA referral or psychological support pathway; follow-up schedule for scale re-administration |
| **Side effect** | none by default (mutating: false) |

## When to invoke

- A resident is newly admitted to a long-term care facility and the caregiver reports emotional distress, exhaustion, or guilt
- The resident exhibits behavioral and psychological symptoms of dementia (BPSD) — agitation, wandering, sleep disturbance — and the caregiver is coping poorly
- Routine follow-up reveals rising scores on the HAD (Hospital Anxiety and Depression Scale) or CADI (Caregiver Distress Index) for the caregiver
- The psychologist or psychomotor therapist identifies a need for structured family support during multidisciplinary case review
- The caregiver requests psychological support or is referred by the PASA psychologist
- The resident's individualized care plan indicates caregiver involvement in therapeutic activities (e.g., hand-massage sessions, memory workshops)

## Procedure

1. **Gather baseline caregiver and resident data.** Collect the caregiver's relationship to the resident, visit frequency, and whether the caregiver has previously received psychological support. Record the resident's diagnosis, GIR/AGGIR dependency level, and current cognitive status (MMSE or CASI score). Note any neuropsychiatric symptoms from the NPI-ES total (FxG) score.

2. **Administer the HAD scale (Hospital Anxiety and Depression Scale) to the caregiver.** Score each of the 14 items (Q1–Q14) on the 0–3 scale. Sum to obtain the total HAD score. Interpret elevated subscale scores as indicators of caregiver anxiety or depression requiring follow-up. Document the score in the caregiver assessment record.

3. **Administer the CADI scale (Caregiver Distress Index) to quantify caregiver burden.** Score all 30 items (Q1–Q30) on the 0–3 scale. Classify the overall result as low, moderate, or very stressful based on the summed score. High CADI scores signal the need for immediate psychological support referral through the PASA psychologist.

4. **Administer the CAMI scale (Caregiver Mental Impact) and CASI scale where applicable.** The CAMI scale (38 items, Q1–Q38) evaluates the caregiver's perceived mental health impact and intervention utility on a 0–3 scale. The CASI scale assesses the caregiver's cognitive appraisal of the caregiving situation. Record scores at baseline and at each follow-up to track trajectory.

5. **Evaluate PASA eligibility and multidisciplinary referral pathways.** If the resident is eligible for the PASA (Specialized Activities and Care Unit), coordinate with the psychomotor therapist for psychomotor assessment and therapeutic planning (body-expression workshops, relaxation, fall-prevention activities). Engage the PASA psychologist for cognitive assessment (MMSE), behavioral-symptom monitoring, and family meetings. The Geriatric Care Assistant (ASG) supports daily therapeutic activities, including social and cognitive stimulation sessions, and ensures continuity of care through daily handover documentation.

6. **Schedule follow-up reassessment.** Re-administer HAD, CADI, and CAMI scales at defined intervals (e.g., after each therapeutic intervention cycle or at multidisciplinary team review). Compare scores to baseline to evaluate whether caregiver burden is decreasing, stable, or worsening. Adjust the care plan and PASA activity schedule accordingly.

## Guardrails

- **Decision support, not diagnosis.** This skill provides a structured assessment and referral framework. It does not replace clinical diagnosis, psychiatric evaluation, or the treating physician's judgment.
- **APPI / 要配慮個人情報 — source isolation.** All caregiver and resident data handled through this skill are sensitive personal health information (APPI under Japanese law; 要配慮個人情報 under the Act on the Protection of Personal Information). Ensure data is accessed only within authorized clinical systems, never shared outside the care team, and anonymized in any research or quality-improvement reporting.
- **Scale administration requires training.** HAD, CADI, CAMI, and CASI scales should be administered by trained professionals (psychologist, PASA team member, or designated care staff). Do not self-administer or interpret scores without clinical context.
- **Cultural and linguistic sensitivity.** Ensure scales are administered in the caregiver's preferred language using validated translations. Adapt communication style to the caregiver's educational background and emotional state.
- **Escalation threshold.** If HAD subscale scores or CADI total scores indicate severe distress, escalate immediately to the PASA psychologist or the coordinating physician for urgent intervention.
