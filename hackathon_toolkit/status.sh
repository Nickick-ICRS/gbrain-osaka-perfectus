#!/usr/bin/env bash
# status.sh — one-glance health: LM Studio, brain contents, models, skills.
#     bash /app/hackathon_toolkit/status.sh
set -uo pipefail
source "$(dirname "$0")/env.sh"
cd /app
gbrain_unlock

echo "══ LM Studio ══"
if gbrain_require_lmstudio; then
  echo "  ✓ reachable at $OPENROUTER_BASE_URL"
  echo "  models:"; curl -s "${OPENROUTER_BASE_URL}/models" | bun -e 'const j=JSON.parse(await Bun.stdin.text()); for (const m of j.data) console.log("    - "+m.id)' 2>/dev/null
fi

echo; echo "══ Brain ══"
timeout 40 bun "$GBRAIN_SRC" stats 2>/dev/null | head -6

echo; echo "══ Models (resolved) ══"
timeout 40 bun "$GBRAIN_SRC" models 2>/dev/null | grep -iE "tier\.|embedding|default" | head -8

echo; echo "══ Patient-care skills ══"
grep -oE "skills/[a-z0-9-]+/SKILL\.md.? \(role: [a-z-]+\)" skills/RESOLVER.md 2>/dev/null | tr -d '\140' | sed 's/^/  /'

echo; echo "══ Resolver health ══"
timeout 40 bun "$GBRAIN_SRC" check-resolvable 2>/dev/null | tail -1
