#!/usr/bin/env bash
# learn-skill.sh — distill brain data into a landed, anonymised, routable SKILL.md.
# Friendly front-door to hackathon_planning/distill-skill.sh.
#
#   bash /app/hackathon_toolkit/learn-skill.sh \
#       <slug> <role> "<triggers,comma,sep>" "<one-line description>" "<what to query the brain for>"
#
# Example:
#   bash /app/hackathon_toolkit/learn-skill.sh \
#     nurse-pain-assessment nurse \
#     "pain,discomfort,grimacing,pain scale" \
#     "Nurse decision-support for non-verbal pain assessment in dementia residents." \
#     "pain and discomfort observations and the ASG/psychomotor comfort duties"
#
# role must be: nurse | psychiatrist | general-medicine
set -uo pipefail
source "$(dirname "$0")/env.sh"

if [ "$#" -lt 5 ]; then
  echo "usage: learn-skill.sh <slug> <role> <triggers> <description> <topic>"
  echo "  role: nurse | psychiatrist | general-medicine"
  echo "  (run with 5 quoted arguments — see the header of this file for an example)"
  exit 2
fi

SLUG="$1" ROLE="$2" TRIGGERS="$3" DESC="$4" TOPIC="$5"
gbrain_require_lmstudio || exit 1

echo "══ Distilling skill '$SLUG' (role: $ROLE) ══"
SLUG="$SLUG" ROLE="$ROLE" TRIGGERS="$TRIGGERS" DESC="$DESC" TOPIC="$TOPIC" \
  bash "$PLANNING_DIR/distill-skill.sh"
